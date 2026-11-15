import { useId } from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import type { Field, FormMode } from './types';
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
    case 'checkbox': return Boolean(v ?? false);
    case 'multiselect': return Array.isArray(v) ? v.map(String) : [];
    default: return v === null || v === undefined ? '' : String(v);
  }
}

export function defaultPayload(fields: Field[], values: Values, mode: FormMode): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.only && f.only !== mode) continue;
    const v = values[f.name];
    if (f.type === 'number') {
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

export function validate(fields: Field[], values: Values, mode: FormMode): string | null {
  for (const f of fields) {
    if (f.only && f.only !== mode) continue;
    const v = values[f.name];
    const empty = f.type === 'multiselect' ? (v as string[]).length === 0
      : f.type === 'checkbox' ? false
        : String(v).trim() === '';
    if (f.required && empty) return `Le champ « ${f.label} » est requis`;
    if (f.type === 'number' && !empty && f.min !== undefined && Number(v) < f.min) {
      return `Le champ « ${f.label} » doit être supérieur ou égal à ${f.min}`;
    }
    if (f.type === 'number' && !empty && f.max !== undefined && Number(v) > f.max) {
      return `Le champ « ${f.label} » doit être inférieur ou égal à ${f.max}`;
    }
    if (f.type === 'password' && f.minLength && String(v).length < f.minLength) {
      return `Le champ « ${f.label} » doit contenir au moins ${f.minLength} caractères`;
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
}

function SelectInput({ field, value, onChange, options, waitingFor }: FieldInputProps & { options: Option[] }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${LABEL} ${field.required ? "after:content-['*']" : ''}`}>{field.label}</label>
      <Select id={id} className="w-full" value={String(value)} disabled={waitingFor !== undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="">{waitingFor !== undefined ? `Choisir d'abord ${waitingFor}` : 'Sélectionner…'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );
}

function MultiSelectInput({ field, value, onChange, options }: FieldInputProps & { options: Option[] }) {
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

export function FieldInput(props: FieldInputProps & { parentValue?: string }) {
  const { field, value, onChange, parentValue } = props;
  const id = useId();
  const dependsOn = field.type === 'select' ? field.dependsOn : undefined;
  const parentReady = !dependsOn || Boolean(parentValue);
  const options = useEndpointOptions(
    'options' in field ? field.options : [],
    dependsOn && parentValue ? { [dependsOn]: parentValue } : undefined,
    parentReady,
  );
  if (field.type === 'select') return <SelectInput {...props} options={options} />;
  if (field.type === 'multiselect') return <MultiSelectInput {...props} options={options} />;
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
        <Input
          id={id}
          type={field.type}
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          step={field.type === 'number' ? field.step : undefined}
          autoComplete={field.type === 'password' ? 'new-password' : undefined}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

