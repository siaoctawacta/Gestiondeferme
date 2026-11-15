import { nextNumberedCode } from '../common/next-code';
import type { Prisma } from '../generated/prisma/client';
import type { AnimalCategory } from '../generated/prisma/enums';

const PREFIX: Record<AnimalCategory, string> = {
  TRUIE: 'TR',
  VERRAT: 'VR',
  COCHETTE: 'CO',
};

/**
 * Next free tag for the farm: `TR-001`, `VR-001`, `CO-001`...
 * A transaction-scoped advisory lock makes two concurrent creations wait for
 * each other, so they never pick the same number; it is released with the
 * caller's transaction.
 */
export async function nextAnimalTag(
  tx: Prisma.TransactionClient,
  farmId: string,
  category: AnimalCategory,
): Promise<string> {
  const prefix = `${PREFIX[category]}-`;
  return nextNumberedCode(tx, {
    lockKey: `animal-tag:${farmId}:${prefix}`,
    prefix,
    width: 3,
    existing: async () =>
      (
        await tx.animal.findMany({
          where: { farmId, tag: { startsWith: prefix } },
          select: { tag: true },
        })
      ).map((r) => r.tag),
  });
}
