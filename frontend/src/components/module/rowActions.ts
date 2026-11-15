import type { Action, ModuleKey } from '../../lib/modules';

/**
 * Whether an extra action (a `RowAction`, or the same transition shown as a button on a detail page) is offered:
 * the user holds its `permission` on `slug` (default `update`), and, for anything but `read`, writes are possible
 * (`writable` is false under "all farms" for farm-owned data). THE gate of `ModulePage`'s row actions; a detail page
 * uses it too so its buttons and the list's icons never disagree.
 */
export function canRunAction(
  permission: Action | undefined, slug: ModuleKey, can: (module: ModuleKey, action: Action) => boolean, writable: boolean,
): boolean {
  const needed = permission ?? 'update';
  return can(slug, needed) && (needed === 'read' || writable);
}
