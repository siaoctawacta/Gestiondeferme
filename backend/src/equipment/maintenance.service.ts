import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { assertNotFuture, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateMaintenanceDto,
  MaintenanceQueryDto,
  UpdateMaintenanceDto,
} from './dto/equipment.dto';
import { refreshNextMaintenance } from './equipment-cache';
import { EQUIPMENT_RETIRED } from './equipment.service';
import {
  maintenanceInclude,
  maintenanceSnapshot,
  toMaintenanceItem,
  type MaintenanceItem,
  type MaintenanceRecord,
} from './equipment-view';

type Tx = Prisma.TransactionClient;

export const MAINTENANCE_NOT_FOUND = 'Intervention introuvable';
const EQUIPMENT_INVALID = 'Équipement invalide pour cette ferme';
const SUPPLIER_INVALID = 'Fournisseur invalide';
const NOT_CORRECTIVE = 'Seule une intervention corrective répare une panne';
const NO_OPEN_BREAKDOWN = 'Aucune panne ouverte sur cet équipement';
const BEFORE_BREAKDOWN = "L'intervention précède la panne";
const OTHER_OPEN = "Une autre panne est ouverte : réparez-la d'abord";
const AFTER_WITHOUT_REPAIR =
  "L'état après intervention suppose la réparation d'une panne";
const REPAIR_STAYS_CORRECTIVE =
  'Cette intervention répare une panne : elle reste corrective';
const BEFORE_PURCHASE = "La date précède l'achat de l'équipement";
const RACE = "L'équipement a été modifié en même temps : réessayez";
const NEXT_AFTER = "La prochaine date doit suivre la date de l'intervention";
const SORTABLE = ['date'];

const blank = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === '' ? null : value;

/**
 * Interventions are master data of `equipements` (`update` writes them). Lock
 * order: the equipment row, then the intervention row, then the breakdown
 * row. The equipment's cached next maintenance is recomputed under its lock
 * on every write. The cost is a finance figure: read and written only with
 * `finance:read` (otherwise hidden and ignored).
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private withCost = (ctx: RequestContext): boolean =>
    can(ctx.user.role, 'finance', 'read');

  /* ------------------------------------------------------------ reads */

  private where(
    ctx: RequestContext,
    q: MaintenanceQueryDto,
  ): Prisma.MaintenanceWhereInput {
    const and: Prisma.MaintenanceWhereInput[] = [];
    if (q.equipmentId) and.push({ equipmentId: q.equipmentId });
    if (q.kind) and.push({ kind: q.kind });
    if (q.from) and.push({ date: { gte: requireDay(q.from) } });
    if (q.to) and.push({ date: { lte: requireDay(q.to) } });
    if (q.search) {
      and.push({
        OR: [
          { description: containsInsensitive(q.search) },
          { performedBy: containsInsensitive(q.search) },
          { equipment: { name: containsInsensitive(q.search) } },
          { supplier: { name: containsInsensitive(q.search) } },
        ],
      });
    }
    return { farmId: { in: ctx.farmIds }, ...(and.length ? { AND: and } : {}) };
  }

  listArgs(ctx: RequestContext, q: MaintenanceQueryDto) {
    const where = this.where(ctx, q);
    const chosen = orderBy(q, SORTABLE, { date: 'desc' });
    const withCost = this.withCost(ctx);
    return {
      withCost,
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.maintenance.findMany({
            where,
            include: maintenanceInclude,
            relationLoadStrategy: 'join',
            orderBy: [
              { date: chosen.date },
              { createdAt: chosen.date },
              { id: 'asc' },
            ],
            ...range,
          })
        ).map((m) => toMaintenanceItem(m, withCost)),
      count: () => this.prisma.maintenance.count({ where }),
    };
  }

  private async find(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<MaintenanceRecord> {
    const row = await client.maintenance.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: maintenanceInclude,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(MAINTENANCE_NOT_FOUND);
    return row;
  }

  /* ------------------------------------------------------- body checks */

  private async assertSupplier(
    tx: Tx,
    ctx: RequestContext,
    supplierId: string,
  ): Promise<void> {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, organizationId: ctx.user.organizationId },
      select: { id: true },
    });
    if (!supplier) throw new BadRequestException(SUPPLIER_INVALID);
  }

  /**
   * The equipment row under its lock, never retired. A row deleted or never
   * there (another farm's included) is `missing`: a body id is a 400, the
   * equipment of a stored intervention cannot be missing.
   */
  private async lockEquipment(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    missing: () => Error = () => new NotFoundException(MAINTENANCE_NOT_FOUND),
  ) {
    await lockRow(tx, 'Equipment', id, ctx.farmIds);
    const equipment = await tx.equipment.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      select: { id: true, farmId: true, retiredAt: true, purchaseDate: true },
    });
    if (!equipment) throw missing();
    if (equipment.retiredAt) throw new ConflictException(EQUIPMENT_RETIRED);
    return equipment;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    before: MaintenanceRecord | undefined,
    after: MaintenanceRecord | undefined,
  ) {
    const row = (after ?? before) as MaintenanceRecord;
    return this.audit.logChange(
      {
        ctx,
        farmId: row.farmId,
        module: 'equipements',
        action,
        recordId: row.id,
        label: `${row.equipment.name} — ${row.description}`,
        before: before && maintenanceSnapshot(before),
        after: after && maintenanceSnapshot(after),
      },
      tx,
    );
  }

  /** A lost race on a unique index or a foreign key: one clear message (never the generic name-taken one). */
  private race<T>(run: () => Promise<T>): Promise<T> {
    return orConflict(run, RACE);
  }

  private cost(ctx: RequestContext, value: number | null | undefined) {
    if (!this.withCost(ctx) || value === undefined) return undefined;
    return new Decimal(value ?? 0);
  }

  /* ------------------------------------------------------------ writes */

  create(
    ctx: RequestContext,
    dto: CreateMaintenanceDto,
  ): Promise<MaintenanceItem> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    const nextDate = dto.nextDate ? requireDay(dto.nextDate) : null;
    if (nextDate && nextDate.getTime() <= date.getTime()) {
      throw new BadRequestException(NEXT_AFTER);
    }
    const repairs = dto.repairsBreakdown === true;
    if (repairs && dto.kind !== 'CORRECTIVE') {
      throw new BadRequestException(NOT_CORRECTIVE);
    }
    if (!repairs && dto.conditionAfter) {
      throw new BadRequestException(AFTER_WITHOUT_REPAIR);
    }
    const supplierId = blank(dto.supplierId);
    return this.race(() =>
      this.prisma.$transaction(async (tx) => {
        const equipment = await this.lockEquipment(
          tx,
          ctx,
          dto.equipmentId,
          () => new BadRequestException(EQUIPMENT_INVALID),
        );
        if (
          equipment.purchaseDate &&
          date.getTime() < equipment.purchaseDate.getTime()
        ) {
          throw new BadRequestException(BEFORE_PURCHASE);
        }
        if (supplierId) await this.assertSupplier(tx, ctx, supplierId);
        const open = repairs
          ? await tx.breakdown.findFirst({
              where: { equipmentId: equipment.id, resolvedDate: null },
              select: { id: true, date: true },
            })
          : null;
        if (repairs) {
          if (!open) throw new ConflictException(NO_OPEN_BREAKDOWN);
          if (date.getTime() < open.date.getTime()) {
            throw new BadRequestException(BEFORE_BREAKDOWN);
          }
        }
        const created = await tx.maintenance.create({
          data: {
            farmId: equipment.farmId,
            equipmentId: equipment.id,
            kind: dto.kind,
            date,
            description: dto.description,
            performedBy: blank(dto.performedBy),
            supplierId,
            cost: this.cost(ctx, dto.cost) ?? new Decimal(0),
            nextDate,
            createdById: ctx.user.id,
          },
        });
        if (open) {
          await lockRow(tx, 'Breakdown', open.id, ctx.farmIds);
          await tx.breakdown.update({
            where: { id: open.id },
            data: { repairId: created.id, resolvedDate: date },
          });
          await tx.equipment.update({
            where: { id: equipment.id },
            data: { condition: dto.conditionAfter ?? 'BON' },
          });
        }
        await refreshNextMaintenance(tx, equipment.id);
        const after = await this.find(tx, ctx, created.id);
        await this.log(tx, ctx, 'CREATE', undefined, after);
        return toMaintenanceItem(after, this.withCost(ctx));
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateMaintenanceDto,
  ): Promise<MaintenanceItem> {
    const date = dto.date ? requireDay(dto.date) : undefined;
    if (date) assertNotFuture(date);
    const nextDate =
      dto.nextDate === undefined
        ? undefined
        : dto.nextDate === null
          ? null
          : requireDay(dto.nextDate);
    const supplierId =
      dto.supplierId === undefined ? undefined : blank(dto.supplierId);
    return this.race(() =>
      this.prisma.$transaction(async (tx) => {
        const found = await this.find(tx, ctx, id);
        const equipment = await this.lockEquipment(tx, ctx, found.equipmentId);
        await lockRow(tx, 'Maintenance', id, ctx.farmIds);
        const before = await this.find(tx, ctx, id);
        if (
          date &&
          equipment.purchaseDate &&
          date.getTime() < equipment.purchaseDate.getTime()
        ) {
          throw new BadRequestException(BEFORE_PURCHASE);
        }
        const repaired = before.repairs
          ? await tx.breakdown.findUniqueOrThrow({
              where: { id: before.repairs.id },
              select: { id: true, date: true },
            })
          : null;
        if (repaired) await lockRow(tx, 'Breakdown', repaired.id, ctx.farmIds);
        const kind = dto.kind ?? before.kind;
        const day = date ?? before.date;
        const next = nextDate === undefined ? before.nextDate : nextDate;
        if (next && next.getTime() <= day.getTime()) {
          throw new BadRequestException(NEXT_AFTER);
        }
        if (repaired) {
          if (kind !== 'CORRECTIVE') {
            throw new ConflictException(REPAIR_STAYS_CORRECTIVE);
          }
          if (day.getTime() < repaired.date.getTime()) {
            throw new BadRequestException(BEFORE_BREAKDOWN);
          }
        }
        if (supplierId && supplierId !== before.supplierId) {
          await this.assertSupplier(tx, ctx, supplierId);
        }
        await tx.maintenance.update({
          where: { id },
          data: {
            kind: dto.kind,
            date,
            description: dto.description,
            supplierId,
            nextDate,
            cost: this.cost(ctx, dto.cost),
            ...(dto.performedBy !== undefined
              ? { performedBy: blank(dto.performedBy) }
              : {}),
          },
        });
        if (repaired && date) {
          await tx.breakdown.update({
            where: { id: repaired.id },
            data: { resolvedDate: date },
          });
        }
        await refreshNextMaintenance(tx, before.equipmentId);
        const after = await this.find(tx, ctx, id);
        await this.log(tx, ctx, 'UPDATE', before, after);
        return toMaintenanceItem(after, this.withCost(ctx));
      }),
    );
  }

  /**
   * Deleting the intervention that repaired a breakdown reopens it (the
   * equipment is `EN_PANNE` again), unless another breakdown is open meanwhile.
   */
  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      await this.lockEquipment(tx, ctx, found.equipmentId);
      await lockRow(tx, 'Maintenance', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      if (before.repairs) {
        await lockRow(tx, 'Breakdown', before.repairs.id, ctx.farmIds);
        const other = await tx.breakdown.findFirst({
          where: { equipmentId: before.equipmentId, resolvedDate: null },
          select: { id: true },
        });
        if (other) throw new ConflictException(OTHER_OPEN);
        await tx.breakdown.update({
          where: { id: before.repairs.id },
          data: { repairId: null, resolvedDate: null },
        });
        await tx.equipment.update({
          where: { id: before.equipmentId },
          data: { condition: 'EN_PANNE' },
        });
      }
      await tx.maintenance.delete({ where: { id } });
      await refreshNextMaintenance(tx, before.equipmentId);
      await this.log(tx, ctx, 'DELETE', before, undefined);
    });
  }
}
