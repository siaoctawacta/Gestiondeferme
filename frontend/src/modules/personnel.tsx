import { RecordForm } from '../components/module/RecordForm';
import type { Field, ModuleConfig } from '../components/module/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, orDash, todayIso } from '../lib/format';
import { AttendanceDayForm } from './AttendanceDayForm';
import {
  ATTENDANCE_STATUSES, CONTRACTS, EMPLOYMENT_STATUSES, contractLabel, type AttendanceRow, type EmployeeRow,
} from './personnelShared';

/** `GET /employees/user-options` (`personnel:update`): the active users of the farm not linked to an employee yet. */
const userOptions = {
  endpoint: '/employees/user-options',
  select: (data: unknown) => ((data as { items: { id: string; name: string; email: string }[] }).items ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
};

const toForm = (e: EmployeeRow) => ({
  name: e.name,
  fullName: e.fullName ?? '',
  jobTitle: e.jobTitle,
  contractType: e.contractType,
  phone: e.phone ?? '',
  hireDate: e.hireDate,
  endDate: e.endDate ?? '',
  monthlySalary: e.monthlySalary ?? '',
  userId: e.userId ?? '',
  note: e.note ?? '',
});

/** The add / edit dialog of an employee. The salary is the Comptable's (`finance:read`): without it the field does not exist, so a stored value is never overwritten blind. */
function EmployeeForm({ row, onSaved, onClose }: { row?: EmployeeRow; onSaved: () => void; onClose: () => void }) {
  const { can } = useAuth();
  const withSalary = can('finance', 'read');
  const fields: Field[] = [
    { name: 'name', label: 'Nom affiché', type: 'text', required: true, hint: 'Ex. Kodjo A.' },
    { name: 'fullName', label: 'Nom complet', type: 'text' },
    { name: 'jobTitle', label: 'Poste', type: 'text', required: true },
    { name: 'contractType', label: 'Contrat', type: 'select', required: true, defaultValue: 'CDI', options: CONTRACTS },
    { name: 'phone', label: 'Téléphone', type: 'text' },
    { name: 'hireDate', label: "Date d'embauche", type: 'date', required: true, defaultValue: todayIso },
    { name: 'endDate', label: 'Date de départ', type: 'date', only: 'update' },
    ...(withSalary ? ([{ name: 'monthlySalary', label: 'Salaire mensuel (FCFA)', type: 'number', min: 0, step: 1 }] as Field[]) : []),
    {
      name: 'userId', label: 'Compte utilisateur', type: 'select', options: userOptions, currentLabel: row?.userName ?? undefined,
      optionsPermission: { module: 'personnel', action: 'update' },
    },
    { name: 'note', label: 'Note', type: 'textarea' },
  ];
  return (
    <RecordForm
      label="Employés"
      row={row}
      fields={fields}
      initial={row ? toForm(row) : undefined}
      toPayload={(v) => ({
        name: String(v.name).trim(),
        fullName: String(v.fullName).trim(),
        jobTitle: String(v.jobTitle).trim(),
        contractType: v.contractType,
        phone: String(v.phone).trim(),
        hireDate: v.hireDate,
        endDate: v.endDate,
        ...(withSalary ? { monthlySalary: v.monthlySalary === '' ? '' : Number(v.monthlySalary) } : {}),
        userId: v.userId,
        note: String(v.note).trim(),
      })}
      createPath="/employees"
      patchPath={(r) => `/employees/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/**
 * The `Employés` tab. Employees are master data (`update` on `personnel` for every write). `SALAIRE MENSUEL` is shown
 * with `finance:read` only: the API sends `null` otherwise.
 */
export const employes: ModuleConfig<EmployeeRow> = {
  slug: 'personnel',
  group: 'Opérations',
  title: 'Employés',
  subtitle: 'Personnel de la ferme, contrats et comptes liés.',
  endpoint: '/employees',
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'jobTitle', header: 'POSTE' },
    { key: 'contractType', header: 'CONTRAT', render: (e) => contractLabel(e.contractType) },
    { key: 'phone', header: 'TÉLÉPHONE', render: (e) => e.phone ?? '—' },
    { key: 'hireDate', header: 'EMBAUCHE', render: (e) => formatDate(e.hireDate), sortable: true },
    { key: 'status', header: 'STATUT' },
    { key: 'monthlySalary', header: 'SALAIRE MENSUEL', render: (e) => orDash(e.monthlySalary, formatMoney), visible: ({ can }) => can('finance', 'read') },
  ],
  statuses: EMPLOYMENT_STATUSES,
  statusKey: 'status',
  form: EmployeeForm,
  createPermission: 'update',
  editPermission: 'update',
  deletePermission: 'update',
};

const toAttendanceForm = (a: AttendanceRow) => ({ status: a.status, hours: a.hours ?? '', note: a.note ?? '' });

/** Correction of one attendance row: its status, hours (a presence only) and note; the day and the employee are what the row is. */
function AttendanceEditForm({ row, onSaved, onClose }: { row: AttendanceRow; onSaved: () => void; onClose: () => void }) {
  const fields = (values: Record<string, unknown>): Field[] => [
    { name: 'status', label: 'Statut', type: 'select', required: true, options: ATTENDANCE_STATUSES },
    ...(values.status === 'PRESENT' ? ([{ name: 'hours', label: 'Heures', type: 'number', min: 0.01, max: 24, step: 0.25 }] as Field[]) : []),
    { name: 'note', label: 'Note', type: 'text' },
  ];
  return (
    <RecordForm
      label="Présences"
      row={row}
      intro={`${row.employeeName} — ${formatDate(row.date)}`}
      fields={fields}
      initial={toAttendanceForm(row)}
      toPayload={(v) => ({
        status: v.status,
        hours: v.status === 'PRESENT' && v.hours !== undefined && v.hours !== '' ? Number(v.hours) : '',
        note: String(v.note ?? '').trim(),
      })}
      createPath="/attendance"
      patchPath={(r) => `/attendance/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/** The `Présences` tab: the day sheet to add, one row to correct. Attendance is a daily entry (`create` on `personnel`). */
export const presences: ModuleConfig<AttendanceRow> = {
  slug: 'personnel',
  group: 'Opérations',
  title: 'Présences',
  subtitle: 'Présences, absences et heures du personnel.',
  endpoint: '/attendance',
  columns: [
    { key: 'date', header: 'DATE', render: (a) => formatDate(a.date), sortable: true },
    { key: 'employeeName', header: 'EMPLOYÉ', sortable: true },
    { key: 'status', header: 'STATUT' },
    { key: 'hours', header: 'HEURES', render: (a) => orDash(a.hours) },
    { key: 'note', header: 'NOTE', render: (a) => a.note ?? '—' },
  ],
  statuses: ATTENDANCE_STATUSES,
  statusKey: 'status',
  form: ({ row, onSaved, onClose }) => (row ? <AttendanceEditForm row={row} onSaved={onSaved} onClose={onClose} /> : <AttendanceDayForm onSaved={onSaved} onClose={onClose} />),
  rowLabel: (a) => `${a.employeeName} — ${formatDate(a.date)}`,
  editPermission: 'create',
  deletePermission: 'create',
};
