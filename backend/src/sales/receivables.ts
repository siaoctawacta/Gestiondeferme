import { Decimal } from '@prisma/client/runtime/client';
import { formatDayOrNull } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { balanceOf } from './sale-money';
import { REVENUE_STATUSES, type InvoiceStatusValue } from './sale-workflow';

/** What has been collected, credited and given back on an invoice. */
export interface InvoiceMoney {
  paid: Decimal;
  credited: Decimal;
  refunded: Decimal;
}

const zeroMoney = (): InvoiceMoney => ({
  paid: new Decimal(0),
  credited: new Decimal(0),
  refunded: new Decimal(0),
});

type Client = Prisma.TransactionClient | PrismaService;

/** What was collected, credited and given back on the invoices the two filters select: TWO grouped queries, whatever their number. */
async function sumMoney(
  client: Client,
  payments: Prisma.CustomerPaymentWhereInput,
  notes: Prisma.CreditNoteWhereInput,
): Promise<Map<string, InvoiceMoney>> {
  const result = new Map<string, InvoiceMoney>();
  const at = (id: string): InvoiceMoney => {
    const found = result.get(id) ?? zeroMoney();
    result.set(id, found);
    return found;
  };
  const collected = await client.customerPayment.groupBy({
    by: ['invoiceId', 'kind'],
    where: payments,
    _sum: { amount: true },
  });
  for (const g of collected) {
    const money = at(g.invoiceId);
    const sum = g._sum.amount ?? new Decimal(0);
    if (g.kind === 'ENCAISSEMENT') money.paid = money.paid.add(sum);
    else money.refunded = money.refunded.add(sum);
  }
  const credits = await client.creditNote.groupBy({
    by: ['invoiceId'],
    where: notes,
    _sum: { total: true },
  });
  for (const g of credits) {
    const money = at(g.invoiceId);
    money.credited = money.credited.add(g._sum.total ?? new Decimal(0));
  }
  return result;
}

/**
 * The money movements of invoices: Σ of the encashments, of the refunds and of
 * the credit notes of each (an invoice with none stands at zero). TWO queries
 * whatever the number of invoices; inside a transaction that holds the
 * invoice's row lock the figures cannot move.
 */
export async function moneyOf(
  client: Client,
  invoiceIds: string[],
): Promise<Map<string, InvoiceMoney>> {
  const found =
    invoiceIds.length === 0
      ? new Map<string, InvoiceMoney>()
      : await sumMoney(
          client,
          { invoiceId: { in: invoiceIds } },
          { invoiceId: { in: invoiceIds } },
        );
  return new Map(invoiceIds.map((id) => [id, found.get(id) ?? zeroMoney()]));
}

/** An issued invoice (issued, partly paid or settled) and what it is worth now. */
export interface Receivable {
  invoiceId: string;
  number: string;
  customerId: string;
  customerName: string;
  farmId: string;
  farmName: string;
  status: InvoiceStatusValue;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  total: Decimal;
  paid: Decimal;
  credited: Decimal;
  refunded: Decimal;
  /** Still to collect. */
  due: Decimal;
  /** Collected beyond the net and not yet given back. */
  refundDue: Decimal;
}

/**
 * THE read of what customers owe: every invoice in `REVENUE_STATUSES` of the
 * farms (optionally one customer's, optionally only those whose due date is
 * before `dueBefore`), with its `due` and `refundDue`. Customer balances, the
 * dashboard figure (Σ `due`) and the overdue alert all read it. THREE queries
 * (the invoices with customer and farm names, the payments, the credit notes)
 * whatever the number of invoices; it takes no lock.
 */
export async function receivablesOf(
  client: Client,
  farmIds: string[],
  opts: {
    customerIds?: string[];
    dueBefore?: Date;
    /** Only these statuses (default: every status in `REVENUE_STATUSES`). */
    statuses?: readonly InvoiceStatusValue[];
  } = {},
): Promise<Receivable[]> {
  if (farmIds.length === 0 || opts.customerIds?.length === 0) return [];
  const where: Prisma.InvoiceWhereInput = {
    farmId: { in: farmIds },
    status: { in: [...(opts.statuses ?? REVENUE_STATUSES)] },
    ...(opts.customerIds ? { customerId: { in: opts.customerIds } } : {}),
    ...(opts.dueBefore ? { dueDate: { lt: opts.dueBefore } } : {}),
  };
  const invoices = await client.invoice.findMany({
    where,
    select: {
      id: true,
      number: true,
      customerId: true,
      farmId: true,
      status: true,
      dueDate: true,
      total: true,
      customer: { select: { name: true } },
      farm: { select: { name: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }, { id: 'asc' }],
    relationLoadStrategy: 'join',
  });
  if (invoices.length === 0) return [];
  const money = await sumMoney(
    client,
    { invoice: { is: where } },
    { invoice: { is: where } },
  );
  return invoices.map((i) => {
    const m = money.get(i.id) ?? zeroMoney();
    const { due, refundDue } = standingOf(i, m);
    return {
      invoiceId: i.id,
      number: i.number as string,
      customerId: i.customerId,
      customerName: i.customer.name,
      farmId: i.farmId,
      farmName: i.farm.name,
      status: i.status,
      dueDate: formatDayOrNull(i.dueDate),
      total: i.total,
      ...m,
      due,
      refundDue,
    };
  });
}

/**
 * What an invoice is worth now. Only an issued invoice is owed: a draft and a
 * cancelled invoice stand at 0.
 */
export function standingOf(
  invoice: { status: InvoiceStatusValue; total: Decimal },
  money: InvoiceMoney,
) {
  const owed = REVENUE_STATUSES.includes(invoice.status);
  const zero = new Decimal(0);
  const { due, refundDue } = balanceOf({ total: invoice.total, ...money });
  return { due: owed ? due : zero, refundDue: owed ? refundDue : zero };
}
