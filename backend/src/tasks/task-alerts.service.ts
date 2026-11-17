import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';
import { ALERT_RANK } from '../indicators/alerts/alert.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  taskAlertRules,
  type OverdueTask,
  type TaskAlertData,
} from './task-alerts';
import { OPEN_STATUSES } from './task-workflow';

/**
 * Reads the late tasks for the `Tâche en retard` rule and registers it: ONE
 * query over the farms of the request, whatever the number of tasks. The
 * list's `overdue` flag is the same rule (`isOverdue`), so the two agree.
 */
@Injectable()
export class TaskAlertsService implements TaskAlertData, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AlertsRegistry,
  ) {}

  /** The clock the rule reads; a test replaces it. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    for (const rule of taskAlertRules(this, () => this.now()))
      this.registry.addRule(rule, ALERT_RANK.TASKS);
  }

  async overdue(ctx: RequestContext, day: Date): Promise<OverdueTask[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        status: { in: OPEN_STATUSES },
        dueDate: { lt: day },
      },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        assignee: { select: { name: true } },
        farm: { select: { name: true } },
      },
      relationLoadStrategy: 'join',
    });
    const several = ctx.farmIds.length > 1;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      dueDate: r.dueDate,
      assigneeName: r.assignee?.name ?? null,
      ...(several ? { farmName: r.farm.name } : {}),
    }));
  }
}
