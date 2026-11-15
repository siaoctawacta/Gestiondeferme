import { useState } from 'react';
import { Dialog, DialogActions } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { errorMessage } from './errorMessage';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Resolves when done (the caller closes); a rejection is shown in the dialog. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Supprimer', onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={title}>
      <p className="text-sm">{message}</p>
      {error && <Alert className="mt-4">{error}</Alert>}
      <DialogActions>
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button
          className="bg-destructive text-white hover:bg-destructive/90"
          disabled={busy}
          onClick={confirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
