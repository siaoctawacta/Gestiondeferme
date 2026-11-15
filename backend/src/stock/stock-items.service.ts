import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma, StockItem } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateStockItemDto,
  StockItemQueryDto,
  UpdateStockItemDto,
} from './dto/stock-item.dto';

export interface StockItemItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  active: boolean;
}

export const ITEM_NOT_FOUND = 'Article introuvable';
export const HAS_MOVEMENTS =
  'Cet article a des mouvements : désactivez-le plutôt';
export const UNIT_LOCKED =
  "Cet article a des mouvements : l'unité et la catégorie ne peuvent plus changer";
const SORTABLE = ['name', 'category'];

export const toItem = (i: StockItem): StockItemItem => ({
  id: i.id,
  name: i.name,
  category: i.category,
  unit: i.unit,
  active: i.active,
});

/** The organisation's catalogue of articles (master data, shared by every farm). */
@Injectable()
export class StockItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext, q: StockItemQueryDto) {
    const where: Prisma.StockItemWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.category ? { category: q.category } : {}),
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.search ? { name: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.stockItem.findMany({
            where,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      () => this.prisma.stockItem.count({ where }),
    );
  }

  private async find(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    id: string,
  ): Promise<StockItem> {
    const row = await tx.stockItem.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
    if (!row) throw new NotFoundException(ITEM_NOT_FOUND);
    return row;
  }

  private log(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: AuditAction,
    row: StockItem,
    before?: StockItem,
    after?: StockItem,
  ): Promise<void> {
    return this.audit.log(
      {
        ctx,
        module: 'stocks',
        action,
        recordId: row.id,
        label: row.name,
        before: before && toItem(before),
        after: after && toItem(after),
      },
      tx,
    );
  }

  create(ctx: RequestContext, dto: CreateStockItemDto): Promise<StockItemItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.stockItem.create({
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
    dto: UpdateStockItemDto,
  ): Promise<StockItemItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.find(tx, ctx, id);
        const changesMeasure =
          (dto.unit !== undefined && dto.unit !== before.unit) ||
          (dto.category !== undefined && dto.category !== before.category);
        if (
          changesMeasure &&
          (await tx.stockMovement.count({ where: { stockItemId: id } })) > 0
        ) {
          throw new ConflictException(UNIT_LOCKED);
        }
        const updated = await tx.stockItem.update({
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
        if (
          (await tx.stockMovement.count({ where: { stockItemId: id } })) > 0
        ) {
          throw new ConflictException(HAS_MOVEMENTS);
        }
        // Thresholds only exist to serve the stock; the article goes with them.
        await tx.farmStockItem.deleteMany({ where: { stockItemId: id } });
        await tx.stockItem.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, before);
      }),
    );
  }
}
