import { ConflictException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import type { AuditService } from '../audit/audit.service';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import type { InvoiceReads } from './invoice-reads.service';
import {
  standingOf,
  type InvoiceFull,
  type InvoiceMoney,
} from './invoice-view';
import {
  invoiceStatusOf,
  refusal,
  type InvoiceAction,
  type InvoiceStatusValue,
} from './sale-workflow';

type Tx = Prisma.TransactionClient;

/** An invoice and what has been collected, credited and given back on it. */
export interface InvoiceView {
  invoice: InvoiceFull;
  money: InvoiceMoney;
}

/**
 * The first step of every write on an invoice: its row lock (scoped to the
 * caller's farms: another farm's invoice is a 404), then the invoice and its
 * money read FRESH under that lock. Payments, payment deletions, credit notes
 * and refunds all serialise here.
 */
export async function lockInvoice(
  reads: InvoiceReads,
  tx: Tx,
  ctx: RequestContext,
  id: string,
): Promise<InvoiceView> {
  await lockRow(tx, 'Invoice', id, ctx.farmIds);
  return reads.view(tx, ctx, id);
}

/** 409 with the workflow's message (from the document facts read under the lock) when `action` is refused. */
export function assertAllowed(view: InvoiceView, action: InvoiceAction): void {
  const message = refusal(
    {
      status: view.invoice.status,
      paid: view.money.paid,
      credited: view.money.credited,
      refundDue: standingOf(view.invoice, view.money).refundDue,
    },
    action,
  );
  if (message) throw new ConflictException(message);
}

/** The status an issued invoice has with `money`: the workflow's `invoiceStatusOf`, from the stored total. */
export const statusWith = (
  invoice: Pick<InvoiceFull, 'total'>,
  money: InvoiceMoney,
): InvoiceStatusValue =>
  invoiceStatusOf({
    issued: true,
    cancelled: false,
    net: invoice.total.sub(money.credited),
    paid: money.paid,
    refunded: money.refunded,
  });

/** Stores the status an issued invoice has with `money` (nothing is written when it does not change) and returns it. */
export async function restate(
  tx: Tx,
  invoice: Pick<InvoiceFull, 'id' | 'status' | 'total'>,
  money: InvoiceMoney,
): Promise<InvoiceStatusValue> {
  const status = statusWith(invoice, money);
  if (status !== invoice.status) {
    await tx.invoice.update({ where: { id: invoice.id }, data: { status } });
  }
  return status;
}

/** The audit row of one write in the `ventes` module, in the caller's transaction. */
export function logSale(
  audit: AuditService,
  tx: Tx,
  ctx: RequestContext,
  row: {
    action: AuditAction;
    recordId: string;
    label: string;
    farmId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  return audit.log({ ctx, module: 'ventes', ...row }, tx);
}
