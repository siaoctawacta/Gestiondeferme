import { useEffect, useRef } from 'react';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogActions } from '../../components/ui/Dialog';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFarmQuery } from '../../lib/query';
import type { CreditNoteData } from '../../modules/salesShared';
import { CreditNoteSheet } from './SaleSheets';
import { PrintOverlay, useLegal } from './SheetFrame';

/** Printing a credit note (from the `Avoirs` tab or from an invoice): a dialog that loads it, prints it and offers to print again. */
export function CreditNotePrintDialog({ row, onClose }: { row: { id: string; number: string }; onClose: () => void }) {
  const { farmId, farms } = useAuth();
  const note = useFarmQuery<CreditNoteData>(['/credit-notes', 'detail', row.id], () => api.get<CreditNoteData>(`/credit-notes/${row.id}`));
  const { legal, ready } = useLegal();
  const printed = useRef(false);
  const ok = note.data !== undefined && ready;
  // Print once, as soon as the sheet (with its legal block) is on the page.
  useEffect(() => {
    if (ok && !printed.current) {
      printed.current = true;
      window.print();
    }
  }, [ok]);
  return (
    <>
      <Dialog open onClose={onClose} title={`Imprimer ${row.number}`}>
        {note.isError ? (
          <ErrorRetry message={errorMessage(note.error)} onRetry={() => note.refetch()} />
        ) : note.isPending ? (
          <div aria-busy role="status" className="h-16 animate-pulse rounded-3xl bg-muted"><span className="sr-only">Chargement…</span></div>
        ) : (
          <p className="text-sm">L'avoir {row.number} est prêt à imprimer.</p>
        )}
        <DialogActions>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          {ok && <Button onClick={() => window.print()}>Imprimer</Button>}
        </DialogActions>
      </Dialog>
      {ok && (
        <PrintOverlay>
          <CreditNoteSheet data={note.data} farmName={farms.find((f) => f.id === farmId)?.name} legal={legal} />
        </PrintOverlay>
      )}
    </>
  );
}
