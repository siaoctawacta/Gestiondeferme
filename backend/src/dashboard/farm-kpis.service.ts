import { Injectable } from '@nestjs/common';
import { formatDay } from '../common/days';
import { EggProductionService } from '../eggs/egg-production.service';
import { FeedService } from '../feed/feed.service';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { layingRate, mortalityRate } from '../indicators/indicators';
import { HerdListService } from '../pigs/herd-list.service';
import { PrismaService } from '../prisma/prisma.service';
import type { EggPointDto, KpisDto } from './dashboard.types';

const EGG_DAYS = 5;

type LatestDays = { farmId: string; _max: { date: Date | null } }[];

/**
 * The production figures of the farms in view: the dashboard shows them and
 * the synthèse report reads the same functions, so they are one definition.
 * Every « last day » is each farm's own latest recorded day, taken from its
 * day figures (`EggProductionService.periodFiguresOnDays` / `FeedService.dayFigures`), never
 * recomputed here.
 */
@Injectable()
export class FarmKpisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: HerdLedgerService,
    private readonly herdList: HerdListService,
    private readonly eggs: EggProductionService,
    private readonly feed: FeedService,
  ) {}

  /** Poultry lots and their eggs, pigs; one grouped query per figure, whatever the number of lots. */
  async kpis(farmIds: string[]): Promise<KpisDto> {
    const farmId = { in: farmIds };
    const [lots, pigs] = await Promise.all([
      this.prisma.animalBatch.findMany({
        where: { farmId, species: 'AVICOLE', status: 'EN_COURS' },
        select: { id: true, initialCount: true },
      }),
      this.herdList.totalPigs(farmIds),
    ]);
    const ids = lots.map((l) => l.id);
    const [alive, deaths, laying] = await Promise.all([
      this.ledger.liveCounts(ids),
      this.ledger.deaths(ids),
      this.layingFigures(farmIds),
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

  /** The farms that have a record, each with its latest recorded day. */
  private latest(rows: LatestDays): { farmId: string; date: Date }[] {
    return rows.flatMap((r) =>
      r._max.date ? [{ farmId: r.farmId, date: r._max.date }] : [],
    );
  }

  /**
   * Eggs collected on each farm's latest day and the hens alive that day in
   * the lots that recorded them: the `periodFigures` of that one day.
   */
  async layingFigures(
    farmIds: string[],
  ): Promise<{ eggs: number; hens: number }> {
    const rows = await this.prisma.eggProduction.groupBy({
      by: ['farmId'],
      where: { farmId: { in: farmIds } },
      _max: { date: true },
    });
    const latest = this.latest(rows);
    const days = await this.eggs.periodFiguresOnDays(
      latest.map((l) => ({ farmId: l.farmId, date: l.date })),
    );
    return { eggs: days.collected, hens: days.henDays };
  }

  async eggSeries(farmIds: string[]): Promise<EggPointDto[]> {
    const days = await this.prisma.eggProduction.groupBy({
      by: ['date'],
      where: { farmId: { in: farmIds } },
      _sum: { collected: true },
      orderBy: { date: 'desc' },
      take: EGG_DAYS,
    });
    return days
      .reverse()
      .map((d) => ({ date: formatDay(d.date), eggs: d._sum.collected ?? 0 }));
  }

  /** Sum over the farms of each one's latest day with any distribution. */
  async feedDistributedKg(farmIds: string[]): Promise<number> {
    const rows = await this.prisma.feedDistribution.groupBy({
      by: ['farmId'],
      where: { farmId: { in: farmIds } },
      _max: { date: true },
    });
    const latest = this.latest(rows);
    return (await this.feed.dayFigures(latest, [])).feedKg;
  }

  /** Sum over the farms of each one's latest day with any water record. */
  async waterConsumedL(farmIds: string[]): Promise<number> {
    const rows = await this.prisma.waterConsumption.groupBy({
      by: ['farmId'],
      where: { farmId: { in: farmIds } },
      _max: { date: true },
    });
    const latest = this.latest(rows);
    return (await this.feed.dayFigures([], latest)).waterL;
  }
}
