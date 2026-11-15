import type { ModuleConfig, StatusDef } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import type { ModuleKey } from '../lib/modules';
import { formatDecimal, formatNumber, todayIso } from '../lib/format';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/batches`, `/batches/:id/events`, `/batches/:id/weighings`).
 * If the real backend names a field differently, this is the only place to adjust.
 * ------------------------------------------------------------------------------------------- */

export type BatchType = 'CHAIR' | 'PONDEUSE' | 'POUSSIN' | 'REPRODUCTEUR';
export type BatchStatus = 'EN_COURS' | 'CLOTURE';

export interface Batch {
  id: string;
  code: string;
  type: BatchType | string;
  breedId: string | null;
  breedName: string | null;
  buildingId: string;
  buildingName: string;
  /** `YYYY-MM-DD` */
  entryDate: string;
  initialCount: number;
  deaths: number;
  alive: number;
  mortalityRate: number | null;
  averageWeightG: number | null;
  status: BatchStatus;
  ageDays: number;
}

export interface BatchPerformance {
  ageDays: number | null;
  alive: number | null;
  deaths: number | null;
  mortalityRate: number | null;
  firstWeightG: number | null;
  lastWeightG: number | null;
  dailyGainG: number | null;
  feedKg: number | null;
  feedConversion: number | null;
  feedCost: number | null;
}

/** `GET /batches/:id`. */
export interface BatchDetail extends Batch {
  /** Lets the detail screen be shared with pig lots (labels come from the loaded batch). */
  species?: 'AVICOLE' | 'PORCIN';
  supplierName: string | null;
  purchasePrice: number | null;
  responsibleId: string | null;
  responsibleName: string | null;
  closedAt: string | null;
  notes: string | null;
  /** `YYYY-MM-DD`: end of the withdrawal period of the latest done treatment (absent on an API without health). */
  withdrawalUntil?: string | null;
  performance: BatchPerformance;
}

export type BatchEventType = 'MORTALITE' | 'VENTE' | 'REFORME' | 'ENTREE' | 'NAISSANCE' | 'TRANSFERT_SORTIE' | 'TRANSFERT_ENTREE';

export interface BatchEvent {
  id: string;
  date: string;
  type: BatchEventType;
  quantity: number;
  cause: string | null;
  note: string | null;
}

export interface Weighing {
  id: string;
  date: string;
  sampleSize: number;
  averageWeightG: number;
  note: string | null;
}

/* --------------------------------------------------------------------------------------------- */

export const TYPE_LABELS: Record<string, string> = {
  CHAIR: 'Chair',
  PONDEUSE: 'Pondeuse',
  POUSSIN: 'Poussin',
  REPRODUCTEUR: 'Reproducteur',
  PORCELET: 'Porcelets',
  ENGRAISSEMENT: 'Engraissement',
};

export const AVIAN_TYPES = (['CHAIR', 'PONDEUSE', 'POUSSIN', 'REPRODUCTEUR'] as const).map((value) => ({ value, label: TYPE_LABELS[value] }));

export const STATUSES: StatusDef[] = [
  { value: 'EN_COURS', label: 'En cours', tone: 'warning' },
  { value: 'CLOTURE', label: 'Clôturé', tone: 'success' },
];

export const EVENT_LABELS: Record<string, { label: string; tone: PillTone }> = {
  MORTALITE: { label: 'Mortalité', tone: 'danger' },
  VENTE: { label: 'Vente', tone: 'neutral' },
  REFORME: { label: 'Réforme', tone: 'neutral' },
  ENTREE: { label: 'Entrée', tone: 'success' },
  NAISSANCE: { label: 'Naissance', tone: 'success' },
  TRANSFERT_SORTIE: { label: 'Transfert (sortie)', tone: 'neutral' },
  TRANSFERT_ENTREE: { label: 'Transfert (entrée)', tone: 'neutral' },
};
const MANUAL_EVENTS = ['MORTALITE', 'VENTE', 'REFORME', 'ENTREE', 'NAISSANCE'] as const;

/** Why a lot cannot be edited or deleted (an open lot that lost animals or sold some has history: the API answers 409 for it). */
export const lotLocked = (b: { status: string }): string | true => (b.status === 'CLOTURE' ? 'Lot clôturé' : true);
export const lotHasHistory = (b: Pick<Batch, 'deaths' | 'alive' | 'initialCount'> & { status: string }): string | true =>
  b.status === 'CLOTURE' ? 'Lot clôturé' : b.deaths === 0 && b.alive === b.initialCount ? true : 'Lot avec historique — clôturez-le';

export const text = (v: unknown) => String(v ?? '').trim();
export const num = (v: unknown) => (text(v) === '' ? '' : Number(v));

/** Events of one lot (mortality, sales, culls…); the batch id is part of the endpoint, so no `scope`. */
export function batchEvents(batchId: string, slug: ModuleKey = 'lots'): ModuleConfig<BatchEvent> {
  return {
    slug,
    exportable: false,
    group: 'Production',
    title: 'Mouvements',
    subtitle: 'Mouvements du lot.',
    endpoint: `/batches/${batchId}/events`,
    columns: [
      { key: 'date', header: 'DATE' },
      {
        key: 'type',
        header: 'TYPE',
        render: (e) => {
          const def = EVENT_LABELS[e.type];
          return <Pill tone={def?.tone ?? 'neutral'}>{def?.label ?? e.type}</Pill>;
        },
      },
      { key: 'quantity', header: 'QUANTITÉ', align: 'right', render: (e) => formatNumber(e.quantity) },
      { key: 'cause', header: 'CAUSE', render: (e) => e.cause ?? '' },
      { key: 'note', header: 'NOTE', render: (e) => e.note ?? '' },
    ],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
      {
        name: 'type',
        label: 'Type',
        type: 'select',
        required: true,
        options: MANUAL_EVENTS.map((value) => ({ value, label: EVENT_LABELS[value].label })),
      },
      { name: 'quantity', label: 'Quantité', type: 'number', required: true, min: 1, step: 1 },
      { name: 'cause', label: 'Cause', type: 'text' },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    rowLabel: (e) => `${EVENT_LABELS[e.type]?.label ?? e.type} du ${e.date}`,
    // Daily entries: whoever may enter one may correct or delete it.
    editPermission: 'create',
    deletePermission: 'create',
    // Transfers are written by the transfer action only.
    canEdit: (e) => (MANUAL_EVENTS as readonly string[]).includes(e.type),
    canDelete: (e) => (MANUAL_EVENTS as readonly string[]).includes(e.type),
    toPayload: (v) => ({ date: v.date, type: v.type, quantity: num(v.quantity), cause: text(v.cause), note: text(v.note) }),
  };
}

/** Kilograms to the grams the API stores (whole grams). */
const toGrams = (kg: unknown) => (text(kg) === '' ? '' : Math.round(Number(kg) * 1000));

/**
 * Weighings of one lot. The API stores grams: poultry is entered and shown in grams, pigs in kilograms (the
 * form asks `Poids moyen (kg)` and converts, rows are shown divided by 1000).
 */
export function batchWeighings(batchId: string, slug: ModuleKey = 'lots', species: 'AVICOLE' | 'PORCIN' = 'AVICOLE'): ModuleConfig<Weighing> {
  const pig = species === 'PORCIN';
  return {
    slug,
    exportable: false,
    group: 'Production',
    title: 'Pesées',
    subtitle: 'Pesées du lot.',
    endpoint: `/batches/${batchId}/weighings`,
    columns: [
      { key: 'date', header: 'DATE' },
      { key: 'sampleSize', header: "ÉCHANTILLON", align: 'right', render: (w) => formatNumber(w.sampleSize) },
      pig
        ? { key: 'averageWeightG', header: 'POIDS MOYEN', align: 'right', render: (w) => `${formatDecimal(w.averageWeightG / 1000, 2)} kg` }
        : { key: 'averageWeightG', header: 'POIDS MOYEN (G)', align: 'right', render: (w) => formatNumber(w.averageWeightG) },
      { key: 'note', header: 'NOTE', render: (w) => w.note ?? '' },
    ],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
      { name: 'sampleSize', label: "Taille de l'échantillon", type: 'number', required: true, min: 1, step: 1 },
      pig
        ? { name: 'averageWeightKg', label: 'Poids moyen (kg)', type: 'number', required: true, min: 0.1, step: 0.1 }
        : { name: 'averageWeightG', label: 'Poids moyen (g)', type: 'number', required: true, min: 1, step: 1 },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    rowLabel: (w) => `Pesée du ${w.date}`,
    editPermission: 'create',
    deletePermission: 'create',
    toForm: (w) => ({ ...w, averageWeightKg: w.averageWeightG / 1000 }),
    toPayload: (v) => ({
      date: v.date,
      sampleSize: num(v.sampleSize),
      averageWeightG: pig ? toGrams(v.averageWeightKg) : num(v.averageWeightG),
      note: text(v.note),
    }),
  };
}
