import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../access/decorators';
import { AlertsRegistry } from '../indicators/alerts/alerts-registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  receivableAlertRules,
  type OpenReceivable,
  type ReceivableAlertData,
} from './receivable-alerts';
import { receivablesOf } from './receivables';
import { OPEN_STATUSES } from './sale-workflow';

/**
 * Reads the overdue receivables for the `Créance` alert rule and registers it
 * (after the rules of the indicators module, which this module imports): the
 * one `receivablesOf` read, three queries whatever the number of invoices,
 * over the farms of the request.
 */
@Injectable()
export class ReceivableAlertsService
  implements ReceivableAlertData, OnModuleInit
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AlertsRegistry,
  ) {}

  /** The clock the rule reads; a test replaces it. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    for (const rule of receivableAlertRules(this, () => this.now()))
      this.registry.register(rule);
  }

  async overdue(ctx: RequestContext, day: Date): Promise<OpenReceivable[]> {
    const rows = await receivablesOf(this.prisma, ctx.farmIds, {
      dueBefore: day,
      statuses: OPEN_STATUSES,
    });
    const several = ctx.farmIds.length > 1;
    return rows.map((r) => ({
      invoiceId: r.invoiceId,
      number: r.number,
      customerName: r.customerName,
      status: r.status,
      due: r.due,
      dueDate: r.dueDate,
      ...(several ? { farmName: r.farmName } : {}),
    }));
  }
}
