import { allPages } from '../components/module/allPages';
import type { EndpointOptions } from '../components/module/types';
import { useEndpointOptions, type Option } from '../components/module/useEndpointOptions';
import { useAuth } from '../lib/auth';
import type { ModuleKey } from '../lib/modules';
import { useFarmQuery } from '../lib/query';

export type Species = 'AVICOLE' | 'PORCIN';

/** The module that owns the records of a species (its lots, its animals): the one whose read right opens them. */
export const SPECIES_MODULE: Record<Species, ModuleKey> = { AVICOLE: 'lots', PORCIN: 'porcs' };

/**
 * THE buildings options of every form: those of the species the form is about first (the API sorts by name only), the
 * order of the API without one. `enabled: false` makes no request (a form that only needs them for one choice).
 */
export function useBuildingOptions(firstType?: Species, enabled = true): Option[] {
  const { data } = useFarmQuery<{ id: string; name: string; type: string }[]>(
    ['/buildings', 'typed-options'],
    () => allPages('/buildings'),
    { enabled },
  );
  const rank = (b: { type: string }) => (b.type === firstType ? 0 : 1);
  return [...(data ?? [])].sort((a, b) => rank(a) - rank(b)).map((b) => ({ value: b.id, label: b.name }));
}

/** THE option source of the open lots of one species (labelled by code), of one lot type when given. */
export const openLotOptions = (species: Species, type?: string): EndpointOptions => ({
  endpoint: '/batches',
  labelKey: 'code',
  params: { species, status: 'EN_COURS', ...(type ? { type } : {}) },
});

/** Open lots of both species, each loaded only when the user may read that species' module (the API checks it too). */
export function useOpenLotOptions(enabled = true): Option[] {
  const { can } = useAuth();
  const avian = useEndpointOptions(openLotOptions('AVICOLE'), undefined, enabled && can(SPECIES_MODULE.AVICOLE, 'read'));
  const pigs = useEndpointOptions(openLotOptions('PORCIN'), undefined, enabled && can(SPECIES_MODULE.PORCIN, 'read'));
  return [...avian, ...pigs];
}

/** Open avian batches that lay eggs (the API filters on one type at a time, so the types are kept here). */
export function useLayingBatchOptions(): Option[] {
  const { data } = useFarmQuery<{ id: string; code: string; type: string }[]>(
    ['/batches', 'laying-options'],
    () => allPages('/batches', { species: 'AVICOLE', status: 'EN_COURS' }),
  );
  return (data ?? []).filter((b) => b.type === 'PONDEUSE' || b.type === 'REPRODUCTEUR').map((b) => ({ value: b.id, label: b.code }));
}

/** THE option source of the breeds of a species. */
export const breedOptions = (species: Species): EndpointOptions => ({ endpoint: '/breeds', params: { species } });

/** THE option source of the animals still on the farm, of one sex (sires and dams, boars and sows), labelled by tag. */
export const activeAnimalOptions = (sex: 'F' | 'M'): EndpointOptions => ({
  endpoint: '/animals',
  params: { sex, status: 'ACTIF' },
  labelKey: 'tag',
});
