import { formatDay, formatDayOrNull } from '../common/days';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type { ExportColumn } from '../listing/export';
import { maintenanceDue, type ConditionValue } from './equipment-state';

export const TYPE_LABELS: Record<string, string> = {
  COUVEUSE: 'Couveuse',
  BALANCE: 'Balance',
  POMPE: 'Pompe',
  GROUPE_ELECTROGENE: 'Groupe électrogène',
  VENTILATEUR: 'Ventilateur',
  CHAUFFAGE: 'Chauffage',
  ABREUVOIR: 'Abreuvoir',
  MANGEOIRE: 'Mangeoire',
  VEHICULE: 'Véhicule',
  AUTRE: 'Autre',
};
export const CONDITION_LABELS: Record<ConditionValue, string> = {
  BON: 'Bon',
  A_SURVEILLER: 'À surveiller',
  EN_PANNE: 'En panne',
};
export const KIND_LABELS: Record<string, string> = {
  PREVENTIVE: 'Préventive',
  CORRECTIVE: 'Corrective',
};

/**
 * What a row of the list needs: the location names, the OPEN breakdown (at
 * most one) and whether anything is attached. A resolved breakdown always has
 * its repairing intervention, so `maintenances` (one row) and the open
 * breakdown decide `hasHistory` without loading the whole history.
 */
export const equipmentInclude = {
  site: { select: { name: true } },
  building: { select: { name: true } },
  breakdowns: {
    where: { resolvedDate: null },
    select: {
      id: true,
      date: true,
      description: true,
      repairId: true,
      resolvedDate: true,
    },
  },
  maintenances: { select: { id: true }, take: 1 },
  tasks: { select: { id: true }, take: 1 },
} satisfies Prisma.EquipmentInclude;
export type EquipmentRecord = Prisma.EquipmentGetPayload<{
  include: typeof equipmentInclude;
}>;

export interface EquipmentItem {
  id: string;
  name: string;
  type: string;
  location: string | null;
  siteId: string | null;
  buildingId: string | null;
  condition: ConditionValue;
  nextMaintenance: string | null;
  maintenanceDue: boolean;
  retiredAt: string | null;
  openBreakdown: { id: string; date: string; description: string } | null;
  hasHistory: boolean;
  maintenanceIntervalDays: number | null;
}

export interface BreakdownItem {
  id: string;
  date: string;
  description: string;
  repairId: string | null;
  resolvedDate: string | null;
}

type BreakdownRecord = {
  id: string;
  date: Date;
  description: string;
  repairId: string | null;
  resolvedDate: Date | null;
};

export const toBreakdownItem = (b: BreakdownRecord): BreakdownItem => ({
  id: b.id,
  date: formatDay(b.date),
  description: b.description,
  repairId: b.repairId,
  resolvedDate: formatDayOrNull(b.resolvedDate),
});

export function toEquipmentItem(
  e: EquipmentRecord,
  today: Date,
  warningDays: number,
): EquipmentItem {
  const open = e.breakdowns[0];
  const next = formatDayOrNull(e.nextMaintenanceDate);
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    location: e.building?.name ?? e.site?.name ?? null,
    siteId: e.siteId,
    buildingId: e.buildingId,
    condition: e.condition,
    nextMaintenance: next,
    maintenanceDue: maintenanceDue(next, today, warningDays),
    retiredAt: formatDayOrNull(e.retiredAt),
    openBreakdown: open
      ? {
          id: open.id,
          date: formatDay(open.date),
          description: open.description,
        }
      : null,
    hasHistory:
      e.maintenances.length > 0 ||
      e.breakdowns.length > 0 ||
      e.tasks.length > 0,
    maintenanceIntervalDays: e.maintenanceIntervalDays,
  };
}

/** What the audit log keeps of an equipment: its stored fields. */
export const equipmentSnapshot = (e: EquipmentRecord) => ({
  name: e.name,
  type: e.type,
  siteId: e.siteId,
  buildingId: e.buildingId,
  brand: e.brand,
  serialNumber: e.serialNumber,
  purchaseDate: formatDayOrNull(e.purchaseDate),
  maintenanceIntervalDays: e.maintenanceIntervalDays,
  firstMaintenanceDate: formatDayOrNull(e.firstMaintenanceDate),
  nextMaintenanceDate: formatDayOrNull(e.nextMaintenanceDate),
  condition: e.condition,
  retiredAt: formatDayOrNull(e.retiredAt),
  note: e.note,
});

export const equipmentColumns: ExportColumn<EquipmentItem>[] = [
  { header: 'Équipement', value: (e) => e.name },
  { header: 'Type', value: (e) => TYPE_LABELS[e.type] ?? e.type },
  { header: 'Emplacement', value: (e) => e.location },
  { header: 'Prochaine maintenance', value: (e) => e.nextMaintenance },
  { header: 'État', value: (e) => CONDITION_LABELS[e.condition] },
];

/* ------------------------------------------------------------ interventions */

export const maintenanceInclude = {
  equipment: { select: { name: true } },
  supplier: { select: { name: true } },
  repairs: { select: { id: true } },
} satisfies Prisma.MaintenanceInclude;
export type MaintenanceRecord = Prisma.MaintenanceGetPayload<{
  include: typeof maintenanceInclude;
}>;

export interface MaintenanceItem {
  id: string;
  date: string;
  equipmentId: string;
  equipmentName: string;
  kind: string;
  description: string;
  performedBy: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** `null` without `finance:read`. */
  cost: number | null;
  nextDate: string | null;
  repairs: boolean;
}

export const toMaintenanceItem = (
  m: MaintenanceRecord,
  withCost: boolean,
): MaintenanceItem => ({
  id: m.id,
  date: formatDay(m.date),
  equipmentId: m.equipmentId,
  equipmentName: m.equipment.name,
  kind: m.kind,
  description: m.description,
  performedBy: m.performedBy,
  supplierId: m.supplierId,
  supplierName: m.supplier?.name ?? null,
  cost: withCost ? toMoney(m.cost) : null,
  nextDate: formatDayOrNull(m.nextDate),
  repairs: m.repairs !== null,
});

/** What the audit log keeps of an intervention. */
export const maintenanceSnapshot = (m: MaintenanceRecord) => ({
  equipmentId: m.equipmentId,
  kind: m.kind,
  date: formatDay(m.date),
  description: m.description,
  performedBy: m.performedBy,
  supplierId: m.supplierId,
  cost: toMoney(m.cost),
  nextDate: formatDayOrNull(m.nextDate),
  repairsBreakdownId: m.repairs?.id ?? null,
});

export const maintenanceColumns = (
  withCost: boolean,
): ExportColumn<MaintenanceItem>[] => [
  { header: 'Date', value: (m) => m.date },
  { header: 'Équipement', value: (m) => m.equipmentName },
  { header: 'Type', value: (m) => KIND_LABELS[m.kind] ?? m.kind },
  { header: 'Description', value: (m) => m.description },
  { header: 'Intervenant', value: (m) => m.performedBy },
  { header: 'Prochaine date', value: (m) => m.nextDate },
  ...(withCost
    ? [{ header: 'Coût', value: (m: MaintenanceItem) => m.cost }]
    : []),
];
