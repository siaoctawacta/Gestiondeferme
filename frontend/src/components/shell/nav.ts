import {
  Bell, BarChart3, Bird, Egg, HeartPulse, LayoutGrid, MapPin, Package, PiggyBank, Receipt,
  ScrollText, Settings, ShoppingCart, Syringe, Truck, Users, UserCog, Wallet, Warehouse, Wheat,
  ClipboardList, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey, Permissions } from '../../lib/modules';

export interface NavItem {
  slug: ModuleKey;
  label: string;
  to: string;
  icon: LucideIcon;
}
export interface NavGroup {
  group: string | null;
  items: NavItem[];
}

const m = (slug: ModuleKey, label: string, icon: LucideIcon, to = `/m/${slug}`): NavItem => ({
  slug, label, to, icon,
});

export const NAV: NavGroup[] = [
  {
    group: null,
    items: [
      m('dashboard', 'Tableau de bord', LayoutGrid, '/'),
      m('alertes', 'Alertes', Bell, '/alertes'),
      m('rapports', 'Rapports', BarChart3, '/rapports'),
    ],
  },
  {
    group: 'ADMINISTRATION',
    items: [
      m('batiments', 'Bâtiments', Warehouse),
      m('fermes', 'Fermes & sites', MapPin, '/admin/fermes'),
      m('utilisateurs', 'Utilisateurs', UserCog, '/admin/utilisateurs'),
      m('parametres', 'Paramètres', Settings, '/admin/parametres'),
    ],
  },
  {
    group: 'PRODUCTION',
    items: [
      m('lots', 'Lots avicoles', Bird),
      m('ponte', 'Ponte & œufs', Egg),
      m('porcs', 'Cheptel porcin', PiggyBank),
      m('reproduction', 'Reproduction', HeartPulse),
      m('alimentation', 'Alimentation & eau', Wheat),
    ],
  },
  { group: 'SANTÉ', items: [m('sante', 'Santé & biosécurité', Syringe)] },
  { group: 'LOGISTIQUE', items: [m('stocks', 'Stocks', Package)] },
  {
    group: 'COMMERCIAL',
    items: [
      m('fournisseurs', 'Fournisseurs', Truck),
      m('achats', 'Achats', ShoppingCart),
      m('clients', 'Clients', Users),
      m('ventes', 'Ventes', Receipt),
    ],
  },
  { group: 'FINANCE', items: [m('finance', 'Dépenses & recettes', Wallet)] },
  {
    group: 'OPÉRATIONS',
    items: [
      m('taches', 'Tâches & personnel', ClipboardList),
      m('equipements', 'Équipements', Wrench),
    ],
  },
  { group: null, items: [m('audit', "Journal d'audit", ScrollText, '/audit')] },
];

/** Module slug to its sidebar label, for screens that show a module name (alerts, audit). */
export const MODULE_LABEL: ReadonlyMap<string, string> = new Map(
  NAV.flatMap((g) => g.items).map((i) => [i.slug as string, i.label]),
);

/** NAV restricted to modules the role can read; groups left empty are dropped. */
export function visibleNav(permissions: Permissions): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => permissions[i.slug]?.includes('read')),
  })).filter((g) => g.items.length > 0);
}
