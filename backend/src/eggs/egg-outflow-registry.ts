import { Injectable } from '@nestjs/common';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * What leaves the egg balance of a lot: sales. `eggs` does not keep a ledger
 * of its own (the balance is derived), so whoever sells eggs registers here
 * (`sales`: the egg lines of invoices that count, and, negative, the returns of
 * credit notes), and reads happen inside the caller's transaction.
 */
export interface EggOutflowSource {
  /**
   * The outflows of the lots, with the document (`sourceId`) each belongs to.
   */
  outflows(
    tx: Tx,
    batchIds: string[],
  ): Promise<{ batchId: string; date: Date; eggs: number; sourceId: string }[]>;
}

@Injectable()
export class EggOutflowRegistry extends SourceRegistry<EggOutflowSource> {
  constructor() {
    super('sorties d’œufs', { mandatory: true });
  }

  async outflows(tx: Tx, batchIds: string[]) {
    const found: Awaited<ReturnType<EggOutflowSource['outflows']>> = [];
    if (batchIds.length === 0) return found;
    // One query at a time: a transaction owns a single connection.
    for (const source of this.all()) {
      found.push(...(await source.outflows(tx, batchIds)));
    }
    return found;
  }
}
