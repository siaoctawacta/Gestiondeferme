import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  BatchHistoryRegistry,
  type BatchHistorySource,
} from '../herd/batch-history';
import { WithdrawalRegistry, type WithdrawalSource } from '../herd/withdrawal';
import { PrismaService } from '../prisma/prisma.service';
import { withdrawalEnd } from './health-act-view';

/**
 * What the health records tell `herd` about a lot or an animal: how long it is
 * under withdrawal, and the earliest health record of a lot (which pins its
 * entry date).
 */
@Injectable()
export class HealthHistory
  implements WithdrawalSource, BatchHistorySource, OnModuleInit
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawals: WithdrawalRegistry,
    private readonly history: BatchHistoryRegistry,
  ) {}

  onModuleInit(): void {
    this.withdrawals.register(this);
    this.history.register(this);
  }

  /**
   * The latest end among the done acts (not cancelled) that state a
   * withdrawal: done date + treatment days + withdrawal days. Read inside the
   * caller's transaction when it gives one (a sale sees the act it just made).
   */
  async withdrawalUntil(
    target: { batchId: string } | { animalId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Date | null> {
    const acts = await (tx ?? this.prisma).healthAct.findMany({
      where: {
        ...target,
        status: 'REALISE',
        withdrawalDays: { not: null },
      },
      select: {
        status: true,
        doneDate: true,
        durationDays: true,
        withdrawalDays: true,
      },
    });
    let latest: Date | null = null;
    for (const act of acts) {
      const end = withdrawalEnd(act);
      if (end && (!latest || end > latest)) latest = end;
    }
    return latest;
  }

  /** `withdrawalUntil` of many lots and animals: one query. */
  async withdrawalUntilMany(
    ids: { batchIds?: string[]; animalIds?: string[] },
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    const targets = [
      ...(ids.batchIds?.length ? [{ batchId: { in: ids.batchIds } }] : []),
      ...(ids.animalIds?.length ? [{ animalId: { in: ids.animalIds } }] : []),
    ];
    if (targets.length === 0) return result;
    const acts = await (tx ?? this.prisma).healthAct.findMany({
      where: {
        OR: targets,
        status: 'REALISE',
        withdrawalDays: { not: null },
      },
      select: {
        batchId: true,
        animalId: true,
        status: true,
        doneDate: true,
        durationDays: true,
        withdrawalDays: true,
      },
    });
    for (const act of acts) {
      const id = act.batchId ?? act.animalId;
      const end = withdrawalEnd(act);
      if (!id || !end) continue;
      const known = result.get(id);
      if (!known || end > known) result.set(id, end);
    }
    return result;
  }

  /**
   * Earliest health record of the lot: the day of a live act (the earlier of
   * its date and the day it was done; cancelled acts do not count), a
   * quarantine or an incident.
   */
  async earliestDate(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<Date | null> {
    const live = { batchId, status: { not: 'ANNULE' as const } };
    const act = await tx.healthAct.findFirst({
      where: live,
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const done = await tx.healthAct.findFirst({
      where: { ...live, doneDate: { not: null } },
      orderBy: { doneDate: 'asc' },
      select: { doneDate: true },
    });
    const quarantine = await tx.quarantine.findFirst({
      where: { batchId },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });
    const incident = await tx.healthIncident.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const dates = [
      act?.date,
      done?.doneDate,
      quarantine?.startDate,
      incident?.date,
    ].filter((d) => d !== undefined && d !== null);
    return dates.length ? new Date(Math.min(...dates.map((d) => +d))) : null;
  }
}
