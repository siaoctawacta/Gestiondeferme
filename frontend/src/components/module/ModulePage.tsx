import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SearchInput } from '../ui/Input';
import { Select } from '../ui/Select';
import { ConfirmDialog } from './ConfirmDialog';
import { DataTable, type SortState } from './DataTable';
import { errorMessage } from './errorMessage';
import { ExportMenu } from './ExportMenu';
import { PageHeader } from './PageHeader';
import { RecordDialog } from './RecordDialog';
import { StatTiles, type StatTile } from './StatTiles';
import type { ListResponse, ModuleConfig } from './types';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export interface ModulePageProps<T extends { id: string }> {
  config: ModuleConfig<T>;
  /** Inside a tab of another page: no header and no tiles, actions above the card. */
  embedded?: boolean;
}

function tiles<T extends { id: string }>(config: ModuleConfig<T>, data: ListResponse<T> | undefined): StatTile[] {
  const counts = data?.[config.statusCountsKey ?? 'statusCounts'] as Record<string, number> | undefined;
  const mode = config.statTiles ?? (config.statuses ? 'statuses' : 'totalOnly');
  const fmt = (n: number | undefined) => (n === undefined ? '…' : formatNumber(n));
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : data?.total;
  const out: StatTile[] = [{ label: 'Total enregistrements', value: fmt(total) }];
  if (mode === 'statuses' && counts) {
    for (const s of (config.statuses ?? []).slice(0, 3)) out.push({ label: s.label, value: fmt(counts[s.value] ?? 0) });
  }
  return out;
}

export function ModulePage<T extends { id: string }>({ config, embedded = false }: ModulePageProps<T>) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('main');
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      setSearch((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filterParam = config.filter?.param;
  const params = {
    search: search || undefined,
    status: status || undefined,
    ...(filterParam ? { [filterParam]: filterValue || undefined } : {}),
    sort: sort ? `${sort.key}:${sort.dir}` : undefined,
  };
  const listParams = { ...params, page, pageSize: PAGE_SIZE };

  const list = useFarmQuery<ListResponse<T>>(
    [config.endpoint, 'list', listParams],
    () => api.get<ListResponse<T>>(config.endpoint, listParams),
  );
  const filterOptions = useFarmQuery<{ value: string; label: string }[]>(
    [config.filter?.endpoint ?? '', 'options'],
    async () => {
      const f = config.filter!;
      const res = await api.get<ListResponse<Record<string, unknown>>>(f.endpoint, { pageSize: 200 });
      return res.items.map((r) => ({ value: String(r[f.valueKey ?? 'id']), label: String(r[f.labelKey ?? 'name']) }));
    },
    { enabled: Boolean(config.filter) },
  );

  const scoped = config.farmScoped !== false;
  const writable = !scoped || farmId !== 'all';
  const canCreate = can(config.slug, 'create') && writable;
  const canUpdate = can(config.slug, 'update') && writable;
  const canDelete = can(config.slug, 'delete') && writable;
  const readOnlyBecauseAllFarms =
    !writable && (can(config.slug, 'create') || can(config.slug, 'update') || can(config.slug, 'delete'));

  const onSort = (key: string) => {
    setPage(1);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const afterWrite = () => queryClient.invalidateQueries({ queryKey: farmKey(farmId) });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const actions: ReactNode = (
    <>
      {readOnlyBecauseAllFarms && (
        <p className="text-xs text-muted-foreground">Sélectionnez une ferme pour modifier les données.</p>
      )}
      <ExportMenu
        endpoint={config.endpoint}
        filename={config.slug}
        params={params}
        onError={setExportError}
      />
      {canCreate && (
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          Ajouter
        </Button>
      )}
    </>
  );

  const body = (
    <>
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
          {config.filter && (
            <Select
              className="h-9! pr-2!"
              aria-label={config.filter.label}
              value={filterValue}
              onChange={(e) => { setFilterValue(e.target.value); setPage(1); }}
            >
              <option value="">{config.filter.label}</option>
              {(filterOptions.data ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {config.statuses && (
            <Select
              className="h-9! pr-2!"
              aria-label="Filtrer par statut"
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            >
              <option value="">Tous les statuts</option>
              {config.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          )}
        </div>

        {list.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <Alert className="flex-1">{errorMessage(list.error)}</Alert>
            <Button variant="outline" onClick={() => list.refetch()}>Réessayer</Button>
          </div>
        ) : (
          <div className="border-t border-border">
            <DataTable
              columns={config.columns}
              rows={list.data?.items ?? []}
              loading={list.isPending}
              statuses={config.statuses}
              statusKey={config.statusKey}
              sort={sort}
              onSort={onSort}
              detailPath={config.detailPath}
              qr={config.qr}
              extraActions={canUpdate ? config.rowActions : undefined}
              onEdit={canUpdate ? setEditing : undefined}
              onDelete={canDelete ? setDeleting : undefined}
            />
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border p-4 text-sm">
            <span className="text-muted-foreground">Page {page} sur {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          </div>
        )}
      </Card>

      {editing && (
        <RecordDialog
          config={config}
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void afterWrite(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Confirmer la suppression"
          message={`Supprimer « ${(config.rowLabel ?? ((r: T) => String((r as Record<string, unknown>).name ?? r.id)))(deleting)} » ? Cette action est irréversible.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.del(`${config.endpoint}/${deleting.id}`);
            setDeleting(null);
            void afterWrite();
          }}
        />
      )}
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">{actions}</div>
        {body}
      </>
    );
  }

  const extraTabs = config.tabs ?? [];
  const activeTab = extraTabs.find((t) => t.key === tab);
  return (
    <>
      <PageHeader group={config.group} title={config.title} subtitle={config.subtitle} actions={tab === 'main' ? actions : undefined} />
      {extraTabs.length > 0 && (
        <div role="tablist" className="mb-6 inline-flex gap-1 rounded-full bg-muted p-1">
          {[{ key: 'main', label: config.tabLabel ?? config.title }, ...extraTabs].map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {activeTab ? (
        activeTab.element
      ) : (
        <>
          <StatTiles tiles={tiles(config, list.data)} />
          {body}
        </>
      )}
    </>
  );
}
