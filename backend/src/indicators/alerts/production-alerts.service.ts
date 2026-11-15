import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { addDays, formatDay, today } from '../../common/days';
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

/** Deaths the weaning wrote off are part of the breeding figures, not of mortality. */
const NOT_FROM_BREEDING = {
  OR: [{ sourceType: null }, { sourceType: { not: 'BREEDING' } }],
};

/** One day's total for a lot or a building of a farm. */
interface DayTotal {
  farmId: string;
  targetId: string;
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

  /**
   * Open lots with their deaths. Deaths the weaning wrote off (`BREEDING`
   * events) are not counted, and a litter lot is reported with its weaning
   * state: not weaned yet, it is skipped by the rule (pre-weaning loss is
   * followed through the breeding figures); weaned, it is judged on the weaned
   * headcount and on the deaths recorded after the weaning date.
   */
  async mortalityLots(ctx: RequestContext, now: Date): Promise<MortalityLot[]> {
    const lots = await this.prisma.animalBatch.findMany({
      where: { farmId: { in: ctx.farmIds }, status: 'EN_COURS' },
      select: {
        id: true,
        code: true,
        species: true,
        initialCount: true,
        entryDate: true,
        sourceType: true,
        sourceId: true,
      },
    });
    if (lots.length === 0) return [];
    const ids = lots.map((l) => l.id);
    const day0 = today(now);
    const yesterday = addDays(day0, -1);
    const litters = await this.litterStates(
      lots.flatMap((l) =>
        l.sourceType === 'FARROWING' && l.sourceId
          ? [{ lotId: l.id, recordId: l.sourceId }]
          : [],
      ),
    );
    const own = {
      type: 'MORTALITE' as const,
      AND: [NOT_FROM_BREEDING],
    };
    const [
      deaths,
      deathsAfterWeaning,
      liveYesterdayStart,
      liveTodayStart,
      days,
    ] = await Promise.all([
      this.prisma.batchEvent.groupBy({
        by: ['batchId'],
        where: {
          batchId: { in: ids.filter((id) => !litters.get(id)?.weaned) },
          ...own,
        },
        _sum: { quantity: true },
      }),
      litters.size === 0
        ? []
        : this.prisma.batchEvent.groupBy({
            by: ['batchId'],
            where: {
              type: own.type,
              AND: [
                NOT_FROM_BREEDING,
                {
                  OR: [...litters].flatMap(([batchId, l]) =>
                    l.weaned ? [{ batchId, date: { gt: l.weaningDate } }] : [],
                  ),
                },
              ],
            },
            _sum: { quantity: true },
          }),
      this.ledger.liveCounts(ids, addDays(day0, -2)),
      this.ledger.liveCounts(ids, yesterday),
      this.prisma.batchEvent.groupBy({
        by: ['batchId', 'date'],
        where: {
          batchId: { in: ids },
          ...own,
          date: { gte: yesterday, lte: day0 },
        },
        _sum: { quantity: true },
      }),
    ]);
    const deathsOf = new Map(
      [...deaths, ...deathsAfterWeaning].map((d) => [
        d.batchId,
        d._sum.quantity ?? 0,
      ]),
    );
    const byId = new Map(lots.map((l) => [l.id, l]));
    const recent = new Map<string, DeathDay[]>();
    for (const d of days) {
      const isToday = d.date.getTime() === day0.getTime();
      const lot = byId.get(d.batchId);
      // On its arrival day a lot starts with its opening count.
      const live =
        lot?.entryDate.getTime() === d.date.getTime()
          ? lot.initialCount
          : (isToday ? liveTodayStart : liveYesterdayStart).get(d.batchId);
      recent.set(d.batchId, [
        ...(recent.get(d.batchId) ?? []),
        {
          date: formatDay(d.date),
          deaths: d._sum.quantity ?? 0,
          liveAtStart: live ?? 0,
        },
      ]);
    }
    return lots.map((l) => {
      const litter = litters.get(l.id);
      return {
        id: l.id,
        code: l.code,
        species: l.species,
        initialCount: litter?.weaned ? litter.weanedCount : l.initialCount,
        deaths: deathsOf.get(l.id) ?? 0,
        recentDays: recent.get(l.id) ?? [],
        ...(litter ? { litter: { weaned: litter.weaned } } : {}),
      };
    });
  }

  /** Weaning state of the lots a farrowing created, by lot id. */
  private async litterStates(
    links: { lotId: string; recordId: string }[],
  ): Promise<
    Map<
      string,
      | { weaned: false }
      | { weaned: true; weaningDate: Date; weanedCount: number }
    >
  > {
    const result = new Map<
      string,
      | { weaned: false }
      | { weaned: true; weaningDate: Date; weanedCount: number }
    >();
    if (links.length === 0) return result;
    const records = new Map(
      (
        await this.prisma.breedingRecord.findMany({
          where: { id: { in: links.map((l) => l.recordId) } },
          select: {
            id: true,
            status: true,
            weaningDate: true,
            weanedCount: true,
          },
        })
      ).map((r) => [r.id, r]),
    );
    for (const { lotId, recordId } of links) {
      const r = records.get(recordId);
      if (!r) continue;
      result.set(
        lotId,
        r.status === 'SEVRAGE' && r.weaningDate && r.weanedCount !== null
          ? {
              weaned: true,
              weaningDate: r.weaningDate,
              weanedCount: r.weanedCount,
            }
          : { weaned: false },
      );
    }
    return result;
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

  /**
   * Each farm is judged on its own latest recorded day (today or yesterday),
   * with one grouped query per table whatever the number of farms.
   */
  async consumption(
    ctx: RequestContext,
    now: Date,
  ): Promise<ConsumptionSeries[]> {
    const farmId = { in: ctx.farmIds };
    const earliest = addDays(today(now), -1);
    const [feedLatest, waterLatest] = await Promise.all([
      this.prisma.feedDistribution.groupBy({
        by: ['farmId'],
        where: { farmId },
        _max: { date: true },
      }),
      this.prisma.waterConsumption.groupBy({
        by: ['farmId'],
        where: { farmId },
        _max: { date: true },
      }),
    ]);
    const recent = (rows: { farmId: string; _max: { date: Date | null } }[]) =>
      new Map(
        rows.flatMap((r) =>
          r._max.date && r._max.date >= earliest
            ? [[r.farmId, r._max.date] as [string, Date]]
            : [],
        ),
      );
    const feedDays = recent(feedLatest);
    const waterDays = recent(waterLatest);
    const window = (days: Map<string, Date>) =>
      [...days].map(([id, latest]) => ({
        farmId: id,
        date: { gte: addDays(latest, -7), lte: latest },
      }));
    const [feedRows, waterRows] = await Promise.all([
      feedDays.size === 0
        ? []
        : this.prisma.feedDistribution.groupBy({
            by: ['farmId', 'batchId', 'buildingId', 'date'],
            where: { OR: window(feedDays) },
            _sum: { quantityKg: true },
          }),
      waterDays.size === 0
        ? []
        : this.prisma.waterConsumption.groupBy({
            by: ['farmId', 'batchId', 'buildingId', 'date'],
            where: { OR: window(waterDays) },
            _sum: { liters: true },
          }),
    ]);
    const feed = feedRows.map((r) => ({
      farmId: r.farmId,
      targetId: r.batchId ?? r.buildingId ?? '',
      date: r.date,
      total: Number(r._sum.quantityKg ?? 0),
    }));
    const water = waterRows.map((r) => ({
      farmId: r.farmId,
      targetId: r.batchId ?? r.buildingId ?? '',
      date: r.date,
      total: Number(r._sum.liters ?? 0),
    }));
    const labels = await this.labels([...feed, ...water]);
    return [
      ...this.series('feed', feedDays, feed, labels),
      ...this.series('water', waterDays, water, labels),
    ];
  }

  /** Lot codes and building names for every target of the totals, in two queries. */
  private async labels(totals: DayTotal[]): Promise<Map<string, string>> {
    const ids = [...new Set(totals.map((t) => t.targetId))];
    const [batches, buildings] = await Promise.all([
      this.prisma.animalBatch.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true },
      }),
      this.prisma.building.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }),
    ]);
    return new Map([
      ...batches.map((b): [string, string] => [b.id, b.code]),
      ...buildings.map((b): [string, string] => [b.id, b.name]),
    ]);
  }

  /** One series per target that has a record on its farm's latest day; targets of one id sum their rows per day. */
  private series(
    kind: ConsumptionSeries['kind'],
    latestByFarm: Map<string, Date>,
    totals: DayTotal[],
    labels: Map<string, string>,
  ): ConsumptionSeries[] {
    const byTarget = new Map<
      string,
      { farmId: string; days: Map<number, number> }
    >();
    for (const t of totals) {
      const entry = byTarget.get(t.targetId) ?? {
        farmId: t.farmId,
        days: new Map<number, number>(),
      };
      const ms = t.date.getTime();
      entry.days.set(ms, (entry.days.get(ms) ?? 0) + t.total);
      byTarget.set(t.targetId, entry);
    }
    const result: ConsumptionSeries[] = [];
    for (const [targetId, { farmId, days }] of byTarget) {
      const latest = latestByFarm.get(farmId);
      const value = latest ? days.get(latest.getTime()) : undefined;
      if (!latest || value === undefined) continue;
      result.push({
        kind,
        targetId,
        label: labels.get(targetId) ?? targetId,
        date: formatDay(latest),
        value,
        previous: [...days]
          .filter(([ms]) => ms < latest.getTime())
          .map(([, total]) => total),
      });
    }
    return result;
  }
}
