import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useFarmQuery } from '../lib/query';
import { DataTable } from '../components/module/DataTable';
import { ErrorRetry } from '../components/module/ErrorRetry';
import { errorMessage } from '../components/module/errorMessage';
import { ExportMenu } from '../components/module/ExportMenu';
import { PageHeader } from '../components/module/PageHeader';
import { Pagination } from '../components/module/Pagination';
import type { Column } from '../components/module/types';
import { useListState } from '../components/module/useListState';
import { MODULE_LABEL } from '../components/shell/nav';
import { Card } from '../components/ui/Card';
import { SearchInput } from '../components/ui/Input';
import { Pill, type PillTone } from '../components/ui/Pill';
import { Select } from '../components/ui/Select';
import { Alert } from '../components/ui/Alert';

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

// Audit entries also cover sign-in events, which belong to no sidebar module.
const AUTH_MODULE = { value: 'auth', label: 'Authentification' };
const FILTER_MODULES = [...[...MODULE_LABEL].map(([value, label]) => ({ value, label })), AUTH_MODULE];
const moduleLabel = (slug: string) => (slug === AUTH_MODULE.value ? AUTH_MODULE.label : MODULE_LABEL.get(slug) ?? slug);

const COLUMNS: Column<AuditEntry>[] = [
  { key: 'createdAt', header: 'Date', render: (e) => <span className="whitespace-nowrap">{formatDateTime(e.createdAt)}</span> },
  { key: 'userName', header: 'Utilisateur' },
  {
    key: 'action',
    header: 'Action',
    render: (e) => {
      const action = ACTIONS[e.action] ?? ACTIONS.OTHER;
      return <Pill tone={action.tone}>{action.label}</Pill>;
    },
  },
  { key: 'module', header: 'Module', render: (e) => moduleLabel(e.module) },
  { key: 'label', header: 'Élément' },
];

export default function Audit() {
  const { farmId } = useAuth();
  const { searchInput, setSearchInput, filters, setFilter, page, setPage, params } = useListState();
  const [exportError, setExportError] = useState<string | null>(null);

  const listParams = { ...params, page };
  const list = useFarmQuery<AuditPage>(['audit', listParams], () => api.get<AuditPage>('/audit', listParams), {
    // Keep the previous page while paging, but never rows of another farm.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === farmId ? prev : undefined),
  });
  const data = list.data;

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Journal d'audit"
        subtitle="Utilisateur, date, heure, action et module."
        actions={<ExportMenu endpoint="/audit" filename="journal-audit" params={params} onError={setExportError} />}
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
            value={filters.module ?? ''}
            onChange={(e) => setFilter('module', e.target.value)}
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
            <DataTable
              columns={COLUMNS}
              rows={data?.items ?? []}
              loading={list.isPending}
              emptyText="Aucune action enregistrée pour le moment."
            />
          </div>
        )}
        {data && <Pagination page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </Card>
    </div>
  );
}
