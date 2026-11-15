import { Injectable } from '@nestjs/common';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

/**
 * Something that houses animals in buildings (batches here, individual animals
 * in the pig module). Sources register themselves so `herd` never imports them.
 */
export interface OccupationSource {
  /** Animals currently housed per building; `tx` reads through a running transaction. */
  occupationByBuilding(
    farmIds: string[],
    buildingIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>>;
}

@Injectable()
export class OccupationRegistry extends SourceRegistry<OccupationSource> {
  constructor() {
    super('occupation', { mandatory: true });
  }

  /** Sum over every registered source; every requested building is present in the result. */
  async occupationByBuilding(
    farmIds: string[],
    buildingIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>> {
    const total = new Map(buildingIds.map((id) => [id, 0]));
    if (buildingIds.length === 0) return total;
    const parts = await Promise.all(
      this.all().map((s) => s.occupationByBuilding(farmIds, buildingIds, tx)),
    );
    for (const part of parts) {
      for (const [id, n] of part) total.set(id, (total.get(id) ?? 0) + n);
    }
    return total;
  }
}
