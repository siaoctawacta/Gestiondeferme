import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { blank } from '../common/blank';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { BiosecurityType } from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BiosecurityQueryDto,
  CreateBiosecurityDto,
  UpdateBiosecurityDto,
} from './dto/biosecurity.dto';
import { HealthTargets } from './health-targets';

type Tx = Prisma.TransactionClient;

const include = {
  building: { select: { name: true } },
} satisfies Prisma.BiosecurityLogInclude;
type Row = Prisma.BiosecurityLogGetPayload<{ include: typeof include }>;

export interface BiosecurityLogItem {
  id: string;
  date: string;
  type: BiosecurityType;
  buildingId: string | null;
  buildingName: string | null;
  productName: string | null;
  visitorName: string | null;
  note: string | null;
}

const NOT_FOUND = 'Relevé de biosécurité introuvable';
const SORTABLE = ['date', 'type', 'createdAt'];

const TYPE_LABEL: Record<BiosecurityType, string> = {
  NETTOYAGE: 'Nettoyage',
  DESINFECTION: 'Désinfection',
  PEDILUVE: 'Pédiluve',
  VISITEUR: 'Visiteur',
};

export const BIOSECURITY_COLUMNS: ExportColumn<BiosecurityLogItem>[] = [
  { header: 'Date', value: (l) => l.date },
  { header: 'Type', value: (l) => TYPE_LABEL[l.type] },
  { header: 'Bâtiment', value: (l) => l.buildingName },
  { header: 'Produit', value: (l) => l.productName },
  { header: 'Visiteur', value: (l) => l.visitorName },
  { header: 'Note', value: (l) => l.note },
];

const toItem = (r: Row): BiosecurityLogItem => ({
  id: r.id,
  date: formatDay(r.date),
  type: r.type,
  buildingId: r.buildingId,
  buildingName: r.building?.name ?? null,
  productName: r.productName,
  visitorName: r.visitorName,
  note: r.note,
});

/** Cleaning, disinfection, footbath and visitor logs of a farm (daily entries). */
@Injectable()
export class BiosecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: HealthTargets,
  ) {}

  listArgs(ctx: RequestContext, q: BiosecurityQueryDto) {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const where: Prisma.BiosecurityLogWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.type ? { type: q.type } : {}),
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search
        ? {
            OR: [
              { productName: containsInsensitive(q.search) },
              { visitorName: containsInsensitive(q.search) },
              { note: containsInsensitive(q.search) },
              { building: { name: containsInsensitive(q.search) } },
            ],
          }
        : {}),
    };
    const order = orderBy(q, SORTABLE, { date: 'desc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.biosecurityLog.findMany({
            where,
            include,
            relationLoadStrategy: 'join',
            orderBy: [order, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.biosecurityLog.count({ where }),
    };
  }

  private async find(tx: Tx, ctx: RequestContext, id: string): Promise<Row> {
    const row = await tx.biosecurityLog.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
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
    item: BiosecurityLogItem,
    before?: BiosecurityLogItem,
    after?: BiosecurityLogItem,
  ) {
    return this.audit.logChange(
      {
        ctx,
        module: 'sante',
        action,
        recordId: item.id,
        label: `${item.type} · ${item.date}`,
        before,
        after,
      },
      tx,
    );
  }

  create(
    ctx: RequestContext,
    dto: CreateBiosecurityDto,
  ): Promise<BiosecurityLogItem> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      if (dto.buildingId) await this.targets.building(tx, ctx, dto.buildingId);
      const created = await tx.biosecurityLog.create({
        data: {
          farmId: ctx.farmId as string,
          date,
          type: dto.type,
          buildingId: dto.buildingId ?? null,
          productName: blank(dto.productName),
          visitorName: blank(dto.visitorName),
          note: blank(dto.note),
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
    dto: UpdateBiosecurityDto,
  ): Promise<BiosecurityLogItem> {
    const date = dto.date ? requireDay(dto.date) : undefined;
    if (date) assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      await this.find(tx, ctx, id);
      await lockRow(tx, 'BiosecurityLog', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      if (dto.buildingId && dto.buildingId !== before.buildingId) {
        await this.targets.building(tx, ctx, dto.buildingId);
      }
      const updated = await tx.biosecurityLog.update({
        where: { id },
        data: {
          date,
          type: dto.type,
          ...(dto.buildingId !== undefined
            ? { buildingId: dto.buildingId }
            : {}),
          ...(dto.productName !== undefined
            ? { productName: blank(dto.productName) }
            : {}),
          ...(dto.visitorName !== undefined
            ? { visitorName: blank(dto.visitorName) }
            : {}),
          ...(dto.note !== undefined ? { note: blank(dto.note) } : {}),
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

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await this.find(tx, ctx, id);
      await lockRow(tx, 'BiosecurityLog', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      await tx.biosecurityLog.delete({ where: { id } });
      const was = toItem(before);
      await this.log(tx, ctx, 'DELETE', was, was);
    });
  }
}
