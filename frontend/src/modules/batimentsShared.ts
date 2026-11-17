import type { StatusDef } from '../components/module/types';

/** `GET /buildings`: one building with its occupation. */
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

export const BUILDING_TYPES = [
  { value: 'AVICOLE', label: 'Avicole' },
  { value: 'PORCIN', label: 'Porcin' },
  { value: 'AUTRE', label: 'Autre' },
];
export const buildingTypeLabel = (t: string) => BUILDING_TYPES.find((x) => x.value === t)?.label ?? t;

export const BUILDING_STATUSES: StatusDef[] = [
  { value: 'ACTIF', label: 'Actif', tone: 'success' },
  { value: 'VIDE_SANITAIRE', label: 'Vide sanitaire', tone: 'warning' },
  { value: 'MAINTENANCE', label: 'Maintenance', tone: 'danger' },
];
