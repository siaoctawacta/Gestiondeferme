import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { EggStockService } from '../eggs/egg-stock';
import type { Prisma } from '../generated/prisma/client';
import type { SaleLineKind } from '../generated/prisma/enums';
import { AnimalTargetRegistry } from '../herd/animal-target';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { WithdrawalRegistry } from '../herd/withdrawal';
import { AnimalSales } from '../pigs/animal-sales';
import { exitCostsByItem } from '../stock/operation-costs';
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

/** The distinct ids in ascending order: the order every lock is taken in. */
const ascending = (ids: (string | null)[]): string[] =>
  [...new Set(ids.filter((id): id is string => !!id))].sort();

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
   * then ONE stock reversal. Eggs need no write: their balance reads the
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
    await this.herd.removeBySource(tx, SOURCE, invoice.id, farmIds);
    await this.animals.unsell(tx, {
      type: SOURCE,
      id: invoice.id,
      label: invoice.number,
    });
    await this.stock.reverseBySource(tx, SOURCE, invoice.id, farmIds);
  }

  /**
   * Puts the goods of a credit note with return back, at the credit note's
   * date, in the same order of locks as `apply`: the lots (LOT and OEUFS
   * lines, `lockBatches`, ascending id) -> the egg lots checked open
   * (`assertReturn`: a closed lot is a 409) -> the herd events (an `ENTREE`
   * `Retour client`, source `CREDIT_NOTE`; the ledger refuses a closed lot and
   * a full building) -> ONE stock-ledger call last. ANIMAL lines are refused
   * by the caller before any lock, SERVICE lines have nothing to return, eggs
   * need no write (the credit note's lines are counted as negative outflow by
   * `SaleEggOutflows`, the caller having stored them first).
   *
   * Each returned ARTICLE comes back as an `ENTREE` of reason `RETOUR` into a
   * NEW batch carrying the lot number and expiry of the first piece the sale
   * took, at the average unit cost of the sale's exits of that article as the
   * ledger holds them NOW (`exitCostsByItem`: nothing is snapshotted); two
   * lines of one article make one movement.
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
    // 3. herd events
    for (const l of lotLines) {
      await this.herd.record(tx, {
        farmId: note.farmId,
        batchId: l.batchId as string,
        date: note.date,
        type: 'ENTREE',
        quantity: l.quantity.toNumber(),
        cause: 'Retour client',
        note: `Avoir ${note.number}`,
        sourceType: RETURN_SOURCE,
        sourceId: note.id,
        userId: ctx.user.id,
      });
    }
    // 4. ONE stock-ledger call
    if (itemLines.length === 0) return;
    const quantities = new Map<string, Decimal>();
    for (const l of itemLines) {
      const id = l.stockItemId as string;
      quantities.set(
        id,
        (quantities.get(id) ?? new Decimal(0)).add(l.quantity),
      );
    }
    const itemIds = [...quantities.keys()].sort();
    const costs = await exitCostsByItem(tx, {
      sourceType: SOURCE,
      sourceId: note.invoiceId,
    });
    const pieces = await tx.stockMovement.findMany({
      where: {
        sourceType: SOURCE,
        sourceId: note.invoiceId,
        stockItemId: { in: itemIds },
        quantity: { lt: 0 },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        stockItemId: true,
        stockBatch: { select: { lotNumber: true, expiryDate: true } },
      },
    });
    const inputs: RecordInput[] = [];
    for (const itemId of itemIds) {
      const cost = costs.get(itemId);
      if (!cost || cost.quantity.lte(0)) {
        throw new ConflictException(
          'Le coût de sortie de cet article est introuvable',
        );
      }
      const first = pieces.find((p) => p.stockItemId === itemId)?.stockBatch;
      const batch = first
        ? await this.stock.createBatch(tx, {
            farmId: note.farmId,
            stockItemId: itemId,
            lotNumber: first.lotNumber,
            expiryDate: first.expiryDate,
            receivedDate: note.date,
          })
        : null;
      inputs.push({
        farmId: note.farmId,
        stockItemId: itemId,
        date: note.date,
        type: 'ENTREE',
        quantity: quantities.get(itemId) as Decimal,
        unitCost: cost.cost.div(cost.quantity).toDecimalPlaces(2),
        reason: 'RETOUR',
        stockBatchId: batch?.id ?? null,
        sourceType: RETURN_SOURCE,
        sourceId: note.id,
        note: `Avoir ${note.number}`,
        userId: ctx.user.id,
      });
    }
    await this.stock.recordMany(tx, inputs);
  }
}
