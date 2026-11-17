import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Sidebar } from './Sidebar';
import type { Action, ModuleKey, Permissions } from '../../lib/modules';

const KEYS: ModuleKey[] = [
  'dashboard', 'alertes', 'rapports', 'batiments', 'fermes', 'utilisateurs', 'parametres',
  'lots', 'ponte', 'porcs', 'reproduction', 'alimentation', 'sante', 'stocks',
  'fournisseurs', 'achats', 'clients', 'ventes', 'finance', 'taches', 'personnel', 'equipements', 'audit',
];

function perms(readable: ModuleKey[]): Permissions {
  return Object.fromEntries(
    KEYS.map((k) => [k, (readable.includes(k) ? ['read'] : []) as Action[]]),
  ) as Permissions;
}

const agent = perms([
  'dashboard', 'alertes', 'batiments', 'lots', 'ponte', 'porcs', 'reproduction',
  'alimentation', 'sante', 'stocks', 'taches',
]);

function renderSidebar(permissions: Permissions, alertCount = 0) {
  return render(
    <MemoryRouter>
      <Sidebar permissions={permissions} alertCount={alertCount} />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('shows only modules the role can read, and hides empty groups', () => {
    renderSidebar(agent);
    expect(screen.getByText('Lots avicoles')).toBeInTheDocument();
    expect(screen.queryByText('Dépenses & recettes')).not.toBeInTheDocument();
    expect(screen.queryByText('Utilisateurs')).not.toBeInTheDocument();
    expect(screen.queryByText('FINANCE')).not.toBeInTheDocument();
    expect(screen.getByText('PRODUCTION')).toBeInTheDocument();
  });

  it('shows Tâches & personnel to a role that reads personnel only (the accountant)', () => {
    renderSidebar(perms(['dashboard', 'personnel']));
    expect(screen.getByText('Tâches & personnel')).toBeInTheDocument();
    renderSidebar(perms(['dashboard']));
    expect(screen.getAllByText('Tâches & personnel')).toHaveLength(1);
  });

  it('shows the alert count next to Alertes', () => {
    renderSidebar(agent, 14);
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('renders the footer slot', () => {
    render(
      <MemoryRouter>
        <Sidebar permissions={agent} alertCount={0} footer={<div>switcher</div>} />
      </MemoryRouter>,
    );
    expect(screen.getByText('switcher')).toBeInTheDocument();
  });
});
