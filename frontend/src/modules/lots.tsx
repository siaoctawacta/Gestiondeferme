import type { ModuleConfig } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import { formatNumber, formatPct, orDash } from '../lib/format';
import { LotDetail } from '../pages/details/LotDetail';
import { LotForm } from './lotForm';
import { STATUSES, TYPE_LABELS, lotHasHistory, lotLocked, type Batch } from './lotsShared';

/** Mortality pill tone: under 3 % success, 3 to 6 % warning, above 6 % danger. */
export const mortalityTone = (rate: number): PillTone => (rate < 3 ? 'success' : rate <= 6 ? 'warning' : 'danger');

function AvianLotForm({ row, onSaved, onClose }: { row?: Batch; onSaved: () => void; onClose: () => void }) {
  return <LotForm species="AVICOLE" id={row?.id} onSaved={onSaved} onClose={onClose} />;
}

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
      render: (b) => (b.mortalityRate === null ? '—' : <Pill tone={mortalityTone(b.mortalityRate)}>{formatPct(b.mortalityRate)}</Pill>),
    },
  ],
  statuses: STATUSES,
  statusKey: 'status',
  rowLabel: (b) => b.code,
  detail: LotDetail,
  createPermission: 'update',
  canEdit: lotLocked,
  canDelete: lotHasHistory,
  form: AvianLotForm,
};
