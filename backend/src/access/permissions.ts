import { Role } from './roles';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'validate';

/**
 * Production modules (lots, ponte, porcs, reproduction, alimentation) have two
 * kinds of writes, whatever the HTTP verb:
 *
 * - MASTER data defines what exists: lots, animals, incubations, breeding
 *   records, feed products and formulas, breeds. Creating, changing, deleting,
 *   closing, moving or exiting one needs `update` on the module, so a field
 *   agent (read, create) cannot create or change it.
 * - DAILY operations record what happened: batch events, weighings, heats, egg
 *   records, feed distributions, water. Entering one, and correcting or
 *   deleting it, needs `create` ("entries can be edited or deleted by the roles
 *   that may create them").
 *
 * Routes state it with `@RequireMaster(module)` / `@RequireDaily(module)`;
 * handlers whose module depends on the request (species) call
 * `AccessService.assertMaster` / `assertDaily`.
 */
export const MASTER_WRITE: Action = 'update';
export const DAILY_WRITE: Action = 'create';

export const ALL_MODULES = [
  'dashboard',
  'alertes',
  'rapports',
  'batiments',
  'fermes',
  'utilisateurs',
  'parametres',
  'lots',
  'ponte',
  'porcs',
  'reproduction',
  'alimentation',
  'sante',
  'stocks',
  'fournisseurs',
  'achats',
  'clients',
  'ventes',
  'finance',
  'taches',
  'equipements',
  'audit',
] as const;

export type ModuleKey = (typeof ALL_MODULES)[number];

const R: Action[] = ['read'];
const W: Action[] = ['read', 'create', 'update', 'delete'];
const V: Action[] = [...W, 'validate'];

type Grants = Partial<Record<ModuleKey, Action[]>>;

function grant(actions: Action[], modules: ModuleKey[]): Grants {
  return Object.fromEntries(modules.map((m) => [m, actions]));
}

const everyModule = (actions: Action[]): Grants =>
  grant(actions, [...ALL_MODULES]);

const ROLE_GRANTS: Record<Role, Grants> = {
  SUPER_ADMIN: everyModule(V),
  PROPRIETAIRE: {
    ...everyModule(R),
    achats: ['read', 'validate'],
    rapports: V,
    finance: R,
  },
  DIRECTEUR_FERME: {
    ...grant(V, [
      'batiments',
      'lots',
      'ponte',
      'porcs',
      'reproduction',
      'alimentation',
      'sante',
      'stocks',
      'fournisseurs',
      'achats',
      'taches',
      'equipements',
    ]),
    ...grant(R, ['clients', 'ventes', 'finance', 'rapports', 'audit']),
  },
  RESP_AVICOLE: {
    ...grant(W, ['lots', 'ponte', 'alimentation', 'sante', 'taches']),
    ...grant(R, ['batiments', 'stocks', 'rapports']),
  },
  RESP_PORCIN: {
    ...grant(W, ['porcs', 'reproduction', 'alimentation', 'sante', 'taches']),
    ...grant(R, ['batiments', 'stocks', 'rapports']),
  },
  VETERINAIRE: {
    ...grant(W, ['sante']),
    ...grant(R, [
      'lots',
      'ponte',
      'porcs',
      'reproduction',
      'alimentation',
      'stocks',
      'batiments',
      'rapports',
    ]),
  },
  RESP_STOCK: {
    // The stock manager validates his own inventories (the design's role table).
    ...grant(V, ['stocks']),
    ...grant(W, ['fournisseurs']),
    achats: ['read', 'create', 'update'],
    ...grant(R, ['alimentation', 'rapports']),
  },
  COMPTABLE: {
    ...grant(W, ['finance']),
    ...grant(R, ['ventes', 'achats', 'clients', 'fournisseurs', 'rapports']),
  },
  COMMERCIAL: {
    ...grant(W, ['clients', 'ventes']),
    ...grant(R, ['stocks', 'lots', 'porcs', 'rapports']),
  },
  AGENT_ELEVAGE: {
    ...grant(
      ['read', 'create'],
      ['lots', 'ponte', 'porcs', 'alimentation', 'sante'],
    ),
    taches: ['read', 'update'],
    batiments: R,
  },
  MAGASINIER: {
    stocks: ['read', 'create'],
    achats: ['read', 'update'],
    fournisseurs: R,
  },
  AUDITEUR: everyModule(R),
};

/** Modules whose writes belong to SUPER_ADMIN alone, whatever a role's row says. */
const SUPER_ADMIN_WRITE_MODULES: ModuleKey[] = [
  'fermes',
  'utilisateurs',
  'parametres',
];
const READ_ONLY_OVERRIDE_ROLES: Role[] = ['PROPRIETAIRE', 'AUDITEUR'];

function actionsFor(role: Role, module: ModuleKey): Action[] {
  if (SUPER_ADMIN_WRITE_MODULES.includes(module)) {
    if (role === 'SUPER_ADMIN') return V;
    return READ_ONLY_OVERRIDE_ROLES.includes(role) ? R : [];
  }
  if (module === 'audit') {
    // The audit log is immutable: read-only for every role, SUPER_ADMIN included.
    return ROLE_GRANTS[role].audit?.includes('read') ? R : [];
  }
  if (module === 'dashboard' || module === 'alertes') {
    return ROLE_GRANTS[role][module] ?? R;
  }
  return ROLE_GRANTS[role][module] ?? [];
}

export function can(role: Role, module: ModuleKey, action: Action): boolean {
  return actionsFor(role, module).includes(action);
}

export function permissionsFor(role: Role): Record<ModuleKey, Action[]> {
  return Object.fromEntries(
    ALL_MODULES.map((m) => [m, [...actionsFor(role, m)]]),
  ) as Record<ModuleKey, Action[]>;
}
