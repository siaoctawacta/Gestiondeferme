import { useId } from 'react';
import { Segmented } from '../ui/Segmented';
import { CellControl } from './CellControl';
import { cellIsOff } from './cellOptions';
import { LinesField } from './LinesField';
import type { CellField, Field, FormMode, LineRow, LinesEdit } from './types';
import { useEndpointOptions, type Option } from './useEndpointOptions';

type Values = Record<string, unknown>;

const LABEL = "block text-sm font-medium after:ml-0.5 after:text-destructive";

/**
 * Form value of a field: the stored value (`raw`), else, when creating, the field's `defaultValue` (a function is
 * called now, so date defaults are the day the dialog opens). An edit never falls back to the default: a stored
 * `null` is an empty field.
 */
export function initialValue(field: Field, raw: Values, mode: FormMode = 'create'): unknown {
  const fallback = typeof field.defaultValue === 'function' ? (field.defaultValue as () => unknown)() : field.defaultValue;
  const v = mode === 'update' ? raw[field.name] : raw[field.name] ?? fallback;
  switch (field.type) {
    case 'lines': return linesValue(field.columns, v);
    case 'checkbox': return Boolean(v ?? false);
    case 'multiselect': return Array.isArray(v) ? v.map(String) : [];
    case 'file': return '';
    default: return v === null || v === undefined ? '' : String(v);
  }
}

/**
 * The rows of a `lines` field as edited: every column, every cell a string (a stored `null` is empty). Keys of the stored
 * row that are no column are kept as strings, untouched, so a `toPayload` over a `fixed` grid can read what the row
 * stands for (an invoice line's id and price); they are never part of a request (`linePayload` reads the columns only).
 */
function linesValue(columns: CellField[], raw: unknown): LineRow[] {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return raw.map((r) => {
    const stored = (r ?? {}) as Record<string, unknown>;
    const extras = Object.fromEntries(Object.entries(stored).filter(([key]) => !columns.some((c) => c.name === key)).map(([key, v]) => [key, text(v)]));
    return { ...extras, ...Object.fromEntries(columns.map((c) => [c.name, text(stored[c.name])])) };
  });
}

/** A row whose every cell is empty is an untouched line: it is dropped from the payload and not counted for `minRows`. */
const isBlankRow = (columns: CellField[], row: LineRow) => columns.every((c) => c.computed || (row[c.name] ?? '').trim() === '');

/** A row as sent: numbers as numbers, text trimmed, empty and computed cells left out. */
function linePayload(columns: CellField[], row: LineRow): Values {
  const out: Values = {};
  for (const c of columns) {
    const v = row[c.name] ?? '';
    // A cell with no options for this row (a source for a service) is not part of the line.
    if (c.computed || v === '' || cellIsOff(c, row)) continue;
    out[c.name] = c.type === 'number' ? Number(v) : c.type === 'text' ? v.trim() : v;
  }
  return out;
}

export function defaultPayload(fields: Field[], values: Values, mode: FormMode): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.only && f.only !== mode) continue;
    const v = values[f.name];
    if (f.type === 'lines') {
      out[f.name] = (v as LineRow[]).filter((r) => !isBlankRow(f.columns, r)).map((r) => linePayload(f.columns, r));
    } else if (f.type === 'number') {
      if (v !== '') out[f.name] = Number(v);
    } else if (f.type === 'select' || f.type === 'segmented' || f.type === 'date' || f.type === 'time' || f.type === 'file') {
      if (v !== '') out[f.name] = v;
    } else if (f.type === 'text' || f.type === 'textarea') {
      out[f.name] = String(v).trim();
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

/**
 * Every message of a `lines` field: too few rows (blank rows do not count), then each filled row's cells in order
 * (`Ligne 2 : le champ « X » est requis`, numbered as on screen).
 */
export function validateLines(field: Extract<Field, { type: 'lines' }>, rows: LineRow[]): string[] {
  const out: string[] = [];
  const filled = rows.map((row, i) => ({ row, i })).filter(({ row }) => !isBlankRow(field.columns, row));
  if (filled.length < (field.minRows ?? 0)) out.push('Ajoutez au moins une ligne');
  for (const { row, i } of filled) {
    for (const c of field.columns) {
      if (c.computed || cellIsOff(c, row)) continue;
      const v = (row[c.name] ?? '').trim();
      const at = `Ligne ${i + 1} : le champ « ${c.label} »`;
      if (c.required && v === '') out.push(`${at} est requis`);
      else if (c.type === 'number' && v !== '' && Number.isFinite(Number(v)) && (typeof c.integer === 'function' ? c.integer(row) : c.integer) && !Number.isInteger(Number(v))) {
        out.push(c.integerMessage ? `Ligne ${i + 1} : ${c.integerMessage}` : `${at} doit être un nombre entier`);
      } else if (c.type === 'number' && v !== '' && c.min !== undefined && Number(v) < c.min) out.push(`${at} doit être supérieur ou égal à ${c.min}`);
      else if (c.type === 'number' && v !== '' && c.max !== undefined && Number(v) > c.max) out.push(`${at} doit être inférieur ou égal à ${c.max}`);
    }
  }
  return out;
}

/** The first field that does not validate, with its message (a `lines` field with the first of its messages). */
export function firstInvalid(fields: Field[], values: Values, mode: FormMode): { field: Field; message: string } | null {
  for (const f of fields) {
    if (f.only && f.only !== mode) continue;
    const v = values[f.name];
    if (f.type === 'lines') {
      const [message] = validateLines(f, v as LineRow[]);
      if (message) return { field: f, message };
      continue;
    }
    const empty = f.type === 'multiselect' ? (v as string[]).length === 0
      : f.type === 'checkbox' ? false
        : f.type === 'file' ? v === ''
        : String(v).trim() === '';
    const fail = (message: string) => ({ field: f, message });
    if (f.required && empty) return fail(`Le champ « ${f.label} » est requis`);
    if (f.type === 'number' && !empty && f.min !== undefined && Number(v) < f.min) {
      return fail(`Le champ « ${f.label} » doit être supérieur ou égal à ${f.min}`);
    }
    if (f.type === 'number' && !empty && f.max !== undefined && Number(v) > f.max) {
      return fail(`Le champ « ${f.label} » doit être inférieur ou égal à ${f.max}`);
    }
    if (f.type === 'password' && f.minLength && String(v).length < f.minLength) {
      return fail(`Le champ « ${f.label} » doit contenir au moins ${f.minLength} caractères`);
    }
  }
  return null;
}

export interface FieldInputProps {
  field: Field;
  value: unknown;
  /** `edit` accompanies the rows of a `lines` field (see `LinesEdit`). */
  onChange: (v: unknown, edit?: LinesEdit) => void;
  /** Label of the `dependsOn` parent field while it is still empty. */
  waitingFor?: string;
  /** Value of the `dependsOn` parent field. */
  parentValue?: string;
  /** Messages of a `lines` field, shown under its grid. */
  errors?: string[];
  /** The field's helper text, already resolved against the form values. */
  hint?: string;
}

function MultiSelectInput({ field, value, onChange }: FieldInputProps & { field: Extract<Field, { type: 'multiselect' }> }) {
  const options: Option[] = useEndpointOptions(field.options);
  const selected = value as string[];
  return (
    <fieldset className="space-y-1.5">
      <legend className={`${LABEL} ${field.required ? "after:content-['*']" : ''}`}>{field.label}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-2xl border border-border p-3">
        {options.length === 0 && <p className="text-sm text-muted-foreground">Aucune option</p>}
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={selected.includes(o.value)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))
              }
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LabelledControl({ field, value, onChange, parentValue, waitingFor, hint }: FieldInputProps & { field: Exclude<Field, { type: 'multiselect' | 'checkbox' | 'lines' | 'segmented' }> }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${LABEL} ${field.required ? "after:content-['*']" : ''}`}>{field.label}</label>
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          rows={3}
          className="w-full rounded-2xl border border-border bg-card px-4 py-2 text-sm"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'file' ? (
        <input
          id={id}
          type="file"
          accept={field.accept}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="block w-full text-sm file:mr-3 file:h-10 file:rounded-full file:border file:border-border file:bg-card file:px-4 file:text-sm"
          onChange={(e) => onChange(e.target.files?.[0] ?? '')}
        />
      ) : (
        <CellControl id={id} aria-describedby={hint ? `${id}-hint` : undefined} field={field} value={value} onChange={(v) => onChange(v)} parentValue={parentValue} waitingFor={waitingFor} currentLabel={field.type === 'select' ? field.currentLabel : undefined} />
      )}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FieldInput(props: FieldInputProps) {
  const { field, value, onChange } = props;
  if (field.type === 'multiselect') return <MultiSelectInput {...props} field={field} />;
  if (field.type === 'lines') return <LinesField field={field} value={value as LineRow[]} onChange={(rows, edit) => onChange(rows, edit)} errors={props.errors} />;
  if (field.type === 'segmented') {
    return (
      <div className="space-y-1.5">
        <span className={`${LABEL} ${field.required ? "after:content-['*']" : ''}`}>{field.label}</span>
        <Segmented label={field.label} value={String(value)} options={field.options} onChange={onChange} />
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  return <LabelledControl {...props} field={field} />;
}
