import { BadRequestException, Injectable } from '@nestjs/common';
import { lockRow } from '../common/lock-row';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';
import {
  eggAvailable,
  eggShortfall,
  type EggOutflowDay,
  type EggProductionDay,
} from './egg-balance';

type Tx = Prisma.TransactionClient;

export const EGGS_SOLD =
  'Ces œufs sont déjà vendus : la production commercialisable ne peut pas descendre sous les ventes';

export const notEnoughEggs = (code: string, available: number): string =>
  `Œufs disponibles insuffisants pour ${code} (${available} disponibles)`;

/**
 * What leaves the egg balance of a lot: sales. `eggs` does not keep a ledger
 * of its own (the balance is derived), so whoever sells eggs registers here
 * (`sales`: the egg lines of invoices that count, and, negative, the returns of
 * credit notes), and reads happen inside the caller's transaction.
 */
export interface EggOutflowSource {
  /**
   * The outflows of the lots, with the document (`sourceId`) each belongs to.
   * `excludeSourceId` leaves one document out (the one being re-checked).
   */
  outflows(
    tx: Tx,
    batchIds: string[],
    opts?: { excludeSourceId?: string },
  ): Promise<{ batchId: string; date: Date; eggs: number; sourceId: string }[]>;
}

@Injectable()
export class EggOutflowRegistry extends SourceRegistry<EggOutflowSource> {
  constructor() {
    super('sorties d’œufs');
  }

  async outflows(
    tx: Tx,
    batchIds: string[],
    opts?: { excludeSourceId?: string },
  ) {
    const found: Awaited<ReturnType<EggOutflowSource['outflows']>> = [];
    if (batchIds.length === 0) return found;
    // One query at a time: a transaction owns a single connection.
    for (const source of this.all()) {
      found.push(...(await source.outflows(tx, batchIds, opts)));
    }
    return found;
  }
}

/**
 * The egg balance of a laying lot: Σ marketable production minus Σ outflows,
 * never negative on any day of its history. Owned by `eggs`; it takes the
 * caller's transaction and, when it writes nothing, the lot lock:
 *
 * - LOCKS: the lot row (`AnimalBatch`, the same lock every herd, egg and sale
 *   write takes). A caller locks its lots first, ascending id
 *   (`HerdLedgerService.lockBatches`); `assertSale` / `assertProduction`
 *   re-take it for the lot they check (free when held), so an egg sale and an
 *   edit of the production of that lot serialise, and two sales race one at
 *   a time. No other lock is taken.
 */
@Injectable()
export class EggStockService {
  constructor(private readonly outflowRegistry: EggOutflowRegistry) {}

  private async history(
    tx: Tx,
    batchIds: string[],
    opts?: { excludeSourceId?: string },
  ) {
    const production = new Map<string, EggProductionDay[]>();
    const outflows = new Map<string, EggOutflowDay[]>();
    for (const id of batchIds) {
      production.set(id, []);
      outflows.set(id, []);
    }
    if (batchIds.length === 0) return { production, outflows };
    const rows = await tx.eggProduction.findMany({
      where: { batchId: { in: batchIds } },
      select: {
        batchId: true,
        date: true,
        collected: true,
        broken: true,
        downgraded: true,
        toIncubation: true,
      },
    });
    for (const r of rows) {
      production.get(r.batchId)?.push({
        date: r.date,
        marketable: r.collected - r.broken - r.downgraded - r.toIncubation,
      });
    }
    for (const o of await this.outflowRegistry.outflows(tx, batchIds, opts)) {
      outflows.get(o.batchId)?.push({ date: o.date, eggs: o.eggs });
    }
    return { production, outflows };
  }

  /** The eggs of each lot a sale dated `date` may still take (see `eggAvailable`); one query per source, whatever the lots. */
  async availableMany(
    tx: Tx,
    batchIds: string[],
    date: Date,
  ): Promise<Map<string, number>> {
    const { production, outflows } = await this.history(tx, batchIds);
    return new Map(
      batchIds.map((id) => [
        id,
        eggAvailable(production.get(id) ?? [], outflows.get(id) ?? [], date),
      ]),
    );
  }

  async available(tx: Tx, batchId: string, date: Date): Promise<number> {
    return (await this.availableMany(tx, [batchId], date)).get(batchId) ?? 0;
  }

  /**
   * 400 `Œufs disponibles insuffisants pour {code} ({n} disponibles)` when
   * selling `sales` (ALL the egg lines of the lot of one document) would
   * leave the lot's balance negative on any day. `excludeSourceId`: the
   * document being re-checked, whose own outflows are already registered.
   */
  async assertSale(
    tx: Tx,
    batch: { id: string; code: string },
    sales: EggOutflowDay[],
    opts?: { excludeSourceId?: string },
  ): Promise<void> {
    if (sales.length === 0) return;
    await lockRow(tx, 'AnimalBatch', batch.id);
    const { production, outflows } = await this.history(tx, [batch.id], opts);
    const registered = outflows.get(batch.id) ?? [];
    const lot = production.get(batch.id) ?? [];
    if (!eggShortfall(lot, [...registered, ...sales])) return;
    const first = new Date(Math.min(...sales.map((s) => s.date.getTime())));
    throw new BadRequestException(
      notEnoughEggs(batch.code, eggAvailable(lot, registered, first)),
    );
  }

  /**
   * 400 `EGGS_SOLD` when `next`, the lot's WHOLE marketable production after
   * a create, edit or delete of a record, would fall under what was sold on
   * any day. Called under the lot lock the production service takes.
   */
  async assertProduction(
    tx: Tx,
    batchId: string,
    next: EggProductionDay[],
  ): Promise<void> {
    await lockRow(tx, 'AnimalBatch', batchId);
    const { outflows } = await this.history(tx, [batchId]);
    if (eggShortfall(next, outflows.get(batchId) ?? [])) {
      throw new BadRequestException(EGGS_SOLD);
    }
  }
}
