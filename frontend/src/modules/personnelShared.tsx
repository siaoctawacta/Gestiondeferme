import type { StatusDef } from '../components/module/types';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/employees` and `/attendance`, Task 2). Reconcile with the backend here only.
 * ------------------------------------------------------------------------------------------- */

export type ContractType = 'CDI' | 'CDD' | 'JOURNALIER' | 'STAGE';
export type EmploymentStatus = 'ACTIF' | 'PARTI';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'CONGE' | 'MALADIE';

/**
 * `GET /employees`. `monthlySalary` is `null` without `finance:read`. `userId` / `userName` name the linked account;
 * `note` is carried by the list so that an edit needs no further request.
 */
export interface EmployeeRow {
  id: string;
  name: string;
  fullName: string | null;
  jobTitle: string;
  phone: string | null;
  contractType: ContractType;
  /** `YYYY-MM-DD` */
  hireDate: string;
  endDate: string | null;
  status: EmploymentStatus;
  userId: string | null;
  userName: string | null;
  monthlySalary: number | null;
  note: string | null;
}

/** `GET /attendance`. `hours` only for a presence. */
export interface AttendanceRow {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  status: AttendanceStatus;
  hours: number | null;
  note: string | null;
}

/** `GET /employees/payroll?month=YYYY-MM` (`finance:create`): what the Comptable prefills a salary entry from. */
export interface PayrollPreview {
  month: string;
  /** `Salaires octobre 2026` */
  label: string;
  lines: { employeeId: string; name: string; jobTitle: string; monthlySalary: number }[];
  total: number;
  /** The manual finance entry of that label already recorded for the month, if any. */
  existing: { id: string; amount: number } | null;
}

/* --------------------------------------------------------------------------------------------- */

export const CONTRACTS: { value: ContractType; label: string }[] = [
  { value: 'CDI', label: 'CDI' },
  { value: 'CDD', label: 'CDD' },
  { value: 'JOURNALIER', label: 'Journalier' },
  { value: 'STAGE', label: 'Stage' },
];
export const contractLabel = (c: string) => CONTRACTS.find((x) => x.value === c)?.label ?? c;

export const EMPLOYMENT_STATUSES: StatusDef[] = [
  { value: 'ACTIF', label: 'Actif', tone: 'success' },
  { value: 'PARTI', label: 'Parti', tone: 'neutral' },
];

export const ATTENDANCE_STATUSES: (StatusDef & { value: AttendanceStatus })[] = [
  { value: 'PRESENT', label: 'Présent', tone: 'success' },
  { value: 'ABSENT', label: 'Absent', tone: 'danger' },
  { value: 'CONGE', label: 'Congé', tone: 'neutral' },
  { value: 'MALADIE', label: 'Maladie', tone: 'warning' },
];
