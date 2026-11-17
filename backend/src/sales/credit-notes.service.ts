import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { nextDocumentNumber } from '../common/document-numbers';
import { formatCount } from '../common/format-number';
import { sumAmounts, toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  creditNoteDetail,
  creditNoteInclude,
  creditNoteRow,
  type CreditNoteDetail,
  type CreditNoteRow,
} from './credit-note-view';
import type {
  CreateCreditNoteDto,
  CreditNoteQueryDto,
} from './dto/credit-note.dto';
import {
  assertAllowed,
  lockInvoice,
  logSale,
  restate,
  statusWith,
} from './invoice-guard';
import { InvoiceReads } from './invoice-reads.service';
import { SaleEffects } from './sale-effects';
import { creditable, creditLineAmount } from './sale-money';
import {
  creditedByLine,
  standingOf,
  type InvoiceDetail,
  type InvoiceMoney,
} from './invoice-view';

const NOT_FOUND = 'Avoir introuvable';
const INVALID_LINE = 'Ligne de facture invalide';
const TWICE = "Une ligne ne peut figurer qu'une fois dans un avoir";
const WHOLE = 'La quantité doit être un nombre entier';
const BEFORE_INVOICE = "La date de l'avoir ne peut pas précéder la facture";
const WORTHLESS = "L'avoir doit porter sur un montant positif";
const NO_ANIMAL_RETURN =
  "Le retour d'un animal vendu n'est pas pris en charge : annulez la facture ou faites un avoir sans retour";
const SORTABLE = ['date', 'number', 'total'];
const WHOLE_KINDS = ['LOT', 'OEUFS', 'ANIMAL'];

const overCredit = (left: Decimal): string =>
  `La quantité dépasse la quantité restant à créditer (${formatCount(left.toNumber())})`;

/**
 * Credit notes (avoirs): a partial credit of an issued invoice by line
 * quantity, optionally with the return of the goods. Final: there is no edit
 * and no delete.
 *
 * Lock order of `create`: the invoice row (`lockInvoice`), the workflow
 * (`credit`) checked on what is read under it, every refusal that depends on
 * the request alone (dates, lines, quantities, amounts, animals), THEN the `AV`
 * counter row, the credit note rows, and — with return — `SaleEffects.
 * applyReturn` (lots incl. egg lots ascending -> ONE stock-ledger call, last).
 * One transaction: a refusal anywhere, a ledger's included, writes nothing, not
 * even a number. A credit note is worth money (`WORTHLESS`): goods sold at price
 * 0 cannot be returned through one (cancel the invoice, which has no payment or
 * credit note, or take them back with a stock movement). Credit notes and payments of one invoice serialise on its row,
 * so two credit notes racing for the same line cannot both take it.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reads: InvoiceReads,
    private readonly audit: AuditService,
    private readonly effects: SaleEffects,
  ) {}

  // ------------------------------------------------------------------ reads

  listArgs(ctx: RequestContext, q: CreditNoteQueryDto) {
    const where: Prisma.CreditNoteWhereInput = {
      farmId: { in: ctx.farmIds },
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
              { reason: containsInsensitive(q.search) },
              { invoice: { number: containsInsensitive(q.search) } },
              {
                invoice: {
                  customer: { name: containsInsensitive(q.search) },
                },
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
      }): Promise<CreditNoteRow[]> => {
        const found = await this.prisma.creditNote.findMany({
          where,
          include: creditNoteInclude,
          orderBy: [order, { createdAt: 'desc' }, { id: 'asc' }],
          ...range,
        });
        return found.map(creditNoteRow);
      },
      count: () => this.prisma.creditNote.count({ where }),
    };
  }

  async get(ctx: RequestContext, id: string): Promise<CreditNoteDetail> {
    const found = await this.prisma.creditNote.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: creditNoteInclude,
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    return creditNoteDetail(found);
  }

  // ----------------------------------------------------------------- create

  create(
    ctx: RequestContext,
    invoiceId: string,
    dto: CreateCreditNoteDto,
  ): Promise<InvoiceDetail> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    const withReturn = dto.withReturn ?? false;
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockInvoice(this.reads, tx, ctx, invoiceId);
      assertAllowed(locked, 'credit');
      const { invoice, money } = locked;
      if (date.getTime() < invoice.date.getTime()) {
        throw new BadRequestException(BEFORE_INVOICE);
      }
      // What each line takes back, from what the earlier credit notes already took (read under the invoice lock).
      const already = creditedByLine(invoice);
      const byId = new Map(invoice.lines.map((l) => [l.id, l]));
      if (dto.lines.some((l) => !byId.has(l.lineId))) {
        throw new BadRequestException(INVALID_LINE);
      }
      if (new Set(dto.lines.map((l) => l.lineId)).size !== dto.lines.length) {
        throw new BadRequestException(TWICE);
      }
      const zero = { quantity: new Decimal(0), amount: new Decimal(0) };
      const taken = dto.lines.map((pick) => {
        const line = byId.get(pick.lineId) as (typeof invoice.lines)[number];
        const before = already.get(line.id) ?? zero;
        const quantity = new Decimal(pick.quantity);
        if (WHOLE_KINDS.includes(line.kind) && !quantity.isInteger()) {
          throw new BadRequestException(WHOLE);
        }
        const left = creditable(line, before);
        // Checked BEFORE `creditLineAmount`, which would throw a RangeError (a 500).
        if (quantity.gt(left.quantity)) {
          throw new BadRequestException(overCredit(left.quantity));
        }
        return {
          line,
          quantity,
          amount: creditLineAmount(line, before, quantity),
        };
      });
      const total = sumAmounts(taken.map((t) => t.amount));
      if (!total.gt(0)) throw new BadRequestException(WORTHLESS);
      if (withReturn && taken.some((t) => t.line.kind === 'ANIMAL')) {
        throw new BadRequestException(NO_ANIMAL_RETURN);
      }

      const number = await nextDocumentNumber(tx, invoice.organizationId, 'AV');
      const note = await tx.creditNote.create({
        data: {
          organizationId: invoice.organizationId,
          farmId: invoice.farmId,
          invoiceId,
          number,
          date,
          reason: dto.reason,
          withReturn,
          total,
          createdById: ctx.user.id,
          lines: {
            create: taken.map((t) => ({
              invoiceLineId: t.line.id,
              quantity: t.quantity,
              amount: t.amount,
            })),
          },
        },
        select: { id: true },
      });
      if (withReturn) {
        await this.effects.applyReturn(tx, ctx, {
          id: note.id,
          farmId: invoice.farmId,
          invoiceId,
          number,
          date,
          lines: taken.map((t) => ({
            kind: t.line.kind,
            batchId: t.line.batchId,
            stockItemId: t.line.stockItemId,
            quantity: t.quantity,
          })),
        });
      }
      const next: InvoiceMoney = {
        ...money,
        credited: money.credited.add(total),
      };
      const standing = standingOf(invoice, next);
      const status = statusWith(invoice, next);
      await restate(tx, invoice, next);
      const created = await tx.creditNote.findUniqueOrThrow({
        where: { id: note.id },
        include: creditNoteInclude,
      });
      await logSale(this.audit, tx, ctx, {
        action: 'CREATE',
        recordId: note.id,
        label: number,
        farmId: invoice.farmId,
        after: {
          ...creditNoteDetail(created),
          invoiceStatus: status,
          due: toMoney(standing.due),
          refundDue: toMoney(standing.refundDue),
          date: formatDay(date),
        },
      });
      return this.reads.detail(tx, ctx, invoiceId);
    });
  }
}
