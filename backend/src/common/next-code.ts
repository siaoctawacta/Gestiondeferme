import type { Prisma } from '../generated/prisma/client';

/**
 * Next free number of a `prefix` + number code (`LC-2026-01`, `TR-001`,
 * `INC-2026-01`): one more than the highest number already used after the
 * prefix. A transaction-scoped advisory lock keyed on `lockKey` makes two
 * concurrent creations wait for each other, so they never pick the same
 * number; it is released with the caller's transaction.
 *
 * `existing` lists the codes that start with `prefix` (already scoped to the
 * farm by the caller).
 */
export async function nextNumberedCode(
  tx: Prisma.TransactionClient,
  opts: {
    lockKey: string;
    prefix: string;
    width: number;
    existing: () => Promise<string[]>;
  },
): Promise<string> {
  const { lockKey, prefix, width, existing } = opts;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  let max = 0;
  for (const code of await existing()) {
    const rest = code.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}
