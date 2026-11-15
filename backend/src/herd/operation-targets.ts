import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AccessService } from '../access/access.service';
import type { RequestContext } from '../access/decorators';
import type { ModuleKey } from '../access/permissions';
import {
  assertNotBeforeBirth,
  assertNotBeforeEntry,
  assertNotFuture,
} from '../common/days';
import { EXITED } from '../common/messages';
import type { Prisma } from '../generated/prisma/client';
import type { Species } from '../generated/prisma/enums';
import { AnimalTargetRegistry } from './animal-target';
import { HerdLedgerService } from './herd-ledger.service';
import { speciesModule } from './species';

type Tx = Prisma.TransactionClient;

export const NEED_TARGET = 'Indiquez un lot, un animal ou un bâtiment';

export type TargetKind = 'LOT' | 'ANIMAL' | 'BATIMENT';

/** The lot, animal or building a daily operation (feed, treatment, ...) is recorded on. */
export interface Target {
  kind: TargetKind;
  id: string;
  farmId: string;
  /** Lot code, animal tag or building name. */
  label: string;
  /** Absent for a building, which houses both species. */
  species?: Species;
  /** Where the target is housed; the building's own id for a building. */
  buildingId: string;
  /** Entry date of a lot or birth date of an animal: operations may not predate it. */
  entryDate: Date | null;
}

/** Exactly one of the ids names the target. */
export interface TargetIds {
  batchId?: string | null;
  animalId?: string | null;
  buildingId?: string | null;
}

export interface TargetOptions {
  /** The module of the operation: the caller must be able to read it. */
  module: ModuleKey;
}

/**
 * Loads and guards what a daily operation points at: one open lot, one animal
 * still on the farm, or one building, always of the caller's farm. A lot or an
 * animal is locked until the transaction ends, so the operation and the
 * target's closing or exit cannot interleave; reading it needs `read` on its
 * species module (`lots` or `porcs`) on top of the operation's own permission.
 */
@Injectable()
export class OperationTargets {
  constructor(
    private readonly ledger: HerdLedgerService,
    private readonly access: AccessService,
    private readonly animals: AnimalTargetRegistry,
  ) {}

  /**
   * For a new record: exactly one id, in the request's farm (a foreign or
   * unknown id is a 400), the target open, and `date` neither in the future
   * nor before the lot's entry or the animal's birth.
   */
  async resolve(
    tx: Tx,
    ctx: RequestContext,
    ids: TargetIds,
    date: Date,
    opts: TargetOptions,
  ): Promise<Target> {
    const given = [ids.batchId, ids.animalId, ids.buildingId].filter(Boolean);
    if (given.length !== 1 || !ctx.farmId) {
      throw new BadRequestException(NEED_TARGET);
    }
    this.access.assertCan(ctx, opts.module, 'read');
    const target = await this.load(tx, ctx, ids, [ctx.farmId], true);
    this.assertDate(target, date);
    return target;
  }

  /** For an existing record: its lot or animal is locked and must still be open (409 otherwise). */
  forRow(
    tx: Tx,
    ctx: RequestContext,
    row: TargetIds,
    opts: TargetOptions,
  ): Promise<Target> {
    this.access.assertCan(ctx, opts.module, 'read');
    return this.load(tx, ctx, row, ctx.farmIds, false);
  }

  /** Not in the future, and not before the lot entered or the animal was born. */
  assertDate(target: Pick<Target, 'kind' | 'entryDate'>, date: Date): void {
    assertNotFuture(date);
    if (!target.entryDate) return;
    if (target.kind === 'ANIMAL') assertNotBeforeBirth(target.entryDate, date);
    else assertNotBeforeEntry(target.entryDate, date);
  }

  private async load(
    tx: Tx,
    ctx: RequestContext,
    ids: TargetIds,
    farmIds: string[],
    foreignIsInvalid: boolean,
  ): Promise<Target> {
    if (ids.batchId) {
      if (foreignIsInvalid) {
        const found = await tx.animalBatch.findFirst({
          where: { id: ids.batchId, farmId: { in: farmIds } },
          select: { id: true },
        });
        if (!found) throw new BadRequestException('Lot invalide');
      }
      const batch = await this.ledger.lockBatch(tx, ids.batchId, farmIds);
      this.access.assertCan(ctx, speciesModule(batch.species), 'read');
      this.ledger.assertOpen(batch);
      return {
        kind: 'LOT',
        id: batch.id,
        farmId: batch.farmId,
        label: batch.code,
        species: batch.species,
        buildingId: batch.buildingId,
        entryDate: batch.entryDate,
      };
    }
    if (ids.animalId) {
      const animal = await this.animals
        .single()
        .lockAnimal(tx, ids.animalId, farmIds);
      if (!animal) throw new BadRequestException('Animal invalide');
      this.access.assertCan(ctx, speciesModule(animal.species), 'read');
      if (!animal.active) throw new ConflictException(EXITED);
      return {
        kind: 'ANIMAL',
        id: animal.id,
        farmId: animal.farmId,
        label: animal.label,
        species: animal.species,
        buildingId: animal.buildingId,
        entryDate: animal.birthDate,
      };
    }
    const building = await tx.building.findFirst({
      where: { id: ids.buildingId ?? '', farmId: { in: farmIds } },
      select: { id: true, name: true, farmId: true },
    });
    if (!building) throw new BadRequestException('Bâtiment invalide');
    return {
      kind: 'BATIMENT',
      id: building.id,
      farmId: building.farmId,
      label: building.name,
      buildingId: building.id,
      entryDate: null,
    };
  }
}
