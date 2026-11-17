import { Ban, Egg, Search } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { RecordForm } from '../components/module/RecordForm';
import type { Field, ModuleConfig, RowAction, StatusDef } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import { api } from '../lib/api';
import { formatNumber, formatPct, orDash, todayIso } from '../lib/format';
import { breedOptions, useBuildingOptions, useLayingBatchOptions } from './productionShared';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/egg-production` and `/incubations`, task 4).
 * If the real backend names a field differently, this is the only place to adjust.
 * ------------------------------------------------------------------------------------------- */

/** `GET /egg-production`. */
export interface EggRecord {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  batchId: string;
  batchCode: string;
  collected: number;
  broken: number;
  downgraded: number;
  toIncubation: number;
  marketable: number;
  breakageRate: number | null;
  layingRate: number | null;
}

export type IncubationStatus = 'EN_COURS' | 'ECLOSE' | 'ECHEC';

/** `GET /incubations`. */
export interface Incubation {
  id: string;
  code: string;
  incubator: string | null;
  startDate: string;
  eggsSet: number;
  fertileEggs: number | null;
  expectedHatchDate: string;
  chicksHatched: number | null;
  hatchRate: number | null;
  fertilityRate: number | null;
  status: IncubationStatus;
}

/* --------------------------------------------------------------------------------------------- */

/** Breakage pill tone (as the reference shows 1.2 to 1.7 % green and 3.6 % yellow): under 3 % success, 3 to 5 % warning, above 5 % danger. */
export const breakageTone = (rate: number): PillTone => (rate < 3 ? 'success' : rate <= 5 ? 'warning' : 'danger');

const INCUBATION_STATUSES: StatusDef[] = [
  { value: 'EN_COURS', label: 'En cours', tone: 'warning' },
  { value: 'ECLOSE', label: 'Éclos', tone: 'success' },
  { value: 'ECHEC', label: 'Échec', tone: 'danger' },
];

const count = (name: string, label: string, extra: Partial<{ required: boolean; defaultValue: unknown }> = {}): Field => ({
  name, label, type: 'number', min: 0, step: 1, ...extra,
});

/** Create / edit dialog of a day's production; the lot select is left out inside a lot (`scope.batchId`) and when editing. */
function EggForm({ row, scope, onSaved, onClose }: { row?: EggRecord; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }) {
  const lots = useLayingBatchOptions();
  const fields: Field[] = [
    { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
    ...(scope?.batchId ? [] : [{ name: 'batchId', label: 'Lot', type: 'select', required: true, only: 'create', options: lots } as Field]),
    count('collected', 'Œufs collectés', { required: true }),
    count('broken', 'Œufs cassés', { defaultValue: 0 }),
    count('downgraded', 'Œufs déclassés', { defaultValue: 0 }),
    count('toIncubation', 'Mis en incubation', { defaultValue: 0 }),
  ];
  return (
    <RecordForm
      label="Ponte & œufs"
      row={row}
      fields={fields}
      initial={row as unknown as Record<string, unknown>}
      createPath="/egg-production"
      patchPath={(r) => `/egg-production/${r.id}`}
      scope={scope}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

function IncubationForm({ row, onSaved, onClose }: { row?: Incubation; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }) {
  const lots = useLayingBatchOptions();
  const fields: Field[] = [
    { name: 'incubator', label: 'Couveuse', type: 'text' },
    { name: 'sourceBatchId', label: "Lot d'origine", type: 'select', options: lots, only: 'create' },
    { name: 'startDate', label: 'Date de début', type: 'date', required: true, defaultValue: todayIso },
    { name: 'eggsSet', label: 'Œufs incubés', type: 'number', required: true, min: 1, step: 1 },
  ];
  return (
    <RecordForm
      label="Incubation"
      row={row}
      fields={fields}
      initial={row as unknown as Record<string, unknown>}
      createPath="/incubations"
      patchPath={(r) => `/incubations/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

type DialogProps = { row: Incubation; onClose: () => void; onDone: () => void };

function CandlingDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ActionDialog
      title={`Mirage — ${row.code}`}
      intro={`${formatNumber(row.eggsSet)} œufs incubés.`}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'fertileEggs', label: 'Œufs fertiles', type: 'number', required: true, min: 0, max: row.eggsSet, step: 1 },
      ]}
      onSubmit={(body) => api.post(`/incubations/${row.id}/candling`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function HatchDialog({ row, onClose, onDone }: DialogProps) {
  const buildings = useBuildingOptions('AVICOLE');
  return (
    <ActionDialog
      title={`Éclosion — ${row.code}`}
      intro="Les poussins éclos forment un nouveau lot."
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'chicksHatched', label: 'Poussins éclos', type: 'number', required: true, min: 0, max: row.fertileEggs ?? row.eggsSet, step: 1 },
        { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, options: buildings },
        { name: 'breedId', label: 'Souche', type: 'select', options: breedOptions('AVICOLE') },
      ]}
      onSubmit={(body) => api.post(`/incubations/${row.id}/hatch`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function FailDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ActionDialog
      title={`Échec — ${row.code}`}
      fields={[{ name: 'note', label: 'Note', type: 'textarea', required: true }]}
      onSubmit={(body) => api.post(`/incubations/${row.id}/fail`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

const running = (i: Incubation) => i.status === 'EN_COURS';
const incubationActions: RowAction<Incubation>[] = [
  { key: 'candling', label: 'Mirage', icon: Search, visible: running, dialog: CandlingDialog },
  { key: 'hatch', label: 'Éclosion', icon: Egg, visible: running, dialog: HatchDialog },
  { key: 'fail', label: 'Échec', icon: Ban, visible: running, dialog: FailDialog },
];

/** The `Incubation` tab. */
export const incubations: ModuleConfig<Incubation> = {
  slug: 'ponte',
  group: 'Production',
  title: 'Incubation',
  subtitle: 'Incubations, mirage et éclosions.',
  endpoint: '/incubations',
  columns: [
    { key: 'code', header: 'CODE' },
    { key: 'incubator', header: 'COUVEUSE', render: (i) => i.incubator ?? '' },
    { key: 'startDate', header: 'DÉBUT' },
    { key: 'eggsSet', header: 'ŒUFS INCUBÉS', render: (i) => formatNumber(i.eggsSet) },
    { key: 'fertileEggs', header: 'FERTILES', render: (i) => orDash(i.fertileEggs) },
    { key: 'expectedHatchDate', header: 'ÉCLOSION PRÉVUE' },
    { key: 'chicksHatched', header: 'POUSSINS', render: (i) => orDash(i.chicksHatched) },
    { key: 'hatchRate', header: "TAUX D'ÉCLOSION", render: (i) => orDash(i.hatchRate, formatPct) },
    { key: 'status', header: 'STATUT' },
  ],
  statuses: INCUBATION_STATUSES,
  statusKey: 'status',
  rowLabel: (i) => i.code,
  createPermission: 'update',
  canEdit: (i) => (running(i) ? true : 'Incubation terminée'),
  canDelete: (i) => (running(i) ? true : 'Incubation terminée'),
  actions: incubationActions,
  form: IncubationForm,
};

export const ponte: ModuleConfig<EggRecord> = {
  slug: 'ponte',
  group: 'Production',
  title: 'Ponte & œufs',
  subtitle: "Production d'œufs journalière, casse et incubation.",
  endpoint: '/egg-production',
  columns: [
    { key: 'date', header: 'DATE' },
    { key: 'batchCode', header: 'LOT' },
    { key: 'collected', header: 'ŒUFS COLLECTÉS', render: (e) => formatNumber(e.collected) },
    { key: 'broken', header: 'ŒUFS CASSÉS', render: (e) => formatNumber(e.broken) },
    { key: 'toIncubation', header: 'MIS EN INCUBATION', render: (e) => formatNumber(e.toIncubation) },
    {
      key: 'breakageRate',
      header: 'TAUX DE CASSE',
      render: (e) => (e.breakageRate === null ? '—' : <Pill tone={breakageTone(e.breakageRate)}>{formatPct(e.breakageRate)}</Pill>),
    },
  ],
  rowLabel: (e) => `${e.batchCode} du ${e.date}`,
  editPermission: 'create',
  deletePermission: 'create',
  form: EggForm,
  tabs: [{ key: 'incubation', label: 'Incubation', config: incubations }],
};
