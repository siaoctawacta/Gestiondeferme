import { RecordForm } from './RecordForm';
import type { ModuleConfig } from './types';

export interface RecordDialogProps<T extends { id: string }> {
  config: ModuleConfig<T>;
  /** The row being edited; absent when creating. */
  row?: T;
  /** Fixed values merged into the body when creating (the config's `scope`, or the one given to `ModuleList`). */
  scope?: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}

/** Add / edit dialog generated from `config.fields`: a `RecordForm` bound to the config's endpoint. */
export function RecordDialog<T extends { id: string }>({ config, row, scope, onClose, onSaved }: RecordDialogProps<T>) {
  return (
    <RecordForm
      label={config.title}
      row={row}
      fields={config.fields ?? []}
      initial={row ? (config.toForm ? config.toForm(row) : (row as unknown as Record<string, unknown>)) : undefined}
      toPayload={config.toPayload}
      createPath={config.endpoint}
      patchPath={(r) => `${config.endpoint}/${r.id}`}
      scope={scope}
      wide={config.wide}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}
