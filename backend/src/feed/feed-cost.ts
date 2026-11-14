import { Prisma } from '../generated/prisma/client';

type Money = Prisma.Decimal;

/** `quantityKg × unitCost`, rounded to 2 decimals (half up). */
export const lineCost = (
  quantityKg: Prisma.Decimal | number | string,
  unitCost: Prisma.Decimal | number | string,
): Money => new Prisma.Decimal(quantityKg).mul(unitCost).toDecimalPlaces(2);

/** `Σ percentage × product.unitCost / 100`, rounded to 2 decimals (half up). */
export function formulaCostPerKg(
  items: {
    percentage: Prisma.Decimal;
    feedProduct: { unitCost: Prisma.Decimal };
  }[],
): Money {
  return items
    .reduce(
      (sum, i) => sum.add(i.percentage.mul(i.feedProduct.unitCost)),
      new Prisma.Decimal(0),
    )
    .div(100)
    .toDecimalPlaces(2);
}
