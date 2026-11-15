import { achats } from './achats';
import { alimentation } from './alimentation';
import { batiments } from './batiments';
import { clients } from './clients';
import { fournisseurs } from './fournisseurs';
import { lots } from './lots';
import { ponte } from './ponte';
import { porcs } from './porcs';
import { reproduction } from './reproduction';
import { MODULES, registerModule } from './registry';
import { sante } from './sante';
import { stocks } from './stocks';

/** Module pages built on the ModulePage kit; later slices register their configs here. */
registerModule(batiments);
registerModule(lots);
registerModule(ponte);
registerModule(porcs);
registerModule(reproduction);
registerModule(alimentation);
registerModule(stocks);
registerModule(fournisseurs);
registerModule(achats);
registerModule(sante);
registerModule(clients);

export { MODULES };
