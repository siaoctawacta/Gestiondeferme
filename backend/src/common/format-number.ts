const NNBSP = ' '; // narrow no-break space: the grouping the frontend's `formatNumber` writes

/** A count or quantity the way the screens write it: thousands grouped with a narrow no-break space, `.` for decimals (`4 820`, `1 450.25`). */
export function formatCount(n: number): string {
  const [int, dec] = String(Math.abs(n)).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${n < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`;
}

const NBSP = '\u00a0';

/** An amount the way `formatMoney` of the screens writes it: thousands and the currency separated by a no-break space (`400 000 FCFA`). */
export const formatFcfa = (n: number): string =>
  `${formatCount(n).replaceAll(NNBSP, NBSP)}${NBSP}FCFA`;
