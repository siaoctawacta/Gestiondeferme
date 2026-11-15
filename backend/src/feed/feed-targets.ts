import { BadRequestException, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import type { Prisma } from '../generated/prisma/client';
import { Species } from '../generated/prisma/enums';
import { assertNotBeforeEntry, assertNotFuture } from '../common/days';
import { HerdLedgerService } from '../herd/herd-ledger.service';
import { speciesModule } from '../herd/species';

type Tx = Prisma.TransactionClient;

export const NEED_TARGET = 'Indiquez un lot ou un bâtiment';

/** What a distribution or a water record is for: one open lot or one building of a farm. */
export interface FeedTarget {
  farmId: string;
  batchId: string | null;
  buildingId: string | null;
  /** Lot code or building name. */
  label: string;
  /** Entry date of the lot (null for a building): records may not predate it. */
  entryDate: Date | null;
}

/** Loads and guards the lot or building a feed/water record points at. */
@Injectable()
export class FeedTargets {
  constructor(
    private readonly ledger: HerdLedgerService,
    private readonly access: AccessService,
  ) {}

  /**
   * Rows of a distribution or water list the caller may see: those aimed at a
   * building, and those aimed at a lot whose species module the role can read.
   * Feeding a lot needs `read` on its species module (`lots` or `porcs`) on
   * top of the `alimentation` permission, so the two lists never show the
   * other species' lots to a role that cannot see them.
   */
  visibleRows(ctx: RequestContext): {
    OR?: ({ batchId: null } | { batch: { species: { in: Species[] } } })[];
  } {
    const species = (['AVICOLE', 'PORCIN'] as const).filter((s) =>
      can(ctx.user.role, speciesModule(s), 'read'),
    );
    if (species.length === 2) return {};
    return {
      OR: [
        { batchId: null },
        ...(species.length ? [{ batch: { species: { in: species } } }] : []),
      ],
    };
  }

  /** For a new record: exactly one of the ids, in the caller's farm, lot open (and locked). */
  async resolve(
    tx: Tx,
    ctx: RequestContext,
    ids: { batchId?: string | null; buildingId?: string | null },
  ): Promise<FeedTarget> {
    if (!ids.batchId === !ids.buildingId) {
      throw new BadRequestException(NEED_TARGET);
    }
    if (!ctx.farmId) throw new BadRequestException(NEED_TARGET);
    if (ids.batchId) {
      const found = await tx.animalBatch.findFirst({
        where: { id: ids.batchId, farmId: ctx.farmId },
        select: { id: true },
      });
      if (!found) throw new BadRequestException('Lot invalide');
      return this.lot(tx, ctx, ids.batchId, [ctx.farmId]);
    }
    const building = await tx.building.findFirst({
      where: { id: ids.buildingId ?? '', farmId: ctx.farmId },
      select: { id: true, name: true, farmId: true },
    });
    if (!building) throw new BadRequestException('Bâtiment invalide');
    return {
      farmId: building.farmId,
      batchId: null,
      buildingId: building.id,
      label: building.name,
      entryDate: null,
    };
  }

  /** For an existing record: its lot is locked and must be open (a 409 otherwise). */
  async forRow(
    tx: Tx,
    ctx: RequestContext,
    row: { farmId: string; batchId: string | null; buildingId: string | null },
  ): Promise<FeedTarget> {
    if (row.batchId) return this.lot(tx, ctx, row.batchId, ctx.farmIds);
    const building = await tx.building.findUniqueOrThrow({
      where: { id: row.buildingId ?? '' },
      select: { name: true },
    });
    return {
      farmId: row.farmId,
      batchId: null,
      buildingId: row.buildingId,
      label: building.name,
      entryDate: null,
    };
  }

  private async lot(
    tx: Tx,
    ctx: RequestContext,
    batchId: string,
    farmIds: string[],
  ): Promise<FeedTarget> {
    const batch = await this.ledger.lockBatch(tx, batchId, farmIds);
    this.access.assertCan(ctx, speciesModule(batch.species), 'read');
    this.ledger.assertOpen(batch);
    return {
      farmId: batch.farmId,
      batchId: batch.id,
      buildingId: null,
      label: batch.code,
      entryDate: batch.entryDate,
    };
  }

  /** Not in the future, and not before the lot entered. */
  assertDate(target: FeedTarget, date: Date): void {
    assertNotFuture(date);
    if (target.entryDate) assertNotBeforeEntry(target.entryDate, date);
  }
}
