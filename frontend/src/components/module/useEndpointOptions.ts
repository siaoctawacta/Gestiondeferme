import { api } from '../../lib/api';
import { useFarmQuery } from '../../lib/query';
import { allPages } from './allPages';
import type { OptionsDef } from './types';

export type Option = { value: string; label: string };

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
  const params = { ...remote?.params, ...extraParams };
  const { data } = useFarmQuery<Option[]>(
    [remote?.endpoint ?? '', 'options', remote?.valueKey, remote?.labelKey, params, Boolean(remote?.select)],
    async () =>
      remote!.select ? remote!.select(await api.get<unknown>(remote!.endpoint, params)) : (await allPages<Record<string, unknown>>(remote!.endpoint, params)).map((r) => ({
        value: String(r[remote!.valueKey ?? 'id']),
        label: String(r[remote!.labelKey ?? 'name']),
      })),
    { enabled: remote !== null && enabled },
  );
  return Array.isArray(def) ? def : enabled ? (data ?? []) : [];
}
