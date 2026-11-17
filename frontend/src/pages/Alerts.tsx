import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, CircleAlert, EyeOff } from 'lucide-react';
import { MODULE_LABEL } from '../components/shell/nav';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { PageHeader } from '../components/module/PageHeader';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { acknowledgeAlert, unacknowledgeAlert, useAlerts } from '../lib/alerts';
import { useAuth } from '../lib/auth';
import { farmKey } from '../lib/query';
import { EmptyData, Skeleton } from './PageParts';

export default function Alerts() {
  const [params] = useSearchParams();
  const include = params.get('acknowledged') === 'include';
  const query = useAlerts({ includeAcknowledged: include });
  const data = query.data;
  const queryClient = useQueryClient();
  const { farmId } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const maskedCount = data?.acknowledgedCount ?? 0;
  const root = useRef<HTMLDivElement>(null);
  // Where the focus goes once the list is read again: the clicked card is gone or changed, so its button no longer exists.
  const refocus = useRef<{ key: string | null } | null>(null);

  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const button = target.key === null ? null : Array.from(root.current?.querySelectorAll<HTMLElement>('li[data-alert-key]') ?? []).find((li) => li.dataset.alertKey === target.key)?.querySelector('button');
    if (button) {
      button.focus();
      return;
    }
    const heading = root.current?.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }, [data]);

  // What is visible is the API's call (expiry, a worsened level): after a change everything of the farm is read again, the
  // bell, the sidebar count and the dashboard included. No hiding state lives in the browser.
  const change = async (key: string, run: (key: string) => Promise<unknown>) => {
    setPending(key);
    setFailure(null);
    const items = data?.items ?? [];
    refocus.current = { key: items[items.findIndex((a) => a.key === key) + 1]?.key ?? null };
    try {
      await run(key);
      await queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
    } catch (e) {
      refocus.current = null;
      setFailure(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div ref={root} className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Alertes & notifications"
        subtitle={data ? `${data.total} ${data.total > 1 ? 'alertes ouvertes' : 'alerte ouverte'}, calculées automatiquement à partir de vos données.` : undefined}
      />
      {data && maskedCount > 0 && (
        <p className="-mt-3 mb-4 text-sm">
          <Link to={include ? { search: '' } : { search: '?acknowledged=include' }} className="text-primary hover:underline">
            {include ? 'Ne plus afficher les alertes masquées' : `Afficher les alertes masquées (${maskedCount})`}
          </Link>
        </p>
      )}
      {failure && <Alert className="mb-4">{failure}</Alert>}
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
            const masked = a.acknowledged === true;
            return (
              <li key={a.key} data-alert-key={a.key} className={masked ? 'opacity-60' : undefined}>
                <Card className="flex items-start gap-4 px-4 pb-3 pt-4">
                  <span
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                      urgent ? 'bg-destructive/15 text-destructive' : 'bg-warning/35 text-warning-foreground'
                    }`}
                  >
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-6">{a.title}</p>
                    <p className="text-sm leading-5 text-muted-foreground">{a.detail}</p>
                    <p className="text-xs leading-6 text-primary">{MODULE_LABEL.get(a.module) ?? a.module}</p>
                  </div>
                  {masked ? (
                    <Button variant="ghost" size="sm" aria-label={`Réafficher l'alerte : ${a.title}`} disabled={pending === a.key} onClick={() => void change(a.key, unacknowledgeAlert)}>
                      Réafficher
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Masquer l'alerte : ${a.title}`}
                      title="Masquer l'alerte"
                      className="-mr-2 -mt-1 size-8 shrink-0 px-0 text-muted-foreground"
                      disabled={pending === a.key}
                      onClick={() => void change(a.key, acknowledgeAlert)}
                    >
                      <EyeOff aria-hidden className="size-4" />
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
