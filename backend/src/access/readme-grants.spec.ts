import { readFileSync } from 'fs';
import { join } from 'path';
import { permissionsFor, type Action, type ModuleKey } from './permissions';
import type { Role } from './roles';

/** The columns of the README table, in its order, with their headers. */
const ROLES: [Role, string][] = [
  ['SUPER_ADMIN', 'Super admin'],
  ['PROPRIETAIRE', 'Propriétaire'],
  ['DIRECTEUR_FERME', 'Directeur'],
  ['RESP_AVICOLE', 'Resp. avicole'],
  ['RESP_PORCIN', 'Resp. porcin'],
  ['VETERINAIRE', 'Vétérinaire'],
  ['RESP_STOCK', 'Resp. stock'],
  ['COMPTABLE', 'Comptable'],
  ['COMMERCIAL', 'Commercial'],
  ['AGENT_ELEVAGE', 'Agent'],
  ['MAGASINIER', 'Magasinier'],
  ['AUDITEUR', 'Auditeur'],
];

/** The rows of the README table, in its order, with their labels. */
const MODULES: [ModuleKey, string][] = [
  ['dashboard', 'Tableau de bord'],
  ['alertes', 'Alertes'],
  ['rapports', 'Rapports'],
  ['batiments', 'Bâtiments'],
  ['fermes', 'Fermes & sites'],
  ['utilisateurs', 'Utilisateurs'],
  ['parametres', 'Paramètres'],
  ['lots', 'Lots avicoles'],
  ['ponte', 'Ponte & œufs'],
  ['porcs', 'Cheptel porcin'],
  ['reproduction', 'Reproduction'],
  ['alimentation', 'Alimentation & eau'],
  ['sante', 'Santé & biosécurité'],
  ['stocks', 'Stocks'],
  ['fournisseurs', 'Fournisseurs'],
  ['achats', 'Achats'],
  ['clients', 'Clients'],
  ['ventes', 'Ventes'],
  ['finance', 'Finance (dépenses & recettes)'],
  ['taches', 'Tâches'],
  ['equipements', 'Équipements'],
  ['personnel', 'Personnel (employés, présences)'],
  ['audit', "Journal d'audit"],
];

/** `L` lire, `C` saisir, `M` modifier, `S` supprimer, `V` valider; `·` for no right. */
const LETTERS: [Action, string][] = [
  ['read', 'L'],
  ['create', 'C'],
  ['update', 'M'],
  ['delete', 'S'],
  ['validate', 'V'],
];

const cell = (actions: Action[]): string =>
  LETTERS.filter(([a]) => actions.includes(a))
    .map(([, letter]) => letter)
    .join('') || '·';

/** The table as the README writes it, rendered from `permissionsFor`. */
export function renderGrantsTable(): string {
  const grants = ROLES.map(([role]) => permissionsFor(role));
  return [
    `| Module | ${ROLES.map(([, label]) => label).join(' | ')} |`,
    `|${'---|'.repeat(ROLES.length + 1)}`,
    ...MODULES.map(
      ([module, label]) =>
        `| ${label} | ${grants.map((g) => cell(g[module])).join(' | ')} |`,
    ),
  ].join('\n');
}

const START = '<!-- grants:start -->';
const END = '<!-- grants:end -->';

describe('README grants table', () => {
  const readme = readFileSync(join(__dirname, '../../../README.md'), 'utf8');

  it('covers every module and every role of the code', () => {
    expect(MODULES.map(([m]) => m).sort()).toEqual(
      Object.keys(permissionsFor('SUPER_ADMIN')).sort(),
    );
  });

  it('is the table `permissionsFor` renders, cell for cell', () => {
    const from = readme.indexOf(START);
    const to = readme.indexOf(END);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const documented = readme.slice(from + START.length, to).trim();
    expect(documented.split('\n')).toEqual(renderGrantsTable().split('\n'));
  });
});
