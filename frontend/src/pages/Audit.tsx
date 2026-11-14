import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFarmQuery } from '../lib/query';
import { errorMessage } from '../components/module/errorMessage';
import { ExportMenu } from '../components/module/ExportMenu';
import { NAV } from '../components/shell/nav';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SearchInput } from '../components/ui/Input';
import { Pill, type PillTone } from '../components/ui/Pill';
import { Select } from '../components/ui/Select';
import { Alert } from '../components/ui/Alert';
import { Table, TD, TH, THead, TR } from '../components/ui/Table';
import { ErrorRetry, PageTitle } from './PageParts';

interface AuditEntry {
  id: string;
  createdAt: string;
  userName: string;
  action: string;
  module: string;
  label: string;
  recordId: string | null;
}

interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const ACTIONS: Record<string, { label: string; tone: PillTone }> = {
  CREATE: { label: 'Création', tone: 'success' },
  UPDATE: { label: 'Modification', tone: 'warning' },
  DELETE: { label: 'Suppression', tone: 'danger' },
  LOGIN: { label: 'Connexion', tone: 'neutral' },
  LOGOUT: { label: 'Déconnexion', tone: 'neutral' },
  OTHER: { label: 'Autre', tone: 'neutral' },
};

const MODULES = NAV.flatMap((g) => g.items).map((i) => ({ value: i.slug as string, label: i.label }));
const MODULE_LABEL = new Map(MODULES.map((m) => [m.value, m.label]));
MODULE_LABEL.set('auth', 'Authentification');
const FILTER_MODULES = [...MODULES, { value: 'auth', label: 'Authentification' }];

const pad = (n: number) => String(n).padStart(2, '0');
/** `dd/mm/yyyy hh:mm` in the viewer's time zone. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;

export default function Audit() {
  const { farmId } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('');
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) {
        setSearch(next);
        setPage(1);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  const filters = { search: search || undefined, module: module || undefined };
  const params = { ...filters, page };
  const list = useFarmQuery<AuditPage>(['audit', params], () => api.get<AuditPage>('/audit', params), {
    // Keep the previous page while paging, but never rows of another farm.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === farmId ? prev : undefined),
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageTitle
        title="Journal d'audit"
        subtitle="Utilisateur, date, heure, action et module."
        actions={<ExportMenu endpoint="/audit" filename="journal-audit" params={filters} onError={setExportError} />}
      />
      {exportError && <Alert className="mb-4">{exportError}</Alert>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SearchInput
            className="min-w-48 flex-1 [&>input]:h-9"
            aria-label="Rechercher"
            placeholder="Rechercher…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            className="h-9! pr-2!"
            aria-label="Filtrer par module"
            value={module}
            onChange={(e) => { setModule(e.target.value); setPage(1); }}
          >
            <option value="">Tous les modules</option>
            {FILTER_MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </div>
        {list.isError ? (
          <div className="border-t border-border p-4">
            <ErrorRetry message={errorMessage(list.error)} onRetry={() => list.refetch()} />
          </div>
        ) : (
          <div className="border-t border-border">
            <Table>
              <THead>
                <TR>
                  {['Date', 'Utilisateur', 'Action', 'Module', 'Élément'].map((h) => <TH key={h}>{h}</TH>)}
                </TR>
              </THead>
              <tbody>
                {!data &&
                  Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    <TR key={i}>
                      <TD colSpan={5}><div className="h-5 animate-pulse rounded-full bg-muted" /></TD>
                    </TR>
                  ))}
                {data && data.items.length === 0 && (
                  <TR>
                    <TD colSpan={5} className="py-10 text-center text-muted-foreground">
                      Aucune action enregistrée pour le moment.
                    </TD>
                  </TR>
                )}
                {data?.items.map((e) => {
                  const action = ACTIONS[e.action] ?? ACTIONS.OTHER;
                  return (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap">{formatStamp(e.createdAt)}</TD>
                      <TD>{e.userName}</TD>
                      <TD><Pill tone={action.tone}>{action.label}</Pill></TD>
                      <TD>{MODULE_LABEL.get(e.module) ?? e.module}</TD>
                      <TD>{e.label}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-border p-4 text-sm">
            <span className="text-muted-foreground">Page {page} sur {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
