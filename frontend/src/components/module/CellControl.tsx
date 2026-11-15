import { useRef } from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { cellOptions } from './cellOptions';
import type { CellField, Field, LineRow, OptionItem } from './types';
import { useAuth } from '../../lib/auth';
import { resolveEndpointTemplate, useEndpointOptions } from './useEndpointOptions';

/** A field rendered by a bare control (no label): the inputs of the form and the cells of a `lines` row. */
export type ControlField = Exclude<Field, { type: 'multiselect' | 'checkbox' | 'lines' | 'textarea' }> | CellField;

export interface CellControlProps {
  field: ControlField;
  value: unknown;
  /** `option` is the chosen option of a select (its `data` feeds a cell's `onPick`). */
  onChange: (v: unknown, option?: OptionItem) => void;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  /** Select: option values not offered (taken by another row), the current value always stays. */
  excluded?: string[];
  /** Select: value of the `dependsOn` parent, sent as a query parameter of the options request. */
  parentValue?: string;
  /** Select: label of the `dependsOn` parent while it is still empty (the select is then disabled). */
  waitingFor?: string;
  /** A `lines` cell: its row, which computes the options of a row-dependent select. */
  row?: LineRow;
  /** Select: label of the current value when the options do not offer it. */
  currentLabel?: string;
}

/**
 * THE bare input of the kit: text, date, time, number, password and select (static or endpoint options). The form
 * wraps it in a label (`FieldInput`); a `lines` row uses it as a cell.
 */
export function CellControl({ field, value, onChange, id, disabled, excluded, parentValue, waitingFor, row, currentLabel, ...aria }: CellControlProps) {
  // Labels of the values this control has been offered: one picked and since gone keeps its label.
  const seen = useRef<Record<string, string>>({});
  const { can } = useAuth();
  const dependsOn = field.type === 'select' && 'dependsOn' in field ? field.dependsOn : undefined;
  // `null`: a row-dependent cell with nothing to offer for this row.
  const source = field.type === 'select' ? cellOptions(field, row ?? {}) : [];
  const none = source === null;
  const needs = field.type === 'select' ? field.optionsPermission : undefined;
  const allowed = !needs || can(needs.module, needs.action);
  // `{parent}` in the endpoint is the parent's value (in the path); otherwise it is sent as a query parameter.
  const templated = source !== null && !Array.isArray(source) && /\{\w+\}/.test(source.endpoint);
  const options = useEndpointOptions(
    source === null || Array.isArray(source) ? source ?? [] : resolveEndpointTemplate(source, dependsOn, parentValue ?? ''),
    dependsOn && parentValue && !templated ? { [dependsOn]: parentValue } : undefined,
    !none && allowed && (!dependsOn || Boolean(parentValue)),
  );
  if (field.type === 'select') {
    const current = none ? '' : String(value);
    for (const o of options) seen.current[o.value] = o.label;
    return (
      <Select
        id={id}
        aria-label={aria['aria-label']}
        className="w-full"
        value={current}
        disabled={disabled || none || waitingFor !== undefined || !allowed}
        onChange={(e) => onChange(e.target.value, options.find((o) => o.value === e.target.value))}
      >
        <option value="">{none ? '—' : waitingFor !== undefined ? `Choisir d'abord ${waitingFor}` : 'Sélectionner…'}</option>
        {/* A stored value the options no longer offer (a closed lot, an inactive article, options not readable) stays the current choice and is resent unchanged. */}
        {current !== '' && !options.some((o) => o.value === current) && (
          <option value={current} disabled>{seen.current[current] ?? currentLabel ?? (allowed ? 'Valeur actuelle' : 'Valeur conservée')}</option>
        )}
        {options.filter((o) => o.value === current || !excluded?.includes(o.value)).map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      id={id}
      aria-label={aria['aria-label']}
      type={field.type}
      disabled={disabled}
      min={field.type === 'number' ? field.min : undefined}
      max={field.type === 'number' ? field.max : undefined}
      step={field.type === 'number' ? (typeof field.step === 'function' ? field.step(row ?? {}) : field.step) : undefined}
      placeholder={'placeholder' in field ? field.placeholder : undefined}
      autoComplete={field.type === 'password' ? 'new-password' : undefined}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
