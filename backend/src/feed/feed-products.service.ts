import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { FeedProduct, Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { lockRow } from '../common/lock-row';
import { toItem as toStockItem } from '../stock/stock-items.service';
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
  /** The stock article it is drawn from, if any. */
  stockItemId: string | null;
}

const NOT_FOUND = 'Aliment introuvable';
const STOCK_INVALID = 'Article de stock invalide';
const STOCK_CATEGORY = "L'article de stock doit être de catégorie Aliment";
const STOCK_UNIT = "L'article de stock doit être en kg";
const STOCK_TAKEN = 'Cet article de stock est déjà lié à un autre aliment';
const LINK_LOCKED =
  'Cet aliment a des distributions : le lien avec le stock ne peut plus changer';
const STOCK_NAME_TAKEN = 'Un article de stock porte déjà ce nom';
const SORTABLE = ['name', 'unitCost'];

const toItem = (p: FeedProduct): FeedProductItem => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  unit: p.unit,
  unitCost: Number(p.unitCost),
  active: p.active,
  stockItemId: p.stockItemId,
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

  /** The article exists in the organisation, is an Aliment counted in kg, and feeds no other product. */
  private async assertStockItem(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    stockItemId: string,
    productId?: string,
  ): Promise<void> {
    const item = await tx.stockItem.findFirst({
      where: { id: stockItemId, organizationId: ctx.user.organizationId },
    });
    if (!item) throw new BadRequestException(STOCK_INVALID);
    if (item.category !== 'ALIMENT') {
      throw new BadRequestException(STOCK_CATEGORY);
    }
    if (!/^kg$/i.test(item.unit.trim())) {
      throw new BadRequestException(STOCK_UNIT);
    }
    const taken = await tx.feedProduct.findFirst({
      where: { stockItemId, ...(productId ? { id: { not: productId } } : {}) },
    });
    if (taken) throw new ConflictException(STOCK_TAKEN);
  }

  /** Distributions of the product, directly or through a formula that uses it. */
  private async assertNoDistributions(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const used = await tx.feedDistribution.findFirst({
      where: {
        OR: [
          { feedProductId: productId },
          { formula: { items: { some: { feedProductId: productId } } } },
        ],
      },
      select: { id: true },
    });
    if (used) throw new ConflictException(LINK_LOCKED);
  }

  create(
    ctx: RequestContext,
    dto: CreateFeedProductDto,
  ): Promise<FeedProductItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        if (dto.stockItemId) {
          await this.assertStockItem(tx, ctx, dto.stockItemId);
        }
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
        await lockRow(tx, 'FeedProduct', id);
        const before = await this.find(tx, ctx, id);
        if (
          dto.stockItemId !== undefined &&
          dto.stockItemId !== before.stockItemId
        ) {
          await this.assertNoDistributions(tx, id);
          if (dto.stockItemId) {
            await this.assertStockItem(tx, ctx, dto.stockItemId, id);
          }
        }
        const updated = await tx.feedProduct.update({
          where: { id },
          data: dto,
        });
        await this.log(tx, ctx, 'UPDATE', updated, before, updated);
        return toItem(updated);
      }),
    );
  }

  /** Creates the stock article named after the product (Aliment, kg) and links it. */
  createStockItem(ctx: RequestContext, id: string): Promise<FeedProductItem> {
    return orConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          await lockRow(tx, 'FeedProduct', id);
          const before = await this.find(tx, ctx, id);
          if (before.stockItemId) throw new ConflictException(STOCK_TAKEN);
          await this.assertNoDistributions(tx, id);
          const item = await tx.stockItem.create({
            data: {
              organizationId: ctx.user.organizationId,
              name: before.name,
              category: 'ALIMENT',
              unit: 'kg',
            },
          });
          await this.audit.log(
            {
              ctx,
              module: 'stocks',
              action: 'CREATE',
              recordId: item.id,
              label: item.name,
              after: toStockItem(item),
            },
            tx,
          );
          const updated = await tx.feedProduct.update({
            where: { id },
            data: { stockItemId: item.id },
          });
          await this.log(tx, ctx, 'UPDATE', updated, before, updated);
          return toItem(updated);
        }),
      STOCK_NAME_TAKEN,
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
