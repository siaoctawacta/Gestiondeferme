import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import { lots } from './lots';
import type { Batch } from './lotsShared';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];

const OPEN: Batch = {
  id: 'l1', code: 'LC-2026-14', type: 'CHAIR', breedId: 'br1', breedName: 'Cobb 500', buildingId: 'b1', buildingName: 'Poulailler A',
  entryDate: '2026-09-20', initialCount: 5000, deaths: 180, alive: 4820, mortalityRate: 3.6, averageWeightG: 1450, status: 'EN_COURS', ageDays: 55,
};
const CLOSED: Batch = {
  id: 'l2', code: 'LC-2026-09', type: 'CHAIR', breedId: 'br1', breedName: 'Cobb 500', buildingId: 'b1', buildingName: 'Poulailler A',
  entryDate: '2026-05-01', initialCount: 4000, deaths: 40, alive: 0, mortalityRate: 1, averageWeightG: null, status: 'CLOTURE', ageDays: 120,
};
const detailOf = (b: Batch) => ({
  ...b, species: 'AVICOLE', supplierName: null, purchasePrice: null, responsibleId: null, responsibleName: null, closedAt: null, notes: null,
  performance: { ageDays: b.ageDays, alive: b.alive, deaths: b.deaths, mortalityRate: b.mortalityRate, firstWeightG: 42, lastWeightG: 1450, dailyGainG: 55.3, feedKg: 9000, feedConversion: 1.7, feedCost: 4000000 },
});
const EVENTS = [{ id: 'e1', date: '2026-10-01', type: 'MORTALITE', quantity: 100, cause: 'Chaleur', note: null }];
const WEIGHINGS = [
  { id: 'w1', date: '2026-10-01', sampleSize: 30, averageWeightG: 600, note: null },
  { id: 'w2', date: '2026-10-08', sampleSize: 30, averageWeightG: 1000, note: null },
];

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
let handler: (c: Call) => Response | Promise<Response> | undefined;

const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

function mount(ui: React.ReactNode, { perms = ALL, farm, path = '/', porcs = [], users = [] }: { perms?: string[]; farm?: string; path?: string; porcs?: string[]; users?: string[] } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  handler = () => undefined;
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: { lots: perms, porcs, utilisateurs: users } });
    }
    const custom = handler(call);
    if (custom) return custom;
    if (call.method === 'GET' && call.url.startsWith('/api/batches?')) {
      return page([OPEN, CLOSED], { statusCounts: { EN_COURS: 3, CLOTURE: 1 }, total: 4 });
    }
    if (call.method === 'GET' && /^\/api\/batches\/l1(\?|$)/.test(call.url)) return json(200, detailOf(OPEN));
    if (call.method === 'GET' && /^\/api\/batches\/l2(\?|$)/.test(call.url)) return json(200, detailOf(CLOSED));
    if (call.method === 'GET' && /^\/api\/batches\/l\d\/events/.test(call.url)) return page(EVENTS);
    if (call.method === 'GET' && /^\/api\/batches\/l\d\/weighings/.test(call.url)) return page(WEIGHINGS);
    if (call.method === 'GET' && call.url.startsWith('/api/breeds')) return page([{ id: 'br1', name: 'Cobb 500' }]);
    if (call.method === 'GET' && call.url.startsWith('/api/buildings')) return page([{ id: 'b1', name: 'Poulailler A' }, { id: 'b2', name: 'Poulailler B' }]);
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The header button of the page (the row icons share the `Modifier` name but carry no text). */
const headerButton = (name: string) => screen.getAllByRole('button', { name }).find((b) => b.textContent?.trim() === name)!;

function mountDetail(id: string, opts?: Parameters<typeof mount>[1]) {
  const Detail = lots.detail!;
  mount(
    <Routes>
      <Route path="/m/lots/:id" element={<Detail id={id} />} />
      <Route path="/m/lots" element={<p>Liste des lots</p>} />
    </Routes>,
    { ...opts, path: `/m/lots/${id}` },
  );
}

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

describe('lots list', () => {
  const mountList = (opts?: Parameters<typeof mount>[1]) =>
    mount(
      <Routes>
        <Route path="*" element={<ModulePage config={lots} />} />
      </Routes>,
      opts,
    );

  it('renders the 11 headers, the tiles and a row with its mortality pill', async () => {
    mountList();
    expect(await screen.findByText('LC-2026-14')).toBeInTheDocument();
    for (const h of ['CODE LOT', 'TYPE', 'SOUCHE', 'BÂTIMENT', "DATE D'ENTRÉE", 'EFFECTIF INITIAL', 'MORTALITÉ CUMULÉE', 'POIDS MOYEN (G)', 'STATUT', 'VIVANTS', 'MORTALITÉ']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('Total enregistrements').nextElementSibling).toHaveTextContent('4');
    expect(screen.getByText('En cours', { selector: 'p' }).nextElementSibling).toHaveTextContent('3');
    const row = screen.getByText('LC-2026-14').closest('tr')!;
    for (const t of ['Chair', 'Cobb 500', 'Poulailler A', '2026-09-20', '5 000', '180', '1 450', 'En cours', '4 820', '3.6%']) {
      expect(within(row).getByText(t)).toBeInTheDocument();
    }
    expect(within(row).getByText('3.6%').className).toContain('bg-warning');
    expect(calls.some((c) => c.url.startsWith('/api/batches?') && c.url.includes('species=AVICOLE'))).toBe(true);
  });

  it('links the code to the detail and keeps the row icons, disabled with their reason when not allowed', async () => {
    mountList();
    const link = await screen.findByRole('link', { name: 'LC-2026-14' });
    expect(link).toHaveAttribute('href', '/m/lots/l1');
    const closed = screen.getByText('LC-2026-09').closest('tr')!;
    expect(within(closed).getByText('Clôturé')).toBeInTheDocument();
    for (const name of ['Modifier', 'Supprimer']) {
      const icon = within(closed).getByRole('button', { name });
      expect(icon).toHaveAttribute('aria-disabled', 'true');
      expect(icon).toHaveAttribute('title', 'Lot clôturé');
    }
    const open = screen.getByText('LC-2026-14').closest('tr')!;
    expect(within(open).getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    // A lot with deaths has history: the delete icon is there but disabled, with the reason.
    const del = within(open).getByRole('button', { name: 'Supprimer' });
    expect(del).toHaveAttribute('aria-disabled', 'true');
    expect(del).toHaveAttribute('title', 'Lot avec historique — clôturez-le');
  });

  it('does nothing when a disabled icon is clicked', async () => {
    mountList();
    await screen.findByText('LC-2026-09');
    const closed = screen.getByText('LC-2026-09').closest('tr')!;
    await userEvent.setup().click(within(closed).getByRole('button', { name: 'Modifier' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates an avian lot with the species and without the empty optional fields', async () => {
    mountList();
    await screen.findByText('LC-2026-14');
    handler = (c) => (c.method === 'POST' ? json(201, { id: 'l9' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Lots avicoles' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Pondeuse');
    await user.selectOptions(await within(dialog).findByLabelText('Bâtiment'), 'Poulailler B');
    fireEvent.change(within(dialog).getByLabelText("Date d'entrée"), { target: { value: '2026-11-01' } });
    await user.type(within(dialog).getByLabelText('Effectif initial'), '3000');
    expect(within(dialog).queryByLabelText('Responsable')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes().length > 0).toBe(true));
    expect(writes()[0]).toMatchObject({
      url: '/api/batches',
      body: { species: 'AVICOLE', type: 'PONDEUSE', buildingId: 'b2', entryDate: '2026-11-01', initialCount: 3000 },
    });
    expect(Object.keys((writes()[0].body as object)).sort()).toEqual(
      ['buildingId', 'entryDate', 'initialCount', 'species', 'type'],
    );
  });

  it('does not offer the building when editing', async () => {
    mountList();
    await screen.findByText('LC-2026-14');
    await userEvent.setup().click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Lots avicoles' });
    expect(within(dialog).queryByLabelText('Bâtiment')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Type')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Effectif initial')).toHaveValue(5000);
  });

  it('loads the lot first, shows the stored supplier, price and responsible, and sends only what changed (null when cleared)', async () => {
    mountList({ users: ['read'] });
    await screen.findByText('LC-2026-14');
    handler = (c) => {
      if (c.method === 'GET' && /^\/api\/batches\/l1(\?|$)/.test(c.url)) {
        return json(200, { ...detailOf(OPEN), supplierName: 'Couvoir Lomé', purchasePrice: 1500, responsibleId: 'u1' });
      }
      if (c.method === 'GET' && c.url.startsWith('/api/users')) return page([{ id: 'u1', name: 'Awa' }, { id: 'u2', name: 'Kofi' }]);
      if (c.method === 'PATCH') return json(200, {});
      return undefined;
    };
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Lots avicoles' });
    await waitFor(() => expect(within(dialog).getByLabelText('Fournisseur')).toHaveValue('Couvoir Lomé'));
    expect(within(dialog).getByLabelText("Prix d'achat")).toHaveValue(1500);
    await waitFor(() => expect(within(dialog).getByLabelText('Responsable')).toHaveValue('u1'));
    expect(calls.some((c) => c.url === '/api/batches/l1')).toBe(true);
    await user.clear(within(dialog).getByLabelText('Fournisseur'));
    await user.selectOptions(within(dialog).getByLabelText('Responsable'), '');
    await user.clear(within(dialog).getByLabelText('Effectif initial'));
    await user.type(within(dialog).getByLabelText('Effectif initial'), '5100');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/batches/l1' });
    expect(writes()[0].body).toEqual({ initialCount: 5100, supplierName: null, responsibleId: null });
  });

  it('closes an unchanged edit without any request', async () => {
    mountList();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Lots avicoles' });
    await waitFor(() => expect(within(dialog).getByLabelText('Effectif initial')).toHaveValue(5000));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);
  });

  it('deletes a lot without history through DELETE /batches/:id, and shows the 409 message', async () => {
    mountList();
    handler = (c) => (c.method === 'GET' && c.url.startsWith('/api/batches?')
      ? page([{ ...OPEN, deaths: 0, alive: 5000, mortalityRate: 0 }], { statusCounts: { EN_COURS: 1 } })
      : undefined);
    await screen.findByText('LC-2026-14');
    handler = (c) => (c.method === 'DELETE' ? json(409, { message: 'Ce lot a un historique ; clôturez-le plutôt' }) : undefined);
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(await within(dialog).findByText('Ce lot a un historique ; clôturez-le plutôt')).toBeInTheDocument();
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/batches/l1' });
  });
});

describe('row icons follow the kind of list', () => {
  const rowIcons = (row: HTMLElement) =>
    ['Modifier', 'Supprimer'].map((name) => within(row).queryByRole('button', { name }) !== null);

  it('shows edit and delete on the movements of a role that can only read and create, and none on the lots list', async () => {
    mountDetail('l1', { perms: ['read', 'create'] });
    const movement = (await screen.findByText('Chaleur')).closest('tr')!;
    expect(rowIcons(movement)).toEqual([true, true]);
    cleanup();
    mount(
      <Routes>
        <Route path="*" element={<ModulePage config={lots} />} />
      </Routes>,
      { perms: ['read', 'create'] },
    );
    const lot = (await screen.findByText('LC-2026-14')).closest('tr')!;
    expect(rowIcons(lot)).toEqual([false, false]);
  });

  it('hides them on the movements when the role has update and delete but cannot create', async () => {
    mountDetail('l1', { perms: ['read', 'update', 'delete'] });
    const movement = (await screen.findByText('Chaleur')).closest('tr')!;
    expect(rowIcons(movement)).toEqual([false, false]);
  });

  it('still lets a master-data list use update and delete', async () => {
    mount(
      <Routes>
        <Route path="*" element={<ModulePage config={lots} />} />
      </Routes>,
      { perms: ['read', 'update', 'delete'] },
    );
    const lot = (await screen.findByText('LC-2026-14')).closest('tr')!;
    expect(rowIcons(lot)).toEqual([true, true]);
  });

  it('keeps the row gates on top: a closed lot has no editable movement for the daily role either', async () => {
    mountDetail('l2', { perms: ['read', 'create'] });
    // The movement rows are rendered, and carry no icon: closed lots are read-only.
    const movement = (await screen.findByText('Chaleur')).closest('tr')!;
    expect(rowIcons(movement)).toEqual([false, false]);
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });
});

describe('lot detail', () => {
  it('shows the figures, the tabs and the closing controls', async () => {
    mountDetail('l1');
    expect(await screen.findByRole('heading', { name: 'LC-2026-14' })).toBeInTheDocument();
    expect(screen.getByText('Vivants').nextElementSibling).toHaveTextContent('4 820');
    expect(screen.getByText('Mortalité', { selector: 'p' }).nextElementSibling).toHaveTextContent('3.6%');
    expect(screen.getByText('Âge (jours)').nextElementSibling).toHaveTextContent('55');
    expect(screen.getByText('Poids moyen', { selector: 'p' }).nextElementSibling).toHaveTextContent('1 450 g');
    expect(screen.getByText('GMD').nextElementSibling).toHaveTextContent('55.3 g/j');
    expect(screen.getByText('Indice de consommation').nextElementSibling).toHaveTextContent('1.7');
    expect(screen.getByRole('tab', { name: 'Mouvements' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pesées' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Alimentation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ponte' })).not.toBeInTheDocument();
    expect(headerButton('Modifier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clôturer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transférer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exporter' })).not.toBeInTheDocument();
    expect(await screen.findByText('Chaleur')).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/batches/l1/events'))).toBe(true);
  });

  it('adds a mortality through POST /batches/:id/events', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    handler = (c) => (c.method === 'POST' ? json(201, { id: 'e2' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Mortalité');
    await user.type(within(dialog).getByLabelText('Quantité'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes().length > 0).toBe(true));
    expect(writes()[0]).toMatchObject({
      url: '/api/batches/l1/events',
      body: { type: 'MORTALITE', quantity: 12 },
    });
  });

  it('shows the API message in the dialog when the headcount is too low', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    handler = (c) => (c.method === 'POST' ? json(400, { message: 'Effectif insuffisant' }) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Vente');
    await user.type(within(dialog).getByLabelText('Quantité'), '99999');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Effectif insuffisant')).toBeInTheDocument();
  });

  it('lists the weighings with their curve', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Pesées' }));
    expect(await screen.findByText('1 000')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Courbe de poids moyen' })).toBeInTheDocument();
  });

  it('confirms before closing the lot', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    handler = (c) => (c.method === 'POST' ? json(200, {}) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clôturer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Clôturer le lot LC-2026-14 ? Il ne pourra plus recevoir d\'opérations.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Clôturer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/batches/l1/close')).toBe(true));
  });

  it('transfers the whole live count to another building', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    handler = (c) => (c.method === 'POST' ? json(200, {}) : undefined);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Transférer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Transférer le lot LC-2026-14' });
    await user.selectOptions(await within(dialog).findByLabelText('Bâtiment de destination'), 'Poulailler B');
    await user.click(within(dialog).getByRole('button', { name: 'Transférer' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/batches/l1/transfer')).toBe(true));
    expect(calls.find((c) => c.url === '/api/batches/l1/transfer')!.body).toMatchObject({ toBuildingId: 'b2', quantity: 4820 });
  });

  it('is read-only once closed, and offers to reopen it', async () => {
    mountDetail('l2');
    expect(await screen.findByRole('heading', { name: 'LC-2026-09' })).toBeInTheDocument();
    expect(screen.getAllByText('Clôturé').length).toBeGreaterThan(0);
    await screen.findByText('Chaleur');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transférer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clôturer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rouvrir' })).toBeInTheDocument();
    expect(screen.getByText('Mortalité', { selector: 'p' }).nextElementSibling).toHaveTextContent('1%');
    expect(screen.getByText('Poids moyen', { selector: 'p' }).nextElementSibling).toHaveTextContent('—');
  });

  it('hides the lot actions without update permission or under all farms', async () => {
    mountDetail('l1', { perms: ['read'] });
    await screen.findByRole('heading', { name: 'LC-2026-14' });
    for (const n of ['Modifier', 'Clôturer', 'Rouvrir', 'Transférer', 'Ajouter']) {
      expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    }
  });

  it('hides the lot actions under all farms', async () => {
    mountDetail('l1', { farm: 'all' });
    await screen.findByRole('heading', { name: 'LC-2026-14' });
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clôturer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transférer' })).not.toBeInTheDocument();
  });

  it('shows the 404 card for a malformed id (400) too', async () => {
    mountDetail('not-an-id');
    handler = (c) => (c.url.startsWith('/api/batches/not-an-id') ? json(400, { message: 'Identifiant invalide' }) : undefined);
    expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  });

  it('edits the lot from its page: the form loads the lot and sends only the change', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    handler = (c) => (c.method === 'PATCH' ? json(200, {}) : undefined);
    const user = userEvent.setup();
    await user.click(headerButton('Modifier'));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Lots avicoles' });
    await waitFor(() => expect(within(dialog).getByLabelText('Effectif initial')).toHaveValue(5000));
    await user.clear(within(dialog).getByLabelText('Effectif initial'));
    await user.type(within(dialog).getByLabelText('Effectif initial'), '5200');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/batches/l1', body: { initialCount: 5200 } });
    expect(Object.keys(writes()[0].body as object)).toEqual(['initialCount']);
  });

  it('records a weighing in grams for poultry', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Pesées' }));
    expect(await screen.findByRole('columnheader', { name: 'POIDS MOYEN (G)' })).toBeInTheDocument();
    handler = (c) => (c.method === 'POST' ? json(201, { id: 'w3' }) : undefined);
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Poids moyen (kg)')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Taille de l'échantillon"), '30');
    await user.type(within(dialog).getByLabelText('Poids moyen (g)'), '1200');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/batches/l1/weighings', body: { sampleSize: 30, averageWeightG: 1200 } });
  });

  it('reopens a closed lot once, and shows a failure under the header', async () => {
    mountDetail('l2');
    await screen.findByText('Chaleur');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    handler = (c) => (c.method === 'POST' && c.url === '/api/batches/l2/reopen' ? gate.then(() => json(409, { message: 'Ce lot ne peut pas être rouvert' })) : undefined);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Rouvrir' });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await user.click(button);
    release();
    const message = await screen.findByText('Ce lot ne peut pas être rouvert');
    expect(writes()).toHaveLength(1);
    // The notice sits between the header and the figures, not at the bottom of the page.
    expect(message.compareDocumentPosition(screen.getByText('Vivants')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toBeEnabled();
  });

  it('transfers to a building of the lot\'s species listed first', async () => {
    mountDetail('l1');
    await screen.findByText('Chaleur');
    handler = (c) => {
      if (c.method === 'GET' && c.url.startsWith('/api/buildings')) {
        return page([{ id: 'b1', name: 'Poulailler A', type: 'AVICOLE' }, { id: 'b3', name: 'Maternité', type: 'PORCIN' }, { id: 'b2', name: 'Poulailler B', type: 'AVICOLE' }]);
      }
      return undefined;
    };
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Transférer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Transférer le lot LC-2026-14' });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maternité' })).toBeInTheDocument());
    const options = within(within(dialog).getByLabelText('Bâtiment de destination')).getAllByRole('option').map((o) => o.textContent);
    // The lot's own building (Poulailler A) is left out; its species' building comes before the other species'.
    expect(options).toEqual(['Sélectionner…', 'Poulailler B', 'Maternité']);
  });

  it('shows the 404 card for an unknown lot', async () => {
    mountDetail('zz');
    handler = (c) => (c.url.startsWith('/api/batches/zz') ? json(404, { message: 'Lot introuvable' }) : undefined);
    expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  });
});

describe('lot detail of a pig lot', () => {
  const pigs = (c: Call) =>
    c.method === 'GET' && /^\/api\/batches\/l1(\?|$)/.test(c.url) ? json(200, { ...detailOf(OPEN), species: 'PORCIN' }) : undefined;

  it('follows the porcs permissions and back link', async () => {
    mountDetail('l1', { perms: ['read'], porcs: ['read', 'update', 'create'] });
    handler = pigs;
    expect(await screen.findByRole('button', { name: 'Clôturer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transférer' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exporter' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cheptel porcin/ })).toHaveAttribute('href', '/m/porcs');
  });

  it('ignores the lots permissions', async () => {
    mountDetail('l1', { perms: ['read', 'update', 'create'], porcs: ['read'] });
    handler = pigs;
    await screen.findByRole('link', { name: /Cheptel porcin/ });
    await screen.findByText('Chaleur');
    for (const n of ['Clôturer', 'Transférer', 'Ajouter']) {
      expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    }
  });
});

describe('weights of a pig lot', () => {
  const PIG = { ...detailOf(OPEN), species: 'PORCIN', averageWeightG: 68000, performance: { ...detailOf(OPEN).performance, dailyGainG: 650, feedConversion: 2.85 } };
  const pigs = (c: Call) => (c.method === 'GET' && /^\/api\/batches\/l1(\?|$)/.test(c.url) ? json(200, PIG) : undefined);
  const PIG_WEIGHINGS = [
    { id: 'w1', date: '2026-10-01', sampleSize: 20, averageWeightG: 30000, note: null },
    { id: 'w2', date: '2026-10-08', sampleSize: 20, averageWeightG: 68500, note: null },
  ];

  it('shows the average weight in kg, and the daily gain in kg/j', async () => {
    mountDetail('l1', { perms: [], porcs: ['read', 'create', 'update'] });
    handler = pigs;
    expect(await screen.findByRole('heading', { name: 'LC-2026-14' })).toBeInTheDocument();
    expect(screen.getByText('Poids moyen', { selector: 'p' }).nextElementSibling).toHaveTextContent('68 kg');
    expect(screen.getByText('GMD').nextElementSibling).toHaveTextContent('0.65 kg/j');
    expect(screen.getByText('Indice de consommation').nextElementSibling).toHaveTextContent('2.85');
  });

  it('asks the weighing in kg, sends grams, and lists the weighings in kg', async () => {
    mountDetail('l1', { perms: [], porcs: ['read', 'create', 'update'] });
    handler = (c) => {
      if (c.method === 'GET' && /^\/api\/batches\/l1\/weighings/.test(c.url)) return page(PIG_WEIGHINGS);
      if (c.method === 'POST') return json(201, { id: 'w3' });
      return pigs(c);
    };
    await screen.findByRole('heading', { name: 'LC-2026-14' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Pesées' }));
    expect(await screen.findByText('68.5 kg')).toBeInTheDocument();
    expect(screen.getByText('30 kg')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Courbe de poids moyen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Courbe de poids moyen (kg)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Poids moyen (g)')).not.toBeInTheDocument();
    const weight = within(dialog).getByLabelText('Poids moyen (kg)');
    expect(weight).toHaveAttribute('step', '0.1');
    await user.type(within(dialog).getByLabelText("Taille de l'échantillon"), '20');
    await user.type(weight, '72.3');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/batches/l1/weighings', body: { sampleSize: 20, averageWeightG: 72300 } });
  });

  it('edits a weighing in kg and sends the grams that changed', async () => {
    mountDetail('l1', { perms: [], porcs: ['read', 'create', 'update'] });
    handler = (c) => {
      if (c.method === 'GET' && /^\/api\/batches\/l1\/weighings/.test(c.url)) return page(PIG_WEIGHINGS);
      if (c.method === 'PATCH') return json(200, {});
      return pigs(c);
    };
    await screen.findByRole('heading', { name: 'LC-2026-14' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Pesées' }));
    await user.click(within((await screen.findByText('68.5 kg')).closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    const weight = within(dialog).getByLabelText('Poids moyen (kg)');
    expect(weight).toHaveValue(68.5);
    await user.clear(weight);
    await user.type(weight, '69');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/batches/l1/weighings/w2' });
    expect(writes()[0].body).toEqual({ averageWeightG: 69000 });
  });
});
