import { AlertTriangle, CircleAlert } from 'lucide-react';
import { NAV } from '../components/shell/nav';
import { errorMessage } from '../components/module/errorMessage';
import { Card } from '../components/ui/Card';
import { useAlerts } from '../lib/alerts';
import { EmptyData, ErrorRetry, PageTitle, Skeleton } from './PageParts';

const MODULE_LABEL = new Map(NAV.flatMap((g) => g.items).map((i) => [i.slug as string, i.label]));

export default function Alerts() {
  const query = useAlerts();
  const data = query.data;

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageTitle
        title="Alertes & notifications"
        subtitle={data ? `${data.total} ${data.total > 1 ? 'alertes ouvertes' : 'alerte ouverte'}, calculées automatiquement à partir de vos données.` : undefined}
      />
      {query.isError ? (
        <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !data ? (
        <div aria-busy="true" aria-label="Chargement" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : data.items.length === 0 ? (
        <Card><EmptyData>Aucune alerte pour le moment.</EmptyData></Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.items.map((a) => {
            const urgent = a.level === 'URGENT';
            const Icon = urgent ? CircleAlert : AlertTriangle;
            return (
              <li key={a.key}>
                <Card className="flex items-start gap-4 px-4 pb-3 pt-4">
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                      urgent ? 'bg-destructive/15 text-destructive' : 'bg-warning/35 text-warning-foreground'
                    }`}
                  >
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold leading-6">{a.title}</p>
                    <p className="text-sm leading-5 text-muted-foreground">{a.detail}</p>
                    <p className="text-xs leading-6 text-primary">{MODULE_LABEL.get(a.module) ?? a.module}</p>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
