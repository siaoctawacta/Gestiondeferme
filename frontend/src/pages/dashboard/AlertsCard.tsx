import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { useAlerts } from '../../lib/alerts';
import { EmptyData } from '../PageParts';
import type { DashboardDto } from '../../lib/dashboard';

const SHOWN = 5;

export function AlertsCard({ alerts }: { alerts: DashboardDto['alerts'] }) {
  // Same source as the sidebar pill, so the two counts can never disagree.
  const total = useAlerts().data?.total ?? alerts.total;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          Alertes ouvertes <span className="font-medium text-muted-foreground">({total})</span>
        </h2>
        <Link to="/alertes" aria-label="Voir toutes les alertes" className="text-primary">
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </div>
      {alerts.items.length === 0 ? (
        <EmptyData />
      ) : (
        <ul className="mt-3 space-y-2">
          {alerts.items.slice(0, SHOWN).map((a) => (
            <li key={a.key} className="flex items-center justify-between gap-3 rounded-2xl bg-muted px-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="truncate text-xs text-muted-foreground">{a.detail}</p>
              </div>
              <Pill tone={a.level === 'URGENT' ? 'danger' : 'warning'}>{a.level === 'URGENT' ? 'Urgent' : 'À voir'}</Pill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
