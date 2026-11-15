import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { ActionDialog } from './ActionDialog';
import type { Field, FormMode } from './types';

type Values = Record<string, unknown>;

export interface RecordFormProps {
  /** Dialog title suffix: `Ajouter — {label}` / `Modifier — {label}`. */
  label: string;
  /** The record being edited; absent when adding. */
  row?: { id: string };
  fields: Field[] | ((values: Values) => Field[]);
  /** Stored values of the record when editing (what the edit is compared with). */
  initial?: Values;
  intro?: ReactNode;
  toPayload?: (values: Values, mode: FormMode) => unknown;
  validate?: (values: Values) => string | null;
  /** `POST` target when adding. */
  createPath: string;
  /** `PATCH` target when editing. */
  patchPath: (row: { id: string }) => string;
  /** Fixed values merged into the create body (the list's scope). */
  scope?: Record<string, string>;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * The add / edit dialog of a record: `POST createPath` (with the scope) or `PATCH` the row with what changed.
 * The write semantics (changed keys only, `null` for a cleared field, no request when nothing changed) are the
 * form engine's, `ActionDialog`.
 */
export function RecordForm({ label, row, createPath, patchPath, scope, onSaved, onClose, ...rest }: RecordFormProps) {
  return (
    <ActionDialog
      {...rest}
      title={`${row ? 'Modifier' : 'Ajouter'} — ${label}`}
      mode={row ? 'update' : 'create'}
      onSubmit={(body) => (row ? api.patch(patchPath(row), body) : api.post(createPath, { ...(body as object), ...scope }))}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}
