import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { BuildingStatus } from '../generated/prisma/enums';
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

/**
 * Each section is its own method returning its slice of the DTO; later slices
 * replace those bodies one at a time without touching the response shape.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(ctx: RequestContext): Promise<DashboardDto> {
    const [farmName, activeBuildings] = await Promise.all([
      this.farmName(ctx),
      this.activeBuildings(ctx),
    ]);
    return {
      farmName,
      tasks: this.tasks(),
      kpis: this.kpis(),
      eggSeries: this.eggSeries(),
      profitability: this.profitability(),
      activeBuildings,
      feedDistributedKg: this.feedDistributedKg(),
      waterConsumedL: this.waterConsumedL(),
      revenueVsExpenses: this.revenueVsExpenses(),
      alerts: this.alerts(),
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

  private kpis(): KpisDto {
    return {
      poultryAlive: 0,
      activePoultryBatches: 0,
      pigs: 0,
      eggsLastDay: 0,
      layingRate: null,
      mortalityRate: null,
    };
  }

  private eggSeries(): EggPointDto[] {
    return [];
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

  private feedDistributedKg(): number {
    return 0;
  }

  private waterConsumedL(): number {
    return 0;
  }

  private revenueVsExpenses(): ActivityTotalsDto[] {
    return ACTIVITIES.map((activity) => ({
      activity,
      revenue: 0,
      expenses: 0,
    }));
  }

  alerts(): AlertsDto {
    return { total: 0, items: [] };
  }

  private upcomingTasks(): UpcomingTaskDto[] {
    return [];
  }
}
