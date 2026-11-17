import { api } from '../../lib/api';
import { svgDataUrl, type QrKind, type QrTarget } from '../../lib/qr';
import { useFarmQuery } from '../../lib/query';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Dialog, DialogActions } from '../ui/Dialog';
import { errorMessage } from './errorMessage';
import { QrLabelPrint } from './QrLabelSheet';

/**
 * `QR code — {label}`: the QR of one record exactly as the API drew it (an image built from the SVG text, never markup of the
 * page), with its label, sub-label, farm and the address it encodes; `Imprimer l'étiquette` prints one label on an A4 sheet.
 */
export function QrDialog({ kind, id, onClose }: { kind: QrKind; id: string; onClose: () => void }) {
  const query = useFarmQuery<QrTarget>(['/qr', kind, id], () => api.get<QrTarget>(`/qr/${kind}/${id}`));
  const target = query.data;
  return (
    <>
      <Dialog open onClose={onClose} title={target ? `QR code — ${target.label}` : 'QR code'}>
        {query.isError ? (
          <Alert>{errorMessage(query.error)}</Alert>
        ) : !target ? (
          <div aria-busy role="status" className="h-48 animate-pulse rounded-3xl bg-muted"><span className="sr-only">Chargement…</span></div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-center">
            <img src={svgDataUrl(target.svg)} alt={`QR code ${target.label}`} className="size-48" />
            <p className="font-display text-lg font-bold">{target.label}</p>
            <p className="text-sm">{target.sublabel}</p>
            {target.farmName && <p className="text-sm text-muted-foreground">{target.farmName}</p>}
            <p className="mt-1 break-all text-xs text-muted-foreground">{target.url}</p>
          </div>
        )}
        <DialogActions>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          {target && <Button onClick={() => window.print()}>Imprimer l'étiquette</Button>}
        </DialogActions>
      </Dialog>
      {target && <QrLabelPrint labels={[target]} />}
    </>
  );
}
