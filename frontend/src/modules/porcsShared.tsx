import type { ModuleConfig, StatusDef } from '../components/module/types';
import { formatNumber } from '../lib/format';
import { clean, num, text, today } from './lotsShared';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/pig-herd`, `/animals`, task 5).
 * If the real backend names a field differently, this is the only place to adjust.
 * ------------------------------------------------------------------------------------------- */

/**
 * `GET /pig-herd`: animals and pig lots in one list; ids are unique across kinds. The response also carries
 * `statusCounts` (a lot in progress counts as `ACTIF`) and `totalPigs` (the sum of `headcount`).
 */
export interface HerdRow {
  id: string;
  kind: 'ANIMAL' | 'LOT';
  /** Tag (animal) or code (lot). */
  identifier: string;
  /** `Truie`, `Verrat`, `Cochette`, `Porcelets` or `Engraissement`. */
  category: string;
  breedName: string | null;
  buildingName: string;
  /** Animals (`null` for a lot). */
  birthDate: string | null;
  /** Lots (`null` for an animal). */
  entryDate: string | null;
  weightKg: number | null;
  /** Animals housed: 1 for an animal still on the farm, the live count of an open lot, 0 for an exited animal or a closed lot. */
  headcount: number;
  /** Animal: `ACTIF`… `REFORME`; lot: `EN_COURS` or `CLOTURE`. */
  status: string;
}

/** `GET /animals/:id`. */
export interface AnimalDetailData {
  id: string;
  tag: string;
  category: 'TRUIE' | 'VERRAT' | 'COCHETTE';
  sex: 'F' | 'M';
  breedId: string | null;
  breedName: string | null;
  buildingId: string;
  buildingName: string;
  birthDate: string | null;
  sireId: string | null;
  sireTag: string | null;
  damId: string | null;
  damTag: string | null;
  status: string;
  weightKg: number | null;
  exitDate: string | null;
  exitReason: string | null;
  notes: string | null;
}

/** `GET /animals/:id/weighings`. */
export interface AnimalWeighing {
  id: string;
  date: string;
  weightKg: number;
}

/** `GET /animals/:id/heats`. */
export interface Heat {
  id: string;
  date: string;
  note: string | null;
}

/** `GET /animals/:id/breeding-history`: the sow's records (newest first) with their litter figures, and the totals. */
export interface BreedingHistory {
  records: {
    id: string;
    serviceDate: string;
    sire: string;
    farrowingDate: string | null;
    bornTotal: number | null;
    bornAlive: number | null;
    weanedCount: number | null;
    status: string;
  }[];
  totals: { litters: number; averageBornAlive: number | null; averageWeaned: number | null };
}

/* --------------------------------------------------------------------------------------------- */

export const ANIMAL_CATEGORIES = [
  { value: 'TRUIE', label: 'Truie', sex: 'F' },
  { value: 'VERRAT', label: 'Verrat', sex: 'M' },
  { value: 'COCHETTE', label: 'Cochette', sex: 'F' },
] as const;

export const LOT_TYPES = [
  { value: 'PORCELET', label: 'Porcelets' },
  { value: 'ENGRAISSEMENT', label: 'Engraissement' },
];

/** Category enum for a list label (`Truie` → `TRUIE`); unknown values come back unchanged. */
export const categoryLabel = (value: string) => ANIMAL_CATEGORIES.find((c) => c.value === value)?.label ?? value;

export const STATUSES: StatusDef[] = [
  { value: 'ACTIF', label: 'Actif', tone: 'success' },
  { value: 'GESTANTE', label: 'Gestante', tone: 'warning' },
  { value: 'ALLAITANTE', label: 'Allaitante', tone: 'warning' },
  { value: 'VENDU', label: 'Vendu', tone: 'neutral' },
  { value: 'MORT', label: 'Mort', tone: 'danger' },
  { value: 'REFORME', label: 'Réformé', tone: 'neutral' },
];

/** Status of a herd row: a lot in progress reads `Actif`, a closed one is neutral. */
export function statusDef(row: Pick<HerdRow, 'kind' | 'status'>): StatusDef {
  if (row.kind === 'LOT') {
    return row.status === 'CLOTURE'
      ? { value: 'CLOTURE', label: 'Clôturé', tone: 'neutral' }
      : { value: 'ACTIF', label: 'Actif', tone: 'success' };
  }
  return STATUSES.find((s) => s.value === row.status) ?? { value: row.status, label: row.status, tone: 'neutral' };
}

/** `42 j`, `8 mois` or `3 ans` from a birth date; `—` when unknown. */
export function ageLabel(birthDate: string | null | undefined, now: Date = new Date()): string {
  if (!birthDate) return '—';
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return '—';
  const days = Math.floor((now.getTime() - born.getTime()) / 86_400_000);
  if (days < 0) return '—';
  if (days < 60) return `${days} j`;
  const months = Math.floor(days / 30.44);
  return months < 24 ? `${months} mois` : `${Math.floor(months / 12)} ans`;
}

/** Weighings of one animal. */
export function animalWeighings(animalId: string): ModuleConfig<AnimalWeighing> {
  return {
    slug: 'porcs',
    exportable: false,
    group: 'Production',
    title: 'Pesées',
    subtitle: "Pesées de l'animal.",
    endpoint: `/animals/${animalId}/weighings`,
    columns: [
      { key: 'date', header: 'DATE' },
      { key: 'weightKg', header: 'POIDS (KG)', align: 'right', render: (w) => formatNumber(w.weightKg) },
    ],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
      { name: 'weightKg', label: 'Poids (kg)', type: 'number', required: true, min: 0.1, step: 0.1 },
    ],
    rowLabel: (w) => `Pesée du ${w.date}`,
    canEdit: () => false,
    canDelete: () => false,
    toPayload: (v) => clean({ date: v.date, weightKg: num(v.weightKg) }, 'create'),
  };
}

/** Heats of one sow. */
export function animalHeats(animalId: string): ModuleConfig<Heat> {
  return {
    // The API serves heats and breeding history under the `reproduction` module.
    slug: 'reproduction',
    exportable: false,
    group: 'Production',
    title: 'Chaleurs',
    subtitle: 'Chaleurs de la truie.',
    endpoint: `/animals/${animalId}/heats`,
    columns: [
      { key: 'date', header: 'DATE' },
      { key: 'note', header: 'NOTE', render: (h) => h.note ?? '' },
    ],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    rowLabel: (h) => `Chaleurs du ${h.date}`,
    canEdit: () => false,
    canDelete: () => false,
    toPayload: (v) => clean({ date: v.date, note: text(v.note) }, 'create'),
  };
}
