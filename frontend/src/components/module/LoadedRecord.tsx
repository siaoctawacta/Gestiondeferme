import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { useFarmQuery } from '../../lib/query';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import { errorMessage } from './errorMessage';

export interface LoadedRecordProps<D> {
  /** Title of the dialog shown while the record loads (or fails to). */
  title: string;
  /** Query key of the record, under the active farm; share it with the detail screen to reuse its cache. */
  queryKey: unknown[];
  /** `GET` path of the record. */
  path?: string;
  /** Loads what is not one `GET` of a path (e.g. the pieces of one operation); used instead of `path`. */
  load?: () => Promise<D>;
  onClose: () => void;
  /** The edit form, rendered once the record is loaded. */
  children: (record: D) => ReactNode;
}

/**
 * Loads one record before its edit form opens (a list row does not carry every stored field), so the form shows
 * the stored values and can clear them. Shows a loading or an error dialog until then.
 */
export function LoadedRecord<D>({ title, queryKey, path, load, onClose, children }: LoadedRecordProps<D>) {
  const query = useFarmQuery<D>(queryKey, () => (load ? load() : api.get<D>(path!)));
  if (query.isPending || query.isError) {
    return (
      <Dialog open onClose={onClose} title={title}>
        {query.isError ? (
          <Alert>{errorMessage(query.error)}</Alert>
        ) : (
          <div aria-busy role="status" className="h-24 animate-pulse rounded-3xl bg-muted"><span className="sr-only">Chargement…</span></div>
        )}
        <DialogActions><Button variant="outline" onClick={onClose}>Fermer</Button></DialogActions>
      </Dialog>
    );
  }
  return <>{children(query.data)}</>;
}
