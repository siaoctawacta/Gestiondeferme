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
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  StockLedgerService,
  type RecordInput,
} from '../stock/stock-ledger.service';
import { MAX_PAYMENT } from './dto/purchase.dto';
import type {
  CancelPurchaseDto,
  CreatePaymentDto,
  CreatePurchaseDto,
  PurchaseLineDto,
  PurchaseQueryDto,
  ReceivePurchaseDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import { lineAmount, linesAmount, remainingOf } from './purchase-money';
import { nextPurchaseNumber } from './purchase-numbers';
import {
  purchaseInclude,
  toDetail,
  toRow,
  type PurchaseDetail,
  type PurchaseFull,
  type PurchaseRow,
} from './purchase-view';
import {
  can,
  PURCHASE_STATUS_LIST,
  statusAfter,
  type PurchaseAction,
  type PurchaseStatusValue,
} from './purchase-workflow';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'Achat introuvable';
const PAYMENT_NOT_FOUND = 'Paiement introuvable';
const SUPPLIER_INVALID = 'Fournisseur invalide';
const SUPPLIER_INACTIVE = 'Ce fournisseur est inactif';
const ITEM_INVALID = 'Article invalide';
const ITEM_INACTIVE = 'Article inactif';
const SORTABLE = ['date', 'status'];

/** Why a step is refused (409) from each status. */
const REFUSED: Record<PurchaseAction, string> = {
  validate: 'Seule une demande peut être validée',
  order: 'Seule une demande validée peut être commandée',
  receive: 'Seule une commande peut être réceptionnée',
  cancel: 'Un achat reçu ou payé ne peut plus être annulé',
  edit: 'Seule une demande peut être modifiée',
  delete: 'Seule une demande peut être supprimée',
  pay: 'Seul un achat reçu peut être payé',
  unpay: 'Ce paiement ne peut plus être supprimé',
};
const TOO_BIG = 'Le montant total est trop élevé';
/** Under the payment cap, so a purchase can always be paid in one payment and its amount is safe as a JS number. */
const MAX_TOTAL = new Decimal(MAX_PAYMENT);
const OVER_RECEIVED = 'La quantité reçue dépasse la quantité commandée';
const PAYMENT_BEFORE_RECEPTION =
  'La date du paiement ne peut pas précéder la réception';
const RECEIVED_LINES = 'Les lignes reçues ne correspondent pas à la commande';
const NOTHING_RECEIVED = 'Aucune quantité reçue : annulez la commande';
const BEFORE_PURCHASE =
  "La date de réception ne peut pas précéder celle de l'achat";
const OVERPAID = 'Le montant dépasse le reste à payer';

/**
 * Purchase requests, orders, receptions and supplier payments.
 *
 * Lock order, every path: the purchase row first (`lockRow`, scoped to the
 * caller's farms), then nothing else, except a reception, which ends with ONE
 * stock-ledger call (the ledger takes its own locks last); a creation or an
 * order also bumps the organisation's numbering counter row (a row lock held
 * until commit, taken after the purchase row and never while waiting on
 * another row).
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
  ) {}

  // ------------------------------------------------------------------ reads

  private where(
    ctx: RequestContext,
    q: PurchaseQueryDto,
    withStatus: boolean,
  ): Prisma.PurchaseWhereInput {
    return {
      farmId: { in: ctx.farmIds },
      ...(withStatus && q.status ? { status: this.status(q.status) } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.search
        ? {
            OR: [
              { reference: containsInsensitive(q.search) },
              { orderNumber: containsInsensitive(q.search) },
              { supplier: { name: containsInsensitive(q.search) } },
              {
                items: {
                  some: { stockItem: { name: containsInsensitive(q.search) } },
                },
              },
            ],
          }
        : {}),
    };
  }

  private status(value: string): PurchaseStatusValue {
    if (!(PURCHASE_STATUS_LIST as readonly string[]).includes(value)) {
      throw new BadRequestException("Le statut de l'achat est invalide");
    }
    return value as PurchaseStatusValue;
  }

  /**
   * The list order. `reference` sorts by the DISPLAYED reference (the BC
   * number once ordered, else the DA): every `BC-` sorts before every `DA-`,
   * so it is the order numbers first (then the unordered ones by DA number).
   */
  private listOrder(
    q: PurchaseQueryDto,
  ): Prisma.PurchaseOrderByWithRelationInput[] {
    const [field, dir] = (q.sort ?? '').split(':');
    if (
      field === 'reference' &&
      (dir === undefined || dir === 'asc' || dir === 'desc')
    ) {
      const d = dir ?? 'asc';
      return [
        { orderNumber: { sort: d, nulls: d === 'asc' ? 'last' : 'first' } },
        { reference: d },
      ];
    }
    return [orderBy(q, SORTABLE, { date: 'desc' })];
  }

  listArgs(ctx: RequestContext, q: PurchaseQueryDto) {
    const where = this.where(ctx, q, true);
    const order = this.listOrder(q);
    return {
      find: async (range: {
        skip?: number;
        take: number;
      }): Promise<PurchaseRow[]> =>
        (
          await this.prisma.purchase.findMany({
            where,
            include: purchaseInclude,
            orderBy: [...order, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toRow),
      count: () => this.prisma.purchase.count({ where }),
      /** Per status, over the other filters (the status filter itself is left out). */
      statusCounts: async () => {
        const groups = await this.prisma.purchase.groupBy({
          by: ['status'],
          where: this.where(ctx, q, false),
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          PURCHASE_STATUS_LIST.map((s) => [s, 0]),
        ) as Record<PurchaseStatusValue, number>;
        for (const g of groups) counts[g.status] = g._count._all;
        return { statusCounts: counts };
      },
    };
  }

  private async load(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<PurchaseFull> {
    const row = await client.purchase.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: purchaseInclude,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async get(ctx: RequestContext, id: string): Promise<PurchaseDetail> {
    return toDetail(await this.load(this.prisma, ctx, id));
  }

  // ------------------------------------------------------------- shared bits

  /** Locks the purchase (scoped to the caller's farms) and returns it fresh. */
  private async lock(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<PurchaseFull> {
    await lockRow(tx, 'Purchase', id, ctx.farmIds);
    return this.load(tx, ctx, id);
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
        module: 'achats',
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

  /** Audits a change of the purchase itself and returns the new detail. */
  private async saved(
    tx: Tx,
    ctx: RequestContext,
    before: PurchaseFull,
  ): Promise<PurchaseDetail> {
    const after = await this.load(tx, ctx, before.id);
    const detail = toDetail(after);
    await this.log(
      tx,
      ctx,
      'UPDATE',
      after.id,
      detail.reference,
      after.farmId,
      toDetail(before),
      detail,
    );
    return detail;
  }

  private refuse(step: PurchaseAction): never {
    throw new ConflictException(REFUSED[step]);
  }

  private async assertSupplier(
    tx: Tx,
    ctx: RequestContext,
    supplierId: string,
  ): Promise<void> {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, organizationId: ctx.user.organizationId },
    });
    if (!supplier) throw new BadRequestException(SUPPLIER_INVALID);
    if (!supplier.active) throw new BadRequestException(SUPPLIER_INACTIVE);
  }

  private async assertItems(
    tx: Tx,
    ctx: RequestContext,
    lines: PurchaseLineDto[],
  ): Promise<void> {
    const ids = [...new Set(lines.map((l) => l.itemId))];
    const items = await tx.stockItem.findMany({
      where: { id: { in: ids }, organizationId: ctx.user.organizationId },
    });
    if (items.length !== ids.length)
      throw new BadRequestException(ITEM_INVALID);
    if (items.some((i) => !i.active)) {
      throw new BadRequestException(ITEM_INACTIVE);
    }
  }

  private assertTotal(lines: PurchaseLineDto[]): void {
    const total = linesAmount(
      lines.map((l) => ({ ...l, receivedQuantity: null })),
    );
    if (total.gt(MAX_TOTAL)) throw new BadRequestException(TOO_BIG);
  }

  private lineData(lines: PurchaseLineDto[]) {
    return lines.map((l, position) => ({
      position,
      stockItemId: l.itemId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    }));
  }

  // ------------------------------------------------------------ request CRUD

  create(ctx: RequestContext, dto: CreatePurchaseDto): Promise<PurchaseDetail> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
    const date = requireDay(dto.date);
    assertNotFuture(date);
    this.assertTotal(dto.lines);
    const organizationId = ctx.user.organizationId;
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertSupplier(tx, ctx, dto.supplierId);
        await this.assertItems(tx, ctx, dto.lines);
        const reference = await nextPurchaseNumber(tx, organizationId, 'DA');
        const created = await tx.purchase.create({
          data: {
            organizationId,
            farmId,
            supplierId: dto.supplierId,
            reference,
            date,
            note: dto.note ?? null,
            requestedById: ctx.user.id,
            items: { create: this.lineData(dto.lines) },
          },
          select: { id: true },
        });
        const detail = toDetail(await this.load(tx, ctx, created.id));
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
    dto: UpdatePurchaseDto,
  ): Promise<PurchaseDetail> {
    const date = dto.date ? requireDay(dto.date) : undefined;
    if (date) assertNotFuture(date);
    if (dto.lines) this.assertTotal(dto.lines);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, ctx, id);
        if (!can(before.status, 'edit')) this.refuse('edit');
        // Only what really changes is validated and written: an empty or
        // no-op PATCH leaves the purchase and the audit log alone.
        const supplierChanged =
          dto.supplierId !== undefined && dto.supplierId !== before.supplierId;
        const dateChanged =
          date !== undefined && date.getTime() !== before.date.getTime();
        const noteChanged =
          dto.note !== undefined && (dto.note || null) !== before.note;
        const linesChanged =
          dto.lines !== undefined && !this.sameLines(before, dto.lines);
        if (!supplierChanged && !dateChanged && !noteChanged && !linesChanged) {
          return toDetail(before);
        }
        if (supplierChanged) {
          await this.assertSupplier(tx, ctx, dto.supplierId as string);
        }
        if (linesChanged) await this.assertItems(tx, ctx, dto.lines ?? []);
        await tx.purchase.update({
          where: { id },
          data: {
            ...(supplierChanged ? { supplierId: dto.supplierId } : {}),
            ...(dateChanged ? { date } : {}),
            ...(noteChanged ? { note: dto.note || null } : {}),
          },
        });
        if (linesChanged && dto.lines) {
          await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
          await tx.purchaseItem.createMany({
            data: this.lineData(dto.lines).map((l) => ({
              ...l,
              purchaseId: id,
            })),
          });
        }
        return this.saved(tx, ctx, before);
      }),
    );
  }

  private sameLines(before: PurchaseFull, lines: PurchaseLineDto[]): boolean {
    return (
      before.items.length === lines.length &&
      before.items.every((item, i) => {
        const l = lines[i];
        return (
          item.stockItemId === l.itemId &&
          item.quantity.eq(l.quantity) &&
          item.unitPrice.eq(l.unitPrice)
        );
      })
    );
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, ctx, id);
        if (!can(before.status, 'delete')) this.refuse('delete');
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchase.delete({ where: { id } });
        const detail = toDetail(before);
        await this.log(
          tx,
          ctx,
          'DELETE',
          id,
          detail.reference,
          before.farmId,
          detail,
        );
      }),
    );
  }

  // --------------------------------------------------------------- workflow

  validate(ctx: RequestContext, id: string): Promise<PurchaseDetail> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      if (!can(before.status, 'validate')) this.refuse('validate');
      await tx.purchase.update({
        where: { id },
        data: {
          status: statusAfter('validate'),
          validatedAt: new Date(),
          validatedById: ctx.user.id,
        },
      });
      return this.saved(tx, ctx, before);
    });
  }

  /** Assigns the `BC-NNNN` number (per organisation, from the counter row). */
  order(ctx: RequestContext, id: string): Promise<PurchaseDetail> {
    const organizationId = ctx.user.organizationId;
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lock(tx, ctx, id);
        if (!can(before.status, 'order')) this.refuse('order');
        const orderNumber = await nextPurchaseNumber(tx, organizationId, 'BC');
        await tx.purchase.update({
          where: { id },
          data: {
            status: statusAfter('order'),
            orderNumber,
            orderedAt: new Date(),
            orderedById: ctx.user.id,
          },
        });
        return this.saved(tx, ctx, before);
      }),
    );
  }

  cancel(
    ctx: RequestContext,
    id: string,
    dto: CancelPurchaseDto,
  ): Promise<PurchaseDetail> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      if (!can(before.status, 'cancel')) this.refuse('cancel');
      await tx.purchase.update({
        where: { id },
        data: {
          status: statusAfter('cancel'),
          cancelledAt: new Date(),
          cancelledById: ctx.user.id,
          cancelReason: dto.reason,
        },
      });
      return this.saved(tx, ctx, before);
    });
  }

  /**
   * One transaction: the purchase row is locked first and its status checked
   * under the lock (so a second reception is a 409), each line received above
   * 0 gets its lot, then ONE `recordMany` writes every `ENTREE` at the order's
   * unit price (source `PURCHASE`). A line received at 0 creates neither.
   */
  receive(
    ctx: RequestContext,
    id: string,
    dto: ReceivePurchaseDto,
  ): Promise<PurchaseDetail> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      if (!can(before.status, 'receive')) this.refuse('receive');
      if (date.getTime() < before.date.getTime()) {
        throw new BadRequestException(BEFORE_PURCHASE);
      }
      const received = this.pairLines(before, dto);
      if (received.every((r) => r.quantity.isZero())) {
        throw new BadRequestException(NOTHING_RECEIVED);
      }
      for (const r of received) {
        await tx.purchaseItem.update({
          where: { id: r.line.id },
          data: {
            receivedQuantity: r.quantity,
            lotNumber: r.lotNumber,
            expiryDate: r.expiryDate,
          },
        });
      }
      const worth = received.reduce(
        (sum, r) => sum.add(lineAmount(r.quantity, r.line.unitPrice)),
        new Decimal(0),
      );
      await tx.purchase.update({
        where: { id },
        data: {
          // A purchase worth 0 has nothing to pay: it is settled at reception.
          status: statusAfter('receive', { settled: worth.isZero() }),
          receivedAt: new Date(),
          receivedById: ctx.user.id,
          receivedDate: date,
        },
      });
      const inputs: RecordInput[] = [];
      for (const r of received) {
        if (r.quantity.isZero()) continue;
        const batch = await this.ledger.createBatch(tx, {
          farmId: before.farmId,
          stockItemId: r.line.stockItemId,
          lotNumber: r.lotNumber,
          expiryDate: r.expiryDate,
          receivedDate: date,
        });
        inputs.push({
          farmId: before.farmId,
          stockItemId: r.line.stockItemId,
          date,
          type: 'ENTREE',
          quantity: r.quantity,
          unitCost: r.line.unitPrice,
          reason: 'ACHAT',
          stockBatchId: batch.id,
          sourceType: 'PURCHASE',
          sourceId: id,
          userId: ctx.user.id,
        });
      }
      await this.ledger.recordMany(tx, inputs);
      return this.saved(tx, ctx, before);
    });
  }

  /**
   * Matches the received lines to the order's: one entry per ordered line, an
   * article ordered on several lines being matched in the order of its lines.
   */
  private pairLines(purchase: PurchaseFull, dto: ReceivePurchaseDto) {
    const queues = new Map<string, PurchaseFull['items']>();
    for (const line of purchase.items) {
      queues.set(line.stockItemId, [
        ...(queues.get(line.stockItemId) ?? []),
        line,
      ]);
    }
    if (dto.lines.length !== purchase.items.length) {
      throw new BadRequestException(RECEIVED_LINES);
    }
    return dto.lines.map((l) => {
      const line = queues.get(l.itemId)?.shift();
      if (!line) throw new BadRequestException(RECEIVED_LINES);
      const quantity = new Decimal(l.receivedQuantity);
      if (quantity.gt(line.quantity))
        throw new BadRequestException(OVER_RECEIVED);
      const makesLot = !quantity.isZero();
      return {
        line,
        quantity,
        lotNumber: makesLot ? (l.lotNumber ?? null) : null,
        expiryDate: makesLot && l.expiryDate ? requireDay(l.expiryDate) : null,
      };
    });
  }

  // --------------------------------------------------------------- payments

  addPayment(
    ctx: RequestContext,
    id: string,
    dto: CreatePaymentDto,
  ): Promise<PurchaseDetail> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      if (!can(before.status, 'pay')) this.refuse('pay');
      if (
        before.receivedDate &&
        date.getTime() < before.receivedDate.getTime()
      ) {
        throw new BadRequestException(PAYMENT_BEFORE_RECEPTION);
      }
      const amount = new Decimal(dto.amount);
      const remaining = remainingOf(
        linesAmount(before.items),
        before.payments.map((p) => p.amount),
      );
      if (amount.gt(remaining)) throw new BadRequestException(OVERPAID);
      const payment = await tx.supplierPayment.create({
        data: {
          farmId: before.farmId,
          purchaseId: id,
          date,
          amount,
          method: dto.method,
          reference: dto.reference ?? null,
          createdById: ctx.user.id,
        },
      });
      const next = statusAfter('pay', { settled: amount.eq(remaining) });
      if (next !== before.status) {
        await tx.purchase.update({ where: { id }, data: { status: next } });
      }
      const after = toDetail(await this.load(tx, ctx, id));
      await this.log(
        tx,
        ctx,
        'CREATE',
        payment.id,
        `${after.reference} · paiement`,
        before.farmId,
        undefined,
        {
          purchaseId: id,
          date: dto.date,
          amount: amount.toNumber(),
          method: dto.method,
          reference: payment.reference,
          status: after.status,
          remaining: after.remaining,
        },
      );
      return after;
    });
  }

  removePayment(
    ctx: RequestContext,
    id: string,
    paymentId: string,
  ): Promise<PurchaseDetail> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      const payment = before.payments.find((p) => p.id === paymentId);
      if (!payment) throw new NotFoundException(PAYMENT_NOT_FOUND);
      if (!can(before.status, 'unpay')) this.refuse('unpay');
      await tx.supplierPayment.delete({ where: { id: paymentId } });
      const next = statusAfter('unpay');
      if (next !== before.status) {
        await tx.purchase.update({ where: { id }, data: { status: next } });
      }
      const after = toDetail(await this.load(tx, ctx, id));
      await this.log(
        tx,
        ctx,
        'DELETE',
        paymentId,
        `${after.reference} · paiement`,
        before.farmId,
        {
          purchaseId: id,
          date: formatDay(payment.date),
          amount: payment.amount.toNumber(),
          method: payment.method,
          reference: payment.reference,
          status: before.status,
        },
        { status: after.status, remaining: after.remaining },
      );
      return after;
    });
  }
}
