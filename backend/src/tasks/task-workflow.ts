import { addDays } from '../common/days';

export const TASK_STATUS_LIST = ['A_FAIRE', 'EN_COURS', 'TERMINEE'] as const;
export type TaskStatusValue = (typeof TASK_STATUS_LIST)[number];

export const TASK_RECURRENCE_LIST = [
  'AUCUNE',
  'QUOTIDIENNE',
  'HEBDOMADAIRE',
  'MENSUELLE',
] as const;
export type TaskRecurrenceValue = (typeof TASK_RECURRENCE_LIST)[number];

/** What can be done to a task. */
export const TASK_ACTIONS = [
  'edit',
  'delete',
  'start',
  'complete',
  'reopen',
  'proof',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/** The statuses of a task that is still to be done. */
export const OPEN_STATUSES: TaskStatusValue[] = ['A_FAIRE', 'EN_COURS'];
const OPEN = OPEN_STATUSES;

/**
 * The whole workflow: each action and the statuses it may start from. A service
 * asks `can(status, action)` (or `refusal`) under the task's row lock and
 * nowhere compares a status itself. A finished task is final until reopened,
 * but its proof photo may still be added or removed (it is sent right after
 * the task is completed).
 */
const FROM: Record<TaskAction, TaskStatusValue[]> = {
  edit: OPEN,
  delete: OPEN,
  start: ['A_FAIRE'],
  complete: OPEN,
  reopen: ['TERMINEE'],
  proof: [...OPEN, 'TERMINEE'],
};

export const can = (status: TaskStatusValue, action: TaskAction): boolean =>
  FROM[action].includes(status);

const REFUSALS: Record<TaskAction, string> = {
  edit: 'Une tâche terminée ne peut plus être modifiée : rouvrez-la',
  delete: 'Une tâche terminée ne peut pas être supprimée',
  start: 'Seule une tâche à faire peut être démarrée',
  complete: 'Cette tâche est déjà terminée',
  reopen: 'Seule une tâche terminée peut être rouverte',
  proof: 'Cette tâche ne peut pas recevoir de photo',
};

/** The 409 message of an action the status does not allow, or null when it is allowed. */
export const refusal = (
  status: TaskStatusValue,
  action: TaskAction,
): string | null => (can(status, action) ? null : REFUSALS[action]);

/** The status an action leads to (null when the status does not change). */
export function statusAfter(action: TaskAction): TaskStatusValue | null {
  switch (action) {
    case 'start':
      return 'EN_COURS';
    case 'complete':
      return 'TERMINEE';
    case 'reopen':
      return 'A_FAIRE';
    default:
      return null;
  }
}

/** Nobody has started the task (what a generated occurrence must still be to be taken back). */
export const isUntouched = (status: TaskStatusValue): boolean =>
  can(status, 'start');

/** Late: still open and due before `today` (the due day itself is not late). */
export const isOverdue = (
  task: { status: TaskStatusValue; dueDate: Date },
  today: Date,
): boolean =>
  OPEN.includes(task.status) && task.dueDate.getTime() < today.getTime();

/**
 * The due date of the occurrence a recurring task creates when it is
 * completed: a day, a week, or the same day of the next month clamped to its
 * last day; null for a one-off task. Calendar days at 00:00 UTC.
 */
export function nextDueDate(
  dueDate: Date,
  recurrence: TaskRecurrenceValue,
): Date | null {
  switch (recurrence) {
    case 'QUOTIDIENNE':
      return addDays(dueDate, 1);
    case 'HEBDOMADAIRE':
      return addDays(dueDate, 7);
    case 'MENSUELLE': {
      const year = dueDate.getUTCFullYear();
      const month = dueDate.getUTCMonth() + 1;
      const lastOfNext = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      return new Date(
        Date.UTC(year, month, Math.min(dueDate.getUTCDate(), lastOfNext)),
      );
    }
    default:
      return null;
  }
}
