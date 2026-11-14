import type { ModuleConfig, StatusDef } from '../components/module/types';
import { Pill } from '../components/ui/Pill';
import { formatNumber, formatPct } from '../lib/format';

export interface Building {
  id: string;
  name: string;
  type: 'AVICOLE' | 'PORCIN' | 'AUTRE';
  siteId: string;
  siteName: string;
  capacity: number;
  occupation: number;
  occupationRate: number;
  status: 'ACTIF' | 'VIDE_SANITAIRE' | 'MAINTENANCE';
  zones: number;
}

const TYPE_OPTIONS = [
  { value: 'AVICOLE', label: 'Avicole' },
  { value: 'PORCIN', label: 'Porcin' },
  { value: 'AUTRE', label: 'Autre' },
];

const STATUSES: StatusDef[] = [
  { value: 'ACTIF', label: 'Actif', tone: 'success' },
  { value: 'VIDE_SANITAIRE', label: 'Vide sanitaire', tone: 'warning' },
  { value: 'MAINTENANCE', label: 'Maintenance', tone: 'danger' },
];

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
    { key: 'type', header: 'TYPE', sortable: true, render: (b) => TYPE_OPTIONS.find((t) => t.value === b.type)?.label ?? b.type },
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
    { name: 'type', label: 'Type', type: 'select', required: true, options: TYPE_OPTIONS },
    { name: 'siteId', label: 'Site', type: 'select', required: true, options: { endpoint: '/sites' } },
    { name: 'capacity', label: 'Capacité', type: 'number', required: true, min: 1 },
    { name: 'status', label: 'Statut', type: 'select', defaultValue: 'ACTIF', options: STATUSES.map(({ value, label }) => ({ value, label })) },
  ],
  statuses: STATUSES,
  statusKey: 'status',
  tabs: [{ key: 'zones', label: 'Zones', config: zones }],
};
