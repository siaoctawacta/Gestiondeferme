import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { Ctx, NoFarm, RequirePermission } from '../access/decorators';
import type { RequestContext } from '../access/decorators';
import { ALL_FARMS_ROLES } from '../access/roles';
import type { Prisma } from '../generated/prisma/client';
import { ExportColumn } from '../listing/export';
import { sendList } from '../listing/list-helpers';
import { ListQueryDto, orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';

class AuditQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  module?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

type AuditItem = Prisma.AuditLogGetPayload<object>;

const SORTABLE = ['createdAt', 'userName', 'action', 'module'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS: ExportColumn<AuditItem>[] = [
  { header: 'Date', value: (r) => r.createdAt.toISOString() },
  { header: 'Utilisateur', value: (r) => r.userName },
  { header: 'Action', value: (r) => r.action },
  { header: 'Module', value: (r) => r.module },
  { header: 'Élément', value: (r) => r.label },
];

/** `to` given as a bare date includes that whole day. */
function endOfRange(to: string): Prisma.DateTimeFilter {
  if (!DATE_ONLY.test(to)) return { lte: new Date(to) };
  const next = new Date(`${to}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { lt: next };
}

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /**
   * Read-only. The farm header is optional: without it the caller sees the
   * farms it may access (the whole organisation for all-farm roles).
   */
  @Get()
  @NoFarm()
  @RequirePermission('audit', 'read')
  async list(
    @Ctx() ctx: RequestContext,
    @Query() q: AuditQueryDto,
    @Headers('x-farm-id') farmHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const where = await this.buildWhere(ctx, q, farmHeader);
    const orderList = [
      orderBy(q, SORTABLE, { createdAt: 'desc' }),
      { id: 'desc' as const },
    ];
    await sendList(
      res,
      q,
      'journal-audit',
      COLUMNS,
      (range) =>
        this.prisma.auditLog.findMany({ where, orderBy: orderList, ...range }),
      () => this.prisma.auditLog.count({ where }),
    );
  }

  private async buildWhere(
    ctx: RequestContext,
    q: AuditQueryDto,
    farmHeader: string | undefined,
  ): Promise<Prisma.AuditLogWhereInput> {
    const and: Prisma.AuditLogWhereInput[] = [
      { organizationId: ctx.user.organizationId },
    ];

    const seesAll = ALL_FARMS_ROLES.includes(ctx.user.role);
    if (!seesAll || (farmHeader && farmHeader !== 'all')) {
      // All-farm roles also see organisation-level rows (login, user/farm/settings
      // admin: no farm); `all` and no header are the same: no farm filter.
      const farmIds = farmHeader
        ? (await this.access.resolveFarms(ctx.user, farmHeader, true)).farmIds
        : (
            await this.prisma.farm.findMany({
              where: this.access.visibleFarmsWhere(ctx.user),
              select: { id: true },
            })
          ).map((f) => f.id);
      and.push(
        seesAll
          ? { OR: [{ farmId: { in: farmIds } }, { farmId: null }] }
          : { farmId: { in: farmIds } },
      );
    }

    if (q.module) and.push({ module: q.module });
    if (q.from || q.to) {
      and.push({
        createdAt: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? endOfRange(q.to) : {}),
        },
      });
    }
    if (q.search) {
      const contains = { contains: q.search, mode: 'insensitive' as const };
      and.push({
        OR: [{ userName: contains }, { label: contains }, { module: contains }],
      });
    }
    return { AND: and };
  }
}
