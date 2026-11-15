import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { assertNotBeforeBirth, assertNotFuture } from '../common/days';
import { EXITED } from '../common/messages';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { AnimalCategory } from '../generated/prisma/enums';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import {
  AnimalsService,
  assertAfterLastRecord,
  hasRecordAfter,
  PREGNANT_OR_NURSING,
  RECORDED_AFTER_EXIT,
} from './animals.service';

type Tx = Prisma.TransactionClient;

export const NO_LONGER_SOLD = "Cet animal n'est plus vendu par ce document";

/** What sold the animal: a document of the sales module (its id, and its number for the messages). */
export interface SaleSource {
  type: 'SALE';
  id: string;
  label: string;
}

/**
 * Selling and un-selling individual animals for a document of the sales
 * module. The animal leaves the herd as `VENDU` with the document written on
 * it, so the manual `exit` / `reinstate` / delete routes leave it alone and
 * only the same source can put it back.
 *
 * LOCKS: the animal row (`Animal`, `FOR NO KEY UPDATE`) and, on `unsell`, the
 * building and the animal's breeding rows are only read. The caller takes the
 * lots first, then the animals in ascending id order (`lockAnimal`); `sell`
 * re-takes its animal's lock (free when held), `unsell` locks the animals of
 * the source itself, ascending. Neither takes a stock lock.
 */
@Injectable()
export class AnimalSales {
  constructor(
    private readonly ledger: HerdLedgerService,
    private readonly animals: AnimalsService,
  ) {}

  /**
   * Sells one animal on `date`. Only a plain live animal (`ACTIF`) is sold:
   * a pregnant or nursing sow is 409 `PREGNANT_OR_NURSING`, an animal already
   * out is 409 `EXITED`. The dates are those of a manual exit (not in the
   * future, not before the birth, not before its last breeding step, weighing
   * or heat). Pass `farmIds` to refuse an animal outside the caller's farms
   * (400 `Animal invalide`). Returns what the document line is named from.
   *
   * It does NOT check the withdrawal period: the caller must call
   * `WithdrawalRegistry.assertClear` for the animal first (the sales module's
   * `sale-effects` does, and a test goes through the real route).
   */
  async sell(
    tx: Tx,
    animalId: string,
    date: Date,
    source: SaleSource,
    opts: { farmIds?: string[] } = {},
  ): Promise<{ tag: string; category: AnimalCategory; breed: string | null }> {
    await lockRow(tx, 'Animal', animalId, opts.farmIds);
    const animal = await tx.animal.findFirst({
      where: {
        id: animalId,
        ...(opts.farmIds ? { farmId: { in: opts.farmIds } } : {}),
      },
      include: { breed: { select: { name: true } } },
    });
    if (!animal) throw new BadRequestException('Animal invalide');
    if (animal.status === 'GESTANTE' || animal.status === 'ALLAITANTE') {
      throw new ConflictException(PREGNANT_OR_NURSING);
    }
    if (animal.status !== 'ACTIF') throw new ConflictException(EXITED);
    assertNotFuture(date);
    if (animal.birthDate) assertNotBeforeBirth(animal.birthDate, date);
    await assertAfterLastRecord(tx, animal.id, date);
    await tx.animal.update({
      where: { id: animal.id },
      data: {
        status: 'VENDU',
        exitDate: date,
        exitReason: 'VENDU',
        exitSourceType: source.type,
        exitSourceId: source.id,
        exitSourceLabel: source.label,
      },
    });
    return {
      tag: animal.tag,
      category: animal.category,
      breed: animal.breed?.name ?? null,
    };
  }

  /**
   * Puts back, as `ACTIF`, every animal the source sold (nothing to do when
   * there is none). Refused whole (409, nothing changed) when one of them is
   * no longer as it was left: not `VENDU` any more, or something recorded
   * for it since the sale. The building must still take pigs and have room
   * (400). The caller has already taken the lot locks.
   */
  async unsell(tx: Tx, source: SaleSource): Promise<void> {
    const sold = await tx.animal.findMany({
      where: { exitSourceType: source.type, exitSourceId: source.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const { id } of sold) await lockRow(tx, 'Animal', id);
    for (const { id } of sold) {
      const animal = await tx.animal.findUniqueOrThrow({ where: { id } });
      if (
        animal.status !== 'VENDU' ||
        animal.exitSourceType !== source.type ||
        animal.exitSourceId !== source.id
      ) {
        throw new ConflictException(NO_LONGER_SOLD);
      }
      if (animal.exitDate && (await hasRecordAfter(tx, id, animal.exitDate))) {
        throw new ConflictException(RECORDED_AFTER_EXIT);
      }
      await this.animals.assertBuilding(tx, animal.farmId, animal.buildingId);
      await tx.animal.update({
        where: { id },
        data: {
          status: 'ACTIF',
          exitDate: null,
          exitReason: null,
          exitSourceType: null,
          exitSourceId: null,
          exitSourceLabel: null,
        },
      });
      await this.ledger.assertCapacity(tx, animal.farmId, animal.buildingId);
    }
  }
}
