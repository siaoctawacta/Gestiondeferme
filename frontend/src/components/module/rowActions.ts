import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Action, ModuleKey } from '../../lib/modules';
import type { RowAction } from './types';

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

/**
 * A workflow action defined once for a list row AND a detail page (a purchase's validate, an invoice's issue): the
 * dialog is `Dialog`, `visible` sees the record (a list row or the detail both fit).
 */
export interface SharedActionDef<R> {
  key: string;
  label: string;
  icon: LucideIcon;
  permission: Action;
  visible: (record: R) => boolean;
  Dialog: ComponentType<{ row: R; onClose: () => void; onDone: () => void }>;
}

/** THE adapter from the shared action definitions to the `actions` of a `ModuleConfig`. */
export const toRowActions = <T,>(defs: SharedActionDef<T>[]): RowAction<T>[] =>
  defs.map((a) => ({ key: a.key, label: a.label, icon: a.icon, permission: a.permission, visible: a.visible, dialog: a.Dialog }));
