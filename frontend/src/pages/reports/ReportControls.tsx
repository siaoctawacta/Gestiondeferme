import { useState } from 'react';
import { Field } from '../../components/ui/Field';
import { TabBar } from '../../components/module/TabBar';
import { todayIso } from '../../lib/format';
import { reportParams, type ReportSelection, type ReportType, type ReportTypesDto } from './reportTypes';

export interface ReportControlsProps {
  /** Ties the tabs to the panel that holds the report (`panelId`). */
  idBase: string;
  /** Why the chosen period cannot be requested, shown under the fields. */
  rangeError?: string | null;
  types: ReportTypesDto['types'];
  selection: ReportSelection;
  onChange: (next: ReportSelection) => void;
}

/** The tabs of the listed report types and the period inputs of the active one (never later than today). */
export function ReportControls({ idBase, rangeError, types, selection, onChange }: ReportControlsProps) {
  const [yearDraft, setYearDraft] = useState<string | null>(null);
  const today = todayIso();
  const p = reportParams(selection);
  const maxYear = Number(today.slice(0, 4));
  const set = (patch: Partial<ReportSelection>) => onChange({ ...selection, ...patch });
  const date = (label: string) => (
    <Field label={label} type="date" max={today} value={p.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
  );
  return (
    <div className="print:hidden">
      <TabBar
        idBase={idBase}
        tabs={types.map((t) => ({ key: t.type, label: t.label }))}
        active={selection.type}
        onChange={(key) => onChange({ type: key as ReportType })}
      />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        {selection.type === 'quotidien' && date('Jour')}
        {selection.type === 'hebdomadaire' && date('Semaine du')}
        {selection.type === 'mensuel' && (
          <Field
            label="Mois" type="month" max={today.slice(0, 7)} value={p.date.slice(0, 7)}
            onChange={(e) => e.target.value && set({ date: `${e.target.value}-01` })}
          />
        )}
        {selection.type === 'annuel' && (
          <Field
            label="Année" type="number" min={2000} max={maxYear} value={yearDraft ?? p.date.slice(0, 4)}
            onBlur={() => setYearDraft(null)}
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}$/.test(v) && Number(v) >= 2000 && Number(v) <= maxYear) {
                setYearDraft(null);
                set({ date: `${v}-01-01` });
              } else setYearDraft(v);
            }}
          />
        )}
        {(selection.type === 'sanitaire' || selection.type === 'zootechnique') && (
          <>
            <Field label="Du" type="date" max={today} value={p.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <Field label="Au" type="date" max={today} value={p.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </>
        )}
      </div>
      {rangeError && <p role="alert" className="-mt-4 mb-6 text-sm text-destructive">{rangeError}</p>}
    </div>
  );
}
