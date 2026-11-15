import type { Prisma } from '../generated/prisma/client';

export type NumberKind = 'DA' | 'BC';

type Tx = Prisma.TransactionClient;

/** The highest number the organisation already holds for `kind` (0 when none), to start a counter after it. */
async function highest(
  tx: Tx,
  organizationId: string,
  kind: NumberKind,
): Promise<number> {
  const rows =
    kind === 'DA'
      ? await tx.$queryRaw<{ n: number | null }[]>`
          SELECT MAX(substring("reference" FROM 4)::int) AS n
          FROM "Purchase" WHERE "organizationId" = ${organizationId}`
      : await tx.$queryRaw<{ n: number | null }[]>`
          SELECT MAX(substring("orderNumber" FROM 4)::int) AS n
          FROM "Purchase" WHERE "organizationId" = ${organizationId}`;
  return rows[0]?.n ?? 0;
}

/**
 * The next `DA-NNNN` / `BC-NNNN` of an organisation, from a counter row that
 * only ever goes up: a deleted request never gives its number back. The
 * update locks the counter row until the caller's transaction ends, so two
 * concurrent creations or orders wait for each other and never pick the same
 * number; a rolled-back transaction rolls the counter back too (no gap). The
 * first use of a counter starts after the highest number the organisation
 * already holds; every later use reads nothing but the counter.
 */
export async function nextPurchaseNumber(
  tx: Tx,
  organizationId: string,
  kind: NumberKind,
): Promise<string> {
  const bump = () =>
    tx.$queryRaw<{ last: number }[]>`
      UPDATE "PurchaseCounter" SET "last" = "last" + 1
      WHERE "organizationId" = ${organizationId} AND "kind" = ${kind}
      RETURNING "last"`;
  let rows = await bump();
  if (rows.length === 0) {
    const first = (await highest(tx, organizationId, kind)) + 1;
    // Two first uses at once: the second insert waits for the first to
    // commit, conflicts, and takes the next number.
    rows = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "PurchaseCounter" ("organizationId", "kind", "last")
      VALUES (${organizationId}, ${kind}, ${first})
      ON CONFLICT ("organizationId", "kind")
      DO UPDATE SET "last" = "PurchaseCounter"."last" + 1
      RETURNING "last"`;
  }
  return `${kind}-${String(rows[0].last).padStart(4, '0')}`;
}
