import { api } from '../../lib/api';
import type { ListResponse } from './types';

const PAGE_SIZE = 200;

/** Every row of a list endpoint (`{items,total}` shape), page after page; `params` are sent with each request. */
export async function allPages<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await api.get<ListResponse<T>>(endpoint, { ...params, page, pageSize: PAGE_SIZE });
    out.push(...res.items);
    if (res.items.length === 0 || out.length >= res.total) return out;
  }
}
