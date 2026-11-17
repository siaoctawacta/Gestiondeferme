import { formatDay, formatDayOrNull } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import type { ExportColumn } from '../listing/export';
import {
  OPEN_STATUSES,
  isOverdue,
  type TaskRecurrenceValue,
  type TaskStatusValue,
} from './task-workflow';

export const taskInclude = {
  assignee: {
    select: { name: true, userId: true, hireDate: true, endDate: true },
  },
  batch: { select: { code: true } },
  building: { select: { name: true } },
} satisfies Prisma.TaskInclude;
export type TaskRecord = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;

export type TaskTargetKind = 'LOT' | 'BATIMENT' | 'EQUIPEMENT';

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string;
  dueTime: string | null;
  priority: 'NORMALE' | 'HAUTE' | 'URGENTE';
  status: TaskStatusValue;
  overdue: boolean;
  recurrence: TaskRecurrenceValue;
  target: { kind: TaskTargetKind; id: string; label: string } | null;
  completedDate: string | null;
  hasProof: boolean;
  /** The assignee is the employee linked to the caller. */
  mine: boolean;
}

export const PRIORITY_LABELS = {
  NORMALE: 'Normale',
  HAUTE: 'Haute',
  URGENTE: 'Urgente',
} as const;
export const STATUS_LABELS: Record<TaskStatusValue, string> = {
  A_FAIRE: 'À faire',
  EN_COURS: 'En cours',
  TERMINEE: 'Terminée',
};
export const RECURRENCE_LABELS: Record<TaskRecurrenceValue, string> = {
  AUCUNE: 'Aucune',
  QUOTIDIENNE: 'Tous les jours',
  HEBDOMADAIRE: 'Chaque semaine',
  MENSUELLE: 'Chaque mois',
};

/**
 * The lot, building or equipment a task is about. The equipment label comes
 * with the equipment table (its relation joins `taskInclude`).
 */
function targetOf(row: TaskRecord): TaskItem['target'] {
  if (row.batchId && row.batch) {
    return { kind: 'LOT', id: row.batchId, label: row.batch.code };
  }
  if (row.buildingId && row.building) {
    return { kind: 'BATIMENT', id: row.buildingId, label: row.building.name };
  }
  if (row.equipmentId) {
    return { kind: 'EQUIPEMENT', id: row.equipmentId, label: '' };
  }
  return null;
}

export const toTaskItem = (
  row: TaskRecord,
  today: Date,
  userId: string,
): TaskItem => ({
  id: row.id,
  title: row.title,
  description: row.description,
  assigneeId: row.assigneeId,
  assigneeName: row.assignee?.name ?? null,
  dueDate: formatDay(row.dueDate),
  dueTime: row.dueTime,
  priority: row.priority,
  status: row.status,
  overdue: isOverdue(row, today),
  recurrence: row.recurrence,
  target: targetOf(row),
  completedDate: formatDayOrNull(row.completedDate),
  hasProof: row.proofPath !== null,
  mine: row.assignee?.userId != null && row.assignee.userId === userId,
});

/** What the audit log keeps of a task: its stored fields, not the figures computed from the clock. */
export const taskSnapshot = (row: TaskRecord) => ({
  title: row.title,
  description: row.description,
  assigneeId: row.assigneeId,
  dueDate: formatDay(row.dueDate),
  dueTime: row.dueTime,
  priority: row.priority,
  status: row.status,
  recurrence: row.recurrence,
  batchId: row.batchId,
  buildingId: row.buildingId,
  equipmentId: row.equipmentId,
  completedDate: formatDayOrNull(row.completedDate),
  hasProof: row.proofPath !== null,
});

export const taskColumns: ExportColumn<TaskItem>[] = [
  { header: 'Tâche', value: (t) => t.title },
  { header: 'Responsable', value: (t) => t.assigneeName },
  { header: 'Échéance', value: (t) => t.dueDate },
  { header: 'Heure', value: (t) => t.dueTime },
  { header: 'Priorité', value: (t) => PRIORITY_LABELS[t.priority] },
  { header: 'Statut', value: (t) => STATUS_LABELS[t.status] },
  { header: 'Cible', value: (t) => t.target?.label ?? null },
  { header: 'Récurrence', value: (t) => RECURRENCE_LABELS[t.recurrence] },
];

/**
 * The OPEN tasks of an employee due after `day` (what an employee who leaves
 * on `day` cannot keep). Finished tasks never count: their completion date is
 * whatever a manager entered, not a fact about the employee's post.
 */
export const tasksAfter = (day: Date): Prisma.TaskWhereInput => ({
  status: { in: OPEN_STATUSES },
  dueDate: { gt: day },
});

/** The open tasks of an employee due before `day` (an employee hired on `day`). */
export const tasksBefore = (day: Date): Prisma.TaskWhereInput => ({
  status: { in: OPEN_STATUSES },
  dueDate: { lt: day },
});
