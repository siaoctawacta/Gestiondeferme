import { Injectable } from '@nestjs/common';
import { addDays, formatDay } from '../common/days';
import type { UpcomingTaskDto } from '../dashboard/dashboard.types';
import { PrismaService } from '../prisma/prisma.service';
import { OPEN_STATUSES } from './task-workflow';

/** « Terminées » on the dashboard: the tasks completed today and the 29 days before. */
export const DONE_WINDOW_DAYS = 30;

/**
 * The figures other modules read from the tasks (the dashboard, the reports):
 * each is one query over the farms given, whatever the number of tasks.
 */
@Injectable()
export class TaskReads {
  constructor(private readonly prisma: PrismaService) {}

  /** `pending`: tasks still to be done; `done`: those completed in the last 30 days up to `today`. */
  async counts(
    farmIds: string[],
    today: Date,
  ): Promise<{ done: number; pending: number }> {
    const [pending, done] = await Promise.all([
      this.prisma.task.count({
        where: { farmId: { in: farmIds }, status: { in: OPEN_STATUSES } },
      }),
      this.prisma.task.count({
        where: {
          farmId: { in: farmIds },
          status: { notIn: OPEN_STATUSES },
          completedDate: {
            gte: addDays(today, 1 - DONE_WINDOW_DAYS),
            lte: today,
          },
        },
      }),
    ]);
    return { done, pending };
  }

  /** The next open tasks: by due date, urgent first, then title. */
  async upcoming(farmIds: string[], limit = 5): Promise<UpcomingTaskDto[]> {
    const rows = await this.prisma.task.findMany({
      where: { farmId: { in: farmIds }, status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
        assignee: { select: { name: true } },
      },
      relationLoadStrategy: 'join',
      orderBy: [
        { dueDate: 'asc' },
        { priority: 'desc' },
        { title: 'asc' },
        { id: 'asc' },
      ],
      take: limit,
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      assignee: t.assignee?.name ?? '—',
      dueDate: formatDay(t.dueDate),
      priority: t.priority,
    }));
  }

  /**
   * What happened to the tasks between two days (inclusive): `completed` by
   * their completion date, `created` by the day they were entered, and
   * `overdueAtEnd` the tasks that existed at the end of `to`, were due before
   * it and were not completed by then.
   */
  async periodFigures(
    farmIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ completed: number; overdueAtEnd: number; created: number }> {
    const farmId = { in: farmIds };
    const endOfTo = addDays(to, 1);
    const [completed, created, overdueAtEnd] = await Promise.all([
      this.prisma.task.count({
        where: {
          farmId,
          status: { notIn: OPEN_STATUSES },
          completedDate: { gte: from, lte: to },
        },
      }),
      this.prisma.task.count({
        where: { farmId, createdAt: { gte: from, lt: endOfTo } },
      }),
      this.prisma.task.count({
        where: {
          farmId,
          createdAt: { lt: endOfTo },
          dueDate: { lt: to },
          OR: [
            { status: { in: OPEN_STATUSES } },
            { completedDate: { gt: to } },
          ],
        },
      }),
    ]);
    return { completed, overdueAtEnd, created };
  }
}
