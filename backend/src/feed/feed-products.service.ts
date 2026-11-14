import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { FeedProduct, Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFeedProductDto,
  FeedProductQueryDto,
  UpdateFeedProductDto,
} from './dto/feed-product.dto';

export interface FeedProductItem {
  id: string;
  name: string;
  kind: string;
  unit: string;
  unitCost: number;
  active: boolean;
}

const NOT_FOUND = 'Aliment introuvable';
const SORTABLE = ['name', 'unitCost'];

const toItem = (p: FeedProduct): FeedProductItem => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  unit: p.unit,
  unitCost: Number(p.unitCost),
  active: p.active,
});

@Injectable()
export class FeedProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext, q: FeedProductQueryDto) {
    const where: Prisma.FeedProductWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.search ? { name: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.feedProduct.findMany({
            where,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      () => this.prisma.feedProduct.count({ where }),
    );
  }

  private async find(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    id: string,
  ): Promise<FeedProduct> {
    const row = await tx.feedProduct.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private log(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: AuditAction,
    row: FeedProduct,
    before?: FeedProduct,
    after?: FeedProduct,
  ): Promise<void> {
    return this.audit.log(
      {
        ctx,
        module: 'alimentation',
        action,
        recordId: row.id,
        label: row.name,
        before: before && toItem(before),
        after: after && toItem(after),
      },
      tx,
    );
  }

  create(
    ctx: RequestContext,
    dto: CreateFeedProductDto,
  ): Promise<FeedProductItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.feedProduct.create({
          data: { ...dto, organizationId: ctx.user.organizationId },
        });
        await this.log(tx, ctx, 'CREATE', created, undefined, created);
        return toItem(created);
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateFeedProductDto,
  ): Promise<FeedProductItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.find(tx, ctx, id);
        const updated = await tx.feedProduct.update({
          where: { id },
          data: dto,
        });
        await this.log(tx, ctx, 'UPDATE', updated, before, updated);
        return toItem(updated);
      }),
    );
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.find(tx, ctx, id);
        await tx.feedProduct.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, before);
      }),
    );
  }
}
