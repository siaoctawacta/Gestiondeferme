// Dates of the demo, all relative to the day it is loaded. The reference screens were captured on 2026-11-14
// (REFERENCE_DAY): every reference date is moved forward by the days elapsed since, so the farm always looks
// the way it did that day (the same lateness, the same stock days, the same overdue tasks and receivables)
// whatever day the demo is loaded.
import {
  addDays,
  formatDay,
  requireDay,
  signedDaysBetween,
  today,
} from '../../src/common/days';

/** The day the reference screens were captured. */
export const REFERENCE_DAY = '2026-11-14';

// The day of the run, fixed on first use: a run that crosses midnight keeps one consistent calendar.
let runDay: Date | undefined;
const day = (): Date => (runDay ??= today());

/** Days between the reference capture and the day of the run (0 on the capture day). */
export const elapsedDays = (): number =>
  signedDaysBetween(requireDay(REFERENCE_DAY), day());

/** A reference date as it reads today: moved forward by the days elapsed since the capture. */
export function ref(referenceDate: string): string {
  return formatDay(addDays(requireDay(referenceDate), elapsedDays()));
}

/** Today as `YYYY-MM-DD`. */
export const todayDay = (): string => formatDay(day());

/** The day `n` days before today (negative: after). */
export const ago = (n: number): string => formatDay(addDays(day(), -n));

/** The last `count` working days (Monday to Friday) up to and including today or the last weekday, oldest first. */
export function lastWorkingDays(count: number): string[] {
  const days: string[] = [];
  for (let n = 0; days.length < count; n += 1) {
    const candidate = addDays(day(), -n);
    const weekday = candidate.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(formatDay(candidate));
  }
  return days.reverse();
}
