import { useFarmQuery } from '../../lib/query';
import { allPages } from './allPages';
import type { OptionsDef } from './types';

export type Option = { value: string; label: string };

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
    async () =>
      (await allPages<Record<string, unknown>>(remote!.endpoint, params)).map((r) => ({
        value: String(r[remote!.valueKey ?? 'id']),
        label: String(r[remote!.labelKey ?? 'name']),
      })),
    { enabled: remote !== null && enabled },
  );
  return Array.isArray(def) ? def : enabled ? (data ?? []) : [];
}
