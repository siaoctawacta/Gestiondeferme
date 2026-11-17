import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { formatDay, today } from '../common/days';
import {
  withFarm,
  type AlertItem,
  type AlertRule,
} from '../indicators/alerts/alert.types';
import { maintenanceDue, type ConditionValue } from './equipment-state';

/** An equipment in service as the alert rule reads it. */
export interface AlertEquipment {
  id: string;
  name: string;
  condition: ConditionValue;
  nextMaintenance: Date | null;
  /** Set when the request spans several farms, to tell their alerts apart. */
  farmName?: string;
}

/** What the rule reads; the equipment alerts service implements it over the database. */
export interface EquipmentAlertData {
  /** The equipment in service that is broken or due within `warningDays` of `day`, over the farms of the request. */
  attention(
    ctx: RequestContext,
    day: Date,
    warningDays: number,
  ): Promise<AlertEquipment[]>;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `Équipement en panne` (URGENT, by name) then `Maintenance due` (A_VOIR, by
 * next date then name). A broken equipment raises no due alert: the breakdown
 * is the news.
 */
export function equipmentAlerts(
  rows: AlertEquipment[],
  now: Date,
  warningDays: number,
): AlertItem[] {
  const broken = rows
    .filter((r) => r.condition === 'EN_PANNE')
    .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
    .map((r): AlertItem => ({
      key: `breakdown:${r.id}`,
      title: 'Équipement en panne',
      detail: withFarm(r.name, r.farmName),
      level: 'URGENT',
      module: 'equipements',
      modules: ['equipements'],
    }));
  const due = rows
    .filter((r) => r.condition !== 'EN_PANNE' && r.nextMaintenance !== null)
    .map((r) => ({ r, next: formatDay(r.nextMaintenance as Date) }))
    .filter(({ next }) => maintenanceDue(next, now, warningDays))
    .sort(
      (a, b) =>
        compare(a.next, b.next) ||
        compare(a.r.name, b.r.name) ||
        compare(a.r.id, b.r.id),
    )
    .map(({ r, next }): AlertItem => ({
      key: `maintenance:${r.id}:${next}`,
      title: 'Maintenance due',
      detail: withFarm(r.name, r.farmName),
      level: 'A_VOIR',
      module: 'equipements',
      modules: ['equipements'],
    }));
  return [...broken, ...due];
}

/** The rules of the equipment module (not run for a role without `equipements` read). */
export function equipmentAlertRules(
  data: EquipmentAlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx, settings) => {
      if (!can(ctx.user.role, 'equipements', 'read')) return [];
      const day = today(now());
      const warningDays = settings.maintenanceWarningDays ?? 0;
      return equipmentAlerts(
        await data.attention(ctx, day, warningDays),
        day,
        warningDays,
      );
    },
  ];
}
