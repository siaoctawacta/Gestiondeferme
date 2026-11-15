import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { formatDay, formatDayOrNull, requireDay } from '../common/days';
import type { Prisma } from '../generated/prisma/client';
import { paginate } from '../listing/paginate';
import { PrismaService } from '../prisma/prisma.service';
import {
  MANUAL_REASONS,
  type CreateMovementDto,
  type MovementQueryDto,
  type UpdateMovementDto,
} from './dto/stock-movement.dto';
import {
  MOVEMENT_NOT_FOUND,
  StockLedgerService,
  type MovementPatch,
} from './stock-ledger.service';

const include = {
  stockItem: { select: { name: true, unit: true } },
  stockBatch: { select: { lotNumber: true, expiryDate: true } },
} satisfies Prisma.StockMovementInclude;
type Row = Prisma.StockMovementGetPayload<{ include: typeof include }>;

export interface MovementItem {
  id: string;
  date: string;
  itemId: string;
  itemName: string;
  unit: string;
  farmId: string;
  type: string;
  /** Signed: positive in, negative out. */
  quantity: number;
  /** An entry's cost; for an exit, the average cost at that point of the history. */
  unitCost: number;
  /** `|quantity| × unitCost`. */
  value: number;
  reason: string;
  batchId: string | null;
  lotNumber: string | null;
  expiryDate: string | null;
  sourceType: string | null;
  sourceId: string | null;
  note: string | null;
  /** Hand-entered: only these can be edited or deleted here. */
  manual: boolean;
}

export const FROM_ELSEWHERE =
  "Ce mouvement provient d'une autre opération ; corrigez l'opération d'origine";
const BAD_REASON = 'Motif invalide pour ce type de mouvement';

export const movementItems = (rows: Row[]): MovementItem[] =>
  rows.map((r) => ({
    id: r.id,
    date: formatDay(r.date),
    itemId: r.stockItemId,
    itemName: r.stockItem.name,
    unit: r.stockItem.unit,
    farmId: r.farmId,
    type: r.type,
    quantity: r.quantity.toNumber(),
    unitCost: r.unitCost.toNumber(),
    value: r.quantity.abs().mul(r.unitCost).toDecimalPlaces(2).toNumber(),
    reason: r.reason,
    batchId: r.stockBatchId,
    lotNumber: r.stockBatch?.lotNumber ?? null,
    expiryDate: formatDayOrNull(r.stockBatch?.expiryDate ?? null),
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    note: r.note,
    manual: r.sourceType === null,
  }));

/** Hand-entered stock movements; the ledger does the replay, the costing and the audit. */
@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
  ) {}

  list(ctx: RequestContext, q: MovementQueryDto) {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    const where: Prisma.StockMovementWhereInput = {
      farmId: { in: ctx.farmIds },
      stockItem: { organizationId: ctx.user.organizationId },
      ...(q.itemId ? { stockItemId: q.itemId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
    };
    return paginate(
      q,
      async (range) =>
        movementItems(
          await this.prisma.stockMovement.findMany({
            where,
            include,
            relationLoadStrategy: 'join',
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          }),
        ),
      () => this.prisma.stockMovement.count({ where }),
    );
  }

  private async items(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<MovementItem[]> {
    return movementItems(
      await tx.stockMovement.findMany({
        where: { id: { in: ids } },
        include,
        relationLoadStrategy: 'join',
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  }

  /** One movement per lot the stock was taken from (FEFO may split an exit). */
  create(ctx: RequestContext, dto: CreateMovementDto): Promise<MovementItem[]> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException('Sélectionnez une ferme');
    if (!MANUAL_REASONS[dto.type].includes(dto.reason)) {
      throw new BadRequestException(BAD_REASON);
    }
    const date = requireDay(dto.date);
    const magnitude = Math.abs(dto.quantity);
    let quantity: number;
    if (dto.type === 'AJUSTEMENT') {
      quantity = dto.quantity;
    } else if (dto.quantity <= 0) {
      throw new BadRequestException('La quantité doit être positive');
    } else {
      quantity = dto.type === 'SORTIE' ? -magnitude : magnitude;
    }
    const entering = quantity > 0;
    if (dto.type === 'ENTREE' && dto.unitCost === undefined) {
      throw new BadRequestException('Le coût unitaire est requis');
    }
    if (!entering && dto.unitCost !== undefined) {
      throw new BadRequestException(
        'Une sortie est valorisée au coût moyen : ne renseignez pas de coût',
      );
    }
    const makesLot =
      dto.lotNumber !== undefined || dto.expiryDate !== undefined;
    if (makesLot && !entering) {
      throw new BadRequestException(
        'Un numéro de lot ou une péremption ne concerne qu’une entrée',
      );
    }
    if (entering && dto.stockBatchId !== undefined) {
      throw new BadRequestException(
        'Une entrée crée son propre lot : indiquez un numéro de lot et une péremption',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      let stockBatchId = dto.stockBatchId;
      if (makesLot) {
        const batch = await this.ledger.createBatch(tx, {
          farmId,
          stockItemId: dto.itemId,
          lotNumber: dto.lotNumber,
          expiryDate: dto.expiryDate ? requireDay(dto.expiryDate) : null,
          receivedDate: date,
        });
        stockBatchId = batch.id;
      }
      const result = await this.ledger.record(tx, {
        farmId,
        stockItemId: dto.itemId,
        date,
        type: dto.type,
        quantity,
        unitCost: dto.unitCost,
        reason: dto.reason,
        stockBatchId,
        note: dto.note,
        userId: ctx.user.id,
        audit: { ctx },
      });
      return this.items(
        tx,
        result.movements.map((m) => m.id),
      );
    });
  }

  /** The movement must be in the caller's farms and hand-entered. */
  private async manual(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    id: string,
  ) {
    const movement = await tx.stockMovement.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
    });
    if (!movement) throw new NotFoundException(MOVEMENT_NOT_FOUND);
    if (movement.sourceType !== null)
      throw new ConflictException(FROM_ELSEWHERE);
    if (
      movement.type !== 'ENTREE' &&
      movement.type !== 'SORTIE' &&
      movement.type !== 'AJUSTEMENT'
    ) {
      throw new BadRequestException(
        'Un mouvement de transfert ne peut pas être modifié',
      );
    }
    return movement;
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateMovementDto,
  ): Promise<MovementItem> {
    return this.prisma.$transaction(async (tx) => {
      const movement = await this.manual(tx, ctx, id);
      const patch: MovementPatch = {
        date: dto.date ? requireDay(dto.date) : undefined,
        unitCost: dto.unitCost,
        note: dto.note,
        lotNumber: dto.lotNumber,
        expiryDate:
          dto.expiryDate === undefined
            ? undefined
            : dto.expiryDate === null
              ? null
              : requireDay(dto.expiryDate),
      };
      if (dto.quantity !== undefined) {
        patch.quantity =
          movement.type === 'AJUSTEMENT'
            ? dto.quantity
            : dto.quantity <= 0
              ? failPositive()
              : movement.type === 'SORTIE'
                ? -dto.quantity
                : dto.quantity;
      }
      await this.ledger.update(tx, id, patch, ctx.farmIds, { ctx });
      return (await this.items(tx, [id]))[0];
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await this.manual(tx, ctx, id);
      await this.ledger.remove(tx, id, ctx.farmIds, { ctx });
    });
  }
}

function failPositive(): never {
  throw new BadRequestException('La quantité doit être positive');
}
