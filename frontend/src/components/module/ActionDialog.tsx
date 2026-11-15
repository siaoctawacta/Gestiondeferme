import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import { changedFields } from './changedFields';
import { errorMessage } from './errorMessage';
import { FieldInput, defaultPayload, firstInvalid, initialValue, validateLines } from './formFields';
import type { Field, FormMode, LineRow } from './types';

type Values = Record<string, unknown>;

export interface ActionDialogProps {
  title: string;
  /**
   * Inputs. A function of the values edited so far (a name is missing until the field was given a value or an
   * `initial`) lets a field appear depending on another.
   */
  fields: Field[] | ((values: Values) => Field[]);
  /** Initial values by field name (the record, for an edit); `defaultValue` of the field applies when creating only. */
  initial?: Values;
  /** Text above the inputs. */
  intro?: ReactNode;
  /** Fields with `only` for the other mode are left out (default `create`). */
  mode?: FormMode;
  submitLabel?: string;
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
  title, fields, initial = {}, intro, mode = 'create', submitLabel = 'Enregistrer', validate, toPayload, onSubmit, onClose, onDone,
}: ActionDialogProps) {
  const [edited, setEdited] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Messages of the `lines` field that failed validation, shown under its grid. */
  const [lineErrors, setLineErrors] = useState<{ name: string; messages: string[] } | null>(null);

  /**
   * How often each field was changed, and which parent (and which of its changes) a dependent's value was chosen
   * under. A dependent value is only live under the very parent change it was chosen after: it never survives a
   * later change of the parent (even while hidden), nor a move of its `dependsOn` to another field.
   */
  const [meta, setMeta] = useState<{ rev: Record<string, number>; bound: Record<string, { parent: string; rev: number }> }>({ rev: {}, bound: {} });

  const all = typeof fields === 'function' ? fields({ ...initial, ...edited }) : fields;
  const { can } = useAuth();
  const shown = all
    .filter((f) => !f.only || f.only === mode)
    // Options the user may not read cannot be chosen: such a select is never required.
    .map((f) => (f.type === 'select' && f.required && f.optionsPermission && !can(f.optionsPermission.module, f.optionsPermission.action) ? { ...f, required: false } : f));
  const values = valuesOf(edited, initial, shown, mode);

  const live = (f: Field, depth = 0): boolean => {
    if (f.type !== 'select' || !f.dependsOn || depth > shown.length) return true;
    const rev = meta.rev[f.dependsOn] ?? 0;
    const own = f.name in edited ? meta.bound[f.name]?.parent === f.dependsOn && meta.bound[f.name].rev === rev : rev === 0;
    const parent = shown.find((p) => p.name === f.dependsOn);
    return own && (!parent || live(parent, depth + 1));
  };
  for (const f of shown) if (!live(f)) values[f.name] = '';

  /** Sets a field; selects depending on it (and theirs in turn) lose their value, shown or not. */
  const setField = (name: string, v: unknown) => {
    setLineErrors((e) => (e?.name === name ? null : e));
    // Against what the user sees: a value cleared by its parent counts as empty, so picking it again is a change.
    const was = name in values ? values[name] : name in edited ? edited[name] : initial[name];
    const changed = JSON.stringify(was ?? '') !== JSON.stringify(v ?? '');
    const dependsOn = all.find((f) => f.name === name && f.type === 'select');
    setMeta((m) => {
      const rev = changed ? { ...m.rev, [name]: (m.rev[name] ?? 0) + 1 } : m.rev;
      const parent = dependsOn?.type === 'select' ? dependsOn.dependsOn : undefined;
      return { rev, bound: parent ? { ...m.bound, [name]: { parent, rev: rev[parent] ?? 0 } } : m.bound };
    });
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
    <Dialog open onClose={onClose} title={title}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {intro && <div className="text-sm text-muted-foreground">{intro}</div>}
        {shown.map((f) => {
          const parent = f.type === 'select' && f.dependsOn ? shown.find((p) => p.name === f.dependsOn) : undefined;
          const parentValue = parent ? String(values[parent.name] ?? '') : undefined;
          return (
            <FieldInput
              key={f.name}
              field={f}
              value={values[f.name]}
              onChange={(v) => setField(f.name, v)}
              parentValue={parentValue}
              waitingFor={parent && !parentValue ? parent.label : undefined}
              errors={lineErrors?.name === f.name ? lineErrors.messages : undefined}
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

function withoutEmpty(body: Values): Values {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => !isEmpty(v)));
}
