import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { DataTable, type TableAction } from './DataTable';
import { ErrorRetry } from './ErrorRetry';
import { errorMessage } from './errorMessage';
import { ExportMenu } from './ExportMenu';
import { PageHeader } from './PageHeader';
import { Pagination, pageCount } from './Pagination';
import { RecordDialog } from './RecordDialog';
import { StatTiles, type StatTile } from './StatTiles';
import type { FilterDef, ListResponse, ModuleConfig } from './types';
import { useEndpointOptions } from './useEndpointOptions';
import { useListState } from './useListState';

const PAGE_SIZE = 25;

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
  const tabBase = useId();

  const { searchInput, setSearchInput, filters: filterValues, setFilter, sort, toggleSort, page, setPage, params, listParams } =
    useListState(PAGE_SIZE);
  const [tab, setTab] = useState('main');
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const onMain = tab === 'main';

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

  const total = list.data?.total ?? 0;
  const pages = pageCount(total, PAGE_SIZE);

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
              onChange={(v) => setFilter(f.param, v)}
            />
          ))}
        </div>

        {list.isError ? (
          <div className="border-t border-border p-4">
            <ErrorRetry message={errorMessage(list.error)} onRetry={() => list.refetch()} />
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
              onSort={toggleSort}
              detailPath={config.detailPath}
              qr={config.qr}
              actions={tableActions}
              onEdit={canUpdate ? setEditing : undefined}
              onDelete={canDelete ? setDeleting : undefined}
            />
          </div>
        )}

        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
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
  const allTabs = [{ key: 'main', label: config.title }, ...extraTabs];
  const tabId = (key: string) => `${tabBase}-tab-${key}`;
  const panelId = (key: string) => `${tabBase}-panel-${key}`;
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = allTabs.findIndex((t) => t.key === tab);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (at + 1) % allTabs.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + allTabs.length) % allTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = allTabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    setTab(allTabs[next].key);
    document.getElementById(tabId(allTabs[next].key))?.focus();
  };
  return (
    <>
      <PageHeader group={config.group} title={config.title} subtitle={config.subtitle} actions={onMain ? actions : undefined} />
      {extraTabs.length > 0 && (
        <div role="tablist" onKeyDown={onTabKeyDown} className="mb-6 inline-flex gap-1 rounded-full bg-muted p-1">
          {allTabs.map((t) => (
            <button
              key={t.key}
              id={tabId(t.key)}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={panelId(t.key)}
              tabIndex={tab === t.key ? 0 : -1}
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
      <div
        id={panelId(activeTab ? activeTab.key : 'main')}
        role={extraTabs.length > 0 ? 'tabpanel' : undefined}
        aria-labelledby={extraTabs.length > 0 ? tabId(activeTab ? activeTab.key : 'main') : undefined}
      >
        {activeTab ? (
          <ModuleView key={activeTab.key} config={activeTab.config} embedded />
        ) : (
          <>
            <StatTiles tiles={tiles} />
            {body}
          </>
        )}
      </div>
    </>
  );
}
