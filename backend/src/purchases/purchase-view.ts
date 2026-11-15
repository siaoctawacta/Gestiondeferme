import { Decimal } from '@prisma/client/runtime/client';
import { formatDay, formatDayOrNull } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import type { ExportColumn } from '../listing/export';
import { linesAmount, remainingOf } from './purchase-money';
import {
  isCancelled,
  isPaid,
  type PurchaseStatusValue,
} from './purchase-workflow';

/** Everything the views need of a purchase, loaded in one query. */
export const purchaseInclude = {
  supplier: true,
  items: { include: { stockItem: true }, orderBy: { position: 'asc' } },
  payments: {
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
  requestedBy: { select: { name: true } },
  validatedBy: { select: { name: true } },
  orderedBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
} satisfies Prisma.PurchaseInclude;

export type PurchaseFull = Prisma.PurchaseGetPayload<{
  include: typeof purchaseInclude;
}>;

export const STATUS_LABELS: Record<PurchaseStatusValue, string> = {
  DEMANDE: 'Demande',
  VALIDEE: 'Validée',
  COMMANDEE: 'Commandée',
  RECUE: 'Reçue',
  PAYEE: 'Payée',
  ANNULEE: 'Annulée',
};

export interface PurchaseRow {
  id: string;
  date: string;
  /** The `BC-NNNN` once ordered, else the `DA-NNNN`. */
  reference: string;
  supplierName: string;
  /** First line's article, `+n` when there are more lines. */
  article: string;
  /** Quantity of the first line (the received one once received). */
  quantity: number;
  status: PurchaseStatusValue;
  amount: number;
  paid: number;
  remaining: number;
}

export interface PurchaseLineView {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  receivedQuantity: number | null;
  lotNumber: string | null;
  expiryDate: string | null;
}

export interface PurchasePaymentView {
  id: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
}

export interface PurchaseStep {
  step: PurchaseStatusValue;
  at: string;
  by: string | null;
  note?: string;
}

export interface PurchaseDetail extends PurchaseRow {
  supplierId: string;
  supplierPhone: string | null;
  supplierAddress: string | null;
  /** The `DA-NNNN` request number, kept after the order. */
  requestNumber: string;
  orderNumber: string | null;
  orderedAt: string | null;
  receivedDate: string | null;
  cancelReason: string | null;
  note: string | null;
  lines: PurchaseLineView[];
  payments: PurchasePaymentView[];
  history: PurchaseStep[];
}

export function toRow(p: PurchaseFull): PurchaseRow {
  const amount = linesAmount(p.items);
  const paid = p.payments.reduce((s, x) => s.add(x.amount), new Decimal(0));
  const first = p.items[0];
  const status = p.status;
  return {
    id: p.id,
    date: formatDay(p.date),
    reference: p.orderNumber ?? p.reference,
    supplierName: p.supplier.name,
    article: first
      ? p.items.length > 1
        ? `${first.stockItem.name} +${p.items.length - 1}`
        : first.stockItem.name
      : '',
    quantity: first ? (first.receivedQuantity ?? first.quantity).toNumber() : 0,
    status,
    amount: amount.toNumber(),
    paid: paid.toNumber(),
    remaining: isCancelled(status)
      ? 0
      : remainingOf(
          amount,
          p.payments.map((x) => x.amount),
        ).toNumber(),
  };
}

/** The steps taken, derived from the status timestamps and their authors. */
function historyOf(p: PurchaseFull): PurchaseStep[] {
  const steps: PurchaseStep[] = [
    { step: 'DEMANDE', at: p.createdAt.toISOString(), by: p.requestedBy.name },
  ];
  if (p.validatedAt) {
    steps.push({
      step: 'VALIDEE',
      at: p.validatedAt.toISOString(),
      by: p.validatedBy?.name ?? null,
    });
  }
  if (p.orderedAt) {
    steps.push({
      step: 'COMMANDEE',
      at: p.orderedAt.toISOString(),
      by: p.orderedBy?.name ?? null,
    });
  }
  if (p.receivedAt) {
    steps.push({
      step: 'RECUE',
      at: p.receivedAt.toISOString(),
      by: p.receivedBy?.name ?? null,
    });
  }
  if (isPaid(p.status)) {
    // Paid in full by the payment that brought the remaining amount to 0: the last one.
    const last = [...p.payments].sort(
      (a, b) => +a.createdAt - +b.createdAt || a.id.localeCompare(b.id),
    )[p.payments.length - 1];
    if (last) {
      steps.push({
        step: 'PAYEE',
        at: last.createdAt.toISOString(),
        by: last.createdBy.name,
      });
    } else if (p.receivedAt) {
      // Settled at reception (nothing to pay): paid by the reception itself.
      steps.push({
        step: 'PAYEE',
        at: p.receivedAt.toISOString(),
        by: p.receivedBy?.name ?? null,
      });
    }
  }
  if (p.cancelledAt) {
    steps.push({
      step: 'ANNULEE',
      at: p.cancelledAt.toISOString(),
      by: p.cancelledBy?.name ?? null,
      note: p.cancelReason ?? undefined,
    });
  }
  return steps;
}

export function toDetail(p: PurchaseFull): PurchaseDetail {
  return {
    ...toRow(p),
    supplierId: p.supplierId,
    supplierPhone: p.supplier.phone,
    supplierAddress: p.supplier.address,
    requestNumber: p.reference,
    orderNumber: p.orderNumber,
    orderedAt: p.orderedAt?.toISOString() ?? null,
    receivedDate: formatDayOrNull(p.receivedDate),
    cancelReason: p.cancelReason,
    note: p.note,
    lines: p.items.map((i) => ({
      itemId: i.stockItemId,
      itemName: i.stockItem.name,
      unit: i.stockItem.unit,
      quantity: i.quantity.toNumber(),
      unitPrice: i.unitPrice.toNumber(),
      receivedQuantity: i.receivedQuantity?.toNumber() ?? null,
      lotNumber: i.lotNumber,
      expiryDate: formatDayOrNull(i.expiryDate),
    })),
    payments: p.payments.map((x) => ({
      id: x.id,
      date: formatDay(x.date),
      amount: x.amount.toNumber(),
      method: x.method,
      reference: x.reference,
    })),
    history: historyOf(p),
  };
}

export const PURCHASE_COLUMNS: ExportColumn<PurchaseRow>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'Référence', value: (r) => r.reference },
  { header: 'Fournisseur', value: (r) => r.supplierName },
  { header: 'Article', value: (r) => r.article },
  { header: 'Quantité', value: (r) => r.quantity },
  { header: 'Statut', value: (r) => STATUS_LABELS[r.status] },
  { header: 'Montant', value: (r) => r.amount },
];
