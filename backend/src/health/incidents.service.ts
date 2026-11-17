import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { blank } from '../common/blank';
import {
  assertNotBeforeEntry,
  assertNotFuture,
  formatDay,
  requireDay,
} from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type {
  IncidentSeverity,
  IncidentStatus,
} from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateIncidentDto,
  IncidentQueryDto,
  UpdateIncidentDto,
} from './dto/incident.dto';
import { HealthTargets } from './health-targets';

type Tx = Prisma.TransactionClient;

const include = {
  batch: { select: { code: true, entryDate: true } },
  building: { select: { name: true } },
} satisfies Prisma.HealthIncidentInclude;
type Row = Prisma.HealthIncidentGetPayload<{ include: typeof include }>;

export interface IncidentItem {
  id: string;
  date: string;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  /** Lot code, else building name, when the incident has one. */
  target: string | null;
  batchId: string | null;
  buildingId: string | null;
  status: IncidentStatus;
}

const NOT_FOUND = 'Incident introuvable';
const CLOSED = 'Cet incident est clos';
const STATUSES: IncidentStatus[] = ['OUVERT', 'CLOS'];
const SORTABLE = ['date', 'severity', 'status', 'createdAt'];

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  FAIBLE: 'Faible',
  MOYENNE: 'Moyenne',
  GRAVE: 'Grave',
};
const STATUS_LABEL: Record<IncidentStatus, string> = {
  OUVERT: 'Ouvert',
  CLOS: 'Clos',
};

export const INCIDENT_COLUMNS: ExportColumn<IncidentItem>[] = [
  { header: 'Date', value: (i) => i.date },
  { header: 'Titre', value: (i) => i.title },
  { header: 'Gravité', value: (i) => SEVERITY_LABEL[i.severity] },
  { header: 'Cible', value: (i) => i.target },
  { header: 'Statut', value: (i) => STATUS_LABEL[i.status] },
];

const toItem = (r: Row): IncidentItem => ({
  id: r.id,
  date: formatDay(r.date),
  title: r.title,
  description: r.description,
  severity: r.severity,
  target: r.batch?.code ?? r.building?.name ?? null,
  batchId: r.batchId,
  buildingId: r.buildingId,
  status: r.status,
});

/**
 * Health incidents of a lot and/or a building (daily entries). Closing locks
 * the incident row alone; a new or changed lot is locked first
 * (`HealthTargets`), then the incident row.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: HealthTargets,
  ) {}

  private scope(ctx: RequestContext): Prisma.HealthIncidentWhereInput {
    return {
      farmId: { in: ctx.farmIds },
      AND: [this.targets.visibleBatch(ctx)],
    };
  }

  listArgs(ctx: RequestContext, q: IncidentQueryDto) {
    if (q.status && !STATUSES.includes(q.status as IncidentStatus)) {
      throw new BadRequestException('Statut invalide');
    }
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const filters: Prisma.HealthIncidentWhereInput = {
      ...this.scope(ctx),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search
        ? {
            OR: [
              { title: containsInsensitive(q.search) },
              { description: containsInsensitive(q.search) },
              { batch: { code: containsInsensitive(q.search) } },
              { building: { name: containsInsensitive(q.search) } },
            ],
          }
        : {}),
    };
    const where: Prisma.HealthIncidentWhereInput = q.status
      ? { AND: [filters, { status: q.status as IncidentStatus }] }
      : filters;
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return {
      /** Per-status totals over every filter but the status. */
      statusCounts: async (): Promise<Record<IncidentStatus, number>> => {
        const groups = await this.prisma.healthIncident.groupBy({
          by: ['status'],
          where: filters,
          _count: { _all: true },
        });
        const counts: Record<IncidentStatus, number> = { OUVERT: 0, CLOS: 0 };
        for (const g of groups) counts[g.status] = g._count._all;
        return counts;
      },
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.healthIncident.findMany({
            where,
            include,
            relationLoadStrategy: 'join',
            orderBy: [order, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.healthIncident.count({ where }),
    };
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    const row = await tx.healthIncident.findFirst({
      where: { id, ...this.scope(ctx) },
      include,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    item: IncidentItem,
    before?: IncidentItem,
    after?: IncidentItem,
  ) {
    return this.audit.logChange(
      {
        ctx,
        module: 'sante',
        action,
        recordId: item.id,
        label: `${item.title} · ${item.date}`,
        before,
        after,
      },
      tx,
    );
  }

  create(ctx: RequestContext, dto: CreateIncidentDto): Promise<IncidentItem> {
    const date = requireDay(dto.date);
    return this.prisma.$transaction(async (tx) => {
      if (dto.batchId) {
        await this.targets.resolve(tx, ctx, { batchId: dto.batchId }, date);
      } else assertNotFuture(date);
      if (dto.buildingId) await this.targets.building(tx, ctx, dto.buildingId);
      const created = await tx.healthIncident.create({
        data: {
          farmId: ctx.farmId as string,
          date,
          title: dto.title,
          description: blank(dto.description),
          severity: dto.severity,
          batchId: dto.batchId ?? null,
          buildingId: dto.buildingId ?? null,
        },
        include,
        relationLoadStrategy: 'join',
      });
      const item = toItem(created);
      await this.log(tx, ctx, 'CREATE', item, undefined, item);
      return item;
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateIncidentDto,
  ): Promise<IncidentItem> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      const batchId = dto.batchId === undefined ? found.batchId : dto.batchId;
      const buildingId =
        dto.buildingId === undefined ? found.buildingId : dto.buildingId;
      const date = dto.date ? requireDay(dto.date) : found.date;
      // A new lot is locked (and must be open) before the incident row.
      if (batchId && batchId !== found.batchId) {
        await this.targets.resolve(tx, ctx, { batchId }, date);
      }
      // Moving the date of an incident whose lot stays the same locks that lot first.
      if (dto.date && found.batchId && batchId === found.batchId) {
        await this.targets.forRow(tx, ctx, found);
      }
      await lockRow(tx, 'HealthIncident', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      if (before.status === 'CLOS') throw new ConflictException(CLOSED);
      if (dto.date) {
        assertNotFuture(date);
        // Against the lot the incident ends up on: a NEW lot was checked when
        // it was resolved above, and an incident whose lot is cleared has none.
        if (batchId && batchId === before.batchId && before.batch) {
          assertNotBeforeEntry(before.batch.entryDate, date);
        }
      }
      if (buildingId && buildingId !== before.buildingId) {
        await this.targets.building(tx, ctx, buildingId);
      }
      const updated = await tx.healthIncident.update({
        where: { id },
        data: {
          date,
          title: dto.title,
          severity: dto.severity,
          batchId: batchId ?? null,
          buildingId: buildingId ?? null,
          ...(dto.description !== undefined
            ? { description: blank(dto.description) }
            : {}),
        },
        include,
        relationLoadStrategy: 'join',
      });
      const was = toItem(before);
      const item = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }

  close(ctx: RequestContext, id: string): Promise<IncidentItem> {
    return this.prisma.$transaction(async (tx) => {
      await this.find(tx, ctx, id);
      await lockRow(tx, 'HealthIncident', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      if (before.status === 'CLOS') throw new ConflictException(CLOSED);
      const updated = await tx.healthIncident.update({
        where: { id },
        data: { status: 'CLOS', closedAt: new Date() },
        include,
        relationLoadStrategy: 'join',
      });
      const was = toItem(before);
      const item = toItem(updated);
      await this.log(tx, ctx, 'UPDATE', item, was, item);
      return item;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await this.find(tx, ctx, id);
      await lockRow(tx, 'HealthIncident', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      await tx.healthIncident.delete({ where: { id } });
      const was = toItem(before);
      await this.log(tx, ctx, 'DELETE', was, was);
    });
  }
}
