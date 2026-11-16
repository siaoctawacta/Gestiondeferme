import { BadRequestException, Injectable } from '@nestjs/common';
import { lockRow } from '../common/lock-row';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import type { Prisma } from '../generated/prisma/client';
import {
  eggAvailable,
  eggShortfall,
  marketableOf,
  type EggOutflowDay,
  type EggProductionDay,
} from './egg-balance';

import { EggOutflowRegistry } from './egg-outflow-registry';

export {
  EggOutflowRegistry,
  type EggOutflowSource,
} from './egg-outflow-registry';

type Tx = Prisma.TransactionClient;

export const EGGS_SOLD =
  'Ces œufs sont déjà vendus : la production commercialisable ne peut pas descendre sous les ventes';

export const notEnoughEggs = (code: string, available: number): string =>
  `Œufs disponibles insuffisants pour ${code} (${available} disponibles)`;

/**
 * The egg balance of a laying lot: Σ marketable production minus Σ outflows,
 * never negative on any day of its history. Owned by `eggs`; it takes the
 * caller's transaction and, when it writes nothing, the lot lock:
 *
 * - The withdrawal period is NOT checked here: the caller must call
 *   `WithdrawalRegistry.assertClear` for the lot first (the sales module's
 *   `sale-effects` does).
 * - Eggs that leave for incubation are the ones recorded as `toIncubation` on
 *   the egg production records (they are not marketable); an incubation's own
 *   `eggsSet` is NOT deducted again.
 * - LOCKS: the lot row (`AnimalBatch`, the same lock every herd, egg and sale
 *   write takes). A caller locks its lots first, ascending id
 *   (`HerdLedgerService.lockBatches`); `assertSale` / `assertProduction`
 *   re-take it for the lot they check (free when held), so an egg sale and an
 *   edit of the production of that lot serialise, and two sales race one at
 *   a time. No other lock is taken.
 */
@Injectable()
export class EggStockService {
  constructor(
    private readonly outflowRegistry: EggOutflowRegistry,
    private readonly ledger: HerdLedgerService,
  ) {}

  private async history(tx: Tx, batchIds: string[]) {
    const production = new Map<string, EggProductionDay[]>();
    const outflows = new Map<string, EggOutflowDay[]>();
    for (const id of batchIds) {
      production.set(id, []);
      outflows.set(id, []);
    }
    if (batchIds.length === 0) return { production, outflows };
    const rows = await tx.eggProduction.findMany({
      where: { batchId: { in: batchIds } },
      select: {
        batchId: true,
        date: true,
        collected: true,
        broken: true,
        downgraded: true,
        toIncubation: true,
      },
    });
    for (const r of rows) {
      production.get(r.batchId)?.push({
        date: r.date,
        marketable: marketableOf(r),
      });
    }
    for (const o of await this.outflowRegistry.outflows(tx, batchIds)) {
      outflows.get(o.batchId)?.push({ date: o.date, eggs: o.eggs });
    }
    return { production, outflows };
  }

  /** The eggs of each lot a sale dated `date` may still take (see `eggAvailable`); one query per source, whatever the lots. */
  async availableMany(
    tx: Tx,
    batchIds: string[],
    date: Date,
  ): Promise<Map<string, number>> {
    const { production, outflows } = await this.history(tx, batchIds);
    return new Map(
      batchIds.map((id) => [
        id,
        eggAvailable(production.get(id) ?? [], outflows.get(id) ?? [], date),
      ]),
    );
  }

  /**
   * 409 `Ce lot est clôturé` on a closed lot; 400 `Œufs disponibles insuffisants pour {code} ({n} disponibles)` when
   * selling `sales` (ALL the egg lines of the lot of one document) would
   * leave the lot's balance negative on any day. The document's own outflows
   * are not registered yet (an invoice counts only once issued, and the
   * caller checks before it writes).
   */
  async assertSale(
    tx: Tx,
    batch: { id: string; code: string },
    sales: EggOutflowDay[],
  ): Promise<void> {
    if (sales.length === 0) return;
    this.ledger.assertOpen(await this.ledger.lockBatch(tx, batch.id));
    const { production, outflows } = await this.history(tx, [batch.id]);
    const registered = outflows.get(batch.id) ?? [];
    const lot = production.get(batch.id) ?? [];
    if (!eggShortfall(lot, [...registered, ...sales])) return;
    const first = new Date(Math.min(...sales.map((s) => s.date.getTime())));
    throw new BadRequestException(
      notEnoughEggs(batch.code, eggAvailable(lot, registered, first)),
    );
  }

  /**
   * A return of eggs to the balance (a negative outflow of a credit note):
   * the lot is locked and must still be open (409 `Ce lot est clôturé`), like
   * every other change to a lot. Nothing else to check: a return only adds.
   */
  async assertReturn(tx: Tx, batchId: string): Promise<void> {
    this.ledger.assertOpen(await this.ledger.lockBatch(tx, batchId));
  }

  /**
   * 400 `EGGS_SOLD` when `next`, the lot's WHOLE marketable production after
   * a create, edit or delete of a record, would fall under what was sold on
   * any day. Called under the lot lock the production service takes.
   */
  async assertProduction(
    tx: Tx,
    batchId: string,
    next: EggProductionDay[],
  ): Promise<void> {
    await lockRow(tx, 'AnimalBatch', batchId);
    const { outflows } = await this.history(tx, [batchId]);
    if (eggShortfall(next, outflows.get(batchId) ?? [])) {
      throw new BadRequestException(EGGS_SOLD);
    }
  }
}
