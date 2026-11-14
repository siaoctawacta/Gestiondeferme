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
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`animal-tag:${farmId}:${prefix}`}, 0))`;
  const rows = await tx.animal.findMany({
    where: { farmId, tag: { startsWith: prefix } },
    select: { tag: true },
  });
  let max = 0;
  for (const { tag } of rows) {
    const rest = tag.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
