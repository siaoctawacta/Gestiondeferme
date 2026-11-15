import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { SettingsService } from '../admin/settings/settings.service';
import { lineAmount, sumAmounts } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type { SaleLineKind } from '../generated/prisma/enums';
import { MAX_PAYMENT } from '../purchases/dto/purchase.dto';
import type { SaleLineDto } from './dto/sale-line.dto';
import {
  defaultDesignation,
  lineShapeError,
  type LineSource,
} from './sale-lines';

type Tx = Prisma.TransactionClient;

const LOT_INVALID = 'Lot invalide pour cette ferme';
const ANIMAL_INVALID = 'Animal invalide pour cette ferme';
const ITEM_INVALID = 'Article invalide';
const ITEM_INACTIVE = 'Article inactif';
const EGG_UNIT = "L'unité des œufs est invalide";
const TOO_BIG = 'Le montant total est trop élevé';
/** Under the payment cap, so a document can always be paid in one payment and its total is safe as a JS number. */
const MAX_TOTAL = new Decimal(MAX_PAYMENT);

/** A line ready to store (the columns of `QuoteLine` and `InvoiceLine`). */
export interface ResolvedLine {
  position: number;
  kind: SaleLineKind;
  batchId: string | null;
  animalId: string | null;
  stockItemId: string | null;
  eggsPerUnit: number | null;
  designation: string;
  unit: string | null;
  quantity: Decimal;
  unitPrice: Decimal;
  amount: Decimal;
  weightKg: Decimal | null;
}

/** What stored lines are compared on to tell a real change from a no-op. */
type StoredLine = Omit<ResolvedLine, 'position'> & { position?: number };

export const sameLines = (
  stored: StoredLine[],
  next: ResolvedLine[],
): boolean =>
  stored.length === next.length &&
  stored.every((s, i) => {
    const n = next[i];
    return (
      s.kind === n.kind &&
      s.batchId === n.batchId &&
      s.animalId === n.animalId &&
      s.stockItemId === n.stockItemId &&
      s.eggsPerUnit === n.eggsPerUnit &&
      s.designation === n.designation &&
      s.unit === n.unit &&
      s.quantity.eq(n.quantity) &&
      s.unitPrice.eq(n.unitPrice) &&
      (s.weightKg === null || n.weightKg === null
        ? s.weightKg === n.weightKg
        : s.weightKg.eq(n.weightKg))
    );
  });

/**
 * Turns the lines of a request into stored lines, for quotes and (later)
 * invoice drafts: the shape of each line, its source checked against the
 * ACTIVE FARM (lots, animals) or the ORGANISATION (articles) with a 400 —
 * never a 404 for an id of a body —, the designation, the unit, the eggs per
 * unit snapshotted from the `eggsPerTray` setting, and every amount from the
 * one money module. Availability is not looked at here: a quote is not a sale.
 */
@Injectable()
export class SaleLineResolver {
  constructor(private readonly settings: SettingsService) {}

  async resolve(
    tx: Tx,
    ctx: RequestContext,
    farmId: string,
    lines: SaleLineDto[],
  ): Promise<{ lines: ResolvedLine[]; total: Decimal }> {
    for (const line of lines) {
      const error = lineShapeError(line);
      if (error) throw new BadRequestException(error);
    }
    const organizationId = ctx.user.organizationId;
    const ids = (pick: (l: SaleLineDto) => string | null | undefined) => [
      ...new Set(lines.map(pick).filter((id): id is string => !!id)),
    ];
    const batchIds = ids((l) => l.batchId);
    const animalIds = ids((l) => l.animalId);
    const itemIds = ids((l) => l.stockItemId);
    const [batches, animals, items] = await Promise.all([
      tx.animalBatch.findMany({
        where: { id: { in: batchIds }, farmId },
        select: { id: true, species: true, type: true },
      }),
      tx.animal.findMany({
        where: { id: { in: animalIds }, farmId },
        select: { id: true, tag: true, category: true },
      }),
      tx.stockItem.findMany({
        where: { id: { in: itemIds }, organizationId },
        select: { id: true, name: true, unit: true, active: true },
      }),
    ]);
    if (batches.length !== batchIds.length) {
      throw new BadRequestException(LOT_INVALID);
    }
    if (animals.length !== animalIds.length) {
      throw new BadRequestException(ANIMAL_INVALID);
    }
    if (items.length !== itemIds.length) {
      throw new BadRequestException(ITEM_INVALID);
    }
    if (items.some((i) => !i.active)) {
      throw new BadRequestException(ITEM_INACTIVE);
    }
    const batchById = new Map(batches.map((b) => [b.id, b]));
    const animalById = new Map(animals.map((a) => [a.id, a]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const eggsPerTray = lines.some((l) => l.kind === 'OEUFS')
      ? await this.settings.number(organizationId, 'eggsPerTray', tx)
      : 0;

    const resolved = lines.map((l, position): ResolvedLine => {
      const batch = l.batchId ? batchById.get(l.batchId) : undefined;
      const animal = l.animalId ? animalById.get(l.animalId) : undefined;
      const item = l.stockItemId ? itemById.get(l.stockItemId) : undefined;
      let unit = l.unit || null;
      let eggsPerUnit: number | null = null;
      if (l.kind === 'OEUFS') {
        unit = unit ?? 'PLATEAU';
        if (unit !== 'PLATEAU' && unit !== 'OEUF') {
          throw new BadRequestException(EGG_UNIT);
        }
        eggsPerUnit = unit === 'PLATEAU' ? eggsPerTray : 1;
      } else if (l.kind === 'ARTICLE') {
        unit = unit ?? item?.unit ?? null;
      }
      const source: LineSource = {
        batchType: batch?.type,
        animalCategory: animal?.category,
        tag: animal?.tag,
        unit,
        name: item?.name,
      };
      return {
        position,
        kind: l.kind,
        batchId: l.batchId || null,
        animalId: l.animalId || null,
        stockItemId: l.stockItemId || null,
        eggsPerUnit,
        designation:
          l.designation?.trim() || defaultDesignation(l.kind, source),
        unit,
        quantity: new Decimal(l.quantity),
        unitPrice: new Decimal(l.unitPrice),
        amount: lineAmount(l.quantity, l.unitPrice),
        weightKg: l.weightKg == null ? null : new Decimal(l.weightKg),
      };
    });
    const total = sumAmounts(resolved.map((l) => l.amount));
    if (total.gt(MAX_TOTAL)) throw new BadRequestException(TOO_BIG);
    return { lines: resolved, total };
  }
}
