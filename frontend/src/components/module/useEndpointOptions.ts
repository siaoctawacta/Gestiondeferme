import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFarmQuery } from '../../lib/query';
import { allPages } from './allPages';
import type { OptionItem, OptionsDef } from './types';

export type Option = OptionItem;

/**
 * The endpoint with its `{field}` placeholder replaced by the parent's (URL-encoded) value. A placeholder must name
 * the select's own `dependsOn` field: anything else is a configuration error and throws (never a request to a
 * literal `{x}` path).
 */
export function resolveEndpointTemplate<T extends { endpoint: string }>(def: T, dependsOn: string | undefined, parentValue: string): T {
  const placeholder = /\{(\w+)\}/.exec(def.endpoint);
  if (!placeholder) return def;
  if (placeholder[1] !== dependsOn) {
    throw new Error(`Endpoint ${def.endpoint}: {${placeholder[1]}} must be the dependsOn field of the select`);
  }
  return { ...def, endpoint: def.endpoint.replace(placeholder[0], encodeURIComponent(parentValue)) };
}

/**
 * Options of a select: static, or every page of an endpoint (cached per farm).
 * `extraParams` are added to the endpoint's own `params` (e.g. the value of a `dependsOn` parent);
 * `enabled: false` skips the request and yields no options. The query key says whether a `select` mapper is used,
 * so two selects on one endpoint (a page list, a mapped record) never share a cache entry.
 */
export function useEndpointOptions(
  def: OptionsDef,
  extraParams?: Record<string, string>,
  enabled = true,
): Option[] {
  const remote = Array.isArray(def) ? null : def;
  const userId = useAuth().user?.id ?? null;
  const params = { ...remote?.params, ...extraParams };
  const mapped = remote?.select;
  // Options mapped by a `select` cache the RAW answer (one request per endpoint, whoever maps it) and map it at render, so
  // two controls on one endpoint (a filter and a select) never overwrite each other's options.
  const raw = useFarmQuery<unknown>(
    [remote?.endpoint ?? '', 'options-raw', params],
    () => api.get<unknown>(remote!.endpoint, params),
    { enabled: mapped !== undefined && enabled },
  );
  const { data } = useFarmQuery<Option[]>(
    [remote?.endpoint ?? '', 'options', remote?.valueKey, remote?.labelKey, params],
    async () =>
      (await allPages<Record<string, unknown>>(remote!.endpoint, params)).map((r) => ({
        value: String(r[remote!.valueKey ?? 'id']),
        label: String(r[remote!.labelKey ?? 'name']),
      })),
    { enabled: remote !== null && mapped === undefined && enabled },
  );
  const fromSelect = mapped && raw.data !== undefined ? mapped(raw.data, { userId }) : undefined;
  return Array.isArray(def) ? def : enabled ? (fromSelect ?? data ?? []) : [];
}
