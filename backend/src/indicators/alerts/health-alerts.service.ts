import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { addDays, formatDay, today } from '../../common/days';
import type { Prisma } from '../../generated/prisma/client';
import {
  OPEN_TARGET,
  overdueActWhere,
  targetLabel,
} from '../../health/health-act-view';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertsRegistry } from './alerts-registry';
import { ALERT_RANK } from './alert.types';
import {
  healthAlertRules,
  type HealthActAlert,
  type HealthAlertData,
} from './health-alerts';

const SELECT = {
  id: true,
  type: true,
  date: true,
  productName: true,
  batch: { select: { code: true, species: true } },
  animal: { select: { tag: true } },
  building: { select: { name: true } },
} satisfies Prisma.HealthActSelect;

type Row = Prisma.HealthActGetPayload<{ select: typeof SELECT }>;

function toAlertAct(row: Row): HealthActAlert {
  return {
    id: row.id,
    type: row.type as HealthActAlert['type'],
    date: formatDay(row.date),
    target: targetLabel(row),
    // An animal is a pig; a building has no species.
    species: row.batch ? row.batch.species : row.animal ? 'PORCIN' : undefined,
    productName: row.productName,
  };
}

/**
 * Reads the planned health acts for the vaccination and health alert rules
 * and registers them: one query each, over every farm of the request. A late
 * act is the health list's `EN_RETARD` (`overdueActWhere`), so the alerts and
 * the list cannot disagree.
 */
@Injectable()
export class HealthAlertsService implements HealthAlertData, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AlertsRegistry,
  ) {}

  /** The clock the rules read; a test replaces it. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    for (const rule of healthAlertRules(this, () => this.now()))
      this.registry.addRule(rule, ALERT_RANK.HEALTH);
  }

  async vaccinations(
    ctx: RequestContext,
    now: Date,
    days: number,
  ): Promise<HealthActAlert[]> {
    const start = today(now);
    const rows = await this.prisma.healthAct.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        type: 'VACCINATION',
        OR: [
          overdueActWhere(start),
          {
            status: 'PLANIFIE',
            date: { gte: start, lte: addDays(start, days) },
            ...OPEN_TARGET,
          },
        ],
      },
      select: SELECT,
      relationLoadStrategy: 'join',
    });
    return rows.map(toAlertAct);
  }

  async lateActs(ctx: RequestContext, now: Date): Promise<HealthActAlert[]> {
    const rows = await this.prisma.healthAct.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        type: { in: ['TRAITEMENT', 'DESINFECTION'] },
        ...overdueActWhere(today(now)),
      },
      select: SELECT,
      relationLoadStrategy: 'join',
    });
    return rows.map(toAlertAct);
  }
}
