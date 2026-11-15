import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';

type Money = Decimal;

/** `quantityKg × unitCost`, rounded to 2 decimals (half up). */
export const lineCost = (
  quantityKg: Decimal | number | string,
  unitCost: Decimal | number | string,
): Money => new Decimal(quantityKg).mul(unitCost).toDecimalPlaces(2);

/** `Σ percentage × product.unitCost / 100`, rounded to 2 decimals (half up). */
export function formulaCostPerKg(
  items: {
    percentage: Decimal;
    feedProduct: { unitCost: Decimal };
  }[],
): Money {
  return items
    .reduce(
      (sum, i) => sum.add(i.percentage.mul(i.feedProduct.unitCost)),
      new Decimal(0),
    )
    .div(100)
    .toDecimalPlaces(2);
}

/** The largest cost the `cost` column (14 digits, 2 decimals) can hold, exclusive. */
const COST_LIMIT = new Decimal('1000000000000');

/** Refuses (400) a cost the column cannot hold, instead of a database overflow (500). */
export function assertCostFits(cost: Decimal): void {
  if (cost.abs().gte(COST_LIMIT)) {
    throw new BadRequestException(
      'Le coût de la distribution est trop élevé : réduisez la quantité',
    );
  }
}

/** What a distribution row and its ledger exits need to give its current cost. */
export interface CostRow {
  id: string;
  quantityKg: Decimal;
  /** Snapshot written at entry. */
  unitCost: Decimal;
  /** Snapshot written at entry. */
  cost: Decimal;
  unlinkedCost: Decimal;
}

export interface Exit {
  sourceId: string | null;
  operationId: string;
  quantity: Decimal;
  unitCost: Decimal;
}

/**
 * The current cost of a distribution: what the ledger values its exits at now
 * (each exit of an ingredient rounded to 2 decimals, as the ledger reports it)
 * plus the part the ledger does not value. A distribution with no exit (an
 * unlinked feed) shows the snapshot written at entry. `unitCost` is
 * `cost / quantityKg` when stock is involved, else the snapshot.
 */
export function currentCost(
  row: CostRow,
  exits: Exit[],
): { cost: Decimal; unitCost: Decimal } {
  if (exits.length === 0) return { cost: row.cost, unitCost: row.unitCost };
  const perOperation = new Map<string, Decimal>();
  for (const e of exits) {
    perOperation.set(
      e.operationId,
      (perOperation.get(e.operationId) ?? new Decimal(0)).add(
        e.quantity.abs().mul(e.unitCost),
      ),
    );
  }
  const ledger = [...perOperation.values()].reduce(
    (sum, c) => sum.add(c.toDecimalPlaces(2)),
    new Decimal(0),
  );
  const cost = ledger.add(row.unlinkedCost).toDecimalPlaces(2);
  return { cost, unitCost: cost.div(row.quantityKg).toDecimalPlaces(2) };
}
