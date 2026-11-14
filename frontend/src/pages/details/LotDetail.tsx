import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { ModuleKey } from '../../lib/modules';
import { useAuth } from '../../lib/auth';
import { formatNumber, formatPct } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { ModuleList } from '../../components/module/ModulePage';
import type { ListResponse } from '../../components/module/types';
import { useEndpointOptions } from '../../components/module/useEndpointOptions';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { lazyRetry } from '../../components/lazyRetry';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { Pill } from '../../components/ui/Pill';
import { Select } from '../../components/ui/Select';
import { MODULES } from '../../modules/registry';
import {
  TYPE_LABELS, batchEvents, batchWeighings, type BatchDetail, type Weighing,
} from '../../modules/lotsShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

const WeightCurve = lazyRetry(() => import('./WeightCurve'));

const dash = (v: number | null | undefined, fmt: (n: number) => string) => (v === null || v === undefined ? '—' : fmt(v));
const oneDecimal = (n: number) => n.toFixed(1);

function TransferDialog({ batch, onClose, onDone }: { batch: BatchDetail; onClose: () => void; onDone: () => void }) {
  const buildings = useEndpointOptions({ endpoint: '/buildings' }).filter((b) => b.value !== batch.buildingId);
  const [toBuildingId, setTo] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!toBuildingId) return setError('Le champ « Bâtiment de destination » est requis');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/batches/${batch.id}/transfer`, { toBuildingId, date, quantity: batch.alive });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Transférer le lot ${batch.code}`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Les {formatNumber(batch.alive)} animaux vivants quittent {batch.buildingName}.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="transfer-to" className="block text-sm font-medium">Bâtiment de destination</label>
          <Select id="transfer-to" className="w-full" value={toBuildingId} onChange={(e) => setTo(e.target.value)}>
            <option value="">Sélectionner…</option>
            {buildings.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="transfer-date" className="block text-sm font-medium">Date</label>
          <Input id="transfer-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={busy}>Transférer</Button>
        </div>
      </form>
    </Dialog>
  );
}

function WeighingsTab({ batch, readOnly, moduleKey }: { batch: BatchDetail; readOnly: boolean; moduleKey: ModuleKey }) {
  const config = useMemo(() => batchWeighings(batch.id, moduleKey), [batch.id, moduleKey]);
  const points = useFarmQuery<ListResponse<Weighing>>(
    [`/batches/${batch.id}/weighings`, 'curve'],
    () => api.get<ListResponse<Weighing>>(`/batches/${batch.id}/weighings`, { page: 1, pageSize: 200 }),
  );
  const series = [...(points.data?.items ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ date: w.date, weightG: w.averageWeightG }));
  return (
    <>
      {series.length >= 2 && (
        <ErrorBoundary>
          <WeightCurve points={series} />
        </ErrorBoundary>
      )}
      <ModuleList config={config} readOnly={readOnly} />
    </>
  );
}

/**
 * `/m/lots/:id`: one batch with its key figures, movements and weighings. Species-agnostic: everything that
 * differs between poultry and pig lots comes from the loaded batch.
 */
export function LotDetail({ id }: { id: string }) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useFarmQuery<BatchDetail>(['/batches', 'detail', id], () => api.get<BatchDetail>(`/batches/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const batch = query.data;
  const moduleKey: ModuleKey = batch.species === 'PORCIN' ? 'porcs' : 'lots';
  const events = batchEvents(id, moduleKey);
  const closed = batch.status === 'CLOTURE';
  const canManage = can(moduleKey, 'update') && farmId !== 'all';
  const perf = batch.performance;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
  const avian = batch.species !== 'PORCIN';

  const reopen = async () => {
    setNotice(null);
    try {
      await api.post(`/batches/${id}/reopen`);
      refresh();
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  const feeding = can('alimentation', 'read') ? MODULES.alimentation : undefined;
  const laying = can('ponte', 'read') && (batch.type === 'PONDEUSE' || batch.type === 'REPRODUCTEUR') ? MODULES.ponte : undefined;

  const tabs = [
    { key: 'events', label: 'Mouvements', content: <ModuleList config={events} readOnly={closed} /> },
    { key: 'weighings', label: 'Pesées', content: <WeighingsTab batch={batch} readOnly={closed} moduleKey={moduleKey} /> },
    ...(feeding
      ? [{ key: 'feeding', label: 'Alimentation', content: <ModuleList config={feeding} scope={{ batchId: id }} readOnly={closed} /> }]
      : []),
    ...(laying
      ? [{ key: 'laying', label: 'Ponte', content: <ModuleList config={laying} scope={{ batchId: id }} readOnly={closed} /> }]
      : []),
  ];

  return (
    <>
      <DetailLayout
        back={avian ? { to: '/m/lots', label: 'Lots avicoles' } : { to: '/m/porcs', label: 'Cheptel porcin' }}
        title={batch.code}
        subtitle={[TYPE_LABELS[batch.type] ?? batch.type, batch.breedName, batch.buildingName].filter(Boolean).join(' · ')}
        status={closed ? <Pill tone="success">Clôturé</Pill> : <Pill tone="warning">En cours</Pill>}
        actions={
          canManage && (
            <>
              {closed ? (
                <Button variant="outline" onClick={reopen}>Rouvrir</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setTransferring(true)}>Transférer</Button>
                  <Button variant="outline" onClick={() => setConfirmClose(true)}>Clôturer</Button>
                </>
              )}
            </>
          )
        }
        stats={[
          { label: 'Vivants', value: formatNumber(batch.alive) },
          { label: 'Mortalité', value: dash(batch.mortalityRate, formatPct) },
          { label: 'Âge (jours)', value: dash(batch.ageDays, formatNumber) },
          { label: 'Poids moyen', value: dash(batch.averageWeightG, formatNumber) },
          { label: 'GMD', value: dash(perf?.dailyGainG, (n) => `${oneDecimal(n)} g/j`) },
          { label: 'Indice de consommation', value: dash(perf?.feedConversion, (n) => n.toFixed(2)) },
        ]}
        tabs={tabs}
      />
      {notice && <Alert className="mt-4">{notice}</Alert>}
      {confirmClose && (
        <ConfirmDialog
          title="Clôturer le lot"
          message={`Clôturer le lot ${batch.code} ? Il ne pourra plus recevoir d'opérations.`}
          confirmLabel="Clôturer"
          onClose={() => setConfirmClose(false)}
          onConfirm={async () => {
            await api.post(`/batches/${id}/close`);
            setConfirmClose(false);
            refresh();
          }}
        />
      )}
      {transferring && (
        <TransferDialog batch={batch} onClose={() => setTransferring(false)} onDone={() => { setTransferring(false); refresh(); }} />
      )}
    </>
  );
}
