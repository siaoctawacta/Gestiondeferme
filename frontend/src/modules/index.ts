import { batiments } from './batiments';
import { lots } from './lots';
import { ponte } from './ponte';
import { porcs } from './porcs';
import { reproduction } from './reproduction';
import { MODULES, registerModule } from './registry';

/** Module pages built on the ModulePage kit; later slices register their configs here. */
registerModule(batiments);
registerModule(lots);
registerModule(ponte);
registerModule(porcs);
registerModule(reproduction);

export { MODULES };
