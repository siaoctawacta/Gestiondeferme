import type { Prisma } from '../generated/prisma/client';

/**
 * DA/BC purchases, DV quotes, FA invoices. AV credit notes and RC receipts are
 * added with their tables (they extend this list and `HOLDERS`).
 */
export type DocumentKind = 'DA' | 'BC' | 'DV' | 'FA';

type Tx = Prisma.TransactionClient;

/**
 * Where the numbers of each kind already live, so a counter's first use starts
 * after the highest one the organisation holds (every table has `organizationId`).
 */
const HOLDERS: Record<DocumentKind, { table: string; column: string }> = {
  DA: { table: 'Purchase', column: 'reference' },
  BC: { table: 'Purchase', column: 'orderNumber' },
  DV: { table: 'Quote', column: 'reference' },
  FA: { table: 'Invoice', column: 'number' },
};

/** The highest number the organisation already holds for `kind` (0 when none), to start a counter after it. */
async function highest(
  tx: Tx,
  organizationId: string,
  kind: DocumentKind,
): Promise<number> {
  const { table, column } = HOLDERS[kind];
  // Identifiers come from the constant map above, never from input.
  const rows = await tx.$queryRawUnsafe<{ n: number | null }[]>(
    `SELECT MAX(substring("${column}" FROM 4)::int) AS n FROM "${table}" WHERE "organizationId" = $1`,
    organizationId,
  );
  return rows[0]?.n ?? 0;
}

/**
 * The next `KK-NNNN` of an organisation, from a counter row that
 * only ever goes up: a deleted request never gives its number back. The
 * update locks the counter row until the caller's transaction ends, so two
 * concurrent creations or orders wait for each other and never pick the same
 * number; a rolled-back transaction rolls the counter back too (no gap). The
 * first use of a counter starts after the highest number the organisation
 * already holds; every later use reads nothing but the counter.
 */
export async function nextDocumentNumber(
  tx: Tx,
  organizationId: string,
  kind: DocumentKind,
): Promise<string> {
  const bump = () =>
    tx.$queryRaw<{ last: number }[]>`
      UPDATE "DocumentCounter" SET "last" = "last" + 1
      WHERE "organizationId" = ${organizationId} AND "kind" = ${kind}
      RETURNING "last"`;
  let rows = await bump();
  if (rows.length === 0) {
    const first = (await highest(tx, organizationId, kind)) + 1;
    // Two first uses at once: the second insert waits for the first to
    // commit, conflicts, and takes the next number.
    rows = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "DocumentCounter" ("organizationId", "kind", "last")
      VALUES (${organizationId}, ${kind}, ${first})
      ON CONFLICT ("organizationId", "kind")
      DO UPDATE SET "last" = "DocumentCounter"."last" + 1
      RETURNING "last"`;
  }
  return `${kind}-${String(rows[0].last).padStart(4, '0')}`;
}
