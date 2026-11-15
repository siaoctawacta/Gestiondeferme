import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { formatDay } from '../common/days';
import { Prisma } from '../generated/prisma/client';
import type {
  Activity,
  FinanceCategory,
  FinanceKind,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { likePattern, type Origin } from './finance-rules';

type Client = Prisma.TransactionClient | PrismaService;

/** One row of `"FinanceLedgerView"` (see the migration that defines it, the ONE definition of every derived row). */
export interface LedgerRow {
  id: string;
  farmId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  kind: FinanceKind;
  label: string;
  activity: Activity;
  category: FinanceCategory;
  /** Exact; negative for a credit note. */
  amount: Decimal;
  origin: Origin;
  /** The document behind a derived row (purchase, lot, invoice); null for a manual entry and a credit note. */
  sourceId: string | null;
  batchId: string | null;
  batchCode: string | null;
  note: string | null;
}

export interface LedgerFilter {
  farmIds: string[];
  kind?: FinanceKind;
  activity?: Activity;
  category?: FinanceCategory;
  origin?: Origin;
  /** Calendar days, both bounds inclusive. */
  from?: Date;
  to?: Date;
  search?: string;
}

/** One group of the summary: what a farm recorded as `kind` under an activity and a category. */
export interface LedgerSum {
  farmId: string;
  kind: FinanceKind;
  activity: Activity;
  category: FinanceCategory;
  amount: Decimal;
}

export type LedgerSort = 'date' | 'amount';

const ORDER: Record<LedgerSort, Record<'asc' | 'desc', Prisma.Sql>> = {
  date: {
    asc: Prisma.sql`v."date" ASC, v."id" ASC`,
    desc: Prisma.sql`v."date" DESC, v."id" ASC`,
  },
  amount: {
    asc: Prisma.sql`v."amount" ASC, v."date" DESC, v."id" ASC`,
    desc: Prisma.sql`v."amount" DESC, v."date" DESC, v."id" ASC`,
  },
};

function where(f: LedgerFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`v."farmId" = ANY(${f.farmIds}::text[])`,
  ];
  if (f.kind) parts.push(Prisma.sql`v."kind"::text = ${f.kind}`);
  if (f.activity) parts.push(Prisma.sql`v."activity"::text = ${f.activity}`);
  if (f.category) parts.push(Prisma.sql`v."category"::text = ${f.category}`);
  if (f.origin) parts.push(Prisma.sql`v."origin" = ${f.origin}`);
  if (f.from) parts.push(Prisma.sql`v."date" >= ${formatDay(f.from)}::date`);
  if (f.to) parts.push(Prisma.sql`v."date" <= ${formatDay(f.to)}::date`);
  if (f.search) {
    parts.push(Prisma.sql`v."label" ILIKE ${likePattern(f.search)}`);
  }
  return Prisma.join(parts, ' AND ');
}

interface RawRow {
  id: string;
  farmId: string;
  date: string;
  kind: FinanceKind;
  label: string;
  activity: Activity;
  category: FinanceCategory;
  amount: string;
  origin: Origin;
  sourceId: string | null;
  batchId: string | null;
  batchCode: string | null;
  note: string | null;
}

/**
 * Every read of the finance ledger view: the entries list, its totals and the
 * grouped sums of the summary and the dashboard. They share `where`, so a
 * filter means the same thing everywhere, and nothing here writes. Money
 * leaves SQL as text and enters `Decimal` (no float in between).
 */
@Injectable()
export class FinanceLedger {
  constructor(private readonly prisma: PrismaService) {}

  async rows(
    f: LedgerFilter,
    order: { sort: LedgerSort; dir: 'asc' | 'desc' },
    range: { skip?: number; take: number },
    client: Client = this.prisma,
  ): Promise<LedgerRow[]> {
    const rows = await client.$queryRaw<RawRow[]>`
      SELECT v."id", v."farmId", v."date"::text AS "date", v."kind"::text AS "kind", v."label",
             v."activity"::text AS "activity", v."category"::text AS "category",
             v."amount"::text AS "amount", v."origin", v."sourceId", v."batchId",
             b."code" AS "batchCode", v."note"
      FROM "FinanceLedgerView" v
      LEFT JOIN "AnimalBatch" b ON b."id" = v."batchId"
      WHERE ${where(f)}
      ORDER BY ${ORDER[order.sort][order.dir]}
      LIMIT ${range.take} OFFSET ${range.skip ?? 0}`;
    return rows.map((r) => ({ ...r, amount: new Decimal(r.amount) }));
  }

  async count(f: LedgerFilter, client: Client = this.prisma): Promise<number> {
    const [row] = await client.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS "n" FROM "FinanceLedgerView" v WHERE ${where(f)}`;
    return Number(row.n);
  }

  /** Σ of the recettes (credit notes included, negative) and of the dépenses over the filter. */
  async totals(
    f: LedgerFilter,
    client: Client = this.prisma,
  ): Promise<{ revenue: Decimal; expenses: Decimal }> {
    const [row] = await client.$queryRaw<
      { revenue: string; expenses: string }[]
    >`
      SELECT COALESCE(SUM(v."amount") FILTER (WHERE v."kind" = 'RECETTE'), 0)::text AS "revenue",
             COALESCE(SUM(v."amount") FILTER (WHERE v."kind" = 'DEPENSE'), 0)::text AS "expenses"
      FROM "FinanceLedgerView" v WHERE ${where(f)}`;
    return {
      revenue: new Decimal(row.revenue),
      expenses: new Decimal(row.expenses),
    };
  }

  /** ONE grouped query: the whole summary (totals, per activity, per category, per farm) is made from it. */
  async sums(
    f: LedgerFilter,
    client: Client = this.prisma,
  ): Promise<LedgerSum[]> {
    const rows = await client.$queryRaw<
      {
        farmId: string;
        kind: FinanceKind;
        activity: Activity;
        category: FinanceCategory;
        amount: string;
      }[]
    >`
      SELECT v."farmId", v."kind"::text AS "kind", v."activity"::text AS "activity",
             v."category"::text AS "category", SUM(v."amount")::text AS "amount"
      FROM "FinanceLedgerView" v
      WHERE ${where(f)}
      GROUP BY v."farmId", v."kind", v."activity", v."category"`;
    return rows.map((r) => ({ ...r, amount: new Decimal(r.amount) }));
  }
}
