import { BadRequestException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import type { Prisma } from '../generated/prisma/client';
import { Species } from '../generated/prisma/enums';
import { OperationTargets, type Target } from '../herd/operation-targets';
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

const toFeedTarget = (t: Target): FeedTarget => ({
  farmId: t.farmId,
  batchId: t.kind === 'LOT' ? t.id : null,
  buildingId: t.kind === 'BATIMENT' ? t.id : null,
  label: t.label,
  entryDate: t.entryDate,
});

const FEED = { module: 'alimentation' } as const;

/**
 * Feed and water go to a lot or a building, never to an animal: this is
 * `OperationTargets` restricted to those two kinds, in the feed's words.
 */
@Injectable()
export class FeedTargets {
  constructor(private readonly targets: OperationTargets) {}

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

  /** For a new record: exactly one of the ids, in the caller's farm, lot open (and locked), `date` valid for it. */
  async resolve(
    tx: Tx,
    ctx: RequestContext,
    ids: { batchId?: string | null; buildingId?: string | null },
    date: Date,
  ): Promise<FeedTarget> {
    if (!ids.batchId === !ids.buildingId) {
      throw new BadRequestException(NEED_TARGET);
    }
    return toFeedTarget(
      await this.targets.resolve(
        tx,
        ctx,
        { batchId: ids.batchId, buildingId: ids.buildingId },
        date,
        FEED,
      ),
    );
  }

  /** For an existing record: its lot is locked and must be open (a 409 otherwise). */
  async forRow(
    tx: Tx,
    ctx: RequestContext,
    row: { batchId: string | null; buildingId: string | null },
  ): Promise<FeedTarget> {
    return toFeedTarget(await this.targets.forRow(tx, ctx, row, FEED));
  }

  /** Not in the future, and not before the lot entered. */
  assertDate(target: FeedTarget, date: Date): void {
    this.targets.assertDate(
      {
        kind: target.batchId ? 'LOT' : 'BATIMENT',
        entryDate: target.entryDate,
      },
      date,
    );
  }
}
