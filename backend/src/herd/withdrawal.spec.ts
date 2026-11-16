import { parseDay } from '../common/days';
import { coveringPeriods, relevantEnd } from './withdrawal';

const d = (day: string) => parseDay(day) as Date;
const period = (from: string, until: string) => ({
  from: d(from),
  until: d(until),
});

describe('withdrawal periods', () => {
  const periods = [
    period('2026-11-01', '2026-11-10'),
    period('2026-11-20', '2026-11-25'),
  ];

  it('covers the days of a period, both ends included, and nothing outside', () => {
    for (const day of ['2026-11-01', '2026-11-05', '2026-11-10']) {
      expect(coveringPeriods(periods, d(day))).toHaveLength(1);
    }
    for (const day of [
      '2026-10-31',
      '2026-11-11',
      '2026-11-19',
      '2026-11-26',
    ]) {
      expect(coveringPeriods(periods, d(day))).toHaveLength(0);
    }
  });

  it('shows the end of the current period, else of the next one, else the latest past end', () => {
    expect(relevantEnd(periods, d('2026-11-05'))).toEqual(d('2026-11-10'));
    expect(relevantEnd(periods, d('2026-10-20'))).toEqual(d('2026-11-10'));
    expect(relevantEnd(periods, d('2026-11-15'))).toEqual(d('2026-11-25'));
    expect(relevantEnd(periods, d('2026-12-01'))).toEqual(d('2026-11-25'));
    expect(relevantEnd([], d('2026-11-05'))).toBeUndefined();
  });

  it('takes the latest end of overlapping periods covering the day', () => {
    const overlap = [
      period('2026-11-01', '2026-11-10'),
      period('2026-11-05', '2026-11-12'),
    ];
    expect(relevantEnd(overlap, d('2026-11-06'))).toEqual(d('2026-11-12'));
  });
});
