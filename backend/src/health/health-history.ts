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
   * withdrawal: done date + treatment days + withdrawal days.
   */
  async withdrawalUntil(
    target: { batchId: string } | { animalId: string },
  ): Promise<Date | null> {
    const acts = await this.prisma.healthAct.findMany({
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

  /** Earliest act, quarantine or incident of the lot. */
  async earliestDate(
    tx: Prisma.TransactionClient,
    batchId: string,
  ): Promise<Date | null> {
    const act = await tx.healthAct.findFirst({
      where: { batchId },
      orderBy: { date: 'asc' },
      select: { date: true },
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
    const dates = [act?.date, quarantine?.startDate, incident?.date].filter(
      (d) => d !== undefined,
    );
    return dates.length ? new Date(Math.min(...dates.map((d) => +d))) : null;
  }
}
