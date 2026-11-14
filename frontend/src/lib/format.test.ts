import { formatDate, formatDateFr, formatDateTime, formatDateTimeFr, formatMoney, formatNumber, formatPct } from './format';

describe('format', () => {
  it('formats numbers with a no-break space as thousands separator', () => {
    expect(formatNumber(11570)).toBe('11 570');
  });
  it('formats money in FCFA', () => {
    expect(formatMoney(3970000)).toBe('3 970 000 FCFA');
  });
  it('formats percentages with a dot decimal', () => {
    expect(formatPct(3.6)).toBe('3.6%');
    expect(formatPct(87)).toBe('87%');
    expect(formatPct(5)).toBe('5%');
    expect(formatPct(1.66)).toBe('1.7%');
    for (const [n, out] of [[1.95, '2%'], [2.45, '2.5%'], [0, '0%'], [99.96, '100%'], [-0, '0%'], [-0.04, '0%'], [1e-7, '0%'], [-3.65, '-3.7%'], [NaN, '—'], [Infinity, '—']] as const) {
      expect(formatPct(n)).toBe(out);
    }
  });
  it('formats ISO dates as YYYY-MM-DD', () => {
    expect(formatDate('2026-10-22T00:00:00Z')).toBe('2026-10-22');
  });
  it('formats local dates and times as dd/mm/yyyy [hh:mm]', () => {
    const d = new Date(2026, 10, 4, 9, 5);
    expect(formatDateFr(d)).toBe('04/11/2026');
    expect(formatDateTime(d)).toBe('04/11/2026 09:05');
  });
  it('returns a dash for an invalid date instead of throwing', () => {
    for (const f of [formatDate, formatDateFr, formatDateTime, formatDateTimeFr]) expect(f('pas une date')).toBe('—');
  });
});
