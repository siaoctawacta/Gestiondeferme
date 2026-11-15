import { formatCount } from './format-number';

describe('formatCount', () => {
  it('groups thousands with a narrow no-break space and keeps the decimals', () => {
    expect(formatCount(4820)).toBe('4 820');
    expect(formatCount(12)).toBe('12');
    expect(formatCount(1234567.5)).toBe('1 234 567.5');
    expect(formatCount(-4710)).toBe('-4 710');
    expect(formatCount(0)).toBe('0');
  });
});
