import { RecordForm } from '../components/module/RecordForm';
import type { Field, RowGate, StatusDef } from '../components/module/types';
import { useAuth } from '../lib/auth';
import { todayIso } from '../lib/format';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/tasks`, `/employees/options`, Task 3). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type TaskStatus = 'A_FAIRE' | 'EN_COURS' | 'TERMINEE';
export type TaskPriority = 'NORMALE' | 'HAUTE' | 'URGENTE';
export type TaskRecurrence = 'AUCUNE' | 'QUOTIDIENNE' | 'HEBDOMADAIRE' | 'MENSUELLE';
export type TaskTargetKind = 'LOT' | 'BATIMENT' | 'EQUIPEMENT';

/** `GET /tasks`: `mine` is true when the assignee's user is the caller; `target` is the lot, building or equipment concerned. */
export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  /** `YYYY-MM-DD` */
  dueDate: string;
  /** `HH:mm` */
  dueTime: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  overdue: boolean;
  recurrence: TaskRecurrence;
  target: { kind: TaskTargetKind; id: string; label: string } | null;
  completedDate: string | null;
  hasProof: boolean;
  mine: boolean;
}

/** `GET /employees/options`: the employees active at a date (no salary). */
export interface EmployeeOption {
  id: string;
  name: string;
  jobTitle: string;
  userId: string | null;
}

/* --------------------------------------------------------------------------------------------- */

export const TASK_STATUSES: StatusDef[] = [
  { value: 'A_FAIRE', label: 'À faire', tone: 'warning' },
  { value: 'EN_COURS', label: 'En cours', tone: 'warning' },
  { value: 'TERMINEE', label: 'Terminée', tone: 'success' },
];

export const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'NORMALE', label: 'Normale' },
  { value: 'HAUTE', label: 'Haute' },
  { value: 'URGENTE', label: 'Urgente' },
];
export const priorityLabel = (p: string) => PRIORITIES.find((x) => x.value === p)?.label ?? p;

export const RECURRENCES: { value: TaskRecurrence; label: string }[] = [
  { value: 'AUCUNE', label: 'Aucune' },
  { value: 'QUOTIDIENNE', label: 'Tous les jours' },
  { value: 'HEBDOMADAIRE', label: 'Chaque semaine' },
  { value: 'MENSUELLE', label: 'Chaque mois' },
];

/**
 * The due date of the occurrence a recurring task creates when it is completed (the backend's `nextDueDate`): a day,
 * a week, or the same day of the next month clamped to its last day; `null` for a one-off task.
 */
export function nextDueDate(dueDate: string, recurrence: string): string | null {
  const d = new Date(`${dueDate}T00:00:00Z`);
  if (recurrence === 'QUOTIDIENNE' || recurrence === 'HEBDOMADAIRE') {
    d.setUTCDate(d.getUTCDate() + (recurrence === 'QUOTIDIENNE' ? 1 : 7));
  } else if (recurrence === 'MENSUELLE') {
    const day = d.getUTCDate();
    const lastOfNext = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(Math.min(day, lastOfNext));
  } else {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/** A finished task is final until it is reopened. */
export const TASK_DONE_EDIT = 'Tâche terminée — rouvrez-la';
export const TASK_DONE_DELETE = 'Une tâche terminée ne peut pas être supprimée';
export const taskEditGate = (t: TaskRow): RowGate => (t.status === 'TERMINEE' ? TASK_DONE_EDIT : true);
export const taskDeleteGate = (t: TaskRow): RowGate => (t.status === 'TERMINEE' ? TASK_DONE_DELETE : true);

/** `GET /employees/options` as select options (a single `GET` answering `{items}`; nothing is paged). */
export const employeeOptions = {
  endpoint: '/employees/options',
  select: (data: unknown) => ((data as { items: EmployeeOption[] }).items ?? []).map((e) => ({ value: e.id, label: e.name })),
};

const TARGETS: { kind: TaskTargetKind; label: string; field: string; module: 'lots' | 'batiments' | 'equipements'; options: { endpoint: string; params?: Record<string, string>; labelKey?: string } }[] = [
  { kind: 'LOT', label: 'Lot', field: 'batchId', module: 'lots', options: { endpoint: '/batches', params: { status: 'EN_COURS' }, labelKey: 'code' } },
  { kind: 'BATIMENT', label: 'Bâtiment', field: 'buildingId', module: 'batiments', options: { endpoint: '/buildings' } },
  { kind: 'EQUIPEMENT', label: 'Équipement', field: 'equipmentId', module: 'equipements', options: { endpoint: '/equipment' } },
];

const toForm = (t: TaskRow) => ({
  title: t.title,
  description: t.description ?? '',
  assigneeId: t.assigneeId ?? '',
  dueDate: t.dueDate,
  dueTime: t.dueTime ?? '',
  priority: t.priority,
  recurrence: t.recurrence,
  targetKind: t.target?.kind ?? 'NONE',
  ...Object.fromEntries(TARGETS.map((x) => [x.field, t.target?.kind === x.kind ? t.target.id : ''])),
});

/**
 * The add / edit dialog of a task, generated from fields: `Concerne` chooses what the task is about (nothing, a lot, a
 * building, a piece of equipment; the kinds the user may not read are not offered, but the task's own stays), and the
 * matching select follows. One target at most is sent, the others cleared (`null` on an edit).
 */
export function TaskForm({ row, onSaved, onClose }: { row?: TaskRow; onSaved: () => void; onClose: () => void }) {
  const { can } = useAuth();
  const offered = TARGETS.filter((x) => can(x.module, 'read') || row?.target?.kind === x.kind);
  const fields = (values: Record<string, unknown>): Field[] => [
    { name: 'title', label: 'Tâche', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'assigneeId', label: 'Responsable', type: 'select', options: employeeOptions, currentLabel: row?.assigneeName ?? undefined },
    { name: 'dueDate', label: 'Échéance', type: 'date', required: true, defaultValue: todayIso },
    { name: 'dueTime', label: 'Heure', type: 'time' },
    { name: 'priority', label: 'Priorité', type: 'select', required: true, defaultValue: 'NORMALE', options: PRIORITIES },
    { name: 'recurrence', label: 'Récurrence', type: 'select', required: true, defaultValue: 'AUCUNE', options: RECURRENCES },
    {
      name: 'targetKind', label: 'Concerne', type: 'segmented', defaultValue: 'NONE',
      options: [{ value: 'NONE', label: 'Rien' }, ...offered.map((x) => ({ value: x.kind, label: x.label }))],
    },
    ...TARGETS.filter((x) => values.targetKind === x.kind).map((x): Field => ({
      name: x.field, label: x.label, type: 'select', required: true, options: x.options, optionsPermission: { module: x.module, action: 'read' },
      currentLabel: row?.target?.kind === x.kind ? row.target.label : undefined,
    })),
  ];
  return (
    <RecordForm
      label="Tâches & personnel"
      row={row}
      fields={fields}
      initial={row ? toForm(row) : undefined}
      toPayload={(v) => ({
        title: String(v.title ?? '').trim(),
        description: String(v.description ?? '').trim(),
        assigneeId: v.assigneeId,
        dueDate: v.dueDate,
        dueTime: v.dueTime,
        priority: v.priority,
        recurrence: v.recurrence,
        // A target not shown is absent from the values: the stored one while its kind is the chosen one (what an edit is
        // compared with), cleared (`''`, sent as null on an edit) otherwise.
        ...Object.fromEntries(TARGETS.map((x) => [x.field, v.targetKind === x.kind ? v[x.field] ?? (row?.target?.kind === x.kind ? row.target.id : '') : ''])),
      })}
      createPath="/tasks"
      patchPath={(r) => `/tasks/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}
