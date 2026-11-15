import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import type { HealthAct, Prisma, StockItem } from '../generated/prisma/client';
import type { StockCategory } from '../generated/prisma/enums';
import {
  INVALID_BATCH,
  StockLedgerService,
} from '../stock/stock-ledger.service';

type Tx = Prisma.TransactionClient;

export const NOT_VETERINARY = "Ce produit n'est pas un produit vétérinaire";
export const NOT_VACCINE = "Ce produit n'est pas un vaccin";
export const INVALID_PRODUCT = 'Produit invalide';

/** Veterinary stock articles of an act; plan steps take vaccines only. */
export const VETERINARY: StockCategory[] = ['MEDICAMENT', 'VACCIN'];

/** The stock side of health acts: which articles they may use, and the ledger exits they write. */
@Injectable()
export class HealthStock {
  constructor(private readonly ledger: StockLedgerService) {}

  /** An active article of the user's organisation in one of `allowed` categories (400 otherwise). */
  async assertProduct(
    tx: Tx,
    ctx: RequestContext,
    stockItemId: string,
    allowed: StockCategory[] = VETERINARY,
  ): Promise<StockItem> {
    const item = await tx.stockItem.findFirst({
      where: {
        id: stockItemId,
        organizationId: ctx.user.organizationId,
        active: true,
      },
    });
    if (!item) throw new BadRequestException(INVALID_PRODUCT);
    if (!allowed.includes(item.category)) {
      throw new BadRequestException(
        allowed.length === 1 && allowed[0] === 'VACCIN'
          ? NOT_VACCINE
          : NOT_VETERINARY,
      );
    }
    return item;
  }

  /**
   * The ids among `ids` that are active articles of the user's organisation in
   * one of `allowed` categories (no error for the others).
   */
  async usable(
    tx: Tx,
    ctx: RequestContext,
    ids: string[],
    allowed: StockCategory[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const items = await tx.stockItem.findMany({
      where: {
        id: { in: ids },
        organizationId: ctx.user.organizationId,
        active: true,
        category: { in: allowed },
      },
      select: { id: true },
    });
    return new Set(items.map((i) => i.id));
  }

  /**
   * The product lot an act names exists for this farm and article: checked
   * before the act is written, since the row's foreign key would otherwise
   * answer 500. (Expiry and quantity are the ledger's business.)
   */
  async assertLot(
    tx: Tx,
    farmId: string,
    stockItemId: string,
    stockBatchId: string,
  ): Promise<void> {
    const lot = await tx.stockBatch.findFirst({
      where: { id: stockBatchId, farmId, stockItemId },
      select: { id: true },
    });
    if (!lot) throw new BadRequestException(INVALID_BATCH);
  }

  /**
   * Called inside the act's transaction after every create (`before` null),
   * update and delete (`after` null). A REALISE act with a stock article and a
   * quantity writes one `SORTIE` (reason `TRAITEMENT`, source `HEALTH_ACT`) on
   * the act's farm, dated the day it was done, from `stockBatchId` when given
   * (an explicit lot, kept strict by the ledger) else nearest expiry first. The
   * ledger values it at the weighted-average cost and refuses an expired lot
   * (`Lot périmé`) or more than is available (`Stock insuffisant`), which rolls
   * the whole request back.
   *
   * Create or complete = `recordMany`, an edit of a done act (quantity, day,
   * lot) = `replaceBySource`, delete or cancel = `reverseBySource`: one ledger
   * call per transaction. Lock order of every path: the lot or animal
   * (`HealthTargets`), the act row (the service), then the ledger's (farm,
   * article) locks, last. A planned act consumes nothing. Having `sante` rights
   * is enough to consume: a role without `stocks` rights consumes implicitly.
   */
  async afterActChange(
    tx: Tx,
    ctx: RequestContext,
    before: HealthAct | null,
    after: HealthAct | null,
  ): Promise<void> {
    const old = before ? exitOf(before, ctx) : null;
    const next = after ? exitOf(after, ctx) : null;
    if (before && old && !next) {
      await this.ledger.reverseBySource(tx, 'HEALTH_ACT', before.id, [
        before.farmId,
      ]);
    } else if (after && next && !old) {
      await this.ledger.recordMany(tx, [
        { ...next, sourceType: 'HEALTH_ACT', sourceId: after.id },
      ]);
    } else if (after && old && next && !sameExit(old, next)) {
      await this.ledger.replaceBySource(
        tx,
        'HEALTH_ACT',
        after.id,
        [next],
        [after.farmId],
      );
    }
  }
}

/** The ledger exit a done act with a product and a quantity writes, else null. */
function exitOf(act: HealthAct, ctx: RequestContext) {
  if (
    act.status !== 'REALISE' ||
    !act.stockItemId ||
    !act.doneDate ||
    !act.quantity ||
    !act.quantity.gt(0)
  ) {
    return null;
  }
  return {
    farmId: act.farmId,
    stockItemId: act.stockItemId,
    date: act.doneDate,
    type: 'SORTIE' as const,
    quantity: act.quantity.neg(),
    reason: 'TRAITEMENT' as const,
    stockBatchId: act.stockBatchId,
    userId: ctx.user.id,
  };
}

type Exit = NonNullable<ReturnType<typeof exitOf>>;

const sameExit = (a: Exit, b: Exit): boolean =>
  a.stockItemId === b.stockItemId &&
  a.stockBatchId === b.stockBatchId &&
  a.date.getTime() === b.date.getTime() &&
  a.quantity.equals(b.quantity);
