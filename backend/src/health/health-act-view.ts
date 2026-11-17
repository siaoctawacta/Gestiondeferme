import { addDays, formatDay, formatDayOrNull, today } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import type {
  AnimalStatus,
  HealthActStatus,
  HealthActType,
} from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';

/** What an act row needs of its target, loaded with it. */
export const actInclude = {
  batch: { select: { code: true, status: true } },
  animal: { select: { tag: true, status: true } },
  building: { select: { name: true } },
} satisfies Prisma.HealthActInclude;

export type ActRow = Prisma.HealthActGetPayload<{
  include: typeof actInclude;
}>;

/**
 * Animals still on the farm: the same three statuses as the pig module's
 * `LIVE_STATUSES` (health does not import pigs).
 */
export const LIVE_ANIMAL: AnimalStatus[] = ['ACTIF', 'GESTANTE', 'ALLAITANTE'];

/** Rows whose lot is open and whose animal is still on the farm (a building is always open). */
export const OPEN_TARGET = {
  AND: [
    { OR: [{ batchId: null }, { batch: { status: 'EN_COURS' as const } }] },
    {
      OR: [{ animalId: null }, { animal: { status: { in: LIVE_ANIMAL } } }],
    },
  ],
};

/**
 * Planned acts dated before `now` on an open target: the one definition of
 * `EN_RETARD`, used by the health list and by the alerts.
 */
export const overdueActWhere = (now: Date) => ({
  status: 'PLANIFIE' as const,
  date: { lt: now },
  ...OPEN_TARGET,
});

/** The stored statuses plus `EN_RETARD`, derived: planned and dated before today. */
export type ActStatus = HealthActStatus | 'EN_RETARD';

export interface HealthActItem {
  id: string;
  /** The planned date, or the day it was done for an act created as done. */
  date: string;
  doneDate: string | null;
  /**
   * The act was entered as done (not completed from a plan): PATCH `date` moves its exit too and PATCH `doneDate` is
   * refused; for an act completed later PATCH `date` moves the plan date only and `doneDate` moves the exit.
   */
  enteredDone: boolean;
  /** Lot code, animal tag or building name. */
  target: string;
  targetKind: 'LOT' | 'ANIMAL' | 'BATIMENT';
  batchId: string | null;
  animalId: string | null;
  buildingId: string | null;
  type: HealthActType;
  productName: string | null;
  stockItemId: string | null;
  stockBatchId: string | null;
  dose: string | null;
  quantity: number | null;
  durationDays: number | null;
  withdrawalDays: number | null;
  veterinarian: string | null;
  symptoms: string | null;
  diagnosis: string | null;
  status: ActStatus;
  planId: string | null;
  note: string | null;
  /** Last day (inclusive) of the withdrawal period this act causes; done acts with a withdrawal only. */
  withdrawalUntil: string | null;
}

const TYPE_LABEL: Record<HealthActType, string> = {
  VACCINATION: 'Vaccination',
  TRAITEMENT: 'Traitement',
  DESINFECTION: 'Désinfection',
  DIAGNOSTIC: 'Diagnostic',
};

const STATUS_LABEL: Record<ActStatus, string> = {
  PLANIFIE: 'Planifié',
  REALISE: 'Réalisé',
  EN_RETARD: 'En retard',
  ANNULE: 'Annulé',
};

export const ACT_STATUSES = Object.keys(STATUS_LABEL) as ActStatus[];
export const actTypeLabel = (type: HealthActType): string => TYPE_LABEL[type];

export const ACT_COLUMNS: ExportColumn<HealthActItem>[] = [
  { header: 'Date', date: true, value: (a) => a.date },
  { header: 'Lot / Animal', value: (a) => a.target },
  { header: 'Type', value: (a) => TYPE_LABEL[a.type] },
  { header: 'Produit', value: (a) => a.productName },
  { header: 'Dose', value: (a) => a.dose },
  { header: 'Vétérinaire', value: (a) => a.veterinarian },
  { header: 'Statut', value: (a) => STATUS_LABEL[a.status] },
];

/**
 * The withdrawal period a done act causes: from the day it was done to done
 * date + treatment days + withdrawal days, both inclusive. Null for an act that
 * is not done or states no withdrawal. The sale guard blocks the days INSIDE it.
 */
export function withdrawalPeriod(act: {
  status: HealthActStatus;
  doneDate: Date | null;
  durationDays: number | null;
  withdrawalDays: number | null;
}): { from: Date; until: Date } | null {
  if (act.status !== 'REALISE' || !act.doneDate) return null;
  if (act.withdrawalDays === null) return null;
  return {
    from: act.doneDate,
    until: addDays(act.doneDate, (act.durationDays ?? 0) + act.withdrawalDays),
  };
}

/** Last day under withdrawal (done date + treatment days + withdrawal days, inclusive), null when the act causes none. */
export const withdrawalEnd = (
  act: Parameters<typeof withdrawalPeriod>[0],
): Date | null => withdrawalPeriod(act)?.until ?? null;

/** What an act row calls its target: lot code, animal tag or building name. */
export const targetLabel = (row: {
  batch: { code: string } | null;
  animal: { tag: string } | null;
  building: { name: string } | null;
}): string => row.batch?.code ?? row.animal?.tag ?? row.building?.name ?? '';

export function toActItem(row: ActRow, now: Date = today()): HealthActItem {
  // A planned act on a closed lot or an exited animal can no longer be done:
  // it is not late, it waits to be cancelled.
  const open =
    row.batch?.status !== 'CLOTURE' &&
    (row.animal === null || LIVE_ANIMAL.includes(row.animal.status));
  const overdue =
    row.status === 'PLANIFIE' && open && row.date.getTime() < now.getTime();
  return {
    id: row.id,
    date: formatDay(row.date),
    doneDate: formatDayOrNull(row.doneDate),
    enteredDone: row.enteredDone,
    target: targetLabel(row),
    targetKind: row.batchId ? 'LOT' : row.animalId ? 'ANIMAL' : 'BATIMENT',
    batchId: row.batchId,
    animalId: row.animalId,
    buildingId: row.buildingId,
    type: row.type,
    productName: row.productName,
    stockItemId: row.stockItemId,
    stockBatchId: row.stockBatchId,
    dose: row.dose,
    quantity: row.quantity ? row.quantity.toNumber() : null,
    durationDays: row.durationDays,
    withdrawalDays: row.withdrawalDays,
    veterinarian: row.veterinarian,
    symptoms: row.symptoms,
    diagnosis: row.diagnosis,
    status: overdue ? 'EN_RETARD' : row.status,
    planId: row.planId,
    note: row.note,
    withdrawalUntil: formatDayOrNull(withdrawalEnd(row)),
  };
}
