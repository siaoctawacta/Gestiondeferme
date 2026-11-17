import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../access/decorators';
import type { AuditableService } from '../../audit/audited.decorator';
import type { Prisma } from '../../generated/prisma/client';
import type { ExportColumn } from '../../listing/export';
import { ListQueryDto, orderBy } from '../../listing/list-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { containsInsensitive, orConflict } from '../../listing/list-helpers';
import type { SiteDto } from './sites.dto';

const withCounts = {
  _count: { select: { buildings: true } },
} satisfies Prisma.SiteInclude;

type SiteRow = Prisma.SiteGetPayload<{ include: typeof withCounts }>;

export interface SiteItem {
  id: string;
  name: string;
  farmId: string;
  buildings: number;
}

export const SITE_COLUMNS: ExportColumn<SiteItem>[] = [
  { header: 'Nom', value: (s) => s.name },
  { header: 'Bâtiments', value: (s) => s.buildings },
];

const SORTABLE = ['name', 'createdAt'];

const toItem = (s: SiteRow): SiteItem => ({
  id: s.id,
  name: s.name,
  farmId: s.farmId,
  buildings: s._count.buildings,
});

@Injectable()
export class SitesService implements AuditableService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sites of the farm(s) the request may touch; the farm already belongs to the organisation. */
  private scope(ctx: RequestContext): Prisma.SiteWhereInput {
    return { farmId: { in: ctx.farmIds } };
  }

  listArgs(ctx: RequestContext, q: ListQueryDto) {
    const where: Prisma.SiteWhereInput = {
      AND: [
        this.scope(ctx),
        q.search ? { name: containsInsensitive(q.search) } : {},
      ],
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.site.findMany({
            where,
            include: withCounts,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      count: () => this.prisma.site.count({ where }),
    };
  }

  findForAudit(id: string, ctx: RequestContext) {
    return this.prisma.site.findFirst({ where: { id, ...this.scope(ctx) } });
  }

  private async load(id: string, ctx: RequestContext): Promise<SiteRow> {
    const site = await this.prisma.site.findFirst({
      where: { id, ...this.scope(ctx) },
      include: withCounts,
    });
    if (!site) throw new NotFoundException('Site introuvable');
    return site;
  }

  async create(ctx: RequestContext, dto: SiteDto): Promise<SiteItem> {
    const site = await orConflict(() =>
      this.prisma.site.create({
        data: { name: dto.name, farmId: ctx.farmId! },
        include: withCounts,
      }),
    );
    return toItem(site);
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: SiteDto,
  ): Promise<SiteItem> {
    await this.load(id, ctx);
    const site = await orConflict(() =>
      this.prisma.site.update({
        where: { id },
        data: { name: dto.name },
        include: withCounts,
      }),
    );
    return toItem(site);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const site = await this.load(id, ctx);
    if (site._count.buildings > 0) {
      throw new ConflictException('Ce site contient des bâtiments');
    }
    const equipment = await this.prisma.equipment.count({
      where: { siteId: id },
    });
    if (equipment > 0) {
      throw new ConflictException('Ce site porte des équipements');
    }
    await orConflict(() => this.prisma.site.delete({ where: { id } }));
  }
}
