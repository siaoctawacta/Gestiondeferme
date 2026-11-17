import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { formatDay, today } from '../common/days';
import {
  withFarm,
  type AlertItem,
  type AlertRule,
} from '../indicators/alerts/alert.types';
import { isOverdue, type TaskStatusValue } from './task-workflow';

/** A task as the alert rule reads it. */
export interface OverdueTask {
  id: string;
  title: string;
  status: TaskStatusValue;
  dueDate: Date;
  assigneeName: string | null;
  /** Set when the request spans several farms, to tell their alerts apart. */
  farmName?: string;
}

/** What the rule reads; the task alerts service implements it over the database. */
export interface TaskAlertData {
  /** The open tasks due before `day` (`day` = today), over the farms of the request. */
  overdue(ctx: RequestContext, day: Date): Promise<OverdueTask[]>;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `Tâche en retard` (A_VOIR whatever the priority, module taches): an open task
 * (`A_FAIRE` or `EN_COURS`) due before today (`isOverdue`, the rule of the
 * list's `overdue` flag). Ordered by due date, then title, then id.
 */
export function taskAlerts(rows: OverdueTask[], now: Date): AlertItem[] {
  return rows
    .filter((r) => isOverdue(r, now))
    .sort(
      (a, b) =>
        compare(formatDay(a.dueDate), formatDay(b.dueDate)) ||
        compare(a.title, b.title) ||
        compare(a.id, b.id),
    )
    .map((r): AlertItem => {
      const detail = r.assigneeName
        ? `${r.title} (${r.assigneeName})`
        : r.title;
      return {
        key: `task:${r.id}`,
        title: 'Tâche en retard',
        detail: withFarm(detail, r.farmName),
        level: 'A_VOIR',
        module: 'taches',
        modules: ['taches'],
      };
    });
}

/** The rules of the tasks module (not run for a role without `taches` read). */
export function taskAlertRules(
  data: TaskAlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx) => {
      if (!can(ctx.user.role, 'taches', 'read')) return [];
      const day = today(now());
      return taskAlerts(await data.overdue(ctx, day), day);
    },
  ];
}
