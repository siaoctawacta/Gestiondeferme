import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import type { CellField, Field } from './types';
import { useEndpointOptions } from './useEndpointOptions';

/** A field rendered by a bare control (no label): the inputs of the form and the cells of a `lines` row. */
export type ControlField = Exclude<Field, { type: 'multiselect' | 'checkbox' | 'lines' | 'textarea' }> | CellField;

export interface CellControlProps {
  field: ControlField;
  value: unknown;
  onChange: (v: unknown) => void;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  /** Select: option values not offered (taken by another row), the current value always stays. */
  excluded?: string[];
  /** Select: value of the `dependsOn` parent, sent as a query parameter of the options request. */
  parentValue?: string;
  /** Select: label of the `dependsOn` parent while it is still empty (the select is then disabled). */
  waitingFor?: string;
}

/**
 * THE bare input of the kit: text, date, time, number, password and select (static or endpoint options). The form
 * wraps it in a label (`FieldInput`); a `lines` row uses it as a cell.
 */
export function CellControl({ field, value, onChange, id, disabled, excluded, parentValue, waitingFor, ...aria }: CellControlProps) {
  const dependsOn = field.type === 'select' && 'dependsOn' in field ? field.dependsOn : undefined;
  const source = field.type === 'select' ? field.options : [];
  // `{parent}` in the endpoint is the parent's value (in the path); otherwise it is sent as a query parameter.
  const templated = dependsOn && !Array.isArray(source) && source.endpoint.includes(`{${dependsOn}}`);
  const options = useEndpointOptions(
    templated && !Array.isArray(source) ? { ...source, endpoint: source.endpoint.replace(`{${dependsOn}}`, encodeURIComponent(parentValue ?? '')) } : source,
    dependsOn && parentValue && !templated ? { [dependsOn]: parentValue } : undefined,
    !dependsOn || Boolean(parentValue),
  );
  if (field.type === 'select') {
    const current = String(value);
    return (
      <Select
        id={id}
        aria-label={aria['aria-label']}
        className="w-full"
        value={current}
        disabled={disabled || waitingFor !== undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{waitingFor !== undefined ? `Choisir d'abord ${waitingFor}` : 'Sélectionner…'}</option>
        {options.filter((o) => o.value === current || !excluded?.includes(o.value)).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
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
      step={field.type === 'number' ? field.step : undefined}
      autoComplete={field.type === 'password' ? 'new-password' : undefined}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
