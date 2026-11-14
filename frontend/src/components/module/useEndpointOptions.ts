import { api } from '../../lib/api';
import { useFarmQuery } from '../../lib/query';
import type { ListResponse, OptionsDef } from './types';

export type Option = { value: string; label: string };

const PAGE_SIZE = 200;

/**
 * Options of a select: static, or every page of an endpoint (cached per farm).
 * `extraParams` are added to the endpoint's own `params` (e.g. the value of a `dependsOn` parent);
 * `enabled: false` skips the request and yields no options.
 */
export function useEndpointOptions(
  def: OptionsDef,
  extraParams?: Record<string, string>,
  enabled = true,
): Option[] {
  const remote = Array.isArray(def) ? null : def;
  const params = { ...remote?.params, ...extraParams };
  const { data } = useFarmQuery<Option[]>(
    [remote?.endpoint ?? '', 'options', remote?.valueKey, remote?.labelKey, params],
    async () => {
      const out: Option[] = [];
      for (let page = 1; ; page++) {
        const res = await api.get<ListResponse<Record<string, unknown>>>(remote!.endpoint, { ...params, page, pageSize: PAGE_SIZE });
        for (const r of res.items) {
          out.push({ value: String(r[remote!.valueKey ?? 'id']), label: String(r[remote!.labelKey ?? 'name']) });
        }
        if (res.items.length === 0 || out.length >= res.total) return out;
      }
    },
    { enabled: remote !== null && enabled },
  );
  return Array.isArray(def) ? def : enabled ? (data ?? []) : [];
}
