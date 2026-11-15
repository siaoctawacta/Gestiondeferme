import { useId } from 'react';
import { CellControl } from './CellControl';
import { LinesField } from './LinesField';
import type { CellField, Field, FormMode, LineRow } from './types';
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
    default: return v === null || v === undefined ? '' : String(v);
  }
}

/** The rows of a `lines` field as edited: only the columns, every cell a string (a stored `null` is empty). */
function linesValue(columns: CellField[], raw: unknown): LineRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => Object.fromEntries(columns.map((c) => {
    const v = (r as Record<string, unknown> | null)?.[c.name];
    return [c.name, v === null || v === undefined ? '' : String(v)];
  })));
}

/** A row whose every cell is empty is an untouched line: it is dropped from the payload and not counted for `minRows`. */
const isBlankRow = (columns: CellField[], row: LineRow) => columns.every((c) => c.computed || (row[c.name] ?? '').trim() === '');

/** A row as sent: numbers as numbers, text trimmed, empty and computed cells left out. */
function linePayload(columns: CellField[], row: LineRow): Values {
  const out: Values = {};
  for (const c of columns) {
    const v = row[c.name] ?? '';
    if (c.computed || v === '') continue;
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
    } else if (f.type === 'select' || f.type === 'date' || f.type === 'time') {
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
      if (c.computed) continue;
      const v = (row[c.name] ?? '').trim();
      const at = `Ligne ${i + 1} : le champ « ${c.label} »`;
      if (c.required && v === '') out.push(`${at} est requis`);
      else if (c.type === 'number' && v !== '' && c.min !== undefined && Number(v) < c.min) out.push(`${at} doit être supérieur ou égal à ${c.min}`);
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
  onChange: (v: unknown) => void;
  /** Label of the `dependsOn` parent field while it is still empty. */
  waitingFor?: string;
  /** Value of the `dependsOn` parent field. */
  parentValue?: string;
  /** Messages of a `lines` field, shown under its grid. */
  errors?: string[];
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

function LabelledControl({ field, value, onChange, parentValue, waitingFor }: FieldInputProps & { field: Exclude<Field, { type: 'multiselect' | 'checkbox' | 'lines' }> }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${LABEL} ${field.required ? "after:content-['*']" : ''}`}>{field.label}</label>
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          rows={3}
          className="w-full rounded-2xl border border-border bg-card px-4 py-2 text-sm"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <CellControl id={id} field={field} value={value} onChange={onChange} parentValue={parentValue} waitingFor={waitingFor} />
      )}
    </div>
  );
}

export function FieldInput(props: FieldInputProps) {
  const { field, value, onChange } = props;
  if (field.type === 'multiselect') return <MultiSelectInput {...props} field={field} />;
  if (field.type === 'lines') return <LinesField field={field} value={value as LineRow[]} onChange={onChange} errors={props.errors} />;
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
