import type { FormMode, ModuleConfig, StatusDef } from '../components/module/types';
import { Pill, type PillTone } from '../components/ui/Pill';
import type { ModuleKey } from '../lib/modules';
import { formatNumber } from '../lib/format';

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
  PORCELET: 'Porcelet',
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

export const today = () => new Date().toISOString().slice(0, 10);
export const orDash = (v: number | null | undefined, fmt: (n: number) => string = formatNumber) => (v === null || v === undefined ? '—' : fmt(v));

/** Drops empty optional values from a request body (create) or turns them into `null` (update, to clear them). */
export function clean(body: Record<string, unknown>, mode: FormMode, clearable: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === '' || v === undefined) {
      if (mode === 'update' && clearable.includes(k)) out[k] = null;
    } else out[k] = v;
  }
  return out;
}

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
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
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
    // Transfers are written by the transfer action only.
    canEdit: (e) => (MANUAL_EVENTS as readonly string[]).includes(e.type),
    canDelete: (e) => (MANUAL_EVENTS as readonly string[]).includes(e.type),
    toPayload: (v, mode) =>
      clean({ date: v.date, type: v.type, quantity: num(v.quantity), cause: text(v.cause), note: text(v.note) }, mode, ['cause', 'note']),
  };
}

/** Weighings of one lot. */
export function batchWeighings(batchId: string, slug: ModuleKey = 'lots'): ModuleConfig<Weighing> {
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
      { key: 'averageWeightG', header: 'POIDS MOYEN (G)', align: 'right', render: (w) => formatNumber(w.averageWeightG) },
      { key: 'note', header: 'NOTE', render: (w) => w.note ?? '' },
    ],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
      { name: 'sampleSize', label: "Taille de l'échantillon", type: 'number', required: true, min: 1, step: 1 },
      { name: 'averageWeightG', label: 'Poids moyen (g)', type: 'number', required: true, min: 1, step: 1 },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    rowLabel: (w) => `Pesée du ${w.date}`,
    toPayload: (v, mode) =>
      clean({ date: v.date, sampleSize: num(v.sampleSize), averageWeightG: num(v.averageWeightG), note: text(v.note) }, mode, ['note']),
  };
}
