import { useId } from 'react';
import { Field } from '../../components/ui/Field';
import { TabBar } from '../../components/module/TabBar';
import { todayIso } from '../../lib/format';
import { reportParams, type ReportSelection, type ReportType, type ReportTypesDto } from './reportTypes';

export interface ReportControlsProps {
  types: ReportTypesDto['types'];
  selection: ReportSelection;
  onChange: (next: ReportSelection) => void;
}

/** The tabs of the listed report types and the period inputs of the active one (never later than today). */
export function ReportControls({ types, selection, onChange }: ReportControlsProps) {
  const idBase = useId();
  const today = todayIso();
  const p = reportParams(selection);
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
            label="Année" type="number" min={2000} max={Number(today.slice(0, 4))} value={p.date.slice(0, 4)}
            onChange={(e) => /^\d{4}$/.test(e.target.value) && set({ date: `${e.target.value}-01-01` })}
          />
        )}
        {(selection.type === 'sanitaire' || selection.type === 'zootechnique') && (
          <>
            <Field label="Du" type="date" max={today} value={p.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <Field label="Au" type="date" max={today} value={p.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </>
        )}
      </div>
    </div>
  );
}
