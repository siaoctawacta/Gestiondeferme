import { batiments } from './batiments';
import { lots } from './lots';
import { MODULES, registerModule } from './registry';

/** Module pages built on the ModulePage kit; later slices register their configs here. */
registerModule(batiments);
registerModule(lots);

export { MODULES };
