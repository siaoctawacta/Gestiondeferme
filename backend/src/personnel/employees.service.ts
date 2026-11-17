import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { can } from '../access/permissions';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { blank } from '../common/blank';
import { addDays, requireDay, today } from '../common/days';
import { lockRow } from '../common/lock-row';
import { toMoney } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import type { AttendanceStatus } from '../generated/prisma/enums';
import { containsInsensitive, IN_USE } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { tasksAfter, tasksBefore } from '../tasks/task-view';
import { OPEN_STATUSES } from '../tasks/task-workflow';
import type {
  CreateEmployeeDto,
  EmployeeQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import {
  countByStatus,
  monthBounds,
  payrollLabel,
  payrollOf,
  type EmploymentStatus,
} from './employee-rules';
import {
  employeeInclude,
  toEmployeeItem,
  type EmployeeItem,
  type EmployeeRecord,
} from './employee-view';

type Tx = Prisma.TransactionClient;

export const EMPLOYEE_NOT_FOUND = 'Employé introuvable';
const NAME_TAKEN = 'Un employé porte déjà ce nom dans cette ferme';
const USER_LINKED = 'Cet utilisateur est déjà lié à un employé de cette ferme';
const USER_INVALID = 'Utilisateur invalide pour cette ferme';
const HAS_HISTORY = 'Cet employé a un historique : indiquez sa date de départ';
const AFTER_END =
  'Des présences ou des tâches sont enregistrées après cette date';
const BEFORE_HIRE =
  'Des présences ou des tâches sont enregistrées avant cette date';
const END_BEFORE_HIRE = "La date de départ est antérieure à l'embauche";
const FUTURE_MONTH = 'Le mois ne peut pas être dans le futur';
const SORTABLE = ['name', 'hireDate'];
const STATUSES: EmploymentStatus[] = ['ACTIF', 'PARTI'];

export interface EmployeeDetail extends EmployeeItem {
  /** Attendance rows of the last 30 days (today included) per status. */
  attendanceLast30: Record<AttendanceStatus, number>;
  /** Open tasks assigned to the employee. */
  openTasks: number;
}

export interface EmployeeOption {
  id: string;
  name: string;
  jobTitle: string;
  userId: string | null;
}

export interface PayrollPreview {
  month: string;
  label: string;
  lines: {
    employeeId: string;
    name: string;
    jobTitle: string;
    monthlySalary: number;
  }[];
  total: number;
  existing: { id: string; amount: number } | null;
}

/**
 * Employees are farm master data (`update` on `personnel`). The row is locked
 * first (`lockRow`), then its attendance is looked at; salaries are read and
 * written only with `finance:read` (a write without it is ignored).
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private withSalary = (ctx: RequestContext): boolean =>
    can(ctx.user.role, 'finance', 'read');

  private where(
    ctx: RequestContext,
    q: EmployeeQueryDto,
    withStatus: boolean,
  ): Prisma.EmployeeWhereInput {
    const day = today();
    const and: Prisma.EmployeeWhereInput[] = [];
    if (withStatus && q.status) {
      and.push(
        q.status === 'PARTI'
          ? { endDate: { lt: day } }
          : { OR: [{ endDate: null }, { endDate: { gte: day } }] },
      );
    }
    if (q.search) {
      and.push({
        OR: [
          { name: containsInsensitive(q.search) },
          { fullName: containsInsensitive(q.search) },
          { jobTitle: containsInsensitive(q.search) },
        ],
      });
    }
    return { farmId: { in: ctx.farmIds }, ...(and.length ? { AND: and } : {}) };
  }

  listArgs(ctx: RequestContext, q: EmployeeQueryDto) {
    if (q.status && !STATUSES.includes(q.status as EmploymentStatus)) {
      throw new BadRequestException('Statut invalide');
    }
    const where = this.where(ctx, q, true);
    const order = orderBy(q, SORTABLE, { name: 'asc' });
    const day = today();
    const withSalary = this.withSalary(ctx);
    return {
      withSalary,
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.employee.findMany({
            where,
            include: employeeInclude,
            relationLoadStrategy: 'join',
            orderBy: [order, { id: 'asc' }],
            ...range,
          })
        ).map((e) => toEmployeeItem(e, day, withSalary)),
      count: () => this.prisma.employee.count({ where }),
      /** Over the other filters: the status filter itself is left out. */
      statusCounts: async () => {
        const base = this.where(ctx, q, false);
        const [actif, parti] = await Promise.all([
          this.prisma.employee.count({
            where: {
              AND: [
                base,
                { OR: [{ endDate: null }, { endDate: { gte: day } }] },
              ],
            },
          }),
          this.prisma.employee.count({
            where: { AND: [base, { endDate: { lt: day } }] },
          }),
        ]);
        return { statusCounts: { ACTIF: actif, PARTI: parti } };
      },
    };
  }

  private async find(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<EmployeeRecord> {
    const row = await client.employee.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: employeeInclude,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(EMPLOYEE_NOT_FOUND);
    return row;
  }

  async get(ctx: RequestContext, id: string): Promise<EmployeeDetail> {
    const row = await this.find(this.prisma, ctx, id);
    const day = today();
    const [groups, openTasks] = await Promise.all([
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: {
          employeeId: id,
          date: { gte: addDays(day, -29), lte: day },
        },
        _count: { _all: true },
      }),
      this.prisma.task.count({
        where: { assigneeId: id, status: { in: OPEN_STATUSES } },
      }),
    ]);
    return {
      ...toEmployeeItem(row, day, this.withSalary(ctx)),
      attendanceLast30: countByStatus(groups),
      openTasks,
    };
  }

  /** Who works on `at` (default today), for the selects of the task form and the day sheet: no salary. */
  async options(
    ctx: RequestContext,
    at: string | undefined,
  ): Promise<{ items: EmployeeOption[] }> {
    const day = at ? requireDay(at) : today();
    const rows = await this.prisma.employee.findMany({
      where: {
        farmId: { in: ctx.farmIds },
        hireDate: { lte: day },
        OR: [{ endDate: null }, { endDate: { gte: day } }],
      },
      select: { id: true, name: true, jobTitle: true, userId: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { items: rows };
  }

  /** The active users of the farm who are not an employee yet (the Directeur has no `utilisateurs` read). */
  async userOptions(ctx: RequestContext) {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        active: true,
        farms: { some: { farmId: ctx.farmId as string } },
        employee: { none: { farmId: ctx.farmId as string } },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { items: users };
  }

  /** What the staff costs for a month, and the manual entry already posted for it. The route writes nothing. */
  async payroll(ctx: RequestContext, month: string): Promise<PayrollPreview> {
    // Under `all` farms the shared guard answers 403 before this runs (Q41).
    const farmId = ctx.farmId as string;
    const { from } = monthBounds(month);
    const now = today();
    if (from.getTime() > now.getTime()) {
      throw new BadRequestException(FUTURE_MONTH);
    }
    const employees = await this.prisma.employee.findMany({
      where: { farmId, monthlySalary: { not: null } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const { lines, total } = payrollOf(employees, month);
    const label = payrollLabel(month);
    const existing = await this.prisma.financeEntry.findFirst({
      where: {
        farmId,
        kind: 'DEPENSE',
        category: 'SALAIRES',
        label,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, amount: true },
    });
    return {
      month,
      label,
      lines: lines.map((l) => ({
        ...l,
        monthlySalary: toMoney(l.monthlySalary),
      })),
      total: toMoney(total),
      existing: existing
        ? { id: existing.id, amount: toMoney(existing.amount) }
        : null,
    };
  }

  /** A user must belong to the organisation, be active and be assigned to the farm. */
  private async assertUser(
    tx: Tx,
    ctx: RequestContext,
    userId: string,
    employeeId: string | null,
  ): Promise<void> {
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        organizationId: ctx.user.organizationId,
        active: true,
        farms: { some: { farmId: ctx.farmId as string } },
      },
      select: { id: true },
    });
    if (!user) throw new BadRequestException(USER_INVALID);
    await this.assertUserFree(tx, ctx, userId, employeeId);
  }

  private async assertUserFree(
    client: Tx | PrismaService,
    ctx: RequestContext,
    userId: string,
    employeeId: string | null,
  ): Promise<void> {
    const linked = await client.employee.findFirst({
      where: {
        farmId: ctx.farmId as string,
        userId,
        ...(employeeId ? { id: { not: employeeId } } : {}),
      },
      select: { id: true },
    });
    if (linked) throw new ConflictException(USER_LINKED);
  }

  private async assertNameFree(
    client: Tx | PrismaService,
    ctx: RequestContext,
    name: string,
    employeeId: string | null,
  ): Promise<void> {
    const taken = await client.employee.findFirst({
      where: {
        farmId: ctx.farmId as string,
        name,
        ...(employeeId ? { id: { not: employeeId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw new ConflictException(NAME_TAKEN);
  }

  /** Runs a write; a lost race on a unique index says which one it was (name or linked user). */
  private async write<T>(
    ctx: RequestContext,
    keys: { name?: string; userId?: string | null; id: string | null },
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'P2002') {
        if (keys.name) {
          await this.assertNameFree(this.prisma, ctx, keys.name, keys.id);
        }
        if (keys.userId) {
          await this.assertUserFree(this.prisma, ctx, keys.userId, keys.id);
        }
        throw new ConflictException(NAME_TAKEN);
      }
      if (code === 'P2003') throw new ConflictException(IN_USE);
      throw error;
    }
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    before: EmployeeRecord | undefined,
    after: EmployeeRecord | undefined,
  ) {
    const day = today();
    const snap = (e?: EmployeeRecord) => e && toEmployeeItem(e, day, true);
    const row = (after ?? before) as EmployeeRecord;
    return this.audit.logChange(
      {
        ctx,
        module: 'personnel',
        action,
        recordId: row.id,
        label: row.name,
        before: snap(before),
        after: snap(after),
      },
      tx,
    );
  }

  private salary(
    ctx: RequestContext,
    value: number | null | undefined,
  ): Decimal | null | undefined {
    if (!this.withSalary(ctx) || value === undefined) return undefined;
    return value === null ? null : new Decimal(value);
  }

  create(ctx: RequestContext, dto: CreateEmployeeDto): Promise<EmployeeItem> {
    const hireDate = requireDay(dto.hireDate);
    const endDate = dto.endDate ? requireDay(dto.endDate) : null;
    if (endDate && endDate.getTime() < hireDate.getTime()) {
      throw new BadRequestException(END_BEFORE_HIRE);
    }
    const userId = blank(dto.userId);
    return this.write(ctx, { name: dto.name, userId, id: null }, () =>
      this.prisma.$transaction(async (tx) => {
        if (userId) await this.assertUser(tx, ctx, userId, null);
        await this.assertNameFree(tx, ctx, dto.name, null);
        const created = await tx.employee.create({
          data: {
            farmId: ctx.farmId as string,
            name: dto.name,
            fullName: blank(dto.fullName),
            jobTitle: dto.jobTitle,
            phone: blank(dto.phone),
            contractType: dto.contractType,
            hireDate,
            endDate,
            monthlySalary: this.salary(ctx, dto.monthlySalary) ?? null,
            userId,
            note: blank(dto.note),
          },
          include: employeeInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'CREATE', undefined, created);
        return toEmployeeItem(created, today(), this.withSalary(ctx));
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeItem> {
    const hireDate = dto.hireDate ? requireDay(dto.hireDate) : undefined;
    const endDate =
      dto.endDate === undefined
        ? undefined
        : dto.endDate === null
          ? null
          : requireDay(dto.endDate);
    return this.write(ctx, { name: dto.name, userId: dto.userId, id }, () =>
      this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'Employee', id, ctx.farmIds);
        const before = await this.find(tx, ctx, id);
        const hire = hireDate ?? before.hireDate;
        const end = endDate === undefined ? before.endDate : endDate;
        if (end && end.getTime() < hire.getTime()) {
          throw new BadRequestException(END_BEFORE_HIRE);
        }
        if (dto.name !== undefined && dto.name !== before.name) {
          await this.assertNameFree(tx, ctx, dto.name, id);
        }
        const userId = dto.userId === undefined ? undefined : blank(dto.userId);
        if (userId && userId !== before.userId) {
          await this.assertUser(tx, ctx, userId, id);
        }
        if (end && end.getTime() !== before.endDate?.getTime()) {
          const [late, lateTasks] = await Promise.all([
            tx.attendance.count({
              where: { employeeId: id, date: { gt: end } },
            }),
            tx.task.count({ where: { assigneeId: id, ...tasksAfter(end) } }),
          ]);
          if (late + lateTasks > 0) throw new ConflictException(AFTER_END);
        }
        if (hireDate && hireDate.getTime() > before.hireDate.getTime()) {
          const [early, earlyTasks] = await Promise.all([
            tx.attendance.count({
              where: { employeeId: id, date: { lt: hireDate } },
            }),
            tx.task.count({
              where: { assigneeId: id, ...tasksBefore(hireDate) },
            }),
          ]);
          if (early + earlyTasks > 0) throw new ConflictException(BEFORE_HIRE);
        }
        const updated = await tx.employee.update({
          where: { id },
          data: {
            name: dto.name,
            jobTitle: dto.jobTitle,
            contractType: dto.contractType,
            hireDate,
            endDate,
            userId,
            ...(dto.fullName !== undefined
              ? { fullName: blank(dto.fullName) }
              : {}),
            ...(dto.phone !== undefined ? { phone: blank(dto.phone) } : {}),
            ...(dto.note !== undefined ? { note: blank(dto.note) } : {}),
            monthlySalary: this.salary(ctx, dto.monthlySalary),
          },
          include: employeeInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'UPDATE', before, updated);
        return toEmployeeItem(updated, today(), this.withSalary(ctx));
      }),
    );
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'Employee', id, ctx.farmIds);
        const before = await this.find(tx, ctx, id);
        const [attendance, tasks] = await Promise.all([
          tx.attendance.count({ where: { employeeId: id } }),
          tx.task.count({ where: { assigneeId: id } }),
        ]);
        if (attendance + tasks > 0) throw new ConflictException(HAS_HISTORY);
        await tx.employee.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, undefined);
      });
    } catch (error) {
      // A foreign key of a record written meanwhile (attendance or a task): the same advice.
      if ((error as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(HAS_HISTORY);
      }
      throw error;
    }
  }
}
