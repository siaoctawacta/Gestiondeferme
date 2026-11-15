import { formatCount, formatFcfa } from './format-number';

describe('formatCount', () => {
  it('groups thousands with a narrow no-break space and keeps the decimals', () => {
    expect(formatCount(4820)).toBe('4 820');
    expect(formatCount(12)).toBe('12');
    expect(formatCount(1234567.5)).toBe('1 234 567.5');
    expect(formatCount(-4710)).toBe('-4 710');
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatFcfa', () => {
  it('writes an amount like the screens: no-break spaces between thousands and before FCFA', () => {
    expect(formatFcfa(400000)).toBe('400\u00a0000\u00a0FCFA');
    expect(formatFcfa(950)).toBe('950\u00a0FCFA');
    expect(formatFcfa(1050000.5)).toBe('1\u00a0050\u00a0000.5\u00a0FCFA');
  });
});
