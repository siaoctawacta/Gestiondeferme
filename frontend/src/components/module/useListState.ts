import { useEffect, useState } from 'react';
import type { SortState } from './DataTable';
import type { SharedFilterState } from './sharedFilters';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search box (debounced), filters, sort and page of a list screen; any change but the page goes back to page 1.
 * `initial` are the first filter values; `shared` (the page's shared filters) holds the params the page shares
 * with its tabs: they are read from it and written to it.
 */
export function useListState(pageSize = 25, initial: Record<string, string> = {}, shared: SharedFilterState | null = null) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [ownFilters, setFilters] = useState<Record<string, string>>(initial);
  const filters = shared ? { ...ownFilters, ...Object.fromEntries(shared.params.map((k) => [k, shared.values[k] ?? ''])) } : ownFilters;
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      setSearch((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const setFilter = (param: string, value: string) => {
    if (shared && shared.params.includes(param)) shared.set(param, value);
    else setFilters((s) => ({ ...s, [param]: value }));
    setPage(1);
  };
  const toggleSort = (key: string) => {
    setPage(1);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  /** Query parameters of the current filters, without paging (also what an export sends). */
  const params: Record<string, string | undefined> = {
    search: search || undefined,
    ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, v || undefined])),
    sort: sort ? `${sort.key}:${sort.dir}` : undefined,
  };

  return {
    searchInput, setSearchInput, filters, setFilter, sort, toggleSort, page, setPage, params,
    listParams: { ...params, page, pageSize },
  };
}
