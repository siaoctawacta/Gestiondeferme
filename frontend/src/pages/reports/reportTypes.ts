import { todayIso } from '../../lib/format';
import type { ActivitySummary } from '../../modules/financeShared';

export type ReportType = 'synthese' | 'quotidien' | 'hebdomadaire' | 'mensuel' | 'annuel' | 'sanitaire' | 'zootechnique';

/** `GET /api/reports`: the report types with at least one section visible to the role. */
export interface ReportTypesDto {
  types: { type: ReportType; label: string }[];
}

export type ReportUnit = '' | '%' | 'kg' | 'L' | 'FCFA' | 'j' | 'g';

export interface ReportRow {
  key: string;
  label: string;
  value: number | null;
  unit: ReportUnit;
}

export interface ReportTable {
  columns: { key: string; header: string; unit?: ReportUnit }[];
  rows: Record<string, string | number | null>[];
}

export interface ReportSection {
  key: string;
  title: string;
  rows?: ReportRow[];
  cards?: ActivitySummary[];
  table?: ReportTable;
}

/** `GET /api/reports/:type?date=&from=&to=`: figures are the API's, the page only formats them. */
export interface ReportDto {
  type: ReportType;
  title: string;
  from: string;
  to: string;
  generatedAt: string;
  farmName: string;
  sections: ReportSection[];
}

/** The URL state of the page: the type and its period inputs. */
export interface ReportSelection {
  type: ReportType;
  date?: string;
  from?: string;
  to?: string;
}

export const REPORT_TYPE_KEYS: ReportType[] = ['synthese', 'quotidien', 'hebdomadaire', 'mensuel', 'annuel', 'sanitaire', 'zootechnique'];
export const isReportType = (v: string | null): v is ReportType => REPORT_TYPE_KEYS.includes(v as ReportType);

/** The query of a report: the period the type needs, each defaulting to today / the current month. */
export function reportParams(sel: ReportSelection): Record<string, string> {
  const today = todayIso();
  switch (sel.type) {
    case 'quotidien':
    case 'hebdomadaire':
      return { date: sel.date || today };
    case 'mensuel':
      return { date: `${(sel.date || today).slice(0, 7)}-01` };
    case 'annuel':
      return { date: `${(sel.date || today).slice(0, 4)}-01-01` };
    case 'sanitaire':
    case 'zootechnique':
      return { from: sel.from || `${today.slice(0, 7)}-01`, to: sel.to || today };
    default:
      return {};
  }
}
