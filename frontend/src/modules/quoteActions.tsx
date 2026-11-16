import type { ReactNode } from 'react';
import { Check, FileText, Send, type LucideIcon, X } from 'lucide-react';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import { api } from '../lib/api';
import type { Action } from '../lib/modules';
import type { QuoteRef } from './salesShared';

/* ----------------------------------------------------------------------------------------------
 * Quote workflow actions: shared by the list rows and the detail page. Every one is a daily entry
 * (`create` on ventes); the API refuses what the status does not allow.
 * -------------------------------------------------------------------------------------------- */

export interface QuoteDialogProps {
  row: QuoteRef;
  onClose: () => void;
  onDone: () => void;
}

export interface QuoteActionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  permission: Action;
  visible: (q: QuoteRef) => boolean;
  Dialog: (props: QuoteDialogProps) => ReactNode;
}

function quoteStep(key: string, title: (ref: string) => string, message: (ref: string) => string, confirmLabel: string) {
  return function QuoteStepDialog({ row, onClose, onDone }: QuoteDialogProps) {
    return (
      <ConfirmDialog
        title={title(row.reference)}
        message={message(row.reference)}
        confirmLabel={confirmLabel}
        onClose={onClose}
        onConfirm={async () => { await api.post(`/quotes/${row.id}/${key}`); onDone(); }}
      />
    );
  };
}

export const QUOTE_ACTIONS: QuoteActionDef[] = [
  {
    key: 'send', label: 'Envoyer', icon: Send, permission: 'create', visible: (q) => q.status === 'BROUILLON',
    Dialog: quoteStep('send', (r) => `Envoyer ${r}`, (r) => `Marquer le devis ${r} comme envoyé ? Il ne pourra plus être modifié.`, 'Envoyer'),
  },
  {
    key: 'accept', label: 'Accepter', icon: Check, permission: 'create', visible: (q) => q.status === 'ENVOYE' || q.status === 'EXPIRE',
    Dialog: quoteStep('accept', (r) => `Accepter ${r}`, (r) => `Le client a accepté le devis ${r} ?`, 'Accepter'),
  },
  {
    key: 'refuse', label: 'Refuser', icon: X, permission: 'create', visible: (q) => q.status === 'ENVOYE' || q.status === 'EXPIRE',
    Dialog: quoteStep('refuse', (r) => `Refuser ${r}`, (r) => `Le client a refusé le devis ${r} ?`, 'Refuser'),
  },
  {
    key: 'convert', label: 'Facturer', icon: FileText, permission: 'create', visible: (q) => ['ENVOYE', 'ACCEPTE', 'EXPIRE'].includes(q.status),
    Dialog: quoteStep('convert', (r) => `Facturer ${r}`, (r) => `Créer une facture brouillon à partir de ${r} ?`, 'Facturer'),
  },
];
