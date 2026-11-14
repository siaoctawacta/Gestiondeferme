import { Link } from 'react-router';
import { Bird, Egg, PiggyBank, Plus, Skull } from 'lucide-react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { rateOrDash, type DashboardDto } from '../lib/dashboard';
import { useFarmQuery } from '../lib/query';
import { errorMessage } from '../components/module/errorMessage';
import { AlertsCard } from './dashboard/AlertsCard';
import { EggChart } from './dashboard/EggChart';
import { FarmTile } from './dashboard/FarmTile';
import { KpiCard } from './dashboard/KpiCard';
import { ProfitCard } from './dashboard/ProfitCard';
import { RevenueBars } from './dashboard/RevenueBars';
import { TasksCard } from './dashboard/TasksCard';
import { ErrorRetry, Skeleton } from './PageParts';

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement" className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      {query.isError ? (
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !d ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Bonjour 👋 — {d.farmName}</p>
              <h1 className="text-4xl font-bold leading-10">Tableau de bord</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-[38px] overflow-hidden rounded-full border border-border bg-card text-sm font-medium shadow-card">
                <span className="flex items-center gap-2 bg-primary px-4 text-primary-foreground">
                  Tâches terminées <b>{d.tasks.done}</b>
                </span>
                <span className="flex items-center gap-2 px-4">
                  En attente <b>{d.tasks.pending}</b>
                </span>
              </div>
              <Link
                to="/m/taches"
                className="inline-flex h-[38px] items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-ink-foreground transition-colors hover:bg-ink-soft"
              >
                <Plus aria-hidden className="size-4" />
                Nouvelle tâche
              </Link>
            </div>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard dark label="Volailles vivantes" icon={Bird} value={formatNumber(d.kpis.poultryAlive)} sub={`${d.kpis.activePoultryBatches} lots en cours`} />
              <KpiCard label="Porcs" icon={PiggyBank} value={formatNumber(d.kpis.pigs)} sub="Cheptel actif" />
              <KpiCard label="Œufs (dernier jour)" icon={Egg} value={formatNumber(d.kpis.eggsLastDay)} sub={`Taux de ponte ${rateOrDash(d.kpis.layingRate)}`} />
              <KpiCard label="Mortalité lots" icon={Skull} value={rateOrDash(d.kpis.mortalityRate)} sub="Lots avicoles en cours" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <EggChart series={d.eggSeries} />
              <ProfitCard profit={d.profitability} />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <FarmTile activeBuildings={d.activeBuildings} feedDistributedKg={d.feedDistributedKg} waterConsumedL={d.waterConsumedL} />
              <RevenueBars rows={d.revenueVsExpenses} />
              <AlertsCard alerts={d.alerts} />
            </div>

            <TasksCard tasks={d.upcomingTasks} />
          </div>
        </>
      )}
    </div>
  );
}
