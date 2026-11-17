import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { AuditService } from '../audit/audit.service';
import { ascending } from '../common/ascending';
import { assertNotFuture, formatDay, requireDay } from '../common/days';
import { lockRow } from '../common/lock-row';
import type { Prisma } from '../generated/prisma/client';
import type { AttendanceStatus } from '../generated/prisma/enums';
import { containsInsensitive, IN_USE } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AttendanceDayDto,
  AttendanceQueryDto,
  CreateAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';
import { ATTENDANCE_STATUSES } from './dto/attendance.dto';
import { isActiveOn } from './employee-rules';
import {
  attendanceInclude,
  toAttendanceItem,
  type AttendanceItem,
  type AttendanceRecord,
} from './employee-view';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = 'Présence introuvable';
const EMPLOYEE_INVALID = 'Employé invalide pour cette ferme';
const HOURS_ONLY_PRESENT = "Les heures ne s'indiquent que pour une présence";
const TWICE = 'Un employé figure deux fois dans la feuille';
const SORTABLE = ['date', 'employeeName'];

const blank = <T>(value: T | null | undefined): T | null =>
  value === undefined || value === '' ? null : value;

const notInPost = (name: string, day: Date) =>
  `${name} n'est pas en poste le ${formatDay(day)}`;
const alreadyEntered = (name: string, day: Date) =>
  `La présence de ${name} le ${formatDay(day)} est déjà saisie`;

interface Values {
  status: AttendanceStatus;
  hours: Decimal | null;
  note: string | null;
}

/**
 * Attendance is a daily entry (`create` on `personnel`). The employee row is
 * locked first (several of them in ascending id order for a day sheet), then
 * the attendance row; an attendance exists only on a day the employee is in post.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private where(
    ctx: RequestContext,
    q: AttendanceQueryDto,
    withStatus: boolean,
  ): Prisma.AttendanceWhereInput {
    const from = q.from ? requireDay(q.from) : undefined;
    const to = q.to ? requireDay(q.to) : undefined;
    return {
      farmId: { in: ctx.farmIds },
      ...(withStatus && q.status
        ? { status: q.status as AttendanceStatus }
        : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(from || to ? { date: { gte: from, lte: to } } : {}),
      ...(q.search
        ? { employee: { name: containsInsensitive(q.search) } }
        : {}),
    };
  }

  listArgs(ctx: RequestContext, q: AttendanceQueryDto) {
    if (q.status && !ATTENDANCE_STATUSES.includes(q.status as never)) {
      throw new BadRequestException('Statut invalide');
    }
    const where = this.where(ctx, q, true);
    const sorted = orderBy(q, SORTABLE, { date: 'desc' });
    const [[field, dir]] = Object.entries(sorted);
    const order: Prisma.AttendanceOrderByWithRelationInput[] =
      field === 'employeeName'
        ? [{ employee: { name: dir } }, { date: 'desc' }]
        : [{ date: dir }, { employee: { name: 'asc' } }];
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.attendance.findMany({
            where,
            include: attendanceInclude,
            relationLoadStrategy: 'join',
            orderBy: [...order, { id: 'asc' }],
            ...range,
          })
        ).map(toAttendanceItem),
      count: () => this.prisma.attendance.count({ where }),
      /** Per status, over the other filters (the status filter itself is left out). */
      statusCounts: async () => {
        const groups = await this.prisma.attendance.groupBy({
          by: ['status'],
          where: this.where(ctx, q, false),
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          ATTENDANCE_STATUSES.map((s) => [s, 0]),
        ) as Record<AttendanceStatus, number>;
        for (const g of groups) counts[g.status] = g._count._all;
        return { statusCounts: counts };
      },
    };
  }

  private async find(
    tx: Tx,
    ctx: RequestContext,
    id: string,
  ): Promise<AttendanceRecord> {
    const row = await tx.attendance.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: attendanceInclude,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    before: AttendanceRecord | undefined,
    after: AttendanceRecord | undefined,
  ) {
    const row = (after ?? before) as AttendanceRecord;
    return this.audit.logChange(
      {
        ctx,
        module: 'personnel',
        action,
        recordId: row.id,
        label: `${row.employee.name} · ${formatDay(row.date)}`,
        before: before && toAttendanceItem(before),
        after: after && toAttendanceItem(after),
      },
      tx,
    );
  }

  /** The employees of the farm, locked in ascending id order, as they are once locked. */
  private async lockEmployees(tx: Tx, ctx: RequestContext, ids: string[]) {
    const order = ascending(ids);
    const known = await tx.employee.findMany({
      where: { id: { in: order }, farmId: ctx.farmId as string },
      select: { id: true },
    });
    if (known.length !== order.length) {
      throw new BadRequestException(EMPLOYEE_INVALID);
    }
    for (const id of order) await lockRow(tx, 'Employee', id, ctx.farmIds);
    const rows = await tx.employee.findMany({
      where: { id: { in: order } },
      select: { id: true, name: true, hireDate: true, endDate: true },
    });
    return new Map(rows.map((e) => [e.id, e]));
  }

  private assertValues(status: AttendanceStatus, hours: unknown) {
    if (hours !== null && hours !== undefined && status !== 'PRESENT') {
      throw new BadRequestException(HOURS_ONLY_PRESENT);
    }
  }

  async create(
    ctx: RequestContext,
    dto: CreateAttendanceDto,
  ): Promise<AttendanceItem> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const employees = await this.lockEmployees(tx, ctx, [dto.employeeId]);
        const employee = employees.get(dto.employeeId)!;
        if (!isActiveOn(employee, date)) {
          throw new BadRequestException(notInPost(employee.name, date));
        }
        this.assertValues(dto.status, dto.hours);
        const taken = await tx.attendance.findUnique({
          where: { employeeId_date: { employeeId: dto.employeeId, date } },
          select: { id: true },
        });
        if (taken) {
          throw new ConflictException(alreadyEntered(employee.name, date));
        }
        const created = await tx.attendance.create({
          data: {
            farmId: ctx.farmId as string,
            employeeId: dto.employeeId,
            date,
            status: dto.status,
            hours: dto.hours === undefined ? null : new Decimal(dto.hours),
            note: blank(dto.note),
            createdById: ctx.user.id,
          },
          include: attendanceInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'CREATE', undefined, created);
        return toAttendanceItem(created);
      });
    } catch (error) {
      throw await this.explain(error, dto.employeeId, date);
    }
  }

  /** A unique-index race on (employee, day) reads like the pre-check; a foreign key like "in use". */
  private async explain(error: unknown, employeeId: string, date: Date) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'P2002') {
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true },
      });
      return new ConflictException(alreadyEntered(employee?.name ?? '', date));
    }
    if (code === 'P2003') return new ConflictException(IN_USE);
    return error;
  }

  async update(
    ctx: RequestContext,
    id: string,
    dto: UpdateAttendanceDto,
  ): Promise<AttendanceItem> {
    return this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      await lockRow(tx, 'Employee', found.employeeId, ctx.farmIds);
      await lockRow(tx, 'Attendance', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      const status = dto.status ?? before.status;
      if (status !== 'PRESENT' && dto.hours !== undefined) {
        this.assertValues(status, dto.hours);
      }
      // Leaving PRESENT clears the hours; they exist only for a presence.
      const hours =
        status !== 'PRESENT'
          ? null
          : dto.hours === undefined
            ? before.hours
            : dto.hours === null
              ? null
              : new Decimal(dto.hours);
      const updated = await tx.attendance.update({
        where: { id },
        data: {
          status,
          hours,
          ...(dto.note !== undefined ? { note: blank(dto.note) } : {}),
        },
        include: attendanceInclude,
        relationLoadStrategy: 'join',
      });
      await this.log(tx, ctx, 'UPDATE', before, updated);
      return toAttendanceItem(updated);
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const found = await this.find(tx, ctx, id);
      await lockRow(tx, 'Employee', found.employeeId, ctx.farmIds);
      await lockRow(tx, 'Attendance', id, ctx.farmIds);
      const before = await this.find(tx, ctx, id);
      await tx.attendance.delete({ where: { id } });
      await this.log(tx, ctx, 'DELETE', before, undefined);
    });
  }

  /**
   * Sets the day sheet of the listed employees in one transaction (insert or
   * update by employee and day). Only the entries that change write and audit.
   */
  async setDay(
    ctx: RequestContext,
    dto: AttendanceDayDto,
  ): Promise<AttendanceItem[]> {
    const date = requireDay(dto.date);
    assertNotFuture(date);
    const ids = dto.entries.map((e) => e.employeeId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(TWICE);
    }
    for (const e of dto.entries) this.assertValues(e.status, e.hours);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const employees = await this.lockEmployees(tx, ctx, ids);
        for (const e of dto.entries) {
          const employee = employees.get(e.employeeId)!;
          if (!isActiveOn(employee, date)) {
            throw new BadRequestException(notInPost(employee.name, date));
          }
        }
        const stored = await tx.attendance.findMany({
          where: { employeeId: { in: ids }, date },
          include: attendanceInclude,
          relationLoadStrategy: 'join',
        });
        const byEmployee = new Map(stored.map((a) => [a.employeeId, a]));
        const rows: AttendanceRecord[] = [];
        for (const e of dto.entries) {
          const next: Values = {
            status: e.status,
            hours: e.hours === undefined ? null : new Decimal(e.hours),
            note: blank(e.note),
          };
          const before = byEmployee.get(e.employeeId);
          if (!before) {
            const created = await tx.attendance.create({
              data: {
                farmId: ctx.farmId as string,
                employeeId: e.employeeId,
                date,
                ...next,
                createdById: ctx.user.id,
              },
              include: attendanceInclude,
              relationLoadStrategy: 'join',
            });
            await this.log(tx, ctx, 'CREATE', undefined, created);
            rows.push(created);
            continue;
          }
          const same =
            before.status === next.status &&
            before.note === next.note &&
            (before.hours === null
              ? next.hours === null
              : next.hours !== null && before.hours.equals(next.hours));
          if (same) {
            rows.push(before);
            continue;
          }
          const updated = await tx.attendance.update({
            where: { id: before.id },
            data: next,
            include: attendanceInclude,
            relationLoadStrategy: 'join',
          });
          await this.log(tx, ctx, 'UPDATE', before, updated);
          rows.push(updated);
        }
        return rows.map(toAttendanceItem);
      });
    } catch (error) {
      // The employee rows are locked first, so a duplicate cannot race; a foreign key can.
      throw await this.explain(error, ids[0], date);
    }
  }
}
