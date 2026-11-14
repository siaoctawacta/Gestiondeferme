import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { formatDay } from '../../herd/days';
import { HerdLedgerService } from '../../herd/herd-ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsRegistry } from './alerts-registry';
import {
  productionAlertRules,
  type AlertData,
  type ConsumptionSeries,
  type DeathDay,
  type Gestation,
  type MortalityLot,
} from './production-alerts';

const DAY_MS = 86_400_000;
const addDays = (date: Date, n: number) =>
  new Date(date.getTime() + n * DAY_MS);
const utcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** One day's total for a lot or a building. */
interface DayTotal {
  batchId: string | null;
  buildingId: string | null;
  date: Date;
  total: number;
}

/**
 * Reads the production tables (open lots, deaths, breeding records, feed and
 * water) for the alert rules and registers those rules. Every query is a
 * group-by over all the lots of the request's farms, never one per lot.
 */
@Injectable()
export class ProductionAlertsService implements AlertData, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly registry: AlertsRegistry,
  ) {}

  onModuleInit(): void {
    for (const rule of productionAlertRules(this)) this.registry.register(rule);
  }

  async mortalityLots(ctx: RequestContext, now: Date): Promise<MortalityLot[]> {
    const lots = await this.prisma.animalBatch.findMany({
      where: { farmId: { in: ctx.farmIds }, status: 'EN_COURS' },
      select: { id: true, code: true, species: true, initialCount: true },
    });
    if (lots.length === 0) return [];
    const ids = lots.map((l) => l.id);
    const today = utcDay(now);
    const yesterday = addDays(today, -1);
    const [deaths, liveYesterdayStart, liveTodayStart, days] =
      await Promise.all([
        this.ledger.deaths(ids),
        this.ledger.liveCounts(ids, addDays(today, -2)),
        this.ledger.liveCounts(ids, yesterday),
        this.prisma.batchEvent.groupBy({
          by: ['batchId', 'date'],
          where: {
            batchId: { in: ids },
            type: 'MORTALITE',
            date: { gte: yesterday, lte: today },
          },
          _sum: { quantity: true },
        }),
      ]);
    const recent = new Map<string, DeathDay[]>();
    for (const d of days) {
      const isToday = d.date.getTime() === today.getTime();
      const live = (isToday ? liveTodayStart : liveYesterdayStart).get(
        d.batchId,
      );
      recent.set(d.batchId, [
        ...(recent.get(d.batchId) ?? []),
        {
          date: formatDay(d.date),
          deaths: d._sum.quantity ?? 0,
          liveAtStart: live ?? 0,
        },
      ]);
    }
    return lots.map((l) => ({
      ...l,
      deaths: deaths.get(l.id) ?? 0,
      recentDays: recent.get(l.id) ?? [],
    }));
  }

  async gestations(ctx: RequestContext): Promise<Gestation[]> {
    const records = await this.prisma.breedingRecord.findMany({
      where: { farmId: { in: ctx.farmIds }, status: 'GESTATION' },
      select: {
        id: true,
        expectedFarrowingDate: true,
        sow: { select: { tag: true } },
      },
    });
    return records.map((r) => ({
      id: r.id,
      sowTag: r.sow.tag,
      expectedFarrowingDate: formatDay(r.expectedFarrowingDate),
    }));
  }

  async consumption(
    ctx: RequestContext,
    now: Date,
  ): Promise<ConsumptionSeries[]> {
    const farmId = { in: ctx.farmIds };
    const [feedLatest, waterLatest] = await Promise.all([
      this.prisma.feedDistribution.aggregate({
        where: { farmId },
        _max: { date: true },
      }),
      this.prisma.waterConsumption.aggregate({
        where: { farmId },
        _max: { date: true },
      }),
    ]);
    const earliest = addDays(utcDay(now), -1);
    const feedDay = feedLatest._max.date;
    const waterDay = waterLatest._max.date;
    const [feed, water] = await Promise.all([
      feedDay && feedDay >= earliest
        ? this.feedTotals(ctx, feedDay)
        : Promise.resolve([]),
      waterDay && waterDay >= earliest
        ? this.waterTotals(ctx, waterDay)
        : Promise.resolve([]),
    ]);
    const labels = await this.labels([...feed, ...water]);
    return [
      ...this.series('feed', feedDay, feed, labels),
      ...this.series('water', waterDay, water, labels),
    ];
  }

  private async feedTotals(ctx: RequestContext, latest: Date) {
    const rows = await this.prisma.feedDistribution.groupBy({
      by: ['batchId', 'buildingId', 'date'],
      where: {
        farmId: { in: ctx.farmIds },
        date: { gte: addDays(latest, -7), lte: latest },
      },
      _sum: { quantityKg: true },
    });
    return rows.map((r): DayTotal => ({
      batchId: r.batchId,
      buildingId: r.buildingId,
      date: r.date,
      total: Number(r._sum.quantityKg ?? 0),
    }));
  }

  private async waterTotals(ctx: RequestContext, latest: Date) {
    const rows = await this.prisma.waterConsumption.groupBy({
      by: ['batchId', 'buildingId', 'date'],
      where: {
        farmId: { in: ctx.farmIds },
        date: { gte: addDays(latest, -7), lte: latest },
      },
      _sum: { liters: true },
    });
    return rows.map((r): DayTotal => ({
      batchId: r.batchId,
      buildingId: r.buildingId,
      date: r.date,
      total: Number(r._sum.liters ?? 0),
    }));
  }

  /** Lot codes and building names for every target of the totals, in two queries. */
  private async labels(totals: DayTotal[]): Promise<Map<string, string>> {
    const batchIds = [...new Set(totals.flatMap((t) => t.batchId ?? []))];
    const buildingIds = [...new Set(totals.flatMap((t) => t.buildingId ?? []))];
    const [batches, buildings] = await Promise.all([
      this.prisma.animalBatch.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, code: true },
      }),
      this.prisma.building.findMany({
        where: { id: { in: buildingIds } },
        select: { id: true, name: true },
      }),
    ]);
    return new Map([
      ...batches.map((b): [string, string] => [b.id, b.code]),
      ...buildings.map((b): [string, string] => [b.id, b.name]),
    ]);
  }

  private series(
    kind: ConsumptionSeries['kind'],
    latest: Date | null,
    totals: DayTotal[],
    labels: Map<string, string>,
  ): ConsumptionSeries[] {
    if (!latest || totals.length === 0) return [];
    const byTarget = new Map<string, DayTotal[]>();
    for (const t of totals) {
      const id = t.batchId ?? t.buildingId ?? '';
      byTarget.set(id, [...(byTarget.get(id) ?? []), t]);
    }
    const result: ConsumptionSeries[] = [];
    for (const [targetId, rows] of byTarget) {
      const last = rows.find((r) => r.date.getTime() === latest.getTime());
      if (!last) continue;
      result.push({
        kind,
        targetId,
        label: labels.get(targetId) ?? targetId,
        date: formatDay(latest),
        value: last.total,
        previous: rows
          .filter((r) => r.date.getTime() < latest.getTime())
          .map((r) => r.total),
      });
    }
    return result;
  }
}
