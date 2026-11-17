import { BadRequestException, ConflictException } from '@nestjs/common';
import { addDays, formatDay, parseDay } from '../common/days';

export const CONDITION_LIST = ['BON', 'A_SURVEILLER', 'EN_PANNE'] as const;
export type ConditionValue = (typeof CONDITION_LIST)[number];

export const BREAKDOWN_BY_HAND = "L'état « En panne » se déclare par une panne";
export const REPAIR_BY_INTERVENTION =
  'Un équipement en panne est remis en service par une intervention corrective';

export interface MaintenanceBasis {
  /** `YYYY-MM-DD`. */
  firstMaintenanceDate: string | null;
  maintenanceIntervalDays: number | null;
}

export interface InterventionDates {
  /** `YYYY-MM-DD`. */
  date: string;
  nextDate: string | null;
  createdAt: Date;
}

/** Later date first, then later creation: the latest intervention comes first. */
const latestFirst = (a: InterventionDates, b: InterventionDates): number =>
  a.date < b.date
    ? 1
    : a.date > b.date
      ? -1
      : b.createdAt.getTime() - a.createdAt.getTime();

/**
 * When the equipment is next due. The latest intervention (by date, then
 * creation) decides: its own next date, else its date plus the interval;
 * without any intervention, the first maintenance date.
 */
export function nextMaintenance(
  eq: MaintenanceBasis,
  interventions: InterventionDates[],
): string | null {
  if (interventions.length === 0) return eq.firstMaintenanceDate;
  const latest = [...interventions].sort(latestFirst)[0];
  if (latest.nextDate) return latest.nextDate;
  if (eq.maintenanceIntervalDays === null) return null;
  return formatDay(
    addDays(parseDay(latest.date) as Date, eq.maintenanceIntervalDays),
  );
}

/** Due when the next date is at most `warningDays` days after today. */
export function maintenanceDue(
  next: string | null,
  today: Date,
  warningDays: number,
): boolean {
  return next !== null && next <= formatDay(addDays(today, warningDays));
}

/**
 * The condition an equipment may be given by hand: `BON` and `A_SURVEILLER`
 * change into each other; `EN_PANNE` is entered by declaring a breakdown and
 * left by a corrective intervention that repairs it.
 */
export function conditionGuard(from: ConditionValue, to: ConditionValue): void {
  if (from === to) return;
  if (to === 'EN_PANNE') throw new BadRequestException(BREAKDOWN_BY_HAND);
  if (from === 'EN_PANNE') {
    throw new ConflictException(REPAIR_BY_INTERVENTION);
  }
}
