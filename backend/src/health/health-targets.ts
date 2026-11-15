import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { assertNotBeforeBirth, assertNotBeforeEntry } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import type { Species } from '../generated/prisma/enums';
import {
  OperationTargets,
  type Target,
  type TargetIds,
} from '../herd/operation-targets';
import { AnimalTargetRegistry } from '../herd/animal-target';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { speciesModule } from '../herd/species';

type Tx = Prisma.TransactionClient;

const SANTE = { module: 'sante' } as const;

/**
 * Health records point at a lot, an animal or a building through
 * `OperationTargets` (module `sante`): the target is of the request's farm, a
 * lot or animal is locked until the transaction ends, and reading it needs
 * `read` on its species module (`lots` / `porcs`) on top of the `sante` right.
 * So a poultry manager may not record on a pig lot, and a veterinarian (who
 * reads every production module) may on both species.
 */
@Injectable()
export class HealthTargets {
  constructor(
    private readonly targets: OperationTargets,
    private readonly ledger: HerdLedgerService,
    private readonly animals: AnimalTargetRegistry,
  ) {}

  /** The species whose lots the caller may read. */
  private species(ctx: RequestContext): Species[] {
    return (['AVICOLE', 'PORCIN'] as const).filter((s) =>
      can(ctx.user.role, speciesModule(s), 'read'),
    );
  }

  /**
   * Rows aimed at a lot the caller may not read (the other species' lots) are
   * invisible to them: lists leave them out and a direct access is a 404.
   */
  visibleBatch(ctx: RequestContext): {
    OR?: ({ batchId: null } | { batch: { species: { in: Species[] } } })[];
  } {
    const species = this.species(ctx);
    if (species.length === 2) return {};
    return {
      OR: [
        { batchId: null },
        ...(species.length ? [{ batch: { species: { in: species } } }] : []),
      ],
    };
  }

  /** Animals are pigs: rows aimed at one need `read` on `porcs`. */
  visibleAnimal(ctx: RequestContext): { animalId?: null } {
    return can(ctx.user.role, 'porcs', 'read') ? {} : { animalId: null };
  }

  /**
   * For a new record: exactly one id, in the request's farm (400 otherwise),
   * the lot or animal open and locked. `date` is the day the record states: not
   * in the future and not before the lot entered or the animal was born.
   */
  resolve(
    tx: Tx,
    ctx: RequestContext,
    ids: TargetIds,
    date: Date,
  ): Promise<Target> {
    return this.targets.resolve(tx, ctx, ids, date, SANTE);
  }

  /** For an existing record: its lot or animal is locked and must still be open (409 otherwise). */
  forRow(tx: Tx, ctx: RequestContext, row: TargetIds): Promise<Target> {
    return this.targets.forRow(tx, ctx, row, SANTE);
  }

  /**
   * Locks the lot or animal of a row WITHOUT requiring it to be open: what
   * cancelling or deleting a planned act needs (no stock is involved), so a
   * lot closed or an animal gone does not strand its planned acts.
   */
  async lockAny(tx: Tx, ctx: RequestContext, row: TargetIds): Promise<void> {
    if (row.batchId) await this.ledger.lockBatch(tx, row.batchId, ctx.farmIds);
    else if (row.animalId) {
      await this.animals.single().lockAnimal(tx, row.animalId, ctx.farmIds);
    }
  }

  /** `date` valid for the target: not in the future, not before it existed. */
  assertDate(target: Pick<Target, 'kind' | 'entryDate'>, date: Date): void {
    this.targets.assertDate(target, date);
  }

  /** A planned date may lie in the future, but not before the lot entered or the animal was born. */
  assertNotBeforeStart(
    target: Pick<Target, 'kind' | 'entryDate'>,
    date: Date,
  ): void {
    if (!target.entryDate) return;
    if (target.kind === 'ANIMAL') assertNotBeforeBirth(target.entryDate, date);
    else assertNotBeforeEntry(target.entryDate, date);
  }

  /** The request's farm's building named in a body (400 when it is not one of its buildings). */
  async building(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<{ id: string; name: string }> {
    const building = await tx.building.findFirst({
      where: { id, farmId: { in: ctx.farmId ? [ctx.farmId] : [] } },
      select: { id: true, name: true },
    });
    if (!building) throw new BadRequestException('Bâtiment invalide');
    return building;
  }
}
