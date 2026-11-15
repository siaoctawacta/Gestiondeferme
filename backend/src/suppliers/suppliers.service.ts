import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { AccessService } from '../access/access.service';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import type { Prisma, Supplier } from '../generated/prisma/client';
import type { AuditAction } from '../generated/prisma/enums';
import type { ExportColumn } from '../listing/export';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { OWED_STATUSES } from '../purchases/purchase-workflow';
import type {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';

export interface SupplierItem {
  id: string;
  name: string;
  products: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  /** Received purchases minus payments: what the organisation (or the selected farm) still owes. */
  balance: number;
}

export const SUPPLIER_NOT_FOUND = 'Fournisseur introuvable';
const HAS_PURCHASES =
  'Ce fournisseur a des achats : désactivez-le plutôt que de le supprimer';
const SORTABLE = ['name'];

export const SUPPLIER_COLUMNS: ExportColumn<SupplierItem>[] = [
  { header: 'Nom', value: (s) => s.name },
  { header: 'Produits fournis', value: (s) => s.products },
  { header: 'Téléphone', value: (s) => s.phone },
  { header: 'Email', value: (s) => s.email },
  { header: 'Solde', value: (s) => s.balance },
];

const dec = (value: Decimal | string | number | null): Decimal =>
  new Decimal(value ?? 0);

/** The sheet itself: what an audit row records (the balance is derived from other tables). */
const sheet = (s: Supplier) => ({
  id: s.id,
  name: s.name,
  products: s.products,
  phone: s.phone,
  email: s.email,
  address: s.address,
  active: s.active,
});

const toItem = (s: Supplier, balance: Decimal): SupplierItem => ({
  ...sheet(s),
  balance: balance.toNumber(),
});

/**
 * Suppliers are organisation master data: not tied to a farm, written under
 * any farm header (even `all`). Only the derived `balance` looks at farms: the
 * selected farm's purchases, or every farm the user can see under `all`.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** The farms whose purchases make the balance: the header's farm, else every visible farm. */
  private async balanceFarms(
    ctx: RequestContext,
    header: string | undefined,
  ): Promise<string[]> {
    if (header && header !== 'all') {
      return (await this.access.resolveFarms(ctx.user, header, true)).farmIds;
    }
    const farms = await this.prisma.farm.findMany({
      where: this.access.visibleFarmsWhere(ctx.user),
      select: { id: true },
    });
    return farms.map((f) => f.id);
  }

  /** Balance per supplier: Σ rounded lines of the received purchases − Σ payments. */
  private async balances(
    supplierIds: string[],
    farmIds: string[],
  ): Promise<Map<string, Decimal>> {
    const result = new Map<string, Decimal>();
    if (supplierIds.length === 0 || farmIds.length === 0) return result;
    const [owed, paid] = await Promise.all([
      this.prisma.$queryRaw<{ supplierId: string; total: Decimal | null }[]>`
        SELECT p."supplierId", SUM(ROUND(COALESCE(i."receivedQuantity", i."quantity") * i."unitPrice", 2)) AS total
        FROM "PurchaseItem" i JOIN "Purchase" p ON p.id = i."purchaseId"
        WHERE p."supplierId" = ANY(${supplierIds}::text[])
          AND p."farmId" = ANY(${farmIds}::text[])
          AND p."status"::text = ANY(${[...OWED_STATUSES]}::text[])
        GROUP BY p."supplierId"`,
      this.prisma.$queryRaw<{ supplierId: string; total: Decimal | null }[]>`
        SELECT p."supplierId", SUM(s."amount") AS total
        FROM "SupplierPayment" s JOIN "Purchase" p ON p.id = s."purchaseId"
        WHERE p."supplierId" = ANY(${supplierIds}::text[])
          AND p."farmId" = ANY(${farmIds}::text[])
        GROUP BY p."supplierId"`,
    ]);
    for (const r of owed) result.set(r.supplierId, dec(r.total));
    for (const r of paid) {
      result.set(
        r.supplierId,
        (result.get(r.supplierId) ?? dec(0)).sub(dec(r.total)),
      );
    }
    return result;
  }

  async listArgs(
    ctx: RequestContext,
    q: SupplierQueryDto,
    header: string | undefined,
  ) {
    const where: Prisma.SupplierWhereInput = {
      organizationId: ctx.user.organizationId,
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.search ? { name: containsInsensitive(q.search) } : {}),
    };
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    const farmIds = await this.balanceFarms(ctx, header);
    return {
      find: async (range: { skip?: number; take: number }) => {
        const rows = await this.prisma.supplier.findMany({
          where,
          orderBy: [order, { id: 'asc' }],
          ...range,
        });
        const balances = await this.balances(
          rows.map((r) => r.id),
          farmIds,
        );
        return rows.map((r) => toItem(r, balances.get(r.id) ?? dec(0)));
      },
      count: () => this.prisma.supplier.count({ where }),
    };
  }

  async get(
    ctx: RequestContext,
    id: string,
    header: string | undefined,
  ): Promise<SupplierItem> {
    return this.read(ctx, id, await this.balanceFarms(ctx, header));
  }

  private async read(
    ctx: RequestContext,
    id: string,
    farmIds: string[],
  ): Promise<SupplierItem> {
    const row = await this.prisma.supplier.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
    if (!row) throw new NotFoundException(SUPPLIER_NOT_FOUND);
    const balances = await this.balances([id], farmIds);
    return toItem(row, balances.get(id) ?? dec(0));
  }

  private log(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    action: AuditAction,
    row: Supplier,
    before?: Supplier,
    after?: Supplier,
  ): Promise<void> {
    return this.audit.log(
      {
        ctx,
        module: 'fournisseurs',
        action,
        recordId: row.id,
        label: row.name,
        before: before && sheet(before),
        after: after && sheet(after),
      },
      tx,
    );
  }

  create(ctx: RequestContext, dto: CreateSupplierDto): Promise<SupplierItem> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.supplier.create({
          data: { ...dto, organizationId: ctx.user.organizationId },
        });
        await this.log(tx, ctx, 'CREATE', created, undefined, created);
        return toItem(created, dec(0));
      }),
    );
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateSupplierDto,
    header: string | undefined,
  ): Promise<SupplierItem> {
    // A farm header the user cannot see is refused before anything is written.
    const farmIds = await this.balanceFarms(ctx, header);
    return orConflict(async () => {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.supplier.findFirst({
          where: { id, organizationId: ctx.user.organizationId },
        });
        if (!before) throw new NotFoundException(SUPPLIER_NOT_FOUND);
        const changed = (Object.keys(dto) as (keyof UpdateSupplierDto)[]).some(
          (k) => dto[k] !== undefined && dto[k] !== before[k],
        );
        if (!changed) return;
        const updated = await tx.supplier.update({ where: { id }, data: dto });
        await this.log(tx, ctx, 'UPDATE', updated, before, updated);
      });
      return this.read(ctx, id, farmIds);
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await tx.supplier.findFirst({
          where: { id, organizationId: ctx.user.organizationId },
        });
        if (!before) throw new NotFoundException(SUPPLIER_NOT_FOUND);
        if ((await tx.purchase.count({ where: { supplierId: id } })) > 0) {
          throw new ConflictException(HAS_PURCHASES);
        }
        await tx.supplier.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, before);
      }),
    );
  }
}
