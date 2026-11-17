import { useEffect, useId, useState } from 'react';
import { ActionDialog } from '../components/module/ActionDialog';
import type { LineRow } from '../components/module/types';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import { todayIso } from '../lib/format';
import { useFarmQuery } from '../lib/query';
import { ATTENDANCE_STATUSES, type AttendanceRow } from './personnelShared';
import type { EmployeeOption } from './tachesShared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A typed date is taken once the user pauses, so the grid does not reload at every digit. */
const SETTLE_MS = 400;
const LOADING_SHEET = 'Chargement de la feuille du jour…';
const LOSE_EDITS = 'Les saisies non enregistrées de cette journée seront perdues.';
const HOURS_ONLY_PRESENT = "Les heures ne s'indiquent que pour une présence";

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground after:ml-0.5 after:text-destructive after:content-['*']">Date</label>
      <Input id={id} type="date" max={todayIso()} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * The attendance sheet of one day: the `Date` and a fixed grid of the employees active that day (`Employé`, `Statut`
 * default `Présent`, `Heures`, `Note`), posted as one `POST /attendance/day`. A sheet already entered for the day is
 * loaded, so reopening it never resets what is there. The grid belongs to the day: its field is named after the date and
 * the visit, so choosing another date shows that day's sheet (what was typed for the previous day is dropped for good).
 */
export function AttendanceDayForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState(todayIso);
  const [date, setDate] = useState(draft);
  // The grid was touched: another day would drop what was typed, so it is asked first.
  const [edited, setEdited] = useState(false);
  // Counts the accepted day changes: the grid's field name carries it, so coming back to a day (A, B, A) starts from the
  // stored sheet again and never from what was typed there before.
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    if (!ISO_DATE.test(draft) || draft === date) return;
    const timer = setTimeout(() => {
      if (edited && !window.confirm(LOSE_EDITS)) return setDraft(date);
      setEdited(false);
      setVisit((n) => n + 1);
      setDate(draft);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [draft, date, edited]);

  const employees = useFarmQuery<{ items: EmployeeOption[] }>(['/employees', 'options', 'at', date], () => api.get('/employees/options', { at: date }));
  const entered = useFarmQuery<{ items: AttendanceRow[] }>(['/attendance', 'day', date], () => api.get('/attendance', { from: date, to: date, pageSize: 200 }));
  const failed = employees.error ?? entered.error;
  // The grid shows only once BOTH answers are in: an early edit over default rows would overwrite a stored sheet.
  const ready = employees.data !== undefined && entered.data !== undefined;
  const loading = !ready && !failed;
  const settled = draft === date;
  const rows: LineRow[] = (employees.data?.items ?? []).map((e) => {
    const stored = entered.data?.items.find((a) => a.employeeId === e.id);
    return {
      employeeId: e.id, employeeName: e.name,
      status: stored?.status ?? 'PRESENT', hours: stored?.hours == null ? '' : String(stored.hours), note: stored?.note ?? '',
    };
  });
  const field = `sheet:${date}:${visit}`;

  return (
    <ActionDialog
      title="Ajouter — Présences"
      wide
      intro={
        <div className="space-y-3">
          <DateInput value={draft} onChange={setDraft} />
          {failed ? <p role="alert" className="text-destructive">Les employés n'ont pas pu être chargés.</p>
            : loading ? <p>Chargement…</p>
              : ready && rows.length === 0 ? <p>Aucun employé n'est en poste à cette date.</p> : null}
        </div>
      }
      onEdit={() => setEdited(true)}
      fields={ready ? [{
        name: field, label: 'Présences', type: 'lines', fixed: true, defaultValue: rows,
        columns: [
          { name: 'employeeName', label: 'Employé', type: 'text', readOnly: true },
          { name: 'status', label: 'Statut', type: 'select', required: true, options: ATTENDANCE_STATUSES },
          { name: 'hours', label: 'Heures', type: 'number', min: 0.01, max: 24, step: 0.25 },
          { name: 'note', label: 'Note', type: 'text' },
        ],
      }] : []}
      validate={(v) => {
        if (!ready || !settled) return LOADING_SHEET;
        const sheet = v[field] as LineRow[];
        if (sheet.length === 0) return "Aucun employé n'est en poste à cette date";
        return sheet.some((r) => r.status !== 'PRESENT' && r.hours.trim() !== '') ? HOURS_ONLY_PRESENT : null;
      }}
      toPayload={(v) => ({
        date,
        entries: (v[field] as LineRow[]).map((r) => ({
          employeeId: r.employeeId,
          status: r.status,
          ...(r.hours.trim() !== '' ? { hours: Number(r.hours) } : {}),
          ...(r.note.trim() !== '' ? { note: r.note.trim() } : {}),
        })),
      })}
      onSubmit={(body) => api.post('/attendance/day', body)}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}
