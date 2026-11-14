import { api } from '../lib/api';
import { useFarmQuery } from '../lib/query';
import type { ListResponse } from '../components/module/types';
import type { Option } from '../components/module/useEndpointOptions';

/** Percentage with one decimal and no space before `%`; `—` when there is no figure. */
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);

const PAGE_SIZE = 200;

async function allPages<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await api.get<ListResponse<T>>(endpoint, { ...params, page, pageSize: PAGE_SIZE });
    out.push(...res.items);
    if (res.items.length === 0 || out.length >= res.total) return out;
  }
}

/** Buildings as select options, those of the species the form is about first (the API sorts by name only). */
export function useBuildingOptions(firstType: 'AVICOLE' | 'PORCIN'): Option[] {
  const { data } = useFarmQuery<{ id: string; name: string; type: string }[]>(
    ['/buildings', 'typed-options'],
    () => allPages('/buildings', {}),
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
