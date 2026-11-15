import { Prisma } from '../generated/prisma/client';

/** Tables whose rows are locked by hand; a closed union, never user input. */
export type LockableTable =
  | 'AnimalBatch'
  | 'Animal'
  | 'BreedingRecord'
  | 'Incubation'
  | 'Building'
  | 'FarmStockItem'
  | 'InventorySession';

const TABLE: Record<LockableTable, Prisma.Sql> = {
  AnimalBatch: Prisma.raw('"AnimalBatch"'),
  Animal: Prisma.raw('"Animal"'),
  BreedingRecord: Prisma.raw('"BreedingRecord"'),
  Incubation: Prisma.raw('"Incubation"'),
  Building: Prisma.raw('"Building"'),
  FarmStockItem: Prisma.raw('"FarmStockItem"'),
  InventorySession: Prisma.raw('"InventorySession"'),
};

/**
 * `SELECT ... FOR NO KEY UPDATE` on one row: serialises writers of that row
 * against each other, but not against the FOR KEY SHARE lock a referencing
 * insert takes, so a caller that inserted a child row first cannot deadlock.
 * `farmIds` makes the farm scope part of the locking query: another farm's row
 * is never locked (the caller then finds nothing and answers 404).
 */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: LockableTable,
  id: string,
  farmIds?: string[],
): Promise<void> {
  const scope = farmIds
    ? Prisma.sql` AND "farmId" = ANY(${farmIds}::text[])`
    : Prisma.empty;
  await tx.$queryRaw`SELECT id FROM ${TABLE[table]} WHERE id = ${id}${scope} FOR NO KEY UPDATE`;
}
