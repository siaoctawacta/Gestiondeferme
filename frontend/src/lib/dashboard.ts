import { formatPct } from './format';

export type Priority = 'NORMALE' | 'HAUTE' | 'URGENTE';

/** Response of `GET /api/dashboard`. */
export interface DashboardDto {
  farmName: string;
  tasks: { done: number; pending: number };
  kpis: {
    poultryAlive: number;
    activePoultryBatches: number;
    pigs: number;
    eggsLastDay: number;
    layingRate: number | null;
    mortalityRate: number | null;
  };
  eggSeries: { date: string; eggs: number }[];
  /** `null` for a role without `finance:read`: the card is not rendered at all. */
  profitability: {
    revenue: number;
    expenses: number;
    margin: number;
    marginPct: number | null;
    receivables: number;
  } | null;
  activeBuildings: number;
  feedDistributedKg: number;
  waterConsumedL: number;
  /** `null` for a role without `finance:read`: the chart is not rendered at all. `margin` is the API's when it sends one. */
  revenueVsExpenses: { activity: 'Avicole' | 'Porcin' | 'Général'; revenue: number; expenses: number; margin?: number }[] | null;
  alerts: {
    total: number;
    items: { key: string; title: string; detail: string; level: 'A_VOIR' | 'URGENT'; module: string }[];
  };
  upcomingTasks: { id: string; title: string; assignee: string; dueDate: string; priority: Priority }[];
}

/** A rate, or `—` when it cannot be computed yet. */
export const rateOrDash = (rate: number | null): string => (rate === null ? '—' : formatPct(rate));
