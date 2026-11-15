import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '../../components/module/ActionDialog';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { DataTable } from '../../components/module/DataTable';
import { ModuleList } from '../../components/module/ModulePage';
import { StatTiles } from '../../components/module/StatTiles';
import type { Column } from '../../components/module/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDecimal, formatNumber, orDash, todayIso } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { BREEDING_STATUSES } from '../../modules/breedingShared';
import {
  ageLabel, animalHeats, animalWeighings, categoryLabel, hasLeft, statusDef, type AnimalDetailData, type BreedingHistory,
} from '../../modules/porcsShared';
import { MODULES } from '../../modules/registry';
import { WithdrawalNotice } from '../../modules/santeShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

const EXIT_REASONS = [
  { value: 'VENDU', label: 'Vendu' },
  { value: 'MORT', label: 'Mort' },
  { value: 'REFORME', label: 'Réformé' },
];

function ExitDialog({ animal, onClose, onDone }: { animal: AnimalDetailData; onClose: () => void; onDone: () => void }) {
  return (
    <ActionDialog
      title={`Sortie — ${animal.tag}`}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: todayIso },
        { name: 'reason', label: 'Motif', type: 'select', required: true, options: EXIT_REASONS },
      ]}
      onSubmit={(body) => api.post(`/animals/${animal.id}/exit`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

type BreedingRow = BreedingHistory['records'][number];

const BREEDING_COLUMNS: Column<BreedingRow>[] = [
  { key: 'serviceDate', header: 'DATE SAILLIE' },
  { key: 'sire', header: 'VERRAT / IA' },
  { key: 'farrowingDate', header: 'MISE BAS', render: (r) => r.farrowingDate ?? '—' },
  { key: 'bornTotal', header: 'NÉS TOTAUX', render: (r) => orDash(r.bornTotal) },
  { key: 'bornAlive', header: 'NÉS VIVANTS', render: (r) => orDash(r.bornAlive) },
  { key: 'weanedCount', header: 'SEVRÉS', render: (r) => orDash(r.weanedCount) },
  { key: 'status', header: 'STATUT' },
];

function BreedingTab({ animalId }: { animalId: string }) {
  const query = useFarmQuery<BreedingHistory>(['/animals', animalId, 'breeding-history'], () =>
    api.get<BreedingHistory>(`/animals/${animalId}/breeding-history`),
  );
  if (query.isPending) return <div aria-busy className="h-24 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const { records, totals } = query.data;
  return (
    <>
      <StatTiles
        tiles={[
          { label: 'Portées', value: formatNumber(totals.litters) },
          { label: 'Nés vivants (moy.)', value: orDash(totals.averageBornAlive, (n) => formatDecimal(n, 1)) },
          { label: 'Sevrés (moy.)', value: orDash(totals.averageWeaned, (n) => formatDecimal(n, 1)) },
        ]}
      />
      <Card className="overflow-hidden">
        <DataTable columns={BREEDING_COLUMNS} rows={records} loading={false} statuses={BREEDING_STATUSES} statusKey="status" emptyText="Aucune saillie" />
      </Card>
    </>
  );
}

/** `/m/porcs/:id`: one animal with its key figures, weighings, breeding history and heats. */
export function AnimalDetail({ id }: { id: string }) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [exiting, setExiting] = useState(false);
  const query = useFarmQuery<AnimalDetailData>(['/animals', 'detail', id], () => api.get<AnimalDetailData>(`/animals/${id}`));

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    // An id that is not even a valid id (400) is as unknown as a missing one (404).
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const animal = query.data;
  const status = statusDef({ kind: 'ANIMAL', status: animal.status });
  // Heats and breeding history belong to the `reproduction` module, whatever the animal's own permissions.
  const breeding = animal.sex === 'F' && can('reproduction', 'read');
  const left = animal.exitDate !== null || hasLeft(animal.status);
  const canManage = can('porcs', 'update') && farmId !== 'all';
  const health = can('sante', 'read') ? MODULES.sante : undefined;
  const weighings = animalWeighings(id, left);
  const heats = animalHeats(id, left);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });

  return (
    <>
      <DetailLayout
        back={{ to: '/m/porcs', label: 'Cheptel porcin' }}
        title={animal.tag}
        subtitle={[categoryLabel(animal.category), animal.breedName, animal.buildingName].filter(Boolean).join(' · ')}
        status={<Pill tone={status.tone}>{status.label}</Pill>}
        actions={canManage && !left && <Button variant="outline" onClick={() => setExiting(true)}>Sortie</Button>}
        notice={<WithdrawalNotice until={animal.withdrawalUntil} />}
        stats={[
          { label: 'Poids', value: orDash(animal.weightKg, (n) => `${formatNumber(n)} kg`) },
          { label: 'Âge', value: ageLabel(animal.birthDate) },
          { label: 'Statut', value: status.label },
        ]}
        tabs={[
          { key: 'weighings', label: 'Pesées', content: <ModuleList config={weighings} noCreate={left} /> },
          ...(breeding ? [{ key: 'breeding', label: 'Reproduction', content: <BreedingTab animalId={id} /> }] : []),
          ...(breeding ? [{ key: 'heats', label: 'Chaleurs', content: <ModuleList config={heats} noCreate={left} /> }] : []),
          ...(health ? [{ key: 'health', label: 'Santé', content: <ModuleList config={health} scope={{ animalId: id }} noCreate={left} /> }] : []),
        ]}
      />
      {exiting && <ExitDialog animal={animal} onClose={() => setExiting(false)} onDone={() => { setExiting(false); refresh(); }} />}
    </>
  );
}
