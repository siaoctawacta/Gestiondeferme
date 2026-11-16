import type { Decimal as DecimalType } from '@prisma/client/runtime/client';
import { Decimal } from '@prisma/client/runtime/client';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StockSourceType } from './stock-ledger.service';

/** One exit of the ledger as stored (a FEFO exit may be split across lots: several pieces, one operation). */
export interface ExitPiece {
  operationId: string;
  quantity: DecimalType;
  unitCost: DecimalType;
}

/**
 * The cost of ONE ledger operation as the ledger reports it (`RecordResult.cost`): Σ |quantity| × unitCost over its
 * pieces, rounded to 2 decimals (half up).
 */
export const operationCost = (pieces: ExitPiece[]): DecimalType =>
  pieces
    .reduce(
      (sum, p) => sum.add(p.quantity.abs().mul(p.unitCost)),
      new Decimal(0),
    )
    .toDecimalPlaces(2);

/** One stored exit, with what it belongs to. */
interface ExitRow extends ExitPiece {
  sourceId: string | null;
  stockItemId: string;
}

/**
 * The exits (quantity < 0) one source, or several of one type, wrote: the ONE
 * query behind `operationCosts` and `exitCostsByItem`. Exits only: a source may
 * also write entries (a credit note returns goods), which are not a cost.
 */
async function exitRows(
  client: Prisma.TransactionClient | PrismaService,
  sourceType: StockSourceType,
  sourceId: string | { in: string[] },
): Promise<ExitRow[]> {
  return client.stockMovement.findMany({
    where: { sourceType, sourceId, quantity: { lt: 0 } },
    select: {
      sourceId: true,
      stockItemId: true,
      operationId: true,
      quantity: true,
      unitCost: true,
    },
  });
}

/**
 * The exits grouped by `key`, then by operation (a FEFO exit split over lots is
 * several pieces of ONE operation): per key, the pieces of each operation.
 */
function operationsBy(
  rows: ExitRow[],
  key: (row: ExitRow) => string,
): Map<string, ExitPiece[][]> {
  const grouped = new Map<string, Map<string, ExitPiece[]>>();
  for (const row of rows) {
    const k = key(row);
    const operations = grouped.get(k) ?? new Map<string, ExitPiece[]>();
    const pieces = operations.get(row.operationId) ?? [];
    pieces.push(row);
    operations.set(row.operationId, pieces);
    grouped.set(k, operations);
  }
  return new Map([...grouped].map(([k, ops]) => [k, [...ops.values()]]));
}

const costOf = (operations: ExitPiece[][]): DecimalType =>
  operations.reduce((sum, p) => sum.add(operationCost(p)), new Decimal(0));

/**
 * THE rule for every reader of what exits cost (feed, health, sales): round each operation to the cent, then
 * sum per source. One query for all `sourceIds` of a `sourceType` (`FEED_DISTRIBUTION`, `HEALTH_ACT`...); the costs are
 * the ledger's CURRENT ones (a back-dated entry re-costs the exits). A source with no exit is absent from the map.
 * The ids are the caller's own documents: nothing here is scoped to a farm.
 */
export async function operationCosts(
  client: Prisma.TransactionClient | PrismaService,
  of: { sourceType: StockSourceType; sourceIds: string[] },
): Promise<Map<string, DecimalType>> {
  if (of.sourceIds.length === 0) return new Map();
  const rows = await exitRows(client, of.sourceType, { in: of.sourceIds });
  return new Map(
    [...operationsBy(rows, (r) => r.sourceId ?? '')].map(([id, ops]) => [
      id,
      costOf(ops),
    ]),
  );
}

/** What the exits of ONE source took of one article: the quantity (Σ |quantity|, every piece) and the cost (per-operation rounding, then summed). */
export interface ItemExitCost {
  quantity: DecimalType;
  cost: DecimalType;
}

/**
 * What the exits of ONE source (a sale) took of each article, read from the
 * ledger as it is NOW (a back-dated entry or an edit re-costs the exits, so
 * nothing is snapshotted): same rules as `operationCosts` (the same query and
 * grouping, per article). One query. An article the source did not take is
 * absent. A credit-note return divides `cost` by `quantity` to get the average
 * unit cost of the sale's exits of that article. NO FARM SCOPE: `sourceId` is
 * the id of a document the caller already holds under its row lock (an
 * invoice), never an id taken from a request.
 */
export async function exitCostsByItem(
  client: Prisma.TransactionClient | PrismaService,
  of: { sourceType: StockSourceType; sourceId: string },
): Promise<Map<string, ItemExitCost>> {
  const rows = await exitRows(client, of.sourceType, of.sourceId);
  return new Map(
    [...operationsBy(rows, (r) => r.stockItemId)].map(([itemId, ops]) => [
      itemId,
      {
        quantity: ops
          .flat()
          .reduce((sum, p) => sum.add(p.quantity.abs()), new Decimal(0)),
        cost: costOf(ops),
      },
    ]),
  );
}

/** The lot a sale's FIRST exit piece took of each article, in the order FEFO draws lots: expiry (none last), received date, id. */
export interface SoldLot {
  lotNumber: string | null;
  expiryDate: Date | null;
}

/**
 * Where the goods of a return belong: the lot (number and expiry) of the FIRST
 * piece the source's exits took of each article, FEFO order (expiry, then
 * received date, then id) so the answer does not depend on when rows were
 * written. An article whose first piece sat in no lot maps to null; an article
 * the source did not take is absent. One query.
 */
export async function firstSoldLots(
  client: Prisma.TransactionClient | PrismaService,
  of: { sourceType: StockSourceType; sourceId: string; stockItemIds: string[] },
): Promise<Map<string, SoldLot | null>> {
  const pieces = await client.stockMovement.findMany({
    where: {
      sourceType: of.sourceType,
      sourceId: of.sourceId,
      stockItemId: { in: of.stockItemIds },
      quantity: { lt: 0 },
    },
    select: {
      stockItemId: true,
      stockBatch: {
        select: {
          id: true,
          lotNumber: true,
          expiryDate: true,
          receivedDate: true,
        },
      },
    },
  });
  const rank = (
    b: (typeof pieces)[number]['stockBatch'],
  ): [number, number, string] =>
    b
      ? [b.expiryDate?.getTime() ?? Infinity, b.receivedDate.getTime(), b.id]
      : [Infinity, Infinity, '￿'];
  const first = new Map<string, (typeof pieces)[number]['stockBatch']>();
  for (const p of pieces) {
    const known = first.get(p.stockItemId);
    if (known === undefined) {
      first.set(p.stockItemId, p.stockBatch);
      continue;
    }
    const [a, b] = [rank(p.stockBatch), rank(known)];
    if (
      a[0] - b[0] < 0 ||
      (a[0] === b[0] && (a[1] - b[1] < 0 || (a[1] === b[1] && a[2] < b[2])))
    ) {
      first.set(p.stockItemId, p.stockBatch);
    }
  }
  return new Map(
    [...first].map(([id, b]) => [
      id,
      b ? { lotNumber: b.lotNumber, expiryDate: b.expiryDate } : null,
    ]),
  );
}
