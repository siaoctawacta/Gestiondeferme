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
  /** What the customer still owes (the selected farm's invoices, or every visible farm's under `all`) minus what is owed back. */
  balance: number;
}

export interface CustomerDetail extends CustomerItem {
  invoiced: number;
  paid: number;
  credited: number;
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

/** What a customer owes across the farms: Σ due − Σ refund due of the invoices in `REVENUE_STATUSES`, and the totals behind it. */
interface Standing {
  balance: Decimal;
  invoiced: Decimal;
  paid: Decimal;
  credited: Decimal;
}

const NOTHING: Standing = {
  balance: dec(0),
  invoiced: dec(0),
  paid: dec(0),
  credited: dec(0),
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
   * The standing of each customer over `farmIds`. No invoice exists yet: every
   * customer stands at 0 until the invoices land (the receivables function then
   * replaces this body, the callers stay).
   */
  private standings(
    customerIds: string[],
    farmIds: string[],
  ): Map<string, Standing> {
    const result = new Map<string, Standing>();
    if (farmIds.length === 0) return result;
    for (const id of customerIds) result.set(id, NOTHING);
    return result;
  }

  private toItem(c: Customer, standing: Standing | undefined): CustomerItem {
    return {
      ...sheet(c),
      balance: (standing ?? NOTHING).balance.toNumber(),
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
        const standings = this.standings(
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
    const standing = this.standings([id], farmIds).get(id) ?? NOTHING;
    return {
      ...this.toItem(row, standing),
      invoiced: standing.invoiced.toNumber(),
      paid: standing.paid.toNumber(),
      credited: standing.credited.toNumber(),
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
