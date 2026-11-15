import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

/**
 * A module that keeps dated records against a batch (egg collections, feed and
 * water). Sources register themselves so `herd` never imports them (same
 * inversion as `OccupationRegistry`); moving a batch's entry date later is
 * refused when any of them holds a record before the new date.
 */
export interface BatchHistorySource {
  /** Date of the batch's earliest record in this source, or null when it has none. */
  earliestDate(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<Date | null>;
}

@Injectable()
export class BatchHistoryRegistry {
  private readonly sources: BatchHistorySource[] = [];

  register(source: BatchHistorySource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  /** Earliest record of the batch over every registered source, or null. */
  async earliestDate(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<Date | null> {
    let earliest: Date | null = null;
    // One query at a time: a transaction owns a single connection.
    for (const source of this.sources) {
      const date = await source.earliestDate(tx, batchId);
      if (date && (!earliest || date < earliest)) earliest = date;
    }
    return earliest;
  }
}
