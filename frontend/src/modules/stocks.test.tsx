import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import { todayIso } from '../lib/format';
import { stocks } from './stocks';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete', 'validate'];

const row = (o: object) => ({ maxQty: null, averageCost: 300, value: 0, nextExpiry: null, ...o });
const STOCK = [
  row({ id: 's1', name: 'Aliment croissance chair', category: 'ALIMENT', unit: 'kg', quantity: 4200, minQty: 2000, maxQty: 8000, level: 'ok', daysOfStock: 6, value: 1260000 }),
  row({ id: 's2', name: 'Aliment ponte', category: 'ALIMENT', unit: 'kg', quantity: 900, minQty: 1500, maxQty: 5000, level: 'faible', daysOfStock: 2, value: 270000 }),
  row({ id: 's3', name: 'Aliment engraissement porc', category: 'ALIMENT', unit: 'kg', quantity: 600, minQty: 1500, level: 'critique', daysOfStock: 1 }),
  row({ id: 's4', name: 'Vaccin Gumboro', category: 'MEDICAMENT', unit: 'flacons', quantity: 12, minQty: 5, level: 'ok', daysOfStock: null }),
  row({ id: 's5', name: 'Copeaux litière', category: 'CONSOMMABLE', unit: 'sacs', quantity: 80, minQty: 40, level: 'ok', daysOfStock: 13 }),
];
const LEVEL_COUNTS = { ok: 3, faible: 1, critique: 1 };

const MOVEMENTS = [
  { id: 'm1', date: '2026-11-02', itemId: 's2', itemName: 'Aliment ponte', type: 'ENTREE', quantity: 1000, unitCost: 300, reason: 'ACHAT', lotNumber: 'L-01', sourceType: 'PURCHASE', note: null },
  { id: 'm2', date: '2026-11-03', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -100, unitCost: 300, reason: 'PERTE', lotNumber: null, sourceType: null, note: null },
  { id: 'm3', date: '2026-11-04', itemId: 's2', itemName: 'Aliment ponte', type: 'AJUSTEMENT', quantity: -20, unitCost: 300, reason: 'INVENTAIRE', lotNumber: null, sourceType: 'INVENTORY', note: null },
];

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const DETAIL = {
  ...STOCK[1],
  batches: [
    { id: 'b1', lotNumber: 'L-OLD', expiryDate: plusDays(-5), receivedDate: '2026-01-02', quantity: 100 },
    { id: 'b2', lotNumber: 'L-SOON', expiryDate: plusDays(10), receivedDate: '2026-10-02', quantity: 200 },
    { id: 'b3', lotNumber: 'L-FAR', expiryDate: plusDays(200), receivedDate: '2026-11-02', quantity: 600 },
  ],
};

const DRAFT = { id: 'i1', date: '2026-11-10', status: 'BROUILLON', note: null, lineCount: 0, lines: [] };
const DONE = {
  id: 'i2', date: '2026-11-01', status: 'VALIDEE', note: null, lineCount: 1,
  lines: [{ stockItemId: 's2', itemName: 'Aliment ponte', unit: 'kg', theoreticalQty: 900, countedQty: 880 }],
};

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

/** Set per test to make a write fail. */
let failWith: { url: RegExp; status: number; message: string } | null = null;

function mount(ui: React.ReactNode, { perms = ALL, farm }: { perms?: string[]; farm?: string } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: { stocks: perms } });
    }
    if (call.method !== 'GET') {
      if (failWith && failWith.url.test(call.url)) return json(failWith.status, { message: failWith.message });
      return json(201, { id: 'new1' });
    }
    const url = call.url;
    if (url.startsWith('/api/stock/movements')) return page(MOVEMENTS);
    if (/^\/api\/stock\/s2(\?|$)/.test(url)) return json(200, DETAIL);
    if (/^\/api\/stock\/s9(\?|$)/.test(url)) return json(404, { message: 'Introuvable' });
    if (url.startsWith('/api/stock')) return page(STOCK, { levelCounts: LEVEL_COUNTS });
    if (/^\/api\/inventories\/i1(\?|$)/.test(url)) return json(200, DRAFT);
    if (/^\/api\/inventories\/i2(\?|$)/.test(url)) return json(200, DONE);
    if (url.startsWith('/api/inventories')) return page([DRAFT, { ...DONE, lineCount: 1 }].map(({ lines: _l, ...r }) => r));
    if (url.startsWith('/api/stock-items')) return page([{ id: 's1', name: 'Aliment croissance chair' }]);
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mountPage = (opts?: Parameters<typeof mount>[1]) =>
  mount(<Routes><Route path="*" element={<ModulePage config={stocks} />} /></Routes>, opts);
const Detail = stocks.detail!;
const mountDetail = (id: string, opts?: Parameters<typeof mount>[1]) => mount(<Detail id={id} />, opts);

beforeEach(() => {
  calls.length = 0;
  failWith = null;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('stocks list', () => {
  it('renders the reference headers, tile, subtitle, tabs and rows with level pills', async () => {
    mountPage();
    expect(await screen.findByText('Aliment ponte')).toBeInTheDocument();
    for (const h of ['ARTICLE', 'CATÉGORIE', 'QUANTITÉ', 'UNITÉ', 'SEUIL MINIMUM', 'NIVEAU', 'JOURS DE STOCK']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('Aliments, médicaments, matériel et consommables.')).toBeInTheDocument();
    expect(screen.getByText('Logistique')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Total enregistrements', { selector: 'p' }).nextElementSibling).toHaveTextContent('5'));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Stocks', 'Mouvements', 'Inventaires']);

    const ponte = screen.getByText('Aliment ponte').closest('tr')!;
    for (const t of ['Aliment', '900', 'kg', '1 500', 'faible', '2']) expect(within(ponte).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(screen.getByText('Aliment engraissement porc').closest('tr')!).getByText('critique')).toBeInTheDocument();
    const gumboro = screen.getByText('Vaccin Gumboro').closest('tr')!;
    expect(within(gumboro).getByText('Médicament')).toBeInTheDocument();
    expect(within(gumboro).getByText('ok')).toBeInTheDocument();
    expect(within(gumboro).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByText('Aliment croissance chair').closest('tr')!).getByText('4 200')).toBeInTheDocument();
  });

  it('filters by level and by category through the API parameters', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tous les niveaux' }), 'critique');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/stock?') && c.url.includes('level=critique'))).toBe(true));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Toutes les catégories' }), 'VACCIN');
    await waitFor(() => expect(calls.some((c) => c.url.includes('category=VACCIN') && c.url.includes('level=critique'))).toBe(true));
  });

  it('records an exit and shows the API refusal in the dialog', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    failWith = { url: /\/api\/stock\/movements$/, status: 400, message: 'Stock insuffisant' };
    await user.click(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Sortie' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sortie — Aliment ponte' });
    await user.type(within(dialog).getByLabelText('Quantité'), '5000');
    await user.selectOptions(within(dialog).getByLabelText('Motif'), 'Perte');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Stock insuffisant')).toBeInTheDocument();
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/stock/movements',
      body: { stockItemId: 's2', date: todayIso(), type: 'SORTIE', quantity: 5000, reason: 'PERTE' },
    });

    failWith = null;
    await user.clear(within(dialog).getByLabelText('Quantité'));
    await user.type(within(dialog).getByLabelText('Quantité'), '50');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()[1].body).toMatchObject({ type: 'SORTIE', quantity: 50 });
  });

  it('records an entry with cost, lot and expiry, and a signed adjustment', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    const ponte = () => within(screen.getByText('Aliment ponte').closest('tr')!);
    await user.click(ponte().getByRole('button', { name: 'Entrée' }));
    let dialog = await screen.findByRole('dialog', { name: 'Entrée — Aliment ponte' });
    await user.type(within(dialog).getByLabelText('Quantité'), '1000');
    await user.type(within(dialog).getByLabelText('Coût unitaire (FCFA)'), '320');
    await user.type(within(dialog).getByLabelText('N° de lot'), 'L-77');
    await user.type(within(dialog).getByLabelText('Péremption'), '2027-03-01');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      stockItemId: 's2', date: todayIso(), type: 'ENTREE', quantity: 1000, unitCost: 320, reason: 'ACHAT', lotNumber: 'L-77', expiryDate: '2027-03-01',
    });

    await user.click(ponte().getByRole('button', { name: 'Ajustement' }));
    dialog = await screen.findByRole('dialog', { name: 'Ajustement — Aliment ponte' });
    await user.type(within(dialog).getByLabelText('Écart (signé)'), '-20');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toMatchObject({ type: 'AJUSTEMENT', quantity: -20, reason: 'AUTRE' });
  });

  it('gives the storekeeper the movement actions but no Ajouter, edit or delete', async () => {
    mountPage({ perms: ['read', 'create'] });
    await screen.findByText('Aliment ponte');
    const ponte = within(screen.getByText('Aliment ponte').closest('tr')!);
    for (const name of ['Entrée', 'Sortie', 'Ajustement']) expect(ponte.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(ponte.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(ponte.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('is read-only under all farms', async () => {
    mountPage({ farm: 'all' });
    await screen.findByText('Aliment ponte');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sortie' })).not.toBeInTheDocument();
  });

  it('creates an item, then its thresholds for the active farm', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Stocks' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Désinfectant');
    await user.selectOptions(within(dialog).getByLabelText('Catégorie'), 'Consommable');
    await user.type(within(dialog).getByLabelText('Unité'), 'litres');
    await user.type(within(dialog).getByLabelText('Seuil minimum'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/stock-items', body: { name: 'Désinfectant', category: 'CONSOMMABLE', unit: 'litres', active: true } });
    expect(writes()[1]).toMatchObject({ method: 'PUT', url: '/api/stock/new1/thresholds', body: { minQty: 10 } });
  });

  it('edits only the thresholds when only they changed', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Stocks' });
    expect(within(dialog).getByLabelText('Seuil minimum')).toHaveValue(1500);
    await user.clear(within(dialog).getByLabelText('Seuil minimum'));
    await user.type(within(dialog).getByLabelText('Seuil minimum'), '1800');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: '/api/stock/s2/thresholds', body: { minQty: 1800, maxQty: 5000 } });
  });
});

describe('stock movements tab', () => {
  async function openMovements(opts?: Parameters<typeof mount>[1]) {
    mountPage(opts);
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Mouvements' }));
    await screen.findByText('2026-11-03');
    return user;
  }

  it('lists movements with type pills and signed quantities', async () => {
    await openMovements();
    const sortie = screen.getByText('2026-11-03').closest('tr')!;
    expect(within(sortie).getByText('Sortie')).toBeInTheDocument();
    expect(within(sortie).getByText('-100')).toBeInTheDocument();
    expect(within(sortie).getByText('Perte')).toBeInTheDocument();
    const entree = screen.getByText('2026-11-02').closest('tr')!;
    expect(within(entree).getByText('Entrée')).toBeInTheDocument();
    expect(within(entree).getByText('+1 000')).toBeInTheDocument();
    expect(within(entree).getByText('L-01')).toBeInTheDocument();
  });

  it('locks the source-linked rows with a reason and lets the manual one be edited', async () => {
    const user = await openMovements({ perms: ['read', 'create'] });
    const linked = within(screen.getByText('2026-11-02').closest('tr')!);
    expect(linked.getByRole('button', { name: 'Modifier' })).toHaveAttribute('aria-disabled', 'true');
    expect(linked.getByRole('button', { name: 'Modifier' })).toHaveAttribute('title', "Mouvement issu d'une autre opération");
    expect(linked.getByRole('button', { name: 'Supprimer' })).toHaveAttribute('aria-disabled', 'true');
    const manual = within(screen.getByText('2026-11-03').closest('tr')!);
    expect(manual.getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    await user.click(manual.getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
    expect(within(dialog).getByLabelText('Quantité')).toHaveValue(100);
    await user.clear(within(dialog).getByLabelText('Quantité'));
    await user.type(within(dialog).getByLabelText('Quantité'), '80');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(expect.objectContaining({ method: 'PATCH', url: '/api/stock/movements/m2', body: { quantity: 80 } }));
  });
});

describe('stock item detail', () => {
  it('shows the tiles, the batches with expiry pills and the item movements', async () => {
    mountDetail('s2');
    expect(await screen.findByRole('heading', { name: 'Aliment ponte' })).toBeInTheDocument();
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(tile('Quantité')).toHaveTextContent('900 kg');
    expect(tile('Valeur')).toHaveTextContent('270 000 FCFA');
    expect(tile('Coût moyen')).toHaveTextContent('300 FCFA/kg');
    expect(tile('Jours de stock')).toHaveTextContent('2');

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lots', 'Mouvements']);
    const old = screen.getByText('L-OLD').closest('tr')!;
    expect(within(old).getByText('Périmé')).toBeInTheDocument();
    expect(within(screen.getByText('L-SOON').closest('tr')!).getByText('Bientôt périmé')).toBeInTheDocument();
    const far = within(screen.getByText('L-FAR').closest('tr')!);
    expect(far.queryByText('Périmé')).not.toBeInTheDocument();
    expect(far.queryByText('Bientôt périmé')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Mouvements' }));
    await screen.findByText('2026-11-03');
    expect(calls.some((c) => c.url.startsWith('/api/stock/movements') && c.url.includes('itemId=s2'))).toBe(true);
  });

  it('shows the not-found card for an unknown item', async () => {
    mountDetail('s9');
    expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  });
});

describe('inventories', () => {
  it('lists sessions with their status and links to the session page', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Inventaires' }));
    const link = await screen.findByRole('link', { name: '2026-11-10' });
    expect(link).toHaveAttribute('href', '/m/stocks/inv-i1');
    expect(within(link.closest('tr')!).getByText('Brouillon')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: '2026-11-01' }).closest('tr')!).getByText('Validée')).toBeInTheDocument();
  });

  it('counts a draft, saves it, and validates after a confirmation', async () => {
    mountDetail('inv-i1');
    expect(await screen.findByRole('heading', { name: 'Inventaire du 2026-11-10' })).toBeInTheDocument();
    expect(screen.getByText('Brouillon')).toBeInTheDocument();
    const user = userEvent.setup();
    const counted = await screen.findByLabelText('Compté ligne 2');
    expect(screen.getByText('Aliment ponte')).toBeInTheDocument();
    await user.type(counted, '880');
    expect(screen.getByTestId('gap-2')).toHaveTextContent('-20');

    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: '/api/inventories/i1/lines', body: { lines: [{ stockItemId: 's2', countedQty: 880 }] } });

    await user.click(screen.getByRole('button', { name: "Valider l'inventaire" }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("Valider l'inventaire du 2026-11-10 ? Les écarts seront enregistrés comme ajustements.")).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      'PUT /api/inventories/i1/lines', 'PUT /api/inventories/i1/lines', 'POST /api/inventories/i1/validate',
    ]));
  });

  it('hides the validation without the validate permission', async () => {
    mountDetail('inv-i1', { perms: ['read', 'create'] });
    await screen.findByLabelText('Compté ligne 1');
    expect(screen.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Valider l'inventaire" })).not.toBeInTheDocument();
  });

  it('shows a validated session read-only', async () => {
    mountDetail('inv-i2');
    expect(await screen.findByText('Validée')).toBeInTheDocument();
    expect(screen.getByText('Aliment ponte')).toBeInTheDocument();
    expect(screen.getByLabelText('Compté ligne 1')).toBeDisabled();
    expect(screen.getByTestId('gap-1')).toHaveTextContent('-20');
    expect(screen.queryByRole('button', { name: 'Enregistrer le brouillon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Valider l'inventaire" })).not.toBeInTheDocument();
  });
});
