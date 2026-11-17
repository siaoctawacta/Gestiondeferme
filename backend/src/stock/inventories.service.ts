import { SELECT_FARM } from '../common/messages';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import { Prisma } from '../generated/prisma/client';
import type { InventoryStatus } from '../generated/prisma/enums';
import { orConflict } from '../listing/list-helpers';
import type { ExportColumn } from '../listing/export';
import type { ListQueryDto } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateInventoryDto,
  SaveInventoryLinesDto,
} from './dto/inventory.dto';
import { StockLedgerService, type RecordInput } from './stock-ledger.service';

export const INVENTORY_SOURCE = 'INVENTORY' as const;
const NOT_FOUND = 'Inventaire introuvable';
const VALIDATED = 'Cet inventaire est validé : il ne peut plus changer';
const ALREADY = 'Cet inventaire est déjà validé';

const include = {
  lines: {
    include: { stockItem: { select: { name: true, unit: true } } },
    orderBy: { stockItem: { name: 'asc' } },
  },
  createdBy: { select: { name: true } },
  validatedBy: { select: { name: true } },
} satisfies Prisma.InventorySessionInclude;
type Session = Prisma.InventorySessionGetPayload<{ include: typeof include }>;

export interface InventoryItem {
  id: string;
  farmId: string;
  date: string;
  status: InventoryStatus;
  note: string | null;
  lineCount: number;
  createdBy: string;
  validatedBy: string | null;
  validatedAt: string | null;
  lines: InventoryLine[];
}

export interface InventoryLine {
  itemId: string;
  itemName: string;
  unit: string;
  /** The quantity held on the session date, in the session's farm. */
  theoreticalQty: number;
  /** null: not counted yet (a draft's line for an article nobody counted). */
  countedQty: number | null;
  /** `countedQty − theoreticalQty`; null while not counted. */
  difference: number | null;
}

const STATUS_LABEL: Record<InventoryStatus, string> = {
  BROUILLON: 'Brouillon',
  VALIDEE: 'Validée',
};

export const INVENTORY_COLUMNS: ExportColumn<InventoryItem>[] = [
  { header: 'Date', value: (i) => i.date },
  { header: 'Statut', value: (i) => STATUS_LABEL[i.status] },
  { header: 'Lignes comptées', value: (i) => i.lineCount },
  { header: 'Note', value: (i) => i.note },
];

const toItem = (s: Session): InventoryItem => ({
  id: s.id,
  farmId: s.farmId,
  date: formatDay(s.date),
  status: s.status,
  note: s.note,
  lineCount: s.lines.length,
  createdBy: s.createdBy.name,
  validatedBy: s.validatedBy?.name ?? null,
  validatedAt: s.validatedAt?.toISOString() ?? null,
  lines: s.lines.map((l) => ({
    itemId: l.stockItemId,
    itemName: l.stockItem.name,
    unit: l.stockItem.unit,
    theoreticalQty: l.theoreticalQty.toNumber(),
    countedQty: l.countedQty.toNumber(),
    difference: l.countedQty.sub(l.theoreticalQty).toNumber(),
  })),
});

/**
 * Stock-taking sessions. A draft holds the counted quantities (with the
 * theoretical quantity at the session date, recomputed when the lines are
 * saved); validating writes one adjustment per difference through the ledger,
 * once, and freezes the session.
 */
@Injectable()
export class InventoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly audit: AuditService,
  ) {}

  listArgs(ctx: RequestContext, q: ListQueryDto) {
    if (q.status && q.status !== 'BROUILLON' && q.status !== 'VALIDEE') {
      throw new BadRequestException("Le statut de l'inventaire est invalide");
    }
    const where: Prisma.InventorySessionWhereInput = {
      farmId: { in: ctx.farmIds },
      ...(q.status ? { status: q.status as InventoryStatus } : {}),
    };
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.inventorySession.findMany({
            where,
            include,
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            ...range,
          })
        ).map((s) => ({ ...toItem(s), lines: [] })),
      count: () => this.prisma.inventorySession.count({ where }),
    };
  }

  private async find(
    tx: Prisma.TransactionClient | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<Session> {
    const row = await tx.inventorySession.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include,
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /**
   * A validated session shows the lines it stored, unchanged. A draft shows one
   * line per ACTIVE article of the organisation (plus any inactive one that is
   * already counted), each with the quantity held on the session date in the
   * session's farm (what validation will use) and its count when it has one:
   * three queries whatever the number of articles.
   */
  async get(ctx: RequestContext, id: string): Promise<InventoryItem> {
    const session = await this.find(this.prisma, ctx, id);
    const item = toItem(session);
    if (session.status === 'VALIDEE') return item;
    const counted = new Map(session.lines.map((l) => [l.stockItemId, l]));
    const articles = await this.prisma.stockItem.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        OR: [{ active: true }, { id: { in: [...counted.keys()] } }],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, unit: true },
    });
    const theoretical = await this.ledger.quantitiesAt(
      session.farmId,
      articles.map((a) => a.id),
      session.date,
      this.prisma,
    );
    return {
      ...item,
      lines: articles.map((a) => {
        const line = counted.get(a.id);
        const expected = theoretical.get(a.id) ?? new Prisma.Decimal(0);
        return {
          itemId: a.id,
          itemName: a.name,
          unit: a.unit,
          theoreticalQty: expected.toNumber(),
          countedQty: line ? line.countedQty.toNumber() : null,
          difference: line ? line.countedQty.sub(expected).toNumber() : null,
        };
      }),
    };
  }

  /** Locks the session (scoped to the caller's farms) and returns it fresh. */
  private async lock(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    id: string,
  ): Promise<Session> {
    await lockRow(tx, 'InventorySession', id, ctx.farmIds);
    return this.find(tx, ctx, id);
  }

  create(ctx: RequestContext, dto: CreateInventoryDto): Promise<InventoryItem> {
    const farmId = ctx.farmId;
    if (!farmId) throw new BadRequestException(SELECT_FARM);
    const date = requireDay(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.inventorySession.create({
        data: { farmId, date, note: dto.note, createdById: ctx.user.id },
        select: { id: true },
      });
      const item = toItem(await this.find(tx, ctx, created.id));
      await this.audit.log(
        {
          ctx,
          module: 'stocks',
          action: 'CREATE',
          recordId: item.id,
          label: `Inventaire · ${item.date}`,
          after: item,
        },
        tx,
      );
      return item;
    });
  }

  saveLines(
    ctx: RequestContext,
    id: string,
    dto: SaveInventoryLinesDto,
  ): Promise<InventoryItem> {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lock(tx, ctx, id);
      if (session.status === 'VALIDEE') throw new ConflictException(VALIDATED);
      const ids = dto.lines.map((l) => l.itemId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('Un article ne peut figurer qu’une fois');
      }
      const known = await tx.stockItem.count({
        where: {
          id: { in: ids },
          organization: { farms: { some: { id: session.farmId } } },
        },
      });
      if (known !== ids.length)
        throw new BadRequestException('Article invalide');
      const theoretical = await this.ledger.quantitiesAt(
        session.farmId,
        ids,
        session.date,
        tx,
      );
      await tx.inventoryLine.deleteMany({ where: { sessionId: id } });
      await tx.inventoryLine.createMany({
        data: dto.lines.map((l) => ({
          sessionId: id,
          stockItemId: l.itemId,
          theoreticalQty: theoretical.get(l.itemId) ?? 0,
          countedQty: l.countedQty,
        })),
      });
      const after = toItem(await this.find(tx, ctx, id));
      await this.audit.log(
        {
          ctx,
          module: 'stocks',
          action: 'UPDATE',
          recordId: id,
          label: `Inventaire · ${after.date}`,
          before: toItem(session),
          after,
        },
        tx,
      );
      return after;
    });
  }

  /**
   * Under the stock locks of every counted article, recomputes the theoretical
   * quantity at the session date and writes `counted − theoretical` as an
   * adjustment dated on the session, for each non-zero difference.
   */
  validate(ctx: RequestContext, id: string): Promise<InventoryItem> {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lock(tx, ctx, id);
      if (session.status === 'VALIDEE') throw new ConflictException(ALREADY);
      if (session.lines.length === 0) {
        throw new BadRequestException('Aucune ligne à valider');
      }
      const ids = session.lines.map((l) => l.stockItemId);
      await this.ledger.lockItems(tx, session.farmId, ids);
      const theoretical = await this.ledger.quantitiesAt(
        session.farmId,
        ids,
        session.date,
        tx,
      );
      const inputs: RecordInput[] = [];
      for (const line of session.lines) {
        const expected =
          theoretical.get(line.stockItemId) ?? new Prisma.Decimal(0);
        await tx.inventoryLine.update({
          where: { id: line.id },
          data: { theoreticalQty: expected },
        });
        const difference = line.countedQty.sub(expected);
        if (difference.isZero()) continue;
        inputs.push({
          farmId: session.farmId,
          stockItemId: line.stockItemId,
          date: session.date,
          type: 'AJUSTEMENT' as const,
          quantity: difference,
          reason: 'INVENTAIRE' as const,
          sourceType: INVENTORY_SOURCE,
          sourceId: session.id,
          note: `Inventaire du ${formatDay(session.date)}`,
          userId: ctx.user.id,
        });
      }
      await this.ledger.recordMany(tx, inputs);
      await tx.inventorySession.update({
        where: { id },
        data: {
          status: 'VALIDEE',
          validatedById: ctx.user.id,
          validatedAt: new Date(),
        },
      });
      const after = toItem(await this.find(tx, ctx, id));
      await this.audit.log(
        {
          ctx,
          module: 'stocks',
          action: 'UPDATE',
          recordId: id,
          label: `Inventaire validé · ${after.date} · ${inputs.length} ajustement(s)`,
          before: toItem(session),
          after,
        },
        tx,
      );
      return after;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const session = await this.lock(tx, ctx, id);
        if (session.status === 'VALIDEE')
          throw new ConflictException(VALIDATED);
        await tx.inventoryLine.deleteMany({ where: { sessionId: id } });
        await tx.inventorySession.delete({ where: { id } });
        await this.audit.log(
          {
            ctx,
            module: 'stocks',
            action: 'DELETE',
            recordId: id,
            label: `Inventaire · ${formatDay(session.date)}`,
            before: toItem(session),
          },
          tx,
        );
      }),
    );
  }
}
