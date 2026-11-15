import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { assertNotFuture, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type {
  Activity,
  FinanceCategory,
  FinanceKind,
} from '../generated/prisma/enums';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFinanceEntryDto,
  FinanceEntriesQueryDto,
  UpdateFinanceEntryDto,
} from './dto/finance.dto';
import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from './finance-categories';
import {
  entryInclude,
  recordItem,
  toEntryItem,
  type EntryItem,
} from './finance-entry-view';
import {
  FinanceLedger,
  type LedgerFilter,
  type LedgerSort,
} from './finance-ledger';
import { isDerivedId } from './finance-rules';
import { periodOf } from './finance-period';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'Écriture introuvable';
export const DERIVED_ENTRY =
  "Cette écriture provient d'un document ; corrigez le document d'origine";
const WRONG_CATEGORY = 'La catégorie ne correspond pas au type';
const ONLY_EXPENSE = 'Seule une dépense peut être rattachée à un lot';
const BAD_LOT = 'Lot invalide pour cette ferme';
const LOT_ACTIVITY = "Le lot ne correspond pas à l'activité";
const SORTABLE = ['date', 'amount'];

/** What the invariants of a manual entry are checked on. */
interface Shape {
  kind: FinanceKind;
  activity: Activity;
  category: FinanceCategory;
  batchId: string | null;
}

/**
 * Manual finance entries (salaries, energy, ...): the only thing finance
 * stores. The list also shows what the view derives from the documents; those
 * rows are read-only here (409 on a write). Create, edit and delete are daily
 * entries (`finance:create`) with one audit row each, in the same transaction;
 * a PATCH that changes nothing writes nothing.
 */
@Injectable()
export class FinanceEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: FinanceLedger,
  ) {}

  private filter(ctx: RequestContext, q: FinanceEntriesQueryDto): LedgerFilter {
    return {
      farmIds: ctx.farmIds,
      kind: q.kind,
      activity: q.activity,
      category: q.category,
      origin: q.origin,
      ...periodOf(q.from, q.to),
      search: q.search || undefined,
    };
  }

  /** `find` / `count` / `totals` for `sendList`: one filter, so the totals are the sum of the rows listed. */
  listArgs(ctx: RequestContext, q: FinanceEntriesQueryDto) {
    const f = this.filter(ctx, q);
    const [[sort, dir]] = Object.entries(
      orderBy(q, SORTABLE, { date: 'desc' }),
    ) as [[LedgerSort, 'asc' | 'desc']];
    return {
      find: async (range: { skip?: number; take: number }) =>
        (await this.ledger.rows(f, { sort, dir }, range)).map(toEntryItem),
      count: () => this.ledger.count(f),
      totals: async () => {
        const { revenue, expenses } = await this.ledger.totals(f);
        return {
          totals: {
            revenue: revenue.toNumber(),
            expenses: expenses.toNumber(),
            balance: revenue.sub(expenses).toNumber(),
          },
        };
      },
    };
  }

  private assertShape(s: Shape): void {
    const own = s.kind === 'DEPENSE' ? EXPENSE_CATEGORIES : REVENUE_CATEGORIES;
    if (!own.includes(s.category))
      throw new BadRequestException(WRONG_CATEGORY);
  }

  /** The lot of an expense: on the active farm and of the entry's activity. */
  private async assertLot(tx: Tx, farmId: string, s: Shape): Promise<void> {
    if (!s.batchId) return;
    if (s.kind !== 'DEPENSE') throw new BadRequestException(ONLY_EXPENSE);
    const lot = await tx.animalBatch.findFirst({
      where: { id: s.batchId, farmId },
      select: { species: true },
    });
    if (!lot) throw new BadRequestException(BAD_LOT);
    if (s.activity === 'GENERAL' || lot.species !== s.activity) {
      throw new BadRequestException(LOT_ACTIVITY);
    }
  }

  create(ctx: RequestContext, dto: CreateFinanceEntryDto): Promise<EntryItem> {
    const farmId = ctx.farmId as string;
    return this.prisma.$transaction(async (tx) => {
      const date = requireDay(dto.date);
      assertNotFuture(date);
      const shape: Shape = {
        kind: dto.kind,
        activity: dto.activity,
        category: dto.category,
        batchId: dto.batchId ?? null,
      };
      this.assertShape(shape);
      await this.assertLot(tx, farmId, shape);
      const created = await tx.financeEntry.create({
        data: {
          farmId,
          date,
          kind: dto.kind,
          label: dto.label,
          activity: dto.activity,
          category: dto.category,
          amount: dto.amount,
          batchId: shape.batchId,
          note: dto.note ?? null,
          createdById: ctx.user.id,
        },
        include: entryInclude,
      });
      const item = recordItem(created);
      await this.audit.log(
        {
          ctx,
          module: 'finance',
          action: 'CREATE',
          recordId: created.id,
          label: created.label,
          farmId,
          after: item,
        },
        tx,
      );
      return item;
    });
  }

  /** The entry under its row lock, scoped to the caller's farms; a derived id never reaches the database. */
  private async lock(tx: Tx, ctx: RequestContext, id: string) {
    if (isDerivedId(id)) throw new ConflictException(DERIVED_ENTRY);
    await lockRow(tx, 'FinanceEntry', id, ctx.farmIds);
    const found = await tx.financeEntry.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: entryInclude,
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateFinanceEntryDto,
  ): Promise<EntryItem> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      const beforeItem = recordItem(before);
      const changed =
        (dto.date !== undefined && dto.date !== beforeItem.date) ||
        (dto.kind !== undefined && dto.kind !== before.kind) ||
        (dto.label !== undefined && dto.label !== before.label) ||
        (dto.activity !== undefined && dto.activity !== before.activity) ||
        (dto.category !== undefined && dto.category !== before.category) ||
        (dto.amount !== undefined &&
          !new Decimal(dto.amount).eq(before.amount)) ||
        (dto.batchId !== undefined && dto.batchId !== before.batchId) ||
        (dto.note !== undefined && dto.note !== before.note);
      if (!changed) return beforeItem;
      const date = dto.date !== undefined ? requireDay(dto.date) : undefined;
      if (date) assertNotFuture(date);
      const shape: Shape = {
        kind: dto.kind ?? before.kind,
        activity: dto.activity ?? before.activity,
        category: dto.category ?? before.category,
        batchId: dto.batchId !== undefined ? dto.batchId : before.batchId,
      };
      this.assertShape(shape);
      await this.assertLot(tx, before.farmId, shape);
      const after = await tx.financeEntry.update({
        where: { id },
        data: {
          date,
          kind: dto.kind,
          label: dto.label,
          activity: dto.activity,
          category: dto.category,
          amount: dto.amount,
          batchId: shape.batchId,
          note: dto.note,
        },
        include: entryInclude,
      });
      const item = recordItem(after);
      await this.audit.logChange(
        {
          ctx,
          module: 'finance',
          action: 'UPDATE',
          recordId: id,
          label: after.label,
          farmId: after.farmId,
          before: beforeItem,
          after: item,
        },
        tx,
      );
      return item;
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx, id);
      await tx.financeEntry.delete({ where: { id } });
      await this.audit.log(
        {
          ctx,
          module: 'finance',
          action: 'DELETE',
          recordId: id,
          label: before.label,
          farmId: before.farmId,
          before: recordItem(before),
        },
        tx,
      );
    });
  }
}
