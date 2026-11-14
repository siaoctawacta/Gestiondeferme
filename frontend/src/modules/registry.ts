import type { ModuleConfig } from '../components/module/types';
import type { ModuleKey } from '../lib/modules';

/**
 * Module pages built on the ModulePage kit. A leaf file (it imports no module config), so screens that need
 * to look at other modules (e.g. a detail page embedding the Alimentation list) can import it without a cycle.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MODULES: Partial<Record<ModuleKey, ModuleConfig<any>>> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerModule(config: ModuleConfig<any>): void {
  MODULES[config.slug] = config;
}
