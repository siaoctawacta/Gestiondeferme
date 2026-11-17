import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { addDays, parseDay } from '../common/days';
import { sumAmounts } from '../common/money';

export type EmploymentStatus = 'ACTIF' | 'PARTI';

export const EMPLOYMENT_LABELS: Record<EmploymentStatus, string> = {
  ACTIF: 'Actif',
  PARTI: 'Parti',
};

export const CONTRACT_LABELS = {
  CDI: 'CDI',
  CDD: 'CDD',
  JOURNALIER: 'Journalier',
  STAGE: 'Stage',
} as const;

export const ATTENDANCE_LABELS = {
  PRESENT: 'Présent',
  ABSENT: 'Absent',
  CONGE: 'Congé',
  MALADIE: 'Maladie',
} as const;

interface Span {
  hireDate: Date;
  endDate: Date | null;
}

/** In post on `day`: from the hire day to the end day, both included. */
export const isActiveOn = (e: Span, day: Date): boolean =>
  e.hireDate.getTime() <= day.getTime() &&
  (e.endDate === null || day.getTime() <= e.endDate.getTime());

/** `PARTI` once the end date is past (an employee leaving today is still `ACTIF`). */
export const employmentStatus = (e: Span, today: Date): EmploymentStatus =>
  e.endDate !== null && e.endDate.getTime() < today.getTime()
    ? 'PARTI'
    : 'ACTIF';

const MONTH = /^(\d{4})-(\d{2})$/;
const INVALID_MONTH = 'Mois invalide (AAAA-MM)';

/** First and last calendar day of a `YYYY-MM` month. */
export function monthBounds(month: string): { from: Date; to: Date } {
  const m = MONTH.exec(month);
  const from = m ? parseDay(`${month}-01`) : null;
  if (!from) throw new BadRequestException(INVALID_MONTH);
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1),
  );
  return { from, to: addDays(next, -1) };
}

const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** The label of the manual salary entry of a month: `Salaires octobre 2026`. */
export function payrollLabel(month: string): string {
  const { from } = monthBounds(month);
  return `Salaires ${MONTH_NAMES[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
}

export interface PayrollEmployee extends Span {
  id: string;
  name: string;
  jobTitle: string;
  monthlySalary: Decimal | number | string | null;
}

export interface PayrollLine {
  employeeId: string;
  name: string;
  jobTitle: string;
  monthlySalary: Decimal;
}

/**
 * What the staff costs for a month: every employee with a salary who is in
 * post at least one day of it, at his full monthly salary (no proration,
 * pre-flight Q8). The Comptable posts the manual entry from this.
 */
export function payrollOf(
  employees: PayrollEmployee[],
  month: string,
): { lines: PayrollLine[]; total: Decimal } {
  const { from, to } = monthBounds(month);
  const lines = employees
    .filter(
      (e) =>
        e.monthlySalary !== null &&
        e.hireDate.getTime() <= to.getTime() &&
        (e.endDate === null || e.endDate.getTime() >= from.getTime()),
    )
    .map((e) => ({
      employeeId: e.id,
      name: e.name,
      jobTitle: e.jobTitle,
      monthlySalary: new Decimal(e.monthlySalary as Decimal.Value),
    }));
  return { lines, total: sumAmounts(lines.map((l) => l.monthlySalary)) };
}
