import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import type { Field, ModuleConfig, RowAction } from '../components/module/types';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Pill } from '../components/ui/Pill';
import { api } from '../lib/api';
import { AnimalDetail } from '../pages/details/AnimalDetail';
import { clean, orDash, text, today } from './lotsShared';
import { useBuildingOptions } from './productionShared';
import { ANIMAL_CATEGORIES, LOT_TYPES, STATUSES, categoryValue, statusDef, type HerdRow } from './porcsShared';

export * from './porcsShared';

type FormProps = { row?: HerdRow; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

const BREEDS = { endpoint: '/breeds', params: { species: 'PORCIN' } };

/** Request body of an animal: the sex follows the category (Truie, Cochette → F; Verrat → M). */
function animalBody(v: Record<string, unknown>, mode: 'create' | 'update') {
  const category = String(v.category ?? '');
  return clean(
    {
      tag: text(v.tag),
      category,
      sex: ANIMAL_CATEGORIES.find((c) => c.value === category)?.sex,
      breedId: v.breedId,
      buildingId: v.buildingId,
      birthDate: v.birthDate,
      sireId: v.sireId,
      damId: v.damId,
    },
    mode,
  );
}

/** Add an individual animal, or edit one (`PATCH /animals/:id`; an empty select keeps the stored value). */
function AnimalForm({ row, onSaved, onClose }: Pick<FormProps, 'row' | 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  const fields: Field[] = [
    { name: 'tag', label: 'Identifiant (généré si vide)', type: 'text' },
    { name: 'category', label: 'Catégorie', type: 'select', required: true, options: ANIMAL_CATEGORIES.map(({ value, label }) => ({ value, label })) },
    { name: 'breedId', label: 'Race', type: 'select', options: BREEDS },
    { name: 'buildingId', label: 'Bâtiment', type: 'select', required: !row, options: buildings },
    { name: 'birthDate', label: 'Date de naissance', type: 'date' },
    ...(row
      ? []
      : ([
          { name: 'sireId', label: 'Père', type: 'select', options: { endpoint: '/animals', params: { sex: 'M', status: 'ACTIF' }, labelKey: 'tag' } },
          { name: 'damId', label: 'Mère', type: 'select', options: { endpoint: '/animals', params: { sex: 'F', status: 'ACTIF' }, labelKey: 'tag' } },
        ] as Field[])),
  ];
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Animal individuel`}
      fields={fields}
      initial={row ? { tag: row.identifier, category: categoryValue(row.category), birthDate: row.birthDate } : {}}
      toPayload={(v) => animalBody(v, row ? 'update' : 'create')}
      onSubmit={(body) => (row ? api.patch(`/animals/${row.id}`, body) : api.post('/animals', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

/** Add a pig lot: `POST /batches` with the species. */
function LotForm({ onSaved, onClose }: Pick<FormProps, 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  return (
    <ActionDialog
      title="Ajouter — Lot de porcs"
      fields={[
        { name: 'type', label: 'Type', type: 'select', required: true, options: LOT_TYPES },
        { name: 'breedId', label: 'Race', type: 'select', options: BREEDS },
        { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, options: buildings },
        { name: 'entryDate', label: "Date d'entrée", type: 'date', required: true, defaultValue: today() },
        { name: 'initialCount', label: 'Effectif initial', type: 'number', required: true, min: 1, step: 1 },
      ]}
      toPayload={(v) =>
        clean(
          { species: 'PORCIN', type: v.type, breedId: v.breedId, buildingId: v.buildingId, entryDate: v.entryDate, initialCount: Number(v.initialCount) },
          'create',
        )
      }
      onSubmit={(body) => api.post('/batches', body)}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

/** `Ajouter`: asks whether it is an individual animal or a lot, then shows the matching form. */
function PigForm({ row, onSaved, onClose }: FormProps) {
  const [kind, setKind] = useState<'ANIMAL' | 'LOT' | null>(row ? 'ANIMAL' : null);
  if (kind === 'ANIMAL') return <AnimalForm row={row} onSaved={onSaved} onClose={onClose} />;
  if (kind === 'LOT') return <LotForm onSaved={onSaved} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} title="Ajouter — Cheptel porcin">
      <p className="mb-4 text-sm text-muted-foreground">Que souhaitez-vous ajouter ?</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" variant="outline" onClick={() => setKind('ANIMAL')}>Animal individuel</Button>
        <Button className="flex-1" variant="outline" onClick={() => setKind('LOT')}>Lot de porcs</Button>
      </div>
    </Dialog>
  );
}

/** Deleting goes to `/animals/:id` (the list endpoint is `/pig-herd`), so it is a row action, not the built-in button. */
const deleteAnimal: RowAction<HerdRow> = {
  key: 'delete-animal',
  label: 'Supprimer',
  icon: Trash2,
  permission: 'delete',
  visible: (r) => r.kind === 'ANIMAL',
  dialog: ({ row, onClose, onDone }) => (
    <ConfirmDialog
      title="Confirmer la suppression"
      message={`Supprimer « ${row.identifier} » ? Cette action est irréversible.`}
      onClose={onClose}
      onConfirm={async () => {
        await api.del(`/animals/${row.id}`);
        onDone();
      }}
    />
  ),
};

export const porcs: ModuleConfig<HerdRow> = {
  slug: 'porcs',
  group: 'Production',
  title: 'Cheptel porcin',
  subtitle: 'Truies, verrats, porcelets, croissance et engraissement.',
  endpoint: '/pig-herd',
  columns: [
    { key: 'identifier', header: 'IDENTIFIANT' },
    { key: 'category', header: 'CATÉGORIE' },
    { key: 'breedName', header: 'RACE', render: (r) => r.breedName ?? '' },
    { key: 'buildingName', header: 'BÂTIMENT' },
    { key: 'birthDate', header: 'DATE DE NAISSANCE', render: (r) => (r.kind === 'LOT' ? r.entryDate : r.birthDate) ?? '' },
    { key: 'weightKg', header: 'POIDS (KG)', render: (r) => orDash(r.weightKg) },
    {
      key: 'status',
      header: 'STATUT',
      render: (r) => {
        const def = statusDef(r);
        return <Pill tone={def.tone}>{def.label}</Pill>;
      },
    },
  ],
  fields: [],
  statuses: STATUSES,
  statusKey: 'status',
  rowLabel: (r) => r.identifier,
  // Pig lots have their own page (the species-aware lot detail); animals have `AnimalDetail`.
  detailPath: (r) => (r.kind === 'LOT' ? `/m/lots/${r.id}` : `/m/porcs/${r.id}`),
  detail: AnimalDetail,
  // Lots are edited from their detail page; animals through `/animals/:id`.
  canEdit: (r) => r.kind === 'ANIMAL',
  canDelete: () => false,
  actions: [deleteAnimal],
  form: PigForm,
};

