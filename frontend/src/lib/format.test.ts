import { formatDate, formatMoney, formatNumber, formatPct } from './format';

describe('format', () => {
  it('formats numbers with a no-break space as thousands separator', () => {
    expect(formatNumber(11570)).toBe('11 570');
  });
  it('formats money in FCFA', () => {
    expect(formatMoney(3970000)).toBe('3 970 000 FCFA');
  });
  it('formats percentages with a dot decimal', () => {
    expect(formatPct(3.6)).toBe('3.6%');
  });
  it('formats ISO dates as YYYY-MM-DD', () => {
    expect(formatDate('2026-10-22T00:00:00Z')).toBe('2026-10-22');
  });
});
