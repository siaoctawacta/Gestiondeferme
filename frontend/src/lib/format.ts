const NNBSP = ' ';

export function formatNumber(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`;
}

export const formatMoney = (n: number): string => `${formatNumber(n)} FCFA`;

export const formatPct = (n: number): string => `${n}%`;

export function formatDate(iso: string | Date): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** `14 novembre 2026 à 15:42`, in the viewer's time zone. */
export function formatDateTimeFr(iso: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
}
