import { Injectable } from '@nestjs/common';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

/**
 * Where a lot or an animal stands on withdrawal periods (the days after a
 * treatment during which its meat, eggs or milk may not be sold). The health
 * module registers itself, so `herd` never imports it (same inversion as
 * `BatchHistoryRegistry`).
 */
export interface WithdrawalSource {
  /**
   * Last day, inclusive, the lot or animal is under withdrawal: the latest end
   * among its done treatments (done date + duration + withdrawal days), or
   * null when none has a withdrawal period. May lie in the past. The caller
   * has already checked that the lot or animal is in its farm scope.
   */
  withdrawalUntil(
    target: { batchId: string } | { animalId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Date | null>;
}

@Injectable()
export class WithdrawalRegistry extends SourceRegistry<WithdrawalSource> {
  constructor() {
    super('délais d’attente');
  }

  /** Latest end over the registered sources, or null (also when none is registered). */
  async until(
    target: { batchId: string } | { animalId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Date | null> {
    let latest: Date | null = null;
    for (const source of this.all()) {
      const date = await source.withdrawalUntil(target, tx);
      if (date && (!latest || date > latest)) latest = date;
    }
    return latest;
  }
}
