import { BadRequestException, Injectable } from '@nestjs/common';
import { formatDay } from '../common/days';
import { SourceRegistry } from '../common/source-registry';
import type { Prisma } from '../generated/prisma/client';

/** What the guard names a lot or an animal by in its message. */
export type WithdrawalTarget =
  { batchId: string; code: string } | { animalId: string; tag: string };

/**
 * One withdrawal period: the days, `from` to `until` both INCLUSIVE, during
 * which a lot or an animal may not be sold. It starts the day the treatment is
 * done and ends `duration + withdrawal days` later.
 */
export interface WithdrawalPeriod {
  from: Date;
  until: Date;
}

/**
 * Where a lot or an animal stands on withdrawal periods (the days after a
 * treatment during which its meat, eggs or milk may not be sold). The health
 * module registers itself, so `herd` never imports it (same inversion as
 * `BatchHistoryRegistry`).
 */
export interface WithdrawalSource {
  /**
   * The withdrawal periods of many lots and animals in one read, keyed by lot
   * or animal id: one period per done treatment that states a withdrawal, in
   * any order, past ones included. An id with none is absent. A fixed number of
   * queries; read inside `tx` when given (a sale sees the act it just made).
   * The caller has already checked that the lots and animals are in its farm
   * scope.
   */
  withdrawalPeriods(
    ids: { batchIds?: string[]; animalIds?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, WithdrawalPeriod[]>>;
}

/** The periods that cover `date`. */
export const coveringPeriods = (
  periods: WithdrawalPeriod[],
  date: Date,
): WithdrawalPeriod[] =>
  periods.filter(
    (p) =>
      p.from.getTime() <= date.getTime() && date.getTime() <= p.until.getTime(),
  );

const latestEnd = (periods: WithdrawalPeriod[]): Date | undefined =>
  periods.reduce<Date | undefined>(
    (latest, p) => (!latest || p.until > latest ? p.until : latest),
    undefined,
  );

/**
 * The end of the period that matters for a sale dated `date`: the latest end
 * of the periods covering it, else the end of the next one (the earliest to
 * start after it), else the latest end of the past ones; undefined without any.
 */
export function relevantEnd(
  periods: WithdrawalPeriod[],
  date: Date,
): Date | undefined {
  const covering = latestEnd(coveringPeriods(periods, date));
  if (covering) return covering;
  const next = periods
    .filter((p) => p.from.getTime() > date.getTime())
    .sort((a, b) => a.from.getTime() - b.from.getTime())[0];
  return next?.until ?? latestEnd(periods);
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

  /** The periods of many lots and animals over the registered sources, merged by id. */
  async periods(
    ids: { batchIds?: string[]; animalIds?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, WithdrawalPeriod[]>> {
    const merged = new Map<string, WithdrawalPeriod[]>();
    if (!ids.batchIds?.length && !ids.animalIds?.length) return merged;
    for (const source of this.all()) {
      for (const [id, found] of await source.withdrawalPeriods(ids, tx)) {
        const list = merged.get(id) ?? [];
        list.push(...found);
        merged.set(id, list);
      }
    }
    return merged;
  }

  /**
   * Last day, inclusive, a lot or animal is under withdrawal: the latest end of
   * its periods whatever their date (may lie in the past), or null. What the
   * detail screens show.
   */
  async until(
    target: { batchId: string } | { animalId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Date | null> {
    const id = 'batchId' in target ? target.batchId : target.animalId;
    const found = await this.periods(
      'batchId' in target ? { batchIds: [id] } : { animalIds: [id] },
      tx,
    );
    return latestEnd(found.get(id) ?? []) ?? null;
  }

  /**
   * THE guard of every sale line (a lot, the eggs of a lot, an animal): 400
   * when `date` falls INSIDE a withdrawal period of the target, both ends
   * included (`doneDate <= date <= doneDate + duration + withdrawal days`; with
   * several treatments, inside ANY of them). A sale dated before a treatment is
   * not blocked. No override. Read in the caller's transaction; the caller
   * holds the lot or animal lock and health acts take the same lock
   * (`OperationTargets`), so a treatment recorded concurrently is either seen
   * here or waits until the sale is committed.
   */
  async assertClear(
    target: WithdrawalTarget,
    date: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const batch = 'batchId' in target;
    const id = batch ? target.batchId : target.animalId;
    const found = await this.periods(
      batch ? { batchIds: [id] } : { animalIds: [id] },
      tx,
    );
    const until = latestEnd(coveringPeriods(found.get(id) ?? [], date));
    if (!until) return;
    throw new BadRequestException(
      'batchId' in target
        ? lotUnderWithdrawal(target.code, until)
        : animalUnderWithdrawal(target.tag, until),
    );
  }
}
