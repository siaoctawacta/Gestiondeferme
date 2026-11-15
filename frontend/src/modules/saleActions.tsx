import type { ReactNode } from 'react';
import { Ban, Banknote, FileMinus, FileText, Undo2, type LucideIcon } from 'lucide-react';
import { ActionDialog, withoutEmpty } from '../components/module/ActionDialog';
import { LoadedRecord } from '../components/module/LoadedRecord';
import type { Field, LineRow } from '../components/module/types';
import { api } from '../lib/api';
import { formatMoney, formatNumber, todayIso } from '../lib/format';
import type { Action } from '../lib/modules';
import { lineAmount, sumAmounts } from '../lib/money';
import { isWhole } from './saleLines';
import { PAY_FIELDS } from './purchaseActions';
import { PAYMENT_METHODS } from './purchasingShared';
import type { InvoiceData, InvoiceRef } from './salesShared';

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

/**
 * Issuing: what it will decrement, and an optional cash payment settled at once (comptant or partial), sent with the
 * issue so the invoice leaves `Brouillon` already paid.
 */
function IssueDialog({ row, onClose, onDone }: InvoiceDialogProps) {
  return (
    <ActionDialog
      title="Émettre la facture"
      intro={`Émettre ${row.customerName} — ${formatMoney(row.total)} ? Les animaux, œufs et articles vendus seront sortis des lots et du stock.`}
      submitLabel="Émettre"
      fields={(values) => [
        { name: 'cash', label: 'Paiement comptant', type: 'checkbox' },
        ...(values.cash === true
          ? ([
              { name: 'amount', label: 'Montant (FCFA)', type: 'number', required: true, min: 0.01, step: 0.01, defaultValue: row.total },
              { name: 'method', label: 'Mode de paiement', type: 'select', required: true, options: PAYMENT_METHODS, defaultValue: 'ESPECES' },
              { name: 'reference', label: 'Référence', type: 'text' },
            ] as Field[])
          : []),
      ]}
      validate={(v) => (v.cash === true && Number(v.amount) > row.total ? 'Le montant dépasse le reste dû' : null)}
      toPayload={(v) => (v.cash === true ? { payment: withoutEmpty({ amount: Number(v.amount), method: v.method, reference: String(v.reference ?? '').trim() }) } : {})}
      onSubmit={(body) => post(row.id, 'issue', body)}
      onClose={onClose}
      onDone={onDone}
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

/**
 * The amount a credited quantity gives, for the preview (the API stores the real one): exactly what is left of the line
 * when the credit takes everything creditable, else the proportional amount, never more than what is left.
 */
const creditPreview = (row: LineRow): number => {
  const quantity = Number(row.quantity || 0);
  if (quantity <= 0) return 0;
  const left = Number(row.creditableAmount);
  return quantity === Number(row.creditable) ? left : Math.min(lineAmount(quantity, Number(row.unitPrice)), left);
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
          footer: (list) => <p className="text-sm font-semibold">Total : {formatMoney(sumAmounts(list.map(creditPreview)))}</p>,
        },
      ]}
      initial={{
        lines: invoice.lines.map((l): LineRow => ({
          lineId: l.id, kind: l.kind, designation: l.designation, creditable: String(l.creditableQuantity), creditableAmount: String(l.creditableAmount),
          quantity: '', unitPrice: String(l.unitPrice),
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

/** An issued invoice with no payment and no credit note (whatever its status: a total of 0 is settled at issue). */
const cancellable = (i: InvoiceRef) => ['EMISE', 'PARTIELLE', 'SOLDEE'].includes(i.status) && i.paid === 0 && i.credited === 0;

export const INVOICE_ACTIONS: InvoiceActionDef[] = [
  { key: 'issue', label: 'Émettre', icon: FileText, permission: 'update', visible: (i) => i.status === 'BROUILLON', Dialog: IssueDialog },
  { key: 'pay', label: 'Encaisser', icon: Banknote, permission: 'update', visible: (i) => (i.status === 'EMISE' || i.status === 'PARTIELLE') && i.due > 0, Dialog: PayDialog },
  { key: 'credit', label: 'Avoir', icon: FileMinus, permission: 'validate', visible: (i) => ['EMISE', 'PARTIELLE', 'SOLDEE'].includes(i.status), Dialog: CreditDialog },
  { key: 'refund', label: 'Rembourser', icon: Undo2, permission: 'update', visible: (i) => i.refundDue > 0, Dialog: RefundDialog },
  { key: 'cancel', label: 'Annuler', icon: Ban, permission: 'validate', visible: cancellable, Dialog: CancelDialog },
];
