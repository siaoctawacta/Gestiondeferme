const NBSP = ' ';

export function formatNumber(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`;
}

export const formatMoney = (n: number): string => `${formatNumber(n)} FCFA`;

/** One decimal and no space before `%`. */
export const formatPct = (n: number): string => `${n.toFixed(1)}%`;

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
