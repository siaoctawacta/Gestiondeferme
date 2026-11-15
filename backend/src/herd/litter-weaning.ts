import { Injectable } from '@nestjs/common';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

/** A weaning recorded against a litter batch: `count` piglets were weaned on `date`. */
export interface LitterWeaning {
  date: Date;
  count: number;
}

/**
 * A module that records weanings of litters. It registers itself so `herd`
 * never imports it (same inversion as `BatchHistoryRegistry`); the herd ledger
 * refuses any change that would leave a weaned litter with fewer live animals,
 * on its weaning date, than were weaned.
 */
export interface LitterWeaningSource {
  /** The weaning recorded for the batch, or null when it is not a weaned litter. */
  weaningOf(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<LitterWeaning | null>;
}

@Injectable()
export class LitterWeaningRegistry extends SourceRegistry<LitterWeaningSource> {
  constructor() {
    super('sevrage des portées');
  }

  /** The batch's weaning over the registered sources (a batch is the litter of at most one record), or null. */
  async weaningOf(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<LitterWeaning | null> {
    // One query at a time: a transaction owns a single connection.
    for (const source of this.all()) {
      const weaning = await source.weaningOf(tx, batchId);
      if (weaning) return weaning;
    }
    return null;
  }
}
