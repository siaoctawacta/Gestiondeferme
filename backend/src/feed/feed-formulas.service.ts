import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import { lockRow } from '../common/lock-row';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFeedFormulaDto,
  FeedFormulaQueryDto,
  FormulaItemDto,
  UpdateFeedFormulaDto,
} from './dto/feed-formula.dto';
import { formulaCostPerKg } from './feed-cost';

const include = {
  items: {
    include: { feedProduct: { select: { name: true, unitCost: true } } },
    orderBy: [{ percentage: 'desc' }, { id: 'asc' }],
  },
} satisfies Prisma.FeedFormulaInclude;
type Row = Prisma.FeedFormulaGetPayload<{ include: typeof include }>;

export interface FeedFormulaItem {
  id: string;
  name: string;
  species: string;
  stage: string;
  active: boolean;
  /** Σ percentage × product cost / 100, from the products' current costs. */
  costPerKg: number;
  items: {
    feedProductId: string;
    name: string;
    percentage: number;
    unitCost: number;
  }[];
}

const NOT_FOUND = 'Formule introuvable';
export const FORMULA_USED =
  'Cette formule a déjà des distributions : créez une nouvelle formule';
const SORTABLE = ['name', 'stage'];

const toItem = (f: Row): FeedFormulaItem => ({
  id: f.id,
  name: f.name,
  species: f.species,
  stage: f.stage,
  active: f.active,
  costPerKg: Number(formulaCostPerKg(f.items)),
  items: f.items.map((i) => ({
    feedProductId: i.feedProductId,
    name: i.feedProduct.name,
    percentage: Number(i.percentage),
    unitCost: Number(i.feedProduct.unitCost),
  })),
});

/**
 * Deactivating a product does not touch the formulas that contain it: they
 * keep working and are costed with the product's current price. A distribution
 * from the formula only checks that the formula itself is active.
 */
@Injectable()
export class FeedFormulasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext, q: FeedFormulaQueryDto) {
    const where: Prisma.FeedFormulaWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.species ? { species: q.species } : {}),
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.search ? { name: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    return paginate(
      q,
      async (range) =>
        (
          await this.prisma.feedFormula.findMany({
            where,
            include,
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map(toItem),
      () => this.prisma.feedFormula.count({ where }),
    );
  }

  private async find(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    id: string,
  ): Promise<Row> {
    const row = await tx.feedFormula.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** Whether `items` differ from the stored composition (order does not matter). */
  private changesItems(stored: Row, items: FormulaItemDto[]): boolean {
    const key = (id: string, pct: number) => `${id}:${Math.round(pct * 100)}`;
    const was = new Set(
      stored.items.map((i) => key(i.feedProductId, Number(i.percentage))),
    );
    return (
      items.length !== was.size ||
      items.some((i) => !was.has(key(i.feedProductId, i.percentage)))
    );
  }

  /** Items must be distinct products of the organisation and total 100 % (± 0.01). */
  private async assertItems(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    items: FormulaItemDto[],
  ): Promise<void> {
    const ids = items.map((i) => i.feedProductId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Un aliment ne peut figurer qu’une fois');
    }
    const known = await tx.feedProduct.count({
      where: { id: { in: ids }, organizationId: ctx.user.organizationId },
    });
    if (known !== ids.length) throw new BadRequestException('Aliment invalide');
    const hundredths = items.reduce(
      (sum, i) => sum + Math.round(i.percentage * 100),
      0,
    );
    if (Math.abs(hundredths - 10000) > 1) {
      throw new BadRequestException('Les pourcentages doivent totaliser 100 %');
    }
  }

  private log(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: AuditAction,
    row: Row,
    before?: Row,
    after?: Row,
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
    dto: CreateFeedFormulaDto,
  ): Promise<FeedFormulaItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertItems(tx, ctx, dto.items);
        const created = await tx.feedFormula.create({
          data: {
            organizationId: ctx.user.organizationId,
            name: dto.name,
            species: dto.species,
            stage: dto.stage,
            active: dto.active,
            items: { create: dto.items },
          },
          include,
        });
        await this.log(tx, ctx, 'CREATE', created, undefined, created);
        return toItem(created);
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateFeedFormulaDto,
  ): Promise<FeedFormulaItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        // Distributions lock the formula too: the check below holds until we commit.
        await lockRow(tx, 'FeedFormula', id);
        const before = await this.find(tx, ctx, id);
        const { items, ...fields } = dto;
        if (items && this.changesItems(before, items)) {
          // What was fed stays what it was: only a formula without distributions changes composition.
          if (
            (await tx.feedDistribution.count({ where: { formulaId: id } })) > 0
          ) {
            throw new ConflictException(FORMULA_USED);
          }
          await this.assertItems(tx, ctx, items);
          await tx.feedFormulaItem.deleteMany({ where: { formulaId: id } });
          await tx.feedFormulaItem.createMany({
            data: items.map((i) => ({ ...i, formulaId: id })),
          });
        }
        await tx.feedFormula.update({ where: { id }, data: fields });
        const updated = await this.find(tx, ctx, id);
        await this.log(tx, ctx, 'UPDATE', updated, before, updated);
        return toItem(updated);
      }),
    );
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.find(tx, ctx, id);
        await tx.feedFormula.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, before);
      }),
    );
  }
}
