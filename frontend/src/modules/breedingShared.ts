import type { StatusDef } from '../components/module/types';

export type BreedingStatus = 'GESTATION' | 'MISE_BAS' | 'SEVRAGE' | 'ECHEC';

/** Labels and tones of a breeding record's status, shared by the Reproduction list and the animal's history. */
export const BREEDING_STATUSES: (StatusDef & { value: BreedingStatus })[] = [
  { value: 'GESTATION', label: 'Gestation', tone: 'warning' },
  { value: 'MISE_BAS', label: 'Mise bas', tone: 'success' },
  { value: 'SEVRAGE', label: 'Sevrage', tone: 'neutral' },
  { value: 'ECHEC', label: 'Échec', tone: 'danger' },
];
