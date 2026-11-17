import { SELECT_FARM } from '../common/messages';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { SettingsService } from '../admin/settings/settings.service';
import { AuditService } from '../audit/audit.service';
import {
  addDays,
  assertNotFuture,
  formatDay,
  requireDay,
  today,
} from '../common/days';
import { nextDocumentNumber } from '../common/document-numbers';
import { lockRow } from '../common/lock-row';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { orConflict } from '../listing/list-helpers';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CancelInvoiceDto,
  CreateInvoiceDto,
  CreateIssuedInvoiceDto,
  IssueInvoiceDto,
  IssuePaymentDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';
import {
  assertAllowed,
  lockInvoice,
  logSale,
  statusWith,
  type InvoiceView,
} from './invoice-guard';
import { InvoiceReads } from './invoice-reads.service';
import { OVERPAID, PaymentsService } from './payments.service';
import { SaleEffects } from './sale-effects';
import { lineActivity, lineCategory } from './sale-lines';
import { assertSaleCustomer } from './sale-customer';
import {
  invoiceLineData,
  SaleLineResolver,
  sameLines,
  type ResolvedLine,
} from './sale-line-resolver';
import {
  invoiceDetail,
  standingOf,
  type InvoiceDetail,
  type InvoiceFull,
  type InvoiceMoney,
} from './invoice-view';
import type { QuoteFull } from './quote-view';
import { invoiceStatusOf, quoteStatusBeforeConversion } from './sale-workflow';

type Tx = Prisma.TransactionClient;

const DUE_BEFORE_DATE = "L'échéance ne peut pas précéder la date de la facture";

/** Label of an invoice in the audit log: its number, or what a draft is. */
const labelOf = (i: { number: string | null; customer: { name: string } }) =>
  i.number ?? `Brouillon — ${i.customer.name}`;

/**
 * Invoices: drafts, issue through the ledgers, cancellation.
 *
 * Lock order, every write: the invoice row first (`lockRow`, scoped to the
 * caller's farms), its status checked through `sale-workflow.ts`, then — at
 * issue — the `FA` counter row, then everything `sale-effects.ts` does: lots
 * (ascending) -> animals (ascending) -> the withdrawal guard -> ONE stock-ledger
 * call last. Deleting a draft made from a quote takes the quote row after the
 * invoice; converting a quote takes the quote row before it inserts the
 * invoice (which nobody else can see yet), so the two never cross. Cancelling
 * an invoice made from a quote takes the quote row right after the invoice
 * row, before any ledger lock, and gives the quote back.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reads: InvoiceReads,
    private readonly audit: AuditService,
    private readonly resolver: SaleLineResolver,
    private readonly effects: SaleEffects,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
  ) {}

  // ------------------------------------------------------------- shared bits

  /** Locks the invoice (scoped to the caller's farms) and returns it fresh. */
  private lock(tx: Tx, ctx: RequestContext, id: string): Promise<InvoiceView> {
    return lockInvoice(this.reads, tx, ctx, id);
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
    return logSale(this.audit, tx, ctx, {
      action,
      recordId,
      label,
      farmId,
      before,
      after,
    });
  }

  private assertDue(date: Date, dueDate: Date | null): void {
    if (dueDate && dueDate.getTime() < date.getTime()) {
      throw new BadRequestException(DUE_BEFORE_DATE);
    }
  }

  /** Stores a draft (no number, nothing moved) and returns its id. */
  private async insertDraft(
    tx: Tx,
    ctx: RequestContext,
    farmId: string,
    input: {
      customerId: string;
      date: Date;
      dueDate: Date | null;
      note: string | null;
      lines: ResolvedLine[];
      total: Decimal;
      quoteId?: string;
    },
  ): Promise<string> {
    const created = await tx.invoice.create({
      data: {
        organizationId: ctx.user.organizationId,
        farmId,
        customerId: input.customerId,
        date: input.date,
        dueDate: input.dueDate,
        total: input.total,
        note: input.note,
        quoteId: input.quoteId ?? null,
        createdById: ctx.user.id,
        lines: { create: input.lines.map(invoiceLineData) },
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Puts the quote an invoice was made from back to what it was before the
   * conversion (`ACCEPTE` if it had been accepted, else `ENVOYE`), audited.
   * The quote row is taken AFTER the invoice row (the caller holds it).
   */
  private async restoreQuote(
    tx: Tx,
    ctx: RequestContext,
    quoteId: string,
  ): Promise<void> {
    await lockRow(tx, 'Quote', quoteId, ctx.farmIds);
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const status = quoteStatusBeforeConversion(quote);
    await tx.quote.update({ where: { id: quote.id }, data: { status } });
    await this.log(
      tx,
      ctx,
      'UPDATE',
      quote.id,
      quote.reference,
      quote.farmId,
      { status: quote.status },
      { status },
    );
  }

  // ------------------------------------------------------------- invoice CRUD

  private async createDraftIn(
    tx: Tx,
    ctx: RequestContext,
    farmId: string,
    dto: CreateInvoiceDto,
  ): Promise<string> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    const dueDate = dto.dueDate ? requireDay(dto.dueDate) : null;
    this.assertDue(date, dueDate);
    await assertSaleCustomer(tx, ctx, dto.customerId);
    const { lines, total } = await this.resolver.resolve(
      tx,
      ctx,
      farmId,
      dto.lines,
    );
    return this.insertDraft(tx, ctx, farmId, {
      customerId: dto.customerId,
      date,
      dueDate,
      note: dto.note || null,
      lines,
      total,
    });
  }

  private farm(ctx: RequestContext): string {
    if (!ctx.farmId) throw new BadRequestException(SELECT_FARM);
    return ctx.farmId;
  }

  create(ctx: RequestContext, dto: CreateInvoiceDto): Promise<InvoiceDetail> {
    const farmId = this.farm(ctx);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const id = await this.createDraftIn(tx, ctx, farmId, dto);
        const detail = await this.reads.detail(tx, ctx, id);
        await this.log(
          tx,
          ctx,
          'CREATE',
          id,
          `Brouillon — ${detail.customerName}`,
          farmId,
          undefined,
          detail,
        );
        return detail;
      }),
    );
  }

  /**
   * Called by the quote's conversion, inside its transaction (the quote row is
   * locked): a draft with the quote's lines, sources and prices kept.
   */
  async createFromQuote(
    tx: Tx,
    ctx: RequestContext,
    quote: QuoteFull,
  ): Promise<string> {
    await assertSaleCustomer(tx, ctx, quote.customerId);
    const lines: ResolvedLine[] = quote.lines.map((l) => ({
      position: l.position,
      kind: l.kind,
      batchId: l.batchId,
      animalId: l.animalId,
      stockItemId: l.stockItemId,
      eggsPerUnit: l.eggsPerUnit,
      designation: l.designation,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      weightKg: l.weightKg,
      activity: lineActivityOf(l),
      category: lineCategoryOf(l),
    }));
    const id = await this.insertDraft(tx, ctx, quote.farmId, {
      customerId: quote.customerId,
      date: today(),
      dueDate: null,
      note: quote.note,
      lines,
      total: quote.total,
      quoteId: quote.id,
    });
    const detail = await this.reads.detail(tx, ctx, id);
    await this.log(
      tx,
      ctx,
      'CREATE',
      id,
      `Brouillon — ${detail.customerName}`,
      quote.farmId,
      undefined,
      detail,
    );
    return id;
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceDetail> {
    const date = dto.date ? requireDay(dto.date) : undefined;
    if (date) assertNotFuture(date);
    const dueDate =
      dto.dueDate === undefined
        ? undefined
        : dto.dueDate === null
          ? null
          : requireDay(dto.dueDate);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const locked = await this.lock(tx, ctx, id);
        assertAllowed(locked, 'edit');
        const before = locked.invoice;
        this.assertDue(
          date ?? before.date,
          dueDate === undefined ? before.dueDate : dueDate,
        );
        const customerChanged =
          dto.customerId !== undefined && dto.customerId !== before.customerId;
        if (customerChanged) {
          await assertSaleCustomer(tx, ctx, dto.customerId as string);
        }
        const resolved = dto.lines
          ? await this.resolver.resolve(tx, ctx, before.farmId, dto.lines)
          : undefined;
        // Only what really changes is written: a no-op PATCH leaves the
        // invoice and the audit log alone.
        const dateChanged =
          date !== undefined && date.getTime() !== before.date.getTime();
        const dueChanged =
          dueDate !== undefined &&
          (dueDate?.getTime() ?? null) !== (before.dueDate?.getTime() ?? null);
        const noteChanged =
          dto.note !== undefined && (dto.note || null) !== before.note;
        const linesChanged =
          resolved !== undefined && !sameLines(before.lines, resolved.lines);
        if (
          !customerChanged &&
          !dateChanged &&
          !dueChanged &&
          !noteChanged &&
          !linesChanged
        ) {
          return invoiceDetail(before, locked.money, formatDay(today()));
        }
        await tx.invoice.update({
          where: { id },
          data: {
            ...(customerChanged ? { customerId: dto.customerId } : {}),
            ...(dateChanged ? { date } : {}),
            ...(dueChanged ? { dueDate } : {}),
            ...(noteChanged ? { note: dto.note || null } : {}),
            ...(linesChanged && resolved ? { total: resolved.total } : {}),
          },
        });
        if (linesChanged && resolved) {
          await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
          await tx.invoiceLine.createMany({
            data: resolved.lines.map((l) => ({
              ...invoiceLineData(l),
              invoiceId: id,
            })),
          });
        }
        const after = await this.reads.detail(tx, ctx, id);
        await this.log(
          tx,
          ctx,
          'UPDATE',
          id,
          labelOf(before),
          before.farmId,
          invoiceDetail(before, locked.money, formatDay(today())),
          after,
        );
        return after;
      }),
    );
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const locked = await this.lock(tx, ctx, id);
        assertAllowed(locked, 'delete');
        const before = locked.invoice;
        const day = formatDay(today());
        if (before.quoteId) await this.restoreQuote(tx, ctx, before.quoteId);
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        await tx.invoice.delete({ where: { id } });
        await this.log(
          tx,
          ctx,
          'DELETE',
          id,
          labelOf(before),
          before.farmId,
          invoiceDetail(before, locked.money, day),
        );
      }),
    );
  }

  // --------------------------------------------------------------- workflow

  /**
   * Issues the draft `id` (the caller holds its row lock): the FA number, the
   * `RC` number of a payment collected with it, the effects on the ledgers,
   * the payment, the status, the due date. The payment is dated the invoice's
   * date and may not exceed its total; both numbers are taken before the
   * ledgers' locks (counters first), and a refusal anywhere rolls the whole
   * transaction back, numbers included.
   */
  private async issueIn(
    tx: Tx,
    ctx: RequestContext,
    invoice: InvoiceFull,
    money: InvoiceMoney,
    payment?: IssuePaymentDto,
  ): Promise<void> {
    assertNotFuture(invoice.date);
    const amount = payment ? new Decimal(payment.amount) : null;
    if (amount && amount.gt(invoice.total)) {
      throw new BadRequestException(OVERPAID);
    }
    // Sources are checked against the active farm BEFORE any lock (a body id is a 400, never a 404).
    await this.resolver.assertSources(tx, ctx, invoice.farmId, invoice.lines);
    await assertSaleCustomer(tx, ctx, invoice.customerId);
    const dueDate =
      invoice.dueDate ??
      addDays(
        invoice.date,
        await this.settings.number(
          ctx.user.organizationId,
          'invoiceDueDays',
          tx,
        ),
      );
    const number = await nextDocumentNumber(tx, ctx.user.organizationId, 'FA');
    const receipt = amount
      ? await nextDocumentNumber(tx, ctx.user.organizationId, 'RC')
      : null;
    await this.effects.apply(tx, ctx, {
      id: invoice.id,
      farmId: invoice.farmId,
      number,
      date: invoice.date,
      lines: invoice.lines,
    });
    const collected: InvoiceMoney = {
      ...money,
      paid: money.paid.add(amount ?? 0),
    };
    const status = statusWith(invoice, collected);
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        number,
        dueDate,
        status,
        issuedAt: new Date(),
        issuedById: ctx.user.id,
      },
    });
    if (amount && receipt && payment) {
      const standing = standingOf({ status, total: invoice.total }, collected);
      await this.payments.insert(
        tx,
        ctx,
        { ...invoice, number },
        {
          number: receipt,
          kind: 'ENCAISSEMENT',
          date: invoice.date,
          amount,
          method: payment.method,
          reference: payment.reference ?? null,
        },
        {
          status,
          due: toMoney(standing.due),
          refundDue: toMoney(standing.refundDue),
        },
      );
    }
  }

  issue(
    ctx: RequestContext,
    id: string,
    dto: IssueInvoiceDto,
  ): Promise<InvoiceDetail> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const locked = await this.lock(tx, ctx, id);
        assertAllowed(locked, 'issue');
        await this.issueIn(tx, ctx, locked.invoice, locked.money, dto.payment);
        const after = await this.reads.detail(tx, ctx, id);
        await this.log(
          tx,
          ctx,
          'UPDATE',
          id,
          after.number ?? labelOf(locked.invoice),
          locked.invoice.farmId,
          invoiceDetail(locked.invoice, locked.money, formatDay(today())),
          after,
        );
        return after;
      }),
    );
  }

  /** Create and issue in one transaction (one audit row: the creation of an issued invoice). */
  createIssued(
    ctx: RequestContext,
    dto: CreateIssuedInvoiceDto,
  ): Promise<InvoiceDetail> {
    const farmId = this.farm(ctx);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const id = await this.createDraftIn(tx, ctx, farmId, dto);
        const { invoice, money } = await this.reads.view(tx, ctx, id);
        await this.issueIn(tx, ctx, invoice, money, dto.payment);
        const after = await this.reads.detail(tx, ctx, id);
        await this.log(
          tx,
          ctx,
          'CREATE',
          id,
          after.number ?? '',
          farmId,
          undefined,
          after,
        );
        return after;
      }),
    );
  }

  cancel(
    ctx: RequestContext,
    id: string,
    dto: CancelInvoiceDto,
  ): Promise<InvoiceDetail> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, ctx, id);
      assertAllowed(locked, 'cancel');
      const before = locked.invoice;
      // An invoice made from a quote gives it back (a quote is invoiced once at a time).
      if (before.quoteId) await this.restoreQuote(tx, ctx, before.quoteId);
      await this.effects.reverse(tx, {
        id,
        farmId: before.farmId,
        number: before.number as string,
        lines: before.lines,
      });
      await tx.invoice.update({
        where: { id },
        data: {
          status: invoiceStatusOf({
            issued: true,
            cancelled: true,
            net: before.total,
            paid: locked.money.paid,
            refunded: locked.money.refunded,
          }),
          cancelledAt: new Date(),
          cancelledById: ctx.user.id,
          cancelReason: dto.reason,
          // the link goes with the quote's return: it can be converted again
          ...(before.quoteId ? { quoteId: null } : {}),
        },
      });
      const after = await this.reads.detail(tx, ctx, id);
      await this.log(
        tx,
        ctx,
        'UPDATE',
        id,
        before.number as string,
        before.farmId,
        invoiceDetail(before, locked.money, formatDay(today())),
        after,
      );
      return after;
    });
  }
}

type QuoteLineOf = QuoteFull['lines'][number];
const lineActivityOf = (l: QuoteLineOf) =>
  lineActivity(l.kind, l.batch?.species);
const lineCategoryOf = (l: QuoteLineOf) => lineCategory(l.kind);
