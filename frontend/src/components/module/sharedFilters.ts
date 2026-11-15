import { createContext, useContext } from 'react';

/** The filters a page shares with its tabs (see `ModuleConfig.sharedFilters`), as the page holds them. */
export interface SharedFilterState {
  /** The shared params. */
  params: string[];
  /** Their current values. */
  values: Record<string, string>;
  set: (param: string, value: string) => void;
  /** The French message when the values are not acceptable (a start after the end): the lists and tabs read nothing meanwhile. */
  error: string | null;
}

export const SharedFiltersContext = createContext<SharedFilterState | null>(null);

/** The shared filters of the page this tab belongs to (`element` tabs read their period here). */
export function useSharedFilters(): SharedFilterState {
  const state = useContext(SharedFiltersContext);
  if (!state) throw new Error('useSharedFilters: the module page declares no sharedFilters');
  return state;
}
