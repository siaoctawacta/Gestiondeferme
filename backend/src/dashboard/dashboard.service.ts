import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { SettingsService } from '../admin/settings/settings.service';
import { BuildingStatus } from '../generated/prisma/enums';
import { formatDay, today } from '../common/days';
import { monthToDate } from '../finance/finance-period';
import {
  FinanceSummaryService,
  type FinanceSummary,
} from '../finance/finance-summary.service';
import type {
  AlertItem,
  AlertSettings,
} from '../indicators/alerts/alert.types';
import { AlertAcksService } from '../indicators/alerts/alert-acks.service';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';
import { PrismaService } from '../prisma/prisma.service';
import { TaskReads } from '../tasks/task-reads.service';
import { FarmKpisService } from './farm-kpis.service';
import {
  type ActivityTotalsDto,
  type AlertAckDto,
  type AlertsDto,
  type DashboardDto,
  type ProfitabilityDto,
  type TasksDto,
  type UpcomingTaskDto,
} from './dashboard.types';

export const ALL_FARMS_NAME = 'Toutes les fermes';
/** Alerts listed on the dashboard; `alerts.total` counts them all. */
export const DASHBOARD_ALERTS = 5;
const UPCOMING_TASKS = 5;
/** The setting: days an acknowledgement hides an alert. */
const ALERT_ACK_DAYS = 'alertAckDays';

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
    private readonly farmKpis: FarmKpisService,
    private readonly settings: SettingsService,
    private readonly alertsRegistry: AlertsRegistry,
    private readonly finance: FinanceSummaryService,
    private readonly taskReads: TaskReads,
    private readonly acks: AlertAcksService,
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
      tasks,
      upcomingTasks,
    ] = await Promise.all([
      this.farmName(ctx),
      this.activeBuildings(ctx),
      this.farmKpis.kpis(ctx.farmIds),
      this.farmKpis.eggSeries(ctx.farmIds),
      this.farmKpis.feedDistributedKg(ctx.farmIds),
      this.farmKpis.waterConsumedL(ctx.farmIds),
      this.alerts(ctx),
      this.money(ctx),
      this.tasks(ctx),
      this.upcomingTasks(ctx),
    ]);
    return {
      farmName,
      tasks,
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
      upcomingTasks,
    };
  }

  async farmName(ctx: RequestContext): Promise<string> {
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

  /** Open tasks, and those completed in the last 30 days; nothing for a role that cannot read the tasks. */
  private tasks(ctx: RequestContext): Promise<TasksDto> {
    return can(ctx.user.role, 'taches', 'read')
      ? this.taskReads.counts(ctx.farmIds, today())
      : Promise.resolve({ done: 0, pending: 0 });
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

  private revenueVsExpenses(
    money: FinanceSummary | null,
  ): ActivityTotalsDto[] | null {
    return money && money.byActivity;
  }

  /** The thresholds the rules read (every numeric setting, read once), and the days an acknowledgement hides an alert. */
  private async thresholds(ctx: RequestContext): Promise<AlertSettings> {
    return Object.fromEntries(
      Object.entries(await this.settings.getAll(ctx)).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
  }

  /** Every open alert of the caller's role and farms, whoever masked it (the reports count these). */
  async openAlerts(ctx: RequestContext): Promise<AlertItem[]> {
    return this.alertsRegistry.run(ctx, await this.thresholds(ctx));
  }

  /**
   * The alerts this user sees: the ones he masked (and that are neither expired nor worse) are left
   * out and not counted. With `includeAcknowledged` they are listed too, flagged `acknowledged`;
   * `total` still counts only the others. One extra query, whatever the number of alerts.
   */
  async alerts(
    ctx: RequestContext,
    opts: { includeAcknowledged?: boolean } = {},
  ): Promise<AlertsDto> {
    const thresholds = await this.thresholds(ctx);
    const open = await this.alertsRegistry.run(ctx, thresholds);
    const hidden = await this.acks.hiddenKeys(
      ctx.user.id,
      open,
      thresholds[ALERT_ACK_DAYS],
    );
    const visible = open.filter((a) => !hidden.has(a.key));
    return {
      total: visible.length,
      acknowledgedCount: hidden.size,
      items: opts.includeAcknowledged
        ? open.map((a) => ({ ...a, acknowledged: hidden.has(a.key) }))
        : visible,
    };
  }

  /** « Masquer l'alerte »: only an alert this user sees open now can be masked. */
  async acknowledge(ctx: RequestContext, key: string): Promise<AlertAckDto> {
    const thresholds = await this.thresholds(ctx);
    const item = (await this.alertsRegistry.run(ctx, thresholds)).find(
      (a) => a.key === key,
    );
    if (!item) throw new NotFoundException('Alerte introuvable');
    await this.acks.acknowledge(ctx.user.id, item, thresholds[ALERT_ACK_DAYS]);
    return { key, acknowledged: true };
  }

  async unacknowledge(ctx: RequestContext, key: string): Promise<AlertAckDto> {
    await this.acks.unacknowledge(ctx.user.id, key);
    return { key, acknowledged: false };
  }

  /** « Tâches à venir »: the next five open tasks. */
  private upcomingTasks(ctx: RequestContext): Promise<UpcomingTaskDto[]> {
    return can(ctx.user.role, 'taches', 'read')
      ? this.taskReads.upcoming(ctx.farmIds, UPCOMING_TASKS)
      : Promise.resolve([]);
  }
}
