import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import type { Field, FormMode } from '../components/module/types';
import { useEndpointOptions } from '../components/module/useEndpointOptions';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatNumber, todayIso } from '../lib/format';
import { num, text } from './lotsShared';
import {
  ACT_TYPES, LOG_TYPES, SEVERITIES, actTypeLabel, completedLater,
  type BiosecurityLogRow, type HealthActRow, type HealthActType, type IncidentRow, type QuarantineRow, type VaccinationPlanRow,
} from './santeShared';
import type { StockItemDetailData } from './stocksShared';

type Values = Record<string, unknown>;
type RowDialogProps<T> = { row: T; onClose: () => void; onDone: () => void };

/* ------------------------------------------ targets ------------------------------------------ */

const KIND_OPTIONS: { value: 'LOT' | 'ANIMAL'; label: string }[] = [{ value: 'LOT', label: 'Lot' }, { value: 'ANIMAL', label: 'Animal' }];
const NO_TARGET = "Aucune cible accessible : vous n'avez accès à aucun lot ni animal.";

/**
 * What the user may pick as a target, as the production modules do: poultry lots with read rights on `lots`, pig
 * lots and animals with read rights on `porcs` (the API checks the species module too). Only what `need` names is
 * loaded, and never what the user cannot read.
 */
export function useTargets(need: { lots?: boolean; animals?: boolean; buildings?: boolean }) {
  const { can } = useAuth();
  const poultry = can('lots', 'read');
  const pigs = can('porcs', 'read');
  const avianLots = useEndpointOptions({ endpoint: '/batches', labelKey: 'code', params: { species: 'AVICOLE', status: 'EN_COURS' } }, undefined, Boolean(need.lots) && poultry);
  const pigLots = useEndpointOptions({ endpoint: '/batches', labelKey: 'code', params: { species: 'PORCIN', status: 'EN_COURS' } }, undefined, Boolean(need.lots) && pigs);
  const animals = useEndpointOptions({ endpoint: '/animals', labelKey: 'tag', params: { status: 'ACTIF' } }, undefined, Boolean(need.animals) && pigs);
  const buildings = useEndpointOptions({ endpoint: '/buildings' }, undefined, Boolean(need.buildings));
  const kinds = KIND_OPTIONS.filter((k) => (k.value === 'LOT' ? poultry || pigs : pigs));
  return { kinds, lots: [...avianLots, ...pigLots], animals, buildings };
}

export type Targets = ReturnType<typeof useTargets>;

/** The `Lot | Animal` choice and the select of that kind (`batchId` / `animalId` of the payload); none when nothing is readable. */
function lotOrAnimalFields(values: Values, targets: Targets): Field[] {
  if (targets.kinds.length === 0) return [];
  const kind = String(values.targetKind ?? targets.kinds[0].value);
  return [
    { name: 'targetKind', label: 'Type de cible', type: 'segmented', only: 'create', defaultValue: targets.kinds[0].value, options: targets.kinds },
    kind === 'ANIMAL'
      ? { name: 'animalId', label: 'Animal', type: 'select', required: true, only: 'create', options: targets.animals }
      : { name: 'batchId', label: 'Lot', type: 'select', required: true, only: 'create', options: targets.lots },
  ];
}

/** The chosen lot or animal as payload keys. */
function lotOrAnimalPayload(values: Values, targets: Targets): Values {
  const kind = String(values.targetKind ?? targets.kinds[0]?.value ?? 'LOT');
  return kind === 'ANIMAL' ? { animalId: values.animalId } : { batchId: values.batchId };
}

/* -------------------------------------------- acts -------------------------------------------- */

const STOCK_CATEGORY: Partial<Record<HealthActType, string>> = { VACCINATION: 'VACCIN', TRAITEMENT: 'MEDICAMENT' };
/** One form field per type: a product picked for a vaccine does not follow a change of type. */
const ITEM_FIELD: Partial<Record<HealthActType, string>> = { VACCINATION: 'vaccinItemId', TRAITEMENT: 'medicamentItemId' };

const stockItemOptions = (type: HealthActType) => ({ endpoint: '/stock-items', params: { active: 'true', category: STOCK_CATEGORY[type]! } });

/** The batches in stock of `GET /stock/:itemId`, as `lot (quantity)` options. */
const batchesOf = (data: unknown) =>
  (data as StockItemDetailData).batches
    .filter((b) => b.quantity > 0)
    .map((b) => ({ value: b.id, label: `${b.lotNumber ?? 'Sans n°'} (${formatNumber(b.quantity)})` }));

const quantityField = (): Field => ({ name: 'quantity', label: 'Quantité', type: 'number', required: true, min: 0.01, step: 0.01 });

type ActFormProps = { row?: HealthActRow; scope?: Record<string, string>; onSaved: () => void; onClose: () => void };

/**
 * Add / edit a health act. The type and, when creating, the status (planned or done) are segmented choices; the
 * target is a lot or an animal (a building for a disinfection), or fixed by the scope inside a lot or animal page
 * (where a disinfection is not offered). A done vaccination or treatment may draw on a veterinary stock article
 * when the user may read stocks (quantity and product batch, the API takes FEFO when no batch is given): its
 * refusals (`Stock insuffisant`, `Lot périmé`) show in the dialog. An existing act keeps its type, target and
 * stock article.
 */
export function ActForm({ row, scope, onSaved, onClose }: ActFormProps) {
  const { can } = useAuth();
  const stockRead = can('stocks', 'read');
  const picking = !row && !scope;
  const targets = useTargets({ lots: picking, animals: picking, buildings: picking });
  const noTarget = picking && targets.kinds.length === 0;
  const types = scope ? ACT_TYPES.filter((t) => t.value !== 'DESINFECTION') : ACT_TYPES;
  const itemOf = (v: Values) => {
    const field = ITEM_FIELD[(v.type ?? 'VACCINATION') as HealthActType];
    return stockRead && field ? String(v[field] ?? '') : '';
  };

  const fields = (v: Values): Field[] => {
    const type = row?.type ?? ((v.type ?? 'VACCINATION') as HealthActType);
    const done = row ? row.status === 'REALISE' : (v.status ?? 'REALISE') === 'REALISE';
    const itemField = ITEM_FIELD[type];
    const stockItemId = row ? row.stockItemId : itemOf(v);
    const clinical = type === 'TRAITEMENT' || type === 'DIAGNOSTIC';
    const otherDay = row ? completedLater(row) : false;
    return [
      { name: 'type', label: 'Type', type: 'segmented', only: 'create', required: true, defaultValue: 'VACCINATION', options: types },
      {
        name: 'status', label: 'Statut', type: 'segmented', only: 'create', required: true, defaultValue: 'REALISE',
        options: [{ value: 'PLANIFIE', label: 'Planifié' }, { value: 'REALISE', label: 'Réalisé' }],
      },
      ...(!picking
        ? []
        : type === 'DESINFECTION'
          ? [{ name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, only: 'create', options: targets.buildings } as Field]
          : lotOrAnimalFields(v, targets)),
      // An act completed from a plan has two dates: the API moves the plan with `date` and the exit with `doneDate`.
      { name: 'date', label: otherDay ? 'Date prévue' : 'Date', type: 'date', required: true, defaultValue: todayIso },
      ...(otherDay ? [{ name: 'doneDate', label: 'Réalisé le', type: 'date', required: true } as Field] : []),
      ...(itemField && stockRead && !row
        ? [{ name: itemField, label: 'Produit en stock', type: 'select', only: 'create', options: stockItemOptions(type) } as Field]
        : []),
      ...(stockItemId ? [] : [{ name: 'productName', label: 'Produit (texte libre)', type: 'text' } as Field]),
      { name: 'dose', label: 'Dose', type: 'text' },
      ...(stockItemId && done ? [quantityField()] : []),
      ...(stockItemId && done && !row && itemField
        ? [{
            name: 'stockBatchId', label: 'Lot de produit', type: 'select', only: 'create', dependsOn: itemField,
            options: { endpoint: `/stock/{${itemField}}`, select: batchesOf },
          } as Field]
        : []),
      ...(type === 'TRAITEMENT'
        ? [
            { name: 'durationDays', label: 'Durée (jours)', type: 'number', min: 0, step: 1 } as Field,
            { name: 'withdrawalDays', label: "Délai d'attente (jours)", type: 'number', min: 0, step: 1 } as Field,
          ]
        : []),
      { name: 'veterinarian', label: 'Vétérinaire', type: 'text' },
      ...(clinical ? [{ name: 'symptoms', label: 'Symptômes', type: 'textarea' } as Field, { name: 'diagnosis', label: 'Diagnostic', type: 'textarea' } as Field] : []),
      { name: 'note', label: 'Note', type: 'text' },
    ];
  };

  const toPayload = (v: Values, mode: FormMode): Values => {
    const type = row?.type ?? ((v.type ?? 'VACCINATION') as HealthActType);
    const done = row ? row.status === 'REALISE' : (v.status ?? 'REALISE') === 'REALISE';
    const stockItemId = row ? row.stockItemId ?? '' : itemOf(v);
    const clinical = type === 'TRAITEMENT' || type === 'DIAGNOSTIC';
    const body: Values = {
      date: v.date,
      ...(row && completedLater(row) ? { doneDate: v.doneDate } : {}),
      productName: stockItemId ? '' : text(v.productName),
      dose: text(v.dose),
      quantity: stockItemId && done ? num(v.quantity) : '',
      durationDays: type === 'TRAITEMENT' ? num(v.durationDays) : '',
      withdrawalDays: type === 'TRAITEMENT' ? num(v.withdrawalDays) : '',
      veterinarian: text(v.veterinarian),
      symptoms: clinical ? text(v.symptoms) : '',
      diagnosis: clinical ? text(v.diagnosis) : '',
      note: text(v.note),
    };
    if (mode === 'update') return body;
    return {
      ...body,
      type,
      status: v.status ?? 'REALISE',
      ...(scope ?? (type === 'DESINFECTION' ? { buildingId: v.buildingId } : lotOrAnimalPayload(v, targets))),
      stockItemId,
      stockBatchId: stockItemId && done ? v.stockBatchId : '',
    };
  };

  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Santé`}
      mode={row ? 'update' : 'create'}
      initial={row as unknown as Values | undefined}
      intro={noTarget ? NO_TARGET : undefined}
      fields={fields}
      validate={(v) => (noTarget && v.type !== 'DESINFECTION' ? NO_TARGET : null)}
      toPayload={toPayload}
      onSubmit={(body) => (row ? api.patch(`/health-acts/${row.id}`, body) : api.post('/health-acts', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

/**
 * `Marquer réalisé`: the day it was done and, for an act on a stock article (or, when the user may read stocks, a
 * vaccination or treatment still in free text), the quantity and product batch. The quantity planned is prefilled.
 */
export function CompleteActDialog({ row, onClose, onDone }: RowDialogProps<HealthActRow>) {
  const { can } = useAuth();
  const stockRead = can('stocks', 'read');
  const category = STOCK_CATEGORY[row.type];
  const offerPick = !row.stockItemId && stockRead && Boolean(category);
  return (
    <ActionDialog
      title={`Marquer réalisé — ${row.target}`}
      intro={[actTypeLabel(row.type), row.productName].filter(Boolean).join(' · ')}
      initial={{ quantity: row.quantity }}
      fields={(v) => {
        const item = row.stockItemId ?? String(v.stockItemId ?? '');
        return [
          { name: 'doneDate', label: 'Date de réalisation', type: 'date', required: true, defaultValue: todayIso },
          ...(offerPick ? [{ name: 'stockItemId', label: 'Produit en stock', type: 'select', options: stockItemOptions(row.type) } as Field] : []),
          ...(item ? [quantityField()] : []),
          ...(item && stockRead
            ? [{
                name: 'stockBatchId', label: 'Lot de produit', type: 'select',
                ...(row.stockItemId
                  ? { options: { endpoint: `/stock/${row.stockItemId}`, select: batchesOf } }
                  : { dependsOn: 'stockItemId', options: { endpoint: '/stock/{stockItemId}', select: batchesOf } }),
              } as Field]
            : []),
        ];
      }}
      toPayload={(v) => ({
        doneDate: v.doneDate,
        stockItemId: row.stockItemId ? '' : v.stockItemId,
        quantity: row.stockItemId || v.stockItemId ? num(v.quantity) : '',
        stockBatchId: v.stockBatchId,
      })}
      onSubmit={(body) => api.post(`/health-acts/${row.id}/complete`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** `Annuler`: a planned act is dropped; a done one also gives its stock back (the API reverses by source). */
export const CancelActDialog = ({ row, onClose, onDone }: RowDialogProps<HealthActRow>) => (
  <ConfirmDialog
    title="Annuler l'intervention"
    message={`Annuler l'intervention du ${row.date} sur ${row.target} ?${row.status === 'REALISE' ? ' Le stock consommé sera restitué.' : ''}`}
    confirmLabel="Annuler l'intervention"
    onClose={onClose}
    onConfirm={async () => {
      await api.post(`/health-acts/${row.id}/cancel`);
      onDone();
    }}
  />
);

/* ------------------------------------------- plans ------------------------------------------- */

/** `Appliquer à un lot`: one planned vaccination per step, dated from the lot's entry date; the lots offered are the plan's species and lot type. */
export const ApplyPlanDialog = ({ row, onClose, onDone }: RowDialogProps<VaccinationPlanRow>) => (
  <ActionDialog
    title={`Appliquer — ${row.name}`}
    intro="Une vaccination planifiée est créée pour chaque étape du plan, datée à partir de l'entrée du lot."
    submitLabel="Appliquer"
    fields={[{
      name: 'batchId', label: 'Lot', type: 'select', required: true,
      options: { endpoint: '/batches', labelKey: 'code', params: { species: row.species, status: 'EN_COURS', ...(row.type ? { type: row.type } : {}) } },
    }]}
    onSubmit={(body) => api.post(`/vaccination-plans/${row.id}/apply`, body)}
    onClose={onClose}
    onDone={onDone}
  />
);

/* --------------------------------------- quarantines ----------------------------------------- */

export function QuarantineForm({ row, onSaved, onClose }: { row?: QuarantineRow; onSaved: () => void; onClose: () => void }) {
  const targets = useTargets({ lots: !row, animals: !row });
  const noTarget = !row && targets.kinds.length === 0;
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Quarantaines`}
      mode={row ? 'update' : 'create'}
      initial={row as unknown as Values | undefined}
      intro={noTarget ? NO_TARGET : undefined}
      fields={(v) => [
        ...(row ? [] : lotOrAnimalFields(v, targets)),
        { name: 'startDate', label: 'Début', type: 'date', required: true, defaultValue: todayIso },
        { name: 'endDate', label: 'Fin prévue', type: 'date' },
        { name: 'reason', label: 'Motif', type: 'text', required: true },
      ]}
      validate={() => (noTarget ? NO_TARGET : null)}
      toPayload={(v, mode) => ({
        ...(mode === 'create' ? lotOrAnimalPayload(v, targets) : {}),
        startDate: v.startDate, endDate: v.endDate, reason: text(v.reason),
      })}
      onSubmit={(body) => (row ? api.patch(`/quarantines/${row.id}`, body) : api.post('/quarantines', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

export const LiftQuarantineDialog = ({ row, onClose, onDone }: RowDialogProps<QuarantineRow>) => (
  <ActionDialog
    title={`Lever la quarantaine — ${row.target}`}
    submitLabel="Lever"
    fields={[{ name: 'date', label: 'Date de levée', type: 'date', required: true, defaultValue: todayIso }]}
    onSubmit={(body) => api.post(`/quarantines/${row.id}/lift`, body)}
    onClose={onClose}
    onDone={onDone}
  />
);

/* ---------------------------------------- incidents ------------------------------------------ */

export function IncidentForm({ row, onSaved, onClose }: { row?: IncidentRow; onSaved: () => void; onClose: () => void }) {
  // An incident targets a lot or a building, never an animal.
  const targets = useTargets({ lots: true, buildings: true });
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Incidents`}
      mode={row ? 'update' : 'create'}
      initial={row as unknown as Values | undefined}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'title', label: 'Titre', type: 'text', required: true },
        { name: 'severity', label: 'Gravité', type: 'select', required: true, defaultValue: 'MOYENNE', options: SEVERITIES.map(({ value, label }) => ({ value, label })) },
        { name: 'description', label: 'Description', type: 'textarea' },
        { name: 'batchId', label: 'Lot', type: 'select', options: targets.lots },
        { name: 'buildingId', label: 'Bâtiment', type: 'select', options: targets.buildings },
      ]}
      onSubmit={(body) => (row ? api.patch(`/incidents/${row.id}`, body) : api.post('/incidents', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}

export const CloseIncidentDialog = ({ row, onClose, onDone }: RowDialogProps<IncidentRow>) => (
  <ConfirmDialog
    title="Clore l'incident"
    message={`Clore l'incident « ${row.title} » ?`}
    confirmLabel="Clore"
    onClose={onClose}
    onConfirm={async () => {
      await api.post(`/incidents/${row.id}/close`);
      onDone();
    }}
  />
);

/* ------------------------------------------ biosecurity -------------------------------------- */

export function BiosecurityForm({ row, onSaved, onClose }: { row?: BiosecurityLogRow; onSaved: () => void; onClose: () => void }) {
  return (
    <ActionDialog
      title={`${row ? 'Modifier' : 'Ajouter'} — Biosécurité`}
      mode={row ? 'update' : 'create'}
      initial={row as unknown as Values | undefined}
      fields={(v) => {
        const type = String(v.type ?? 'NETTOYAGE');
        return [
          { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
          { name: 'type', label: 'Type', type: 'select', required: true, defaultValue: 'NETTOYAGE', options: LOG_TYPES },
          { name: 'buildingId', label: 'Bâtiment', type: 'select', options: { endpoint: '/buildings' } },
          ...(type === 'DESINFECTION' || type === 'PEDILUVE' ? [{ name: 'productName', label: 'Produit', type: 'text' } as Field] : []),
          ...(type === 'VISITEUR' ? [{ name: 'visitorName', label: 'Nom du visiteur', type: 'text' } as Field] : []),
          { name: 'note', label: 'Note', type: 'text' },
        ];
      }}
      toPayload={(v) => {
        const type = String(v.type ?? 'NETTOYAGE');
        return {
          date: v.date, type, buildingId: v.buildingId, note: text(v.note),
          productName: type === 'DESINFECTION' || type === 'PEDILUVE' ? text(v.productName) : '',
          visitorName: type === 'VISITEUR' ? text(v.visitorName) : '',
        };
      }}
      onSubmit={(body) => (row ? api.patch(`/biosecurity-logs/${row.id}`, body) : api.post('/biosecurity-logs', body))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}
