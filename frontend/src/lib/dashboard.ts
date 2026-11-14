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
  profitability: {
    revenue: number;
    expenses: number;
    margin: number;
    marginPct: number | null;
    receivables: number;
  };
  activeBuildings: number;
  feedDistributedKg: number;
  waterConsumedL: number;
  revenueVsExpenses: { activity: 'Avicole' | 'Porcin' | 'Général'; revenue: number; expenses: number }[];
  alerts: {
    total: number;
    items: { key: string; title: string; detail: string; level: 'A_VOIR' | 'URGENT'; module: string }[];
  };
  upcomingTasks: { id: string; title: string; assignee: string; dueDate: string; priority: Priority }[];
}

/** A rate, or `—` when it cannot be computed yet. */
export const rateOrDash = (rate: number | null): string => (rate === null ? '—' : `${rate}%`);
