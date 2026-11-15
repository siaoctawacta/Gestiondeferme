import { BadRequestException, Injectable } from '@nestjs/common';
import { formatDay } from '../common/days';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

/** What the guard names a lot or an animal by in its message. */
export type WithdrawalTarget =
  { batchId: string; code: string } | { animalId: string; tag: string };

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

  /**
   * `withdrawalUntil` of many lots and animals in one read: the end of each
   * (keyed by lot or animal id) that has one. A fixed number of queries.
   */
  withdrawalUntilMany(
    ids: { batchIds?: string[]; animalIds?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, Date>>;
}

export const lotUnderWithdrawal = (code: string, until: Date): string =>
  `Le lot ${code} est en délai d'attente jusqu'au ${formatDay(until)} : vente impossible`;

export const animalUnderWithdrawal = (tag: string, until: Date): string =>
  `L'animal ${tag} est en délai d'attente jusqu'au ${formatDay(until)} : vente impossible`;

@Injectable()
export class WithdrawalRegistry extends SourceRegistry<WithdrawalSource> {
  constructor() {
    super('délais d’attente', { mandatory: true });
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

  /** `until` of many lots and animals at once (one read per source): the latest end of each that has one, by id. */
  async untilMany(
    ids: { batchIds?: string[]; animalIds?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, Date>> {
    const latest = new Map<string, Date>();
    if (!ids.batchIds?.length && !ids.animalIds?.length) return latest;
    for (const source of this.all()) {
      for (const [id, date] of await source.withdrawalUntilMany(ids, tx)) {
        const known = latest.get(id);
        if (!known || date > known) latest.set(id, date);
      }
    }
    return latest;
  }

  /**
   * THE guard of every sale line (a lot, the eggs of a lot, an animal): 400
   * when the target is under withdrawal on `date`, the last day included. No
   * override. Judged on the date of the sale, read in the caller's
   * transaction. The caller holds the lot or animal lock; health acts take the
   * same lock (`OperationTargets`), so a treatment recorded concurrently is
   * either seen here or waits until the sale is committed.
   */
  async assertClear(
    target: WithdrawalTarget,
    date: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if ('batchId' in target) {
      const until = await this.until({ batchId: target.batchId }, tx);
      if (until && until.getTime() >= date.getTime()) {
        throw new BadRequestException(lotUnderWithdrawal(target.code, until));
      }
      return;
    }
    const until = await this.until({ animalId: target.animalId }, tx);
    if (until && until.getTime() >= date.getTime()) {
      throw new BadRequestException(animalUnderWithdrawal(target.tag, until));
    }
  }
}
