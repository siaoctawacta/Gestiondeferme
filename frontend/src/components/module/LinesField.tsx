import { useId, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { formatNumber } from '../../lib/format';
import { CellControl } from './CellControl';
import type { CellField, Field, LineRow, LinesEdit, OptionItem } from './types';

export type LinesFieldDef = Extract<Field, { type: 'lines' }>;

export interface LinesFieldProps {
  field: LinesFieldDef;
  value: LineRow[];
  /** `edit` says which cells of which row the user set (or which row was removed), for cells that depend on another cell of their row. */
  onChange: (rows: LineRow[], edit?: LinesEdit) => void;
  /** Validation messages, shown under the grid. */
  errors?: string[];
  /** Nothing can be edited. */
  disabled?: boolean;
}

const emptyRow = (columns: CellField[]): LineRow => Object.fromEntries(columns.map((c) => [c.name, '']));

/** A read-only cell's text: numbers are grouped like everywhere else. */
function shown(column: CellField, value: string): string {
  return column.type === 'number' && value !== '' && Number.isFinite(Number(value)) ? formatNumber(Number(value)) : value;
}

/**
 * The `lines` field: a grid of rows whose cells are the kit's own inputs (`CellControl`). Controlled: the form
 * engine owns the rows, validates them on submit (`validateLines`) and passes the messages as `errors`.
 */
export function LinesField({ field, value: rows, onChange, errors = [], disabled = false }: LinesFieldProps) {
  const id = useId();
  // What `onPick`s prefilled, by row then cell (and the column that did it): a prefill is replaced by the next pick and
  // cleared with its pick, but a cell the user filled in is left alone.
  const prefilled = useRef<Record<number, Record<string, { by: string; value: string }>>>({});
  const setCell = (at: number, column: CellField, v: string, option?: OptionItem) => {
    const row = rows[at];
    const known = prefilled.current[at] ?? {};
    const picks = (column.type === 'select' && option ? column.onPick?.(option, { ...row, [column.name]: v }) ?? {} : {}) as LineRow;
    const applied: LineRow = {};
    for (const [cell, value] of Object.entries(picks)) {
      if ((row[cell] ?? '') === '' || row[cell] === known[cell]?.value) {
        applied[cell] = value;
        known[cell] = { by: column.name, value };
      }
    }
    const cleared: LineRow = {};
    if ((row[column.name] ?? '') !== v) {
      // The cells prefilled by a pick of a column that depends on this one go when it is cleared.
      const gone = field.columns.filter((d) => d.type === 'select' && d.dependsOnCell === column.name).map((d) => d.name);
      for (const [cell, record] of Object.entries(known)) {
        if (!gone.includes(record.by) || cell in applied) continue;
        if ((row[cell] ?? '') === record.value) cleared[cell] = '';
        delete known[cell];
      }
    }
    prefilled.current[at] = known;
    onChange(
      rows.map((r, i) => (i === at ? { ...r, [column.name]: v, ...cleared, ...applied } : r)),
      { row: at, cells: [column.name, ...Object.keys(cleared), ...Object.keys(applied)] },
    );
  };
  const removeRow = (at: number) => {
    const next: typeof prefilled.current = {};
    for (const [i, record] of Object.entries(prefilled.current)) if (Number(i) !== at) next[Number(i) > at ? Number(i) - 1 : Number(i)] = record;
    prefilled.current = next;
    onChange(rows.filter((_, i) => i !== at), { remove: at });
  };
  const taken = (column: CellField, at: number) =>
    column.type === 'select' && column.unique ? rows.filter((_, i) => i !== at).map((r) => r[column.name]).filter(Boolean) : undefined;
  const editable = !field.fixed && !disabled;
  // Numeric columns keep their width and the first (text / select) one a minimum, so on a phone the grid scrolls
  // sideways inside its container instead of squeezing the article column to nothing.
  const width = (c: CellField) => (c.type === 'number' || c.computed ? 'w-20 shrink-0 sm:w-28' : 'min-w-32 flex-1');
  const name = (c: CellField, i: number) => `${c.label} ligne ${i + 1}`;

  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={errors.length ? `${id}-errors` : undefined}>
      <legend className="block text-sm font-medium">{field.label}</legend>
      <div className="space-y-2 overflow-x-auto">
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        {field.columns.map((c) => <span key={c.name} className={width(c)}>{c.label}</span>)}
        {editable && <span className="w-9 shrink-0" />}
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          {field.columns.map((c) => (
            <div key={c.name} className={width(c)}>
              {c.computed ? (
                <div data-testid={`${c.name}-${i + 1}`} className="px-2 text-sm font-medium">
                  <span className="sr-only">{name(c, i)} : </span>
                  {c.computed(row)}
                </div>
              ) : c.readOnly ? (
                <p className="px-2 text-sm">
                  <span className="sr-only">{name(c, i)} : </span>
                  {shown(c, row[c.name] ?? '')}
                </p>
              ) : (
                <CellControl
                  field={c}
                  value={row[c.name] ?? ''}
                  aria-label={name(c, i)}
                  disabled={disabled}
                  excluded={taken(c, i)}
                  row={row}
                  currentLabel={c.type === 'select' ? c.currentLabel?.(row) : undefined}
                  onChange={(v, option) => setCell(i, c, String(v), option)}
                />
              )}
            </div>
          ))}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Retirer la ligne ${i + 1}`}
              disabled={rows.length <= (field.minRows ?? 0)}
              onClick={() => removeRow(i)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      ))}
      </div>
      {errors.length > 0 && (
        <ul id={`${id}-errors`} role="alert" className="space-y-0.5 text-sm text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {(editable || field.footer) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editable ? (
            <Button variant="outline" size="sm" onClick={() => onChange([...rows, emptyRow(field.columns)])}>
              <Plus aria-hidden className="size-4" />
              {field.addLabel ?? 'Ajouter une ligne'}
            </Button>
          ) : <span />}
          {field.footer?.(rows)}
        </div>
      )}
    </fieldset>
  );
}
