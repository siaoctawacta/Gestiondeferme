import type { Response } from 'express';
import { Workbook } from 'exceljs';

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null;
};

export type ExportFormat = 'csv' | 'xlsx';

const FORMULA_TRIGGER = /^[=+\-@]/;

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
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

export async function toXlsx<T>(
  rows: T[],
  cols: ExportColumn<T>[],
  sheetName: string,
): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.addRow(cols.map((c) => c.header)).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map((c) => c.value(r)));
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
