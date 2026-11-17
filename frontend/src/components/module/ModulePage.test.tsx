import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { Eye } from 'lucide-react';
import { api } from '../../lib/api';
import { batiments as batimentsConfig, type Building } from '../../modules/batiments';
import type { ModuleConfig } from './types';
import { ModuleList, ModulePage } from './ModulePage';

// The kit tests start from a list without a QR code (the batiments config has one): the QR tests add it.
const batiments: ModuleConfig<Building> = { ...batimentsConfig, qr: undefined };

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];
const BUILDINGS = [
  { id: 'b1', name: 'Poulailler A', type: 'AVICOLE', siteId: 's1', siteName: 'Site Nord', capacity: 5000, occupation: 4820, occupationRate: 96, status: 'ACTIF', zones: 2 },
  { id: 'b2', name: 'Porcherie 2', type: 'PORCIN', siteId: 's2', siteName: 'Site Sud', capacity: 300, occupation: 0, occupationRate: 0, status: 'VIDE_SANITAIRE', zones: 0 },
];
const LIST = {
  items: BUILDINGS, total: 6, page: 1, pageSize: 25,
  statusCounts: { ACTIF: 5, VIDE_SANITAIRE: 1, MAINTENANCE: 0 },
};

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();
let handler: (c: Call) => Response | undefined;

function setup({ perms = ALL, farm, config = batiments, list = false, scope, readOnly }: { perms?: string[]; farm?: string; config?: ModuleConfig<Building>; list?: boolean; scope?: Record<string, string>; readOnly?: boolean | string } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  handler = () => undefined;
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, {
        user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true,
        permissions: { batiments: perms },
      });
    }
    const custom = handler(call);
    if (custom) return custom;
    if (call.url.startsWith('/api/sites')) return json(200, { items: [{ id: 's1', name: 'Site Nord' }, { id: 's2', name: 'Site Sud' }], total: 2, page: 1, pageSize: 200 });
    if (call.url.startsWith('/api/buildings') && call.method === 'GET') return json(200, LIST);
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>
          {list ? <ModuleList config={config} scope={scope} readOnly={readOnly} /> : <ModulePage config={config} />}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const listCalls = () => calls.filter((c) => c.method === 'GET' && c.url.startsWith('/api/buildings'));

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('ModulePage with the batiments config', () => {
  it('renders the headers, a row and the stat tiles', async () => {
    setup();
    expect(await screen.findByText('Poulailler A')).toBeInTheDocument();
    for (const h of ['NOM', 'TYPE', 'SITE', 'CAPACITÉ', 'OCCUPATION', 'STATUT', 'TAUX OCC.']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${h.replace('.', '\\.')}`, 'i') })).toBeInTheDocument();
    }
    expect(screen.getByText('Total enregistrements').nextElementSibling).toHaveTextContent('6');
    expect(screen.getByText('Actif', { selector: 'p' }).nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText('Vide sanitaire', { selector: 'p' }).nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Avicole')).toBeInTheDocument();
    expect(screen.getByText('96%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Précédent/ })).not.toBeInTheDocument();
  });

  it('requests the search term after the debounce', async () => {
    setup();
    await screen.findByText('Poulailler A');
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'poul');
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('search=poul'))).toBe(true));
    expect(listCalls().filter((c) => c.url.includes('search=')).length).toBe(1);
  });

  it('requests the chosen status', async () => {
    setup();
    await screen.findByText('Poulailler A');
    await userEvent.setup().selectOptions(screen.getByLabelText('Tous les statuts'), 'Maintenance');
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('status=MAINTENANCE'))).toBe(true));
  });

  it('toggles the sort direction from a sortable header', async () => {
    setup();
    await screen.findByText('Poulailler A');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^NOM/i }));
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('sort=name%3Aasc'))).toBe(true));
    await user.click(screen.getByRole('button', { name: /^NOM/i }));
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('sort=name%3Adesc'))).toBe(true));
  });

  it('creates a record, then refetches the list', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.method === 'POST' ? json(201, { id: 'b3' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Bâtiments' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Poulailler D');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Avicole');
    await user.selectOptions(await within(dialog).findByLabelText('Site'), 'Site Nord');
    await user.type(within(dialog).getByLabelText('Capacité'), '1200');
    const before = listCalls().length;
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/buildings')).toMatchObject({
      url: '/api/buildings',
      body: { name: 'Poulailler D', type: 'AVICOLE', siteId: 's1', capacity: 1200, status: 'ACTIF' },
    });
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it('keeps the dialog open and shows the server message on a 409', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.method === 'POST' ? json(409, { message: 'Ce nom existe déjà' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nom'), 'Poulailler A');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Avicole');
    await user.selectOptions(await within(dialog).findByLabelText('Site'), 'Site Nord');
    await user.type(within(dialog).getByLabelText('Capacité'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Ce nom existe déjà')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('edits a record with a PATCH prefilled from the row', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.method === 'PATCH' ? json(200, {}) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Modifier' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Bâtiments' });
    const name = within(dialog).getByLabelText('Nom');
    expect(name).toHaveValue('Poulailler A');
    await user.clear(name);
    await user.type(name, 'Poulailler Z');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/buildings/b1',
    });
    // Only what changed is sent.
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Poulailler Z' });
  });

  it('hides every write control without the matching permission', async () => {
    setup({ perms: ['read'] });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exporter' })).toBeInTheDocument();
  });

  it('hides the export control when the config is not exportable', async () => {
    setup({ config: { ...batiments, exportable: false } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Exporter' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
  });

  it('hides writes and explains why when all farms are selected', async () => {
    setup({ farm: 'all' });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.getByText('Sélectionnez une ferme pour modifier les données.')).toBeInTheDocument();
  });

  it('asks before deleting and shows the server message on a 409', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.method === 'DELETE' ? json(409, { message: 'Ce bâtiment contient des lots actifs' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Supprimer « Poulailler A » ? Cette action est irréversible.');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(await within(dialog).findByText('Ce bâtiment contient des lots actifs')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/buildings/b1');
  });

  it('shows an error with a retry button when the list fails', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.method === 'GET' && c.url.startsWith('/api/buildings') && c.url.includes('search=') ? json(500, { message: 'Erreur serveur' }) : undefined);
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'x');
    expect(await screen.findByText('Erreur serveur')).toBeInTheDocument();
    handler = () => undefined;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Poulailler A')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.url.startsWith('/api/buildings') && c.method === 'GET' ? json(200, { ...LIST, items: [], total: 0 }) : undefined);
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'zzz');
    expect(await screen.findByText('Aucun enregistrement')).toBeInTheDocument();
  });

  it('paginates only when the total exceeds the page size', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.url.startsWith('/api/buildings') && c.method === 'GET' ? json(200, { ...LIST, total: 60 }) : undefined);
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'p');
    expect(await screen.findByText('Page 1 sur 3')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Suivant' }));
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('page=2'))).toBe(true));
  });

  it('exports the current list as CSV or Excel through api.download', async () => {
    const download = vi.spyOn(api, 'download').mockResolvedValue();
    setup();
    await screen.findByText('Poulailler A');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Exporter' }));
    await user.click(screen.getByRole('menuitem', { name: 'CSV' }));
    await user.click(screen.getByRole('button', { name: 'Exporter' }));
    await user.click(screen.getByRole('menuitem', { name: 'Excel' }));
    expect(download).toHaveBeenNthCalledWith(1, '/buildings', expect.objectContaining({ format: 'csv' }), 'batiments.csv');
    expect(download).toHaveBeenNthCalledWith(2, '/buildings', expect.objectContaining({ format: 'xlsx' }), 'batiments.xlsx');
    download.mockRestore();
  });

  it('shows the QR button only when the config asks for it', async () => {
    setup();
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'QR code' })).not.toBeInTheDocument();
  });

  it('shows the QR button on every row when config.qr is a kind, and on the rows the function names', async () => {
    setup({ config: { ...batiments, qr: 'batiment' } });
    expect(await screen.findAllByRole('button', { name: 'QR code' })).toHaveLength(2);
    cleanup();
    setup({ config: { ...batiments, qr: (b) => (b.id === 'b1' ? 'batiment' : null) } });
    await screen.findByText('Poulailler A');
    expect(screen.getAllByRole('button', { name: 'QR code' })).toHaveLength(1);
    expect(within(screen.getByText('Porcherie 2').closest('tr')!).queryByRole('button', { name: 'QR code' })).toBeNull();
  });

  it('renders the second tab with its own list', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.url.startsWith('/api/zones')
      ? json(200, { items: [{ id: 'z1', name: 'Zone Nord', buildingId: 'b1', buildingName: 'Poulailler A', capacity: 100 }], total: 1, page: 1, pageSize: 25 })
      : undefined);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Zones' }));
    expect(await screen.findByText('Zone Nord')).toBeInTheDocument();
    expect(screen.queryByText('Total enregistrements')).not.toBeInTheDocument();
  });

  it('keeps the unfiltered total tile while a search narrows the list', async () => {
    const plain: ModuleConfig<Building> = { ...batiments, statuses: undefined, statusKey: undefined, tabs: undefined };
    setup({ config: plain });
    handler = (c) => {
      if (!c.url.startsWith('/api/buildings') || c.method !== 'GET') return undefined;
      const narrowed = c.url.includes('search=');
      return json(200, { items: BUILDINGS.slice(0, narrowed ? 1 : 2), total: narrowed ? 1 : 6, page: 1, pageSize: c.url.includes('pageSize=1&') || c.url.endsWith('pageSize=1') ? 1 : 25 });
    };
    await screen.findByText('Poulailler A');
    await waitFor(() => expect(screen.getByText('Total enregistrements').nextElementSibling).toHaveTextContent('6'));
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'poul');
    await waitFor(() => expect(screen.queryByText('Porcherie 2')).not.toBeInTheDocument());
    expect(screen.getByText('Total enregistrements').nextElementSibling).toHaveTextContent('6');
    expect(screen.queryByText('Vide sanitaire', { selector: 'p' })).not.toBeInTheDocument();
  });

  it('keeps the previous rows visible while the next search loads', async () => {
    setup();
    await screen.findByText('Poulailler A');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    fetchMock.mockImplementationOnce(async () => { await gate; return json(200, LIST); });
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'p');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.getByText('Poulailler A')).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton-row')).not.toBeInTheDocument();
    release();
  });

  it('runs a custom row action with the row', async () => {
    const run = vi.fn();
    setup({ config: { ...batiments, actions: [{ key: 'view', label: 'Voir détail', icon: Eye, run }] } });
    await screen.findByText('Poulailler A');
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Voir détail' })[0]);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), expect.objectContaining({ refresh: expect.any(Function), notify: expect.any(Function) }));
  });

  it('goes back a page when the last row of the last page is deleted', async () => {
    setup();
    await screen.findByText('Poulailler A');
    handler = (c) => (c.url.startsWith('/api/buildings') && c.method === 'GET'
      ? json(200, c.url.includes('page=2') ? { ...LIST, items: [], total: 25 } : { ...LIST, total: 26 })
      : undefined);
    await userEvent.setup().type(screen.getByPlaceholderText('Rechercher…'), 'p');
    await screen.findByText('Page 1 sur 2');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Suivant' }));
    await waitFor(() => expect(screen.queryByText('Page 2 sur 2')).not.toBeInTheDocument());
    await waitFor(() => expect(listCalls().filter((c) => c.url.includes('page=1')).length).toBeGreaterThan(1));
  });
});

describe('ModulePage keyboard accessibility', () => {
  it('exposes the tabs as a tablist with arrow-key navigation and a labelled tabpanel', async () => {
    setup();
    await screen.findByText('Poulailler A');
    const user = userEvent.setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Bâtiments', 'Zones']);
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')[1]).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', screen.getAllByRole('tab')[1].id);
    await user.keyboard('{Home}');
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves focus into the export menu, walks it with arrows, and Escape restores focus', async () => {
    setup();
    await screen.findByText('Poulailler A');
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Exporter' });
    await user.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('ModulePage kit extensions', () => {
  it('links the first cell to the detail route when the config has a detail view', async () => {
    setup({ config: { ...batiments, detail: () => null } });
    expect(await screen.findByRole('link', { name: 'Poulailler A' })).toHaveAttribute('href', '/m/batiments/b1');
  });

  it('hides the edit button per row but keeps delete with canEdit / canDelete', async () => {
    setup({ config: { ...batiments, canEdit: () => false, canDelete: () => true } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(2);
  });

  it('hides the delete button for the rows canDelete refuses', async () => {
    setup({ config: { ...batiments, canDelete: (b) => b.id === 'b2' } });
    await screen.findByText('Poulailler A');
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Modifier' })).toHaveLength(2);
  });

  it('keeps the icon of a refused row visible but disabled, with the reason as tooltip, and does not act on click', async () => {
    setup({ config: { ...batiments, canEdit: (b) => (b.id === 'b1' ? true : 'Raison de blocage'), canDelete: (b) => (b.id === 'b1' ? false : 'Bâtiment occupé') } });
    await screen.findByText('Poulailler A');
    const first = screen.getByText('Poulailler A').closest('tr')!;
    const second = screen.getByText('Porcherie 2').closest('tr')!;
    // `false` hides, `true` shows, a string disables.
    expect(within(first).queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    const edit = within(second).getByRole('button', { name: 'Modifier' });
    expect(edit).toHaveAttribute('aria-disabled', 'true');
    expect(edit).toHaveAttribute('title', 'Raison de blocage');
    expect(within(second).getByRole('button', { name: 'Supprimer' })).toHaveAttribute('title', 'Bâtiment occupé');
    const user = userEvent.setup();
    await user.click(edit);
    await user.click(within(second).getByRole('button', { name: 'Supprimer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the icons of a refused row only with the permission, and never under all farms', async () => {
    setup({ perms: ['read'], config: { ...batiments, canEdit: () => 'Raison' } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
  });

  it('gates the built-in edit and delete icons on update and delete by default', async () => {
    setup({ perms: ['read', 'create'] });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('gates the icons on editPermission and deletePermission when set, whatever update and delete say', async () => {
    const daily = { ...batiments, editPermission: 'create', deletePermission: 'create' } as const;
    setup({ perms: ['read', 'create'], config: daily });
    await screen.findByText('Poulailler A');
    expect(screen.getAllByRole('button', { name: 'Modifier' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(2);
  });

  it('keeps editPermission and deletePermission independent, and the row gates on top', async () => {
    setup({
      perms: ['read', 'create'],
      config: { ...batiments, editPermission: 'create', canEdit: (b) => b.id === 'b1' },
    });
    await screen.findByText('Poulailler A');
    expect(screen.getAllByRole('button', { name: 'Modifier' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('never shows the icons under all farms, whatever the permission named', async () => {
    setup({ perms: ['read', 'create'], farm: 'all', config: { ...batiments, editPermission: 'create', deletePermission: 'create' } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('shows Ajouter on the permission named by createPermission (default create)', async () => {
    setup({ perms: ['read', 'create'], config: { ...batiments, createPermission: 'update' } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });

  it('shows Ajouter with update permission alone when createPermission is update', async () => {
    setup({ perms: ['read', 'update'], config: { ...batiments, createPermission: 'update' } });
    await screen.findByText('Poulailler A');
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
  });

  it('renders a custom form instead of the generated dialog and refetches on save', async () => {
    const form: NonNullable<ModuleConfig<Building>['form']> = ({ row, onSaved, onClose }) => (
      <div role="dialog" aria-label="Formulaire perso">
        <span>{row ? `edition ${row.name}` : 'creation'}</span>
        <button onClick={onSaved}>Valider</button>
        <button onClick={onClose}>Fermer</button>
      </div>
    );
    setup({ config: { ...batiments, fields: undefined, form } });
    await screen.findByText('Poulailler A');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByRole('dialog', { name: 'Formulaire perso' })).toHaveTextContent('creation');
    expect(screen.queryByRole('dialog', { name: 'Ajouter — Bâtiments' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Modifier' })[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('edition Poulailler A');
    const before = listCalls().length;
    await user.click(screen.getByRole('button', { name: 'Valider' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it('sends the scope with the list request, the count request and create payloads, without showing it as a filter', async () => {
    setup({ config: { ...batiments, scope: { batchId: 'b1' } } });
    await screen.findByText('Poulailler A');
    expect(listCalls().every((c) => c.url.includes('batchId=b1'))).toBe(true);
    expect(screen.queryByLabelText('batchId')).not.toBeInTheDocument();
    handler = (c) => (c.method === 'POST' ? json(201, { id: 'b3' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nom'), 'Poulailler D');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Avicole');
    await user.selectOptions(await within(dialog).findByLabelText('Site'), 'Site Nord');
    await user.type(within(dialog).getByLabelText('Capacité'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/buildings')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/buildings')?.body).toMatchObject({ name: 'Poulailler D', batchId: 'b1' });
  });

  it('ModuleList takes the scope as a prop and renders the list without page header or tiles', async () => {
    setup({ list: true, scope: { buildingId: 'b9' } });
    expect(await screen.findByText('Poulailler A')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText('Total enregistrements')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
    expect(listCalls().every((c) => c.url.includes('buildingId=b9'))).toBe(true);
  });

  it('ModuleConfig.noCreate hides Ajouter only: on the page and in a list, the rows keep their icons', async () => {
    setup({ config: { ...batiments, noCreate: true } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(within(screen.getByText('Poulailler A').closest('tr')!).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    cleanup();
    setup({ list: true, config: { ...batiments, noCreate: true } });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });

  describe('a read-only list (closed lot, exited animal)', () => {
    const run = vi.fn();
    const withGates = (whenReadOnly?: ModuleConfig<Building>['whenReadOnly']): ModuleConfig<Building> => ({
      ...batiments,
      actions: [
        { key: 'view', label: 'Voir détail', icon: Eye, run },
        { key: 'close', label: 'Clore', icon: Eye, run },
      ],
      whenReadOnly,
    });
    const names = (row: string) => within(screen.getByText(row).closest('tr')!).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);

    it('hides every write control when the config lets nothing through', async () => {
      setup({ list: true, readOnly: true, config: withGates() });
      await screen.findByText('Poulailler A');
      expect(names('Poulailler A')).toEqual([]);
      expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    });

    it('keeps only the actions and the deletions the config names, row by row', async () => {
      setup({ list: true, readOnly: true, config: withGates({ actions: { close: (b) => b.id === 'b1' }, canDelete: (b) => b.id === 'b2' }) });
      await screen.findByText('Poulailler A');
      expect(names('Poulailler A')).toEqual(['Clore']);
      expect(names('Porcherie 2')).toEqual(['Supprimer']);
      expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
      await userEvent.setup().click(within(screen.getByText('Porcherie 2').closest('tr')!).getByRole('button', { name: 'Supprimer' }));
      await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/buildings/b2')).toBe(true));
    });

    it('still asks for the permission', async () => {
      setup({ list: true, readOnly: true, perms: ['read'], config: withGates({ actions: { close: () => true }, canDelete: () => true }) });
      await screen.findByText('Poulailler A');
      expect(names('Poulailler A')).toEqual([]);
    });

    it('never works under all farms, whatever the gates let through', async () => {
      setup({ list: true, readOnly: true, farm: 'all', config: withGates({ actions: { close: () => true }, canDelete: () => true }) });
      await screen.findByText('Poulailler A');
      expect(names('Poulailler A')).toEqual([]);
      expect(names('Porcherie 2')).toEqual([]);
    });

    it('needs the row action to be visible as well as let through', async () => {
      const config = withGates({ actions: { close: () => true }, canDelete: () => false });
      config.actions = [{ key: 'close', label: 'Clore', icon: Eye, run, visible: (b) => b.id === 'b2' }];
      setup({ list: true, readOnly: true, config });
      await screen.findByText('Poulailler A');
      expect(names('Poulailler A')).toEqual([]);
      expect(names('Porcherie 2')).toEqual(['Clore']);
    });
  });

  describe('a read-only list with a reason (closed lot, exited animal)', () => {
    const run = vi.fn();
    const REASON = 'Lot clôturé';
    const withGates = (whenReadOnly?: ModuleConfig<Building>['whenReadOnly']): ModuleConfig<Building> => ({
      ...batiments,
      actions: [
        { key: 'view', label: 'Voir détail', icon: Eye, run },
        { key: 'close', label: 'Clore', icon: Eye, run },
      ],
      whenReadOnly,
    });
    const icon = (row: string, name: string) => within(screen.getByText(row).closest('tr')!).getByRole('button', { name });

    it('keeps every row icon visible but disabled with the reason, and hides Ajouter', async () => {
      setup({ list: true, readOnly: REASON, config: withGates() });
      await screen.findByText('Poulailler A');
      expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
      for (const name of ['Modifier', 'Supprimer', 'Voir détail', 'Clore']) {
        expect(icon('Poulailler A', name)).toHaveAttribute('aria-disabled', 'true');
        expect(icon('Poulailler A', name)).toHaveAttribute('title', REASON);
      }
    });

    it('does nothing when a disabled icon is clicked', async () => {
      run.mockReset();
      setup({ list: true, readOnly: REASON, config: withGates() });
      await screen.findByText('Poulailler A');
      const user = userEvent.setup();
      await user.click(icon('Poulailler A', 'Clore'));
      await user.click(icon('Poulailler A', 'Supprimer'));
      await user.click(icon('Poulailler A', 'Modifier'));
      expect(run).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('lets through what whenReadOnly names, row by row, the rest staying disabled', async () => {
      run.mockReset();
      setup({ list: true, readOnly: REASON, config: withGates({ actions: { close: (b) => b.id === 'b1' }, canDelete: (b) => b.id === 'b2' }) });
      await screen.findByText('Poulailler A');
      expect(icon('Poulailler A', 'Clore')).not.toHaveAttribute('aria-disabled');
      expect(icon('Porcherie 2', 'Clore')).toHaveAttribute('aria-disabled', 'true');
      expect(icon('Porcherie 2', 'Supprimer')).not.toHaveAttribute('aria-disabled');
      expect(icon('Poulailler A', 'Supprimer')).toHaveAttribute('aria-disabled', 'true');
      expect(icon('Poulailler A', 'Modifier')).toHaveAttribute('title', REASON);
      await userEvent.setup().click(icon('Poulailler A', 'Clore'));
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('still hides what the config hides (a final record) and what the permission refuses', async () => {
      setup({ list: true, readOnly: REASON, config: { ...withGates(), canEdit: (b) => (b.id === 'b1' ? false : true) } });
      await screen.findByText('Poulailler A');
      expect(within(screen.getByText('Poulailler A').closest('tr')!).queryByRole('button', { name: 'Modifier' })).toBeNull();
      expect(icon('Porcherie 2', 'Modifier')).toHaveAttribute('title', REASON);
      cleanup();
      setup({ list: true, readOnly: REASON, perms: ['read'], config: withGates() });
      await screen.findByText('Poulailler A');
      expect(within(screen.getByText('Poulailler A').closest('tr')!).queryAllByRole('button')).toEqual([]);
    });
  });

  it('gives a custom form the effective scope', async () => {
    const seen: unknown[] = [];
    const form: NonNullable<ModuleConfig<Building>['form']> = ({ scope }) => {
      seen.push(scope);
      return <div role="dialog" aria-label="Formulaire perso" />;
    };
    setup({ list: true, scope: { buildingId: 'b9' }, config: { ...batiments, scope: { batchId: 'b1' }, fields: undefined, form } });
    await screen.findByText('Poulailler A');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(seen.at(-1)).toEqual({ batchId: 'b1', buildingId: 'b9' });
  });

  it('lets the scope win over a filter or form field of the same name', async () => {
    setup({ config: { ...batiments, scope: { status: 'ACTIF', type: 'PORCIN' } } });
    await screen.findByText('Poulailler A');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Tous les statuts'), 'Maintenance');
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('status=MAINTENANCE') || c.url.includes('status=ACTIF'))).toBe(true));
    for (const c of listCalls().slice(-1)) {
      expect(c.url).toContain('status=ACTIF');
      expect(c.url).not.toContain('status=MAINTENANCE');
    }
    handler = (c) => (c.method === 'POST' ? json(201, { id: 'b3' }) : undefined);
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nom'), 'X');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Avicole');
    await user.selectOptions(await within(dialog).findByLabelText('Site'), 'Site Nord');
    await user.type(within(dialog).getByLabelText('Capacité'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/buildings')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/buildings')?.body).toMatchObject({
      type: 'PORCIN', status: 'ACTIF',
    });
  });

  it('renders an element tab', async () => {
    setup({ config: { ...batiments, tabs: [{ key: 'extra', label: 'Résumé', element: <p>Contenu libre</p> }] } });
    await screen.findByText('Poulailler A');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Résumé' }));
    expect(screen.getByText('Contenu libre')).toBeInTheDocument();
  });

  describe('select dependsOn and time field', () => {
    const dependent: ModuleConfig<Building> = {
      ...batiments,
      form: undefined,
      fields: [
        { name: 'siteId', label: 'Site', type: 'select', options: { endpoint: '/sites' } },
        { name: 'zoneId', label: 'Zone', type: 'select', dependsOn: 'siteId', options: { endpoint: '/zones', params: { kind: 'x' } } },
        { name: 'at', label: 'Heure', type: 'time' },
        { name: 'qty', label: 'Quantité', type: 'number', min: 0, max: 10, step: 0.5 },
      ],
    };
    const zonesFor = (c: Call) => {
      if (!c.url.startsWith('/api/zones')) return undefined;
      const site = new URL(c.url, 'http://x').searchParams.get('siteId');
      return json(200, { items: [{ id: `z-${site}`, name: `Zone ${site}` }], total: 1, page: 1, pageSize: 200 });
    };

    it('disables the dependent select until the parent has a value, requests with the parent value and clears on change', async () => {
      setup({ config: dependent });
      await screen.findByText('Poulailler A');
      handler = zonesFor;
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Ajouter' }));
      const dialog = await screen.findByRole('dialog');
      const zone = within(dialog).getByLabelText('Zone');
      expect(zone).toBeDisabled();
      expect(within(zone).getByText("Choisir d'abord Site")).toBeInTheDocument();
      expect(calls.some((c) => c.url.startsWith('/api/zones'))).toBe(false);

      await user.selectOptions(await within(dialog).findByLabelText('Site'), 'Site Nord');
      await waitFor(() => expect(within(dialog).getByLabelText('Zone')).toBeEnabled());
      await user.selectOptions(await within(dialog).findByRole('option', { name: 'Zone s1' }).then(() => within(dialog).getByLabelText('Zone')), 'Zone s1');
      const zonesCall = calls.find((c) => c.url.startsWith('/api/zones'))!;
      expect(zonesCall.url).toContain('siteId=s1');
      expect(zonesCall.url).toContain('kind=x');
      expect(within(dialog).getByLabelText('Zone')).toHaveValue('z-s1');

      await user.selectOptions(within(dialog).getByLabelText('Site'), 'Site Sud');
      expect(within(dialog).getByLabelText('Zone')).toHaveValue('');
    });

    it('clears dependents transitively', async () => {
      const chain: ModuleConfig<Building> = {
        ...batiments,
        form: undefined,
        fields: [
          { name: 'a', label: 'Aa', type: 'select', options: [{ value: '1', label: 'Un' }, { value: '2', label: 'Deux' }] },
          { name: 'b', label: 'Bb', type: 'select', dependsOn: 'a', options: [{ value: 'x', label: 'Ex' }] },
          { name: 'c', label: 'Cc', type: 'select', dependsOn: 'b', options: [{ value: 'y', label: 'Ygrec' }] },
        ],
      };
      setup({ config: chain });
      await screen.findByText('Poulailler A');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Ajouter' }));
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(within(dialog).getByLabelText('Aa'), 'Un');
      await user.selectOptions(within(dialog).getByLabelText('Bb'), 'Ex');
      await user.selectOptions(within(dialog).getByLabelText('Cc'), 'Ygrec');
      expect(within(dialog).getByLabelText('Cc')).toHaveValue('y');
      await user.selectOptions(within(dialog).getByLabelText('Aa'), 'Deux');
      expect(within(dialog).getByLabelText('Bb')).toHaveValue('');
      expect(within(dialog).getByLabelText('Cc')).toHaveValue('');
    });

    it('submits a time field as HH:mm and passes max / step to number inputs', async () => {
      setup({ config: dependent });
      await screen.findByText('Poulailler A');
      handler = (c) => (c.method === 'POST' ? json(201, { id: 'x' }) : undefined);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Ajouter' }));
      const dialog = await screen.findByRole('dialog');
      const qty = within(dialog).getByLabelText('Quantité');
      expect(qty).toHaveAttribute('max', '10');
      expect(qty).toHaveAttribute('step', '0.5');
      fireEvent.change(within(dialog).getByLabelText('Heure'), { target: { value: '07:30' } });
      fireEvent.change(qty, { target: { value: '11' } });
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
      expect(await within(dialog).findByText(/inférieur ou égal à 10/)).toBeInTheDocument();
      fireEvent.change(qty, { target: { value: '2.5' } });
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/buildings')).toBe(true));
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/buildings')?.body).toMatchObject({ at: '07:30', qty: 2.5 });
    });
  });
});

describe('date filters', () => {
  const periodic: ModuleConfig<Building> = {
    ...batiments,
    filters: [{ param: 'from', allLabel: 'Du', type: 'date' }, { param: 'to', allLabel: 'Au', type: 'date' }],
  };

  it('sends a date input as a query parameter and clears it when emptied', async () => {
    setup({ config: periodic });
    await screen.findByText('Poulailler A');
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('from=2026-10-01') && c.url.includes('page=1'))).toBe(true));
    expect(screen.getByLabelText('Du')).toHaveAttribute('type', 'date');
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '' } });
    await waitFor(() => expect(listCalls().at(-1)!.url).not.toContain('from='));
    expect(listCalls().every((c) => !c.url.includes('to='))).toBe(true);
  });
});

describe('column visibility and conditional filters', () => {
  it('leaves out a column its `visible` refuses for the user', async () => {
    const config: ModuleConfig<Building> = {
      ...batiments,
      columns: [...batiments.columns, { key: 'zones', header: 'ZONES SECRÈTES', visible: ({ can }) => can('finance', 'read') }],
    };
    setup({ config });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('columnheader', { name: 'ZONES SECRÈTES' })).not.toBeInTheDocument();
  });

  const mineFilter = (hideWhenEmpty: boolean): ModuleConfig<Building> => ({
    ...batiments,
    filters: [{
      param: 'mine', allLabel: 'Tous', hideWhenEmpty,
      options: { endpoint: '/who', select: (data, { userId }) => ((data as { ids: string[] }).ids.includes(userId ?? '') ? [{ value: 'true', label: 'Les miens' }] : []) },
    }],
  });

  it('hides a select filter without options when `hideWhenEmpty`, and hands the user id to the options mapper', async () => {
    handler = () => undefined;
    setup({ config: mineFilter(true) });
    handler = (c) => (c.url.startsWith('/api/who') ? json(200, { ids: ['other'] }) : undefined);
    await screen.findByText('Poulailler A');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/who'))).toBe(true));
    expect(screen.queryByLabelText('Tous')).not.toBeInTheDocument();
  });

  it('shows it when the mapper answers an option for this user', async () => {
    setup({ config: mineFilter(true) });
    handler = (c) => (c.url.startsWith('/api/who') ? json(200, { ids: ['u1'] }) : undefined);
    expect(await screen.findByLabelText('Tous')).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText('Tous'), 'Les miens');
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('mine=true'))).toBe(true));
  });
});
