import { demoDates, REFERENCE_DAY, runDay } from './demo-dates';

const on = (day: string) => demoDates(new Date(`${day}T00:00:00Z`));

describe('demo dates', () => {
  it('is the reference itself on the capture day', () => {
    const d = on(REFERENCE_DAY);
    expect(d.elapsedDays).toBe(0);
    expect(d.ref('2026-10-22')).toBe('2026-10-22');
    expect(d.ago(2)).toBe('2026-11-12');
    expect(d.ago(-2)).toBe('2026-11-16');
  });

  it.each([
    ['2026-11-17', 3, '2026-10-25', '2026-11-18'],
    ['2027-01-01', 48, '2026-12-09', '2027-01-02'],
    ['2028-02-29', 472, '2028-02-06', '2028-03-01'],
  ])(
    'moves the reference by the days elapsed: %s',
    (day, elapsed, moved, tomorrow) => {
      const d = on(day);
      expect(d.elapsedDays).toBe(elapsed);
      expect(d.ref('2026-10-22')).toBe(moved);
      // The Pompe forage is due the day after the capture: always tomorrow.
      expect(d.ref('2026-11-15')).toBe(tomorrow);
      expect(d.ago(0)).toBe(day);
    },
  );

  it('keeps every reference date in the past (the API refuses a future date)', () => {
    for (const day of [
      '2026-11-14',
      '2026-11-30',
      '2027-01-01',
      '2028-02-29',
    ]) {
      expect(on(day).ref('2026-11-14') <= day).toBe(true);
    }
  });

  describe('lastWorkingDays', () => {
    it('ends today on a weekday (a Monday: the previous Tuesday to Monday)', () => {
      expect(on('2026-11-16').lastWorkingDays(5)).toEqual([
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
        '2026-11-16',
      ]);
    });
    it('ends on the Friday when today is a Sunday', () => {
      expect(on('2026-11-15').lastWorkingDays(5)).toEqual([
        '2026-11-09',
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
      ]);
    });
    it('crosses the year and the leap day', () => {
      expect(on('2027-01-01').lastWorkingDays(3)).toEqual([
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
      ]);
      expect(on('2028-02-29').lastWorkingDays(2)).toEqual([
        '2028-02-28',
        '2028-02-29',
      ]);
    });
  });

  describe('payroll', () => {
    it.each([
      ['2027-01-01', '2026-12', '2027-01-01'],
      ['2028-02-29', '2028-01', '2028-02-01'],
      ['2026-12-01', '2026-11', '2026-12-01'],
      ['2026-11-16', '2026-10', '2026-11-01'],
      ['2026-11-15', '2026-10', '2026-11-01'],
    ])(
      'on %s: month %s, entry dated %s (never in the future)',
      (day, month, entry) => {
        expect(on(day).payroll()).toEqual({ month, entryDate: entry });
        expect(entry <= day).toBe(true);
      },
    );
  });

  describe('DEMO_TODAY (tests only)', () => {
    it('replaces today', () => {
      expect(runDay({ DEMO_TODAY: '2026-12-01' }).toISOString()).toBe(
        '2026-12-01T00:00:00.000Z',
      );
    });
    it('is refused in production and when malformed', () => {
      expect(() =>
        runDay({ DEMO_TODAY: '2026-12-01', NODE_ENV: 'production' }),
      ).toThrow('DEMO_TODAY est refusé en production');
      expect(() => runDay({ DEMO_TODAY: 'demain' })).toThrow('AAAA-MM-JJ');
    });
    it('defaults to the real day', () => {
      expect(runDay({}).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
