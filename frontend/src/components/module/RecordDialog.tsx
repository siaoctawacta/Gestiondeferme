import { useId, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { errorMessage } from './errorMessage';
import type { Field, FormMode, ModuleConfig } from './types';
import { useEndpointOptions, type Option } from './useEndpointOptions';

type Values = Record<string, unknown>;

const LABEL = "block text-sm font-medium after:ml-0.5 after:text-destructive";

function initial(field: Field, raw: Values): unknown {
  const v = raw[field.name] ?? field.defaultValue;
  switch (field.type) {
    case 'checkbox': return Boolean(v ?? false);
    case 'multiselect': return Array.isArray(v) ? v.map(String) : [];
    default: return v === null || v === undefined ? '' : String(v);
  }
}

function defaultPayload(fields: Field[], values: Values, mode: FormMode): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.only && f.only !== mode) continue;
    const v = values[f.name];
    if (f.type === 'number') {
      if (v !== '') out[f.name] = Number(v);
    } else if (f.type === 'select' || f.type === 'date') {
      if (v !== '') out[f.name] = v;
    } else if (f.type === 'text' || f.type === 'textarea') {
      out[f.name] = String(v).trim();
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

function validate(fields: Field[], values: Values, mode: FormMode): string | null {
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
    if (f.type === 'password' && f.minLength && String(v).length < f.minLength) {
      return `Le champ « ${f.label} » doit contenir au moins ${f.minLength} caractères`;
    }
  }
  return null;
}

interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}

function SelectInput({ field, value, onChange, options }: FieldInputProps & { options: Option[] }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${LABEL} ${field.required ? "after:content-['*']" : ''}`}>{field.label}</label>
      <Select id={id} className="w-full" value={String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sélectionner…</option>
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

function FieldInput(props: FieldInputProps) {
  const { field, value, onChange } = props;
  const id = useId();
  const options = useEndpointOptions('options' in field ? field.options : []);
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
          autoComplete={field.type === 'password' ? 'new-password' : undefined}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export interface RecordDialogProps<T extends { id: string }> {
  config: ModuleConfig<T>;
  /** The row being edited; absent when creating. */
  row?: T;
  onClose: () => void;
  onSaved: () => void;
}

/** Add / edit form built from `config.fields`; server messages are shown under the form. */
export function RecordDialog<T extends { id: string }>({ config, row, onClose, onSaved }: RecordDialogProps<T>) {
  const mode: FormMode = row ? 'update' : 'create';
  const fields = config.fields.filter((f) => !f.only || f.only === mode);
  const [values, setValues] = useState<Values>(() => {
    const raw: Values = row ? (config.toForm ? config.toForm(row) : (row as unknown as Values)) : {};
    return Object.fromEntries(fields.map((f) => [f.name, initial(f, raw)]));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(fields, values, mode);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = config.toPayload ? config.toPayload(values, mode) : defaultPayload(fields, values, mode);
      if (row) await api.patch(`${config.endpoint}/${row.id}`, body);
      else await api.post(config.endpoint, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`${row ? 'Modifier' : 'Ajouter'} — ${config.title}`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {fields.map((f) => (
          <FieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
        ))}
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={saving}>Enregistrer</Button>
        </div>
      </form>
    </Dialog>
  );
}
