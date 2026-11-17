import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bird, Egg, PiggyBank, Plus, Skull } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatNumber } from '../lib/format';
import { rateOrDash, type DashboardDto } from '../lib/dashboard';
import { farmKey, useFarmQuery } from '../lib/query';
import { MODULES } from '../modules/registry';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { lazyRetry } from '../components/lazyRetry';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { PageHeader } from '../components/module/PageHeader';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { AlertsCard } from './dashboard/AlertsCard';
import { FarmTile } from './dashboard/FarmTile';
import { KpiCard } from './dashboard/KpiCard';
import { ProfitCard } from './dashboard/ProfitCard';
import { TasksCard } from './dashboard/TasksCard';
import { Skeleton } from './PageParts';

// The chart components pull in Recharts: load them on demand so the login page and the
// other screens do not download the chart library.
const EggChart = lazyRetry(() => import('./dashboard/EggChart').then((m) => ({ default: m.EggChart })));
const RevenueBars = lazyRetry(() => import('./dashboard/RevenueBars').then((m) => ({ default: m.RevenueBars })));

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement" className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-[340px] lg:col-span-2" />
        <Skeleton className="h-[340px]" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[412px]" />)}
      </div>
      <Skeleton className="h-52" />
    </div>
  );
}

export default function Dashboard() {
  const query = useFarmQuery<DashboardDto>(['dashboard'], () => api.get<DashboardDto>('/dashboard'));
  const d = query.data;
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [newTask, setNewTask] = useState(false);
  // The generated dialog of the tasks module; a task is a farm record, so not under "all farms".
  const TaskForm = MODULES.taches?.form;
  const canCreateTask = TaskForm !== undefined && can('taches', 'create') && farmId !== 'all';
  // The header (which also sets the title) only renders once the data is in.
  useDocumentTitle('Tableau de bord');

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      {query.isError ? (
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !d ? (
        <DashboardSkeleton />
      ) : (
        <>
          <PageHeader
            large
            group={`Bonjour 👋 — ${d.farmName}`}
            title="Tableau de bord"
            actions={
              <>
                <div className="flex h-[38px] overflow-hidden rounded-full border border-border bg-card text-sm font-medium shadow-card">
                  <span className="flex items-center gap-2 bg-primary px-4 text-primary-foreground">
                    Tâches terminées <b>{d.tasks.done}</b>
                  </span>
                  <span className="flex items-center gap-2 px-4">
                    En attente <b>{d.tasks.pending}</b>
                  </span>
                </div>
                {canCreateTask && (
                  <button
                    type="button"
                    onClick={() => setNewTask(true)}
                    className="inline-flex h-[38px] items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-ink-foreground transition-colors hover:bg-ink-soft"
                  >
                    <Plus aria-hidden className="size-4" />
                    Nouvelle tâche
                  </button>
                )}
              </>
            }
          />

          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard dark label="Volailles vivantes" icon={Bird} value={formatNumber(d.kpis.poultryAlive)} sub={`${d.kpis.activePoultryBatches} lots en cours`} />
              <KpiCard label="Porcs" icon={PiggyBank} value={formatNumber(d.kpis.pigs)} sub="Cheptel actif" />
              <KpiCard label="Œufs (dernier jour)" icon={Egg} value={formatNumber(d.kpis.eggsLastDay)} sub={`Taux de ponte ${rateOrDash(d.kpis.layingRate)}`} />
              <KpiCard label="Mortalité lots" icon={Skull} value={rateOrDash(d.kpis.mortalityRate)} sub="Lots avicoles en cours" />
            </div>

            {/* Without the profitability card (no finance access) the egg chart takes its place: no hole. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div data-testid="egg-chart-cell" className={d.profitability ? 'lg:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
                <ErrorBoundary>
                  <Suspense fallback={<Skeleton className="h-[340px]" />}>
                    <EggChart series={d.eggSeries} />
                  </Suspense>
                </ErrorBoundary>
              </div>
              {d.profitability && <ProfitCard profit={d.profitability} />}
            </div>

            {/* Without the revenue chart the two remaining cards share the row. */}
            <div
              data-testid="farm-alerts-row"
              className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${d.revenueVsExpenses ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}
            >
              <FarmTile activeBuildings={d.activeBuildings} feedDistributedKg={d.feedDistributedKg} waterConsumedL={d.waterConsumedL} />
              {d.revenueVsExpenses && (
                <ErrorBoundary>
                  <Suspense fallback={<Skeleton className="h-full min-h-[300px]" />}>
                    <RevenueBars rows={d.revenueVsExpenses} />
                  </Suspense>
                </ErrorBoundary>
              )}
              <AlertsCard alerts={d.alerts} />
            </div>

            <TasksCard tasks={d.upcomingTasks} />
          </div>
          {newTask && TaskForm && (
            <TaskForm
              onClose={() => setNewTask(false)}
              onSaved={() => {
                setNewTask(false);
                void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
