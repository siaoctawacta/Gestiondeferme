import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { useFarmQuery } from '../lib/query';
import { ActionDialog } from '../components/module/ActionDialog';
import type { Field, ListResponse } from '../components/module/types';
import type { Option } from '../components/module/useEndpointOptions';


const PAGE_SIZE = 200;

async function allPages<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await api.get<ListResponse<T>>(endpoint, { ...params, page, pageSize: PAGE_SIZE });
    out.push(...res.items);
    if (res.items.length === 0 || out.length >= res.total) return out;
  }
}

/** Buildings as select options, those of the species the form is about first (the API sorts by name only). */
export function useBuildingOptions(firstType: 'AVICOLE' | 'PORCIN'): Option[] {
  const { data } = useFarmQuery<{ id: string; name: string; type: string }[]>(
    ['/buildings', 'typed-options'],
    () => allPages('/buildings', {}),
  );
  const rank = (b: { type: string }) => (b.type === firstType ? 0 : 1);
  return [...(data ?? [])].sort((a, b) => rank(a) - rank(b)).map((b) => ({ value: b.id, label: b.name }));
}

/** Open avian batches that lay eggs (the API filters on one type at a time, so the types are kept here). */
export function useLayingBatchOptions(): Option[] {
  const { data } = useFarmQuery<{ id: string; code: string; type: string }[]>(
    ['/batches', 'laying-options'],
    () => allPages('/batches', { species: 'AVICOLE', status: 'EN_COURS' }),
  );
  return (data ?? []).filter((b) => b.type === 'PONDEUSE' || b.type === 'REPRODUCTEUR').map((b) => ({ value: b.id, label: b.code }));
}

type Values = Record<string, unknown>;

export interface RecordFormProps {
  /** Dialog title suffix: `Ajouter — {label}` / `Modifier — {label}`. */
  label: string;
  /** The record being edited; absent when adding. */
  row?: { id: string };
  fields: Field[] | ((values: Values) => Field[]);
  initial?: Values;
  intro?: ReactNode;
  toPayload?: (values: Values) => unknown;
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
 * The add / edit dialog of a record whose form is custom: `POST createPath` (with the scope) or `PATCH` the row.
 * An edit that changes nothing (empty body) sends no request and just closes.
 */
export function RecordForm({ label, row, createPath, patchPath, scope, onSaved, onClose, ...rest }: RecordFormProps) {
  return (
    <ActionDialog
      {...rest}
      title={`${row ? 'Modifier' : 'Ajouter'} — ${label}`}
      mode={row ? 'update' : 'create'}
      onSubmit={async (body) => {
        if (!row) await api.post(createPath, { ...(body as object), ...scope });
        else if (Object.keys(body as object).length > 0) await api.patch(patchPath(row), body);
      }}
      onClose={onClose}
      onDone={onSaved}
    />
  );
}
