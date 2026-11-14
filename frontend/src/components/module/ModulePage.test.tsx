import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { batiments } from '../../modules/batiments';
import { ModulePage } from './ModulePage';

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

function setup({ perms = ALL, farm }: { perms?: string[]; farm?: string } = {}) {
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
          <ModulePage config={batiments} />
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
    await userEvent.setup().selectOptions(screen.getByLabelText('Filtrer par statut'), 'Maintenance');
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
      body: { name: 'Poulailler Z', type: 'AVICOLE', siteId: 's1', capacity: 5000, status: 'ACTIF' },
    });
  });

  it('hides every write control without the matching permission', async () => {
    setup({ perms: ['read'] });
    await screen.findByText('Poulailler A');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exporter' })).toBeInTheDocument();
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
});
