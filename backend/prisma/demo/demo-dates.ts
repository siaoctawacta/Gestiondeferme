// Dates of the demo, all relative to the day it is loaded. The reference screens were captured on 2026-11-14
// (REFERENCE_DAY): every reference date is moved forward by the days elapsed since, so the farm always looks
// the way it did that day (the same lateness, the same stock days, the same overdue tasks and receivables)
// whatever day the demo is loaded.
//
// Test-only clock: `DEMO_TODAY=YYYY-MM-DD` replaces today's date here (refused when NODE_ENV=production). The API
// the demo writes to uses the real clock, so a test that sets it also shifts the clock of the process (test/fake-clock.js).
import {
  addDays,
  formatDay,
  parseDay,
  requireDay,
  signedDaysBetween,
  today,
} from '../../src/common/days';

/** The day the reference screens were captured. */
export const REFERENCE_DAY = '2026-11-14';

export interface DemoDates {
  /** Today as `YYYY-MM-DD`. */
  today: string;
  /** Days between the reference capture and the day of the run (0 on the capture day). */
  elapsedDays: number;
  /** A reference date as it reads today: moved forward by the days elapsed since the capture. */
  ref(referenceDate: string): string;
  /** The day `n` days before today (negative: after). */
  ago(n: number): string;
  /** The last `count` working days (Monday to Friday) up to and including today or the last weekday, oldest first. */
  lastWorkingDays(count: number): string[];
  /** Last month (`YYYY-MM`, the month of the payroll) and the first day of the current month (the date of its entry). */
  payroll(): { month: string; entryDate: string };
}

/** The dates of a run on `day` (a calendar day at 00:00 UTC). */
export function demoDates(day: Date): DemoDates {
  const elapsed = signedDaysBetween(requireDay(REFERENCE_DAY), day);
  const ago = (n: number): string => formatDay(addDays(day, -n));
  return {
    today: formatDay(day),
    elapsedDays: elapsed,
    ref: (referenceDate) =>
      formatDay(addDays(requireDay(referenceDate), elapsed)),
    ago,
    lastWorkingDays(count) {
      const days: string[] = [];
      for (let n = 0; days.length < count; n += 1) {
        const weekday = addDays(day, -n).getUTCDay();
        if (weekday !== 0 && weekday !== 6) days.push(ago(n));
      }
      return days.reverse();
    },
    payroll() {
      const previous = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1),
      );
      const month = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
      return {
        month,
        entryDate: formatDay(
          new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)),
        ),
      };
    },
  };
}

/** The day of the run: `DEMO_TODAY` (tests only) or today. */
export function runDay(env: NodeJS.ProcessEnv = process.env): Date {
  const override = env.DEMO_TODAY;
  if (!override) return today();
  if (env.NODE_ENV === 'production') {
    throw new Error('DEMO_TODAY est refusé en production');
  }
  const day = parseDay(override);
  if (!day) throw new Error('DEMO_TODAY doit être une date AAAA-MM-JJ');
  return day;
}

// The day of the run, fixed on first use: a run that crosses midnight keeps one consistent calendar.
let shared: DemoDates | undefined;
const dates = (): DemoDates => (shared ??= demoDates(runDay()));

export const elapsedDays = (): number => dates().elapsedDays;
export const ref = (referenceDate: string): string =>
  dates().ref(referenceDate);
export const todayDay = (): string => dates().today;
export const ago = (n: number): string => dates().ago(n);
export const lastWorkingDays = (count: number): string[] =>
  dates().lastWorkingDays(count);
export const payrollPeriod = (): { month: string; entryDate: string } =>
  dates().payroll();
