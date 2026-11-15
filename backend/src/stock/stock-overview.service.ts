import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { formatDay, formatDayOrNull, today } from '../common/days';
import type { Prisma, StockItem } from '../generated/prisma/client';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { SetThresholdsDto, StockListQueryDto } from './dto/stock-list.dto';
import { ITEM_NOT_FOUND } from './stock-items.service';
import {
  ensureFarmStockItem,
  levelKey,
  StockLedgerService,
} from './stock-ledger.service';
import {
  STOCK_LEVELS,
  stockLevel,
  worstLevel,
  type StockLevel,
} from './stock-level';
import { movementItems, type MovementItem } from './stock-movements.service';

export interface StockRow {
  /** The stock item id. */
  id: string;
  name: string;
  category: string;
  unit: string;
  active: boolean;
  quantity: number;
  /** Summed over the farms in view (`X-Farm-Id: all`). */
  minQty: number;
  maxQty: number | null;
  level: StockLevel;
  /** Whole days the stock lasts at the pace of the last 30 days; null without consumption. */
  daysOfStock: number | null;
  averageCost: number;
  value: number;
  nextExpiry: string | null;
}

export interface FarmLevel {
  farmId: string;
  farmName: string;
  quantity: number;
  minQty: number;
  maxQty: number | null;
  level: StockLevel;
  averageCost: number;
  value: number;
}

export interface StockDetail extends StockRow {
  farms: FarmLevel[];
  batches: {
    id: string;
    farmId: string;
    lotNumber: string | null;
    expiryDate: string | null;
    receivedDate: string;
    quantity: number;
    expired: boolean;
  }[];
  movements: MovementItem[];
}

const CATEGORY_LABEL: Record<string, string> = {
  ALIMENT: 'Aliment',
  MEDICAMENT: 'Médicament',
  VACCIN: 'Vaccin',
  MATERIEL: 'Matériel',
  CONSOMMABLE: 'Consommable',
};

export const STOCK_COLUMNS: ExportColumn<StockRow>[] = [
  { header: 'Article', value: (r) => r.name },
  {
    header: 'Catégorie',
    value: (r) => CATEGORY_LABEL[r.category] ?? r.category,
  },
  { header: 'Quantité', value: (r) => r.quantity },
  { header: 'Unité', value: (r) => r.unit },
  { header: 'Seuil minimum', value: (r) => r.minQty },
  { header: 'Niveau', value: (r) => r.level },
  { header: 'Jours de stock', value: (r) => r.daysOfStock },
];

const SORTABLE = ['name', 'category', 'quantity', 'value'];
const LAST_MOVEMENTS = 20;

/** What is in stock: the per-article levels, the article detail and the per-farm thresholds. */
@Injectable()
export class StockOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * One row per article, quantities summed over the caller's farms. The level
   * is computed per farm (thresholds are per farm), then the worst is shown.
   */
  private async rows(
    farmIds: string[],
    items: StockItem[],
  ): Promise<{ row: StockRow; perFarm: Map<string, FarmLevel> }[]> {
    const itemIds = items.map((i) => i.id);
    const [levels, thresholds, consumption, batches, farms] = await Promise.all(
      [
        this.ledger.levels(farmIds, itemIds),
        this.prisma.farmStockItem.findMany({
          where: { farmId: { in: farmIds }, stockItemId: { in: itemIds } },
        }),
        this.ledger.dailyConsumption(farmIds, itemIds),
        this.ledger.batchLevels(farmIds, itemIds),
        this.prisma.farm.findMany({
          where: { id: { in: farmIds } },
          select: { id: true, name: true },
        }),
      ],
    );
    const farmName = new Map(farms.map((f) => [f.id, f.name]));
    const limits = new Map(
      thresholds.map((t) => [levelKey(t.farmId, t.stockItemId), t]),
    );
    const expiry = new Map<string, Date>();
    for (const b of batches) {
      const date = b.batch.expiryDate;
      if (!date || !b.quantity.gt(0)) continue;
      const known = expiry.get(b.batch.stockItemId);
      if (!known || date < known) expiry.set(b.batch.stockItemId, date);
    }
    return items.map((item) => {
      const perFarm = new Map<string, FarmLevel>();
      let quantity = 0;
      let value = 0;
      let minQty = 0;
      let maxQty: number | null = 0;
      let perDay = 0;
      for (const farmId of farmIds) {
        const k = levelKey(farmId, item.id);
        const l = levels.get(k);
        const t = limits.get(k);
        const q = l?.quantity.toNumber() ?? 0;
        const min = t?.minQty.toNumber() ?? 0;
        const max = t?.maxQty?.toNumber() ?? null;
        perFarm.set(farmId, {
          farmId,
          farmName: farmName.get(farmId) ?? '',
          quantity: q,
          minQty: min,
          maxQty: max,
          level: stockLevel(q, min),
          averageCost:
            q > 0 ? (l?.averageCost.toDecimalPlaces(2).toNumber() ?? 0) : 0,
          value: l?.value.toNumber() ?? 0,
        });
        quantity += q;
        value += l?.value.toNumber() ?? 0;
        minQty += min;
        maxQty = maxQty !== null && max !== null ? maxQty + max : null;
        perDay += consumption.get(k)?.toNumber() ?? 0;
      }
      const next = expiry.get(item.id);
      return {
        perFarm,
        row: {
          id: item.id,
          name: item.name,
          category: item.category,
          unit: item.unit,
          active: item.active,
          quantity: round2(quantity),
          minQty: round2(minQty),
          maxQty: maxQty === null ? null : round2(maxQty),
          level: worstLevel([...perFarm.values()].map((f) => f.level)),
          daysOfStock: perDay > 0 ? Math.floor(quantity / perDay) : null,
          averageCost: quantity > 0 ? round2(value / quantity) : 0,
          value: round2(value),
          nextExpiry: next ? formatDay(next) : null,
        },
      };
    });
  }

  /** Arguments for `sendList`: the page, the export and the level counts share one computation. */
  listArgs(ctx: RequestContext, q: StockListQueryDto) {
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    const [field, dir] = Object.entries(order)[0] as [
      keyof StockRow,
      'asc' | 'desc',
    ];
    const computed = (async () => {
      const where: Prisma.StockItemWhereInput = {
        organizationId: ctx.user.organizationId,
        ...(q.category ? { category: q.category } : {}),
        ...(q.search ? { name: containsInsensitive(q.search) } : {}),
      };
      const items = await this.prisma.stockItem.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      // A deactivated article drops out of the list once it holds nothing.
      const rows = (await this.rows(ctx.farmIds, items))
        .map((r) => r.row)
        .filter((r) => r.active || r.quantity > 0);
      const counts = Object.fromEntries(
        STOCK_LEVELS.map((l) => [l, rows.filter((r) => r.level === l).length]),
      );
      const shown = (q.level ? rows.filter((r) => r.level === q.level) : rows)
        .slice()
        .sort(
          (a, b) =>
            compare(a[field], b[field]) * (dir === 'asc' ? 1 : -1) ||
            a.name.localeCompare(b.name),
        );
      return { shown, counts };
    })();
    return {
      find: async (range: { skip?: number; take: number }) => {
        const { shown } = await computed;
        const skip = range.skip ?? 0;
        return shown.slice(skip, skip + range.take);
      },
      count: async () => (await computed).shown.length,
      extra: async () => ({ levelCounts: (await computed).counts }),
    };
  }

  async detail(ctx: RequestContext, itemId: string): Promise<StockDetail> {
    const item = await this.prisma.stockItem.findFirst({
      where: { id: itemId, organizationId: ctx.user.organizationId },
    });
    if (!item) throw new NotFoundException(ITEM_NOT_FOUND);
    const [[{ row, perFarm }], batches, movements] = await Promise.all([
      this.rows(ctx.farmIds, [item]),
      this.ledger.batchLevels(ctx.farmIds, [item.id]),
      this.prisma.stockMovement.findMany({
        where: { stockItemId: item.id, farmId: { in: ctx.farmIds } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: LAST_MOVEMENTS,
        include: { stockItem: true, stockBatch: true },
      }),
    ]);
    const now = today().getTime();
    return {
      ...row,
      farms: [...perFarm.values()],
      batches: batches.map(({ batch, quantity }) => ({
        id: batch.id,
        farmId: batch.farmId,
        lotNumber: batch.lotNumber,
        expiryDate: formatDayOrNull(batch.expiryDate),
        receivedDate: formatDay(batch.receivedDate),
        quantity: quantity.toNumber(),
        expired: batch.expiryDate !== null && batch.expiryDate.getTime() < now,
      })),
      movements: movementItems(movements),
    };
  }

  async setThresholds(
    ctx: RequestContext,
    itemId: string,
    dto: SetThresholdsDto,
  ): Promise<StockRow> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
    const maxQty = dto.maxQty ?? null;
    if (maxQty !== null && maxQty < dto.minQty) {
      throw new BadRequestException(
        'Le seuil maximum doit être supérieur ou égal au seuil minimum',
      );
    }
    const item = await this.prisma.$transaction(async (tx) => {
      const found = await tx.stockItem.findFirst({
        where: { id: itemId, organizationId: ctx.user.organizationId },
      });
      if (!found) throw new NotFoundException(ITEM_NOT_FOUND);
      const { id } = await ensureFarmStockItem(tx, farmId, itemId);
      const before = await tx.farmStockItem.findUniqueOrThrow({
        where: { id },
      });
      const after = await tx.farmStockItem.update({
        where: { id },
        data: { minQty: dto.minQty, maxQty },
      });
      const limits = (t: typeof before) => ({
        minQty: t.minQty.toNumber(),
        maxQty: t.maxQty?.toNumber() ?? null,
      });
      await this.audit.log(
        {
          ctx,
          module: 'stocks',
          action: 'UPDATE',
          farmId,
          recordId: itemId,
          label: `Seuils · ${found.name}`,
          before: limits(before),
          after: limits(after),
        },
        tx,
      );
      return found;
    });
    return (await this.rows([farmId], [item]))[0].row;
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
