import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SettingsService } from '../admin/settings/settings.service';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import {
  assertNotFuture,
  formatDayOrNull,
  requireDay,
  today,
} from '../common/days';
import { lockRow } from '../common/lock-row';
import { toMoney } from '../common/money';
import { FinanceLedger } from '../finance/finance-ledger';
import type { Prisma } from '../generated/prisma/client';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { OPEN_STATUSES } from '../tasks/task-workflow';
import type {
  BreakdownDto,
  CreateEquipmentDto,
  EquipmentQueryDto,
  RetireDto,
  UpdateEquipmentDto,
} from './dto/equipment.dto';
import { refreshNextMaintenance } from './equipment-cache';
import {
  CONDITION_LIST,
  conditionGuard,
  type ConditionValue,
} from './equipment-state';
import {
  equipmentInclude,
  equipmentSnapshot,
  maintenanceInclude,
  toBreakdownItem,
  toEquipmentItem,
  toMaintenanceItem,
  type BreakdownItem,
  type EquipmentItem,
  type EquipmentRecord,
  type MaintenanceItem,
} from './equipment-view';

type Tx = Prisma.TransactionClient;

export const EQUIPMENT_NOT_FOUND = 'Équipement introuvable';
export const EQUIPMENT_RETIRED = 'Équipement réformé';
const NAME_TAKEN = 'Un équipement porte déjà ce nom dans cette ferme';
const BOTH_LOCATIONS = 'Indiquez un site ou un bâtiment, pas les deux';
const SITE_INVALID = 'Site invalide pour cette ferme';
const BUILDING_INVALID = 'Bâtiment invalide pour cette ferme';
const LOCATION_INVALID = 'Emplacement invalide pour cette ferme';
const OPEN_TASKS = 'Des tâches ouvertes portent sur cet équipement';
const RETIRE_BEFORE_PURCHASE =
  "La date de réforme précède l'achat de l'équipement";
const RETIRE_BEFORE_LAST =
  'La date de réforme précède la dernière intervention ou panne';
const HAS_HISTORY = 'Cet équipement a un historique : réformez-le';
const ALREADY_BROKEN = 'Une panne est déjà déclarée pour cet équipement';
const BEFORE_PURCHASE = "La date précède l'achat de l'équipement";
const NOT_RETIRED = "Cet équipement n'est pas réformé";
const SORTABLE = ['name', 'nextMaintenance'];

const blank = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === '' ? null : value;

export interface EquipmentDetail extends EquipmentItem {
  brand: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  firstMaintenanceDate: string | null;
  note: string | null;
  interventions: MaintenanceItem[];
  breakdowns: BreakdownItem[];
  /** Open tasks (to do or in progress) about the equipment. */
  openTasks: number;
  /** Σ of its maintenance expenses in the finance ledger; `null` without `finance:read`. */
  maintenanceCost: number | null;
}

/**
 * Equipment is farm master data (`update` on `equipements` writes it);
 * declaring a breakdown is a daily entry (`create`). Every write locks the
 * equipment row first and refuses a retired equipment.
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly ledger: FinanceLedger,
  ) {}

  /* ------------------------------------------------------------ reads */

  private where(
    ctx: RequestContext,
    q: EquipmentQueryDto,
    scope: { status: boolean; retired: boolean },
  ): Prisma.EquipmentWhereInput {
    const and: Prisma.EquipmentWhereInput[] = [];
    and.push(
      scope.retired && q.retired === 'true'
        ? { retiredAt: { not: null } }
        : { retiredAt: null },
    );
    if (scope.status && q.status) {
      and.push({ condition: q.status as ConditionValue });
    }
    if (q.type) and.push({ type: q.type });
    if (q.search) {
      and.push({
        OR: [
          { name: containsInsensitive(q.search) },
          { brand: containsInsensitive(q.search) },
          { serialNumber: containsInsensitive(q.search) },
        ],
      });
    }
    return { farmId: { in: ctx.farmIds }, AND: and };
  }

  private order(
    q: EquipmentQueryDto,
  ): Prisma.EquipmentOrderByWithRelationInput[] {
    const chosen = orderBy(q, SORTABLE, { name: 'asc' });
    const lead: Prisma.EquipmentOrderByWithRelationInput[] = [];
    if ('nextMaintenance' in chosen) {
      lead.push({
        nextMaintenanceDate: { sort: chosen.nextMaintenance, nulls: 'last' },
      });
    }
    if ('name' in chosen) lead.push({ name: chosen.name });
    return [...lead, { name: 'asc' }, { id: 'asc' }];
  }

  listArgs(ctx: RequestContext, q: EquipmentQueryDto) {
    if (q.status && !CONDITION_LIST.includes(q.status as ConditionValue)) {
      throw new BadRequestException('Statut invalide');
    }
    const where = this.where(ctx, q, { status: true, retired: true });
    const order = this.order(q);
    const day = today();
    return {
      find: async (range: { skip?: number; take: number }) => {
        const warningDays = await this.warningDays(ctx);
        const rows = await this.prisma.equipment.findMany({
          where,
          include: equipmentInclude,
          relationLoadStrategy: 'join',
          orderBy: order,
          ...range,
        });
        return rows.map((e) => toEquipmentItem(e, day, warningDays));
      },
      count: () => this.prisma.equipment.count({ where }),
      /** The equipment in service, over the other filters (the status filter itself is left out). */
      statusCounts: async () => {
        const groups = await this.prisma.equipment.groupBy({
          by: ['condition'],
          where: this.where(ctx, q, { status: false, retired: false }),
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          CONDITION_LIST.map((c) => [c, 0]),
        ) as Record<ConditionValue, number>;
        for (const g of groups) counts[g.condition] = g._count._all;
        return { statusCounts: counts };
      },
    };
  }

  private warningDays(ctx: RequestContext): Promise<number> {
    return this.settings.number(
      ctx.user.organizationId,
      'maintenanceWarningDays',
    );
  }

  private async find(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<EquipmentRecord> {
    const row = await client.equipment.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: equipmentInclude,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(EQUIPMENT_NOT_FOUND);
    return row;
  }

  /** The row under its lock (404 when it is not one of the request's farms), never a retired one. */
  private async lockActive(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<EquipmentRecord> {
    await this.find(tx, ctx, id);
    await lockRow(tx, 'Equipment', id, ctx.farmIds);
    const row = await this.find(tx, ctx, id);
    if (row.retiredAt) throw new ConflictException(EQUIPMENT_RETIRED);
    return row;
  }

  async get(ctx: RequestContext, id: string): Promise<EquipmentDetail> {
    const row = await this.find(this.prisma, ctx, id);
    const withCost = can(ctx.user.role, 'finance', 'read');
    const [interventions, breakdowns, openTasks, totals, warningDays] =
      await Promise.all([
        this.prisma.maintenance.findMany({
          where: { equipmentId: id, farmId: { in: ctx.farmIds } },
          include: maintenanceInclude,
          relationLoadStrategy: 'join',
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        }),
        this.prisma.breakdown.findMany({
          where: { equipmentId: id, farmId: { in: ctx.farmIds } },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        }),
        this.prisma.task.count({
          where: { equipmentId: id, status: { in: OPEN_STATUSES } },
        }),
        withCost
          ? this.ledger.totals({
              farmIds: ctx.farmIds,
              origin: 'MAINTENANCE',
              equipmentId: id,
            })
          : null,
        this.warningDays(ctx),
      ]);
    return {
      ...toEquipmentItem(row, today(), warningDays),
      brand: row.brand,
      serialNumber: row.serialNumber,
      purchaseDate: formatDayOrNull(row.purchaseDate),
      firstMaintenanceDate: formatDayOrNull(row.firstMaintenanceDate),
      note: row.note,
      interventions: interventions.map((m) => toMaintenanceItem(m, withCost)),
      breakdowns: breakdowns.map(toBreakdownItem),
      openTasks,
      maintenanceCost: totals ? toMoney(totals.expenses) : null,
    };
  }

  /* ------------------------------------------------------- body checks */

  /** Either a site or a building of the request's farm (or none). */
  private async assertLocation(
    tx: Tx,
    ctx: RequestContext,
    next: { siteId: string | null; buildingId: string | null },
    before: { siteId: string | null; buildingId: string | null } | null,
  ): Promise<void> {
    if (next.siteId && next.buildingId) {
      throw new BadRequestException(BOTH_LOCATIONS);
    }
    const farmId = ctx.farmId as string;
    if (next.siteId && next.siteId !== before?.siteId) {
      const site = await tx.site.findFirst({
        where: { id: next.siteId, farmId },
        select: { id: true },
      });
      if (!site) throw new BadRequestException(SITE_INVALID);
    }
    if (next.buildingId && next.buildingId !== before?.buildingId) {
      const building = await tx.building.findFirst({
        where: { id: next.buildingId, farmId },
        select: { id: true },
      });
      if (!building) throw new BadRequestException(BUILDING_INVALID);
    }
  }

  private async assertNameFree(
    client: Tx | PrismaService,
    ctx: RequestContext,
    name: string,
    id: string | null,
  ): Promise<void> {
    const taken = await client.equipment.findFirst({
      where: {
        farmId: ctx.farmId as string,
        name,
        ...(id ? { id: { not: id } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw new ConflictException(NAME_TAKEN);
  }

  /**
   * A lost race on the unique name answers with the name message; a foreign
   * key (a site or building deleted meanwhile) with the location message.
   */
  private async write<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'P2002') throw new ConflictException(NAME_TAKEN);
      if (code === 'P2003') throw new BadRequestException(LOCATION_INVALID);
      throw error;
    }
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    before: EquipmentRecord | undefined,
    after: EquipmentRecord | undefined,
  ) {
    const row = (after ?? before) as EquipmentRecord;
    return this.audit.logChange(
      {
        ctx,
        farmId: row.farmId,
        module: 'equipements',
        action,
        recordId: row.id,
        label: row.name,
        before: before && equipmentSnapshot(before),
        after: after && equipmentSnapshot(after),
      },
      tx,
    );
  }

  /** The row as the writes answer it. */
  private async item(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<EquipmentItem> {
    return toEquipmentItem(
      await this.find(tx, ctx, id),
      today(),
      await this.warningDays(ctx),
    );
  }

  /* ------------------------------------------------------------ writes */

  create(ctx: RequestContext, dto: CreateEquipmentDto): Promise<EquipmentItem> {
    const siteId = blank(dto.siteId);
    const buildingId = blank(dto.buildingId);
    const purchaseDate = dto.purchaseDate ? requireDay(dto.purchaseDate) : null;
    if (purchaseDate) assertNotFuture(purchaseDate);
    const first = dto.firstMaintenanceDate
      ? requireDay(dto.firstMaintenanceDate)
      : null;
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertLocation(tx, ctx, { siteId, buildingId }, null);
        await this.assertNameFree(tx, ctx, dto.name, null);
        const created = await tx.equipment.create({
          data: {
            farmId: ctx.farmId as string,
            name: dto.name,
            type: dto.type,
            siteId,
            buildingId,
            brand: blank(dto.brand),
            serialNumber: blank(dto.serialNumber),
            purchaseDate,
            maintenanceIntervalDays: blank(dto.maintenanceIntervalDays),
            firstMaintenanceDate: first,
            nextMaintenanceDate: first,
            note: blank(dto.note),
          },
          include: equipmentInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'CREATE', undefined, created);
        return toEquipmentItem(created, today(), await this.warningDays(ctx));
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateEquipmentDto,
  ): Promise<EquipmentItem> {
    const purchaseDate =
      dto.purchaseDate === undefined
        ? undefined
        : dto.purchaseDate === null
          ? null
          : requireDay(dto.purchaseDate);
    if (purchaseDate) assertNotFuture(purchaseDate);
    const first =
      dto.firstMaintenanceDate === undefined
        ? undefined
        : dto.firstMaintenanceDate === null
          ? null
          : requireDay(dto.firstMaintenanceDate);
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lockActive(tx, ctx, id);
        if (dto.condition !== undefined) {
          conditionGuard(before.condition, dto.condition);
        }
        const siteId =
          dto.siteId === undefined ? before.siteId : blank(dto.siteId);
        const buildingId =
          dto.buildingId === undefined
            ? before.buildingId
            : blank(dto.buildingId);
        await this.assertLocation(tx, ctx, { siteId, buildingId }, before);
        if (dto.name !== undefined && dto.name !== before.name) {
          await this.assertNameFree(tx, ctx, dto.name, id);
        }
        const interval =
          dto.maintenanceIntervalDays === undefined
            ? undefined
            : blank(dto.maintenanceIntervalDays);
        await tx.equipment.update({
          where: { id },
          data: {
            name: dto.name,
            type: dto.type,
            siteId,
            buildingId,
            purchaseDate,
            firstMaintenanceDate: first,
            maintenanceIntervalDays: interval,
            condition: dto.condition,
            ...(dto.brand !== undefined ? { brand: blank(dto.brand) } : {}),
            ...(dto.serialNumber !== undefined
              ? { serialNumber: blank(dto.serialNumber) }
              : {}),
            ...(dto.note !== undefined ? { note: blank(dto.note) } : {}),
          },
        });
        if (interval !== undefined || first !== undefined) {
          await refreshNextMaintenance(tx, id);
        }
        const after = await this.find(tx, ctx, id);
        await this.log(tx, ctx, 'UPDATE', before, after);
        return toEquipmentItem(after, today(), await this.warningDays(ctx));
      }),
    );
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await this.lockActive(tx, ctx, id);
        const [maintenances, breakdowns, tasks] = await Promise.all([
          tx.maintenance.count({ where: { equipmentId: id } }),
          tx.breakdown.count({ where: { equipmentId: id } }),
          tx.task.count({ where: { equipmentId: id } }),
        ]);
        if (maintenances + breakdowns + tasks > 0) {
          throw new ConflictException(HAS_HISTORY);
        }
        await tx.equipment.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, undefined);
      });
    } catch (error) {
      // A record written meanwhile (an intervention, a breakdown, a task).
      if ((error as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(HAS_HISTORY);
      }
      throw error;
    }
  }

  retire(
    ctx: RequestContext,
    id: string,
    dto: RetireDto,
  ): Promise<EquipmentItem> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockActive(tx, ctx, id);
      if (
        before.purchaseDate &&
        date.getTime() < before.purchaseDate.getTime()
      ) {
        throw new BadRequestException(RETIRE_BEFORE_PURCHASE);
      }
      const [lastIntervention, lastBreakdown] = await Promise.all([
        tx.maintenance.aggregate({
          where: { equipmentId: id },
          _max: { date: true },
        }),
        tx.breakdown.aggregate({
          where: { equipmentId: id },
          _max: { date: true },
        }),
      ]);
      for (const last of [
        lastIntervention._max.date,
        lastBreakdown._max.date,
      ]) {
        if (last && date.getTime() < last.getTime()) {
          throw new BadRequestException(RETIRE_BEFORE_LAST);
        }
      }
      // The equipment row is locked: a task created on it waits, then sees it retired.
      const openTasks = await tx.task.count({
        where: { equipmentId: id, status: { in: OPEN_STATUSES } },
      });
      if (openTasks > 0) throw new ConflictException(OPEN_TASKS);
      await tx.equipment.update({ where: { id }, data: { retiredAt: date } });
      await this.log(tx, ctx, 'UPDATE', before, await this.find(tx, ctx, id));
      return this.item(tx, ctx, id);
    });
  }

  reinstate(ctx: RequestContext, id: string): Promise<EquipmentItem> {
    return this.prisma.$transaction(async (tx) => {
      await this.find(tx, ctx, id);
      await lockRow(tx, 'Equipment', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      if (!before.retiredAt) throw new ConflictException(NOT_RETIRED);
      await tx.equipment.update({ where: { id }, data: { retiredAt: null } });
      await this.log(tx, ctx, 'UPDATE', before, await this.find(tx, ctx, id));
      return this.item(tx, ctx, id);
    });
  }

  /**
   * Declares a breakdown (a daily entry): the equipment becomes `EN_PANNE`
   * until a corrective intervention repairs it. One open breakdown at most.
   */
  declareBreakdown(
    ctx: RequestContext,
    id: string,
    dto: BreakdownDto,
  ): Promise<BreakdownItem> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const equipment = await this.lockActive(tx, ctx, id);
      if (
        equipment.purchaseDate &&
        date.getTime() < equipment.purchaseDate.getTime()
      ) {
        throw new BadRequestException(BEFORE_PURCHASE);
      }
      if (equipment.breakdowns.some((b) => b.resolvedDate === null)) {
        throw new ConflictException(ALREADY_BROKEN);
      }
      const created = await tx.breakdown.create({
        data: {
          farmId: equipment.farmId,
          equipmentId: id,
          date,
          description: dto.description,
          reportedById: ctx.user.id,
        },
      });
      await tx.equipment.update({
        where: { id },
        data: { condition: 'EN_PANNE' },
      });
      await this.audit.logChange(
        {
          ctx,
          farmId: equipment.farmId,
          module: 'equipements',
          action: 'CREATE',
          recordId: created.id,
          label: `${equipment.name} — ${dto.description}`,
          after: {
            equipmentId: id,
            date: dto.date,
            description: dto.description,
          },
        },
        tx,
      );
      return toBreakdownItem(created);
    });
  }
}
