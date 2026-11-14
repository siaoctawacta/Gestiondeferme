import type { Prisma } from '../generated/prisma/client';
import type { BatchType } from '../generated/prisma/enums';

/** Code prefix per batch type; `yearly` prefixes restart their numbering each year. */
const PREFIX: Record<BatchType, { text: string; yearly: boolean }> = {
  CHAIR: { text: 'LC', yearly: true },
  PONDEUSE: { text: 'LP', yearly: true },
  POUSSIN: { text: 'LS', yearly: true },
  REPRODUCTEUR: { text: 'LR', yearly: true },
  PORCELET: { text: 'PO', yearly: true },
  ENGRAISSEMENT: { text: 'LOT-ENG', yearly: false },
};

/**
 * Next free code for the farm: `LC-2026-01`, `PO-2026-01`, `LOT-ENG-01`...
 * The numbering is per farm (and per year of the entry date where the code has
 * one). A transaction-scoped advisory lock makes two concurrent creations
 * wait for each other, so they never pick the same number; it is released
 * with the caller's transaction.
 */
export async function nextBatchCode(
  tx: Prisma.TransactionClient,
  farmId: string,
  type: BatchType,
  entryDate: Date,
): Promise<string> {
  const { text, yearly } = PREFIX[type];
  const prefix = yearly ? `${text}-${entryDate.getUTCFullYear()}-` : `${text}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`batch-code:${farmId}:${prefix}`}, 0))`;
  const rows = await tx.animalBatch.findMany({
    where: { farmId, code: { startsWith: prefix } },
    select: { code: true },
  });
  let max = 0;
  for (const { code } of rows) {
    const rest = code.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}
