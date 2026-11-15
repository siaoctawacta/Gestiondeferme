import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, SearchInput } from '../ui/Input';
import { Select } from '../ui/Select';
import { ConfirmDialog } from './ConfirmDialog';
import { DataTable, type TableAction } from './DataTable';
import { ErrorRetry } from './ErrorRetry';
import { errorMessage } from './errorMessage';
import { ExportMenu } from './ExportMenu';
import { PageHeader } from './PageHeader';
import { Pagination, pageCount } from './Pagination';
import { RecordDialog } from './RecordDialog';
import { canRunAction } from './rowActions';
import { StatTiles, type StatTile } from './StatTiles';
import { TabBar, panelId, tabId } from './TabBar';
import type { FilterDef, ListResponse, ModuleConfig, RowAction } from './types';
import { useEndpointOptions } from './useEndpointOptions';
import { useListState } from './useListState';

const PAGE_SIZE = 25;

type Notice = { tone: 'success' | 'error'; message: string };

function FilterDate({ def, value, onChange }: { def: FilterDef; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {def.allLabel}
      <Input type="date" className="h-9! w-auto! px-3!" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function FilterSelect({ def, value, onChange }: { def: FilterDef; value: string; onChange: (v: string) => void }) {
  const options = useEndpointOptions(def.options ?? []);
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
  return <ModuleView config={config} layout="page" />;
}

export interface ModuleListProps<T extends { id: string }> {
  config: ModuleConfig<T>;
  /** Fixed query parameters (merged over `config.scope`) for the list and the create payloads; never shown as filters. */
  scope?: Record<string, string>;
  /** Hides the add, edit and delete controls and the writing row actions (e.g. the embedded lists of a closed lot). */
  readOnly?: boolean;
  /** Hides `Ajouter` only: the rows keep their icons (disabled by `canEdit` / `canDelete` when the config says so). */
  noCreate?: boolean;
}

/**
 * The list of a module without its page header, tiles and tabs, for embedding in a detail page: search, filters,
 * table, pagination, and the export / add buttons at the top right of the card.
 */
export function ModuleList<T extends { id: string }>({ config, scope, readOnly, noCreate }: ModuleListProps<T>) {
  return <ModuleView config={config} layout="list" scope={scope} readOnly={readOnly} noCreate={noCreate} />;
}

/** `page`: header, tiles and tabs; `tab`: a further tab of a page (buttons above the card); `list`: card only. */
type Layout = 'page' | 'tab' | 'list';

function ModuleView<T extends { id: string }>({
  config, layout, scope: scopeProp, readOnly = false, noCreate = false,
}: { config: ModuleConfig<T>; layout: Layout; scope?: Record<string, string>; readOnly?: boolean; noCreate?: boolean }) {
  const embedded = layout !== 'page';
  const scope = config.scope || scopeProp ? { ...config.scope, ...scopeProp } : undefined;
  const { can, farmId, reload } = useAuth();
  const queryClient = useQueryClient();
  const tabBase = useId();

  const { searchInput, setSearchInput, filters: filterValues, setFilter, sort, toggleSort, page, setPage, params, listParams } =
    useListState(PAGE_SIZE);
  const [tab, setTab] = useState('main');
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [acting, setActing] = useState<{ action: RowAction<T>; row: T } | null>(null);
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
    [config.endpoint, 'list', listParams, scope],
    () => api.get<ListResponse<T>>(config.endpoint, { ...listParams, ...scope }),
    {
      enabled: onMain,
      // Keep the last page while the next loads, but never across a farm switch.
      placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === farmId ? prev : undefined),
    },
  );

  const counts = list.data?.['statusCounts'] as Record<string, number> | undefined;
  const showTiles = !embedded && onMain;
  // Without per-status totals the list total follows the filters, so count the unfiltered set apart.
  const unfiltered = useFarmQuery<number>(
    [config.endpoint, 'count', scope],
    async () => (await api.get<ListResponse<T>>(config.endpoint, { ...scope, page: 1, pageSize: 1 })).total,
    { enabled: showTiles && list.data !== undefined && !counts },
  );

  const scoped = config.farmScoped !== false;
  const writable = !scoped || farmId !== 'all';
  const canCreate = !readOnly && !noCreate && !config.noCreate && can(config.slug, config.createPermission ?? 'create') && writable;
  const canEditRows = !readOnly && can(config.slug, config.editPermission ?? 'update') && writable;
  const closedGates = readOnly ? config.whenReadOnly : undefined;
  const canDeleteRows = (!readOnly || Boolean(closedGates?.canDelete)) && can(config.slug, config.deletePermission ?? 'delete') && writable;
  const readOnlyBecauseAllFarms =
    !writable && (can(config.slug, 'create') || can(config.slug, 'update') || can(config.slug, 'delete'));

  const afterWrite = () => {
    void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
    // Farms and users feed `/auth/me` (farm switcher, farm list).
    if (!scoped) void reload().catch(() => undefined);
  };

  const tableActions: TableAction<T>[] = (config.actions ?? [])
    .filter((a) => (!readOnly || closedGates?.actions?.[a.key]) && canRunAction(a.permission, config.slug, can, writable && !(a.needsFarm && farmId === 'all')))
    .map((a) => ({
      key: a.key,
      label: a.label,
      icon: a.icon,
      visible: (row: T) => (a.visible?.(row, { can }) ?? true) && (!readOnly || closedGates!.actions![a.key](row)),
      run: (row) => {
        if (a.dialog) {
          setActing({ action: a, row });
          return;
        }
        void (async () => {
          try {
            await a.run?.(row, { refresh: afterWrite, notify: (message) => setNotice({ tone: 'success', message }) });
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
      {config.exportable !== false && (
        <ExportMenu
          endpoint={config.endpoint}
          filename={config.slug}
          params={{ ...params, ...scope }}
          onError={(message) => setNotice({ tone: 'error', message })}
        />
      )}
      {canCreate && (
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          Ajouter
        </Button>
      )}
    </>
  );

  const detailPath = config.detailPath ?? (config.detail ? (row: T) => `/m/${config.slug}/${row.id}` : undefined);
  const EditForm = config.form;

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
          {layout === 'list' && <div className="order-last ml-auto flex flex-wrap items-center gap-2 [&_button]:h-9!">{actions}</div>}
          {filters.map((f) => {
            const Control = f.type === 'date' ? FilterDate : FilterSelect;
            return <Control key={f.param} def={f} value={filterValues[f.param] ?? ''} onChange={(v) => setFilter(f.param, v)} />;
          })}
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
              detailPath={detailPath}
              qr={config.qr}
              actions={tableActions}
              onEdit={canEditRows ? setEditing : undefined}
              onDelete={canDeleteRows ? setDeleting : undefined}
              canEdit={config.canEdit}
              canDelete={closedGates?.canDelete ? (row) => (closedGates.canDelete!(row) ? (config.canDelete?.(row) ?? true) : false) : config.canDelete}
            />
          </div>
        )}

        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </Card>

      {editing && EditForm && (
        <EditForm
          scope={scope}
          row={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterWrite(); }}
        />
      )}
      {editing && !EditForm && (
        <RecordDialog
          config={config}
          row={editing === 'new' ? undefined : editing}
          scope={scope}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterWrite(); }}
        />
      )}
      {acting?.action.dialog && (
        <acting.action.dialog
          row={acting.row}
          onClose={() => setActing(null)}
          onDone={() => { setActing(null); afterWrite(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Confirmer la suppression"
          message={`Supprimer « ${(config.rowLabel ?? ((r: T) => String((r as Record<string, unknown>).name ?? r.id)))(deleting)} » ? Cette action est irréversible.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.del(config.deletePath?.(deleting) ?? `${config.endpoint}/${deleting.id}`);
            setDeleting(null);
            afterWrite();
          }}
        />
      )}
    </>
  );

  if (layout === 'list') return body;
  if (embedded) {
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">{actions}</div>
        {body}
      </>
    );
  }

  const extraTabs = (config.tabs ?? []).filter((t) => !('config' in t) || can(t.config.slug, 'read'));
  const activeTab = extraTabs.find((t) => t.key === tab);
  const allTabs = [{ key: 'main', label: config.tabLabel ?? config.title }, ...extraTabs];
  const activeKey = activeTab ? activeTab.key : 'main';
  return (
    <>
      <PageHeader group={config.group} title={config.title} subtitle={config.subtitle} actions={onMain ? actions : undefined} />
      {extraTabs.length > 0 && <TabBar tabs={allTabs} active={activeKey} onChange={setTab} idBase={tabBase} />}
      <div
        id={panelId(tabBase, activeKey)}
        role={extraTabs.length > 0 ? 'tabpanel' : undefined}
        aria-labelledby={extraTabs.length > 0 ? tabId(tabBase, activeKey) : undefined}
      >
        {activeTab ? (
          'config' in activeTab ? <ModuleView key={activeTab.key} config={activeTab.config} layout="tab" /> : activeTab.element
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
