import {
  formatDate, formatDateFr, formatDateTime, formatDateTimeFr, formatDecimal, formatMoney, formatNumber, formatPct, orDash, roundDecimal, signedMoney, todayIso,
} from './format';

describe('format', () => {
  it('rounds a computed quantity to 2 decimals without float drift', () => {
    expect(roundDecimal(10.3 - 10.1)).toBe(0.2);
    expect(roundDecimal(0.1 + 0.2)).toBe(0.3);
    expect(roundDecimal(-0.1 - 0.2)).toBe(-0.3);
    expect(roundDecimal(1.005)).toBe(1.01);
    expect(roundDecimal(2.5, 0)).toBe(3);
    expect(roundDecimal(Number.NaN)).toBeNaN();
  });
  it('formats numbers with a narrow no-break space (U+202F) as thousands separator', () => {
    expect(formatNumber(11570)).toBe('11\u202f570');
  });
  it('formats money in FCFA', () => {
    expect(formatMoney(3970000)).toBe('3\u00a0970\u00a0000\u00a0FCFA');
    expect(formatMoney(-1135000)).toBe('-1\u00a0135\u00a0000\u00a0FCFA');
  });
  it('writes a negative amount with the true minus sign, one convention for every finance screen', () => {
    expect(signedMoney(-105000)).toBe('\u2212105\u00a0000\u00a0FCFA');
    expect(signedMoney(950000)).toBe(formatMoney(950000));
    expect(signedMoney(0)).toBe('0\u00a0FCFA');
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
  it('formats decimals rounded, grouped and without trailing zeros', () => {
    for (const [n, digits, out] of [
      [12, 1, '12'], [55.34, 1, '55.3'], [1.7, 2, '1.7'], [1.705, 2, '1.71'], [1450.25, 2, '1\u202f450.25'], [-0.04, 1, '0'], [NaN, 1, '—'],
    ] as const) {
      expect(formatDecimal(n, digits)).toBe(out);
    }
  });
  it('shows a dash for a missing value, and today as an ISO date', () => {
    expect(orDash(null)).toBe('—');
    expect(orDash(undefined)).toBe('—');
    expect(orDash(1450)).toBe('1\u202f450');
    expect(orDash(3.6, formatPct)).toBe('3.6%');
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
