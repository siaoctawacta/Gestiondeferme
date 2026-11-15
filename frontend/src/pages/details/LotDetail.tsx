import { Suspense, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { ModuleKey } from '../../lib/modules';
import { useAuth } from '../../lib/auth';
import { formatDecimal, formatNumber, formatPct, orDash, todayIso } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { ActionDialog } from '../../components/module/ActionDialog';
import { ConfirmDialog } from '../../components/module/ConfirmDialog';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { ModuleList } from '../../components/module/ModulePage';
import type { ListResponse } from '../../components/module/types';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { lazyRetry } from '../../components/lazyRetry';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { LotForm } from '../../modules/lotForm';
import { MODULES } from '../../modules/registry';
import {
  STATUSES, TYPE_LABELS, batchEvents, batchWeighings, type BatchDetail, type Weighing,
} from '../../modules/lotsShared';
import { useBuildingOptions, type Species } from '../../modules/productionShared';
import { WithdrawalNotice } from '../../modules/santeShared';
import { LotProfitabilityCard } from '../finance/LotProfitability';
import NotFound from '../NotFound';
import { Skeleton } from '../PageParts';
import { DetailLayout } from './DetailLayout';

const WeightCurve = lazyRetry(() => import('./WeightCurve'));

/** Weights are stored in grams; pigs are shown in kilograms. */
const weightLabel = (g: number, species: Species) =>
  species === 'PORCIN' ? `${formatDecimal(g / 1000, 2)} kg` : `${formatNumber(g)} g`;

function TransferDialog({ batch, species, onClose, onDone }: { batch: BatchDetail; species: Species; onClose: () => void; onDone: () => void }) {
  // The species' own buildings first, the lot's current one left out.
  const buildings = useBuildingOptions(species).filter((b) => b.value !== batch.buildingId);
  return (
    <ActionDialog
      title={`Transférer le lot ${batch.code}`}
      intro={`Les ${formatNumber(batch.alive)} animaux vivants quittent ${batch.buildingName}.`}
      submitLabel="Transférer"
      fields={[
        { name: 'toBuildingId', label: 'Bâtiment de destination', type: 'select', required: true, options: buildings },
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
      ]}
      toPayload={(v) => ({ toBuildingId: v.toBuildingId, date: v.date, quantity: batch.alive })}
      onSubmit={(body) => api.post(`/batches/${batch.id}/transfer`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function WeighingsTab({ batch, species, readOnly, moduleKey }: { batch: BatchDetail; species: Species; readOnly: boolean; moduleKey: ModuleKey }) {
  const config = useMemo(() => batchWeighings(batch.id, moduleKey, species), [batch.id, moduleKey, species]);
  const points = useFarmQuery<ListResponse<Weighing>>(
    [`/batches/${batch.id}/weighings`, 'curve'],
    () => api.get<ListResponse<Weighing>>(`/batches/${batch.id}/weighings`, { page: 1, pageSize: 200 }),
  );
  const pig = species === 'PORCIN';
  const series = [...(points.data?.items ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ date: w.date, weight: pig ? w.averageWeightG / 1000 : w.averageWeightG }));
  return (
    <>
      {series.length >= 2 && (
        <ErrorBoundary>
          <Suspense fallback={<Skeleton data-testid="weight-curve-skeleton" className="mb-4 h-[268px]" />}>
            <WeightCurve points={series} unit={pig ? 'kg' : 'g'} />
          </Suspense>
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
  const [editing, setEditing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useFarmQuery<BatchDetail>(['/batches', 'detail', id], () => api.get<BatchDetail>(`/batches/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    // An id that is not even a valid id (400) is as unknown as a missing one (404).
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const batch = query.data;
  const species: Species = batch.species ?? 'AVICOLE';
  const moduleKey: ModuleKey = species === 'PORCIN' ? 'porcs' : 'lots';
  const events = batchEvents(id, moduleKey);
  const closed = batch.status === 'CLOTURE';
  const canManage = can(moduleKey, 'update') && farmId !== 'all';
  const perf = batch.performance;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });
  const status = STATUSES.find((s) => s.value === batch.status) ?? STATUSES[0];

  const reopen = async () => {
    if (reopening) return;
    setReopening(true);
    setNotice(null);
    try {
      await api.post(`/batches/${id}/reopen`);
      refresh();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setReopening(false);
    }
  };

  const feeding = can('alimentation', 'read') ? MODULES.alimentation : undefined;
  const health = can('sante', 'read') ? MODULES.sante : undefined;
  const laying = can('ponte', 'read') && (batch.type === 'PONDEUSE' || batch.type === 'REPRODUCTEUR') ? MODULES.ponte : undefined;

  const tabs = [
    { key: 'events', label: 'Mouvements', content: <ModuleList config={events} readOnly={closed} /> },
    { key: 'weighings', label: 'Pesées', content: <WeighingsTab batch={batch} species={species} readOnly={closed} moduleKey={moduleKey} /> },
    ...(feeding
      ? [{ key: 'feeding', label: 'Alimentation', content: <ModuleList config={feeding} scope={{ batchId: id }} readOnly={closed} /> }]
      : []),
    ...(laying
      ? [{ key: 'laying', label: 'Ponte', content: <ModuleList config={laying} scope={{ batchId: id }} readOnly={closed} /> }]
      : []),
    ...(health
      ? [{ key: 'health', label: 'Santé', content: <ModuleList config={health} scope={{ batchId: id }} readOnly={closed} /> }]
      : []),
  ];

  return (
    <>
      <DetailLayout
        back={species === 'AVICOLE' ? { to: '/m/lots', label: 'Lots avicoles' } : { to: '/m/porcs', label: 'Cheptel porcin' }}
        title={batch.code}
        subtitle={[TYPE_LABELS[batch.type] ?? batch.type, batch.breedName, batch.buildingName].filter(Boolean).join(' · ')}
        status={<Pill tone={status.tone}>{status.label}</Pill>}
        actions={
          canManage && (
            <>
              {closed ? (
                <Button variant="outline" disabled={reopening} onClick={reopen}>Rouvrir</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>Modifier</Button>
                  <Button variant="outline" onClick={() => setTransferring(true)}>Transférer</Button>
                  <Button variant="outline" onClick={() => setConfirmClose(true)}>Clôturer</Button>
                </>
              )}
            </>
          )
        }
        notice={
          <>
            <WithdrawalNotice until={batch.withdrawalUntil} />
            {notice && <Alert className="mb-4">{notice}</Alert>}
            {/* Money figures need `finance` read and nothing else (ruling Q25), whatever the species module grants. */}
            {can('finance', 'read') && <LotProfitabilityCard batchId={id} />}
          </>
        }
        stats={[
          { label: 'Vivants', value: formatNumber(batch.alive) },
          { label: 'Mortalité', value: orDash(batch.mortalityRate, formatPct) },
          { label: 'Âge (jours)', value: orDash(batch.ageDays) },
          { label: 'Poids moyen', value: orDash(batch.averageWeightG, (g) => weightLabel(g, species)) },
          {
            label: 'GMD',
            value: orDash(perf?.dailyGainG, (g) => (species === 'PORCIN' ? `${formatDecimal(g / 1000, 2)} kg/j` : `${formatDecimal(g, 1)} g/j`)),
          },
          { label: 'Indice de consommation', value: orDash(perf?.feedConversion, (n) => formatDecimal(n, 2)) },
        ]}
        tabs={tabs}
      />
      {editing && <LotForm species={species} id={id} onSaved={() => { setEditing(false); refresh(); }} onClose={() => setEditing(false)} />}
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
        <TransferDialog batch={batch} species={species} onClose={() => setTransferring(false)} onDone={() => { setTransferring(false); refresh(); }} />
      )}
    </>
  );
}
