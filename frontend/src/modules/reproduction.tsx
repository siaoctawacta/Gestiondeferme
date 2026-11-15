import { HeartCrack, Milk, PiggyBank } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { RecordForm } from '../components/module/RecordForm';
import type { Field, ModuleConfig, RowAction } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import { api } from '../lib/api';
import { formatNumber, todayIso } from '../lib/format';
import { BREEDING_STATUSES, type BreedingStatus } from './breedingShared';
import { activeAnimalOptions, useBuildingOptions } from './productionShared';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/breeding`, task 5).
 * If the real backend names a field differently, this is the only place to adjust.
 * ------------------------------------------------------------------------------------------- */

/** `GET /breeding`. */
export interface BreedingRecord {
  id: string;
  sowId: string;
  sowTag: string;
  /** Boar tag, or `IA {semence}`. */
  sire: string;
  serviceDate: string;
  expectedFarrowingDate: string;
  bornTotal: number | null;
  bornAlive: number | null;
  weanedCount: number | null;
  status: BreedingStatus;
  /** Negative when the farrowing is overdue. */
  daysToFarrowing: number | null;
}

/* --------------------------------------------------------------------------------------------- */

/** Warning days of the `farrowingWarningDays` setting's default: a gestation due within a week, or overdue, reads yellow. */
const FARROWING_WARNING_DAYS = 7;

/** Tone of the expected-date pill: yellow while a gestation is due soon or overdue, green otherwise. */
export const farrowingTone = (r: Pick<BreedingRecord, 'status' | 'daysToFarrowing'>): PillTone =>
  r.status === 'GESTATION' && r.daysToFarrowing !== null && r.daysToFarrowing <= FARROWING_WARNING_DAYS ? 'warning' : 'success';

const METHODS = [
  { value: 'SAILLIE', label: 'Saillie' },
  { value: 'IA', label: 'IA' },
];

type FormProps = { row?: BreedingRecord; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

/** Add a service (the boar select or the semen text depends on the method), or change the date of one still in gestation. */
function BreedingForm({ row, onSaved, onClose }: FormProps) {
  const fields = (values: Record<string, unknown>): Field[] =>
    row
      ? [{ name: 'serviceDate', label: 'Date de saillie', type: 'date', required: true }]
      : [
          { name: 'sowId', label: 'Truie', type: 'select', required: true, options: activeAnimalOptions('F') },
          { name: 'method', label: 'Méthode', type: 'select', required: true, defaultValue: 'SAILLIE', options: METHODS },
          (values.method ?? 'SAILLIE') === 'IA'
            ? { name: 'semenLabel', label: 'Semence', type: 'text', required: true }
            : { name: 'boarId', label: 'Verrat', type: 'select', required: true, options: activeAnimalOptions('M') },
          { name: 'serviceDate', label: 'Date de saillie', type: 'date', required: true, defaultValue: todayIso },
        ];
  return (
    <RecordForm
      label="Reproduction"
      row={row}
      fields={fields}
      initial={row ? { serviceDate: row.serviceDate } : {}}
      createPath="/breeding"
      patchPath={(r) => `/breeding/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

type DialogProps = { row: BreedingRecord; onClose: () => void; onDone: () => void };

function FarrowingDialog({ row, onClose, onDone }: DialogProps) {
  const buildings = useBuildingOptions('PORCIN');
  const count = (name: string, label: string): Field => ({ name, label, type: 'number', required: true, min: 0, step: 1 });
  return (
    <ActionDialog
      title={`Mise bas — ${row.sowTag}`}
      fields={(values) => [
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        count('bornTotal', 'Nés totaux'),
        count('bornAlive', 'Nés vivants'),
        count('stillborn', 'Mort-nés'),
        // The API wants the litter's building only when piglets are born alive.
        { name: 'buildingId', label: 'Bâtiment de la portée', type: 'select', required: Number(values.bornAlive) > 0, options: buildings },
      ]}
      onSubmit={(body) => api.post(`/breeding/${row.id}/farrowing`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function WeaningDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ActionDialog
      title={`Sevrage — ${row.sowTag}`}
      intro={row.bornAlive === null ? undefined : `${formatNumber(row.bornAlive)} porcelets nés vivants.`}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'weanedCount', label: 'Nombre sevrés', type: 'number', required: true, min: 0, step: 1 },
      ]}
      onSubmit={(body) => api.post(`/breeding/${row.id}/weaning`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function FailDialog({ row, onClose, onDone }: DialogProps) {
  return (
    <ActionDialog
      title={`Échec — ${row.sowTag}`}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'note', label: 'Note', type: 'textarea' },
      ]}
      onSubmit={(body) => api.post(`/breeding/${row.id}/fail`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

const actions: RowAction<BreedingRecord>[] = [
  { key: 'farrowing', label: 'Mise bas', icon: PiggyBank, visible: (r) => r.status === 'GESTATION', dialog: FarrowingDialog },
  { key: 'weaning', label: 'Sevrage', icon: Milk, visible: (r) => r.status === 'MISE_BAS', dialog: WeaningDialog },
  { key: 'fail', label: 'Échec', icon: HeartCrack, visible: (r) => r.status === 'GESTATION', dialog: FailDialog },
];

export const reproduction: ModuleConfig<BreedingRecord> = {
  slug: 'reproduction',
  group: 'Production',
  title: 'Reproduction',
  subtitle: 'Saillies, gestations, mises bas et sevrages.',
  endpoint: '/breeding',
  columns: [
    { key: 'sowTag', header: 'TRUIE' },
    { key: 'sire', header: 'VERRAT / IA' },
    { key: 'serviceDate', header: 'DATE SAILLIE' },
    { key: 'bornTotal', header: 'NÉS TOTAUX', render: (r) => formatNumber(r.bornTotal ?? 0) },
    { key: 'bornAlive', header: 'NÉS VIVANTS', render: (r) => formatNumber(r.bornAlive ?? 0) },
    { key: 'weanedCount', header: 'SEVRÉS', render: (r) => formatNumber(r.weanedCount ?? 0) },
    { key: 'status', header: 'STATUT' },
    {
      key: 'expectedFarrowingDate',
      header: 'MISE BAS PRÉVUE',
      render: (r) => <Pill tone={farrowingTone(r)}>{r.expectedFarrowingDate}</Pill>,
    },
  ],
  statuses: BREEDING_STATUSES,
  statusKey: 'status',
  rowLabel: (r) => `${r.sowTag} — ${r.serviceDate}`,
  createPermission: 'update',
  canEdit: (r) => (r.status === 'GESTATION' ? true : 'Enregistrement verrouillé'),
  canDelete: (r) => (r.status === 'GESTATION' ? true : 'Enregistrement verrouillé'),
  actions,
  form: BreedingForm,
};
