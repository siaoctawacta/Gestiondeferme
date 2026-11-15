const NBSP = '\u202f'; // narrow no-break space, as the reference's French grouping

export function formatNumber(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`;
}

/**
 * A number rounded to at most `digits` decimals, thousands grouped, no trailing zeros (`12`, `55.3`, `1 450.25`):
 * the one formatter for measured quantities (`kg/j`, averages). Use `formatPct` for percentages.
 */
export function formatDecimal(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '—';
  return formatNumber(shift(Math.round(shift(Math.abs(n), digits)), -digits) * Math.sign(n) || 0);
}

/** `fmt(v)`, or `—` when `v` is missing. */
export const orDash = (v: number | null | undefined, fmt: (n: number) => string = formatNumber): string =>
  v === null || v === undefined ? '—' : fmt(v);

/** Today's calendar date as `YYYY-MM-DD` (UTC, as the API reads operation dates). */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** `iso` (a `YYYY-MM-DD` date) shifted by `days` calendar days, in UTC like every operation date. */
export const addDays = (iso: string, days: number): string => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);

/** Money groups thousands with a regular no-break space (U+00A0): the reference's money lines show a wide gap, its tables a narrow one. */
export const formatMoney = (n: number): string => `${formatNumber(n).replaceAll(NBSP, '\u00a0')}\u00a0FCFA`;

/** `n` shifted by `by` decimal places, on its decimal representation (no binary-float drift). */
function shift(n: number, by: number): number {
  const [mantissa, exp = '0'] = String(n).split('e');
  return Number(`${mantissa}e${Number(exp) + by}`);
}

/**
 * THE percent formatter: rounded half away from zero to at most one decimal, a trailing `.0` dropped, no space
 * before `%` (`87%`, `3.6%`); `—` for a non-finite value. Callers handle `null` themselves.
 */
export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = shift(Math.round(shift(Math.abs(n), 1)), -1) * Math.sign(n) || 0;
  return `${rounded}%`;
}

const NO_DATE = '—';
const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (v: string | Date): Date | null => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `yyyy-mm-dd` (UTC), as the reference shows dates; `—` when the date is invalid. */
export function formatDate(iso: string | Date): string {
  const d = toDate(iso);
  return d ? d.toISOString().slice(0, 10) : NO_DATE;
}

/** `dd/mm/yyyy` in the viewer's time zone; `—` when the date is invalid. */
export function formatDateFr(iso: string | Date): string {
  const d = toDate(iso);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : NO_DATE;
}

/** `dd/mm/yyyy hh:mm` in the viewer's time zone; `—` when the date is invalid. */
export function formatDateTime(iso: string | Date): string {
  const d = toDate(iso);
  return d ? `${formatDateFr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : NO_DATE;
}

/** `14 novembre 2026 à 15:42`, in the viewer's time zone. */
export function formatDateTimeFr(iso: string | Date): string {
  const d = toDate(iso);
  if (!d) return NO_DATE;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(d);
}
