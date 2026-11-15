import { useEffect, useRef, type ReactNode } from 'react';
import { Ban, Banknote, FileMinus, FileText, Undo2, type LucideIcon } from 'lucide-react';
import { ActionDialog } from '../components/module/ActionDialog';
import { ConfirmDialog } from '../components/module/ConfirmDialog';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { LoadedRecord } from '../components/module/LoadedRecord';
import type { Field, LineRow } from '../components/module/types';
import { Button } from '../components/ui/Button';
import { Dialog, DialogActions } from '../components/ui/Dialog';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatNumber, todayIso } from '../lib/format';
import type { Action } from '../lib/modules';
import { lineAmount } from '../lib/money';
import { useFarmQuery } from '../lib/query';
import { CreditNoteSheet } from '../pages/print/SaleSheets';
import { PrintOverlay, useLegal } from '../pages/print/SheetFrame';
import { isWhole } from './saleLines';
import { PAY_FIELDS } from './purchaseActions';
import type { CreditNoteData, InvoiceData, InvoiceRef } from './salesShared';

/* ----------------------------------------------------------------------------------------------
 * Invoice workflow actions: shared by the list rows and the detail page, so the two never disagree.
 * Permissions (pre-flight rulings): issuing and recording payments or refunds = `update`; credit notes and the
 * cancellation of an issued invoice = `validate`. The API refuses what the status does not allow.
 * -------------------------------------------------------------------------------------------- */

export interface InvoiceDialogProps {
  row: InvoiceRef;
  onClose: () => void;
  onDone: () => void;
}

export interface InvoiceActionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  permission: Action;
  visible: (i: InvoiceRef) => boolean;
  Dialog: (props: InvoiceDialogProps) => ReactNode;
}

const post = (id: string, path: string, body?: unknown) => api.post(`/sales/${id}/${path}`, body);
const named = (i: InvoiceRef) => i.number ?? 'la facture';

/** The invoice as loaded by the dialogs that need its lines; shared with the detail screen's cache. */
const invoiceKey = (id: string) => ['/sales', 'detail', id];

function IssueDialog({ row, onClose, onDone }: InvoiceDialogProps) {
  return (
    <ConfirmDialog
      title="Émettre la facture"
      message={`Émettre ${row.customerName} — ${formatMoney(row.total)} ? Les animaux, œufs et articles vendus seront sortis des lots et du stock.`}
      confirmLabel="Émettre"
      onClose={onClose}
      onConfirm={async () => { await post(row.id, 'issue'); onDone(); }}
    />
  );
}

/** Payment of an issued invoice: prefilled with what is due; the API refuses an amount above it. */
function PayDialog({ row, onClose, onDone }: InvoiceDialogProps) {
  return (
    <ActionDialog
      title={`Encaisser ${named(row)}`}
      fields={PAY_FIELDS(row.due)}
      validate={(v) => (Number(v.amount) > row.due ? 'Le montant dépasse le reste dû' : null)}
      onSubmit={(body) => post(row.id, 'payments', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** What the customer is owed back after a credit note: prefilled with it, sent as a payment of kind `REMBOURSEMENT`. */
function RefundDialog({ row, onClose, onDone }: InvoiceDialogProps) {
  return (
    <ActionDialog
      title={`Rembourser ${named(row)}`}
      fields={PAY_FIELDS(row.refundDue)}
      validate={(v) => (Number(v.amount) > row.refundDue ? 'Le montant dépasse le montant à rembourser' : null)}
      onSubmit={(body) => post(row.id, 'payments', { ...(body as object), kind: 'REMBOURSEMENT' })}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function CancelDialog({ row, onClose, onDone }: InvoiceDialogProps) {
  return (
    <ActionDialog
      title={`Annuler ${named(row)}`}
      intro={`Annuler ${named(row)} ? Les animaux, œufs et articles vendus seront remis dans leurs lots et en stock.`}
      fields={[{ name: 'reason', label: 'Motif', type: 'text', required: true }]}
      submitLabel="Confirmer l'annulation"
      onSubmit={(body) => post(row.id, 'cancel', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** The amount a credited quantity gives, for the preview: the API computes the stored one (the last piece of a line takes its remainder). */
const creditPreview = (row: LineRow): number => {
  const quantity = Number(row.quantity || 0);
  if (quantity <= 0) return 0;
  return Number(row.creditedQuantity) === 0 && quantity === Number(row.lineQuantity) ? Number(row.lineAmount) : lineAmount(quantity, Number(row.unitPrice));
};

const CREDIT_COLUMNS: Extract<Field, { type: 'lines' }>['columns'] = [
  { name: 'designation', label: 'Désignation', type: 'text', readOnly: true },
  { name: 'creditable', label: 'Restant à créditer', type: 'number', readOnly: true },
  {
    name: 'quantity',
    label: 'Quantité à créditer',
    type: 'number',
    min: 0,
    step: (row) => (isWhole(row.kind) ? 1 : 0.01),
    integer: (row) => isWhole(row.kind),
    integerMessage: 'La quantité doit être un nombre entier',
  },
  { name: 'amount', label: 'Montant', type: 'text', computed: (row) => formatMoney(creditPreview(row)) },
];

/**
 * The credit note: the invoice's lines (loaded, as a list row has none) with what each may still be credited, the
 * quantity to credit per line, the reason, and whether the goods come back. The rows are the invoice's own, in order,
 * so the payload names each by its id.
 */
function CreditForm({ invoice, onClose, onDone }: { invoice: InvoiceData; onClose: () => void; onDone: () => void }) {
  const rows = (v: Record<string, unknown>) => v.lines as LineRow[];
  return (
    <ActionDialog
      title={`Avoir ${named(invoice)}`}
      // Four columns and the amounts need ~640px.
      wide
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'reason', label: 'Motif', type: 'text', required: true },
        { name: 'withReturn', label: 'Retour des marchandises', type: 'checkbox' },
        {
          name: 'lines',
          label: 'Lignes à créditer',
          type: 'lines',
          fixed: true,
          columns: CREDIT_COLUMNS,
          footer: (list) => <p className="text-sm font-semibold">Total : {formatMoney(list.reduce((sum, r) => sum + creditPreview(r), 0))}</p>,
        },
      ]}
      initial={{
        lines: invoice.lines.map((l): LineRow => ({
          lineId: l.id, kind: l.kind, designation: l.designation, creditable: String(l.creditableQuantity), quantity: '',
          unitPrice: String(l.unitPrice), lineQuantity: String(l.quantity), lineAmount: String(l.amount), creditedQuantity: String(l.creditedQuantity),
        })),
      }}
      validate={(v) => {
        const over = rows(v).find((r) => Number(r.quantity) > Number(r.creditable));
        if (over) return `La quantité dépasse la quantité restant à créditer (${formatNumber(Number(over.creditable))})`;
        return rows(v).some((r) => Number(r.quantity) > 0) ? null : 'Indiquez au moins une quantité à créditer';
      }}
      toPayload={(v) => ({
        date: v.date,
        reason: String(v.reason).trim(),
        withReturn: v.withReturn === true,
        lines: rows(v).filter((r) => Number(r.quantity) > 0).map((r) => ({ lineId: r.lineId, quantity: Number(r.quantity) })),
      })}
      onSubmit={(body) => post(invoice.id, 'credit-notes', body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function CreditDialog({ row, onClose, onDone }: InvoiceDialogProps) {
  return (
    <LoadedRecord<InvoiceData> title={`Avoir ${named(row)}`} queryKey={invoiceKey(row.id)} path={`/sales/${row.id}`} onClose={onClose}>
      {(invoice) => <CreditForm invoice={invoice} onClose={onClose} onDone={onDone} />}
    </LoadedRecord>
  );
}

const unpaidIssued = (i: InvoiceRef) => i.status === 'EMISE' && i.paid === 0 && i.credited === 0;

export const INVOICE_ACTIONS: InvoiceActionDef[] = [
  { key: 'issue', label: 'Émettre', icon: FileText, permission: 'update', visible: (i) => i.status === 'BROUILLON', Dialog: IssueDialog },
  { key: 'pay', label: 'Encaisser', icon: Banknote, permission: 'update', visible: (i) => (i.status === 'EMISE' || i.status === 'PARTIELLE') && i.due > 0, Dialog: PayDialog },
  { key: 'credit', label: 'Avoir', icon: FileMinus, permission: 'validate', visible: (i) => ['EMISE', 'PARTIELLE', 'SOLDEE'].includes(i.status), Dialog: CreditDialog },
  { key: 'refund', label: 'Rembourser', icon: Undo2, permission: 'update', visible: (i) => i.refundDue > 0, Dialog: RefundDialog },
  { key: 'cancel', label: 'Annuler', icon: Ban, permission: 'validate', visible: unpaidIssued, Dialog: CancelDialog },
];

/* ----------------------------------------------------------------------------------------------
 * Printing a credit note (from the `Avoirs` tab or from an invoice): a dialog that loads it, prints it and offers to print again.
 * -------------------------------------------------------------------------------------------- */

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
