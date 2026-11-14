import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '../../components/module/ActionDialog';
import { ErrorRetry } from '../../components/module/ErrorRetry';
import { errorMessage } from '../../components/module/errorMessage';
import { ModuleList } from '../../components/module/ModulePage';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { Table, TD, TH, THead, TR } from '../../components/ui/Table';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { farmKey, useFarmQuery } from '../../lib/query';
import { BREEDING_STATUSES } from '../../modules/breedingShared';
import { today } from '../../modules/lotsShared';
import {
  ageLabel, animalHeats, animalWeighings, categoryLabel, statusDef, type AnimalDetailData, type BreedingHistory,
} from '../../modules/porcsShared';
import NotFound from '../NotFound';
import { DetailLayout } from './DetailLayout';

const EXIT_REASONS = [
  { value: 'VENDU', label: 'Vendu' },
  { value: 'MORT', label: 'Mort' },
  { value: 'REFORME', label: 'Réformé' },
];
const dash = (v: number | null | undefined, fmt: (n: number) => string) => (v === null || v === undefined ? '—' : fmt(v));

function ExitDialog({ animal, onClose, onDone }: { animal: AnimalDetailData; onClose: () => void; onDone: () => void }) {
  return (
    <ActionDialog
      title={`Sortie — ${animal.tag}`}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() },
        { name: 'reason', label: 'Motif', type: 'select', required: true, options: EXIT_REASONS },
      ]}
      onSubmit={(body) => api.post(`/animals/${animal.id}/exit`, body)}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function BreedingTab({ animalId }: { animalId: string }) {
  const query = useFarmQuery<BreedingHistory>(['/animals', animalId, 'breeding-history'], () =>
    api.get<BreedingHistory>(`/animals/${animalId}/breeding-history`),
  );
  if (query.isPending) return <div aria-busy className="h-24 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const { items, totals } = query.data;
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          ['Portées', formatNumber(totals.litters)],
          ['Nés vivants (moy.)', dash(totals.averageBornAlive, (n) => n.toFixed(1))],
          ['Sevrés (moy.)', dash(totals.averageWeaned, (n) => n.toFixed(1))],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[calc(var(--radius)+10px)] bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <Card className="overflow-hidden">
        <Table>
          <THead>
            <TR>
              {['DATE SAILLIE', 'VERRAT / IA', 'MISE BAS', 'NÉS TOTAUX', 'NÉS VIVANTS', 'SEVRÉS', 'STATUT'].map((h) => <TH key={h}>{h}</TH>)}
            </TR>
          </THead>
          <tbody>
            {items.length === 0 && (
              <TR><TD colSpan={7} className="py-10 text-center text-muted-foreground">Aucune saillie</TD></TR>
            )}
            {items.map((r) => (
              <TR key={r.id}>
                <TD className="font-semibold">{r.serviceDate}</TD>
                <TD>{r.sire}</TD>
                <TD>{r.farrowingDate ?? '—'}</TD>
                <TD>{dash(r.bornTotal, formatNumber)}</TD>
                <TD>{dash(r.bornAlive, formatNumber)}</TD>
                <TD>{dash(r.weanedCount, formatNumber)}</TD>
                <TD>{breedingStatus(r.status)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function breedingStatus(value: string) {
  const def = BREEDING_STATUSES.find((s) => s.value === value);
  return def ? <Pill tone={def.tone}>{def.label}</Pill> : value;
}

/** `/m/porcs/:id`: one animal with its key figures, weighings, breeding history and heats. */
export function AnimalDetail({ id }: { id: string }) {
  const { can, farmId } = useAuth();
  const queryClient = useQueryClient();
  const [exiting, setExiting] = useState(false);
  const query = useFarmQuery<AnimalDetailData>(['/animals', 'detail', id], () => api.get<AnimalDetailData>(`/animals/${id}`));
  const weighings = useMemo(() => animalWeighings(id), [id]);
  const heats = useMemo(() => animalHeats(id), [id]);

  if (query.isPending) return <div aria-busy className="h-40 animate-pulse rounded-3xl bg-muted" />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFound />;
    return <ErrorRetry message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  }

  const animal = query.data;
  const status = statusDef({ kind: 'ANIMAL', status: animal.status });
  // Heats and breeding history belong to the `reproduction` module, whatever the animal's own permissions.
  const breeding = animal.sex === 'F' && can('reproduction', 'read');
  const left = animal.exitDate !== null || ['VENDU', 'MORT', 'REFORME'].includes(animal.status);
  const canManage = can('porcs', 'update') && farmId !== 'all';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: farmKey(farmId) });

  return (
    <>
      <DetailLayout
        back={{ to: '/m/porcs', label: 'Cheptel porcin' }}
        title={animal.tag}
        subtitle={[categoryLabel(animal.category), animal.breedName, animal.buildingName].filter(Boolean).join(' · ')}
        status={<Pill tone={status.tone}>{status.label}</Pill>}
        actions={canManage && !left && <Button variant="outline" onClick={() => setExiting(true)}>Sortie</Button>}
        stats={[
          { label: 'Poids', value: dash(animal.weightKg, (n) => `${formatNumber(n)} kg`) },
          { label: 'Âge', value: ageLabel(animal.birthDate) },
          { label: 'Statut', value: status.label },
        ]}
        tabs={[
          { key: 'weighings', label: 'Pesées', content: <ModuleList config={weighings} readOnly={left} /> },
          ...(breeding ? [{ key: 'breeding', label: 'Reproduction', content: <BreedingTab animalId={id} /> }] : []),
          ...(breeding ? [{ key: 'heats', label: 'Chaleurs', content: <ModuleList config={heats} readOnly={left} /> }] : []),
        ]}
      />
      {exiting && <ExitDialog animal={animal} onClose={() => setExiting(false)} onDone={() => { setExiting(false); refresh(); }} />}
    </>
  );
}
