import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { errorMessage } from './errorMessage';
import { FieldInput, defaultPayload, initialValue, validate } from './RecordDialog';
import type { Field, FormMode } from './types';

type Values = Record<string, unknown>;

export interface ActionDialogProps {
  title: string;
  /**
   * Inputs, as for `RecordDialog`. A function of the values edited so far (a name is missing until the field was
   * given a value or an `initial`) lets a field appear depending on another.
   */
  fields: Field[] | ((values: Values) => Field[]);
  /** Initial values by field name (a row, for an edit); `defaultValue` of the field applies otherwise. */
  initial?: Values;
  /** Text above the inputs. */
  intro?: ReactNode;
  /** Fields with `only` for the other mode are left out (default `create`). */
  mode?: FormMode;
  submitLabel?: string;
  /** Form values to request body (default: the shown fields, numbers coerced, empty optional text left out). */
  toPayload?: (values: Values) => unknown;
  /** Sends the request; a rejection is shown in the dialog, like the server's French messages. */
  onSubmit: (body: unknown) => Promise<unknown>;
  onClose: () => void;
  /** Called after a successful `onSubmit`. */
  onDone: () => void;
}

/**
 * A small form dialog for one action (a farrowing, a weighing, a stock exit…): kit fields, validation, request
 * and server error display. `RecordDialog` is bound to a module endpoint and its add / edit title, so actions
 * on a record use this one.
 */
export function ActionDialog({
  title, fields, initial = {}, intro, mode = 'create', submitLabel = 'Enregistrer', toPayload, onSubmit, onClose, onDone,
}: ActionDialogProps) {
  const [edited, setEdited] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = typeof fields === 'function' ? fields({ ...initial, ...edited }) : fields;
  const shown = all.filter((f) => !f.only || f.only === mode);
  const values = valuesOf(edited, initial, shown);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(shown, values, mode);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const body = toPayload
        ? toPayload(values)
        : Object.fromEntries(Object.entries(defaultPayload(shown, values, mode)).filter(([, v]) => v !== ''));
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
        {shown.map((f) => (
          <FieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => setEdited((s) => ({ ...s, [f.name]: v }))} />
        ))}
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Edited value, else initial value, else the field's default. */
function valuesOf(edited: Values, initial: Values, fields: Field[]): Values {
  return Object.fromEntries(fields.map((f) => [f.name, f.name in edited ? edited[f.name] : initialValue(f, initial)]));
}
