import { formatDay, formatDayOrNull } from '../common/days';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type {
  Activity,
  FinanceCategory,
  SaleLineKind,
} from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { lineActivity, lineCategory } from './sale-lines';
import {
  displayQuoteStatus,
  type DisplayQuoteStatus,
  type QuoteStatusValue,
} from './sale-workflow';

/** The relations a sale line view needs to name its source and derive its activity. */
export const lineInclude = {
  batch: { select: { code: true, species: true } },
  animal: { select: { tag: true } },
  stockItem: { select: { name: true } },
} satisfies Prisma.QuoteLineInclude;

/** Everything the views need of a quote, loaded in one query. */
export const quoteInclude = {
  customer: true,
  lines: { include: lineInclude, orderBy: { position: 'asc' } },
  createdBy: { select: { name: true } },
  sentBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
} satisfies Prisma.QuoteInclude;

export type QuoteFull = Prisma.QuoteGetPayload<{
  include: typeof quoteInclude;
}>;

export const QUOTE_STATUS_LABELS: Record<DisplayQuoteStatus, string> = {
  BROUILLON: 'Brouillon',
  ENVOYE: 'Envoyé',
  ACCEPTE: 'Accepté',
  REFUSE: 'Refusé',
  FACTURE: 'Facturé',
  EXPIRE: 'Expiré',
};

export interface QuoteRow {
  id: string;
  /** The `DV-NNNN` number. */
  reference: string;
  date: string;
  validUntil: string | null;
  customerId: string;
  customerName: string;
  /** First line's designation, `+n` when there are more lines. */
  product: string;
  /** Quantity and unit of the first line. */
  quantity: number;
  unit: string | null;
  total: number;
  /** The stored status, or `EXPIRE` for a sent quote past its validity. */
  status: DisplayQuoteStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface SaleLineView {
  id: string;
  position: number;
  kind: SaleLineKind;
  batchId: string | null;
  animalId: string | null;
  stockItemId: string | null;
  /** The lot code, animal tag or article name; null for a service. */
  sourceLabel: string | null;
  designation: string;
  unit: string | null;
  eggsPerUnit: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  weightKg: number | null;
  activity: Activity;
  category: FinanceCategory;
}

export interface QuoteStep {
  step: QuoteStatusValue;
  at: string;
  by: string | null;
}

export interface QuoteDetail extends QuoteRow {
  customerPhone: string | null;
  customerAddress: string | null;
  note: string | null;
  lines: SaleLineView[];
  history: QuoteStep[];
}

type LineWithSource = QuoteFull['lines'][number];

export function lineView(l: LineWithSource): SaleLineView {
  return {
    id: l.id,
    position: l.position,
    kind: l.kind,
    batchId: l.batchId,
    animalId: l.animalId,
    stockItemId: l.stockItemId,
    sourceLabel: l.batch?.code ?? l.animal?.tag ?? l.stockItem?.name ?? null,
    designation: l.designation,
    unit: l.unit,
    eggsPerUnit: l.eggsPerUnit,
    quantity: l.quantity.toNumber(),
    unitPrice: toMoney(l.unitPrice),
    amount: toMoney(l.amount),
    weightKg: l.weightKg?.toNumber() ?? null,
    activity: lineActivity(l.kind, l.batch?.species),
    category: lineCategory(l.kind),
  };
}

/** `today` is the calendar day (`YYYY-MM-DD`) the derived `EXPIRE` is judged on. */
export function quoteRow(q: QuoteFull, today: string): QuoteRow {
  const first = q.lines[0];
  return {
    id: q.id,
    reference: q.reference,
    date: formatDay(q.date),
    validUntil: formatDayOrNull(q.validUntil),
    customerId: q.customerId,
    customerName: q.customer.name,
    product: first
      ? q.lines.length > 1
        ? `${first.designation} +${q.lines.length - 1}`
        : first.designation
      : '',
    quantity: first ? first.quantity.toNumber() : 0,
    unit: first?.unit ?? null,
    total: toMoney(q.total),
    status: displayQuoteStatus(q.status, formatDayOrNull(q.validUntil), today),
    // The invoice a quote became is not read until the invoices exist.
    invoiceId: q.invoiceId,
    invoiceNumber: null,
  };
}

/** The steps taken, derived from the status timestamps and their authors. */
function historyOf(q: QuoteFull): QuoteStep[] {
  const steps: QuoteStep[] = [
    { step: 'BROUILLON', at: q.createdAt.toISOString(), by: q.createdBy.name },
  ];
  if (q.sentAt) {
    steps.push({
      step: 'ENVOYE',
      at: q.sentAt.toISOString(),
      by: q.sentBy?.name ?? null,
    });
  }
  if (q.acceptedAt) {
    steps.push({
      step: 'ACCEPTE',
      at: q.acceptedAt.toISOString(),
      by: q.decidedBy?.name ?? null,
    });
  }
  if (q.refusedAt) {
    steps.push({
      step: 'REFUSE',
      at: q.refusedAt.toISOString(),
      by: q.decidedBy?.name ?? null,
    });
  }
  return steps;
}

export function quoteDetail(q: QuoteFull, today: string): QuoteDetail {
  return {
    ...quoteRow(q, today),
    customerPhone: q.customer.phone,
    customerAddress: q.customer.address,
    note: q.note,
    lines: q.lines.map(lineView),
    history: historyOf(q),
  };
}

export const QUOTE_COLUMNS: ExportColumn<QuoteRow>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'N° devis', value: (r) => r.reference },
  { header: 'Client', value: (r) => r.customerName },
  { header: 'Produit', value: (r) => r.product },
  { header: 'Quantité', value: (r) => r.quantity },
  { header: 'Total', value: (r) => r.total },
  { header: 'Statut', value: (r) => QUOTE_STATUS_LABELS[r.status] },
];
