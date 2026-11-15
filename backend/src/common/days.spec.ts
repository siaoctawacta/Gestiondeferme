import { addDays, formatDayOrNull, signedDaysBetween } from './days';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('days', () => {
  it('signedDaysBetween is negative when the second day is earlier', () => {
    expect(signedDaysBetween(day('2026-11-14'), day('2026-11-17'))).toBe(3);
    expect(signedDaysBetween(day('2026-11-14'), day('2026-11-14'))).toBe(0);
    expect(signedDaysBetween(day('2026-11-14'), day('2026-11-13'))).toBe(-1);
  });

  it('addDays and formatDayOrNull', () => {
    expect(addDays(day('2026-11-30'), 1)).toEqual(day('2026-12-01'));
    expect(formatDayOrNull(day('2026-11-30'))).toBe('2026-11-30');
    expect(formatDayOrNull(null)).toBeNull();
  });
});
