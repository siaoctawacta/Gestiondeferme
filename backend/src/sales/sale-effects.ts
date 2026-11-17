import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { ascending } from '../common/ascending';
import { EggStockService } from '../eggs/egg-stock';
import type { Prisma } from '../generated/prisma/client';
import type { SaleLineKind } from '../generated/prisma/enums';
import { AnimalTargetRegistry } from '../herd/animal-target';
import { EVENT_SIGN, HerdLedgerService } from '../herd/herd-ledger.service';
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

/** What the return of a credit note needs of it: its date and number and what each credited line takes back. */
export interface ReturnNote {
  id: string;
  farmId: string;
  /** The invoice credited: its SALE exits say what the returned articles cost. */
  invoiceId: string;
  /** The `AV-NNNN` number: written on the events and movements it makes. */
  number: string;
  date: Date;
  lines: {
    kind: SaleLineKind;
    batchId: string | null;
    stockItemId: string | null;
    /** What this credit note takes back of the line. */
    quantity: Decimal;
  }[];
}

const SOURCE = 'SALE';
const RETURN_SOURCE = 'CREDIT_NOTE';

/** The quantity of each lot over its LOT lines, in ascending lot id: two lines of one lot make ONE herd event. */
const quantityByLot = (
  lines: { batchId: string | null; quantity: Decimal }[],
): { batchId: string; quantity: Decimal }[] => {
  const sums = new Map<string, Decimal>();
  for (const l of lines) {
    const id = l.batchId as string;
    sums.set(id, (sums.get(id) ?? new Decimal(0)).add(l.quantity));
  }
  return ascending([...sums.keys()]).map((batchId) => ({
    batchId,
    quantity: sums.get(batchId) as Decimal,
  }));
};

/**
 * THE only file of `sales` that calls a ledger or a seam: it turns the lines
 * of an invoice into effects, and takes them back. Everything it writes
 * carries the source `SALE` / the invoice id, so cancelling removes exactly
 * what issuing wrote.
 *
 * Lock order (binding for every path of this class; the caller already holds
 * the document row and, when it takes one, the counter row): lots
 * (`lockBatches`, ascending id, egg lots included) -> animals (`lockAnimal` /
 * `unsell`, ascending id) -> buildings (`assertCapacities`, ascending id, once
 * per building, only where animals come back: a return, a cancellation) ->
 * ONE stock-ledger call, last. The withdrawal guard, the herd events (written
 * with their capacity check deferred) and the egg balance only read or write
 * rows already locked. Breeding follows it too: its weaning takes the litter
 * lot before the sow. Nothing is written when a step refuses: the caller runs
 * it in one transaction.
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
   * Issues the effects of the invoice. What an exit costs is the ledger's to
   * say (read it back with `exitCostsByItem`): nothing is kept here.
   */
  async apply(
    tx: Tx,
    ctx: RequestContext,
    invoice: EffectInvoice,
  ): Promise<void> {
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
    for (const id of ascending(animalLines.map((l) => l.animalId))) {
      const animal = await this.targets.single().lockAnimal(tx, id, farmIds);
      if (!animal) throw new BadRequestException(ANIMAL_INVALID);
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
    // 4. herd events: one per lot, whatever the number of lines naming it
    for (const l of quantityByLot(lotLines)) {
      await this.herd.record(tx, {
        farmId: invoice.farmId,
        batchId: l.batchId,
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
      await this.stock.recordMany(tx, inputs);
    }
  }

  /**
   * Takes back what `apply` wrote, in the same order of locks: ALL the lots of
   * the invoice (LOT and OEUFS lines, ascending), a closed egg lot refused by
   * the egg seam (`assertReturn`), the herd events, the animals (ascending),
   * the buildings they go back to (ascending, once each), then ONE stock
   * reversal. Eggs need no write: their balance reads the
   * invoices that count. A refusal (closed lot, an animal no longer as it was
   * left, a building that is full, a validated inventory, a later exit that
   * would go negative) aborts the whole cancellation.
   */
  async reverse(
    tx: Tx,
    invoice: Pick<EffectInvoice, 'id' | 'farmId' | 'number'> & {
      lines: Pick<EffectInvoice['lines'][number], 'kind' | 'batchId'>[];
    },
  ): Promise<void> {
    const farmIds = [invoice.farmId];
    const batches = await this.herd.lockBatches(
      tx,
      ascending(
        invoice.lines
          .filter((l) => l.kind === 'LOT' || l.kind === 'OEUFS')
          .map((l) => l.batchId),
      ),
      farmIds,
    );
    for (const batch of batches) {
      if (
        invoice.lines.some((l) => l.kind === 'OEUFS' && l.batchId === batch.id)
      ) {
        await this.eggs.assertReturn(tx, batch.id);
      }
    }
    // the herd events and the animals go back; the capacity of the buildings
    // they return to is checked once, ascending, after every lot and animal lock
    const removed = await this.herd.removeBySource(
      tx,
      SOURCE,
      invoice.id,
      farmIds,
      { deferCapacity: true },
    );
    const animalBuildings = await this.animals.unsell(
      tx,
      { type: SOURCE, id: invoice.id, label: invoice.number },
      { deferCapacity: true },
    );
    const lotBuildings = batches
      .filter((b) =>
        removed.some((e) => e.batchId === b.id && EVENT_SIGN[e.type] < 0),
      )
      .map((b) => b.buildingId);
    await this.herd.assertCapacities(tx, invoice.farmId, [
      ...lotBuildings,
      ...animalBuildings,
    ]);
    await this.stock.reverseBySource(tx, SOURCE, invoice.id, farmIds);
  }

  /**
   * Puts the goods of a credit note with return back, at the credit note's
   * date, in the same order of locks as `apply`: the lots (LOT and OEUFS
   * lines, `lockBatches`, ascending id) -> the egg lots checked open
   * (`assertReturn`: a closed lot is a 409) -> the herd events (one `ENTREE`
   * `Retour client` per lot, source `CREDIT_NOTE`; the ledger refuses a closed
   * lot) -> the capacity of the lots' buildings (`assertCapacities`, ascending
   * id, once each: a full building is a 400) -> ONE stock-ledger call last. ANIMAL lines are refused
   * by the caller before any lock, SERVICE lines have nothing to return, eggs
   * need no write (the credit note's lines are counted as negative outflow by
   * `SaleEggOutflows`, the caller having stored them first).
   *
   * The returned ARTICLES are the stock ledger's to take back
   * (`StockLedgerService.returnBySource`): one `ENTREE` of reason `RETOUR` per
   * article into a new lot, at the average cost of the sale's exits read UNDER
   * the stock locks, refused (400 `Retour impossible`) for an expired lot or
   * an inactive article. Nothing of the stock tables is read here.
   */
  async applyReturn(
    tx: Tx,
    ctx: RequestContext,
    note: ReturnNote,
  ): Promise<void> {
    const farmIds = [note.farmId];
    const lotLines = note.lines.filter((l) => l.kind === 'LOT');
    const eggLines = note.lines.filter((l) => l.kind === 'OEUFS');
    const itemLines = note.lines.filter((l) => l.kind === 'ARTICLE');

    // 1. lots, ascending id (egg lots included)
    const batches = await this.herd.lockBatches(
      tx,
      ascending([...lotLines, ...eggLines].map((l) => l.batchId)),
      farmIds,
    );
    // 2. the egg lots must still be open
    for (const batch of batches) {
      if (eggLines.some((l) => l.batchId === batch.id)) {
        await this.eggs.assertReturn(tx, batch.id);
      }
    }
    // 3. herd events, one per lot; the capacity checks come once, ascending, below
    for (const l of quantityByLot(lotLines)) {
      await this.herd.record(tx, {
        farmId: note.farmId,
        batchId: l.batchId,
        date: note.date,
        type: 'ENTREE',
        quantity: l.quantity.toNumber(),
        cause: 'Retour client',
        note: `Avoir ${note.number}`,
        sourceType: RETURN_SOURCE,
        sourceId: note.id,
        userId: ctx.user.id,
        deferCapacity: true,
      });
    }
    // 4. the buildings the lots live in, ascending
    await this.herd.assertCapacities(
      tx,
      note.farmId,
      batches
        .filter((b) => lotLines.some((l) => l.batchId === b.id))
        .map((b) => b.buildingId),
    );
    // 5. ONE stock-ledger call: the ledger reads the sale's costs under its own locks
    if (itemLines.length === 0) return;
    await this.stock.returnBySource(tx, {
      farmId: note.farmId,
      sale: { sourceType: SOURCE, sourceId: note.invoiceId },
      credit: { sourceType: RETURN_SOURCE, sourceId: note.id },
      date: note.date,
      userId: ctx.user.id,
      note: `Avoir ${note.number}`,
      items: itemLines.map((l) => ({
        stockItemId: l.stockItemId as string,
        quantity: l.quantity,
      })),
    });
  }
}
