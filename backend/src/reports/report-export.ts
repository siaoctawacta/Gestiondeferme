import { Workbook } from 'exceljs';
import { csvCell } from '../listing/export';
import type { ReportDto, ReportSection } from './report.types';

const ACTIVITY_LABEL = {
  AVICOLE: 'Activité Avicole',
  PORCIN: 'Activité Porcin',
  GENERAL: 'Activité Général',
} as const;

const HEADER = ['Section', 'Indicateur', 'Valeur', 'Unité'];
const INDICATORS = 'Indicateurs';

type Cell = string | number | null;

/** The `Section / Indicateur / Valeur / Unité` lines of a report: its rows and its activity cards. */
function indicatorLines(sections: ReportSection[]): Cell[][] {
  const lines: Cell[][] = [];
  for (const s of sections) {
    for (const r of s.rows ?? []) {
      lines.push([s.title, r.label, r.value, r.unit]);
    }
    for (const c of s.cards ?? []) {
      const label = ACTIVITY_LABEL[c.activity];
      lines.push([label, 'Recettes', c.revenue, 'FCFA']);
      lines.push([label, 'Dépenses', c.expenses, 'FCFA']);
      lines.push([label, 'Marge', c.margin, 'FCFA']);
    }
  }
  return lines;
}

/** A column header with its unit: `MONTANT (FCFA)`. */
const headerOf = (c: { header: string; unit?: string }): string =>
  c.unit ? `${c.header} (${c.unit})` : c.header;

const tablesOf = (report: ReportDto) =>
  report.sections.flatMap((s) =>
    s.table ? [{ title: s.title, table: s.table }] : [],
  );

const csvLine = (cells: Cell[]): string =>
  cells.map(csvCell).join(';') + '\r\n';

/** `rapport-{type}-{from}_{to}`, without extension. */
export const reportFilename = (report: ReportDto): string =>
  `rapport-${report.type}-${report.from}_${report.to}`;

/**
 * The CSV of a report: `Section;Indicateur;Valeur;Unité` for the rows, then
 * each table after an empty line, with its own title line and header. UTF-8
 * BOM, CRLF, decimal comma. A section the role cannot see is not in the report,
 * so it is in neither file.
 */
export function reportCsv(report: ReportDto): string {
  let out = csvLine(HEADER);
  for (const line of indicatorLines(report.sections)) out += csvLine(line);
  for (const { title, table } of tablesOf(report)) {
    out += '\r\n' + csvLine([title]);
    out += csvLine(table.columns.map(headerOf));
    for (const row of table.rows) {
      out += csvLine(table.columns.map((c) => row[c.key] ?? null));
    }
  }
  return '﻿' + out;
}

/** `22/10/2026` → that day at 00:00 UTC (the text stays when it is not a date). */
function fromFrench(text: string): Date | string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : text;
}

/** An Excel sheet name: 31 characters at most, none of `: \ / ? * [ ]`, unique in the workbook. */
function sheetName(title: string, taken: Set<string>): string {
  const base = title.replace(/[:\\/?*[\]]/g, ' ').trim() || 'Tableau';
  let name = base.slice(0, 31);
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** The workbook: sheet `Indicateurs`, then one sheet per table. */
export async function reportXlsx(report: ReportDto): Promise<Buffer> {
  const wb = new Workbook();
  const taken = new Set<string>([INDICATORS.toLowerCase()]);
  const main = wb.addWorksheet(INDICATORS);
  main.addRow(HEADER).font = { bold: true };
  for (const line of indicatorLines(report.sections)) main.addRow(line);
  for (const { title, table } of tablesOf(report)) {
    const ws = wb.addWorksheet(sheetName(title, taken));
    ws.addRow(table.columns.map(headerOf)).font = { bold: true };
    for (const row of table.rows) {
      const added = ws.addRow(
        table.columns.map((c) => {
          const v = row[c.key] ?? null;
          return c.date && typeof v === 'string' ? fromFrench(v) : v;
        }),
      );
      table.columns.forEach((c, i) => {
        if (c.date) added.getCell(i + 1).numFmt = 'dd/mm/yyyy';
      });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
