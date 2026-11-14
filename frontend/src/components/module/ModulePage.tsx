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
import { DataTable, type SortState, type TableAction } from './DataTable';
import { errorMessage } from './errorMessage';
import { ExportMenu } from './ExportMenu';
import { PageHeader } from './PageHeader';
import { RecordDialog } from './RecordDialog';
import { StatTiles, type StatTile } from './StatTiles';
import type { FilterDef, ListResponse, ModuleConfig } from './types';
import { useEndpointOptions } from './useEndpointOptions';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type Notice = { tone: 'success' | 'error'; message: string };

function FilterSelect({ def, value, onChange }: { def: FilterDef; value: string; onChange: (v: string) => void }) {
  const options = useEndpointOptions(def.options);
  return (
    <Select className="h-9! pr-2!" aria-label={def.allLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{def.allLabel}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

export interface ModulePageProps<T extends { id: string }> {
  config: ModuleConfig<T>;
}

/** The standard module screen: header, stat tiles, filterable / sortable table with add, edit, delete and export. */
export function ModulePage<T extends { id: string }>({ config }: ModulePageProps<T>) {
  return <ModuleView config={config} embedded={false} />;
}

function ModuleView<T extends { id: string }>({ config, embedded }: { config: ModuleConfig<T>; embedded: boolean }) {
  const { can, farmId, reload } = useAuth();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('main');
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const onMain = tab === 'main';

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

  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const filters: FilterDef[] = [
    ...(config.statuses
      ? [{
          param: 'status',
          allLabel: 'Tous les statuts',
          options: config.statuses.map(({ value, label }) => ({ value, label })),
        }]
      : []),
    ...(config.filters ?? []),
  ];

  const params: Record<string, string | undefined> = {
    search: search || undefined,
    ...Object.fromEntries(filters.map((f) => [f.param, filterValues[f.param] || undefined])),
    sort: sort ? `${sort.key}:${sort.dir}` : undefined,
  };
  const listParams = { ...params, page, pageSize: PAGE_SIZE };

  const list = useFarmQuery<ListResponse<T>>(
    [config.endpoint, 'list', listParams],
    () => api.get<ListResponse<T>>(config.endpoint, listParams),
    {
      enabled: onMain,
      // Keep the last page while the next loads, but never across a farm switch.
      placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === farmId ? prev : undefined),
    },
  );

  const counts = list.data?.[config.statusCountsKey ?? 'statusCounts'] as Record<string, number> | undefined;
  const showTiles = !embedded && onMain;
  // Without per-status totals the list total follows the filters, so count the unfiltered set apart.
  const unfiltered = useFarmQuery<number>(
    [config.endpoint, 'count'],
    async () => (await api.get<ListResponse<T>>(config.endpoint, { page: 1, pageSize: 1 })).total,
    { enabled: showTiles && list.data !== undefined && !counts },
  );

  const scoped = config.farmScoped !== false;
  const writable = !scoped || farmId !== 'all';
  const canCreate = can(config.slug, 'create') && writable;
  const canUpdate = can(config.slug, 'update') && writable;
  const canDelete = can(config.slug, 'delete') && writable;
  const readOnlyBecauseAllFarms =
    !writable && (can(config.slug, 'create') || can(config.slug, 'update') || can(config.slug, 'delete'));

  const afterWrite = () => {
    void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
    // Farms and users feed `/auth/me` (farm switcher, farm list).
    if (!scoped) void reload().catch(() => undefined);
  };

  const tableActions: TableAction<T>[] = (config.actions ?? [])
    .filter((a) => {
      const permission = a.permission ?? 'update';
      return can(config.slug, permission) && (permission === 'read' || writable);
    })
    .map((a) => ({
      key: a.key,
      label: a.label,
      icon: a.icon,
      visible: a.visible,
      run: (row) => {
        void (async () => {
          try {
            await a.run(row, { refresh: afterWrite, notify: (message) => setNotice({ tone: 'success', message }) });
          } catch (e) {
            setNotice({ tone: 'error', message: errorMessage(e) });
          }
        })();
      },
    }));

  const onSort = (key: string) => {
    setPage(1);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The last row of the last page was deleted: go back to the new last page.
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && page > pages) setPage(pages);
  }, [list.data, list.isPlaceholderData, page, pages]);

  const fmt = (n: number | undefined) => (n === undefined ? '…' : formatNumber(n));
  const tiles: StatTile[] = [
    {
      label: 'Total enregistrements',
      value: fmt(counts ? Object.values(counts).reduce((a, b) => a + b, 0) : unfiltered.data),
    },
    ...(counts && config.statuses
      ? config.statuses.slice(0, 3).map((s) => ({ label: s.label, value: fmt(counts[s.value] ?? 0) }))
      : []),
  ];

  const actions: ReactNode = (
    <>
      {readOnlyBecauseAllFarms && (
        <p className="text-xs text-muted-foreground">Sélectionnez une ferme pour modifier les données.</p>
      )}
      <ExportMenu
        endpoint={config.endpoint}
        filename={config.slug}
        params={params}
        onError={(message) => setNotice({ tone: 'error', message })}
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
      {notice && <Alert tone={notice.tone} className="mb-4">{notice.message}</Alert>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <SearchInput
            className="min-w-48 flex-1 [&>input]:h-9 [&>input]:shadow-sm"
            aria-label="Rechercher"
            placeholder="Rechercher…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {filters.map((f) => (
            <FilterSelect
              key={f.param}
              def={f}
              value={filterValues[f.param] ?? ''}
              onChange={(v) => { setFilterValues((s) => ({ ...s, [f.param]: v })); setPage(1); }}
            />
          ))}
        </div>

        {list.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <Alert className="flex-1">{errorMessage(list.error)}</Alert>
            <Button variant="outline" onClick={() => list.refetch()}>Réessayer</Button>
          </div>
        ) : (
          <div
            aria-busy={list.isFetching}
            className={`border-t border-border transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}
          >
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
              actions={tableActions}
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
          onSaved={() => { setEditing(null); afterWrite(); }}
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
            afterWrite();
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

  const extraTabs = (config.tabs ?? []).filter((t) => can(t.config.slug, 'read'));
  const activeTab = extraTabs.find((t) => t.key === tab);
  return (
    <>
      <PageHeader group={config.group} title={config.title} subtitle={config.subtitle} actions={onMain ? actions : undefined} />
      {extraTabs.length > 0 && (
        <div role="tablist" className="mb-6 inline-flex gap-1 rounded-full bg-muted p-1">
          {[{ key: 'main', label: config.title }, ...extraTabs].map((t) => (
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
        <ModuleView key={activeTab.key} config={activeTab.config} embedded />
      ) : (
        <>
          <StatTiles tiles={tiles} />
          {body}
        </>
      )}
    </>
  );
}
