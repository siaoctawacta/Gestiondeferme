import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { addDays, formatDay, today } from '../common/days';
import { Prisma } from '../generated/prisma/client';
import type { HealthActType } from '../generated/prisma/enums';
import { openAtWhere } from '../herd/lot-open';
import { PrismaService } from '../prisma/prisma.service';
import {
  actInclude,
  overdueActWhere,
  targetLabel,
  withdrawalEnd,
} from './health-act-view';
import { HealthTargets } from './health-targets';

export type HealthPeriodFigures = {
  /** Acts done in the period, by type (by their done date). */
  done: Record<HealthActType, number>;
  /** Planned acts dated on or before the end day and still planned: late at the end of that day. */
  overdueAtEnd: number;
  /** Quarantines under way at the end of the last day. */
  openQuarantines: number;
  incidents: number;
  biosecurityLogs: number;
};

/**
 * The rule of `toActItem` judged at the end of `day`: an act on a lot closed,
 * or an animal gone, by then can no longer be done, so it is not late (a lot
 * closed after `day` still counts).
 */
const openAt = (day: Date) => ({
  AND: [
    { OR: [{ batchId: null }, { batch: openAtWhere(day) }] },
    {
      OR: [
        { animalId: null },
        { animal: { exitDate: null } },
        { animal: { exitDate: { gt: day } } },
      ],
    },
  ],
});

/**
 * The health figures other modules read (the reports): each is a fixed number
 * of queries over the farms given, whatever the number of acts.
 */
@Injectable()
export class HealthReport {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: HealthTargets,
  ) {}

  /**
   * What the health records say between two days (both inclusive). An act is
   * late at the end of `to` like a task (Q44): planned on or before `to` and,
   * at that moment, not done: still planned now, or done after `to` having been
   * completed from a plan (`enteredDone` false: an act entered as done was
   * never planned). For a period ending today the still-planned ones are the
   * health list's `EN_RETARD` (`overdueActWhere`: open lot or animal only); for
   * a past period the target's CURRENT status is not looked at (a lot closed
   * after `to` still counted). Cancelled acts carry no cancellation date, so
   * they are never counted. Every figure is over what the caller's health
   * screens list (`HealthTargets.visibleBatch` / `visibleAnimal`: the other
   * species' lots and the pigs are left out for a role that cannot read them). A quarantine is under way at the end of `to` when
   * it started by then and is still open or was lifted after it.
   */
  async periodFigures(
    ctx: RequestContext,
    from: Date,
    to: Date,
  ): Promise<HealthPeriodFigures> {
    const farmIds = ctx.farmIds;
    if (farmIds.length === 0) {
      return {
        done: { VACCINATION: 0, TRAITEMENT: 0, DESINFECTION: 0, DIAGNOSTIC: 0 },
        overdueAtEnd: 0,
        openQuarantines: 0,
        incidents: 0,
        biosecurityLogs: 0,
      };
    }
    const farmId = { in: farmIds };
    const between = { gte: from, lte: to };
    const visibleActs = [
      this.targets.visibleBatch(ctx),
      this.targets.visibleAnimal(ctx),
    ];
    const visibleBatch = [this.targets.visibleBatch(ctx)];
    const [done, overdueAtEnd, openQuarantines, incidents, biosecurityLogs] =
      await Promise.all([
        this.prisma.healthAct.groupBy({
          by: ['type'],
          where: {
            farmId,
            status: 'REALISE',
            doneDate: between,
            AND: visibleActs,
          },
          _count: { _all: true },
        }),
        this.prisma.healthAct.count({
          where: {
            farmId,
            date: { lte: to },
            AND: visibleActs,
            OR: [
              to.getTime() >= today().getTime()
                ? overdueActWhere(addDays(to, 1))
                : { status: 'PLANIFIE', ...openAt(to) },
              {
                status: 'REALISE',
                enteredDone: false,
                doneDate: { gt: to },
                ...openAt(to),
              },
            ],
          },
        }),
        this.prisma.quarantine.count({
          where: {
            farmId,
            startDate: { lte: to },
            AND: visibleActs,
            OR: [{ status: 'EN_COURS' }, { endDate: { gt: to } }],
          },
        }),
        this.prisma.healthIncident.count({
          where: { farmId, date: between, AND: visibleBatch },
        }),
        this.prisma.biosecurityLog.count({ where: { farmId, date: between } }),
      ]);
    const byType: Record<HealthActType, number> = {
      VACCINATION: 0,
      TRAITEMENT: 0,
      DESINFECTION: 0,
      DIAGNOSTIC: 0,
    };
    for (const g of done) byType[g.type] = g._count._all;
    return {
      done: byType,
      overdueAtEnd,
      openQuarantines,
      incidents,
      biosecurityLogs,
    };
  }

  /**
   * The lots, animals and buildings under a withdrawal period on `day` (done
   * by then, last day of the period on or after it), with the last day: the
   * same period as the health list's `withdrawalUntil`, over the acts the
   * caller's health list shows. By end date, then name.
   */
  async withdrawalsAt(
    ctx: RequestContext,
    day: Date,
  ): Promise<{ target: string; until: Date }[]> {
    const farmIds = ctx.farmIds;
    if (farmIds.length === 0) return [];
    // The window (done day to done day + treatment + withdrawal days, as
    // `withdrawalPeriod`) is tested in SQL, so only the acts under withdrawal that
    // day are loaded.
    const hits = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "HealthAct"
      WHERE "farmId" IN (${Prisma.join(farmIds)})
        AND "status" = 'REALISE' AND "withdrawalDays" IS NOT NULL
        AND "doneDate" <= ${formatDay(day)}::date
        AND "doneDate" + (COALESCE("durationDays", 0) + "withdrawalDays") * INTERVAL '1 day' >= ${formatDay(day)}::date`);
    if (hits.length === 0) return [];
    const acts = await this.prisma.healthAct.findMany({
      where: {
        id: { in: hits.map((h) => h.id) },
        // The acts the caller's health list shows: never another species' lot or a pig.
        AND: [this.targets.visibleBatch(ctx), this.targets.visibleAnimal(ctx)],
      },
      include: actInclude,
    });
    return acts
      .flatMap((act) => {
        const until = withdrawalEnd(act);
        return until ? [{ target: targetLabel(act), until }] : [];
      })
      .sort(
        (a, b) =>
          a.until.getTime() - b.until.getTime() ||
          a.target.localeCompare(b.target),
      );
  }
}
