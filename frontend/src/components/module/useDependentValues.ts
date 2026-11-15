import { useState } from 'react';
import type { Field } from './types';

type Values = Record<string, unknown>;

interface Meta {
  /** How often each field was changed. */
  rev: Record<string, number>;
  /** For a dependent select the user chose a value for: which parent field, and which of its changes, it was chosen under. */
  bound: Record<string, { parent: string; rev: number }>;
  /** The fields the user changed (their value is theirs, not the stored one). */
  touched: Record<string, true>;
}

export interface DependentValues {
  /** The values given, with every stale dependent value replaced by `''` (a new object; the input is never mutated). */
  values: Values;
  /** Records that the user set `name` to `next`: call it with every change, next to the form's own state update. */
  change: (name: string, next: unknown) => void;
  /** What a select needs of its `dependsOn` parent: its value (for the endpoint's params or path template), and its label while still empty. `{}` for any other field. */
  parentOf: (field: Field) => { parentValue?: string; waitingFor?: string };
}

/**
 * The bookkeeping of selects that depend on another field (`dependsOn`), shared by every form that holds values:
 * `fields` are the fields shown, `values` what the form holds (edited values over the stored ones).
 *
 * A dependent value is only live under the very parent change it was chosen after: it never survives a later
 * change of the parent (even while hidden), nor a move of its `dependsOn` to another field, and a grandchild goes
 * with its cleared parent. A stored value nobody touched stays live until its parent is changed, whatever the
 * options now offer (the select shows it as « Valeur actuelle »).
 */
export function useDependentValues(fields: Field[], values: Values): DependentValues {
  const [meta, setMeta] = useState<Meta>({ rev: {}, bound: {}, touched: {} });

  const live = (f: Field, depth = 0): boolean => {
    if (f.type !== 'select' || !f.dependsOn || depth > fields.length) return true;
    const rev = meta.rev[f.dependsOn] ?? 0;
    const own = f.name in meta.touched ? meta.bound[f.name]?.parent === f.dependsOn && meta.bound[f.name].rev === rev : rev === 0;
    const parent = fields.find((p) => p.name === f.dependsOn);
    return own && (!parent || live(parent, depth + 1));
  };

  const cleaned: Values = { ...values };
  for (const f of fields) if (!live(f)) cleaned[f.name] = '';

  const change = (name: string, next: unknown) => {
    // Against what the user sees: a value cleared by its parent counts as empty, so picking it again is a change.
    const changed = JSON.stringify(cleaned[name] ?? '') !== JSON.stringify(next ?? '');
    const field = fields.find((f) => f.name === name && f.type === 'select');
    setMeta((m) => {
      const rev = changed ? { ...m.rev, [name]: (m.rev[name] ?? 0) + 1 } : m.rev;
      const parent = field?.type === 'select' ? field.dependsOn : undefined;
      return {
        rev,
        bound: parent ? { ...m.bound, [name]: { parent, rev: rev[parent] ?? 0 } } : m.bound,
        touched: { ...m.touched, [name]: true },
      };
    });
  };

  const parentOf = (field: Field) => {
    if (field.type !== 'select' || !field.dependsOn) return {};
    const parent = fields.find((p) => p.name === field.dependsOn);
    const parentValue = parent ? String(cleaned[parent.name] ?? '') : undefined;
    return { parentValue, waitingFor: parent && !parentValue ? parent.label : undefined };
  };

  return { values: cleaned, change, parentOf };
}
