import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { formatDate, formatNumber, formatPct } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useFarmQuery } from '../../lib/query';
import { QrButton } from '../../components/module/QrButton';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { BUILDING_STATUSES, buildingTypeLabel } from '../../modules/batimentsShared';
import { CONDITIONS, type EquipmentCondition } from '../../modules/equipementsShared';
import { PIG_LOT_PREFIX } from '../../modules/porcsShared';
import { actTypeLabel, type HealthActType } from '../../modules/santeShared';
import { DetailGate } from './DetailGate';
import { DetailLayout } from './DetailLayout';

/**
 * `GET /buildings/:id/overview`: every part after the figures is `null` when the user may not read its module
 * (lots / porcs, equipements, taches, sante), and the page then leaves its card out.
 */
interface BuildingOverview {
  building: { id: string; name: string; type: string; status: string };
  site: { id: string; name: string };
  occupation: number;
  capacity: number;
  lots: { id: string; code: string; species: 'AVICOLE' | 'PORCIN'; alive: number }[] | null;
  animals: number | null;
  equipment: { id: string; name: string; condition: EquipmentCondition; nextMaintenance: string | null }[] | null;
  openTasks: number | null;
  lastHealthActs: { id: string; date: string; type: HealthActType; productName: string | null; status: string }[] | null;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card className="p-5">
    <section>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  </Card>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const linkClass = 'font-medium text-primary hover:underline';

/** `/m/batiments/:id`: what a building's QR code opens: its figures and what is in it (lots, equipment, open tasks, latest health acts). */
export function BuildingDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const query = useFarmQuery<BuildingOverview>(['/buildings', 'overview', id], () => api.get<BuildingOverview>(`/buildings/${id}/overview`));
  return (
    <DetailGate query={query}>
      {(o) => {
        const status = BUILDING_STATUSES.find((s) => s.value === o.building.status);
        return (
          <DetailLayout
            back={{ to: '/m/batiments', label: 'Bâtiments' }}
            title={o.building.name}
            subtitle={`${buildingTypeLabel(o.building.type)} · ${o.site.name}`}
            status={<Pill tone={status?.tone ?? 'neutral'}>{status?.label ?? o.building.status}</Pill>}
            actions={<QrButton kind="batiment" id={id} />}
            stats={[
              { label: 'Capacité', value: formatNumber(o.capacity) },
              { label: 'Occupation', value: formatNumber(o.occupation) },
              { label: "Taux d'occupation", value: formatPct(o.capacity > 0 ? (o.occupation / o.capacity) * 100 : 0) },
            ]}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {(o.lots !== null || o.animals !== null) && (
                <Section title="Lots et animaux">
                  {o.lots !== null && (o.lots.length === 0 ? (
                    <Empty>Aucun lot en cours</Empty>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {o.lots.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-3">
                          {can(l.species === 'PORCIN' ? 'porcs' : 'lots', 'read') ? (
                            <Link to={l.species === 'PORCIN' ? `/m/porcs/${PIG_LOT_PREFIX}${l.id}` : `/m/lots/${l.id}`} className={linkClass}>{l.code}</Link>
                          ) : (
                            <span className="font-medium">{l.code}</span>
                          )}
                          <span className="text-muted-foreground">{formatNumber(l.alive)} vivants</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                  {o.animals !== null && <p className="mt-2 text-sm">{formatNumber(o.animals)} animaux</p>}
                </Section>
              )}
              {o.equipment !== null && (
                <Section title="Équipements">
                  {o.equipment.length === 0 ? (
                    <Empty>Aucun équipement</Empty>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {o.equipment.map((e) => {
                        const c = CONDITIONS.find((x) => x.value === e.condition);
                        return (
                          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                            <Link to={`/m/equipements/${e.id}`} className={linkClass}>{e.name}</Link>
                            <span className="flex items-center gap-2">
                              {e.nextMaintenance && <span className="text-muted-foreground">Maintenance {formatDate(e.nextMaintenance)}</span>}
                              <Pill tone={c?.tone ?? 'neutral'}>{c?.label ?? e.condition}</Pill>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Section>
              )}
              {o.openTasks !== null && (
                <Section title="Tâches ouvertes">
                  <p className="text-3xl font-bold">{formatNumber(o.openTasks)}</p>
                  <Link to="/m/taches" className={`mt-2 inline-block text-sm ${linkClass}`}>Voir les tâches</Link>
                </Section>
              )}
              {o.lastHealthActs !== null && (
                <Section title="Derniers actes sanitaires">
                  {o.lastHealthActs.length === 0 ? (
                    <Empty>Aucun acte sanitaire</Empty>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {o.lastHealthActs.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3">
                          <span>{formatDate(a.date)} · {actTypeLabel(a.type)}</span>
                          <span className="text-muted-foreground">{a.productName ?? '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}
            </div>
          </DetailLayout>
        );
      }}
    </DetailGate>
  );
}
