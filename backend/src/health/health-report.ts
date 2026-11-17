import { Injectable } from '@nestjs/common';
import { addDays } from '../common/days';
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
   * What the health records say between two days (both inclusive). The late
   * acts are the health list's `EN_RETARD` (`overdueActWhere`) judged at the end
   * of `to`, like the tasks' (an act planned on `to` is late at the end of
   * it); an act planned then and done since is not counted (the list only knows
   * its present state). A quarantine is under way at the end of `to` when it
   * started by then and is still open or was lifted after it.
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
          where: { farmId, ...overdueActWhere(addDays(to, 1)) },
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
    const acts = await this.prisma.healthAct.findMany({
      where: {
        farmId: { in: farmIds },
        status: 'REALISE',
        withdrawalDays: { not: null },
        doneDate: { lte: day },
      },
      include: actInclude,
    });
    return acts
      .flatMap((act) => {
        const until = withdrawalEnd(act);
        return until && until.getTime() >= day.getTime()
          ? [{ target: targetLabel(act), until }]
          : [];
      })
      .sort(
        (a, b) =>
          a.until.getTime() - b.until.getTime() ||
          a.target.localeCompare(b.target),
      );
  }
}
