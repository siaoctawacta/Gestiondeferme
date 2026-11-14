import { useState } from 'react';
import { errorMessage } from '../components/module/errorMessage';
import type { ModuleConfig } from '../components/module/types';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Pill } from '../components/ui/Pill';
import { api } from '../lib/api';
import { useFarmQuery } from '../lib/query';
import { AnimalDetail } from '../pages/details/AnimalDetail';
import { LotDetail } from '../pages/details/LotDetail';
import { clean, orDash, text, today } from './lotsShared';
import { RecordForm, useBuildingOptions } from './productionShared';
import { ANIMAL_CATEGORIES, LOT_TYPES, STATUSES, categoryLabel, statusDef, type AnimalDetailData, type HerdRow } from './porcsShared';

export * from './porcsShared';

type FormProps = { row?: HerdRow; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

const LOT_PREFIX = 'lot-';

/** `/m/porcs/:id`: an animal, or `lot-{id}` for a pig lot. */
function PigDetail({ id }: { id: string }) {
  return id.startsWith(LOT_PREFIX) ? <LotDetail id={id.slice(LOT_PREFIX.length)} /> : <AnimalDetail id={id} />;
}

const BREEDS = { endpoint: '/breeds', params: { species: 'PORCIN' } };

const CLEARABLE = ['breedId', 'birthDate', 'sireId', 'damId', 'notes'] as const;
const ACTIVE = (sex: 'F' | 'M') => ({ endpoint: '/animals', params: { sex, status: 'ACTIF' }, labelKey: 'tag' });

/** Add an individual animal; the sex follows the category (Truie, Cochette → F; Verrat → M). */
function AnimalCreateForm({ onSaved, onClose }: Pick<FormProps, 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  return (
    <RecordForm
      label="Animal individuel"
      fields={[
        { name: 'tag', label: 'Identifiant (généré si vide)', type: 'text' },
        { name: 'category', label: 'Catégorie', type: 'select', required: true, options: ANIMAL_CATEGORIES.map(({ value, label }) => ({ value, label })) },
        { name: 'breedId', label: 'Race', type: 'select', options: BREEDS },
        { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, options: buildings },
        { name: 'birthDate', label: 'Date de naissance', type: 'date' },
        { name: 'sireId', label: 'Père', type: 'select', options: ACTIVE('M') },
        { name: 'damId', label: 'Mère', type: 'select', options: ACTIVE('F') },
      ]}
      toPayload={(v) =>
        clean(
          {
            tag: text(v.tag),
            category: v.category,
            sex: ANIMAL_CATEGORIES.find((c) => c.value === v.category)?.sex,
            breedId: v.breedId,
            buildingId: v.buildingId,
            birthDate: v.birthDate,
            sireId: v.sireId,
            damId: v.damId,
          },
          'create',
        )
      }
      createPath="/animals"
      patchPath={(r) => `/animals/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/**
 * Edit an animal: loads `GET /animals/:id` so the selects show the current values, and sends only what changed
 * (a cleared optional field as `null`). The category is fixed after creation.
 */
function AnimalEditForm({ row, onSaved, onClose }: { row: HerdRow } & Pick<FormProps, 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  const query = useFarmQuery<AnimalDetailData>(['/animals', 'detail', row.id], () => api.get<AnimalDetailData>(`/animals/${row.id}`));
  if (query.isPending || query.isError) {
    return (
      <Dialog open onClose={onClose} title="Modifier — Animal individuel">
        {query.isError ? (
          <Alert>{errorMessage(query.error)}</Alert>
        ) : (
          <div aria-busy role="status" className="h-24 animate-pulse rounded-3xl bg-muted"><span className="sr-only">Chargement…</span></div>
        )}
        <div className="mt-6 flex justify-end"><Button variant="outline" onClick={onClose}>Fermer</Button></div>
      </Dialog>
    );
  }
  const a = query.data;
  const initial: Record<string, unknown> = {
    tag: a.tag, breedId: a.breedId, buildingId: a.buildingId, birthDate: a.birthDate, sireId: a.sireId, damId: a.damId, notes: a.notes,
  };
  const was = (k: string) => String(initial[k] ?? '');
  return (
    <RecordForm
      label="Animal individuel"
      row={row}
      intro={`Catégorie : ${categoryLabel(a.category)}`}
      fields={[
        { name: 'tag', label: 'Identifiant', type: 'text', required: true },
        { name: 'breedId', label: 'Race', type: 'select', options: BREEDS },
        { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, options: buildings },
        { name: 'birthDate', label: 'Date de naissance', type: 'date' },
        { name: 'sireId', label: 'Père', type: 'select', options: ACTIVE('M') },
        { name: 'damId', label: 'Mère', type: 'select', options: ACTIVE('F') },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      initial={initial}
      toPayload={(v) => {
        const out: Record<string, unknown> = {};
        for (const k of ['tag', 'buildingId', ...CLEARABLE]) {
          const now = text(v[k]);
          if (now !== was(k)) out[k] = now === '' ? null : now;
        }
        return out;
      }}
      createPath="/animals"
      patchPath={(r) => `/animals/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/** Add a pig lot: `POST /batches` with the species. */
function LotForm({ onSaved, onClose }: Pick<FormProps, 'onSaved' | 'onClose'>) {
  const buildings = useBuildingOptions('PORCIN');
  return (
    <RecordForm
      label="Lot de porcs"
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
      createPath="/batches"
      patchPath={(r) => `/batches/${r.id}`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}

/** `Ajouter`: asks whether it is an individual animal or a lot, then shows the matching form. */
function PigForm({ row, onSaved, onClose }: FormProps) {
  const [kind, setKind] = useState<'ANIMAL' | 'LOT' | null>(null);
  if (row) return <AnimalEditForm row={row} onSaved={onSaved} onClose={onClose} />;
  if (kind === 'ANIMAL') return <AnimalCreateForm onSaved={onSaved} onClose={onClose} />;
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
  fields: [],
  statuses: STATUSES,
  statusKey: 'status',
  rowLabel: (r) => r.identifier,
  // Pig lots reuse the species-aware lot detail, under this module's route so `porcs` permissions apply.
  detailPath: (r) => (r.kind === 'LOT' ? `/m/porcs/${LOT_PREFIX}${r.id}` : `/m/porcs/${r.id}`),
  detail: PigDetail,
  // Lots are edited from their detail page; animals are edited and deleted through `/animals/:id`.
  canEdit: (r) => r.kind === 'ANIMAL',
  canDelete: (r) => r.kind === 'ANIMAL',
  deletePath: (r) => `/animals/${r.id}`,
  form: PigForm,
};

