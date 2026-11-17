import type { Decimal } from '@prisma/client/runtime/client';
import { formatDay, formatDayOrNull } from '../common/days';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type { AttendanceStatus, ContractType } from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import {
  ATTENDANCE_LABELS,
  CONTRACT_LABELS,
  EMPLOYMENT_LABELS,
  employmentStatus,
  type EmploymentStatus,
} from './employee-rules';

export const employeeInclude = {
  user: { select: { name: true } },
} satisfies Prisma.EmployeeInclude;
export type EmployeeRecord = Prisma.EmployeeGetPayload<{
  include: typeof employeeInclude;
}>;

export interface EmployeeItem {
  id: string;
  name: string;
  fullName: string | null;
  jobTitle: string;
  phone: string | null;
  contractType: ContractType;
  hireDate: string;
  endDate: string | null;
  status: EmploymentStatus;
  userId: string | null;
  userName: string | null;
  /** `null` without `finance:read`. */
  monthlySalary: number | null;
  note: string | null;
}

export const toEmployeeItem = (
  e: EmployeeRecord,
  today: Date,
  withSalary: boolean,
): EmployeeItem => ({
  id: e.id,
  name: e.name,
  fullName: e.fullName,
  jobTitle: e.jobTitle,
  phone: e.phone,
  contractType: e.contractType,
  hireDate: formatDay(e.hireDate),
  endDate: formatDayOrNull(e.endDate),
  status: employmentStatus(e, today),
  userId: e.userId,
  userName: e.user?.name ?? null,
  monthlySalary:
    withSalary && e.monthlySalary !== null ? toMoney(e.monthlySalary) : null,
  note: e.note,
});

const BASE_COLUMNS: ExportColumn<EmployeeItem>[] = [
  { header: 'Nom', value: (e) => e.name },
  { header: 'Nom complet', value: (e) => e.fullName },
  { header: 'Poste', value: (e) => e.jobTitle },
  { header: 'Contrat', value: (e) => CONTRACT_LABELS[e.contractType] },
  { header: 'Téléphone', value: (e) => e.phone },
  { header: 'Embauche', date: true, value: (e) => e.hireDate },
  { header: 'Départ', date: true, value: (e) => e.endDate },
  { header: 'Statut', value: (e) => EMPLOYMENT_LABELS[e.status] },
];

/** The salary column exists only for a reader of `finance`. */
export const employeeColumns = (
  withSalary: boolean,
): ExportColumn<EmployeeItem>[] =>
  withSalary
    ? [
        ...BASE_COLUMNS,
        { header: 'Salaire mensuel', value: (e) => e.monthlySalary },
      ]
    : BASE_COLUMNS;

export const attendanceInclude = {
  employee: { select: { name: true } },
} satisfies Prisma.AttendanceInclude;
export type AttendanceRecord = Prisma.AttendanceGetPayload<{
  include: typeof attendanceInclude;
}>;

export interface AttendanceItem {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  status: AttendanceStatus;
  hours: number | null;
  note: string | null;
}

const hoursOf = (h: Decimal | null): number | null =>
  h === null ? null : h.toNumber();

export const toAttendanceItem = (a: AttendanceRecord): AttendanceItem => ({
  id: a.id,
  date: formatDay(a.date),
  employeeId: a.employeeId,
  employeeName: a.employee.name,
  status: a.status,
  hours: hoursOf(a.hours),
  note: a.note,
});

export const ATTENDANCE_COLUMNS: ExportColumn<AttendanceItem>[] = [
  { header: 'Date', date: true, value: (a) => a.date },
  { header: 'Employé', value: (a) => a.employeeName },
  { header: 'Statut', value: (a) => ATTENDANCE_LABELS[a.status] },
  { header: 'Heures', value: (a) => a.hours },
  { header: 'Note', value: (a) => a.note },
];
