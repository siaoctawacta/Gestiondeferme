import type { Response } from 'express';
import { Workbook } from 'exceljs';

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null;
};

export type ExportFormat = 'csv' | 'xlsx';

/** A spreadsheet reads a cell as a formula from its first non-blank character: `=`, `+`, `-`, `@`; a leading tab or CR is a known injection vector too. */
const FORMULA_TRIGGER = /^(?:[\t\r]|\s*[=+\-@])/;

/** One CSV cell: a number with the decimal comma of the French spreadsheets, a text quoted when it needs it and neutralised when it could be a formula. */
export function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value).replace('.', ',');
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** `;`-separated, UTF-8 BOM, CRLF. Text cells starting with = + - @ get a leading `'`. */
export function toCsv<T>(rows: T[], cols: ExportColumn<T>[]): string {
  const lines = [
    cols.map((c) => csvCell(c.header)).join(';'),
    ...rows.map((r) => cols.map((c) => csvCell(c.value(r))).join(';')),
  ];
  return '﻿' + lines.map((l) => l + '\r\n').join('');
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-11-14` → that day at 00:00 UTC; any other text (or a day that does not exist) stays as it is. */
function asDay(value: string | number | null): string | number | Date | null {
  if (typeof value !== 'string') return value;
  const m = DAY.exec(value);
  if (!m) return value;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3]
    ? date
    : value;
}

/**
 * The workbook of a list. Every list gives its days as `YYYY-MM-DD`: in the sheet they are real
 * date cells (sortable, formattable) shown `dd/mm/yyyy`; the CSV keeps the text.
 */
export async function toXlsx<T>(
  rows: T[],
  cols: ExportColumn<T>[],
  sheetName: string,
): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.addRow(cols.map((c) => c.header)).font = { bold: true };
  for (const r of rows) {
    const added = ws.addRow(cols.map((c) => asDay(c.value(r))));
    added.eachCell((cell) => {
      if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function sendExport<T>(
  res: Response,
  format: ExportFormat,
  filename: string,
  rows: T[],
  cols: ExportColumn<T>[],
): Promise<void> {
  const safeName = filename.replace(/[^\w.-]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}.${format}"`,
  );
  if (format === 'xlsx') {
    res.setHeader('Content-Type', XLSX_MIME);
    res.send(await toXlsx(rows, cols, safeName));
  } else {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(toCsv(rows, cols));
  }
}
