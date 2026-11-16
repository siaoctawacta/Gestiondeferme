import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { SettingsService } from '../admin/settings/settings.service';
import { BuildingStatus } from '../generated/prisma/enums';
import { formatDay } from '../common/days';
import { monthToDate } from '../finance/finance-period';
import {
  FinanceSummaryService,
  type FinanceSummary,
} from '../finance/finance-summary.service';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import type { AlertSettings } from '../indicators/alerts/alert.types';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';
import { layingRate, mortalityRate } from '../indicators/indicators';
import { HerdListService } from '../pigs/herd-list.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  type ActivityTotalsDto,
  type AlertsDto,
  type DashboardDto,
  type EggPointDto,
  type KpisDto,
  type ProfitabilityDto,
  type TasksDto,
  type UpcomingTaskDto,
} from './dashboard.types';

export const ALL_FARMS_NAME = 'Toutes les fermes';
/** Alerts listed on the dashboard; `alerts.total` counts them all. */
export const DASHBOARD_ALERTS = 5;
const EGG_DAYS = 5;

/**
 * Each section is its own method returning its slice of the DTO; later slices
 * replace those bodies one at a time without touching the response shape.
 */
/** The calendar month to date, as the `from` / `to` days the summary takes. */
const monthRange = (): { from: string; to: string } => {
  const { from, to } = monthToDate();
  return { from: formatDay(from), to: formatDay(to) };
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly herdList: HerdListService,
    private readonly settings: SettingsService,
    private readonly alertsRegistry: AlertsRegistry,
    private readonly finance: FinanceSummaryService,
  ) {}

  async get(ctx: RequestContext): Promise<DashboardDto> {
    const [
      farmName,
      activeBuildings,
      kpis,
      eggSeries,
      feedDistributedKg,
      waterConsumedL,
      alerts,
      money,
    ] = await Promise.all([
      this.farmName(ctx),
      this.activeBuildings(ctx),
      this.kpis(ctx),
      this.eggSeries(ctx),
      this.feedDistributedKg(ctx),
      this.waterConsumedL(ctx),
      this.alerts(ctx),
      this.money(ctx),
    ]);
    return {
      farmName,
      tasks: this.tasks(),
      kpis,
      eggSeries,
      profitability: this.profitability(money),
      activeBuildings,
      feedDistributedKg,
      waterConsumedL,
      revenueVsExpenses: this.revenueVsExpenses(money),
      alerts: {
        total: alerts.total,
        items: alerts.items.slice(0, DASHBOARD_ALERTS),
      },
      upcomingTasks: this.upcomingTasks(),
    };
  }

  private async farmName(ctx: RequestContext): Promise<string> {
    if (ctx.allFarms || !ctx.farmId) return ALL_FARMS_NAME;
    const farm = await this.prisma.farm.findUnique({
      where: { id: ctx.farmId },
      select: { name: true },
    });
    return farm?.name ?? ALL_FARMS_NAME;
  }

  private activeBuildings(ctx: RequestContext): Promise<number> {
    return this.prisma.building.count({
      where: { farmId: { in: ctx.farmIds }, status: BuildingStatus.ACTIF },
    });
  }

  private tasks(): TasksDto {
    return { done: 0, pending: 0 };
  }

  /** Poultry lots and their eggs, pigs; one grouped query per figure, whatever the number of lots. */
  private async kpis(ctx: RequestContext): Promise<KpisDto> {
    const farmId = { in: ctx.farmIds };
    const [lots, pigs] = await Promise.all([
      this.prisma.animalBatch.findMany({
        where: { farmId, species: 'AVICOLE', status: 'EN_COURS' },
        select: { id: true, initialCount: true },
      }),
      this.herdList.totalPigs(ctx.farmIds),
    ]);
    const ids = lots.map((l) => l.id);
    const [alive, deaths, laying] = await Promise.all([
      this.ledger.liveCounts(ids),
      this.ledger.deaths(ids),
      this.layingFigures(ctx),
    ]);
    const sum = (m: Map<string, number>) =>
      [...m.values()].reduce((a, b) => a + b, 0);
    return {
      poultryAlive: sum(alive),
      activePoultryBatches: lots.length,
      pigs,
      eggsLastDay: laying.eggs,
      layingRate: layingRate(laying.eggs, laying.hens),
      mortalityRate: mortalityRate(
        sum(deaths),
        lots.reduce((n, l) => n + l.initialCount, 0),
      ),
    };
  }

  /** `where` matching each farm's own latest recorded day, or null when no farm has a record. */
  private onLatestDays(
    rows: { farmId: string; _max: { date: Date | null } }[],
  ): { OR: { farmId: string; date: Date }[] } | null {
    const OR = rows.flatMap((r) =>
      r._max.date ? [{ farmId: r.farmId, date: r._max.date }] : [],
    );
    return OR.length === 0 ? null : { OR };
  }

  /**
   * Eggs collected on each farm's latest day and the hens alive that day in
   * the lots that recorded them (one live-count query per distinct day).
   */
  private async layingFigures(
    ctx: RequestContext,
  ): Promise<{ eggs: number; hens: number }> {
    const latest = await this.prisma.eggProduction.groupBy({
      by: ['farmId'],
      where: { farmId: { in: ctx.farmIds } },
      _max: { date: true },
    });
    const onLatest = this.onLatestDays(latest);
    if (!onLatest) return { eggs: 0, hens: 0 };
    const rows = await this.prisma.eggProduction.groupBy({
      by: ['batchId', 'date'],
      where: onLatest,
      _sum: { collected: true },
    });
    const idsByDay = new Map<number, string[]>();
    for (const r of rows) {
      const ms = r.date.getTime();
      idsByDay.set(ms, [...(idsByDay.get(ms) ?? []), r.batchId]);
    }
    const alive = await Promise.all(
      [...idsByDay].map(([ms, ids]) =>
        this.ledger.liveCounts(ids, new Date(ms)),
      ),
    );
    return {
      eggs: rows.reduce((n, r) => n + (r._sum.collected ?? 0), 0),
      hens: alive.reduce(
        (n, m) => n + [...m.values()].reduce((a, b) => a + b, 0),
        0,
      ),
    };
  }

  private async eggSeries(ctx: RequestContext): Promise<EggPointDto[]> {
    const days = await this.prisma.eggProduction.groupBy({
      by: ['date'],
      where: { farmId: { in: ctx.farmIds } },
      _sum: { collected: true },
      orderBy: { date: 'desc' },
      take: EGG_DAYS,
    });
    return days
      .reverse()
      .map((d) => ({ date: formatDay(d.date), eggs: d._sum.collected ?? 0 }));
  }

  /** « Rentabilité du mois »: the finance summary of the calendar month to date; null without `finance:read`. */
  private money(ctx: RequestContext): Promise<FinanceSummary | null> {
    return can(ctx.user.role, 'finance', 'read')
      ? this.finance.summary(ctx, monthRange(), { byFarm: false })
      : Promise.resolve(null);
  }

  private profitability(money: FinanceSummary | null): ProfitabilityDto | null {
    return (
      money && {
        revenue: money.revenue,
        expenses: money.expenses,
        margin: money.margin,
        marginPct: money.marginPct,
        receivables: money.receivables,
      }
    );
  }

  /** Sum over the farms of each one's latest day with any distribution. */
  private async feedDistributedKg(ctx: RequestContext): Promise<number> {
    const latest = await this.prisma.feedDistribution.groupBy({
      by: ['farmId'],
      where: { farmId: { in: ctx.farmIds } },
      _max: { date: true },
    });
    const onLatest = this.onLatestDays(latest);
    if (!onLatest) return 0;
    const total = await this.prisma.feedDistribution.aggregate({
      where: onLatest,
      _sum: { quantityKg: true },
    });
    return Number(total._sum.quantityKg ?? 0);
  }

  /** Sum over the farms of each one's latest day with any water record. */
  private async waterConsumedL(ctx: RequestContext): Promise<number> {
    const latest = await this.prisma.waterConsumption.groupBy({
      by: ['farmId'],
      where: { farmId: { in: ctx.farmIds } },
      _max: { date: true },
    });
    const onLatest = this.onLatestDays(latest);
    if (!onLatest) return 0;
    const total = await this.prisma.waterConsumption.aggregate({
      where: onLatest,
      _sum: { liters: true },
    });
    return Number(total._sum.liters ?? 0);
  }

  private revenueVsExpenses(
    money: FinanceSummary | null,
  ): ActivityTotalsDto[] | null {
    return money && money.byActivity;
  }

  /** Every open alert (the dashboard list shows the first few); thresholds are read once for all rules. */
  async alerts(ctx: RequestContext): Promise<AlertsDto> {
    const thresholds: AlertSettings = Object.fromEntries(
      Object.entries(await this.settings.getAll(ctx)).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
    const items = await this.alertsRegistry.run(ctx, thresholds);
    return { total: items.length, items };
  }

  private upcomingTasks(): UpcomingTaskDto[] {
    return [];
  }
}
