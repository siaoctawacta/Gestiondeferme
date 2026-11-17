import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { formatDay, requireDay, today } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { InvoiceQueryDto } from './dto/invoice.dto';
import {
  invoiceDetail,
  invoiceInclude,
  invoiceListInclude,
  invoiceRow,
  moneyOf,
  standingOf,
  type InvoiceDetail,
  type InvoiceFull,
  type InvoiceMoney,
  type InvoiceRow,
} from './invoice-view';
import { INVOICE_STATUS_LIST, type InvoiceStatusValue } from './sale-workflow';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'Facture introuvable';
const SORTABLE = ['date', 'number', 'total', 'due'];

/**
 * Everything that reads invoices: the list (filters, sorts, status counts) and
 * the detail. It never writes and takes no lock; `InvoicesService` (the
 * writes and the workflow) loads through it.
 */
@Injectable()
export class InvoiceReads {
  constructor(private readonly prisma: PrismaService) {}

  private status(value: string): InvoiceStatusValue {
    if (!(INVOICE_STATUS_LIST as readonly string[]).includes(value)) {
      throw new BadRequestException('Le statut de la facture est invalide');
    }
    return value as InvoiceStatusValue;
  }

  private where(
    ctx: RequestContext,
    q: InvoiceQueryDto,
    withStatus: boolean,
  ): Prisma.InvoiceWhereInput {
    const range: Prisma.DateTimeFilter = {};
    if (q.from) range.gte = requireDay(q.from);
    if (q.to) range.lte = requireDay(q.to);
    return {
      farmId: { in: ctx.farmIds },
      ...(withStatus && q.status ? { status: this.status(q.status) } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.from || q.to ? { date: range } : {}),
      ...(q.search
        ? {
            OR: [
              { number: containsInsensitive(q.search) },
              { customer: { name: containsInsensitive(q.search) } },
              {
                lines: { some: { designation: containsInsensitive(q.search) } },
              },
            ],
          }
        : {}),
    };
  }

  listArgs(ctx: RequestContext, q: InvoiceQueryDto) {
    const where = this.where(ctx, q, true);
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    const day = formatDay(today());
    const rows = async (ids: string[]): Promise<InvoiceRow[]> => {
      const found = await this.prisma.invoice.findMany({
        where: { id: { in: ids } },
        include: invoiceListInclude,
      });
      const money = await moneyOf(this.prisma, ids);
      const byId = new Map(found.map((i) => [i.id, i]));
      return ids.flatMap((id) => {
        const i = byId.get(id);
        const m = money.get(id);
        return i && m ? [invoiceRow(i, m, day)] : [];
      });
    };
    return {
      find: async (range: {
        skip?: number;
        take: number;
      }): Promise<InvoiceRow[]> => {
        if ('due' in order) {
          // `due` is derived from the payments and credit notes: ordered here, not by the database.
          const all = await this.prisma.invoice.findMany({
            where,
            select: { id: true, status: true, total: true, date: true },
          });
          const money = await moneyOf(
            this.prisma,
            all.map((i) => i.id),
          );
          const sign = order.due === 'asc' ? 1 : -1;
          const sorted = all
            .map((i) => ({
              ...i,
              due: standingOf(i, money.get(i.id) as InvoiceMoney).due,
            }))
            .sort(
              (a, b) =>
                sign * a.due.comparedTo(b.due) ||
                b.date.getTime() - a.date.getTime() ||
                a.id.localeCompare(b.id),
            );
          const skip = range.skip ?? 0;
          return rows(sorted.slice(skip, skip + range.take).map((i) => i.id));
        }
        const found = await this.prisma.invoice.findMany({
          where,
          select: { id: true },
          orderBy: [
            'number' in order
              ? { number: { sort: order.number, nulls: 'last' } }
              : order,
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
          ...range,
        });
        return rows(found.map((i) => i.id));
      },
      count: () => this.prisma.invoice.count({ where }),
      /** Per status, over the other filters (the status filter itself is left out). */
      statusCounts: async () => {
        const groups = await this.prisma.invoice.groupBy({
          by: ['status'],
          where: this.where(ctx, q, false),
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          INVOICE_STATUS_LIST.map((s) => [s, 0]),
        ) as Record<InvoiceStatusValue, number>;
        for (const g of groups) counts[g.status] = g._count._all;
        return { statusCounts: counts };
      },
    };
  }

  async load(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<InvoiceFull> {
    const row = await client.invoice.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: invoiceInclude,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async view(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<{ invoice: InvoiceFull; money: InvoiceMoney }> {
    const invoice = await this.load(client, ctx, id);
    const money = (await moneyOf(client, [id])).get(id) as InvoiceMoney;
    return { invoice, money };
  }

  async detail(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<InvoiceDetail> {
    const { invoice, money } = await this.view(client, ctx, id);
    return invoiceDetail(invoice, money, formatDay(today()));
  }

  get(ctx: RequestContext, id: string): Promise<InvoiceDetail> {
    return this.detail(this.prisma, ctx, id);
  }
}
