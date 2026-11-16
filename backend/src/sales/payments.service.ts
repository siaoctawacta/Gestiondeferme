import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { nextDocumentNumber } from '../common/document-numbers';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type {
  CustomerPaymentKind,
  PaymentMethod,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateClientPaymentDto } from './dto/payment.dto';
import {
  assertAllowed,
  lockInvoice,
  logSale,
  restate,
  statusWith,
} from './invoice-guard';
import { InvoiceReads } from './invoice-reads.service';
import { balanceOf } from './sale-money';
import { standingOf, type InvoiceDetail, type InvoiceMoney } from './sale-view';

type Tx = Prisma.TransactionClient;

export const OVERPAID = 'Le montant dépasse le reste dû';
const OVER_REFUND = 'Le montant dépasse le montant à rembourser';
const BEFORE_INVOICE = 'La date du paiement ne peut pas précéder la facture';
const REFUND_FIRST = "Supprimez d'abord le remboursement";
const NOT_FOUND = 'Paiement introuvable';
const BEFORE_CREDIT =
  'La date du remboursement ne peut pas précéder le dernier avoir';
const BEFORE_ENCASHMENT =
  'La date du remboursement ne peut pas précéder le dernier encaissement';

/** What the audit log calls a payment of each kind. */
const labelOf = (kind: CustomerPaymentKind): string =>
  kind === 'REMBOURSEMENT' ? 'remboursement' : 'paiement';

/** A client payment to write: its receipt number is taken by the caller (counter lock before any ledger lock). */
export interface NewPayment {
  number: string;
  kind: CustomerPaymentKind;
  date: Date;
  amount: Decimal;
  method: PaymentMethod;
  reference: string | null;
}

/**
 * Client payments of invoices: encashments and refunds, each with its `RC-NNNN`
 * receipt.
 *
 * Lock order, every write: the invoice row first (`lockInvoice`), the workflow
 * (`pay` / `refund` / `unpay`) checked on what is read under it, then the `RC`
 * counter row. Payments of one invoice therefore serialise and the amount is
 * compared, in `Decimal`, with what is due when the row is held: parallel
 * payments cannot overpay. No ledger is touched.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reads: InvoiceReads,
    private readonly audit: AuditService,
  ) {}

  /**
   * Writes a payment row and its audit row. The caller holds the invoice lock
   * and has checked the amount against what is due (or owed back).
   */
  async insert(
    tx: Tx,
    ctx: RequestContext,
    invoice: {
      id: string;
      organizationId: string;
      farmId: string;
      number: string | null;
    },
    payment: NewPayment,
    outcome?: Record<string, unknown>,
  ): Promise<string> {
    const created = await tx.customerPayment.create({
      data: {
        organizationId: invoice.organizationId,
        farmId: invoice.farmId,
        invoiceId: invoice.id,
        number: payment.number,
        kind: payment.kind,
        date: payment.date,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        createdById: ctx.user.id,
      },
      select: { id: true },
    });
    await logSale(this.audit, tx, ctx, {
      action: 'CREATE',
      recordId: created.id,
      label: `${invoice.number ?? ''} · ${labelOf(payment.kind)}`,
      farmId: invoice.farmId,
      after: {
        invoiceId: invoice.id,
        number: payment.number,
        kind: payment.kind,
        date: formatDay(payment.date),
        amount: toMoney(payment.amount),
        method: payment.method,
        reference: payment.reference,
        ...outcome,
      },
    });
    return created.id;
  }

  add(
    ctx: RequestContext,
    id: string,
    dto: CreateClientPaymentDto,
  ): Promise<InvoiceDetail> {
    const kind: CustomerPaymentKind = dto.kind ?? 'ENCAISSEMENT';
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockInvoice(this.reads, tx, ctx, id);
      assertAllowed(locked, kind === 'ENCAISSEMENT' ? 'pay' : 'refund');
      const { invoice, money } = locked;
      if (date.getTime() < invoice.date.getTime()) {
        throw new BadRequestException(BEFORE_INVOICE);
      }
      // What is given back stems from a credit note and from what was collected: not dated before the latest of either.
      if (kind === 'REMBOURSEMENT') {
        if (
          invoice.creditNotes.some((c) => c.date.getTime() > date.getTime())
        ) {
          throw new BadRequestException(BEFORE_CREDIT);
        }
        if (
          invoice.payments.some(
            (p) =>
              p.kind === 'ENCAISSEMENT' && p.date.getTime() > date.getTime(),
          )
        ) {
          throw new BadRequestException(BEFORE_ENCASHMENT);
        }
      }
      const amount = new Decimal(dto.amount);
      const standing = standingOf(invoice, money);
      if (kind === 'ENCAISSEMENT' && amount.gt(standing.due)) {
        throw new BadRequestException(OVERPAID);
      }
      if (kind === 'REMBOURSEMENT' && amount.gt(standing.refundDue)) {
        throw new BadRequestException(OVER_REFUND);
      }
      const number = await nextDocumentNumber(tx, invoice.organizationId, 'RC');
      const next: InvoiceMoney =
        kind === 'ENCAISSEMENT'
          ? { ...money, paid: money.paid.add(amount) }
          : { ...money, refunded: money.refunded.add(amount) };
      const after = standingOf(invoice, next);
      await this.insert(
        tx,
        ctx,
        invoice,
        {
          number,
          kind,
          date,
          amount,
          method: dto.method,
          reference: dto.reference ?? null,
        },
        {
          status: statusWith(invoice, next),
          due: toMoney(after.due),
          refundDue: toMoney(after.refundDue),
        },
      );
      await restate(tx, invoice, next);
      return this.reads.detail(tx, ctx, id);
    });
  }

  remove(
    ctx: RequestContext,
    id: string,
    paymentId: string,
  ): Promise<InvoiceDetail> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockInvoice(this.reads, tx, ctx, id);
      const { invoice, money } = locked;
      const payment = invoice.payments.find((p) => p.id === paymentId);
      if (!payment) throw new NotFoundException(NOT_FOUND);
      assertAllowed(locked, 'unpay');
      const next: InvoiceMoney =
        payment.kind === 'ENCAISSEMENT'
          ? { ...money, paid: money.paid.sub(payment.amount) }
          : { ...money, refunded: money.refunded.sub(payment.amount) };
      // Refunds already given must stay covered by what was collected beyond the net.
      if (
        payment.kind === 'ENCAISSEMENT' &&
        money.refunded.gt(0) &&
        balanceOf({
          total: invoice.total,
          credited: money.credited,
          paid: next.paid,
          refunded: money.refunded,
        }).due.gt(0)
      ) {
        throw new ConflictException(REFUND_FIRST);
      }
      await tx.customerPayment.delete({ where: { id: paymentId } });
      const status = await restate(tx, invoice, next);
      const standing = standingOf(invoice, next);
      await logSale(this.audit, tx, ctx, {
        action: 'DELETE',
        recordId: paymentId,
        label: `${invoice.number ?? ''} · ${labelOf(payment.kind)}`,
        farmId: invoice.farmId,
        before: {
          invoiceId: id,
          number: payment.number,
          kind: payment.kind,
          date: formatDay(payment.date),
          amount: toMoney(payment.amount),
          method: payment.method,
          reference: payment.reference,
          status: invoice.status,
        },
        after: {
          status,
          due: toMoney(standing.due),
          refundDue: toMoney(standing.refundDue),
        },
      });
      return this.reads.detail(tx, ctx, id);
    });
  }
}
