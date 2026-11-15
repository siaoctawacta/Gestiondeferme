import { nextNumberedCode } from '../common/next-code';
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
  return nextNumberedCode(tx, {
    lockKey: `batch-code:${farmId}:${prefix}`,
    prefix,
    width: 2,
    existing: async () =>
      (
        await tx.animalBatch.findMany({
          where: { farmId, code: { startsWith: prefix } },
          select: { code: true },
        })
      ).map((r) => r.code),
  });
}
