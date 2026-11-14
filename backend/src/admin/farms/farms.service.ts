import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import { ALL_FARMS_ROLES } from '../../access/roles';
import type { Prisma } from '../../generated/prisma/client';
import type { AuditableService } from '../../audit/audited.decorator';
import type { ExportColumn } from '../../listing/export';
import { ListQueryDto, orderBy } from '../../listing/list-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { containsInsensitive, NAME_TAKEN } from '../shared';
import type { CreateFarmDto, UpdateFarmDto } from './farms.dto';

const withCounts = {
  _count: { select: { sites: true, buildings: true } },
} satisfies Prisma.FarmInclude;

type FarmRow = Prisma.FarmGetPayload<{ include: typeof withCounts }>;

export interface FarmItem {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
  sites: number;
  buildings: number;
}

export const FARM_COLUMNS: ExportColumn<FarmItem>[] = [
  { header: 'Nom', value: (f) => f.name },
  { header: 'Lieu', value: (f) => f.location },
  { header: 'Sites', value: (f) => f.sites },
  { header: 'Bâtiments', value: (f) => f.buildings },
  { header: 'Statut', value: (f) => (f.active ? 'Active' : 'Inactive') },
];

const SORTABLE = ['name', 'location', 'active', 'createdAt'];

const toItem = (f: FarmRow): FarmItem => ({
  id: f.id,
  name: f.name,
  location: f.location,
  active: f.active,
  sites: f._count.sites,
  buildings: f._count.buildings,
});

@Injectable()
export class FarmsService implements AuditableService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every farm of the organisation for all-farm roles, else the assigned ones. */
  private scope(ctx: RequestContext): Prisma.FarmWhereInput {
    return {
      organizationId: ctx.user.organizationId,
      ...(ALL_FARMS_ROLES.includes(ctx.user.role)
        ? {}
        : { userFarms: { some: { userId: ctx.user.id } } }),
    };
  }

  private where(ctx: RequestContext, q: ListQueryDto): Prisma.FarmWhereInput {
    return {
      AND: [
        this.scope(ctx),
        q.search ? { name: containsInsensitive(q.search) } : {},
      ],
    };
  }

  listArgs(ctx: RequestContext, q: ListQueryDto) {
    const where = this.where(ctx, q);
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.farm.findMany({
            where,
            include: withCounts,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.farm.count({ where }),
    };
  }

  /** Raw row, organisation-scoped; used to load the "before" state for the audit. */
  findForAudit(id: string, ctx: RequestContext) {
    return this.prisma.farm.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
  }

  private async load(id: string, ctx: RequestContext): Promise<FarmRow> {
    const farm = await this.prisma.farm.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
      include: withCounts,
    });
    if (!farm) throw new NotFoundException('Ferme introuvable');
    return farm;
  }

  private async assertNameFree(
    organizationId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.farm.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(NAME_TAKEN);
  }

  async create(ctx: RequestContext, dto: CreateFarmDto): Promise<FarmItem> {
    await this.assertNameFree(ctx.user.organizationId, dto.name);
    const farm = await this.prisma.farm.create({
      data: { ...dto, organizationId: ctx.user.organizationId },
      include: withCounts,
    });
    return toItem(farm);
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateFarmDto,
  ): Promise<FarmItem> {
    await this.load(id, ctx);
    if (dto.name) {
      await this.assertNameFree(ctx.user.organizationId, dto.name, id);
    }
    const farm = await this.prisma.farm.update({
      where: { id },
      data: dto,
      include: withCounts,
    });
    return toItem(farm);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const farm = await this.load(id, ctx);
    if (farm._count.buildings > 0) {
      throw new ConflictException('Cette ferme contient des bâtiments');
    }
    await this.prisma.$transaction([
      this.prisma.site.deleteMany({ where: { farmId: id } }),
      this.prisma.userFarm.deleteMany({ where: { farmId: id } }),
      this.prisma.farm.delete({ where: { id } }),
    ]);
  }
}
