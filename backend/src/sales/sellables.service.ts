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
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { WithdrawalRegistry } from '../herd/withdrawal';
import { PrismaService } from '../prisma/prisma.service';
import { StockLedgerService } from '../stock/stock-ledger.service';
import type {
  SellableKind,
  SellablesQueryDto,
} from './dto/sellables-query.dto';
import { ANIMAL_LABEL, canLay, defaultDesignation } from './sale-lines';

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
    if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
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

  private under(until: Date | undefined, date: Date) {
    const blocked = !!until && until.getTime() >= date.getTime();
    return {
      withdrawalUntil: formatDayOrNull(until ?? null),
      blocked,
      reason: blocked && until ? withdrawalReason(until) : null,
    };
  }

  private async lots(farmId: string, date: Date): Promise<Sellable[]> {
    const batches = await this.prisma.animalBatch.findMany({
      where: { farmId, status: 'EN_COURS', entryDate: { lte: date } },
      select: { id: true, code: true, type: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    const alive = await this.herd.liveCounts(
      batches.map((b) => b.id),
      date,
    );
    const open = batches.filter((b) => (alive.get(b.id) ?? 0) > 0);
    const until = await this.withdrawals.untilMany({
      batchIds: open.map((b) => b.id),
    });
    return open.map((b) => {
      const n = alive.get(b.id) ?? 0;
      const w = this.under(until.get(b.id), date);
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
    const until = await this.withdrawals.untilMany({
      animalIds: animals.map((a) => a.id),
    });
    return animals.map((a) => {
      const w = this.under(until.get(a.id), date);
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
          type: { in: ['PONDEUSE', 'REPRODUCTEUR'] },
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
    const until = await this.withdrawals.untilMany({
      batchIds: stocked.map((b) => b.id),
    });
    return stocked.map((b) => {
      const eggs = available.get(b.id) ?? 0;
      const w = this.under(until.get(b.id), date);
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
    const levels = await this.stock.levels([farmId]);
    const held = [...levels]
      .filter(([, level]) => level.quantity.gt(0))
      .map(([key]) => key.slice(farmId.length + 1));
    if (held.length === 0) return [];
    const items = await this.prisma.stockItem.findMany({
      where: {
        id: { in: held },
        organizationId: ctx.user.organizationId,
        active: true,
      },
      select: { id: true, name: true, unit: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    // What is held in lots that are past their expiry on the date cannot be sold.
    const batches = await this.stock.batchLevels(
      [farmId],
      items.map((i) => i.id),
    );
    const expired = new Map<string, number>();
    for (const { batch, quantity } of batches) {
      if (
        batch.expiryDate &&
        batch.expiryDate.getTime() < date.getTime() &&
        quantity.gt(0)
      ) {
        expired.set(
          batch.stockItemId,
          (expired.get(batch.stockItemId) ?? 0) + quantity.toNumber(),
        );
      }
    }
    return items.map((i) => {
      const level = levels.get(`${farmId}:${i.id}`)?.quantity.toNumber() ?? 0;
      const available = Math.max(
        0,
        Math.round((level - (expired.get(i.id) ?? 0)) * 100) / 100,
      );
      return {
        id: i.id,
        kind: 'ARTICLE',
        label: `${i.name} — ${formatCount(available)} ${i.unit}`,
        designation: defaultDesignation('ARTICLE', { name: i.name }),
        unit: i.unit,
        available,
        withdrawalUntil: null,
        sellable: available > 0,
        reason: available > 0 ? null : AUCUN_STOCK,
      };
    });
  }
}
