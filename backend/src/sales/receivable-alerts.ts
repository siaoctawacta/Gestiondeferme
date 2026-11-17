import type { Decimal } from '@prisma/client/runtime/client';
import type { RequestContext } from '../access/decorators';
import { can } from '../access/permissions';
import { formatDay, today } from '../common/days';
import { formatFcfa } from '../common/format-number';
import {
  withFarm,
  type AlertItem,
  type AlertRule,
} from '../indicators/alerts/alert.types';
import { isOverdue, type InvoiceStatusValue } from './sale-workflow';

/** An issued invoice and what is still due on it, as the alert rule reads it. */
export interface OpenReceivable {
  invoiceId: string;
  number: string;
  customerName: string;
  status: InvoiceStatusValue;
  due: Decimal;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  /** Set when the request spans several farms, to tell their alerts apart. */
  farmName?: string;
}

/** What the rule reads; the receivable alerts service implements it over the database. */
export interface ReceivableAlertData {
  /** The issued invoices whose due date is before `day` and that are still owed (`day` = today). */
  overdue(ctx: RequestContext, day: Date): Promise<OpenReceivable[]>;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `Créance FA-0309` (A_VOIR, module ventes): an invoice that is issued or
 * partly paid, still owes something and whose due date is before today (the due
 * date itself is not late: `isOverdue`, the rule of the list's `overdue` flag).
 * Ordered by due date, then number, then id.
 */
export function receivableAlerts(
  rows: OpenReceivable[],
  day: string,
): AlertItem[] {
  return rows
    .filter((r) =>
      isOverdue({ status: r.status, due: r.due, dueDate: r.dueDate }, day),
    )
    .sort(
      (a, b) =>
        compare(a.dueDate ?? '', b.dueDate ?? '') ||
        compare(a.number, b.number) ||
        compare(a.invoiceId, b.invoiceId),
    )
    .map((r): AlertItem => {
      const detail = `${r.customerName} — ${formatFcfa(r.due.toNumber())}`;
      return {
        key: `receivable:${r.invoiceId}`,
        title: `Créance ${r.number}`,
        detail: withFarm(detail, r.farmName),
        level: 'A_VOIR',
        module: 'ventes',
        modules: ['ventes'],
      };
    });
}

/** The rules of the sales module, in the order they rank: the overdue receivables (not run for a role without `ventes` read). */
export function receivableAlertRules(
  data: ReceivableAlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx) => {
      // A role that cannot read ventes would see none of them: do not read them.
      if (!can(ctx.user.role, 'ventes', 'read')) return [];
      const day = today(now());
      return receivableAlerts(await data.overdue(ctx, day), formatDay(day));
    },
  ];
}
