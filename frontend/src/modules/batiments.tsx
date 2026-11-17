import { lazyRetry } from '../components/lazyRetry';
import type { ModuleConfig } from '../components/module/types';
import { Pill } from '../components/ui/Pill';
import { formatNumber, formatPct } from '../lib/format';
import { BUILDING_STATUSES, BUILDING_TYPES, buildingTypeLabel, type Building } from './batimentsShared';

export type { Building };

const BuildingDetail = lazyRetry(() => import('../pages/details/BuildingDetail').then((m) => ({ default: m.BuildingDetail })));

export interface Zone {
  id: string;
  name: string;
  buildingId: string;
  buildingName: string;
  capacity: number | null;
}

/** Zones of a building: a second list, shown in the `Zones` tab. */
export const zones: ModuleConfig<Zone> = {
  slug: 'batiments',
  group: 'Administration',
  title: 'Zones',
  subtitle: 'Zones des bâtiments.',
  endpoint: '/zones',
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'buildingName', header: 'BÂTIMENT' },
    { key: 'capacity', header: 'CAPACITÉ', sortable: true, render: (z) => (z.capacity === null ? '—' : formatNumber(z.capacity)) },
  ],
  fields: [
    { name: 'buildingId', label: 'Bâtiment', type: 'select', required: true, only: 'create', options: { endpoint: '/buildings' } },
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'capacity', label: 'Capacité', type: 'number', min: 1 },
  ],
  filters: [{ param: 'buildingId', allLabel: 'Tous les bâtiments', options: { endpoint: '/buildings' } }],
};

export const batiments: ModuleConfig<Building> = {
  slug: 'batiments',
  group: 'Administration',
  title: 'Bâtiments',
  subtitle: 'Sites, bâtiments, zones et capacités.',
  endpoint: '/buildings',
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'type', header: 'TYPE', sortable: true, render: (b) => buildingTypeLabel(b.type) },
    { key: 'siteName', header: 'SITE' },
    { key: 'capacity', header: 'CAPACITÉ', sortable: true, render: (b) => formatNumber(b.capacity) },
    { key: 'occupation', header: 'OCCUPATION', render: (b) => formatNumber(b.occupation) },
    { key: 'status', header: 'STATUT', sortable: true },
    {
      key: 'occupationRate',
      header: 'TAUX OCC.',
      render: (b) => (
        <Pill strong tone={b.occupationRate >= 90 ? 'warning' : b.occupationRate === 0 ? 'neutral' : 'success'}>
          {formatPct(b.occupationRate)}
        </Pill>
      ),
    },
  ],
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'type', label: 'Type', type: 'select', required: true, options: BUILDING_TYPES },
    { name: 'siteId', label: 'Site', type: 'select', required: true, options: { endpoint: '/sites' } },
    { name: 'capacity', label: 'Capacité', type: 'number', required: true, min: 1 },
    { name: 'status', label: 'Statut', type: 'select', defaultValue: 'ACTIF', options: BUILDING_STATUSES.map(({ value, label }) => ({ value, label })) },
  ],
  statuses: BUILDING_STATUSES,
  statusKey: 'status',
  qr: 'batiment',
  detail: BuildingDetail,
  tabs: [{ key: 'zones', label: 'Zones', config: zones }],
};
