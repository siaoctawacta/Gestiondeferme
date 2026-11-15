import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import { changedFields } from './changedFields';
import { errorMessage } from './errorMessage';
import { FieldInput, defaultPayload, initialValue, validate } from './formFields';
import type { Field, FormMode } from './types';

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
  title, fields, initial = {}, intro, mode = 'create', submitLabel = 'Enregistrer', toPayload, onSubmit, onClose, onDone,
}: ActionDialogProps) {
  const [edited, setEdited] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = typeof fields === 'function' ? fields({ ...initial, ...edited }) : fields;
  const shown = all.filter((f) => !f.only || f.only === mode);
  const values = valuesOf(edited, initial, shown, mode);

  /** Sets a field; every select depending on it is cleared, and theirs in turn (A -> B -> C). */
  const setField = (name: string, v: unknown) =>
    setEdited((s) => {
      const next = { ...s, [name]: v };
      const cleared = [name];
      for (let i = 0; i < cleared.length; i++) {
        for (const f of shown) {
          if (f.type === 'select' && f.dependsOn === cleared[i] && !cleared.includes(f.name)) {
            next[f.name] = '';
            cleared.push(f.name);
          }
        }
      }
      return next;
    });

  const build = (v: Values): Values =>
    (toPayload ? toPayload(v, mode) : defaultPayload(shown, v, mode)) as Values;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(shown, values, mode);
    if (invalid) return setError(invalid);
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
