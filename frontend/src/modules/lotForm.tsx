import { LoadedRecord } from '../components/module/LoadedRecord';
import { RecordForm } from '../components/module/RecordForm';
import type { Field } from '../components/module/types';
import { useAuth } from '../lib/auth';
import { todayIso } from '../lib/format';
import { AVIAN_TYPES, num, text, type BatchDetail } from './lotsShared';
import { LOT_TYPES } from './porcsShared';
import { breedOptions, useBuildingOptions, type Species } from './productionShared';

export interface LotFormProps {
  species: Species;
  /** The lot being edited (its detail is loaded first); absent when adding. */
  id?: string;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Add / edit a lot of either species (`POST /batches`, `PATCH /batches/:id`). The type, code and building are fixed
 * once created (housing changes go through the transfer). An edit loads the lot first so the supplier, price and
 * responsible show their stored values and can be cleared. `Responsable` is left out for a user who may not
 * read the (admin-only) user list.
 */
export function LotForm({ species, id, onSaved, onClose }: LotFormProps) {
  const { can } = useAuth();
  const buildings = useBuildingOptions(species);
  const fields: Field[] = [
    { name: 'code', label: 'Code (généré si vide)', type: 'text', only: 'create' },
    { name: 'type', label: 'Type', type: 'select', required: true, only: 'create', options: species === 'AVICOLE' ? AVIAN_TYPES : LOT_TYPES },
    { name: 'breedId', label: species === 'AVICOLE' ? 'Souche' : 'Race', type: 'select', options: breedOptions(species) },
    { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, only: 'create', options: buildings },
    { name: 'entryDate', label: "Date d'entrée", type: 'date', required: true, defaultValue: todayIso },
    { name: 'initialCount', label: 'Effectif initial', type: 'number', required: true, min: 1, step: 1 },
    { name: 'supplierName', label: 'Fournisseur', type: 'text' },
    { name: 'purchasePrice', label: "Prix d'achat", type: 'number', min: 0, step: 0.01 },
    ...(can('utilisateurs', 'read') ? [{ name: 'responsibleId', label: 'Responsable', type: 'select', options: { endpoint: '/users' } } as Field] : []),
  ];

  const form = (initial?: BatchDetail) => (
    <RecordForm
      label={species === 'AVICOLE' ? 'Lots avicoles' : 'Lot de porcs'}
      row={initial}
      fields={fields}
      initial={initial as unknown as Record<string, unknown> | undefined}
      toPayload={(v, mode) => ({
        ...(mode === 'create' ? { species, code: text(v.code), type: v.type, buildingId: v.buildingId } : {}),
        breedId: v.breedId,
        entryDate: v.entryDate,
        initialCount: num(v.initialCount),
        supplierName: text(v.supplierName),
        purchasePrice: num(v.purchasePrice),
        responsibleId: v.responsibleId,
      })}
      createPath="/batches"
      patchPath={(r) => `/batches/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );

  if (!id) return form();
  return (
    <LoadedRecord<BatchDetail> title="Modifier — Lot" queryKey={['/batches', 'detail', id]} path={`/batches/${id}`} onClose={onClose}>
      {form}
    </LoadedRecord>
  );
}
