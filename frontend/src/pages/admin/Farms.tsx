import { ModulePage } from '../../components/module/ModulePage';
import type { ModuleConfig } from '../../components/module/types';
import { Pill } from '../../components/ui/Pill';

interface Farm {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
  sites: number;
  buildings: number;
}

interface Site {
  id: string;
  name: string;
  buildings: number;
}

const sites: ModuleConfig<Site> = {
  slug: 'batiments',
  group: 'Administration',
  title: 'Sites',
  subtitle: 'Sites de la ferme active.',
  endpoint: '/sites',
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'buildings', header: 'BÂTIMENTS' },
  ],
  fields: [{ name: 'name', label: 'Nom', type: 'text', required: true }],
};

const farms: ModuleConfig<Farm> = {
  slug: 'fermes',
  group: 'Administration',
  title: 'Fermes',
  subtitle: 'Fermes de l’organisation et sites associés.',
  endpoint: '/farms',
  farmScoped: false,
  columns: [
    { key: 'name', header: 'NOM', sortable: true },
    { key: 'location', header: 'LIEU', sortable: true, render: (f) => f.location || '—' },
    { key: 'sites', header: 'SITES' },
    { key: 'buildings', header: 'BÂTIMENTS' },
    {
      key: 'active',
      header: 'STATUT',
      sortable: true,
      render: (f) => <Pill tone={f.active ? 'success' : 'neutral'}>{f.active ? 'Active' : 'Inactive'}</Pill>,
    },
  ],
  fields: [
    { name: 'name', label: 'Nom', type: 'text', required: true },
    { name: 'location', label: 'Lieu', type: 'text' },
    { name: 'active', label: 'Ferme active', type: 'checkbox', defaultValue: true },
  ],
  tabs: [{ key: 'sites', label: 'Sites', config: sites }],
};

export default function Farms() {
  return <ModulePage config={farms} />;
}
