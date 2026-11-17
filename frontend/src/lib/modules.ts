export type ModuleKey =
  | 'dashboard' | 'alertes' | 'rapports' | 'batiments' | 'fermes' | 'utilisateurs'
  | 'parametres' | 'lots' | 'ponte' | 'porcs' | 'reproduction' | 'alimentation'
  | 'sante' | 'stocks' | 'fournisseurs' | 'achats' | 'clients' | 'ventes'
  | 'finance' | 'taches' | 'personnel' | 'equipements' | 'audit';

export type Action = 'read' | 'create' | 'update' | 'delete' | 'validate';

export type Permissions = Record<ModuleKey, Action[]>;
