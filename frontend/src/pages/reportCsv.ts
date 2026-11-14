export interface IndicatorRow {
  label: string;
  /** Value as shown on screen. */
  display: string;
  /** Plain number for the CSV (null when not computable). */
  value: number | null;
  unit: string;
}

/** Text cells that a spreadsheet could read as a formula get a leading apostrophe. */
const FORMULA = /^[=+\-@\t\r]/;

function csvCell(v: string): string {
  const safe = FORMULA.test(v) ? `'${v}` : v;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** `;` separated, CRLF lines, UTF-8 BOM so Excel reads the accents; numbers are digits only. */
export function buildCsv(rows: IndicatorRow[]): string {
  const lines = [
    ['Indicateur', 'Valeur', 'Unité'].map(csvCell),
    ...rows.map((r) => [
      csvCell(r.label),
      // Numbers are written bare (a negative one is a number, not a formula).
      r.value === null ? csvCell('') : String(r.value),
      csvCell(r.unit),
    ]),
  ].map((cells) => cells.join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
