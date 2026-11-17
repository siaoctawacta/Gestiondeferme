import type { Activity } from '../dashboard/dashboard.types';
import type { ReportType } from './report-periods';

export type ReportUnit = '' | '%' | 'kg' | 'L' | 'FCFA' | 'j' | 'g';

export interface ReportRow {
  /** Unique within its section. */
  key: string;
  label: string;
  /** `null` is shown « — ». */
  value: number | null;
  unit: ReportUnit;
}

export interface ReportCard {
  activity: Activity;
  revenue: number;
  expenses: number;
  margin: number;
}

export interface ReportTable {
  /** Column keys are unique within the table. */
  columns: { key: string; header: string; unit?: ReportUnit }[];
  rows: Record<string, string | number | null>[];
}

/** A section may carry rows, cards and a table; the title of a section with a table also names that table in the exports. */
export interface ReportSection {
  key: string;
  title: string;
  rows?: ReportRow[];
  cards?: ReportCard[];
  table?: ReportTable;
}

export interface ReportDto {
  type: ReportType;
  title: string;
  /** `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** ISO instant. */
  generatedAt: string;
  farmName: string;
  sections: ReportSection[];
}
