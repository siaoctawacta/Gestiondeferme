import type { ReactNode } from 'react';
import { Ban, Banknote, Check, ClipboardCheck, PackageCheck, type LucideIcon } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import { LoadedRecord } from '../components/module/LoadedRecord';
import type { Field } from '../components/module/types';
import { api } from '../lib/api';
import type { Action } from '../lib/modules';
import { todayIso } from '../lib/format';
import { PAYMENT_METHODS, type PurchaseData, type PurchaseRef } from './purchasingShared';

export interface PurchaseDialogProps {
  row: PurchaseRef;
  onClose: () => void;
  onDone: () => void;
}

/** A workflow transition: who may do it, on which purchases, and its dialog. Shared by the list rows and the detail page. */
export interface PurchaseActionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  permission: Action;
  visible: (p: PurchaseRef) => boolean;
  Dialog: (props: PurchaseDialogProps) => ReactNode;
}

const post = (id: string, path: string, body?: unknown) => api.post(`/purchases/${id}/${path}`, body);

function ValidateDialog({ row, onClose, onDone }: PurchaseDialogProps) {
  return (
    <ConfirmDialog
      title={`Valider la demande ${row.reference}`}
      message={`Valider la demande d'achat ${row.reference} ? Elle pourra ensuite être commandée.`}
      confirmLabel="Valider"
      onClose={onClose}
      onConfirm={async () => { await post(row.id, 'validate'); onDone(); }}
    />
  );
}

function OrderDialog({ row, onClose, onDone }: PurchaseDialogProps) {
  return (
    <ConfirmDialog
      title={`Commander ${row.reference}`}
      message={`Passer commande pour ${row.reference} ? Un numéro de bon de commande sera attribué.`}
      confirmLabel="Commander"
      onClose={onClose}
      onConfirm={async () => { await post(row.id, 'order'); onDone(); }}
    />
  );
}

function CancelDialog({ row, onClose, onDone }: PurchaseDialogProps) {
  return (
    <ActionDialog
      title={`Annuler — ${row.reference}`}
      intro={`Annuler ${row.reference} ? L'achat ne pourra plus être traité.`}
      fields={[{ name: 'reason', label: 'Motif', type: 'text', required: true }]}
      submitLabel="Confirmer l'annulation"
      onSubmit={(body) => post(row.id, 'cancel', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

const withoutBlank = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined));

/**
 * Reception: the order's lines (loaded, as a list row does not carry them) with the quantity received prefilled
 * with the ordered one, a lot number and an expiry per line. The rows are fixed and in the order's order, so the
 * payload pairs each with its stock item by index.
 */
function ReceiveForm({ order, onClose, onDone }: { order: PurchaseData; onClose: () => void; onDone: () => void }) {
  return (
    <ActionDialog
      title={`Réceptionner — ${order.reference}`}
      fields={[
        { name: 'date', label: 'Date de réception', type: 'date', required: true, defaultValue: todayIso },
        {
          name: 'lines',
          label: 'Lignes reçues',
          type: 'lines',
          fixed: true,
          columns: [
            { name: 'itemName', label: 'Article', type: 'text', readOnly: true },
            { name: 'quantity', label: 'Commandée', type: 'number', readOnly: true },
            { name: 'receivedQuantity', label: 'Quantité reçue', type: 'number', required: true, min: 0, step: 0.01 },
            { name: 'lotNumber', label: 'N° de lot', type: 'text' },
            { name: 'expiryDate', label: 'Péremption', type: 'date' },
          ],
        },
      ]}
      initial={{
        lines: order.lines.map((l) => ({ itemName: l.itemName, quantity: l.quantity, receivedQuantity: l.quantity, lotNumber: '', expiryDate: '' })),
      }}
      toPayload={(v) => ({
        date: v.date,
        lines: (v.lines as Record<string, string>[]).map((r, i) => withoutBlank({
          itemId: order.lines[i].itemId,
          receivedQuantity: Number(r.receivedQuantity),
          lotNumber: r.lotNumber.trim(),
          expiryDate: r.expiryDate,
        })),
      })}
      onSubmit={(body) => post(order.id, 'receive', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function ReceiveDialog({ row, onClose, onDone }: PurchaseDialogProps) {
  return (
    <LoadedRecord<PurchaseData> title={`Réceptionner — ${row.reference}`} queryKey={['/purchases', 'detail', row.id]} path={`/purchases/${row.id}`} onClose={onClose}>
      {(order) => <ReceiveForm order={order} onClose={onClose} onDone={onDone} />}
    </LoadedRecord>
  );
}

const PAY_FIELDS = (remaining: number): Field[] => [
  { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
  { name: 'amount', label: 'Montant (FCFA)', type: 'number', required: true, min: 0.01, step: 0.01, defaultValue: remaining },
  { name: 'method', label: 'Mode de paiement', type: 'select', required: true, options: PAYMENT_METHODS, defaultValue: 'ESPECES' },
  { name: 'reference', label: 'Référence', type: 'text' },
];

/** Payment of a received purchase, prefilled with what remains; the API refuses an amount above it. */
export function PayDialog({ row, onClose, onDone }: PurchaseDialogProps) {
  return (
    <ActionDialog
      title={`Payer — ${row.reference}`}
      fields={PAY_FIELDS(row.remaining)}
      validate={(v) => (Number(v.amount) > row.remaining ? 'Le montant dépasse le reste à payer' : null)}
      onSubmit={(body) => post(row.id, 'payments', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/**
 * Transitions of the workflow `DEMANDE → VALIDEE → COMMANDEE → RECUE → PAYEE` (`ANNULEE` before `RECUE`). The role
 * split comes from the permissions alone: `validate` for validating, ordering, cancelling and paying (director,
 * owner), `update` for the reception (storekeeper, stock manager).
 */
export const PURCHASE_ACTIONS: PurchaseActionDef[] = [
  { key: 'validate', label: 'Valider', icon: Check, permission: 'validate', visible: (p) => p.status === 'DEMANDE', Dialog: ValidateDialog },
  { key: 'order', label: 'Commander', icon: ClipboardCheck, permission: 'validate', visible: (p) => p.status === 'VALIDEE', Dialog: OrderDialog },
  { key: 'receive', label: 'Réceptionner', icon: PackageCheck, permission: 'update', visible: (p) => p.status === 'COMMANDEE', Dialog: ReceiveDialog },
  { key: 'pay', label: 'Payer', icon: Banknote, permission: 'validate', visible: (p) => p.status === 'RECUE' && p.remaining > 0, Dialog: PayDialog },
  { key: 'cancel', label: 'Annuler', icon: Ban, permission: 'validate', visible: (p) => ['DEMANDE', 'VALIDEE', 'COMMANDEE'].includes(p.status), Dialog: CancelDialog },
];
