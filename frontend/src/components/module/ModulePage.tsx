import { Suspense, useContext, useEffect, useId, useState, type ReactNode } from 'react';
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
import { DateFilter } from './DateFilter';
import { SharedFiltersContext, type SharedFilterState } from './sharedFilters';
import { DataTable, type TableAction } from './DataTable';
import { ErrorRetry } from './ErrorRetry';
import { errorMessage } from './errorMessage';
import { ExportMenu } from './ExportMenu';
import { LoadingBlock } from './LoadingBlock';
import { PageHeader } from './PageHeader';
import { QrDialog } from './QrDialog';
import { QrLabelSheet, type LabelRow } from './QrLabelSheet';
import { Pagination, pageCount } from './Pagination';
import { RecordDialog } from './RecordDialog';
import { canRunAction } from './rowActions';
import { StatTiles, type StatTile } from './StatTiles';
import { TabBar, panelId, tabId } from './TabBar';
import type { QrKind } from '../../lib/qr';
import type { FilterDef, ListResponse, ModuleConfig, RowAction } from './types';
import { useEndpointOptions } from './useEndpointOptions';
import { useListState } from './useListState';

const PAGE_SIZE = 25;

type Notice = { tone: 'success' | 'error'; message: string };

function FilterSelect({ def, value, onChange }: { def: FilterDef; value: string; onChange: (v: string) => void }) {
  const options = useEndpointOptions(def.options ?? []);
  // A filter that is active stays, so it can be cleared.
  if (def.hideWhenEmpty && options.length === 0 && value === '') return null;
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
  /** The list is read-only: `true` hides every write control, a reason keeps the row icons disabled with it. The gating model is in `types.ts`. */
  readOnly?: boolean | string;
}

/**
 * The list of a module without its page header, tiles and tabs, for embedding in a detail page: search, filters,
 * table, pagination, and the export / add buttons at the top right of the card.
 */
export function ModuleList<T extends { id: string }>({ config, scope, readOnly }: ModuleListProps<T>) {
  return <ModuleView config={config} layout="list" scope={scope} readOnly={readOnly} />;
}

/** `page`: header, tiles and tabs; `tab`: a further tab of a page (buttons above the card); `list`: card only. */
type Layout = 'page' | 'tab' | 'list';

function ModuleView<T extends { id: string }>({
  config, layout, scope: scopeProp, readOnly: readOnlyProp = false,
}: { config: ModuleConfig<T>; layout: Layout; scope?: Record<string, string>; readOnly?: boolean | string }) {
  // `true`: no write control at all; a reason: the icons stay, disabled with it; `false` / empty: writable.
  const readOnly = readOnlyProp !== false && readOnlyProp !== '';
  const reason = typeof readOnlyProp === 'string' && readOnlyProp !== '' ? readOnlyProp : undefined;
  const embedded = layout !== 'page';
  const scope = config.scope || scopeProp ? { ...config.scope, ...scopeProp } : undefined;
  const { can, farmId, reload } = useAuth();
  const queryClient = useQueryClient();
  const tabBase = useId();

  // A page that declares `sharedFilters` owns them and hands them to its tabs; a tab or an embedded list reads its page's.
  const inherited = useContext(SharedFiltersContext);
  const shareDef = layout === 'page' ? config.sharedFilters : undefined;
  const { searchInput, setSearchInput, filters: filterValues, setFilter, sort, toggleSort, page, setPage, params, listParams } =
    useListState(PAGE_SIZE, shareDef?.defaults(), layout === 'page' ? null : inherited);
  const sharedValues = shareDef ? Object.fromEntries(shareDef.params.map((k) => [k, filterValues[k] ?? ''])) : undefined;
  const sharedError = shareDef?.validate?.(sharedValues!) ?? (layout === 'page' ? null : (inherited?.error ?? null));
  const sharedState: SharedFilterState | null = shareDef
    ? { params: shareDef.params, values: sharedValues!, set: setFilter, error: sharedError }
    : null;
  const [tab, setTab] = useState('main');
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [acting, setActing] = useState<{ action: RowAction<T>; row: T } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [qrOf, setQrOf] = useState<{ id: string; kind: QrKind } | null>(null);
  const [labels, setLabels] = useState<LabelRow[] | null>(null);
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
      enabled: onMain && !sharedError,
      // Keep the last page while the next loads, but never across a farm switch, nor under an invalid shared period.
      placeholderData: (prev, prevQuery) => (!sharedError && prevQuery?.queryKey[1] === farmId ? prev : undefined),
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
  const canCreate = !readOnly && config.noCreate !== true && can(config.slug, config.createPermission ?? 'create') && writable;
  // A reason keeps the icons (disabled); `true` removes them, but for what `whenReadOnly` lets through.
  const hidden = readOnly && !reason;
  const canEditRows = !hidden && can(config.slug, config.editPermission ?? 'update') && writable;
  const closedGates = readOnly ? config.whenReadOnly : undefined;
  const canDeleteRows = (!hidden || Boolean(closedGates?.canDelete)) && can(config.slug, config.deletePermission ?? 'delete') && writable;
  const readOnlyBecauseAllFarms =
    !writable && (can(config.slug, 'create') || can(config.slug, 'update') || can(config.slug, 'delete'));

  const afterWrite = () => {
    void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
    // Farms and users feed `/auth/me` (farm switcher, farm list).
    if (!scoped) void reload().catch(() => undefined);
  };

  const tableActions: TableAction<T>[] = (config.actions ?? [])
    .filter((a) => (!hidden || closedGates?.actions?.[a.key]) && canRunAction(a.permission, config.slug, can, writable && !(a.needsFarm && farmId === 'all')))
    .map((a) => ({
      key: a.key,
      label: a.label,
      icon: a.icon,
      visible: (row: T) => (a.visible?.(row, { can }) ?? true) && (!hidden || closedGates!.actions![a.key](row)),
      disabled: (row: T) => (reason && !closedGates?.actions?.[a.key]?.(row) ? reason : undefined),
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

  // Built-in edit / delete gates: the config's per-row answer, then the list's reason on top (a `false` stays hidden).
  const gateWith = (own: ((row: T) => boolean | string) | undefined, letThrough?: (row: T) => boolean) =>
    reason || (hidden && letThrough)
      ? (row: T) => {
          const g = own?.(row) ?? true;
          if (g === false) return false;
          if (reason) return letThrough?.(row) ? g : reason;
          return letThrough!(row) ? g : false;
        }
      : own;
  const qrKind = (row: T): QrKind | null => (typeof config.qr === 'function' ? config.qr(row) : (config.qr ?? null));
  const labelRows: LabelRow[] = (list.data?.items ?? []).flatMap((row) => {
    const kind = qrKind(row);
    return kind ? [{ id: row.id, kind }] : [];
  });

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
          onLabels={config.qr ? () => (labelRows.length > 0 ? setLabels(labelRows) : setNotice({ tone: 'error', message: 'Aucune étiquette à imprimer sur cette page' })) : undefined}
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

  const detailPath = config.detailPath
    ? (row: T) => config.detailPath!(row, { can })
    : config.detail ? (row: T) => `/m/${config.slug}/${row.id}` : undefined;
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
            const value = filterValues[f.param] ?? '';
            return f.type === 'date'
              ? <DateFilter key={f.param} label={f.allLabel} value={value} onChange={(v) => setFilter(f.param, v)} />
              : <FilterSelect key={f.param} def={f} value={value} onChange={(v) => setFilter(f.param, v)} />;
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
              columns={config.columns.filter((c) => c.visible?.({ can }) ?? true)}
              rows={list.data?.items ?? []}
              loading={list.isPending && !sharedError}
              statuses={config.statuses}
              statusKey={config.statusKey}
              sort={sort}
              onSort={toggleSort}
              detailPath={detailPath}
              qr={config.qr ? { kindOf: qrKind, open: (row, kind) => setQrOf({ id: row.id, kind }) } : undefined}
              actions={tableActions}
              onEdit={canEditRows ? setEditing : undefined}
              onDelete={canDeleteRows ? setDeleting : undefined}
              canEdit={gateWith(config.canEdit)}
              canDelete={gateWith(config.canDelete, closedGates?.canDelete)}
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
      {qrOf && <QrDialog kind={qrOf.kind} id={qrOf.id} onClose={() => setQrOf(null)} />}
      {labels && <QrLabelSheet title={config.title} rows={labels} onClose={() => setLabels(null)} />}
      {acting?.action.dialog && (
        // A dialog may be a lazy component (a print sheet): the page stays while it loads.
        <Suspense fallback={<LoadingBlock className="fixed bottom-6 left-1/2 z-50 h-10 w-44 -translate-x-1/2 shadow-card" />}>
          <acting.action.dialog
            row={acting.row}
            onClose={() => setActing(null)}
            onDone={() => { setActing(null); afterWrite(); }}
          />
        </Suspense>
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
  const pageContent = (
    <>
      <PageHeader group={config.group} title={config.title} subtitle={config.subtitle} actions={onMain ? actions : undefined} />
      {extraTabs.length > 0 && <TabBar tabs={allTabs} active={activeKey} onChange={setTab} idBase={tabBase} />}
      {sharedError && <Alert className="mb-4">{sharedError}</Alert>}
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
  return sharedState ? <SharedFiltersContext.Provider value={sharedState}>{pageContent}</SharedFiltersContext.Provider> : pageContent;
}
