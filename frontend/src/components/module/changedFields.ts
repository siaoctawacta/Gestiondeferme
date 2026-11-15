type Values = Record<string, unknown>;

const isEmpty = (v: unknown) => v === '' || v === undefined;

/**
 * The write semantics of an edit, shared by every form: the keys of `after` whose value differs from `before`;
 * a value that was set and is now empty (`''`, `undefined`) or gone is sent as `null`, so the API clears it.
 */
export function changedFields(before: Values, after: Values): Values {
  const out: Values = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = isEmpty(before[key]) ? undefined : before[key];
    const now = isEmpty(after[key]) ? undefined : after[key];
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    out[key] = now === undefined ? null : now;
  }
  return out;
}
