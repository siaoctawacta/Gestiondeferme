import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { assertNotFuture, formatDay, requireDay, today } from '../common/days';
import { nextDocumentNumber } from '../common/document-numbers';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from './invoices.service';
import type {
  CreateQuoteDto,
  QuoteQueryDto,
  UpdateQuoteDto,
} from './dto/quote.dto';
import { assertSaleCustomer } from './sale-customer';
import {
  quoteLineData,
  SaleLineResolver,
  sameLines,
} from './sale-line-resolver';
import {
  quoteDetail,
  quoteInclude,
  quoteRow,
  type QuoteDetail,
  type QuoteFull,
  type QuoteRow,
} from './sale-view';
import {
  expiredQuoteWhere,
  QUOTE_STATUS_LIST,
  quoteRefusal,
  quoteStatusWhere,
  quoteStatusAfter,
  type DisplayQuoteStatus,
  type QuoteAction,
} from './sale-workflow';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'Devis introuvable';
const BEFORE_DATE = 'La validité ne peut pas précéder la date du devis';
const SORTABLE = ['date', 'total', 'reference'];

/**
 * Quotes: lines that name their source, a total, a life cycle. A quote never
 * touches a ledger and availability is not checked (checked when the invoice
 * is issued).
 *
 * Lock order, every write: the quote row first (`lockRow`, scoped to the
 * caller's farms), its status checked through `sale-workflow.ts`, then nothing
 * else; a creation bumps the organisation's `DV` counter row (held until
 * commit) before it inserts.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: SaleLineResolver,
    private readonly invoices: InvoicesService,
  ) {}

  // ------------------------------------------------------------------ reads

  private status(value: string): DisplayQuoteStatus {
    const known = [...QUOTE_STATUS_LIST, 'EXPIRE'] as string[];
    if (!known.includes(value)) {
      throw new BadRequestException('Le statut du devis est invalide');
    }
    return value as DisplayQuoteStatus;
  }

  private where(
    ctx: RequestContext,
    q: QuoteQueryDto,
    withStatus: boolean,
  ): Prisma.QuoteWhereInput {
    const and: Prisma.QuoteWhereInput[] = [];
    if (withStatus && q.status)
      and.push(quoteStatusWhere(this.status(q.status), today()));
    if (q.search) {
      and.push({
        OR: [
          { reference: containsInsensitive(q.search) },
          { customer: { name: containsInsensitive(q.search) } },
          { lines: { some: { designation: containsInsensitive(q.search) } } },
        ],
      });
    }
    return {
      farmId: { in: ctx.farmIds },
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(and.length ? { AND: and } : {}),
    };
  }

  listArgs(ctx: RequestContext, q: QuoteQueryDto) {
    const where = this.where(ctx, q, true);
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    const day = formatDay(today());
    return {
      find: async (range: {
        skip?: number;
        take: number;
      }): Promise<QuoteRow[]> =>
        (
          await this.prisma.quote.findMany({
            where,
            include: quoteInclude,
            orderBy: [order, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map((r) => quoteRow(r, day)),
      count: () => this.prisma.quote.count({ where }),
      /** Per displayed status, over the other filters (the status filter itself is left out). */
      statusCounts: async () => {
        const base = this.where(ctx, q, false);
        const [groups, expired] = await Promise.all([
          this.prisma.quote.groupBy({
            by: ['status'],
            where: base,
            _count: { _all: true },
          }),
          this.prisma.quote.count({
            where: { AND: [base, expiredQuoteWhere(today())] },
          }),
        ]);
        const counts = Object.fromEntries(
          [...QUOTE_STATUS_LIST, 'EXPIRE'].map((s) => [s, 0]),
        ) as Record<DisplayQuoteStatus, number>;
        for (const g of groups) counts[g.status] = g._count._all;
        counts.ENVOYE -= expired;
        counts.EXPIRE = expired;
        return { statusCounts: counts };
      },
    };
  }

  private async load(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<QuoteFull> {
    const row = await client.quote.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: quoteInclude,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async get(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    return quoteDetail(
      await this.load(this.prisma, ctx, id),
      formatDay(today()),
    );
  }

  // ------------------------------------------------------------- shared bits

  /** Locks the quote (scoped to the caller's farms) and returns it fresh. */
  private async lock(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<QuoteFull> {
    await lockRow(tx, 'Quote', id, ctx.farmIds);
    return this.load(tx, ctx, id);
  }

  /** 409 when the workflow refuses `action` from the quote's stored status. */
  private allow(quote: QuoteFull, action: QuoteAction): void {
    const message = quoteRefusal(quote.status, action);
    if (message) throw new ConflictException(message);
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: AuditAction,
    recordId: string,
    label: string,
    farmId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    return this.audit.log(
      {
        ctx,
        module: 'ventes',
        action,
        recordId,
        label,
        farmId,
        before,
        after,
      },
      tx,
    );
  }

  /** Audits a change of the quote itself and returns the new detail. */
  private async saved(
    tx: Tx,
    ctx: RequestContext,
    before: QuoteFull,
  ): Promise<QuoteDetail> {
    const day = formatDay(today());
    const after = quoteDetail(await this.load(tx, ctx, before.id), day);
    await this.log(
      tx,
      ctx,
      'UPDATE',
      before.id,
      after.reference,
      before.farmId,
      quoteDetail(before, day),
      after,
    );
    return after;
  }

  // ------------------------------------------------------------- quote CRUD

  create(ctx: RequestContext, dto: CreateQuoteDto): Promise<QuoteDetail> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
    const date = requireDay(dto.date);
    assertNotFuture(date);
    const validUntil = dto.validUntil ? requireDay(dto.validUntil) : null;
    if (validUntil && validUntil.getTime() < date.getTime()) {
      throw new BadRequestException(BEFORE_DATE);
    }
    const organizationId = ctx.user.organizationId;
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await assertSaleCustomer(tx, ctx, dto.customerId);
        const { lines, total } = await this.resolver.resolve(
          tx,
          ctx,
          farmId,
          dto.lines,
          'le devis',
        );
        const reference = await nextDocumentNumber(tx, organizationId, 'DV');
        const created = await tx.quote.create({
          data: {
            organizationId,
            farmId,
            customerId: dto.customerId,
            reference,
            date,
            validUntil,
            total,
            note: dto.note || null,
            createdById: ctx.user.id,
            lines: { create: lines.map(quoteLineData) },
          },
          select: { id: true },
        });
        const detail = quoteDetail(
          await this.load(tx, ctx, created.id),
          formatDay(today()),
        );
        await this.log(
          tx,
          ctx,
          'CREATE',
          detail.id,
          detail.reference,
          farmId,
          undefined,
          detail,
        );
        return detail;
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateQuoteDto,
  ): Promise<QuoteDetail> {
    const date = dto.date ? requireDay(dto.date) : undefined;
    if (date) assertNotFuture(date);
    const validUntil =
      dto.validUntil === undefined
        ? undefined
        : dto.validUntil === null
          ? null
          : requireDay(dto.validUntil);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, ctx, id);
        this.allow(before, 'edit');
        const nextDate = date ?? before.date;
        const nextValid =
          validUntil === undefined ? before.validUntil : validUntil;
        if (nextValid && nextValid.getTime() < nextDate.getTime()) {
          throw new BadRequestException(BEFORE_DATE);
        }
        const customerChanged =
          dto.customerId !== undefined && dto.customerId !== before.customerId;
        if (customerChanged) {
          await assertSaleCustomer(tx, ctx, dto.customerId as string);
        }
        const resolved = dto.lines
          ? await this.resolver.resolve(
              tx,
              ctx,
              before.farmId,
              dto.lines,
              'le devis',
            )
          : undefined;
        // Only what really changes is written: a no-op PATCH leaves the quote
        // and the audit log alone.
        const dateChanged =
          date !== undefined && date.getTime() !== before.date.getTime();
        const validChanged =
          validUntil !== undefined &&
          (validUntil?.getTime() ?? null) !==
            (before.validUntil?.getTime() ?? null);
        const noteChanged =
          dto.note !== undefined && (dto.note || null) !== before.note;
        const linesChanged =
          resolved !== undefined && !sameLines(before.lines, resolved.lines);
        if (
          !customerChanged &&
          !dateChanged &&
          !validChanged &&
          !noteChanged &&
          !linesChanged
        ) {
          return quoteDetail(before, formatDay(today()));
        }
        await tx.quote.update({
          where: { id },
          data: {
            ...(customerChanged ? { customerId: dto.customerId } : {}),
            ...(dateChanged ? { date } : {}),
            ...(validChanged ? { validUntil } : {}),
            ...(noteChanged ? { note: dto.note || null } : {}),
            ...(linesChanged && resolved ? { total: resolved.total } : {}),
          },
        });
        if (linesChanged && resolved) {
          await tx.quoteLine.deleteMany({ where: { quoteId: id } });
          await tx.quoteLine.createMany({
            data: resolved.lines.map((l) => ({
              ...quoteLineData(l),
              quoteId: id,
            })),
          });
        }
        return this.saved(tx, ctx, before);
      }),
    );
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, ctx, id);
        this.allow(before, 'delete');
        await tx.quoteLine.deleteMany({ where: { quoteId: id } });
        await tx.quote.delete({ where: { id } });
        await this.log(
          tx,
          ctx,
          'DELETE',
          id,
          before.reference,
          before.farmId,
          quoteDetail(before, formatDay(today())),
        );
      }),
    );
  }

  // --------------------------------------------------------------- workflow

  /** `send`, `accept` or `refuse`: the status and the timestamp (and author) of the step. */
  step(
    ctx: RequestContext,
    id: string,
    action: 'send' | 'accept' | 'refuse',
  ): Promise<QuoteDetail> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      this.allow(before, action);
      const now = new Date();
      await tx.quote.update({
        where: { id },
        data: {
          status: quoteStatusAfter(action) ?? before.status,
          ...(action === 'send'
            ? { sentAt: now, sentById: ctx.user.id }
            : action === 'accept'
              ? { acceptedAt: now, decidedById: ctx.user.id }
              : { refusedAt: now, decidedById: ctx.user.id }),
        },
      });
      return this.saved(tx, ctx, before);
    });
  }

  /**
   * Turns a sent or accepted quote into an invoice draft: the lines are copied
   * with their sources and prices, the quote becomes `FACTURE` and the two
   * point at each other. Checked under the quote's lock like every step.
   */
  convert(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, ctx, id);
        this.allow(before, 'convert');
        await this.invoices.createFromQuote(tx, ctx, before);
        await tx.quote.update({
          where: { id },
          data: { status: quoteStatusAfter('convert') ?? before.status },
        });
        return this.saved(tx, ctx, before);
      }),
    );
  }
}
