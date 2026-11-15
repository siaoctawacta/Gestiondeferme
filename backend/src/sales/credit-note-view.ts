import { formatDay } from '../common/days';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type { SaleLineKind } from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';

/** Everything the views need of a credit note, loaded in one query. */
export const creditNoteInclude = {
  invoice: {
    select: {
      number: true,
      customerId: true,
      customer: { select: { name: true, phone: true, address: true } },
    },
  },
  lines: {
    include: { invoiceLine: true },
    orderBy: { invoiceLine: { position: 'asc' } },
  },
} satisfies Prisma.CreditNoteInclude;

export type CreditNoteFull = Prisma.CreditNoteGetPayload<{
  include: typeof creditNoteInclude;
}>;

export interface CreditNoteRow {
  id: string;
  /** The `AV-NNNN` number. */
  number: string;
  date: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  reason: string;
  withReturn: boolean;
  total: number;
}

/** A line of a credit note: the invoice line it credits, the quantity and the amount computed by `creditLineAmount`. */
export interface CreditNoteLineView {
  id: string;
  invoiceLineId: string;
  kind: SaleLineKind;
  designation: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface CreditNoteDetail extends CreditNoteRow {
  customerPhone: string | null;
  customerAddress: string | null;
  lines: CreditNoteLineView[];
}

export const creditNoteRow = (c: CreditNoteFull): CreditNoteRow => ({
  id: c.id,
  number: c.number,
  date: formatDay(c.date),
  invoiceId: c.invoiceId,
  invoiceNumber: c.invoice.number as string,
  customerName: c.invoice.customer.name,
  reason: c.reason,
  withReturn: c.withReturn,
  total: toMoney(c.total),
});

export const creditNoteDetail = (c: CreditNoteFull): CreditNoteDetail => ({
  ...creditNoteRow(c),
  customerPhone: c.invoice.customer.phone,
  customerAddress: c.invoice.customer.address,
  lines: c.lines.map((l) => ({
    id: l.id,
    invoiceLineId: l.invoiceLineId,
    kind: l.invoiceLine.kind,
    designation: l.invoiceLine.designation,
    unit: l.invoiceLine.unit,
    quantity: l.quantity.toNumber(),
    unitPrice: toMoney(l.invoiceLine.unitPrice),
    amount: toMoney(l.amount),
  })),
});

export const CREDIT_NOTE_COLUMNS: ExportColumn<CreditNoteRow>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'N° avoir', value: (r) => r.number },
  { header: 'Facture', value: (r) => r.invoiceNumber },
  { header: 'Client', value: (r) => r.customerName },
  { header: 'Motif', value: (r) => r.reason },
  { header: 'Retour', value: (r) => (r.withReturn ? 'Oui' : 'Non') },
  { header: 'Montant', value: (r) => r.total },
];
