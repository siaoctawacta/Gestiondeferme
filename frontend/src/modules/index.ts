import type { ModuleConfig } from '../components/module/types';
import type { ModuleKey } from '../lib/modules';
import { batiments } from './batiments';

/** Module pages built on the ModulePage kit; later slices add their configs here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MODULES: Partial<Record<ModuleKey, ModuleConfig<any>>> = {
  batiments,
};
