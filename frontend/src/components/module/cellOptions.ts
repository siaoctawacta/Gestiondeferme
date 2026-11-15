import type { CellField, LineRow, OptionsDef } from './types';

/** The options of a select cell for its row: static, or computed from the row (`null`: none for this row). */
export function cellOptions(column: CellField, row: LineRow): OptionsDef | null {
  if (column.type !== 'select') return [];
  return typeof column.options === 'function' ? column.options(row) : column.options;
}

/** A select cell whose options are `null` for this row: shown as `—`, not required, not part of the payload. */
export const cellIsOff = (column: CellField, row: LineRow): boolean => column.type === 'select' && cellOptions(column, row) === null;
