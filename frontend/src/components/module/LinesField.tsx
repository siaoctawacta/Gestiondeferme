import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { formatNumber } from '../../lib/format';
import { CellControl } from './CellControl';
import type { CellField, Field, LineRow } from './types';

export type LinesFieldDef = Extract<Field, { type: 'lines' }>;

export interface LinesFieldProps {
  field: LinesFieldDef;
  value: LineRow[];
  onChange: (rows: LineRow[]) => void;
  /** Validation messages, shown under the grid. */
  errors?: string[];
  /** The rows are the given ones: no add or remove button (a count sheet over a fixed list of items). */
  fixed?: boolean;
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
export function LinesField({ field, value: rows, onChange, errors = [], fixed = false, disabled = false }: LinesFieldProps) {
  const id = useId();
  const setCell = (at: number, name: string, v: string) =>
    onChange(rows.map((r, i) => (i === at ? { ...r, [name]: v } : r)));
  const taken = (column: CellField, at: number) =>
    column.type === 'select' && column.unique ? rows.filter((_, i) => i !== at).map((r) => r[column.name]).filter(Boolean) : undefined;
  const editable = !fixed && !disabled;
  const width = (c: CellField) => (c.type === 'number' || c.computed ? 'w-28 shrink-0' : 'min-w-0 flex-1');

  return (
    <fieldset className="space-y-2" aria-describedby={errors.length ? `${id}-errors` : undefined}>
      <legend className="block text-sm font-medium">{field.label}</legend>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
        {field.columns.map((c) => <span key={c.name} className={width(c)}>{c.label}</span>)}
        {editable && <span className="w-9 shrink-0" />}
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          {field.columns.map((c) => (
            <div key={c.name} className={width(c)}>
              {c.computed ? (
                <div data-testid={`${c.name}-${i + 1}`} className="px-2 text-sm font-medium">{c.computed(row)}</div>
              ) : c.readOnly ? (
                <p className="px-2 text-sm">{shown(c, row[c.name] ?? '')}</p>
              ) : (
                <CellControl
                  field={c}
                  value={row[c.name] ?? ''}
                  aria-label={`${c.label} ligne ${i + 1}`}
                  disabled={disabled}
                  excluded={taken(c, i)}
                  onChange={(v) => setCell(i, c.name, String(v))}
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
              onClick={() => onChange(rows.filter((_, at) => at !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      ))}
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
