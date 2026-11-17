import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { formatDayOrNull } from '../common/days';
import { toMoney, zero } from '../common/money';
import type { Activity, FinanceKind } from '../generated/prisma/enums';
import { margin, marginRate } from '../indicators/indicators';
import { PrismaService } from '../prisma/prisma.service';
import { receivablesTotal } from '../sales/receivables';
import { OPEN_STATUSES } from '../sales/sale-workflow';
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  REVENUE_CATEGORIES,
} from './finance-categories';
import { FinanceLedger } from './finance-ledger';
import { periodOf } from './finance-period';

const ACTIVITY_ORDER: Activity[] = ['AVICOLE', 'PORCIN', 'GENERAL'];

export interface ActivityFigures {
  activity: Activity;
  revenue: number;
  expenses: number;
  margin: number;
}

export interface FinanceSummary {
  /** `YYYY-MM-DD`; null for an open bound. */
  from: string | null;
  to: string | null;
  revenue: number;
  expenses: number;
  margin: number;
  /** Integer percent of the revenue; null without revenue. */
  marginPct: number | null;
  /** What customers still owe (every issued, unsettled invoice, whatever its date). */
  receivables: number;
  byActivity: ActivityFigures[];
  byCategory: {
    kind: FinanceKind;
    category: string;
    label: string;
    amount: number;
  }[];
  /** Under `X-Farm-Id: all` only (and not asked off: the dashboard does not need it). */
  byFarm?: {
    farmId: string;
    farmName: string;
    revenue: number;
    expenses: number;
    margin: number;
  }[];
}

/**
 * The farm view: recettes − dépenses over a period, from the finance ledger
 * view only (never stock consumption). The dashboard calls `summary` too, so
 * its figures are these. Queries: one grouped read of the view, the one
 * receivables aggregate of sales (`receivablesTotal`), and the farm names under `all`: a fixed number whatever the
 * number of documents.
 */
@Injectable()
export class FinanceSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: FinanceLedger,
  ) {}

  /**
   * Both bounds are inclusive and either may be open: with NEITHER the period is
   * ALL TIME, like the entries list and the lot view (a caller that wants the
   * month passes `monthToDate()` itself, as the dashboard does).
   */
  async summary(
    ctx: RequestContext,
    q: { from?: string; to?: string },
    opts: { byFarm?: boolean } = {},
  ): Promise<FinanceSummary> {
    const withFarms = ctx.allFarms && opts.byFarm !== false;
    const period = periodOf(q.from, q.to);
    const [sums, receivables, farms] = await Promise.all([
      this.ledger.sums({ farmIds: ctx.farmIds, ...period }),
      receivablesTotal(this.prisma, ctx.farmIds, { statuses: OPEN_STATUSES }),
      withFarms
        ? this.prisma.farm.findMany({
            where: { id: { in: ctx.farmIds } },
            select: { id: true, name: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([]),
    ]);

    const figures = (rows: typeof sums) => {
      let revenue = zero();
      let expenses = zero();
      for (const r of rows) {
        if (r.kind === 'RECETTE') revenue = revenue.add(r.amount);
        else expenses = expenses.add(r.amount);
      }
      return { revenue, expenses, margin: margin(revenue, expenses) };
    };
    const total = figures(sums);
    const byActivity = ACTIVITY_ORDER.map((activity) => {
      const f = figures(sums.filter((r) => r.activity === activity));
      return {
        activity,
        revenue: toMoney(f.revenue),
        expenses: toMoney(f.expenses),
        margin: toMoney(f.margin),
      };
    });
    const byCategory = [...EXPENSE_CATEGORIES, ...REVENUE_CATEGORIES].flatMap(
      (category) => {
        const own = sums.filter((r) => r.category === category);
        if (own.length === 0) return [];
        const amount = own.reduce((n, r) => n.add(r.amount), zero());
        return [
          {
            kind: own[0].kind,
            category,
            label: CATEGORY_LABEL[category],
            amount: toMoney(amount),
          },
        ];
      },
    );
    return {
      from: formatDayOrNull(period.from ?? null),
      to: formatDayOrNull(period.to ?? null),
      revenue: toMoney(total.revenue),
      expenses: toMoney(total.expenses),
      margin: toMoney(total.margin),
      marginPct: marginRate(total.margin, total.revenue),
      receivables: toMoney(receivables),
      byActivity,
      byCategory,
      ...(withFarms
        ? {
            byFarm: farms.map((farm) => {
              const f = figures(sums.filter((r) => r.farmId === farm.id));
              return {
                farmId: farm.id,
                farmName: farm.name,
                revenue: toMoney(f.revenue),
                expenses: toMoney(f.expenses),
                margin: toMoney(f.margin),
              };
            }),
          }
        : {}),
    };
  }
}
