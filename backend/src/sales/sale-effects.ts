import { BadRequestException, Injectable } from '@nestjs/common';
import type { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { EggStockService } from '../eggs/egg-stock';
import type { Prisma } from '../generated/prisma/client';
import type { SaleLineKind } from '../generated/prisma/enums';
import { AnimalTargetRegistry } from '../herd/animal-target';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { WithdrawalRegistry } from '../herd/withdrawal';
import { AnimalSales } from '../pigs/animal-sales';
import {
  StockLedgerService,
  type RecordInput,
} from '../stock/stock-ledger.service';
import { eggsOf } from './sale-lines';

type Tx = Prisma.TransactionClient;

const ANIMAL_INVALID = 'Animal invalide pour cette ferme';

/** What the effects of an invoice need of it: its date, its number and its lines with the names of their sources. */
export interface EffectInvoice {
  id: string;
  farmId: string;
  /** The `FA-NNNN` number: written on the animals it sells. */
  number: string;
  date: Date;
  lines: {
    id: string;
    kind: SaleLineKind;
    batchId: string | null;
    animalId: string | null;
    stockItemId: string | null;
    quantity: Decimal;
    eggsPerUnit: number | null;
    batch: { code: string } | null;
    animal: { tag: string } | null;
  }[];
}

const SOURCE = 'SALE';

const ascending = (ids: (string | null)[]): string[] => [
  ...new Set(ids.filter((id): id is string => !!id)),
];

/**
 * THE only file of `sales` that calls a ledger or a seam: it turns the lines
 * of an invoice into effects, and takes them back. Everything it writes
 * carries the source `SALE` / the invoice id, so cancelling removes exactly
 * what issuing wrote.
 *
 * Lock order (binding, the caller already holds the invoice row and, at
 * issue, the counter row): lots (`lockBatches`, ascending id, egg lots
 * included) -> animals (`lockAnimal`, ascending id) -> the withdrawal guard
 * (reads only) -> herd events -> egg balance check -> animal sales -> ONE
 * stock-ledger call, last. Nothing is written when a step refuses: the caller
 * runs it in one transaction.
 */
@Injectable()
export class SaleEffects {
  constructor(
    private readonly herd: HerdLedgerService,
    private readonly eggs: EggStockService,
    private readonly animals: AnimalSales,
    private readonly stock: StockLedgerService,
    private readonly withdrawals: WithdrawalRegistry,
    private readonly targets: AnimalTargetRegistry,
  ) {}

  /**
   * Issues the effects of the invoice. Returns the cost per unit of each
   * ARTICLE line's stock exit as the ledger valued it (by line id).
   */
  async apply(
    tx: Tx,
    ctx: RequestContext,
    invoice: EffectInvoice,
  ): Promise<Map<string, Decimal>> {
    const farmIds = [invoice.farmId];
    const lotLines = invoice.lines.filter((l) => l.kind === 'LOT');
    const eggLines = invoice.lines.filter((l) => l.kind === 'OEUFS');
    const animalLines = invoice.lines.filter((l) => l.kind === 'ANIMAL');
    const itemLines = invoice.lines.filter((l) => l.kind === 'ARTICLE');

    // 1. lots, ascending id (egg lots included)
    const batches = await this.herd.lockBatches(
      tx,
      ascending([...lotLines, ...eggLines].map((l) => l.batchId)),
      farmIds,
    );
    // 2. animals, ascending id
    for (const id of ascending(animalLines.map((l) => l.animalId)).sort()) {
      const animal = await this.targets.single().lockAnimal(tx, id, farmIds);
      if (!animal) throw new BadRequestException(ANIMAL_INVALID);
    }
    for (const batch of batches) {
      if (eggLines.some((l) => l.batchId === batch.id)) {
        this.herd.assertOpen(batch);
      }
    }
    // 3. the withdrawal guard on every lot, egg lot and animal, before any effect
    for (const batch of batches) {
      await this.withdrawals.assertClear(
        { batchId: batch.id, code: batch.code },
        invoice.date,
        tx,
      );
    }
    for (const l of animalLines) {
      await this.withdrawals.assertClear(
        { animalId: l.animalId as string, tag: l.animal?.tag ?? '' },
        invoice.date,
        tx,
      );
    }
    // 4. herd events
    for (const l of lotLines) {
      await this.herd.record(tx, {
        farmId: invoice.farmId,
        batchId: l.batchId as string,
        date: invoice.date,
        type: 'VENTE',
        quantity: l.quantity.toNumber(),
        note: `Facture ${invoice.number}`,
        sourceType: SOURCE,
        sourceId: invoice.id,
        userId: ctx.user.id,
      });
    }
    // 5. the egg balance, all the egg lines of one lot at once
    for (const batch of batches) {
      const sales = eggLines
        .filter((l) => l.batchId === batch.id)
        .map((l) => ({
          date: invoice.date,
          eggs: eggsOf({
            quantity: l.quantity.toNumber(),
            eggsPerUnit: l.eggsPerUnit ?? 0,
          }),
        }));
      await this.eggs.assertSale(tx, batch, sales);
    }
    // 6. animals
    for (const l of animalLines) {
      await this.animals.sell(
        tx,
        l.animalId as string,
        invoice.date,
        { type: SOURCE, id: invoice.id, label: invoice.number },
        { farmIds },
      );
    }
    // 7. ONE stock-ledger call
    const costs = new Map<string, Decimal>();
    if (itemLines.length > 0) {
      const inputs: RecordInput[] = itemLines.map((l) => ({
        farmId: invoice.farmId,
        stockItemId: l.stockItemId as string,
        date: invoice.date,
        type: 'SORTIE',
        quantity: l.quantity.neg(),
        reason: 'VENTE',
        sourceType: SOURCE,
        sourceId: invoice.id,
        userId: ctx.user.id,
      }));
      const results = await this.stock.recordMany(tx, inputs);
      itemLines.forEach((l, i) => costs.set(l.id, results[i].unitCost));
    }
    return costs;
  }

  /**
   * Takes back what `apply` wrote, in the same order of locks: the herd events
   * (lots ascending), the animals (ascending), then ONE stock reversal.
   * Eggs need nothing: their balance reads the invoices that count. A refusal
   * (closed lot, an animal no longer as it was left, a validated inventory, a
   * later exit that would go negative) aborts the whole cancellation.
   */
  async reverse(
    tx: Tx,
    invoice: Pick<EffectInvoice, 'id' | 'farmId' | 'number'>,
  ): Promise<void> {
    const farmIds = [invoice.farmId];
    await this.herd.removeBySource(tx, SOURCE, invoice.id, farmIds);
    await this.animals.unsell(tx, {
      type: SOURCE,
      id: invoice.id,
      label: invoice.number,
    });
    await this.stock.reverseBySource(tx, SOURCE, invoice.id, farmIds);
  }
}
