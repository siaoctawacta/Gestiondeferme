import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
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
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { orConflict } from '../listing/list-helpers';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CancelInvoiceDto,
  CreateInvoiceDto,
  IssueInvoiceDto,
  UpdateInvoiceDto,
} from './dto/invoice.dto';
import { InvoiceReads } from './invoice-reads.service';
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
  type QuoteFull,
} from './sale-view';
import {
  invoiceStatusOf,
  quoteStatusBeforeConversion,
  refusal,
  type InvoiceAction,
} from './sale-workflow';

type Tx = Prisma.TransactionClient;

const DUE_BEFORE_DATE = "L'échéance ne peut pas précéder la date de la facture";
const PAYMENT_LATER =
  "Le paiement à l'émission n'est pas encore pris en charge : encaissez la facture une fois émise";

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
 * invoice (which nobody else can see yet), so the two never cross.
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
  ) {}

  // ------------------------------------------------------------- shared bits

  /** Locks the invoice (scoped to the caller's farms) and returns it fresh. */
  private async lock(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ invoice: InvoiceFull; money: InvoiceMoney }> {
    await lockRow(tx, 'Invoice', id, ctx.farmIds);
    return this.reads.view(tx, ctx, id);
  }

  /** 409 when the workflow refuses `action` from what the invoice is now. */
  private allow(
    { invoice, money }: { invoice: InvoiceFull; money: InvoiceMoney },
    action: InvoiceAction,
  ): void {
    const message = refusal(
      {
        status: invoice.status,
        paid: money.paid,
        credited: money.credited,
        refundDue: standingOf(invoice, money).refundDue,
      },
      action,
    );
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

  private assertDue(date: Date, dueDate: Date | null): void {
    if (dueDate && dueDate.getTime() < date.getTime()) {
      throw new BadRequestException(DUE_BEFORE_DATE);
    }
  }

  private noPayment(dto: { payment?: unknown }): void {
    if (dto.payment) throw new BadRequestException(PAYMENT_LATER);
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
    if (!ctx.farmId) throw new BadRequestException('Sélectionnez une ferme');
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
        this.allow(locked, 'edit');
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
        this.allow(locked, 'delete');
        const before = locked.invoice;
        const day = formatDay(today());
        if (before.quoteId) {
          // The quote goes back to what it was before it was converted (quote row after the invoice row).
          await lockRow(tx, 'Quote', before.quoteId, ctx.farmIds);
          const quote = await tx.quote.findUniqueOrThrow({
            where: { id: before.quoteId },
          });
          const status = quoteStatusBeforeConversion(quote);
          await tx.quote.update({
            where: { id: quote.id },
            data: { status },
          });
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
   * effects on the ledgers, the status, the due date. A payment collected at
   * issue is rejected until the payments exist.
   */
  private async issueIn(
    tx: Tx,
    ctx: RequestContext,
    invoice: InvoiceFull,
    money: InvoiceMoney,
  ): Promise<void> {
    assertNotFuture(invoice.date);
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
    await this.effects.apply(tx, ctx, {
      id: invoice.id,
      farmId: invoice.farmId,
      number,
      date: invoice.date,
      lines: invoice.lines,
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        number,
        dueDate,
        status: invoiceStatusOf({
          issued: true,
          cancelled: false,
          net: invoice.total.sub(money.credited),
          paid: money.paid,
          refunded: money.refunded,
        }),
        issuedAt: new Date(),
        issuedById: ctx.user.id,
      },
    });
  }

  issue(
    ctx: RequestContext,
    id: string,
    dto: IssueInvoiceDto,
  ): Promise<InvoiceDetail> {
    this.noPayment(dto);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const locked = await this.lock(tx, ctx, id);
        this.allow(locked, 'issue');
        await this.issueIn(tx, ctx, locked.invoice, locked.money);
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
    dto: CreateInvoiceDto & { payment?: unknown },
  ): Promise<InvoiceDetail> {
    const farmId = this.farm(ctx);
    this.noPayment(dto);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const id = await this.createDraftIn(tx, ctx, farmId, dto);
        const { invoice, money } = await this.reads.view(tx, ctx, id);
        await this.issueIn(tx, ctx, invoice, money);
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
      this.allow(locked, 'cancel');
      const before = locked.invoice;
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
