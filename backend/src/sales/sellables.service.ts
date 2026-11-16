import { SELECT_FARM } from '../common/messages';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { SettingsService } from '../admin/settings/settings.service';
import {
  assertNotFuture,
  formatDay,
  formatDayOrNull,
  requireDay,
} from '../common/days';
import { formatCount } from '../common/format-number';
import { EggStockService } from '../eggs/egg-stock';
import { canLay, LAYING_TYPES } from '../herd/species';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import {
  coveringPeriods,
  relevantEnd,
  WithdrawalRegistry,
  type WithdrawalPeriod,
} from '../herd/withdrawal';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import type {
  SellableKind,
  SellablesQueryDto,
} from './dto/sellables-query.dto';
import { ANIMAL_LABEL, defaultDesignation } from './sale-lines';

/** One source that can be put on a sale line. */
export interface Sellable {
  id: string;
  kind: SellableKind;
  /** What the picker shows: `LC-2026-14 — Poulets de chair (4 820 vivants)`. */
  label: string;
  /** What the line is named when the user types nothing. */
  designation: string;
  /** The unit of the line (`PLATEAU` for eggs, the article's unit), null for lots and animals. */
  unit: string | null;
  /** Live animals, eggs, or the quantity in stock (1 for an animal). */
  available: number;
  /** Eggs only: the eggs of one plateau now (`available` is in eggs). */
  eggsPerTray?: number;
  /** Eggs only: whole plateaux in `available`. */
  availableTrays?: number;
  /** Last day, inclusive, the lot or animal is under withdrawal (may be past), or null. */
  withdrawalUntil: string | null;
  sellable: boolean;
  /** Why it cannot be sold, in French; null when it can. */
  reason: string | null;
}

export const AUCUN_STOCK = 'Aucun stock';
/**
 * The reasons an animal cannot be sold are its status words: the picker names
 * `Gestante` / `Allaitante` to anyone who may read sales (`ventes:read`), who
 * thereby learns the breeding state of a sow without a read right on pigs.
 * Accepted: the reason is what lets the seller understand the refusal.
 */
const GESTANTE = 'Gestante';
const ALLAITANTE = 'Allaitante';
const withdrawalReason = (until: Date): string =>
  `Délai d'attente jusqu'au ${formatDay(until)}`;

/**
 * The sources a sale line can name on a date, for the active farm. Every kind
 * costs a fixed number of queries (one read of the source, one of its
 * availability, one of the withdrawal periods), whatever the number of rows.
 * It reads the tables directly, so it needs no read right on lots, pigs or
 * stock from the caller: the controller's `ventes:read` is the whole gate.
 */
@Injectable()
export class SellablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly herd: HerdLedgerService,
    private readonly withdrawals: WithdrawalRegistry,
    private readonly eggs: EggStockService,
    private readonly stock: StockLedgerService,
    private readonly settings: SettingsService,
  ) {}

  async list(
    ctx: RequestContext,
    q: SellablesQueryDto,
  ): Promise<{ items: Sellable[] }> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException(SELECT_FARM);
    const date = requireDay(q.date);
    assertNotFuture(date);
    switch (q.kind) {
      case 'LOT':
        return { items: await this.lots(farmId, date) };
      case 'ANIMAL':
        return { items: await this.animals(farmId, date) };
      case 'OEUFS':
        return { items: await this.eggLots(ctx, farmId, date) };
      case 'ARTICLE':
        return { items: await this.articles(ctx, farmId, date) };
    }
  }

  /**
   * Where a lot or an animal stands on `date`: blocked when the date falls
   * INSIDE one of its withdrawal periods, and the end of the period that
   * matters (the current one, else the next, else the latest past one).
   */
  private under(periods: WithdrawalPeriod[] | undefined, date: Date) {
    const found = periods ?? [];
    const end = relevantEnd(found, date);
    const blocked = coveringPeriods(found, date).length > 0;
    return {
      withdrawalUntil: formatDayOrNull(end ?? null),
      blocked,
      reason: blocked && end ? withdrawalReason(end) : null,
    };
  }

  private async lots(farmId: string, date: Date): Promise<Sellable[]> {
    const batches = await this.prisma.animalBatch.findMany({
      where: { farmId, status: 'EN_COURS', entryDate: { lte: date } },
      select: { id: true, code: true, type: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    // What a sale on `date` can take, later events included (see `availableAt`).
    const alive = await this.herd.availableAt(
      batches.map((b) => b.id),
      date,
    );
    const open = batches.filter((b) => (alive.get(b.id) ?? 0) > 0);
    const periods = await this.withdrawals.periods({
      batchIds: open.map((b) => b.id),
    });
    return open.map((b) => {
      const n = alive.get(b.id) ?? 0;
      const w = this.under(periods.get(b.id), date);
      const designation = defaultDesignation('LOT', { batchType: b.type });
      return {
        id: b.id,
        kind: 'LOT',
        label: `${b.code} — ${designation} (${formatCount(n)} vivants)`,
        designation,
        unit: null,
        available: n,
        withdrawalUntil: w.withdrawalUntil,
        sellable: !w.blocked,
        reason: w.reason,
      };
    });
  }

  private async animals(farmId: string, date: Date): Promise<Sellable[]> {
    const animals = await this.prisma.animal.findMany({
      where: {
        farmId,
        status: { in: ['ACTIF', 'GESTANTE', 'ALLAITANTE'] },
        OR: [{ birthDate: null }, { birthDate: { lte: date } }],
      },
      select: {
        id: true,
        tag: true,
        category: true,
        status: true,
        breed: { select: { name: true } },
      },
      orderBy: [{ tag: 'asc' }, { id: 'asc' }],
    });
    const periods = await this.withdrawals.periods({
      animalIds: animals.map((a) => a.id),
    });
    return animals.map((a) => {
      const w = this.under(periods.get(a.id), date);
      const category = ANIMAL_LABEL[a.category];
      const reason =
        a.status === 'GESTANTE'
          ? GESTANTE
          : a.status === 'ALLAITANTE'
            ? ALLAITANTE
            : w.reason;
      return {
        id: a.id,
        kind: 'ANIMAL',
        label: `${a.tag} — ${[category, a.breed?.name].filter(Boolean).join(' ')}`,
        designation: defaultDesignation('ANIMAL', {
          animalCategory: a.category,
          tag: a.tag,
        }),
        unit: null,
        available: 1,
        withdrawalUntil: w.withdrawalUntil,
        sellable: reason === null,
        reason,
      };
    });
  }

  private async eggLots(
    ctx: RequestContext,
    farmId: string,
    date: Date,
  ): Promise<Sellable[]> {
    const layers = (
      await this.prisma.animalBatch.findMany({
        where: {
          farmId,
          status: 'EN_COURS',
          entryDate: { lte: date },
          species: 'AVICOLE',
          type: { in: LAYING_TYPES },
        },
        select: { id: true, code: true, species: true, type: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      })
    ).filter(canLay);
    const [available, perTray] = await Promise.all([
      this.eggs.availableMany(
        this.prisma,
        layers.map((b) => b.id),
        date,
      ),
      this.settings.number(ctx.user.organizationId, 'eggsPerTray'),
    ]);
    const stocked = layers.filter((b) => (available.get(b.id) ?? 0) > 0);
    const periods = await this.withdrawals.periods({
      batchIds: stocked.map((b) => b.id),
    });
    return stocked.map((b) => {
      const eggs = available.get(b.id) ?? 0;
      const w = this.under(periods.get(b.id), date);
      return {
        id: b.id,
        kind: 'OEUFS',
        label: `${b.code} — ${formatCount(eggs)} œufs disponibles`,
        designation: defaultDesignation('OEUFS', { unit: 'PLATEAU' }),
        unit: 'PLATEAU',
        available: eggs,
        eggsPerTray: perTray,
        availableTrays: Math.floor(eggs / perTray),
        withdrawalUntil: w.withdrawalUntil,
        sellable: !w.blocked,
        reason: w.reason,
      };
    });
  }

  private async articles(
    ctx: RequestContext,
    farmId: string,
    date: Date,
  ): Promise<Sellable[]> {
    // Every active article that holds stock now; what is sellable on `date` is asked of the ledger.
    const held = await this.prisma.farmStockItem.findMany({
      where: {
        farmId,
        quantity: { gt: 0 },
        stockItem: { active: true, organizationId: ctx.user.organizationId },
      },
      select: {
        stockItemId: true,
        stockItem: { select: { name: true, unit: true } },
      },
      orderBy: [{ stockItem: { name: 'asc' } }, { stockItemId: 'asc' }],
    });
    const sellable = await this.stock.sellableAt(
      farmId,
      held.map((h) => h.stockItemId),
      date,
    );
    return held.map((h) => {
      const available = sellable.get(h.stockItemId)?.toNumber() ?? 0;
      return {
        id: h.stockItemId,
        kind: 'ARTICLE',
        label: `${h.stockItem.name} — ${formatCount(available)} ${h.stockItem.unit}`,
        designation: defaultDesignation('ARTICLE', { name: h.stockItem.name }),
        unit: h.stockItem.unit,
        available,
        withdrawalUntil: null,
        sellable: available > 0,
        reason: available > 0 ? null : AUCUN_STOCK,
      };
    });
  }
}
