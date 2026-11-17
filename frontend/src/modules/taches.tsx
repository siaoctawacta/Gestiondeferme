import type { ModuleConfig } from '../components/module/types';
import { formatDate } from '../lib/format';
import { employes, presences } from './personnel';
import { TASK_ACTIONS } from './taskActions';
import { TASK_STATUSES, TaskForm, priorityLabel, taskDeleteGate, taskEditGate, type EmployeeOption, type TaskRow } from './tachesShared';

/**
 * `Tâches & personnel` as `m_taches.png`: the tasks of the farm with their assignee, due date and priority, and the
 * `Employés` and `Présences` tabs (read access to `personnel`). A task is a daily entry (`create` creates, edits and
 * deletes); starting, completing and reopening need `update`, limited to one's own tasks without `create`.
 */
export const taches: ModuleConfig<TaskRow> = {
  slug: 'taches',
  group: 'Opérations',
  title: 'Tâches & personnel',
  tabLabel: 'Tâches',
  subtitle: 'Planification des tâches, responsables et priorités.',
  endpoint: '/tasks',
  columns: [
    { key: 'title', header: 'TÂCHE', sortable: true },
    { key: 'assigneeName', header: 'RESPONSABLE', render: (t) => t.assigneeName ?? '—' },
    { key: 'dueDate', header: 'ÉCHÉANCE', render: (t) => formatDate(t.dueDate), sortable: true },
    { key: 'priority', header: 'PRIORITÉ', render: (t) => priorityLabel(t.priority), sortable: true },
    { key: 'status', header: 'STATUT' },
  ],
  statuses: TASK_STATUSES,
  statusKey: 'status',
  filters: [
    {
      // Only for a user who is an employee of the farm: `/employees/options` holds the user each employee is linked to.
      param: 'mine',
      allLabel: 'Toutes les tâches',
      hideWhenEmpty: true,
      options: {
        endpoint: '/employees/options',
        select: (data, { userId }) =>
          userId !== null && ((data as { items: EmployeeOption[] }).items ?? []).some((e) => e.userId === userId) ? [{ value: 'true', label: 'Mes tâches' }] : [],
      },
    },
  ],
  form: TaskForm,
  rowLabel: (t) => t.title,
  editPermission: 'create',
  deletePermission: 'create',
  canEdit: taskEditGate,
  canDelete: taskDeleteGate,
  actions: TASK_ACTIONS,
  tabs: [
    { key: 'employes', label: 'Employés', config: employes },
    { key: 'presences', label: 'Présences', config: presences },
  ],
};
