import { Injectable } from '@nestjs/common';
import type { Decimal } from '@prisma/client/runtime/client';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

/** One kind of cost a lot caused (feed, health, ...). */
export interface LotCost {
  /** Open vocabulary shared by sources and readers; the feed module reports `aliment`. */
  category: string;
  /** Cost in FCFA, exact: converted to a number only at the API edge (`toMoney`). */
  amount: Decimal;
  /** Physical quantity behind the cost when there is one (kg of feed). */
  quantity?: number;
}

/** The cost category of the feed given to a lot (`amount` = cost, `quantity` = kg). */
export const FEED_COST = 'aliment';

/** The cost category of the medicines and vaccines used on a lot (`amount` = cost, no `quantity`). */
export const HEALTH_COST = 'sante';

/**
 * Something that knows what a lot cost (the feed and health modules).
 * Sources register themselves so `indicators` never imports them.
 */
export interface LotCostSource {
  /**
   * Costs per lot over the optional date range (both bounds inclusive). A lot
   * the source knows nothing about may be absent from the map.
   */
  costsFor(
    batchIds: string[],
    range?: { from?: Date; to?: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>>;
}

@Injectable()
export class LotCostRegistry extends SourceRegistry<LotCostSource> {
  constructor() {
    super('coûts des lots', { mandatory: true });
  }

  /** The costs of every registered source, merged per lot; every requested lot is present. */
  async costsFor(
    batchIds: string[],
    range?: { from?: Date; to?: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, LotCost[]>> {
    const merged = new Map<string, LotCost[]>(batchIds.map((id) => [id, []]));
    if (batchIds.length === 0) return merged;
    const parts = await Promise.all(
      this.all().map((s) => s.costsFor(batchIds, range, tx)),
    );
    for (const part of parts) {
      for (const [id, costs] of part) merged.get(id)?.push(...costs);
    }
    return merged;
  }
}
