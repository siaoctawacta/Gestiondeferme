import { Baby, HeartCrack, Milk } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import type { Field, ModuleConfig, RowAction, StatusDef } from '../components/module/types';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { today } from './lotsShared';
import { useBuildingOptions } from './productionShared';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/breeding`, task 5).
 * If the real backend names a field differently, this is the only place to adjust.
 * ------------------------------------------------------------------------------------------- */

export type BreedingStatus = 'GESTATION' | 'MISE_BAS' | 'SEVRAGE' | 'ECHEC';

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

const STATUSES: StatusDef[] = [
  { value: 'GESTATION', label: 'Gestation', tone: 'warning' },
  { value: 'MISE_BAS', label: 'Mise bas', tone: 'success' },
  { value: 'SEVRAGE', label: 'Sevrage', tone: 'neutral' },
  { value: 'ECHEC', label: 'Échec', tone: 'danger' },
];

const METHODS = [
  { value: 'SAILLIE', label: 'Saillie' },
  { value: 'IA', label: 'IA' },
];

const ACTIVE = (sex: 'F' | 'M') => ({ endpoint: '/animals', params: { sex, status: 'ACTIF' }, labelKey: 'tag' });

type FormProps = { row?: BreedingRecord; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

/** Add a service (the boar select or the semen text depends on the method), or change the date of one still in gestation. */
function BreedingForm({ row, onSaved, onClose }: FormProps) {
  const fields = (values: Record<string, unknown>): Field[] =>
    row
      ? [{ name: 'serviceDate', label: 'Date de saillie', type: 'date', required: true }]
      : [
          { name: 'sowId', label: 'Truie', type: 'select', required: true, options: ACTIVE('F') },
          { name: 'method', label: 'Méthode', type: 'select', required: true, defaultValue: 'SAILLIE', options: METHODS },
          (values.method ?? 'SAILLIE') === 'IA'
            ? { name: 'semenLabel', label: 'Semence', type: 'text', required: true }
            : { name: 'boarId', label: 'Verrat', type: 'select', required: true, options: ACTIVE('M') },
          { name: 'serviceDate', label: 'Date de saillie', type: 'date', required: true, defaultValue: today() },
        ];
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Reproduction`}
      fields={fields}
      initial={row ? { serviceDate: row.serviceDate } : {}}
      onSubmit={(body) => (row ? api.patch(`/breeding/${row.id}`, body) : api.post('/breeding', body))}
      onClose={onClose}
      onDone={onSaved}
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
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
        count('bornTotal', 'Nés totaux'),
        count('bornAlive', 'Nés vivants'),
        count('stillborn', 'Mort-nés'),
        { name: 'buildingId', label: 'Bâtiment de la portée', type: 'select', required: true, options: buildings },
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
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
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
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
        { name: 'note', label: 'Note', type: 'textarea' },
      ]}
      onSubmit={(body) => api.post(`/breeding/${row.id}/fail`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

const actions: RowAction<BreedingRecord>[] = [
  { key: 'farrowing', label: 'Mise bas', icon: Baby, visible: (r) => r.status === 'GESTATION', dialog: FarrowingDialog },
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
      render: (r) =>
        r.status === 'GESTATION' && r.daysToFarrowing !== null && r.daysToFarrowing < 0 ? (
          <span className="font-medium text-destructive">{r.expectedFarrowingDate}</span>
        ) : (
          r.expectedFarrowingDate
        ),
    },
  ],
  fields: [],
  statuses: STATUSES,
  statusKey: 'status',
  rowLabel: (r) => `${r.sowTag} — ${r.serviceDate}`,
  canEdit: (r) => r.status === 'GESTATION',
  canDelete: (r) => r.status === 'GESTATION',
  actions,
  form: BreedingForm,
};
