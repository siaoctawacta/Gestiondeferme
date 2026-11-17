import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { formatDay, requireDay } from '../common/days';
import { toMoney, zero } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type {
  CustomerPaymentKind,
  PaymentMethod,
} from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { PaymentsJournalQueryDto } from './dto/payments-journal.dto';

const SORTABLE = ['date', 'number', 'amount'];

/** One line of the journal: a receipt (encashment) or a refund, with its invoice and customer. */
export interface PaymentJournalRow {
  id: string;
  /** The `RC-NNNN` number. */
  number: string;
  date: string;
  kind: CustomerPaymentKind;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
}

/** What came in, what went back out and the difference, over the filter (not the page). */
export interface PaymentJournalTotals {
  received: number;
  refunded: number;
  net: number;
}

const KIND_LABEL: Record<CustomerPaymentKind, string> = {
  ENCAISSEMENT: 'Encaissement',
  REMBOURSEMENT: 'Remboursement',
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  ESPECES: 'Espèces',
  VIREMENT: 'Virement',
  MOBILE_MONEY: 'Mobile money',
  CHEQUE: 'Chèque',
};

export const PAYMENT_JOURNAL_COLUMNS: ExportColumn<PaymentJournalRow>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'N° reçu', value: (r) => r.number },
  { header: 'Type', value: (r) => KIND_LABEL[r.kind] },
  { header: 'Mode', value: (r) => METHOD_LABEL[r.method] },
  { header: 'Facture', value: (r) => r.invoiceNumber },
  { header: 'Client', value: (r) => r.customerName },
  { header: 'Montant', value: (r) => r.amount },
];

const include = {
  invoice: {
    select: {
      id: true,
      number: true,
      customerId: true,
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.CustomerPaymentInclude;

/** The customer payments of the request's farms, newest first: the journal the cash reports read. */
@Injectable()
export class PaymentsJournal {
  constructor(private readonly prisma: PrismaService) {}

  listArgs(ctx: RequestContext, q: PaymentsJournalQueryDto) {
    const where: Prisma.CustomerPaymentWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.customerId ? { invoice: { customerId: q.customerId } } : {}),
      ...(q.from || q.to
        ? {
            date: {
              ...(q.from ? { gte: requireDay(q.from) } : {}),
              ...(q.to ? { lte: requireDay(q.to) } : {}),
            },
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { number: containsInsensitive(q.search) },
              { reference: containsInsensitive(q.search) },
              { invoice: { number: containsInsensitive(q.search) } },
              {
                invoice: { customer: { name: containsInsensitive(q.search) } },
              },
            ],
          }
        : {}),
    };
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return {
      find: async (range: {
        skip?: number;
        take: number;
      }): Promise<PaymentJournalRow[]> => {
        const found = await this.prisma.customerPayment.findMany({
          where,
          include,
          orderBy: [order, { createdAt: 'desc' }, { id: 'asc' }],
          ...range,
        });
        return found.map((p) => ({
          id: p.id,
          number: p.number,
          date: formatDay(p.date),
          kind: p.kind,
          method: p.method,
          amount: toMoney(p.amount),
          reference: p.reference,
          invoiceId: p.invoiceId,
          invoiceNumber: p.invoice.number as string,
          customerId: p.invoice.customerId,
          customerName: p.invoice.customer.name,
        }));
      },
      count: () => this.prisma.customerPayment.count({ where }),
      totals: async (): Promise<{ totals: PaymentJournalTotals }> => {
        const groups = await this.prisma.customerPayment.groupBy({
          by: ['kind'],
          where,
          _sum: { amount: true },
        });
        const sum = (kind: CustomerPaymentKind) =>
          groups.find((g) => g.kind === kind)?._sum.amount ?? zero();
        const received = sum('ENCAISSEMENT');
        const refunded = sum('REMBOURSEMENT');
        return {
          totals: {
            received: toMoney(received),
            refunded: toMoney(refunded),
            net: toMoney(received.sub(refunded)),
          },
        };
      },
    };
  }
}
