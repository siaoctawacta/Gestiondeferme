import { useState } from 'react';
import { QrCode } from 'lucide-react';
import type { QrKind } from '../../lib/qr';
import { Button } from '../ui/Button';
import { QrDialog } from './QrDialog';

/** The `QR code` button of a detail page: opens the QR dialog of `{kind, id}` (the same dialog as the list rows' QR icon). */
export function QrButton({ kind, id }: { kind: QrKind; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <QrCode aria-hidden className="size-4" />
        QR code
      </Button>
      {open && <QrDialog kind={kind} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
