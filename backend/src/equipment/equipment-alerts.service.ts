import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { addDays } from '../common/days';
import { ALERT_RANK } from '../indicators/alerts/alert.types';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  equipmentAlertRules,
  type AlertEquipment,
  type EquipmentAlertData,
} from './equipment-alerts';

/**
 * Reads the equipment in service for the breakdown and maintenance alert
 * rules and registers them: ONE query over the farms of the request, whatever
 * the number of equipment (the broken ones, and those whose cached next
 * maintenance is at most `warningDays` after today).
 */
@Injectable()
export class EquipmentAlertsService
  implements EquipmentAlertData, OnModuleInit
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AlertsRegistry,
  ) {}

  /** The clock the rule reads; a test replaces it. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    for (const rule of equipmentAlertRules(this, () => this.now()))
      this.registry.addRule(rule, ALERT_RANK.EQUIPMENT);
  }

  async attention(
    ctx: RequestContext,
    day: Date,
    warningDays: number,
  ): Promise<AlertEquipment[]> {
    const rows = await this.prisma.equipment.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        retiredAt: null,
        OR: [
          { condition: 'EN_PANNE' },
          { nextMaintenanceDate: { lte: addDays(day, warningDays) } },
        ],
      },
      select: {
        id: true,
        name: true,
        condition: true,
        nextMaintenanceDate: true,
        farm: { select: { name: true } },
        breakdowns: {
          where: { resolvedDate: null },
          select: { id: true },
          take: 1,
        },
      },
      relationLoadStrategy: 'join',
    });
    const several = ctx.farmIds.length > 1;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      condition: r.condition,
      nextMaintenance: r.nextMaintenanceDate,
      openBreakdownId: r.breakdowns[0]?.id ?? null,
      ...(several ? { farmName: r.farm.name } : {}),
    }));
  }
}
