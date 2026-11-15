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

/**
 * THE rule for every reader of what exits cost (feed, health, later sales): round each operation to the cent, then
 * sum per source. One query for all `sourceIds` of a `sourceType` (`FEED_DISTRIBUTION`, `HEALTH_ACT`...); the costs are
 * the ledger's CURRENT ones (a back-dated entry re-costs the exits). A source with no exit is absent from the map.
 */
export async function operationCosts(
  client: Prisma.TransactionClient | PrismaService,
  of: { sourceType: StockSourceType; sourceIds: string[] },
): Promise<Map<string, DecimalType>> {
  const result = new Map<string, DecimalType>();
  if (of.sourceIds.length === 0) return result;
  const exits = await client.stockMovement.findMany({
    // Exits only: a source may also write entries (a credit note returns goods), which are not a cost.
    where: {
      sourceType: of.sourceType,
      sourceId: { in: of.sourceIds },
      quantity: { lt: 0 },
    },
    select: {
      sourceId: true,
      operationId: true,
      quantity: true,
      unitCost: true,
    },
  });
  const operations = new Map<string, Map<string, ExitPiece[]>>();
  for (const e of exits) {
    const bySource =
      operations.get(e.sourceId ?? '') ?? new Map<string, ExitPiece[]>();
    bySource.set(e.operationId, [...(bySource.get(e.operationId) ?? []), e]);
    operations.set(e.sourceId ?? '', bySource);
  }
  for (const [sourceId, ops] of operations) {
    result.set(
      sourceId,
      [...ops.values()].reduce(
        (sum, pieces) => sum.add(operationCost(pieces)),
        new Decimal(0),
      ),
    );
  }
  return result;
}

/** What the exits of ONE source took of one article: the quantity (Σ |quantity|, every piece) and the cost (per-operation rounding, then summed). */
export interface ItemExitCost {
  quantity: DecimalType;
  cost: DecimalType;
}

/**
 * What the exits of ONE source (a sale) took of each article, read from the
 * ledger as it is NOW (a back-dated entry or an edit re-costs the exits, so
 * nothing is snapshotted): same rules as `operationCosts` (exits only, each
 * operation rounded to the cent, then summed). One query. An article the
 * source did not take is absent. A credit-note return divides `cost` by
 * `quantity` to get the average unit cost of the sale's exits of that article.
 */
export async function exitCostsByItem(
  client: Prisma.TransactionClient | PrismaService,
  of: { sourceType: StockSourceType; sourceId: string },
): Promise<Map<string, ItemExitCost>> {
  const exits = await client.stockMovement.findMany({
    where: {
      sourceType: of.sourceType,
      sourceId: of.sourceId,
      quantity: { lt: 0 },
    },
    select: {
      stockItemId: true,
      operationId: true,
      quantity: true,
      unitCost: true,
    },
  });
  const operations = new Map<string, Map<string, ExitPiece[]>>();
  for (const e of exits) {
    const byOperation =
      operations.get(e.stockItemId) ?? new Map<string, ExitPiece[]>();
    byOperation.set(e.operationId, [
      ...(byOperation.get(e.operationId) ?? []),
      e,
    ]);
    operations.set(e.stockItemId, byOperation);
  }
  const result = new Map<string, ItemExitCost>();
  for (const [itemId, ops] of operations) {
    const pieces = [...ops.values()];
    result.set(itemId, {
      quantity: pieces
        .flat()
        .reduce((sum, p) => sum.add(p.quantity.abs()), new Decimal(0)),
      cost: pieces.reduce(
        (sum, p) => sum.add(operationCost(p)),
        new Decimal(0),
      ),
    });
  }
  return result;
}
