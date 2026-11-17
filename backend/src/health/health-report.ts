import { Injectable } from '@nestjs/common';
import { addDays, today } from '../common/days';
import { Prisma } from '../generated/prisma/client';
import type { HealthActType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  actInclude,
  overdueActWhere,
  targetLabel,
  withdrawalEnd,
} from './health-act-view';

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
 * The health figures other modules read (the reports): each is a fixed number
 * of queries over the farms given, whatever the number of acts.
 */
@Injectable()
export class HealthReport {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What the health records say between two days (both inclusive). An act is
   * late at the end of `to` like a task (Q44): planned on or before `to` and,
   * at that moment, not done: still planned now, or done after `to` having been
   * completed from a plan (`enteredDone` false: an act entered as done was
   * never planned). For a period ending today the still-planned ones are the
   * health list's `EN_RETARD` (`overdueActWhere`: open lot or animal only); for
   * a past period the target's CURRENT status is not looked at (a lot closed
   * after `to` still counted). Cancelled acts carry no cancellation date, so
   * they are never counted. A quarantine is under way at the end of `to` when
   * it started by then and is still open or was lifted after it.
   */
  async periodFigures(
    farmIds: string[],
    from: Date,
    to: Date,
  ): Promise<HealthPeriodFigures> {
    const farmId = { in: farmIds };
    const between = { gte: from, lte: to };
    const [done, overdueAtEnd, openQuarantines, incidents, biosecurityLogs] =
      await Promise.all([
        this.prisma.healthAct.groupBy({
          by: ['type'],
          where: { farmId, status: 'REALISE', doneDate: between },
          _count: { _all: true },
        }),
        this.prisma.healthAct.count({
          where: {
            farmId,
            date: { lte: to },
            OR: [
              to.getTime() >= today().getTime()
                ? overdueActWhere(addDays(to, 1))
                : { status: 'PLANIFIE' },
              {
                status: 'REALISE',
                enteredDone: false,
                doneDate: { gt: to },
              },
            ],
          },
        }),
        this.prisma.quarantine.count({
          where: {
            farmId,
            startDate: { lte: to },
            OR: [{ status: 'EN_COURS' }, { endDate: { gt: to } }],
          },
        }),
        this.prisma.healthIncident.count({ where: { farmId, date: between } }),
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
   * same period as the health list's `withdrawalUntil`. By end date, then name.
   */
  async withdrawalsAt(
    farmIds: string[],
    day: Date,
  ): Promise<{ target: string; until: Date }[]> {
    // The window (done day to done day + treatment + withdrawal days, as
    // `withdrawalPeriod`) is tested in SQL, so only the acts under withdrawal that
    // day are loaded.
    const hits = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "HealthAct"
      WHERE "farmId" IN (${Prisma.join(farmIds)})
        AND "status" = 'REALISE' AND "withdrawalDays" IS NOT NULL
        AND "doneDate" <= ${day}::date
        AND "doneDate" + (COALESCE("durationDays", 0) + "withdrawalDays") * INTERVAL '1 day' >= ${day}::date`);
    if (hits.length === 0) return [];
    const acts = await this.prisma.healthAct.findMany({
      where: { id: { in: hits.map((h) => h.id) } },
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
