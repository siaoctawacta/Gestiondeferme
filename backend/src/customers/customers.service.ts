import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { AccessService } from '../access/access.service';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Customer, Prisma } from '../generated/prisma/client';
import type { AuditAction, CustomerType } from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { toMoney } from '../common/money';
import { receivablesOf } from '../sales/receivables';
import type {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

export interface CustomerItem {
  id: string;
  name: string;
  type: CustomerType;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  active: boolean;
  /** What the customer still owes: Σ due of the issued invoices (the selected farm's, or every visible farm's under `all`). */
  balance: number;
  /** What is owed back to the customer (« À rembourser »): Σ refund due of the same invoices. */
  refundDue: number;
}

export interface CustomerDetail extends CustomerItem {
  invoiced: number;
  paid: number;
  credited: number;
  refunded: number;
}

export const CUSTOMER_NOT_FOUND = 'Client introuvable';
const DUPLICATE = 'Un client porte déjà ce nom';
const HAS_DOCUMENTS = 'Ce client a des documents : désactivez-le';
const SORTABLE = ['name', 'city'];

export const TYPE_LABELS: Record<CustomerType, string> = {
  PARTICULIER: 'Particulier',
  REVENDEUR: 'Revendeur',
  RESTAURANT: 'Restaurant',
  GROSSISTE: 'Grossiste',
};

export const CUSTOMER_COLUMNS: ExportColumn<CustomerItem>[] = [
  { header: 'Nom', value: (c) => c.name },
  { header: 'Type', value: (c) => TYPE_LABELS[c.type] },
  { header: 'Téléphone', value: (c) => c.phone },
  { header: 'Ville', value: (c) => c.city },
];

const dec = (value: Decimal | string | number | null): Decimal =>
  new Decimal(value ?? 0);

/** The sheet itself: what an audit row records (the balance is derived from other tables). */
const sheet = (c: Customer) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  phone: c.phone,
  email: c.email,
  city: c.city,
  address: c.address,
  active: c.active,
});

/** What a customer owes across the farms: Σ due of the invoices in `REVENUE_STATUSES`, what is owed back to it, and the totals behind them. */
interface Standing {
  balance: Decimal;
  refundDue: Decimal;
  invoiced: Decimal;
  paid: Decimal;
  credited: Decimal;
  refunded: Decimal;
}

const NOTHING: Standing = {
  balance: dec(0),
  refundDue: dec(0),
  invoiced: dec(0),
  paid: dec(0),
  credited: dec(0),
  refunded: dec(0),
};

/**
 * Customers are organisation master data: not tied to a farm, written under
 * any farm header (even `all`). Only the derived `balance` looks at farms: the
 * selected farm's invoices, or every farm the user can see under `all`.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /**
   * The standing of each customer over `farmIds`, from `receivablesOf` (the
   * one read of what customers owe): THREE queries whatever the number of
   * customers. `balance` = Σ due of the invoices in `REVENUE_STATUSES` (the
   * figure of the dashboard and of the alerts), `refundDue` = Σ what is owed
   * back to the customer; the totals behind them count the same invoices.
   */
  private async standings(
    customerIds: string[],
    farmIds: string[],
  ): Promise<Map<string, Standing>> {
    const result = new Map<string, Standing>();
    const rows = await receivablesOf(this.prisma, farmIds, { customerIds });
    for (const r of rows) {
      const so = result.get(r.customerId) ?? NOTHING;
      result.set(r.customerId, {
        balance: so.balance.add(r.due),
        refundDue: so.refundDue.add(r.refundDue),
        invoiced: so.invoiced.add(r.total),
        paid: so.paid.add(r.paid),
        credited: so.credited.add(r.credited),
        refunded: so.refunded.add(r.refunded),
      });
    }
    return result;
  }

  private toItem(c: Customer, standing: Standing | undefined): CustomerItem {
    return {
      ...sheet(c),
      balance: toMoney((standing ?? NOTHING).balance),
      refundDue: toMoney((standing ?? NOTHING).refundDue),
    };
  }

  async listArgs(
    ctx: RequestContext,
    q: CustomerQueryDto,
    header: string | undefined,
  ) {
    const where: Prisma.CustomerWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.search ? { name: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    const farmIds = await this.access.farmsForHeader(ctx, header);
    return {
      find: async (range: { skip?: number; take: number }) => {
        const rows = await this.prisma.customer.findMany({
          where,
          orderBy: [order, { id: 'asc' }],
          ...range,
        });
        const standings = await this.standings(
          rows.map((r) => r.id),
          farmIds,
        );
        return rows.map((r) => this.toItem(r, standings.get(r.id)));
      },
      count: () => this.prisma.customer.count({ where }),
    };
  }

  async get(
    ctx: RequestContext,
    id: string,
    header: string | undefined,
  ): Promise<CustomerDetail> {
    return this.read(ctx, id, await this.access.farmsForHeader(ctx, header));
  }

  private async read(
    ctx: RequestContext,
    id: string,
    farmIds: string[],
  ): Promise<CustomerDetail> {
    const row = await this.prisma.customer.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
    if (!row) throw new NotFoundException(CUSTOMER_NOT_FOUND);
    const standing = (await this.standings([id], farmIds)).get(id) ?? NOTHING;
    return {
      ...this.toItem(row, standing),
      invoiced: toMoney(standing.invoiced),
      paid: toMoney(standing.paid),
      credited: toMoney(standing.credited),
      refunded: toMoney(standing.refunded),
    };
  }

  private log(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: AuditAction,
    row: Customer,
    before?: Customer,
    after?: Customer,
  ): Promise<void> {
    return this.audit.log(
      {
        ctx,
        module: 'clients',
        action,
        recordId: row.id,
        label: row.name,
        before: before && sheet(before),
        after: after && sheet(after),
      },
      tx,
    );
  }

  create(ctx: RequestContext, dto: CreateCustomerDto): Promise<CustomerItem> {
    return orConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const created = await tx.customer.create({
            data: { ...dto, organizationId: ctx.user.organizationId },
          });
          await this.log(tx, ctx, 'CREATE', created, undefined, created);
          return this.toItem(created, undefined);
        }),
      DUPLICATE,
    );
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateCustomerDto,
    header: string | undefined,
  ): Promise<CustomerItem> {
    // A farm header the user cannot see is refused before anything is written.
    const farmIds = await this.access.farmsForHeader(ctx, header);
    return orConflict(async () => {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.customer.findFirst({
          where: { id, organizationId: ctx.user.organizationId },
        });
        if (!before) throw new NotFoundException(CUSTOMER_NOT_FOUND);
        const changed = (Object.keys(dto) as (keyof UpdateCustomerDto)[]).some(
          (k) => dto[k] !== undefined && dto[k] !== before[k],
        );
        if (!changed) return;
        const updated = await tx.customer.update({ where: { id }, data: dto });
        await this.log(tx, ctx, 'UPDATE', updated, before, updated);
      });
      return this.read(ctx, id, farmIds);
    }, DUPLICATE);
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await tx.customer.findFirst({
          where: { id, organizationId: ctx.user.organizationId },
        });
        if (!before) throw new NotFoundException(CUSTOMER_NOT_FOUND);
        const documents =
          (await tx.quote.count({ where: { customerId: id } })) +
          (await tx.invoice.count({ where: { customerId: id } }));
        if (documents > 0) {
          throw new ConflictException(HAS_DOCUMENTS);
        }
        await tx.customer.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, before);
      }),
    );
  }
}
