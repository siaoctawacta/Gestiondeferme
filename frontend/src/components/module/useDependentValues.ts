import { useState } from 'react';
import type { CellField, Field, LineRow, LinesEdit } from './types';

type Values = Record<string, unknown>;

interface Meta {
  /** How often each field was changed. */
  rev: Record<string, number>;
  /** For a dependent select the user chose a value for: which parent field, and which of its changes, it was chosen under. */
  bound: Record<string, { parent: string; rev: number }>;
  /** The fields the user changed (their value is theirs, not the stored one). */
  touched: Record<string, true>;
}

interface State extends Meta {
  /** The same bookkeeping for the cells of each row of a `lines` field, by field name then row index. */
  rows: Record<string, Meta[]>;
}

const EMPTY: Meta = { rev: {}, bound: {}, touched: {} };

export interface DependentValues {
  /** The values given, with every stale dependent value replaced by `''` (a new object; the input is never mutated). */
  values: Values;
  /** Records that the user set `name` to `next`: call it with every change, next to the form's own state update. */
  change: (name: string, next: unknown) => void;
  /**
   * Records an edit of a `lines` field, with `rows` the new rows: the cells of one row that the user (or an `onPick`)
   * set, or a removed row (the bookkeeping of the rows after it moves up with them). Call it instead of `change` for such an edit.
   */
  changeRows: (name: string, rows: LineRow[], edit: LinesEdit) => void;
  /** What a select needs of its `dependsOn` parent: its value (for the endpoint's params or path template), and its label while still empty. `{}` for any other field. */
  parentOf: (field: Field) => { parentValue?: string; waitingFor?: string };
}

/** `meta` after `name` was set: counts a real change, and binds a dependent value to the parent change it was chosen under. */
function recorded(meta: Meta, name: string, changed: boolean, parent: string | undefined): Meta {
  const rev = changed ? { ...meta.rev, [name]: (meta.rev[name] ?? 0) + 1 } : meta.rev;
  return {
    rev,
    bound: parent ? { ...meta.bound, [name]: { parent, rev: rev[parent] ?? 0 } } : meta.bound,
    touched: { ...meta.touched, [name]: true },
  };
}

/** Whether `name`, depending on `parent`, is still live: untouched under an untouched parent, or chosen after the parent's last change. */
function liveUnder(meta: Meta, name: string, parent: string | undefined): boolean {
  if (!parent) return true;
  const rev = meta.rev[parent] ?? 0;
  return name in meta.touched ? meta.bound[name]?.parent === parent && meta.bound[name].rev === rev : rev === 0;
}

const parentCell = (c: CellField): string | undefined => (c.type === 'select' ? c.dependsOnCell : undefined);

/**
 * The bookkeeping of selects that depend on another field (`dependsOn`), shared by every form that holds values:
 * `fields` are the fields shown, `values` what the form holds (edited values over the stored ones).
 *
 * A dependent value is only live under the very parent change it was chosen after: it never survives a later
 * change of the parent (even while hidden), nor a move of its `dependsOn` to another field, and a grandchild goes
 * with its cleared parent. A stored value nobody touched stays live until its parent is changed, whatever the
 * options now offer (the select shows it as « Valeur actuelle »).
 *
 * The same rules hold inside a `lines` field for a cell with `dependsOnCell`, per row: changing the parent cell of a
 * row clears that row's dependent cells and no other row's.
 */
export function useDependentValues(fields: Field[], values: Values): DependentValues {
  const [state, setState] = useState<State>({ ...EMPTY, rows: {} });

  const live = (f: Field, depth = 0): boolean => {
    if (f.type !== 'select' || !f.dependsOn || depth > fields.length) return true;
    const parent = fields.find((p) => p.name === f.dependsOn);
    return liveUnder(state, f.name, f.dependsOn) && (!parent || live(parent, depth + 1));
  };

  const liveCell = (columns: CellField[], meta: Meta, c: CellField, depth = 0): boolean => {
    const parent = parentCell(c);
    if (!parent || depth > columns.length) return true;
    const above = columns.find((p) => p.name === parent);
    return liveUnder(meta, c.name, parent) && (!above || liveCell(columns, meta, above, depth + 1));
  };

  const cleaned: Values = { ...values };
  for (const f of fields) {
    if (!live(f)) {
      cleaned[f.name] = '';
      continue;
    }
    const rows = cleaned[f.name];
    if (f.type !== 'lines' || !Array.isArray(rows)) continue;
    cleaned[f.name] = (rows as LineRow[]).map((row, i) => {
      const meta = state.rows[f.name]?.[i] ?? EMPTY;
      const stale = f.columns.filter((c) => (row[c.name] ?? '') !== '' && !liveCell(f.columns, meta, c));
      return stale.length === 0 ? row : { ...row, ...Object.fromEntries(stale.map((c) => [c.name, ''])) };
    });
  }

  const change = (name: string, next: unknown) => {
    // Against what the user sees: a value cleared by its parent counts as empty, so picking it again is a change.
    const changed = JSON.stringify(cleaned[name] ?? '') !== JSON.stringify(next ?? '');
    const field = fields.find((f) => f.name === name && f.type === 'select');
    setState((s) => ({
      ...s,
      ...recorded(s, name, changed, field?.type === 'select' ? field.dependsOn : undefined),
    }));
  };

  const changeRows = (name: string, rows: LineRow[], edit: LinesEdit) => {
    const field = fields.find((f) => f.name === name && f.type === 'lines');
    if (field?.type !== 'lines') return;
    if ('remove' in edit) {
      setState((s) => ({ ...s, rows: { ...s.rows, [name]: (s.rows[name] ?? []).filter((_, i) => i !== edit.remove) } }));
      return;
    }
    const seen = (cleaned[name] as LineRow[] | undefined)?.[edit.row];
    setState((s) => {
      const metas = [...(s.rows[name] ?? [])];
      while (metas.length <= edit.row) metas.push(EMPTY);
      let meta = metas[edit.row];
      for (const cell of edit.cells) {
        const column = field.columns.find((c) => c.name === cell);
        meta = recorded(meta, cell, (seen?.[cell] ?? '') !== (rows[edit.row]?.[cell] ?? ''), column && parentCell(column));
      }
      metas[edit.row] = meta;
      return { ...s, rows: { ...s.rows, [name]: metas } };
    });
  };

  const parentOf = (field: Field) => {
    if (field.type !== 'select' || !field.dependsOn) return {};
    const parent = fields.find((p) => p.name === field.dependsOn);
    const parentValue = parent ? String(cleaned[parent.name] ?? '') : undefined;
    return { parentValue, waitingFor: parent && !parentValue ? parent.label : undefined };
  };

  return { values: cleaned, change, changeRows, parentOf };
}
