import { Decimal } from '@prisma/client/runtime/client';
import { formatDay, formatDayOrNull } from '../common/days';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type {
  CustomerPaymentKind,
  PaymentMethod,
} from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { standingOf, type InvoiceMoney } from './receivables';
import { creditable } from './sale-money';
import { lineInclude, lineView, type SaleLineView } from './sale-view';
import { isOverdue, type InvoiceStatusValue } from './sale-workflow';

export {
  moneyOf,
  standingOf,
  type InvoiceMoney,
  type Receivable,
} from './receivables';

/** Everything the views need of an invoice, loaded in one query. */
export const invoiceInclude = {
  customer: true,
  quote: { select: { reference: true } },
  lines: { include: lineInclude, orderBy: { position: 'asc' } },
  createdBy: { select: { name: true } },
  issuedBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
  payments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { createdBy: { select: { name: true } } },
  },
  creditNotes: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { lines: true, createdBy: { select: { name: true } } },
  },
} satisfies Prisma.InvoiceInclude;

/** What a list row needs of an invoice: no payments or credit notes (the money comes aggregated from `moneyOf`). */
export const invoiceListInclude = {
  customer: true,
  lines: { orderBy: { position: 'asc' } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceListed = Prisma.InvoiceGetPayload<{
  include: typeof invoiceListInclude;
}>;

export type InvoiceFull = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

export interface InvoiceRow {
  id: string;
  date: string;
  /** The `FA-NNNN` number, null for a draft. */
  number: string | null;
  customerId: string;
  customerName: string;
  /** First line's designation, `+n` when there are more lines. */
  product: string;
  quantity: number;
  unit: string | null;
  total: number;
  paid: number;
  credited: number;
  refunded: number;
  due: number;
  refundDue: number;
  status: InvoiceStatusValue;
  dueDate: string | null;
  overdue: boolean;
}

export interface InvoiceLineView extends SaleLineView {
  creditedQuantity: number;
  creditableQuantity: number;
  creditableAmount: number;
}

export interface InvoiceStep {
  step:
    'BROUILLON' | 'EMISE' | 'PAIEMENT' | 'REMBOURSEMENT' | 'AVOIR' | 'ANNULEE';
  at: string;
  by: string | null;
  /** The receipt or credit note number of a payment, refund or credit note; the reason of a cancellation. */
  note?: string | null;
}

/** A client payment as the invoice shows it (`number` is the receipt, `RC-NNNN`). */
export interface PaymentView {
  id: string;
  number: string;
  kind: CustomerPaymentKind;
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
}

/** A credit note as the invoice lists it. */
export interface CreditNoteSummary {
  id: string;
  number: string;
  date: string;
  reason: string;
  withReturn: boolean;
  total: number;
}

export interface InvoiceDetail extends InvoiceRow {
  customerPhone: string | null;
  customerAddress: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  note: string | null;
  cancelReason: string | null;
  lines: InvoiceLineView[];
  payments: PaymentView[];
  creditNotes: CreditNoteSummary[];
  history: InvoiceStep[];
}

/** `today` is the calendar day (`YYYY-MM-DD`) the derived `overdue` is judged on. */
export function invoiceRow(
  i: InvoiceListed,
  money: InvoiceMoney,
  today: string,
): InvoiceRow {
  const first = i.lines[0];
  const { due, refundDue } = standingOf(i, money);
  const dueDate = formatDayOrNull(i.dueDate);
  return {
    id: i.id,
    date: formatDay(i.date),
    number: i.number,
    customerId: i.customerId,
    customerName: i.customer.name,
    product: first
      ? i.lines.length > 1
        ? `${first.designation} +${i.lines.length - 1}`
        : first.designation
      : '',
    quantity: first ? first.quantity.toNumber() : 0,
    unit: first?.unit ?? null,
    total: toMoney(i.total),
    paid: toMoney(money.paid),
    credited: toMoney(money.credited),
    refunded: toMoney(money.refunded),
    due: toMoney(due),
    refundDue: toMoney(refundDue),
    status: i.status,
    dueDate,
    overdue: isOverdue({ status: i.status, due, dueDate }, today),
  };
}

/** A line as the invoice shows it: its stored activity and category, and what a credit note may still take. */
export function invoiceLineView(
  l: InvoiceFull['lines'][number],
  credited: { quantity: Decimal; amount: Decimal } = {
    quantity: new Decimal(0),
    amount: new Decimal(0),
  },
): InvoiceLineView {
  const left = creditable(l, credited);
  return {
    ...lineView(l),
    activity: l.activity,
    category: l.revenueCategory,
    creditedQuantity: credited.quantity.toNumber(),
    creditableQuantity: left.quantity.toNumber(),
    creditableAmount: toMoney(left.amount),
  };
}

/** What the credit notes of an invoice took back of each of its lines (quantity and amount). */
export function creditedByLine(
  invoice: Pick<InvoiceFull, 'creditNotes'>,
): Map<string, { quantity: Decimal; amount: Decimal }> {
  const result = new Map<string, { quantity: Decimal; amount: Decimal }>();
  for (const note of invoice.creditNotes) {
    for (const l of note.lines) {
      const so = result.get(l.invoiceLineId) ?? {
        quantity: new Decimal(0),
        amount: new Decimal(0),
      };
      result.set(l.invoiceLineId, {
        quantity: so.quantity.add(l.quantity),
        amount: so.amount.add(l.amount),
      });
    }
  }
  return result;
}

export const paymentView = (
  p: InvoiceFull['payments'][number],
): PaymentView => ({
  id: p.id,
  number: p.number,
  kind: p.kind,
  date: formatDay(p.date),
  amount: toMoney(p.amount),
  method: p.method,
  reference: p.reference,
});

export const creditNoteSummary = (
  c: InvoiceFull['creditNotes'][number],
): CreditNoteSummary => ({
  id: c.id,
  number: c.number,
  date: formatDay(c.date),
  reason: c.reason,
  withReturn: c.withReturn,
  total: toMoney(c.total),
});

/**
 * The steps taken, derived from the timestamps and their authors: creation and
 * issue, then the payments, refunds and credit notes in the order they were
 * recorded, then the cancellation.
 */
function invoiceHistory(i: InvoiceFull): InvoiceStep[] {
  const steps: InvoiceStep[] = [
    { step: 'BROUILLON', at: i.createdAt.toISOString(), by: i.createdBy.name },
  ];
  if (i.issuedAt) {
    steps.push({
      step: 'EMISE',
      at: i.issuedAt.toISOString(),
      by: i.issuedBy?.name ?? null,
    });
  }
  const events: InvoiceStep[] = [
    ...i.payments.map((p): InvoiceStep => ({
      step: p.kind === 'ENCAISSEMENT' ? 'PAIEMENT' : 'REMBOURSEMENT',
      at: p.createdAt.toISOString(),
      by: p.createdBy.name,
      note: p.number,
    })),
    ...i.creditNotes.map((c): InvoiceStep => ({
      step: 'AVOIR',
      at: c.createdAt.toISOString(),
      by: c.createdBy.name,
      note: c.number,
    })),
  ];
  steps.push(...events.sort((a, b) => a.at.localeCompare(b.at)));
  if (i.cancelledAt) {
    steps.push({
      step: 'ANNULEE',
      at: i.cancelledAt.toISOString(),
      by: i.cancelledBy?.name ?? null,
      note: i.cancelReason,
    });
  }
  return steps;
}

export function invoiceDetail(
  i: InvoiceFull,
  money: InvoiceMoney,
  today: string,
): InvoiceDetail {
  const credited = creditedByLine(i);
  return {
    ...invoiceRow(i, money, today),
    customerPhone: i.customer.phone,
    customerAddress: i.customer.address,
    quoteId: i.quoteId,
    quoteNumber: i.quote?.reference ?? null,
    note: i.note,
    cancelReason: i.cancelReason,
    lines: i.lines.map((l) => invoiceLineView(l, credited.get(l.id))),
    payments: i.payments.map(paymentView),
    creditNotes: i.creditNotes.map(creditNoteSummary),
    history: invoiceHistory(i),
  };
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  BROUILLON: 'Brouillon',
  EMISE: 'Émise',
  PARTIELLE: 'Partielle',
  SOLDEE: 'Soldée',
  ANNULEE: 'Annulée',
};

export const INVOICE_COLUMNS: ExportColumn<InvoiceRow>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'N° facture', value: (r) => r.number },
  { header: 'Client', value: (r) => r.customerName },
  { header: 'Produit', value: (r) => r.product },
  { header: 'Quantité', value: (r) => r.quantity },
  { header: 'Total', value: (r) => r.total },
  { header: 'Payé', value: (r) => r.paid },
  { header: 'Reste dû', value: (r) => r.due },
  { header: 'Échéance', value: (r) => r.dueDate },
  { header: 'Statut', value: (r) => INVOICE_STATUS_LABELS[r.status] },
];
