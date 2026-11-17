import { parseDay } from '../common/days';
import {
  employmentStatus,
  isActiveOn,
  monthBounds,
  payrollLabel,
  payrollOf,
} from './employee-rules';

const day = (v: string) => parseDay(v) as Date;

const emp = (
  id: string,
  name: string,
  hireDate: string,
  monthlySalary: number | null,
  endDate: string | null = null,
) => ({
  id,
  name,
  jobTitle: 'Poste',
  hireDate: day(hireDate),
  endDate: endDate ? day(endDate) : null,
  monthlySalary,
});

const STAFF = () => [
  emp('k', 'Kodjo A.', '2025-01-06', 85_000),
  emp('d', 'Dr Koffi', '2026-01-01', 250_000),
  emp('y', 'Yawa M.', '2026-03-01', 60_000),
  emp('a', 'Ama K.', '2024-06-01', 80_000),
];

describe('isActiveOn', () => {
  const e = { hireDate: day('2026-03-01'), endDate: day('2026-09-30') };

  it('is inclusive on the hire day and on the end day', () => {
    expect(isActiveOn(e, day('2026-03-01'))).toBe(true);
    expect(isActiveOn(e, day('2026-09-30'))).toBe(true);
  });

  it('is false the day before the hire and the day after the end', () => {
    expect(isActiveOn(e, day('2026-02-28'))).toBe(false);
    expect(isActiveOn(e, day('2026-10-01'))).toBe(false);
  });

  it('has no end for an open contract', () => {
    expect(
      isActiveOn(
        { hireDate: day('2026-03-01'), endDate: null },
        day('2030-01-01'),
      ),
    ).toBe(true);
  });
});

describe('employmentStatus', () => {
  it('is PARTI only once the end date is past', () => {
    const e = { hireDate: day('2026-01-01'), endDate: day('2026-09-30') };
    expect(employmentStatus(e, day('2026-09-30'))).toBe('ACTIF');
    expect(employmentStatus(e, day('2026-10-01'))).toBe('PARTI');
    expect(
      employmentStatus(
        { hireDate: day('2026-01-01'), endDate: null },
        day('2026-10-01'),
      ),
    ).toBe('ACTIF');
  });
});

describe('monthBounds', () => {
  it('gives the first and last day of the month', () => {
    expect(monthBounds('2026-10')).toEqual({
      from: day('2026-10-01'),
      to: day('2026-10-31'),
    });
    expect(monthBounds('2028-02').to).toEqual(day('2028-02-29'));
  });

  it('refuses a malformed month', () => {
    expect(() => monthBounds('2026-13')).toThrow('Mois invalide');
    expect(() => monthBounds('2026-1')).toThrow('Mois invalide');
  });
});

describe('payrollOf', () => {
  it('sums every salary of the staff active in October 2026 (no proration)', () => {
    const p = payrollOf(STAFF(), '2026-10');
    expect(p.lines.map((l) => l.name)).toEqual([
      'Kodjo A.',
      'Dr Koffi',
      'Yawa M.',
      'Ama K.',
    ]);
    expect(p.total.toNumber()).toBe(475_000);
  });

  it('drops an employee who left before the month', () => {
    const staff = STAFF();
    staff[2] = emp('y', 'Yawa M.', '2026-03-01', 60_000, '2026-09-30');
    expect(payrollOf(staff, '2026-10').total.toNumber()).toBe(415_000);
    expect(payrollOf(staff, '2026-09').total.toNumber()).toBe(475_000);
  });

  it('counts an employee hired on the last day of the month', () => {
    const staff = [emp('n', 'Nouveau', '2026-10-31', 50_000)];
    expect(payrollOf(staff, '2026-10').total.toNumber()).toBe(50_000);
    expect(payrollOf(staff, '2026-09').lines).toEqual([]);
  });

  it('skips an employee with no salary', () => {
    const p = payrollOf([emp('s', 'Stagiaire', '2026-01-01', null)], '2026-10');
    expect(p.lines).toEqual([]);
    expect(p.total.toNumber()).toBe(0);
  });
});

describe('payrollLabel', () => {
  it('names the month in French', () => {
    expect(payrollLabel('2026-10')).toBe('Salaires octobre 2026');
    expect(payrollLabel('2026-02')).toBe('Salaires février 2026');
    expect(payrollLabel('2026-12')).toBe('Salaires décembre 2026');
  });
});
