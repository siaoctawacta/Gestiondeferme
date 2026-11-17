import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import type { Action, ModuleKey } from '../../lib/modules';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import { changedFields } from './changedFields';
import { errorMessage } from './errorMessage';
import { FieldInput, defaultPayload, firstInvalid, initialValue, validateLines } from './formFields';
import type { Field, FormMode, LineRow, LinesEdit } from './types';
import { useDependentValues } from './useDependentValues';

type Values = Record<string, unknown>;

export interface ActionDialogProps {
  title: string;
  /**
   * Inputs. A function of the values as the form holds them (the record's, the edited ones and, when creating, the
   * defaults of the fields it returns: no `?? default` needed) lets a field appear depending on another. It must be pure:
   * it is called more than once per render.
   */
  fields: Field[] | ((values: Values) => Field[]);
  /** Initial values by field name (the record, for an edit); `defaultValue` of the field applies when creating only. */
  initial?: Values;
  /** Text above the inputs. */
  intro?: ReactNode;
  /** Fields with `only` for the other mode are left out (default `create`). */
  mode?: FormMode;
  submitLabel?: string;
  /** Wide dialog (`max-w-3xl`): for a form holding a `lines` grid of more than three columns, which needs ~640px. */
  wide?: boolean;
  /**
   * Check across fields, run after the fields' own checks on submit (a total that must reach 100 %). Return the
   * French message to show in the dialog, or `null`.
   */
  validate?: (values: Values) => string | null;
  /** Form values to request body (default: the shown fields, numbers coerced). */
  toPayload?: (values: Values, mode: FormMode) => unknown;
  /**
   * Sends the request; a rejection is shown in the dialog, like the server's French messages. In `update` mode it
   * receives only what changed (see below) and is not called at all when nothing did.
   */
  onSubmit: (body: unknown) => Promise<unknown>;
  /** Called each time the user changes a field (a form that must know its values were touched). */
  onEdit?: () => void;
  onClose: () => void;
  /** Called after a successful `onSubmit` (or straight away when an edit changed nothing). */
  onDone: () => void;
}

/**
 * THE form engine of the kit: kit fields, `dependsOn` clearing, validation, request and server error display.
 * `RecordForm` and `RecordDialog` are thin adapters over it, and one-off actions (a farrowing, a weighing, a stock
 * exit...) use it directly.
 *
 * One semantics for writes:
 * - creating sends the non-empty values only;
 * - editing (`mode: 'update'`) sends only the keys whose value differs from the loaded record (`initial`), and a
 *   cleared optional field as `null`. A required field cannot be cleared (validation). An edit that changes
 *   nothing sends no request and closes.
 */
export function ActionDialog({
  title, fields, initial = {}, intro, mode = 'create', submitLabel = 'Enregistrer', wide, validate, toPayload, onSubmit, onEdit, onClose, onDone,
}: ActionDialogProps) {
  const [edited, setEdited] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Messages of the `lines` field that failed validation, shown under its grid. */
  const [lineErrors, setLineErrors] = useState<{ name: string; messages: string[] } | null>(null);

  // A `fields` function sees the values as the form holds them: when creating, a field's default is already in. The
  // fields it returns for the raw values say which defaults apply (a field only some values show is resolved on the second pass).
  const raw = { ...initial, ...edited };
  const inMode = (list: Field[]) => list.filter((f) => !f.only || f.only === mode);
  const all = typeof fields === 'function' ? fields({ ...raw, ...valuesOf(edited, initial, inMode(fields(raw)), mode) }) : fields;
  const { can } = useAuth();
  // Options the user may not read cannot be chosen: such a select (or select column of a `lines` grid) is never required.
  const unreadable = (f: { optionsPermission?: { module: ModuleKey; action: Action } }) =>
    f.optionsPermission !== undefined && !can(f.optionsPermission.module, f.optionsPermission.action);
  const shown = inMode(all)
    .map((f): Field => {
      if (f.type === 'select') return f.required && unreadable(f) ? { ...f, required: false } : f;
      if (f.type === 'lines') {
        return { ...f, columns: f.columns.map((c) => (c.type === 'select' && c.required && unreadable(c) ? { ...c, required: false } : c)) };
      }
      return f;
    });
  // Dependent selects: stale values are cleared (see `useDependentValues`), shown or not.
  const dependent = useDependentValues(shown, valuesOf(edited, initial, shown, mode));
  const values = dependent.values;

  /** Sets a field; selects depending on it (and theirs in turn) lose their value, shown or not. */
  const setField = (name: string, v: unknown, edit?: LinesEdit) => {
    onEdit?.();
    setLineErrors((e) => (e?.name === name ? null : e));
    if (edit) dependent.changeRows(name, v as LineRow[], edit);
    else dependent.change(name, v);
    setEdited((s) => ({ ...s, [name]: v }));
  };

  const build = (v: Values): Values =>
    (toPayload ? toPayload(v, mode) : defaultPayload(shown, v, mode)) as Values;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = firstInvalid(shown, values, mode);
    setLineErrors(null);
    if (invalid?.field.type === 'lines') {
      setError(null);
      return setLineErrors({ name: invalid.field.name, messages: validateLines(invalid.field, values[invalid.field.name] as LineRow[]) });
    }
    const custom = invalid?.message ?? validate?.(values) ?? null;
    if (custom) return setError(custom);
    setBusy(true);
    setError(null);
    try {
      let body: Values;
      if (mode === 'update') {
        body = changedFields(stored(build, valuesOf({}, initial, shown, mode)), build(values));
        if (Object.keys(body).length === 0) return onDone();
      } else {
        body = withoutEmpty(build(values));
      }
      await onSubmit(body);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={title} wide={wide}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {intro && <div className="text-sm text-muted-foreground">{intro}</div>}
        {shown.map((f) => {
          const { parentValue, waitingFor } = dependent.parentOf(f);
          return (
            <FieldInput
              key={f.name}
              field={f}
              value={values[f.name]}
              onChange={(v, edit) => setField(f.name, v, edit)}
              parentValue={parentValue}
              waitingFor={waitingFor}
              errors={lineErrors?.name === f.name ? lineErrors.messages : undefined}
              hint={typeof f.hint === 'function' ? f.hint(values) : f.hint}
            />
          );
        })}
        {error && <Alert>{error}</Alert>}
        <DialogActions>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={busy}>{submitLabel}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Edited value, else the stored value (else, when creating, the field's default). */
function valuesOf(edited: Values, initial: Values, fields: Field[], mode: FormMode): Values {
  return Object.fromEntries(fields.map((f) => [f.name, f.name in edited ? edited[f.name] : initialValue(f, initial, mode)]));
}

const isEmpty = (v: unknown) => v === '' || v === undefined;

/** The payload of the record as loaded; a `toPayload` that refuses the stored values (it throws) counts as empty. */
function stored(build: (v: Values) => Values, loaded: Values): Values {
  try {
    return build(loaded);
  } catch {
    return {};
  }
}

/** `body` without its empty values (`''`, `undefined`): what a create sends. */
export function withoutEmpty(body: Values): Values {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => !isEmpty(v)));
}
