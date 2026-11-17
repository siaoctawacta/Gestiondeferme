import { Prisma } from '../generated/prisma/client';

/** Tables whose rows are locked by hand; a closed union, never user input. */
export type LockableTable =
  | 'AnimalBatch'
  | 'Animal'
  | 'BreedingRecord'
  | 'Incubation'
  | 'Building'
  | 'FarmStockItem'
  | 'FeedProduct'
  | 'FeedDistribution'
  | 'FeedFormula'
  | 'InventorySession'
  | 'Purchase'
  | 'Quote'
  | 'Invoice'
  | 'FinanceEntry'
  | 'HealthAct'
  | 'Quarantine'
  | 'HealthIncident'
  | 'BiosecurityLog'
  | 'VaccinationPlan'
  | 'Employee'
  | 'Attendance';

const TABLE: Record<LockableTable, Prisma.Sql> = {
  AnimalBatch: Prisma.raw('"AnimalBatch"'),
  Animal: Prisma.raw('"Animal"'),
  BreedingRecord: Prisma.raw('"BreedingRecord"'),
  Incubation: Prisma.raw('"Incubation"'),
  Building: Prisma.raw('"Building"'),
  FarmStockItem: Prisma.raw('"FarmStockItem"'),
  FeedProduct: Prisma.raw('"FeedProduct"'),
  FeedDistribution: Prisma.raw('"FeedDistribution"'),
  FeedFormula: Prisma.raw('"FeedFormula"'),
  InventorySession: Prisma.raw('"InventorySession"'),
  Purchase: Prisma.raw('"Purchase"'),
  Quote: Prisma.raw('"Quote"'),
  Invoice: Prisma.raw('"Invoice"'),
  FinanceEntry: Prisma.raw('"FinanceEntry"'),
  HealthAct: Prisma.raw('"HealthAct"'),
  Quarantine: Prisma.raw('"Quarantine"'),
  HealthIncident: Prisma.raw('"HealthIncident"'),
  BiosecurityLog: Prisma.raw('"BiosecurityLog"'),
  VaccinationPlan: Prisma.raw('"VaccinationPlan"'),
  Employee: Prisma.raw('"Employee"'),
  Attendance: Prisma.raw('"Attendance"'),
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
