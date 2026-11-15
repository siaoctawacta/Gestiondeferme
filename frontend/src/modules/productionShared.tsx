import { allPages } from '../components/module/allPages';
import type { EndpointOptions } from '../components/module/types';
import type { Option } from '../components/module/useEndpointOptions';
import { useFarmQuery } from '../lib/query';

export type Species = 'AVICOLE' | 'PORCIN';

/** Buildings as select options, those of the species the form is about first (the API sorts by name only). */
export function useBuildingOptions(firstType: Species): Option[] {
  const { data } = useFarmQuery<{ id: string; name: string; type: string }[]>(
    ['/buildings', 'typed-options'],
    () => allPages('/buildings'),
  );
  const rank = (b: { type: string }) => (b.type === firstType ? 0 : 1);
  return [...(data ?? [])].sort((a, b) => rank(a) - rank(b)).map((b) => ({ value: b.id, label: b.name }));
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
