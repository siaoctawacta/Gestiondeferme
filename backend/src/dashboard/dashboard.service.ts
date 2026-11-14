import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { SettingsService } from '../admin/settings/settings.service';
import { BuildingStatus } from '../generated/prisma/enums';
import { formatDay } from '../herd/days';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import {
  ALERT_SETTING_KEYS,
  type AlertSettings,
} from '../indicators/alerts/alert.types';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';
import { layingRate, mortalityRate } from '../indicators/indicators';
import { HerdListService } from '../pigs/herd-list.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVITIES,
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
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly herdList: HerdListService,
    private readonly settings: SettingsService,
    private readonly alertsRegistry: AlertsRegistry,
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
    ] = await Promise.all([
      this.farmName(ctx),
      this.activeBuildings(ctx),
      this.kpis(ctx),
      this.eggSeries(ctx),
      this.feedDistributedKg(ctx),
      this.waterConsumedL(ctx),
      this.alerts(ctx),
    ]);
    return {
      farmName,
      tasks: this.tasks(),
      kpis,
      eggSeries,
      profitability: this.profitability(),
      activeBuildings,
      feedDistributedKg,
      waterConsumedL,
      revenueVsExpenses: this.revenueVsExpenses(),
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
    const [lots, pigs, eggDay] = await Promise.all([
      this.prisma.animalBatch.findMany({
        where: { farmId, species: 'AVICOLE', status: 'EN_COURS' },
        select: { id: true, initialCount: true },
      }),
      this.herdList.totalPigs(ctx.farmIds),
      this.latestEggDay(ctx),
    ]);
    const ids = lots.map((l) => l.id);
    const [alive, deaths, laying] = await Promise.all([
      this.ledger.liveCounts(ids),
      this.ledger.deaths(ids),
      this.layingFigures(ctx, eggDay),
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

  private async latestEggDay(ctx: RequestContext): Promise<Date | null> {
    const latest = await this.prisma.eggProduction.aggregate({
      where: { farmId: { in: ctx.farmIds } },
      _max: { date: true },
    });
    return latest._max.date;
  }

  /** Eggs collected on `day` and the hens alive that day in the lots that recorded them. */
  private async layingFigures(
    ctx: RequestContext,
    day: Date | null,
  ): Promise<{ eggs: number; hens: number }> {
    if (!day) return { eggs: 0, hens: 0 };
    const rows = await this.prisma.eggProduction.groupBy({
      by: ['batchId'],
      where: { farmId: { in: ctx.farmIds }, date: day },
      _sum: { collected: true },
    });
    const alive = await this.ledger.liveCounts(
      rows.map((r) => r.batchId),
      day,
    );
    return {
      eggs: rows.reduce((n, r) => n + (r._sum.collected ?? 0), 0),
      hens: [...alive.values()].reduce((a, b) => a + b, 0),
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

  private profitability(): ProfitabilityDto {
    return {
      revenue: 0,
      expenses: 0,
      margin: 0,
      marginPct: null,
      receivables: 0,
    };
  }

  /** Total of the latest day with any distribution. */
  private async feedDistributedKg(ctx: RequestContext): Promise<number> {
    const [latest] = await this.prisma.feedDistribution.groupBy({
      by: ['date'],
      where: { farmId: { in: ctx.farmIds } },
      _sum: { quantityKg: true },
      orderBy: { date: 'desc' },
      take: 1,
    });
    return Number(latest?._sum.quantityKg ?? 0);
  }

  /** Total of the latest day with any water record. */
  private async waterConsumedL(ctx: RequestContext): Promise<number> {
    const [latest] = await this.prisma.waterConsumption.groupBy({
      by: ['date'],
      where: { farmId: { in: ctx.farmIds } },
      _sum: { liters: true },
      orderBy: { date: 'desc' },
      take: 1,
    });
    return Number(latest?._sum.liters ?? 0);
  }

  private revenueVsExpenses(): ActivityTotalsDto[] {
    return ACTIVITIES.map((activity) => ({
      activity,
      revenue: 0,
      expenses: 0,
    }));
  }

  /** Every open alert (the dashboard list shows the first few); thresholds are read once for all rules. */
  async alerts(ctx: RequestContext): Promise<AlertsDto> {
    const stored = await this.settings.getAll(ctx);
    const thresholds = Object.fromEntries(
      ALERT_SETTING_KEYS.map((key) => [key, Number(stored[key])]),
    ) as unknown as AlertSettings;
    const items = await this.alertsRegistry.run(ctx, thresholds);
    return { total: items.length, items };
  }

  private upcomingTasks(): UpcomingTaskDto[] {
    return [];
  }
}
