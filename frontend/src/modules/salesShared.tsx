import type { StatusDef } from '../components/module/types';
import { formatMoney } from '../lib/format';
import { Pill } from '../components/ui/Pill';
import { LOCKED, type PaymentMethod } from './purchasingShared';
import type { SaleLineData, SaleLineKind } from './saleLines';

export type { EggUnit, SaleLineData, SaleLineKind, Sellable } from './saleLines';

/* ---------------------------------------------------------------------------------------------
 * API shapes (backend contract of `/customers` and `/quotes`, Task 2). Reconcile with the backend here only.
 * The shapes of a sale line and of `/sales/sellables` are at the top of `saleLines.tsx`.
 * ------------------------------------------------------------------------------------------- */

export type CustomerType = 'PARTICULIER' | 'REVENDEUR' | 'RESTAURANT' | 'GROSSISTE';

/** `GET /customers`. `balance` = Σ what is due on the issued invoices; `refundDue` = Σ what is owed back (a credit note beyond what was paid), apart. */
export interface CustomerRow {
  id: string;
  name: string;
  type: CustomerType;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  active: boolean;
  balance: number;
  refundDue: number;
}

/** `GET /customers/:id`: the row and what the customer was invoiced, paid, credited and was refunded. */
export interface CustomerData extends CustomerRow {
  invoiced: number;
  paid: number;
  credited: number;
  refunded: number;
}

/** What `GET /quotes` shows of a status: derived by the API, `EXPIRE` is a sent quote past its validity. */
export type QuoteStatus = 'BROUILLON' | 'ENVOYE' | 'ACCEPTE' | 'REFUSE' | 'FACTURE' | 'EXPIRE';

/** `GET /quotes`. `product` is the first line's designation (`+n` when more), `quantity` / `unit` its quantity and unit. */
export interface QuoteRow {
  id: string;
  reference: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `YYYY-MM-DD` */
  validUntil: string | null;
  customerId: string;
  customerName: string;
  product: string;
  quantity: number;
  unit: string | null;
  total: number;
  status: QuoteStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

/** One step of a quote's history (`at` is the ISO timestamp). */
export interface QuoteStep {
  step: Exclude<QuoteStatus, 'EXPIRE'>;
  at: string;
  by: string | null;
}

/** `GET /quotes/:id`. */
export interface QuoteData extends QuoteRow {
  customerPhone: string | null;
  customerAddress: string | null;
  note: string | null;
  lines: SaleLineData[];
  history: QuoteStep[];
}

/** What the quote actions need of a quote: a list row or the detail both fit. */
export type QuoteRef = Pick<QuoteRow, 'id' | 'reference' | 'status'>;


/** What `GET /sales` shows of an invoice. `number` is null for a draft; `credited` / `refunded` / `due` / `refundDue` are amounts. */
export type InvoiceStatus = 'BROUILLON' | 'EMISE' | 'PARTIELLE' | 'SOLDEE' | 'ANNULEE';

/**
 * `GET /sales` (Task 4). `product` is the first line's designation (`+n` when more), `quantity` / `unit` its quantity and unit.
 * `due` = max(0, total − credited − paid + refunded); `refundDue` = what the customer is owed back after a credit note;
 * `overdue`: issued or partly paid, `due > 0` and `dueDate` before today.
 */
export interface InvoiceRow {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  number: string | null;
  customerId: string;
  customerName: string;
  product: string;
  quantity: number;
  unit: string | null;
  total: number;
  paid: number;
  credited: number;
  refunded: number;
  due: number;
  refundDue: number;
  status: InvoiceStatus;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  overdue: boolean;
}

/** A line of `GET /sales/:id`: the sale line plus what a credit note may still take. */
export interface InvoiceLineData extends SaleLineData {
  id: string;
  creditedQuantity: number;
  creditableQuantity: number;
  /** What is left of the line in money: the last credit of a line takes exactly this (the lines' roundings never add up past the line). */
  creditableAmount: number;
  activity: string;
  category: string;
}

export type PaymentKind = 'ENCAISSEMENT' | 'REMBOURSEMENT';

/** A client payment (`RC-NNNN`) of `GET /sales/:id`; a refund is a payment of kind `REMBOURSEMENT`. */
export interface InvoicePayment {
  id: string;
  number: string;
  kind: PaymentKind;
  /** `YYYY-MM-DD` */
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
}

/** A credit note of `GET /sales/:id`. */
export interface InvoiceCreditNote {
  id: string;
  number: string;
  /** `YYYY-MM-DD` */
  date: string;
  reason: string;
  withReturn: boolean;
  total: number;
}

/** One event of the invoice's life (`at` is the ISO timestamp); `note` carries a payment, a credit note or a cancellation reason. */
export interface InvoiceStep {
  step: 'BROUILLON' | 'EMISE' | 'PAIEMENT' | 'REMBOURSEMENT' | 'AVOIR' | 'ANNULEE';
  at: string;
  by: string | null;
  note?: string | null;
}

/** `GET /sales/:id`. */
export interface InvoiceData extends InvoiceRow {
  customerPhone: string | null;
  customerAddress: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  note: string | null;
  cancelReason: string | null;
  lines: InvoiceLineData[];
  payments: InvoicePayment[];
  creditNotes: InvoiceCreditNote[];
  history: InvoiceStep[];
}

/** What the invoice actions need of an invoice: a list row or the detail both fit. */
export type InvoiceRef = Pick<InvoiceRow, 'id' | 'number' | 'customerName' | 'total' | 'status' | 'paid' | 'credited' | 'due' | 'refundDue' | 'date'>;

/** `GET /credit-notes` (Task 5). */
export interface CreditNoteRow {
  id: string;
  number: string;
  /** `YYYY-MM-DD` */
  date: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  reason: string;
  withReturn: boolean;
  total: number;
}

/** A line of a credit note: the invoice line it credits, the quantity and the amount the API computed. */
export interface CreditNoteLine {
  id: string;
  invoiceLineId: string;
  kind: SaleLineKind;
  designation: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/** `GET /credit-notes/:id`. */
export interface CreditNoteData extends CreditNoteRow {
  customerPhone: string | null;
  customerAddress: string | null;
  lines: CreditNoteLine[];
}

/* --------------------------------------------------------------------------------------------- */

export const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  { value: 'PARTICULIER', label: 'Particulier' },
  { value: 'REVENDEUR', label: 'Revendeur' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'GROSSISTE', label: 'Grossiste' },
];
export const customerTypeLabel = (t: string) => CUSTOMER_TYPES.find((x) => x.value === t)?.label ?? t;

export const QUOTE_STATUSES: StatusDef[] = [
  { value: 'BROUILLON', label: 'Brouillon', tone: 'neutral' },
  { value: 'ENVOYE', label: 'Envoyé', tone: 'warning' },
  { value: 'ACCEPTE', label: 'Accepté', tone: 'success' },
  { value: 'REFUSE', label: 'Refusé', tone: 'danger' },
  { value: 'FACTURE', label: 'Facturé', tone: 'success' },
  { value: 'EXPIRE', label: 'Expiré', tone: 'danger' },
];
export const quoteStatusDef = (s: string) => QUOTE_STATUSES.find((x) => x.value === s);

export const INVOICE_STATUSES: StatusDef[] = [
  { value: 'BROUILLON', label: 'Brouillon', tone: 'neutral' },
  { value: 'EMISE', label: 'Émise', tone: 'warning' },
  { value: 'PARTIELLE', label: 'Partielle', tone: 'warning' },
  { value: 'SOLDEE', label: 'Soldée', tone: 'success' },
  { value: 'ANNULEE', label: 'Annulée', tone: 'danger' },
];
export const invoiceStatusDef = (s: string) => INVOICE_STATUSES.find((x) => x.value === s);

export const INVOICE_STEP_LABELS: Record<InvoiceStep['step'], string> = {
  BROUILLON: 'Création',
  EMISE: 'Émission',
  PAIEMENT: 'Paiement',
  REMBOURSEMENT: 'Remboursement',
  AVOIR: 'Avoir',
  ANNULEE: 'Annulation',
};

/** The `RESTE DÛ` pill of a list row: what the status says, else what is owed back, else what is still due (yellow, overdue or not, as in the reference). */
export function DuePill({ row }: { row: Pick<InvoiceRow, 'status' | 'due' | 'refundDue'> }) {
  if (row.status === 'BROUILLON') return <Pill tone="neutral">Brouillon</Pill>;
  if (row.status === 'ANNULEE') return <Pill tone="neutral">Annulée</Pill>;
  if (row.refundDue > 0) return <Pill tone="danger">À rembourser {formatMoney(row.refundDue)}</Pill>;
  if (row.due <= 0) return <Pill tone="success">{formatMoney(0)}</Pill>;
  return <Pill tone="warning">{formatMoney(row.due)}</Pill>;
}

/** `date` (`YYYY-MM-DD`) plus `days`, as `YYYY-MM-DD`; empty when `date` is not a date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Only a draft can be edited or deleted. */
export const draftGate = (q: { status: string }): true | string => (q.status === 'BROUILLON' ? true : LOCKED);
