const NNBSP = ' '; // narrow no-break space: the grouping the frontend's `formatNumber` writes

/** A count or quantity the way the screens write it: thousands grouped with a narrow no-break space, `.` for decimals (`4 820`, `1 450.25`). */
export function formatCount(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`;
}
