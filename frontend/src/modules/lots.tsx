import { RecordDialog } from '../components/module/RecordDialog';
import type { FormMap, ModuleConfig } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import { useAuth } from '../lib/auth';
import { formatNumber } from '../lib/format';
import { LotDetail } from '../pages/details/LotDetail';
import {
  AVIAN_TYPES, STATUSES, TYPE_LABELS, clean, num, orDash, text, today, type Batch,
} from './lotsShared';

export * from './lotsShared';

/** Mortality pill tone: under 3 % success, 3 to 6 % warning, above 6 % danger. */
export const mortalityTone = (rate: number): PillTone => (rate < 3 ? 'success' : rate <= 6 ? 'warning' : 'danger');

export const lots: ModuleConfig<Batch> = {
  slug: 'lots',
  group: 'Production',
  title: 'Lots avicoles',
  subtitle: 'Poulets de chair, pondeuses, poussins et reproducteurs.',
  endpoint: '/batches',
  scope: { species: 'AVICOLE' },
  columns: [
    { key: 'code', header: 'CODE LOT' },
    { key: 'type', header: 'TYPE', render: (b) => TYPE_LABELS[b.type] ?? b.type },
    { key: 'breedName', header: 'SOUCHE' },
    { key: 'buildingName', header: 'BÂTIMENT' },
    { key: 'entryDate', header: "DATE D'ENTRÉE" },
    { key: 'initialCount', header: 'EFFECTIF INITIAL', render: (b) => formatNumber(b.initialCount) },
    { key: 'deaths', header: 'MORTALITÉ CUMULÉE', render: (b) => formatNumber(b.deaths) },
    { key: 'averageWeightG', header: 'POIDS MOYEN (G)', render: (b) => orDash(b.averageWeightG) },
    { key: 'status', header: 'STATUT' },
    { key: 'alive', header: 'VIVANTS', render: (b) => formatNumber(b.alive) },
    {
      key: 'mortalityRate',
      header: 'MORTALITÉ',
      render: (b) => (b.mortalityRate === null ? '—' : <Pill tone={mortalityTone(b.mortalityRate)}>{Math.round(b.mortalityRate * 10) / 10}%</Pill>),
    },
  ],
  fields: [
    { name: 'code', label: 'Code (généré si vide)', type: 'text', only: 'create' },
    { name: 'type', label: 'Type', type: 'select', required: true, only: 'create', options: AVIAN_TYPES },
    { name: 'breedId', label: 'Souche', type: 'select', options: { endpoint: '/breeds', params: { species: 'AVICOLE' } } },
    { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, only: 'create', options: { endpoint: '/buildings', params: { sort: 'type:asc' } } },
    { name: 'entryDate', label: "Date d'entrée", type: 'date', required: true, defaultValue: today() },
    { name: 'initialCount', label: 'Effectif initial', type: 'number', required: true, min: 1, step: 1 },
    { name: 'supplierName', label: 'Fournisseur', type: 'text' },
    { name: 'purchasePrice', label: "Prix d'achat", type: 'number', min: 0, step: 0.01 },
    { name: 'responsibleId', label: 'Responsable', type: 'select', options: { endpoint: '/users' } },
  ],
  statuses: STATUSES,
  statusKey: 'status',
  rowLabel: (b) => b.code,
  detail: LotDetail,
  canEdit: (b) => b.status !== 'CLOTURE',
  // A lot that lost animals or has been sold from has history: the API answers 409 for the others.
  canDelete: (b) => b.status !== 'CLOTURE' && b.deaths === 0 && b.alive === b.initialCount,
  toPayload: (v: FormMap, mode) =>
    clean(
      {
        code: text(v.code),
        type: v.type,
        breedId: v.breedId,
        buildingId: v.buildingId,
        entryDate: v.entryDate,
        initialCount: num(v.initialCount),
        // The list row does not carry these: on edit, an empty value means "unchanged".
        supplierName: text(v.supplierName),
        purchasePrice: num(v.purchasePrice),
        responsibleId: v.responsibleId,
        ...(mode === 'create' ? {} : { type: undefined, code: undefined, buildingId: undefined }),
      },
      mode,
      ['breedId'],
    ),
  form: LotForm,
};

/** The generated dialog, without the `Responsable` select when the user may not read the (admin-only) user list. */
function LotForm(props: { row?: Batch; scope?: Record<string, string>; onSaved: () => void; onClose: () => void }) {
  const { can } = useAuth();
  const config = can('utilisateurs', 'read') ? lots : { ...lots, fields: lots.fields.filter((f) => f.name !== 'responsibleId') };
  return <RecordDialog config={config} {...props} />;
}

