import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import type { AuditableService } from '../../audit/audited.decorator';
import type { Prisma } from '../../generated/prisma/client';
import type { ExportColumn } from '../../listing/export';
import { orderBy } from '../../listing/list-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  containsInsensitive,
  NAME_TAKEN,
  orConflict,
} from '../../listing/list-helpers';
import type { CreateZoneDto, UpdateZoneDto, ZonesQueryDto } from './zones.dto';

const include = {
  building: { select: { name: true } },
} satisfies Prisma.ZoneInclude;

type ZoneRow = Prisma.ZoneGetPayload<{ include: typeof include }>;

export interface ZoneItem {
  id: string;
  name: string;
  buildingId: string;
  buildingName: string;
  capacity: number | null;
}

export const ZONE_COLUMNS: ExportColumn<ZoneItem>[] = [
  { header: 'Nom', value: (z) => z.name },
  { header: 'Bâtiment', value: (z) => z.buildingName },
  { header: 'Capacité', value: (z) => z.capacity },
];

const SORTABLE = ['name', 'capacity', 'createdAt'];

const toItem = (z: ZoneRow): ZoneItem => ({
  id: z.id,
  name: z.name,
  buildingId: z.buildingId,
  buildingName: z.building.name,
  capacity: z.capacity,
});

@Injectable()
export class ZonesService implements AuditableService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(ctx: RequestContext): Prisma.ZoneWhereInput {
    return { farmId: { in: ctx.farmIds } };
  }

  listArgs(ctx: RequestContext, q: ZonesQueryDto) {
    const where: Prisma.ZoneWhereInput = {
      AND: [
        this.scope(ctx),
        q.buildingId ? { buildingId: q.buildingId } : {},
        q.search ? { name: containsInsensitive(q.search) } : {},
      ],
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.zone.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.zone.count({ where }),
    };
  }

  findForAudit(id: string, ctx: RequestContext) {
    return this.prisma.zone.findFirst({ where: { id, ...this.scope(ctx) } });
  }

  private async load(id: string, ctx: RequestContext): Promise<ZoneRow> {
    const zone = await this.prisma.zone.findFirst({
      where: { id, ...this.scope(ctx) },
      include,
    });
    if (!zone) throw new NotFoundException('Zone introuvable');
    return zone;
  }

  /** Zone names are unique within a building (the schema has no constraint for it). */
  private async assertNameFree(
    buildingId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.zone.findFirst({
      where: {
        buildingId,
        name,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(NAME_TAKEN);
  }

  async create(ctx: RequestContext, dto: CreateZoneDto): Promise<ZoneItem> {
    const building = await this.prisma.building.findFirst({
      where: { id: dto.buildingId, farmId: ctx.farmId! },
      select: { id: true },
    });
    if (!building) {
      throw new BadRequestException('Bâtiment invalide pour cette ferme');
    }
    await this.assertNameFree(building.id, dto.name);
    const zone = await this.prisma.zone.create({
      data: { ...dto, farmId: ctx.farmId! },
      include,
    });
    return toItem(zone);
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateZoneDto,
  ): Promise<ZoneItem> {
    const current = await this.load(id, ctx);
    if (dto.name) await this.assertNameFree(current.buildingId, dto.name, id);
    const zone = await this.prisma.zone.update({
      where: { id },
      data: dto,
      include,
    });
    return toItem(zone);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.load(id, ctx);
    await orConflict(() => this.prisma.zone.delete({ where: { id } }));
  }
}
