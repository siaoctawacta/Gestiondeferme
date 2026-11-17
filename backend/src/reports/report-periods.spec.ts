import { BadRequestException } from '@nestjs/common';
import { formatDay, parseDay } from '../common/days';
import {
  PERIOD_TOO_LONG,
  REPORT_TYPES,
  reportPeriod,
  reportTitle,
} from './report-periods';

const TODAY = parseDay('2026-11-17') as Date;
const span = (
  type: Parameters<typeof reportPeriod>[0],
  q: Parameters<typeof reportPeriod>[1],
  today = TODAY,
) => {
  const p = reportPeriod(type, q, today);
  return [formatDay(p.from), formatDay(p.to)];
};
const message = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    return (e as BadRequestException).message;
  }
  return 'no error';
};

describe('reportPeriod', () => {
  it('lists the seven types in the order of the tabs', () => {
    expect(REPORT_TYPES).toEqual([
      'synthese',
      'quotidien',
      'hebdomadaire',
      'mensuel',
      'annuel',
      'sanitaire',
      'zootechnique',
    ]);
  });

  it('is the day itself for a daily report, today by default', () => {
    expect(span('quotidien', { date: '2026-10-22' })).toEqual([
      '2026-10-22',
      '2026-10-22',
    ]);
    expect(span('quotidien', {})).toEqual(['2026-11-17', '2026-11-17']);
  });

  it('is the ISO week, Monday to Sunday, containing the date', () => {
    expect(span('hebdomadaire', { date: '2026-10-22' })).toEqual([
      '2026-10-19',
      '2026-10-25',
    ]);
    // a Sunday belongs to the week that ends on it, a Monday starts its own
    expect(span('hebdomadaire', { date: '2026-10-25' })).toEqual([
      '2026-10-19',
      '2026-10-25',
    ]);
    expect(span('hebdomadaire', { date: '2026-10-26' })).toEqual([
      '2026-10-26',
      '2026-11-01',
    ]);
    // across a year end
    expect(span('hebdomadaire', { date: '2026-01-01' })).toEqual([
      '2025-12-29',
      '2026-01-04',
    ]);
  });

  it('is the calendar month, whatever day of it is given', () => {
    expect(span('mensuel', { date: '2026-02-10' })).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    expect(span('mensuel', { date: '2024-02-29' })).toEqual([
      '2024-02-01',
      '2024-02-29',
    ]);
    expect(span('mensuel', { date: '2026-10-15' })).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('is the calendar year, whatever day of it is given', () => {
    expect(span('annuel', { date: '2025-06-01' })).toEqual([
      '2025-01-01',
      '2025-12-31',
    ]);
  });

  it('clips the end to today for the current week, month and year', () => {
    expect(span('hebdomadaire', { date: '2026-11-17' })).toEqual([
      '2026-11-16',
      '2026-11-17',
    ]);
    expect(span('mensuel', { date: '2026-11-03' })).toEqual([
      '2026-11-01',
      '2026-11-17',
    ]);
    expect(span('annuel', { date: '2026-06-01' })).toEqual([
      '2026-01-01',
      '2026-11-17',
    ]);
  });

  it('takes from and to for the sanitary and zootechnical reports, the month to date by default', () => {
    for (const type of ['sanitaire', 'zootechnique'] as const) {
      expect(span(type, { from: '2026-10-01', to: '2026-10-31' })).toEqual([
        '2026-10-01',
        '2026-10-31',
      ]);
      expect(span(type, {})).toEqual(['2026-11-01', '2026-11-17']);
      expect(span(type, { from: '2026-10-05' })).toEqual([
        '2026-10-05',
        '2026-11-17',
      ]);
      expect(span(type, { to: '2026-10-20' })).toEqual([
        '2026-10-01',
        '2026-10-20',
      ]);
      expect(span(type, { from: '2026-11-01', to: '2026-12-31' })).toEqual([
        '2026-11-01',
        '2026-11-17',
      ]);
    }
  });

  it('is the month to date for the synthèse, whatever is asked', () => {
    expect(span('synthese', {})).toEqual(['2026-11-01', '2026-11-17']);
    expect(span('synthese', { date: '2026-01-05' })).toEqual([
      '2026-11-01',
      '2026-11-17',
    ]);
  });

  it('refuses a future date, a start after the end, a bad day and more than 366 days', () => {
    expect(message(() => span('quotidien', { date: '2026-11-18' }))).toBe(
      'La date ne peut pas être dans le futur',
    );
    expect(message(() => span('mensuel', { date: '2026-12-01' }))).toBe(
      'La date ne peut pas être dans le futur',
    );
    expect(message(() => span('sanitaire', { from: '2026-12-01' }))).toBe(
      'La date ne peut pas être dans le futur',
    );
    expect(
      message(() =>
        span('zootechnique', { from: '2026-10-31', to: '2026-10-01' }),
      ),
    ).toBe('La date de début est après la date de fin');
    expect(message(() => span('quotidien', { date: '2026-02-30' }))).toBe(
      'Date invalide (AAAA-MM-JJ)',
    );
    // 366 days is the longest period (a leap year), 367 is refused
    expect(
      span('sanitaire', { from: '2025-11-16', to: '2026-11-16' }),
    ).toHaveLength(2);
    expect(
      message(() =>
        span('sanitaire', { from: '2025-11-15', to: '2026-11-16' }),
      ),
    ).toBe(PERIOD_TOO_LONG);
    expect(PERIOD_TOO_LONG).toBe('La période ne peut pas dépasser 366 jours');
  });
});

describe('reportTitle', () => {
  const title = (
    type: Parameters<typeof reportTitle>[0],
    from: string,
    to: string,
  ) =>
    reportTitle(type, {
      from: parseDay(from) as Date,
      to: parseDay(to) as Date,
    });

  it('states the day, week, month, year or period of each type', () => {
    expect(title('synthese', '2026-11-01', '2026-11-14')).toBe(
      'Synthèse au 14/11/2026',
    );
    expect(title('quotidien', '2026-10-22', '2026-10-22')).toBe(
      'Rapport quotidien du 22/10/2026',
    );
    expect(title('hebdomadaire', '2026-10-19', '2026-10-25')).toBe(
      'Rapport hebdomadaire du 19/10/2026 au 25/10/2026',
    );
    expect(title('mensuel', '2026-10-01', '2026-10-31')).toBe(
      'Rapport mensuel — octobre 2026',
    );
    expect(title('mensuel', '2026-02-01', '2026-02-28')).toBe(
      'Rapport mensuel — février 2026',
    );
    expect(title('mensuel', '2026-12-01', '2026-12-31')).toBe(
      'Rapport mensuel — décembre 2026',
    );
    expect(title('annuel', '2026-01-01', '2026-11-17')).toBe(
      'Rapport annuel 2026',
    );
    expect(title('sanitaire', '2026-10-01', '2026-10-31')).toBe(
      'Rapport sanitaire du 01/10/2026 au 31/10/2026',
    );
    expect(title('zootechnique', '2026-10-01', '2026-10-31')).toBe(
      'Rapport zootechnique du 01/10/2026 au 31/10/2026',
    );
  });
});
