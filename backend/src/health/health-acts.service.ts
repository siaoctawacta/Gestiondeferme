import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { requireDay, today } from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { HealthActStatus } from '../generated/prisma/enums';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompleteHealthActDto,
  CreateHealthActDto,
  HealthActQueryDto,
  UpdateHealthActDto,
} from './dto/health-act.dto';
import {
  ACT_STATUSES,
  actInclude,
  actTypeLabel,
  OPEN_TARGET,
  overdueActWhere,
  toActItem,
  type ActRow,
  type ActStatus,
  type HealthActItem,
} from './health-act-view';
import { HealthStock } from './health-stock';
import { HealthTargets } from './health-targets';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'Intervention introuvable';
const CANCELLED = 'Cette intervention est annulée';
const ALREADY_DONE = 'Cette intervention est déjà réalisée';
const NEED_BUILDING = 'Indiquez le bâtiment à désinfecter';
const BUILDING_ONLY =
  'Une désinfection cible un bâtiment, pas un lot ni un animal';
const NEED_LOT_OR_ANIMAL = 'Indiquez un lot ou un animal';
const NO_BUILDING =
  'Cette intervention cible un lot ou un animal, pas un bâtiment';
const QUANTITY_NEEDS_PRODUCT = 'La quantité suppose un produit en stock';
const BATCH_NEEDS_QUANTITY =
  "Le lot de produit s'indique pour une intervention réalisée avec un produit en stock et une quantité";
const ITEM_FIXED =
  "Le produit d'une intervention réalisée ne peut pas être changé : supprimez-la et recréez-la";
const DONE_DATE =
  'Une intervention saisie réalisée a une seule date : le jour de sa réalisation';
const ENTERED_DONE =
  'Cette intervention a été saisie réalisée : modifiez sa date';
const SORTABLE = ['date', 'status', 'type', 'createdAt'];

/** An empty text is no text. */
const blank = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === '' ? null : value;

/**
 * Health acts: vaccinations, treatments, disinfections and diagnoses on one
 * lot, animal or building. A done act with a stock article and a quantity
 * consumes stock (`HealthStock`).
 *
 * Statuses: `PLANIFIE`, `REALISE` and `ANNULE` are stored; `EN_RETARD` is
 * derived (planned and dated before today, the server's UTC day).
 *
 * Lock order of every write (see `HealthStock`): the lot or animal, the act
 * row, the ledger. Create inserts the act after locking its target; edit,
 * delete, complete and cancel find the act, lock its target, lock the act, then
 * read it again under the lock before deciding anything.
 */
@Injectable()
export class HealthActsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: HealthTargets,
    private readonly stock: HealthStock,
  ) {}

  private scope(ctx: RequestContext): Prisma.HealthActWhereInput {
    return {
      farmId: { in: ctx.farmIds },
      AND: [this.targets.visibleBatch(ctx), this.targets.visibleAnimal(ctx)],
    };
  }

  /** The where clause of a stored or derived status. */
  private statusWhere(
    status: ActStatus,
    now: Date,
  ): Prisma.HealthActWhereInput {
    // Late = planned, dated before today, on a target that is still open: a
    // planned act on a closed lot or an exited animal waits as PLANIFIE.
    if (status === 'PLANIFIE') {
      return {
        status,
        OR: [{ date: { gte: now } }, { NOT: OPEN_TARGET }],
      };
    }
    if (status === 'EN_RETARD') {
      return overdueActWhere(now);
    }
    return { status };
  }

  private filters(
    ctx: RequestContext,
    q: HealthActQueryDto,
  ): Prisma.HealthActWhereInput {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    return {
      ...this.scope(ctx),
      ...(q.type ? { type: q.type } : {}),
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.animalId ? { animalId: q.animalId } : {}),
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search
        ? {
            OR: [
              { batch: { code: containsInsensitive(q.search) } },
              { animal: { tag: containsInsensitive(q.search) } },
              { building: { name: containsInsensitive(q.search) } },
              { productName: containsInsensitive(q.search) },
              { veterinarian: containsInsensitive(q.search) },
            ],
          }
        : {}),
    };
  }

  listArgs(ctx: RequestContext, q: HealthActQueryDto) {
    if (q.status && !ACT_STATUSES.includes(q.status as ActStatus)) {
      throw new BadRequestException('Statut invalide');
    }
    const now = today();
    const filters = this.filters(ctx, q);
    const where: Prisma.HealthActWhereInput = q.status
      ? { AND: [filters, this.statusWhere(q.status as ActStatus, now)] }
      : filters;
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.healthAct.findMany({
            where,
            include: actInclude,
            relationLoadStrategy: 'join',
            orderBy: [
              order,
              ...(Object.hasOwn(order, 'date')
                ? []
                : [{ date: 'desc' as const }]),
              { createdAt: 'desc' },
              { id: 'asc' },
            ],
            ...range,
          })
        ).map((row) => toActItem(row, now)),
      count: () => this.prisma.healthAct.count({ where }),
      /** Per-status totals over every filter but the status, with the overdue acts split out of the planned ones. */
      statusCounts: async (): Promise<Record<ActStatus, number>> => {
        const [groups, overdue] = await Promise.all([
          this.prisma.healthAct.groupBy({
            by: ['status'],
            where: filters,
            _count: { _all: true },
          }),
          this.prisma.healthAct.count({
            where: { AND: [filters, this.statusWhere('EN_RETARD', now)] },
          }),
        ]);
        const counts: Record<ActStatus, number> = {
          PLANIFIE: 0,
          REALISE: 0,
          EN_RETARD: overdue,
          ANNULE: 0,
        };
        for (const g of groups) counts[g.status] = g._count._all;
        counts.PLANIFIE -= overdue;
        return counts;
      },
    };
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<ActRow> {
    const row = await tx.healthAct.findFirst({
      where: { id, ...this.scope(ctx) },
      include: actInclude,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    row: HealthActItem,
    before?: HealthActItem,
    after?: HealthActItem,
  ): Promise<void> {
    return this.audit.logChange(
      {
        ctx,
        module: 'sante',
        action,
        recordId: row.id,
        label: `${actTypeLabel(row.type)} · ${row.target} · ${row.date}`,
        before,
        after,
      },
      tx,
    );
  }

  /** The act's target is a building for a disinfection, exactly one lot or animal otherwise. */
  private assertTargetShape(dto: CreateHealthActDto): void {
    if (dto.type === 'DESINFECTION') {
      if (dto.batchId || dto.animalId)
        throw new BadRequestException(BUILDING_ONLY);
      if (!dto.buildingId) throw new BadRequestException(NEED_BUILDING);
      return;
    }
    if (dto.buildingId) throw new BadRequestException(NO_BUILDING);
    if (!dto.batchId === !dto.animalId) {
      throw new BadRequestException(NEED_LOT_OR_ANIMAL);
    }
  }

  async create(
    ctx: RequestContext,
    dto: CreateHealthActDto,
  ): Promise<HealthActItem> {
    this.assertTargetShape(dto);
    const planned = (dto.status ?? 'PLANIFIE') === 'PLANIFIE';
    if (planned && dto.doneDate) {
      throw new BadRequestException(
        "Une intervention planifiée n'a pas de date de réalisation",
      );
    }
    const date = requireDay(dto.date);
    if (!planned && dto.doneDate && dto.doneDate !== dto.date) {
      throw new BadRequestException(DONE_DATE);
    }
    // An act entered as done has one date: the day it was done.
    const doneDate = planned ? null : date;
    const quantity = blank(dto.quantity);
    const stockBatchId = blank(dto.stockBatchId);
    if (quantity !== null && !dto.stockItemId) {
      throw new BadRequestException(QUANTITY_NEEDS_PRODUCT);
    }
    if (stockBatchId && (planned || quantity === null)) {
      throw new BadRequestException(BATCH_NEEDS_QUANTITY);
    }
    return this.prisma.$transaction(async (tx) => {
      // A planned date may lie ahead; the day it was done may not.
      const target = await this.targets.resolve(
        tx,
        ctx,
        {
          batchId: dto.batchId,
          animalId: dto.animalId,
          buildingId: dto.buildingId,
        },
        doneDate ?? today(),
      );
      this.targets.assertNotBeforeStart(target, date);
      const product = dto.stockItemId
        ? await this.stock.assertProduct(tx, ctx, dto.stockItemId)
        : null;
      if (product && stockBatchId) {
        await this.stock.assertLot(tx, target.farmId, product.id, stockBatchId);
      }
      const created = await tx.healthAct.create({
        data: {
          farmId: target.farmId,
          date,
          type: dto.type,
          batchId: target.kind === 'LOT' ? target.id : null,
          animalId: target.kind === 'ANIMAL' ? target.id : null,
          buildingId: target.kind === 'BATIMENT' ? target.id : null,
          stockItemId: product?.id ?? null,
          stockBatchId,
          productName: blank(dto.productName) ?? product?.name ?? null,
          dose: blank(dto.dose),
          quantity,
          durationDays: blank(dto.durationDays),
          withdrawalDays: blank(dto.withdrawalDays),
          veterinarian: blank(dto.veterinarian),
          symptoms: blank(dto.symptoms),
          diagnosis: blank(dto.diagnosis),
          status: planned ? 'PLANIFIE' : 'REALISE',
          doneDate,
          enteredDone: !planned,
          note: blank(dto.note),
          createdById: ctx.user.id,
        },
        include: actInclude,
        relationLoadStrategy: 'join',
      });
      await this.stock.afterActChange(tx, ctx, null, created);
      const item = toActItem(created);
      await this.log(tx, ctx, 'CREATE', item, undefined, item);
      return item;
    });
  }

  /** Finds the act, locks its open target and then itself, and reads it again under the lock. */
  private async lock(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{
    before: ActRow;
    target: Awaited<ReturnType<HealthTargets['forRow']>>;
  }> {
    const found = await this.find(tx, ctx, id);
    const target = await this.targets.forRow(tx, ctx, found);
    await lockRow(tx, 'HealthAct', id, ctx.farmIds);
    return { before: await this.find(tx, ctx, id), target };
  }

  /**
   * For cancelling and deleting: an act that is not done (PLANIFIE, or already
   * ANNULE: no stock involved) may be dropped even when its lot is closed or
   * its animal gone, so the target is locked without requiring it open. A done
   * (REALISE) act still needs its target open.
   */
  private async lockToDrop(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<ActRow> {
    const found = await this.find(tx, ctx, id);
    if (found.status !== 'REALISE') await this.targets.lockAny(tx, ctx, found);
    else await this.targets.forRow(tx, ctx, found);
    await lockRow(tx, 'HealthAct', id, ctx.farmIds);
    const before = await this.find(tx, ctx, id);
    // It was completed while we waited for the locks: now the target must be open.
    if (found.status !== 'REALISE' && before.status === 'REALISE') {
      await this.targets.forRow(tx, ctx, before);
    }
    return before;
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateHealthActDto,
  ): Promise<HealthActItem> {
    return this.prisma.$transaction(async (tx) => {
      const { before, target } = await this.lock(tx, ctx, id);
      if (before.status === 'ANNULE') throw new ConflictException(CANCELLED);
      const isDone = before.status === 'REALISE';

      if (dto.doneDate !== undefined && !isDone) {
        throw new BadRequestException(
          'Seule une intervention réalisée a une date de réalisation',
        );
      }
      if (dto.doneDate !== undefined && before.enteredDone) {
        throw new BadRequestException(ENTERED_DONE);
      }
      const date = dto.date ? requireDay(dto.date) : before.date;
      if (dto.date) this.targets.assertNotBeforeStart(target, date);
      // Entered as done: the one date is the day it was done, and moves the
      // exit. Completed later: `date` is the plan, `doneDate` the exit.
      const doneDate = before.enteredDone
        ? dto.date
          ? date
          : before.doneDate
        : dto.doneDate
          ? requireDay(dto.doneDate)
          : before.doneDate;
      if (
        isDone &&
        doneDate &&
        doneDate.getTime() !== before.doneDate?.getTime()
      ) {
        this.targets.assertDate(target, doneDate);
      }

      let stockItemId = before.stockItemId;
      if (dto.stockItemId !== undefined) {
        if (isDone && (dto.stockItemId ?? null) !== before.stockItemId) {
          throw new BadRequestException(ITEM_FIXED);
        }
        stockItemId = dto.stockItemId ?? null;
      }
      const product =
        stockItemId && stockItemId !== before.stockItemId
          ? await this.stock.assertProduct(tx, ctx, stockItemId)
          : null;

      const quantity =
        dto.quantity === undefined ? before.quantity : dto.quantity;
      let stockBatchId =
        dto.stockBatchId === undefined ? before.stockBatchId : dto.stockBatchId;
      if (quantity === null) {
        if (dto.stockBatchId === undefined) stockBatchId = null;
      }
      if (quantity !== null && !stockItemId) {
        throw new BadRequestException(QUANTITY_NEEDS_PRODUCT);
      }
      if (stockBatchId && (!isDone || quantity === null)) {
        throw new BadRequestException(BATCH_NEEDS_QUANTITY);
      }
      if (stockBatchId && stockItemId && stockBatchId !== before.stockBatchId) {
        await this.stock.assertLot(
          tx,
          before.farmId,
          stockItemId,
          stockBatchId,
        );
      }

      const updated = await tx.healthAct.update({
        where: { id },
        data: {
          date,
          doneDate,
          stockItemId,
          stockBatchId,
          quantity,
          ...(dto.productName !== undefined
            ? { productName: blank(dto.productName) }
            : product && before.productName === null
              ? { productName: product.name }
              : {}),
          ...(dto.dose !== undefined ? { dose: blank(dto.dose) } : {}),
          ...(dto.durationDays !== undefined
            ? { durationDays: dto.durationDays }
            : {}),
          ...(dto.withdrawalDays !== undefined
            ? { withdrawalDays: dto.withdrawalDays }
            : {}),
          ...(dto.veterinarian !== undefined
            ? { veterinarian: blank(dto.veterinarian) }
            : {}),
          ...(dto.symptoms !== undefined
            ? { symptoms: blank(dto.symptoms) }
            : {}),
          ...(dto.diagnosis !== undefined
            ? { diagnosis: blank(dto.diagnosis) }
            : {}),
          ...(dto.note !== undefined ? { note: blank(dto.note) } : {}),
        },
        include: actInclude,
        relationLoadStrategy: 'join',
      });
      await this.stock.afterActChange(tx, ctx, before, updated);
      const was = toActItem(before);
      const item = toActItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockToDrop(tx, ctx, id);
      await tx.healthAct.delete({ where: { id } });
      await this.stock.afterActChange(tx, ctx, before, null);
      const was = toActItem(before);
      await this.log(tx, ctx, 'DELETE', was, was);
    });
  }

  /** Marks a planned act done on `doneDate`; the stock article and quantity may be given now. */
  complete(
    ctx: RequestContext,
    id: string,
    dto: CompleteHealthActDto,
  ): Promise<HealthActItem> {
    const doneDate = requireDay(dto.doneDate);
    return this.prisma.$transaction(async (tx) => {
      const { before, target } = await this.lock(tx, ctx, id);
      if (before.status === 'REALISE')
        throw new ConflictException(ALREADY_DONE);
      if (before.status === 'ANNULE') throw new ConflictException(CANCELLED);
      this.targets.assertDate(target, doneDate);

      if (
        dto.stockItemId &&
        before.stockItemId &&
        dto.stockItemId !== before.stockItemId
      ) {
        throw new BadRequestException(
          "Le produit de l'intervention ne peut pas être changé",
        );
      }
      const stockItemId = before.stockItemId ?? dto.stockItemId ?? null;
      // Active, veterinary article of the organisation, also when it was set at planning.
      const product = stockItemId
        ? await this.stock.assertProduct(tx, ctx, stockItemId)
        : null;
      const quantity = dto.quantity ?? before.quantity;
      if (quantity !== null && !stockItemId) {
        throw new BadRequestException(QUANTITY_NEEDS_PRODUCT);
      }
      const stockBatchId = blank(dto.stockBatchId);
      if (stockBatchId && quantity === null) {
        throw new BadRequestException(BATCH_NEEDS_QUANTITY);
      }
      if (stockItemId && stockBatchId) {
        await this.stock.assertLot(
          tx,
          before.farmId,
          stockItemId,
          stockBatchId,
        );
      }
      const updated = await tx.healthAct.update({
        where: { id },
        data: {
          status: 'REALISE' satisfies HealthActStatus,
          doneDate,
          stockItemId,
          quantity,
          stockBatchId,
          ...(product && before.productName === null
            ? { productName: product.name }
            : {}),
        },
        include: actInclude,
        relationLoadStrategy: 'join',
      });
      await this.stock.afterActChange(tx, ctx, before, updated);
      const was = toActItem(before);
      const item = toActItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }

  /** Cancels a planned or done act; a done act gives its stock back. */
  cancel(ctx: RequestContext, id: string): Promise<HealthActItem> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockToDrop(tx, ctx, id);
      if (before.status === 'ANNULE') throw new ConflictException(CANCELLED);
      const updated = await tx.healthAct.update({
        where: { id },
        data: { status: 'ANNULE', doneDate: null, stockBatchId: null },
        include: actInclude,
        relationLoadStrategy: 'join',
      });
      await this.stock.afterActChange(tx, ctx, before, updated);
      const was = toActItem(before);
      const item = toActItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }
}
