import { useState } from 'react';
import { LoadedRecord } from '../components/module/LoadedRecord';
import { RecordForm } from '../components/module/RecordForm';
import type { ModuleConfig } from '../components/module/types';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Pill } from '../components/ui/Pill';
import { orDash } from '../lib/format';
import { AnimalDetail } from '../pages/details/AnimalDetail';
import { LotDetail } from '../pages/details/LotDetail';
import { LotForm } from './lotForm';
import { lotLocked, text } from './lotsShared';
import { ANIMAL_CATEGORIES, STATUSES, categoryLabel, hasLeft, statusDef, type AnimalDetailData, type HerdRow } from './porcsShared';
import { activeAnimalOptions, breedOptions, useBuildingOptions } from './productionShared';

type FormProps = { row?: HerdRow; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

const LOT_PREFIX = 'lot-';

/** `/m/porcs/:id`: an animal, or `lot-{id}` for a pig lot. */
function PigDetail({ id }: { id: string }) {
  return id.startsWith(LOT_PREFIX) ? <LotDetail id={id.slice(LOT_PREFIX.length)} /> : <AnimalDetail id={id} />;
}

/** Add an individual animal; the sex follows the category (Truie, Cochette → F; Verrat → M). */
function AnimalCreateForm({ onSaved, onClose }: Pick<FormProps, 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  return (
    <RecordForm
      label="Animal individuel"
      fields={[
        { name: 'tag', label: 'Identifiant (généré si vide)', type: 'text' },
        { name: 'category', label: 'Catégorie', type: 'select', required: true, options: ANIMAL_CATEGORIES.map(({ value, label }) => ({ value, label })) },
        { name: 'breedId', label: 'Race', type: 'select', options: breedOptions('PORCIN') },
        { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, options: buildings },
        { name: 'birthDate', label: 'Date de naissance', type: 'date' },
        { name: 'sireId', label: 'Père', type: 'select', options: activeAnimalOptions('M') },
        { name: 'damId', label: 'Mère', type: 'select', options: activeAnimalOptions('F') },
      ]}
      toPayload={(v) => ({
        tag: text(v.tag),
        category: v.category,
        sex: ANIMAL_CATEGORIES.find((c) => c.value === v.category)?.sex,
        breedId: v.breedId,
        buildingId: v.buildingId,
        birthDate: v.birthDate,
        sireId: v.sireId,
        damId: v.damId,
      })}
      createPath="/animals"
      patchPath={(r) => `/animals/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/** Edit an animal: loads `GET /animals/:id` so the selects show the current values. The category is fixed after creation. */
function AnimalEditForm({ row, onSaved, onClose }: { row: HerdRow } & Pick<FormProps, 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  return (
    <LoadedRecord<AnimalDetailData> title="Modifier — Animal individuel" queryKey={['/animals', 'detail', row.id]} path={`/animals/${row.id}`} onClose={onClose}>
      {(a) => (
        <RecordForm
          label="Animal individuel"
          row={row}
          intro={`Catégorie : ${categoryLabel(a.category)}`}
          fields={[
            { name: 'tag', label: 'Identifiant', type: 'text', required: true },
            { name: 'breedId', label: 'Race', type: 'select', options: breedOptions('PORCIN') },
            { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, options: buildings },
            { name: 'birthDate', label: 'Date de naissance', type: 'date' },
            { name: 'sireId', label: 'Père', type: 'select', options: activeAnimalOptions('M') },
            { name: 'damId', label: 'Mère', type: 'select', options: activeAnimalOptions('F') },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          initial={a as unknown as Record<string, unknown>}
          createPath="/animals"
          patchPath={(r) => `/animals/${r.id}`}
          onSaved={onSaved}
          onClose={onClose}
        />
      )}
    </LoadedRecord>
  );
}

/** `Ajouter`: asks whether it is an individual animal or a lot, then shows the matching form; an edit goes straight to the row's own form. */
function PigForm({ row, onSaved, onClose }: FormProps) {
  const [kind, setKind] = useState<'ANIMAL' | 'LOT' | null>(null);
  if (row) {
    return row.kind === 'LOT'
      ? <LotForm species="PORCIN" id={row.id} onSaved={onSaved} onClose={onClose} />
      : <AnimalEditForm row={row} onSaved={onSaved} onClose={onClose} />;
  }
  if (kind === 'ANIMAL') return <AnimalCreateForm onSaved={onSaved} onClose={onClose} />;
  if (kind === 'LOT') return <LotForm species="PORCIN" onSaved={onSaved} onClose={onClose} />;
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

/** Why a herd row cannot be edited or deleted: a closed lot, an animal that left the herd (`true` otherwise; the API refuses the rest). */
const rowLocked = (r: HerdRow): string | true =>
  r.kind === 'LOT' ? lotLocked(r) : hasLeft(r.status) ? 'Animal sorti du cheptel' : true;

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
    { key: 'birthDate', header: 'DATE DE NAISSANCE', render: (r) => r.birthDate ?? r.entryDate ?? '' },
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
  statuses: STATUSES,
  statusKey: 'status',
  rowLabel: (r) => r.identifier,
  // Pig lots reuse the species-aware lot detail, under this module's route so `porcs` permissions apply.
  detailPath: (r) => (r.kind === 'LOT' ? `/m/porcs/${LOT_PREFIX}${r.id}` : `/m/porcs/${r.id}`),
  detail: PigDetail,
  createPermission: 'update',
  // An animal or a lot with history is refused by the API (409, shown in the dialog).
  canEdit: rowLocked,
  canDelete: rowLocked,
  deletePath: (r) => (r.kind === 'LOT' ? `/batches/${r.id}` : `/animals/${r.id}`),
  form: PigForm,
};
