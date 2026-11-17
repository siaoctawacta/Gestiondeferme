import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { addDays, formatDay, today } from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { BatchType, Species } from '../generated/prisma/enums';
import { TYPE_LABEL } from '../herd/batches.service';
import { TYPES_BY_SPECIES } from '../herd/species';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ApplyPlanDto,
  CreatePlanDto,
  PlanItemDto,
  PlanQueryDto,
  UpdatePlanDto,
} from './dto/vaccination-plan.dto';
import {
  actInclude,
  actTypeLabel,
  toActItem,
  type HealthActItem,
} from './health-act-view';
import { HealthStock } from './health-stock';
import { HealthTargets } from './health-targets';

type Tx = Prisma.TransactionClient;

const include = {
  items: { orderBy: [{ ageDays: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.VaccinationPlanInclude;
type PlanRow = Prisma.VaccinationPlanGetPayload<{ include: typeof include }>;

export interface VaccinationPlanItem {
  id: string;
  name: string;
  species: Species;
  /** Lot type the plan is meant for; null = any type of the species. */
  type: BatchType | null;
  items: {
    ageDays: number;
    productName: string;
    stockItemId: string | null;
    dose: string | null;
  }[];
}

const NOT_FOUND = 'Plan vaccinal introuvable';
const APPLIED =
  'Ce plan a été appliqué à des lots : il ne peut pas être supprimé';
const ALREADY_APPLIED = 'Ce plan a déjà été appliqué à ce lot';
const WRONG_SPECIES = "Ce plan ne s'applique pas à cette espèce";
const FROZEN =
  'Ce plan a été appliqué à des lots : son espèce et son type ne peuvent plus changer';
const SORTABLE = ['name', 'species', 'createdAt'];

const toItem = (p: PlanRow): VaccinationPlanItem => ({
  id: p.id,
  name: p.name,
  species: p.species,
  type: p.type,
  items: p.items.map((i) => ({
    ageDays: i.ageDays,
    productName: i.productName,
    stockItemId: i.stockItemId,
    dose: i.dose,
  })),
});

export const PLAN_COLUMNS: ExportColumn<VaccinationPlanItem>[] = [
  { header: 'Nom', value: (p) => p.name },
  {
    header: 'Espèce',
    value: (p) => (p.species === 'AVICOLE' ? 'Avicole' : 'Porcin'),
  },
  { header: 'Type de lot', value: (p) => (p.type ? TYPE_LABEL[p.type] : null) },
  { header: 'Étapes', value: (p) => p.items.length },
];

const blank = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === '' ? null : value;

/**
 * Vaccination plans are organisation master data (not farm-scoped, written
 * under any farm header); `apply` is the only farm-scoped route: it stamps one
 * planned vaccination per step on a lot of the request's farm.
 *
 * Lock order of `apply`: the lot (`HealthTargets`), then the plan row. Plan
 * edits and deletes lock the plan alone.
 */
@Injectable()
export class VaccinationPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: HealthTargets,
    private readonly stock: HealthStock,
  ) {}

  listArgs(ctx: RequestContext, q: PlanQueryDto) {
    const where: Prisma.VaccinationPlanWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.species ? { species: q.species } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.search ? { name: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.vaccinationPlan.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.vaccinationPlan.count({ where }),
    };
  }

  private async find(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<PlanRow> {
    const row = await tx.vaccinationPlan.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    plan: PlanRow,
    before?: VaccinationPlanItem,
    after?: VaccinationPlanItem,
  ): Promise<void> {
    return this.audit.logChange(
      {
        ctx,
        module: 'sante',
        action,
        recordId: plan.id,
        label: plan.name,
        before,
        after,
      },
      tx,
    );
  }

  /** The type belongs to the species; every stock article is an active vaccine of the organisation. */
  private async assertContent(
    tx: Tx,
    ctx: RequestContext,
    species: Species,
    type: BatchType | null,
    items: PlanItemDto[] | undefined,
  ): Promise<void> {
    if (type && !TYPES_BY_SPECIES[species].includes(type)) {
      throw new BadRequestException('Type de lot invalide pour cette espèce');
    }
    const ids = [
      ...new Set(
        (items ?? []).flatMap((i) => (i.stockItemId ? [i.stockItemId] : [])),
      ),
    ].sort();
    for (const id of ids) {
      await this.stock.assertProduct(tx, ctx, id, ['VACCIN']);
    }
  }

  private itemRows(items: PlanItemDto[]) {
    return items.map((i) => ({
      ageDays: i.ageDays,
      productName: i.productName,
      stockItemId: blank(i.stockItemId),
      dose: blank(i.dose),
    }));
  }

  create(
    ctx: RequestContext,
    dto: CreatePlanDto,
  ): Promise<VaccinationPlanItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const type = dto.type ?? null;
        await this.assertContent(tx, ctx, dto.species, type, dto.items);
        const created = await tx.vaccinationPlan.create({
          data: {
            organizationId: ctx.user.organizationId,
            name: dto.name,
            species: dto.species,
            type,
            items: { create: this.itemRows(dto.items) },
          },
          include,
        });
        const item = toItem(created);
        await this.log(tx, ctx, 'CREATE', created, undefined, item);
        return item;
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdatePlanDto,
  ): Promise<VaccinationPlanItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'VaccinationPlan', id);
        const before = await this.find(tx, ctx, id);
        const species = dto.species ?? before.species;
        const type = dto.type === undefined ? before.type : dto.type;
        // The lots it was applied to were checked against this species and type.
        if (
          (species !== before.species || type !== before.type) &&
          (await tx.healthAct.count({ where: { planId: id } })) > 0
        ) {
          throw new ConflictException(FROZEN);
        }
        await this.assertContent(tx, ctx, species, type, dto.items);
        if (dto.items)
          await tx.vaccinationPlanItem.deleteMany({ where: { planId: id } });
        const updated = await tx.vaccinationPlan.update({
          where: { id },
          data: {
            name: dto.name,
            species,
            type,
            ...(dto.items
              ? { items: { create: this.itemRows(dto.items) } }
              : {}),
          },
          include,
        });
        const was = toItem(before);
        const item = toItem(updated);
        await this.log(tx, ctx, 'UPDATE', updated, was, item);
        return item;
      }),
    );
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'VaccinationPlan', id);
        const before = await this.find(tx, ctx, id);
        if ((await tx.healthAct.count({ where: { planId: id } })) > 0) {
          throw new ConflictException(APPLIED);
        }
        await tx.vaccinationPlanItem.deleteMany({ where: { planId: id } });
        await tx.vaccinationPlan.delete({ where: { id } });
        const was = toItem(before);
        await this.log(tx, ctx, 'DELETE', before, was);
      }),
    );
  }

  /**
   * One planned vaccination per step, dated entry + `ageDays`, linked by
   * `planId`, with the step's product, stock article and dose. Every step is
   * created, including those whose date is already past: they show as
   * `EN_RETARD` until someone completes or cancels them, none is marked done.
   * A step whose stock article is no longer an active vaccine of the
   * organisation is created as free text. A plan is applied once per lot (409).
   */
  apply(
    ctx: RequestContext,
    id: string,
    dto: ApplyPlanDto,
  ): Promise<HealthActItem[]> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.targets.resolve(
        tx,
        ctx,
        { batchId: dto.batchId },
        today(),
      );
      await this.find(tx, ctx, id);
      await lockRow(tx, 'VaccinationPlan', id);
      const plan = await this.find(tx, ctx, id);
      const batch = await tx.animalBatch.findUniqueOrThrow({
        where: { id: target.id },
        select: { species: true, type: true, entryDate: true },
      });
      if (plan.species !== batch.species) {
        throw new BadRequestException(WRONG_SPECIES);
      }
      if (plan.type && plan.type !== batch.type) {
        throw new BadRequestException(
          'Ce plan est réservé à un autre type de lot',
        );
      }
      // A cancelled step does not count: after cancelling its steps a plan can be applied again.
      if (
        await tx.healthAct.count({
          where: {
            planId: id,
            batchId: target.id,
            status: { not: 'ANNULE' },
          },
        })
      ) {
        throw new ConflictException(ALREADY_APPLIED);
      }
      // A step's article may have been deactivated, retyped or removed since the
      // plan was written: such a step is still applied, as free text (its product
      // name kept, no stock article), rather than failing the whole plan.
      const usable = await this.stock.usable(
        tx,
        ctx,
        plan.items.flatMap((i) => (i.stockItemId ? [i.stockItemId] : [])),
        ['VACCIN'],
      );
      const created: HealthActItem[] = [];
      for (const step of plan.items) {
        const row = await tx.healthAct.create({
          data: {
            farmId: target.farmId,
            date: addDays(batch.entryDate, step.ageDays),
            type: 'VACCINATION',
            batchId: target.id,
            stockItemId:
              step.stockItemId && usable.has(step.stockItemId)
                ? step.stockItemId
                : null,
            productName: step.productName,
            dose: step.dose,
            status: 'PLANIFIE',
            planId: plan.id,
            createdById: ctx.user.id,
          },
          include: actInclude,
          relationLoadStrategy: 'join',
        });
        const item = toActItem(row);
        await this.audit.log(
          {
            ctx,
            module: 'sante',
            action: 'CREATE',
            recordId: item.id,
            label: `${actTypeLabel(item.type)} · ${item.target} · ${formatDay(row.date)}`,
            after: item,
          },
          tx,
        );
        created.push(item);
      }
      return created;
    });
  }
}
