import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  formatDay,
  FUTURE_DATE,
  requireDay,
  signedDaysBetween,
} from '../common/days';
import { monthToDate, PERIOD_ORDER } from '../finance/finance-period';

export const REPORT_TYPES = [
  'synthese',
  'quotidien',
  'hebdomadaire',
  'mensuel',
  'annuel',
  'sanitaire',
  'zootechnique',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const PERIOD_TOO_LONG = 'La période ne peut pas dépasser 366 jours';
const MAX_DAYS = 366;

export interface ReportPeriodQuery {
  date?: string;
  from?: string;
  to?: string;
}
export interface Period {
  from: Date;
  to: Date;
}

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** `YYYY-MM-DD` of a year and a month (0-based) day, as a calendar day at 00:00 UTC. */
const utcDay = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month, day));

const notFuture = (day: Date, today: Date): Date => {
  if (day.getTime() > today.getTime()) {
    throw new BadRequestException(FUTURE_DATE);
  }
  return day;
};

const min = (a: Date, b: Date): Date => (a.getTime() <= b.getTime() ? a : b);

/** The calendar span of the type around `date`, before the end is clipped to today. */
function around(type: ReportType, date: Date): Period {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  switch (type) {
    case 'hebdomadaire': {
      const sinceMonday = (date.getUTCDay() + 6) % 7;
      const from = addDays(date, -sinceMonday);
      return { from, to: addDays(from, 6) };
    }
    case 'mensuel':
      return { from: utcDay(y, m, 1), to: utcDay(y, m + 1, 0) };
    case 'annuel':
      return { from: utcDay(y, 0, 1), to: utcDay(y, 11, 31) };
    default:
      return { from: date, to: date };
  }
}

/**
 * The days a report covers (both inclusive). `quotidien`, `hebdomadaire`
 * (ISO week, Monday to Sunday), `mensuel` and `annuel` come from `date`
 * (today by default); `sanitaire` and `zootechnique` from `from` / `to`; the
 * `synthese` is the month to date, whatever is asked. The end is clipped to
 * `today`: a report never covers days that did not happen.
 */
export function reportPeriod(
  type: ReportType,
  q: ReportPeriodQuery,
  today: Date,
): Period {
  if (type === 'synthese') return monthToDate(today);
  let period: Period;
  if (type === 'sanitaire' || type === 'zootechnique') {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(PERIOD_ORDER);
    }
    if (from) notFuture(from, today);
    const end = to ? min(to, today) : today;
    period = { from: from ?? monthToDate(end).from, to: end };
  } else {
    const date = q.date ? notFuture(requireDay(q.date), today) : today;
    const span = around(type, date);
    period = { from: span.from, to: min(span.to, today) };
  }
  if (signedDaysBetween(period.from, period.to) + 1 > MAX_DAYS) {
    throw new BadRequestException(PERIOD_TOO_LONG);
  }
  return period;
}

/** `22/10/2026`. */
export const frenchDay = (day: Date): string =>
  formatDay(day).split('-').reverse().join('/');

/** The title of a report: « Synthèse au 14/11/2026 », « Rapport mensuel — octobre 2026 »... */
export function reportTitle(type: ReportType, period: Period): string {
  const { from, to } = period;
  switch (type) {
    case 'synthese':
      return `Synthèse au ${frenchDay(to)}`;
    case 'quotidien':
      return `Rapport quotidien du ${frenchDay(from)}`;
    case 'mensuel':
      return `Rapport mensuel — ${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
    case 'annuel':
      return `Rapport annuel ${from.getUTCFullYear()}`;
    default:
      return `Rapport ${type} du ${frenchDay(from)} au ${frenchDay(to)}`;
  }
}
