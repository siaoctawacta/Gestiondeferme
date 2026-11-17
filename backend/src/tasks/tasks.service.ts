import { readFile } from 'fs/promises';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { blank } from '../common/blank';
import { addDays, assertNotFuture, requireDay, today } from '../common/days';
import { lockRow } from '../common/lock-row';
import {
  detectImage,
  removeUpload,
  saveUpload,
  uploadPath,
  type UploadedBlob,
} from '../common/uploads';
import type { Prisma } from '../generated/prisma/client';
import { containsInsensitive, orConflict } from '../listing/list-helpers';
import { orderBy } from '../listing/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompleteTaskDto,
  CreateTaskDto,
  TaskQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';
import {
  taskInclude,
  taskSnapshot,
  toTaskItem,
  type TaskItem,
  type TaskRecord,
} from './task-view';
import {
  TASK_STATUS_LIST,
  isUntouched,
  nextDueDate,
  refusal,
  statusAfter,
  type TaskAction,
  type TaskStatusValue,
} from './task-workflow';

type Tx = Prisma.TransactionClient;

export const TASK_NOT_FOUND = 'Tâche introuvable';
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_INVALID =
  'Photo invalide : JPEG, PNG ou WebP de 5 Mo au plus';
const NOT_YOURS =
  'Vous ne pouvez faire avancer que les tâches qui vous sont assignées';
const ASSIGNEE_INVALID = 'Responsable invalide pour cette ferme';
const LOT_INVALID = 'Lot invalide pour cette ferme';
const BUILDING_INVALID = 'Bâtiment invalide pour cette ferme';
const EQUIPMENT_INVALID = 'Équipement invalide pour cette ferme';
const ONE_TARGET =
  'Une tâche concerne au plus un lot, un bâtiment ou un équipement';
const COMPLETION_INVALID = 'Date de réalisation invalide';
const NEXT_STARTED =
  "L'occurrence suivante a déjà commencé : supprimez-la ou retirez sa photo";
const NO_PROOF = 'Aucune photo pour cette tâche';
const PROOF_MISSING = 'Photo introuvable';
/** A completion may be dated at most this many days before the due date. */
const COMPLETION_LEAD_DAYS = 30;
const SORTABLE = ['dueDate', 'priority', 'title'];

interface Targets {
  batchId: string | null;
  buildingId: string | null;
  equipmentId: string | null;
}

/**
 * Tasks are daily entries (`create` writes them); starting, completing,
 * reopening and the proof photo need `update`, and without `create` only for a
 * task assigned to the caller. Every write locks the task row first, then
 * asks the workflow (`refusal`); a new assignee is locked after it.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ reads */

  private where(
    ctx: RequestContext,
    q: TaskQueryDto,
    withStatus: boolean,
  ): Prisma.TaskWhereInput {
    const and: Prisma.TaskWhereInput[] = [];
    if (withStatus && q.status) {
      and.push({ status: q.status as TaskStatusValue });
    }
    if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.mine === 'true') and.push({ assignee: { userId: ctx.user.id } });
    if (q.priority) and.push({ priority: q.priority });
    if (q.from) and.push({ dueDate: { gte: requireDay(q.from) } });
    if (q.to) and.push({ dueDate: { lte: requireDay(q.to) } });
    if (q.batchId) and.push({ batchId: q.batchId });
    if (q.buildingId) and.push({ buildingId: q.buildingId });
    if (q.equipmentId) and.push({ equipmentId: q.equipmentId });
    if (q.search) {
      and.push({
        OR: [
          { title: containsInsensitive(q.search) },
          { description: containsInsensitive(q.search) },
          { assignee: { name: containsInsensitive(q.search) } },
        ],
      });
    }
    return { farmId: { in: ctx.farmIds }, ...(and.length ? { AND: and } : {}) };
  }

  /**
   * Due date, then urgent first, then title (the list the screen shows); a
   * chosen column leads, the others keep their place behind it.
   */
  private order(q: TaskQueryDto): Prisma.TaskOrderByWithRelationInput[] {
    const defaults: Record<string, 'asc' | 'desc'> = {
      dueDate: 'asc',
      priority: 'desc',
      title: 'asc',
    };
    const chosen = orderBy(q, SORTABLE, {});
    const lead = Object.entries(chosen);
    const rest = Object.entries(defaults).filter(([k]) => !(k in chosen));
    return [...lead, ...rest]
      .map(([k, v]) => ({ [k]: v }))
      .concat([{ id: 'asc' }]);
  }

  listArgs(ctx: RequestContext, q: TaskQueryDto) {
    if (q.status && !TASK_STATUS_LIST.includes(q.status as TaskStatusValue)) {
      throw new BadRequestException('Statut invalide');
    }
    const where = this.where(ctx, q, true);
    const order = this.order(q);
    const day = today();
    return {
      find: async (range: { skip?: number; take: number }) =>
        (
          await this.prisma.task.findMany({
            where,
            include: taskInclude,
            relationLoadStrategy: 'join',
            orderBy: order,
            ...range,
          })
        ).map((t) => toTaskItem(t, day, ctx.user.id)),
      count: () => this.prisma.task.count({ where }),
      /** Over the other filters: the status filter itself is left out. */
      statusCounts: async () => {
        const groups = await this.prisma.task.groupBy({
          by: ['status'],
          where: this.where(ctx, q, false),
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          TASK_STATUS_LIST.map((s) => [s, 0]),
        ) as Record<TaskStatusValue, number>;
        for (const g of groups) counts[g.status] = g._count._all;
        return { statusCounts: counts };
      },
    };
  }

  private async find(
    client: Tx | PrismaService,
    ctx: RequestContext,
    id: string,
  ): Promise<TaskRecord> {
    const row = await client.task.findFirst({
      where: { id, farmId: { in: ctx.farmIds } },
      include: taskInclude,
      relationLoadStrategy: 'join',
    });
    if (!row) throw new NotFoundException(TASK_NOT_FOUND);
    return row;
  }

  async get(ctx: RequestContext, id: string): Promise<TaskItem> {
    return toTaskItem(
      await this.find(this.prisma, ctx, id),
      today(),
      ctx.user.id,
    );
  }

  /** The stored proof photo of a task of the request's farms: its bytes and type. */
  async readProof(
    ctx: RequestContext,
    id: string,
  ): Promise<{ bytes: Buffer; mime: string }> {
    const row = await this.find(this.prisma, ctx, id);
    if (!row.proofPath || !row.proofMime) throw new NotFoundException(NO_PROOF);
    try {
      return {
        bytes: await readFile(uploadPath(row.proofPath)),
        mime: row.proofMime,
      };
    } catch {
      throw new NotFoundException(PROOF_MISSING);
    }
  }

  /* ------------------------------------------------------- body checks */

  private assertOneTarget(targets: Targets): void {
    const set = [
      targets.batchId,
      targets.buildingId,
      targets.equipmentId,
    ].filter((id) => id !== null);
    if (set.length > 1) throw new BadRequestException(ONE_TARGET);
  }

  /**
   * The assignee: an employee of the request's farm, in post on the due date.
   * Its row is locked, so a departure date set meanwhile waits for this write
   * and then sees the task.
   */
  private async assertAssignee(
    tx: Tx,
    ctx: RequestContext,
    employeeId: string,
    dueDate: Date,
  ): Promise<void> {
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, farmId: ctx.farmId as string },
      select: { name: true },
    });
    if (!employee) throw new BadRequestException(ASSIGNEE_INVALID);
    await lockRow(tx, 'Employee', employeeId, ctx.farmIds);
    const locked = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { hireDate: true, endDate: true },
    });
    // Deleted between the first read and the lock.
    if (!locked) throw new BadRequestException(ASSIGNEE_INVALID);
    if (
      locked.hireDate.getTime() > dueDate.getTime() ||
      (locked.endDate && locked.endDate.getTime() < dueDate.getTime())
    ) {
      throw new BadRequestException(
        `${employee.name} n'est pas en poste à cette date`,
      );
    }
  }

  /** The targets named in a body: of the request's farm (a lot also still open). */
  private async assertTargets(
    tx: Tx,
    ctx: RequestContext,
    next: Targets,
    before: Targets | null,
  ): Promise<void> {
    const farmId = ctx.farmId as string;
    if (next.batchId && next.batchId !== before?.batchId) {
      const lot = await tx.animalBatch.findFirst({
        where: { id: next.batchId, farmId, status: 'EN_COURS' },
        select: { id: true },
      });
      if (!lot) throw new BadRequestException(LOT_INVALID);
    }
    if (next.buildingId && next.buildingId !== before?.buildingId) {
      const building = await tx.building.findFirst({
        where: { id: next.buildingId, farmId },
        select: { id: true },
      });
      if (!building) throw new BadRequestException(BUILDING_INVALID);
    }
    if (next.equipmentId && next.equipmentId !== before?.equipmentId) {
      // Lock order: task, then its assignee's employee row, then the equipment
      // row: a retirement (which counts the open tasks under this lock) either
      // waits for this write or makes it see the equipment retired.
      await lockRow(tx, 'Equipment', next.equipmentId, [farmId]);
      const equipment = await tx.equipment.findFirst({
        where: { id: next.equipmentId, farmId, retiredAt: null },
        select: { id: true },
      });
      if (!equipment) throw new BadRequestException(EQUIPMENT_INVALID);
    }
  }

  /** Whoever may create tasks, or the assignee himself (the user linked to the assigned employee). */
  private assertMayAdvance(ctx: RequestContext, row: TaskRecord): void {
    if (can(ctx.user.role, 'taches', 'create')) return;
    if (row.assignee?.userId && row.assignee.userId === ctx.user.id) return;
    throw new ForbiddenException(NOT_YOURS);
  }

  private log(
    tx: Tx,
    ctx: RequestContext,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    before: TaskRecord | undefined,
    after: TaskRecord | undefined,
  ) {
    const row = (after ?? before) as TaskRecord;
    return this.audit.logChange(
      {
        ctx,
        farmId: row.farmId,
        module: 'taches',
        action,
        recordId: row.id,
        label: row.title,
        before: before && taskSnapshot(before),
        after: after && taskSnapshot(after),
      },
      tx,
    );
  }

  /* ------------------------------------------------------------ writes */

  create(ctx: RequestContext, dto: CreateTaskDto): Promise<TaskItem> {
    const dueDate = requireDay(dto.dueDate);
    const targets: Targets = {
      batchId: blank(dto.batchId),
      buildingId: blank(dto.buildingId),
      equipmentId: blank(dto.equipmentId),
    };
    this.assertOneTarget(targets);
    const assigneeId = blank(dto.assigneeId);
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        if (assigneeId) {
          await this.assertAssignee(tx, ctx, assigneeId, dueDate);
        }
        await this.assertTargets(tx, ctx, targets, null);
        const created = await tx.task.create({
          data: {
            farmId: ctx.farmId as string,
            title: dto.title,
            description: blank(dto.description),
            assigneeId,
            dueDate,
            dueTime: blank(dto.dueTime),
            priority: dto.priority,
            recurrence: dto.recurrence,
            ...targets,
            createdById: ctx.user.id,
          },
          include: taskInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'CREATE', undefined, created);
        return toTaskItem(created, today(), ctx.user.id);
      }),
    );
  }

  update(
    ctx: RequestContext,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<TaskItem> {
    const dueDate = dto.dueDate ? requireDay(dto.dueDate) : undefined;
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'Task', id, ctx.farmIds);
        const before = await this.find(tx, ctx, id);
        const why = refusal(before.status, 'edit');
        if (why) throw new ConflictException(why);

        const pick = (value: string | null | undefined, kept: string | null) =>
          value === undefined ? kept : blank(value);
        const next: Targets = {
          batchId: pick(dto.batchId, before.batchId),
          buildingId: pick(dto.buildingId, before.buildingId),
          equipmentId: pick(dto.equipmentId, before.equipmentId),
        };
        this.assertOneTarget(next);
        const assigneeId = pick(dto.assigneeId, before.assigneeId);
        const due = dueDate ?? before.dueDate;
        const dateChanged = due.getTime() !== before.dueDate.getTime();
        const recurrenceChanged =
          dto.recurrence !== undefined && dto.recurrence !== before.recurrence;
        const moved = assigneeId !== before.assigneeId || dateChanged;
        if (assigneeId && moved) {
          await this.assertAssignee(tx, ctx, assigneeId, due);
        }
        await this.assertTargets(tx, ctx, next, before);

        const updated = await tx.task.update({
          where: { id },
          data: {
            title: dto.title,
            description:
              dto.description === undefined
                ? undefined
                : blank(dto.description),
            assigneeId,
            dueDate,
            dueTime: dto.dueTime === undefined ? undefined : blank(dto.dueTime),
            priority: dto.priority,
            recurrence: dto.recurrence,
            // A due date or recurrence that really changes starts a new series: its anchor day is taken again at completion.
            ...(dateChanged || recurrenceChanged
              ? { recurrenceDay: null }
              : {}),
            ...next,
          },
          include: taskInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'UPDATE', before, updated);
        return toTaskItem(updated, today(), ctx.user.id);
      }),
    );
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const proof = await orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'Task', id, ctx.farmIds);
        const before = await this.find(tx, ctx, id);
        const why = refusal(before.status, 'delete');
        if (why) throw new ConflictException(why);
        await tx.task.delete({ where: { id } });
        await this.log(tx, ctx, 'DELETE', before, undefined);
        return before.proofPath;
      }),
    );
    await removeUpload(proof);
  }

  /**
   * Runs a progress step under the task's row lock: the workflow first (409),
   * then who may advance it (403).
   */
  private advance<T>(
    ctx: RequestContext,
    id: string,
    action: TaskAction,
    run: (tx: Tx, before: TaskRecord) => Promise<T>,
  ): Promise<T> {
    return orConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.find(tx, ctx, id);
        await lockRow(tx, 'Task', id, ctx.farmIds);
        const before = await this.find(tx, ctx, id);
        const why = refusal(before.status, action);
        if (why) throw new ConflictException(why);
        this.assertMayAdvance(ctx, before);
        return run(tx, before);
      }),
    );
  }

  start(ctx: RequestContext, id: string): Promise<TaskItem> {
    return this.advance(ctx, id, 'start', async (tx, before) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          status: statusAfter('start') as TaskStatusValue,
          startedAt: new Date(),
        },
        include: taskInclude,
        relationLoadStrategy: 'join',
      });
      await this.log(tx, ctx, 'UPDATE', before, updated);
      return toTaskItem(updated, today(), ctx.user.id);
    });
  }

  /**
   * Completing a recurring task creates its next occurrence in the same
   * transaction (unassigned when its assignee has left by then).
   */
  complete(
    ctx: RequestContext,
    id: string,
    dto: CompleteTaskDto,
  ): Promise<TaskItem> {
    return this.advance(ctx, id, 'complete', async (tx, before) => {
      const date = dto.date ? requireDay(dto.date) : today();
      assertNotFuture(date);
      if (
        date.getTime() <
        addDays(before.dueDate, -COMPLETION_LEAD_DAYS).getTime()
      ) {
        throw new BadRequestException(COMPLETION_INVALID);
      }
      const updated = await tx.task.update({
        where: { id },
        data: {
          status: statusAfter('complete') as TaskStatusValue,
          completedDate: date,
          completedById: ctx.user.id,
        },
        include: taskInclude,
        relationLoadStrategy: 'join',
      });
      await this.log(tx, ctx, 'UPDATE', before, updated);
      const anchor = before.recurrenceDay ?? before.dueDate.getUTCDate();
      const due = nextDueDate(before.dueDate, before.recurrence, anchor);
      if (due) await this.occurrence(tx, ctx, before, due, anchor);
      return toTaskItem(updated, today(), ctx.user.id);
    });
  }

  /**
   * The next occurrence of a completed recurring task. Lock order: the task row
   * (taken by `advance`), then the assignee's employee row, the same as
   * `assertAssignee`, so a departure date entered meanwhile either waits for
   * this write or is seen by it: the occurrence is never left due after the
   * departure. A lot closed or an equipment retired since is left out of the occurrence (it must never
   * fail the completion).
   */
  private async occurrence(
    tx: Tx,
    ctx: RequestContext,
    from: TaskRecord,
    dueDate: Date,
    anchorDay: number,
  ): Promise<void> {
    let assigneeId = from.assigneeId;
    if (assigneeId) {
      await lockRow(tx, 'Employee', assigneeId, ctx.farmIds);
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: assigneeId },
        select: { endDate: true },
      });
      if (employee.endDate && employee.endDate.getTime() < dueDate.getTime()) {
        assigneeId = null;
      }
    }
    let batchId = from.batchId;
    if (batchId) {
      const open = await tx.animalBatch.findFirst({
        where: { id: batchId, farmId: from.farmId, status: 'EN_COURS' },
        select: { id: true },
      });
      if (!open) batchId = null;
    }
    let equipmentId = from.equipmentId;
    if (equipmentId) {
      const inService = await tx.equipment.findFirst({
        where: { id: equipmentId, farmId: from.farmId, retiredAt: null },
        select: { id: true },
      });
      if (!inService) equipmentId = null;
    }
    const created = await tx.task.create({
      data: {
        farmId: from.farmId,
        title: from.title,
        description: from.description,
        assigneeId,
        dueDate,
        dueTime: from.dueTime,
        priority: from.priority,
        recurrence: from.recurrence,
        recurrenceDay: from.recurrence === 'MENSUELLE' ? anchorDay : null,
        batchId,
        buildingId: from.buildingId,
        equipmentId,
        previousTaskId: from.id,
        createdById: ctx.user.id,
      },
      include: taskInclude,
      relationLoadStrategy: 'join',
    });
    await this.log(tx, ctx, 'CREATE', undefined, created);
  }

  /**
   * What a reopened task may still point at (never a refusal, the same spirit
   * as the occurrence rule): an assignee not in post on the due date and a
   * retired equipment are cleared. Lock order: the task row (taken by
   * `advance`), then the assignee's employee row, then the equipment row, the
   * same as `update`, so a departure date or a retirement entered meanwhile
   * either waits for this write or is seen by it.
   */
  private async stillValid(
    tx: Tx,
    ctx: RequestContext,
    task: TaskRecord,
  ): Promise<{ assigneeId: string | null; equipmentId: string | null }> {
    let assigneeId = task.assigneeId;
    if (assigneeId) {
      await lockRow(tx, 'Employee', assigneeId, ctx.farmIds);
      const employee = await tx.employee.findUnique({
        where: { id: assigneeId },
        select: { hireDate: true, endDate: true },
      });
      const due = task.dueDate.getTime();
      if (
        !employee ||
        employee.hireDate.getTime() > due ||
        (employee.endDate && employee.endDate.getTime() < due)
      ) {
        assigneeId = null;
      }
    }
    let equipmentId = task.equipmentId;
    if (equipmentId) {
      await lockRow(tx, 'Equipment', equipmentId, ctx.farmIds);
      const inService = await tx.equipment.findFirst({
        where: { id: equipmentId, retiredAt: null },
        select: { id: true },
      });
      if (!inService) equipmentId = null;
    }
    return { assigneeId, equipmentId };
  }

  /** The generated occurrence goes with the reopening, while nobody has touched it. */
  reopen(ctx: RequestContext, id: string): Promise<TaskItem> {
    return this.advance(ctx, id, 'reopen', async (tx, before) => {
      const next = await tx.task.findUnique({
        where: { previousTaskId: id },
        select: { id: true },
      });
      if (next) {
        await lockRow(tx, 'Task', next.id, ctx.farmIds);
        const occurrence = await this.find(tx, ctx, next.id);
        if (!isUntouched(occurrence.status) || occurrence.proofPath) {
          throw new ConflictException(NEXT_STARTED);
        }
        await tx.task.delete({ where: { id: next.id } });
        await this.log(tx, ctx, 'DELETE', occurrence, undefined);
      }
      const { assigneeId, equipmentId } = await this.stillValid(
        tx,
        ctx,
        before,
      );
      const updated = await tx.task.update({
        where: { id },
        data: {
          status: statusAfter('reopen') as TaskStatusValue,
          completedDate: null,
          completedById: null,
          startedAt: null,
          assigneeId,
          equipmentId,
        },
        include: taskInclude,
        relationLoadStrategy: 'join',
      });
      await this.log(tx, ctx, 'UPDATE', before, updated);
      return toTaskItem(updated, today(), ctx.user.id);
    });
  }

  /* ------------------------------------------------------ proof photo */

  /**
   * Stores the photo (JPEG, PNG or WebP of at most 5 Mo, by its bytes) under
   * the farm's folder with a generated name, then points the task at it; the
   * previous file goes after the commit, the new one if the commit fails.
   */
  async setProof(
    ctx: RequestContext,
    id: string,
    file: UploadedBlob | undefined,
  ): Promise<TaskItem> {
    const kind =
      file && file.size > 0 && file.size <= PROOF_MAX_BYTES
        ? detectImage(file.buffer)
        : null;
    if (!file || !kind) throw new BadRequestException(PROOF_INVALID);
    const stored = await saveUpload(
      `tasks/${ctx.farmId as string}`,
      file.buffer,
      kind.ext,
    );
    let done: { item: TaskItem; previous: string | null };
    try {
      done = await this.advance(ctx, id, 'proof', async (tx, before) => {
        const updated = await tx.task.update({
          where: { id },
          data: { proofPath: stored, proofMime: kind.mime },
          include: taskInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'UPDATE', before, updated);
        return {
          item: toTaskItem(updated, today(), ctx.user.id),
          previous: before.proofPath,
        };
      });
    } catch (error) {
      // Only a failed write deletes the NEW file.
      await removeUpload(stored);
      throw error;
    }
    // The old file goes after the commit, best effort: its failure never touches the new one.
    await removeUpload(done.previous);
    return done.item;
  }

  async clearProof(ctx: RequestContext, id: string): Promise<TaskItem> {
    const { item, previous } = await this.advance(
      ctx,
      id,
      'proof',
      async (tx, before) => {
        if (!before.proofPath) throw new NotFoundException(NO_PROOF);
        const updated = await tx.task.update({
          where: { id },
          data: { proofPath: null, proofMime: null },
          include: taskInclude,
          relationLoadStrategy: 'join',
        });
        await this.log(tx, ctx, 'UPDATE', before, updated);
        return {
          item: toTaskItem(updated, today(), ctx.user.id),
          previous: before.proofPath,
        };
      },
    );
    await removeUpload(previous);
    return item;
  }
}
