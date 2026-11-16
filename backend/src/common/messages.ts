/** Messages shared by several modules, so the same condition reads the same everywhere. */

/** A unique (target, date) record already exists: egg production, water. */
export const DUPLICATE = 'Un enregistrement existe déjà pour cette date';

/** The animal has left the herd (sold, dead or culled). */
export const EXITED = 'Cet animal est sorti du cheptel';

/** A write that needs one farm was sent without a farm selected (or under `all`). */
export const SELECT_FARM = 'Sélectionnez une ferme';
