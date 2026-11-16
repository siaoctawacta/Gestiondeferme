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
import type { StockItemDetailData } from './stocksShared';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete', 'validate'];

const row = <O extends object>(o: O) => ({ maxQty: null, averageCost: 300, value: 0, nextExpiry: null, ...o });
const STOCK = [
  row({ id: 's1', name: 'Aliment croissance chair', category: 'ALIMENT', unit: 'kg', quantity: 4200, minQty: 2000, maxQty: 8000, level: 'ok', daysOfStock: 6, value: 1260000 }),
  row({ id: 's2', name: 'Aliment ponte', category: 'ALIMENT', unit: 'kg', quantity: 900, minQty: 1500, maxQty: 5000, level: 'faible', daysOfStock: 2, value: 270000 }),
  row({ id: 's3', name: 'Aliment engraissement porc', category: 'ALIMENT', unit: 'kg', quantity: 600, minQty: 1500, level: 'critique', daysOfStock: 1 }),
  row({ id: 's4', name: 'Vaccin Gumboro', category: 'MEDICAMENT', unit: 'flacons', quantity: 12, minQty: 5, level: 'ok', daysOfStock: null }),
  row({ id: 's5', name: 'Copeaux litière', category: 'CONSOMMABLE', unit: 'sacs', quantity: 80, minQty: 40, level: 'ok', daysOfStock: 13 }),
];
const LEVEL_COUNTS = { ok: 3, faible: 1, critique: 1 };

// Rows as the API sends them: every piece carries its `operationId`; an exit split across two lots is two rows.
const mv = (o: { id: string; date: string } & Record<string, unknown>) => ({ lotExplicit: false, unit: 'kg', unitCost: 300, lotNumber: null, sourceType: null, note: null, ...o });
const MOVEMENTS = [
  mv({ id: 'm1', operationId: 'op1', date: '2026-11-02', itemId: 's2', itemName: 'Aliment ponte', type: 'ENTREE', quantity: 1000, reason: 'ACHAT', lotNumber: 'L-01', sourceType: 'PURCHASE' }),
  mv({ id: 'm2', operationId: 'op2', date: '2026-11-03', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -100, reason: 'PERTE' }),
  mv({ id: 'm3', operationId: 'op3', date: '2026-11-04', itemId: 's2', itemName: 'Aliment ponte', type: 'AJUSTEMENT', quantity: -20, reason: 'INVENTAIRE', sourceType: 'INVENTORY' }),
  mv({ id: 'm4', operationId: 'op4', date: '2026-11-05', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -300, reason: 'CONSOMMATION', lotNumber: 'L-01' }),
  mv({ id: 'm5', operationId: 'op4', date: '2026-11-05', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -50, reason: 'CONSOMMATION', lotNumber: 'L-02' }),
  // Written by the sales ledger (invoice exit, credit-note return): source-linked, so locked rows.
  mv({ id: 'm6', operationId: 'op6', date: '2026-11-06', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -40, reason: 'VENTE', sourceType: 'SALE' }),
  mv({ id: 'm7', operationId: 'op7', date: '2026-11-07', itemId: 's2', itemName: 'Aliment ponte', type: 'ENTREE', quantity: 10, reason: 'RETOUR', sourceType: 'CREDIT_NOTE' }),
];

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const DETAIL = {
  ...STOCK[1],
  batches: [
    { id: 'b1', lotNumber: 'L-OLD', expiryDate: plusDays(-5), receivedDate: '2026-01-02', quantity: 100, expiry: 'expired' },
    { id: 'b2', lotNumber: 'L-SOON', expiryDate: plusDays(10), receivedDate: '2026-10-02', quantity: 200, expiry: 'soon' },
    { id: 'b3', lotNumber: 'L-FAR', expiryDate: plusDays(200), receivedDate: '2026-11-02', quantity: 600, expiry: 'ok' },
  ],
};

// A draft as the API returns it: one line per active article (the theoretical quantity at the session date), counts null until saved.
const draftLine = (id: string, name: string, theoreticalQty: number, countedQty: number | null = null, difference: number | null = null) =>
  ({ itemId: id, itemName: name, unit: 'kg', theoreticalQty, countedQty, difference });
const DRAFT = {
  id: 'i1', date: '2026-11-10', status: 'BROUILLON', note: null, lineCount: 0,
  lines: STOCK.map((s) => draftLine(s.id, s.name, s.quantity)),
};
const DONE = {
  id: 'i2', date: '2026-11-01', status: 'VALIDEE', note: null, lineCount: 1,
  lines: [{ itemId: 's2', itemName: 'Aliment ponte', unit: 'kg', theoreticalQty: 900, countedQty: 880, difference: -20 }],
};

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

/** Set per test to make a write fail. */
let failWith: { url: RegExp; status: number; message: string } | null = null;
let detailData = DETAIL as StockItemDetailData;
let draftData: unknown = DRAFT;

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
    if (url.startsWith('/api/stock/movements')) {
      // The operation loader asks for one day of one item: answer it like the API would.
      const q = new URL(url, 'http://x').searchParams;
      const day = q.get('from');
      return page(day ? MOVEMENTS.filter((m) => m.date === day) : MOVEMENTS);
    }
    if (/^\/api\/stock\/s2(\?|$)/.test(url)) return json(200, detailData);
    if (/^\/api\/stock\/s9(\?|$)/.test(url)) return json(404, { message: 'Introuvable' });
    if (url.startsWith('/api/stock')) return page(STOCK, { levelCounts: LEVEL_COUNTS });
    if (/^\/api\/inventories\/i1(\?|$)/.test(url)) return json(200, draftData);
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
  detailData = DETAIL as StockItemDetailData;
  draftData = DRAFT;
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
      body: { itemId: 's2', date: todayIso(), type: 'SORTIE', quantity: 5000, reason: 'PERTE' },
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
      itemId: 's2', date: todayIso(), type: 'ENTREE', quantity: 1000, unitCost: 320, reason: 'ACHAT', lotNumber: 'L-77', expiryDate: '2027-03-01',
    });

    await user.click(ponte().getByRole('button', { name: 'Ajustement' }));
    dialog = await screen.findByRole('dialog', { name: 'Ajustement — Aliment ponte' });
    await user.type(within(dialog).getByLabelText('Écart (signé)'), '-20');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toMatchObject({ type: 'AJUSTEMENT', quantity: -20, reason: 'AUTRE' });
  });

  it('trims the note and the lot number, and leaves a blank one out', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Entrée' }));
    const dialog = await screen.findByRole('dialog', { name: 'Entrée — Aliment ponte' });
    await user.type(within(dialog).getByLabelText('Quantité'), '5');
    await user.type(within(dialog).getByLabelText('Coût unitaire (FCFA)'), '320');
    await user.type(within(dialog).getByLabelText('N° de lot'), '  L-9  ');
    await user.type(within(dialog).getByLabelText('Note'), '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ itemId: 's2', date: todayIso(), type: 'ENTREE', quantity: 5, unitCost: 320, reason: 'ACHAT', lotNumber: 'L-9' });
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

  it('labels the sales movements (Vente, Retour client) and locks them like any source-linked row', async () => {
    const user = await openMovements({ perms: ['read', 'create'] });
    const sold = within(screen.getByText('2026-11-06').closest('tr')!);
    expect(sold.getByText('Vente')).toBeInTheDocument();
    expect(sold.getByText('-40')).toBeInTheDocument();
    const back = within(screen.getByText('2026-11-07').closest('tr')!);
    expect(back.getByText('Retour client')).toBeInTheDocument();
    for (const r of [sold, back]) {
      const edit = r.getByRole('button', { name: 'Modifier' });
      expect(edit).toHaveAttribute('aria-disabled', 'true');
      await user.hover(edit);
      expect(edit).toHaveAttribute('title', "Mouvement issu d'une autre opération");
    }
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

describe('stock movements: the API contract', () => {
  async function openMovements() {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Mouvements' }));
    await screen.findByText('2026-11-03');
    return user;
  }

  it('edits a split exit by the quantity of the whole operation, not of the piece clicked', async () => {
    const user = await openMovements();
    // The two pieces (300 on L-01, 50 on L-02) are one operation of 350.
    const piece = screen.getByText('L-02').closest('tr')!;
    await user.click(within(piece).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité')).toHaveValue(350));
    expect(calls.some((c) => c.url.startsWith('/api/stock/movements?') && c.url.includes('itemId=s2') && c.url.includes('from=2026-11-05') && c.url.includes('to=2026-11-05'))).toBe(true);
    await user.clear(within(dialog).getByLabelText('Quantité'));
    await user.type(within(dialog).getByLabelText('Quantité'), '320');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/stock/movements/m5', body: { quantity: 320 } });
  });

  it('sums the pieces of an exit without float drift (0.1 + 0.2 is 0.3)', async () => {
    const pieces = [
      mv({ id: 'm6', operationId: 'op6', date: '2026-11-05', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -0.1, reason: 'CONSOMMATION', lotNumber: 'L-03' }),
      mv({ id: 'm7', operationId: 'op6', date: '2026-11-05', itemId: 's2', itemName: 'Aliment ponte', type: 'SORTIE', quantity: -0.2, reason: 'CONSOMMATION', lotNumber: 'L-04' }),
    ];
    MOVEMENTS.push(...pieces);
    try {
      const user = await openMovements();
      await user.click(within(screen.getByText('L-04').closest('tr')!).getByRole('button', { name: 'Modifier' }));
      const dialog = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
      await waitFor(() => expect(within(dialog).getByLabelText('Quantité')).toHaveValue(0.3));
    } finally {
      MOVEMENTS.splice(MOVEMENTS.length - pieces.length, pieces.length);
    }
  });

  it('says the quantity is the total of the operation when it has several pieces, and only then', async () => {
    const user = await openMovements();
    await user.click(within(screen.getByText('L-02').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const split = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
    expect(await within(split).findByText('Cette sortie est répartie sur 2 lots : la quantité modifiée est le total.')).toBeInTheDocument();
    await user.click(within(split).getByRole('button', { name: 'Annuler' }));
    await user.click(within(screen.getByText('2026-11-03').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const single = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
    await within(single).findByLabelText('Quantité');
    expect(within(single).queryByText(/répartie sur/)).not.toBeInTheDocument();
  });

  it('reads the total again each time the dialog opens (no stale cached total)', async () => {
    const user = await openMovements();
    const edit = () => within(screen.getByText('L-02').closest('tr')!).getByRole('button', { name: 'Modifier' });
    await user.click(edit());
    let dialog = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité')).toHaveValue(350));
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    // Another user corrected the operation meanwhile.
    MOVEMENTS[4] = { ...MOVEMENTS[4], quantity: -80 } as (typeof MOVEMENTS)[number];
    try {
      await user.click(edit());
      dialog = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
      await waitFor(() => expect(within(dialog).getByLabelText('Quantité')).toHaveValue(380));
    } finally {
      MOVEMENTS[4] = { ...MOVEMENTS[4], quantity: -50 } as (typeof MOVEMENTS)[number];
    }
  });

  it('does not offer the reason of an exit on edit (the API cannot change it) and sends only what changed', async () => {
    const user = await openMovements();
    await user.click(within(screen.getByText('2026-11-03').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Mouvements' });
    expect(within(dialog).queryByLabelText('Motif')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Note'), 'sac percé');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ note: 'sac percé' });
  });

  it('deletes a movement through its own id (the API removes the whole operation)', async () => {
    const user = await openMovements();
    await user.click(within(screen.getByText('L-02').closest('tr')!).getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/stock/movements/m5' });
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
    expect(screen.getByTestId('gap-2')).toHaveTextContent('Écart ligne 2 : −20');

    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: '/api/inventories/i1/lines', body: { lines: [{ itemId: 's2', countedQty: 880 }] } });

    await user.click(screen.getByRole('button', { name: "Valider l'inventaire" }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("Valider l'inventaire du 2026-11-10 ? Les écarts seront enregistrés comme ajustements. Les articles non comptés sont ignorés.")).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      'PUT /api/inventories/i1/lines', 'PUT /api/inventories/i1/lines', 'POST /api/inventories/i1/validate',
    ]));
  });

  it('lets the storekeeper (create, no delete) delete a draft only, as the API\'s daily rule allows', async () => {
    mountPage({ perms: ['read', 'create'] });
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Inventaires' }));
    const draft = within((await screen.findByRole('link', { name: '2026-11-10' })).closest('tr')!);
    expect(draft.getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute('aria-disabled');
    expect(within(screen.getByRole('link', { name: '2026-11-01' }).closest('tr')!).getByRole('button', { name: 'Supprimer' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(draft.getByRole('button', { name: 'Supprimer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/inventories/i1' });
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
    expect(screen.getByTestId('gap-1')).toHaveTextContent('−20');
    expect(screen.queryByRole('button', { name: 'Enregistrer le brouillon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Valider l'inventaire" })).not.toBeInTheDocument();
  });
});

describe('stocks list: fix round 1', () => {
  it('keeps the created item when the thresholds fail: the retry only redoes the thresholds', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Stocks' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Désinfectant');
    await user.selectOptions(within(dialog).getByLabelText('Catégorie'), 'Consommable');
    await user.type(within(dialog).getByLabelText('Unité'), 'litres');
    await user.type(within(dialog).getByLabelText('Seuil minimum'), '10');
    failWith = { url: /thresholds$/, status: 500, message: 'Erreur serveur' };
    const listCalls = () => calls.filter((c) => c.method === 'GET' && /^\/api\/stock\?/.test(c.url)).length;
    const before = listCalls();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("Article créé, mais les seuils n'ont pas été enregistrés : Erreur serveur")).toBeInTheDocument();
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));

    failWith = null;
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      'POST /api/stock-items', 'PUT /api/stock/new1/thresholds', 'PUT /api/stock/new1/thresholds',
    ]);
  });

  it('sends a cleared maximum threshold as null', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Stocks' });
    await user.clear(within(dialog).getByLabelText('Seuil maximum'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: '/api/stock/s2/thresholds', body: { minQty: 1500, maxQty: null } });
  });

  it('deactivates an item through the item endpoint, sending active only when changed', async () => {
    mountPage();
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Stocks' });
    expect(within(dialog).getByRole('checkbox', { name: 'Actif' })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Actif' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/stock-items/s2', body: { active: false } });
  });
});

describe('batch expiry pills', () => {
  it('renders the pill from the API expiry, not from the date (the alerts and the page agree)', async () => {
    // Dates deliberately contradict the states: only the API value decides.
    detailData = {
      ...(DETAIL as StockItemDetailData),
      batches: [
        { id: 'x1', lotNumber: 'L-EXPIRED', expiryDate: '2099-01-01', receivedDate: '2026-10-01', quantity: 1, expiry: 'expired' },
        { id: 'x2', lotNumber: 'L-SOON', expiryDate: '2099-01-01', receivedDate: '2026-10-01', quantity: 1, expiry: 'soon' },
        { id: 'x3', lotNumber: 'L-OK', expiryDate: '2000-01-01', receivedDate: '2026-10-01', quantity: 1, expiry: 'ok' },
        { id: 'x4', lotNumber: 'L-NONE', expiryDate: null, receivedDate: '2026-10-01', quantity: 1, expiry: 'ok' },
      ],
    };
    mountDetail('s2');
    await screen.findByText('L-SOON');
    const pill = (lot: string) => within(screen.getByText(lot).closest('tr')!);
    expect(pill('L-EXPIRED').getByText('Périmé')).toBeInTheDocument();
    expect(pill('L-SOON').getByText('Bientôt périmé')).toBeInTheDocument();
    expect(pill('L-OK').queryByText(/périmé/i)).not.toBeInTheDocument();
    expect(pill('L-NONE').queryByText(/périmé/i)).not.toBeInTheDocument();
  });
});

describe('inventory: fix round 1', () => {
  it('names the read-only and computed cells and gives the gap a sign in text', async () => {
    mountDetail('inv-i1');
    const user = userEvent.setup();
    const counted = await screen.findByLabelText('Compté ligne 2');
    expect(screen.getByText('Article ligne 2 :')).toBeInTheDocument();
    expect(screen.getByText('Théorique ligne 2 :')).toBeInTheDocument();
    await user.type(counted, '905');
    expect(screen.getByTestId('gap-2')).toHaveTextContent('Écart ligne 2 : +5');
  });

  it('refuses a negative count on save and on validation, with the message under the grid', async () => {
    mountDetail('inv-i1');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Compté ligne 2'), '-3');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    expect(await screen.findByText('Ligne 2 : le champ « Compté » doit être supérieur ou égal à 0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Valider l'inventaire" }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('shows a validation failure after the save and lets a retry go through', async () => {
    mountDetail('inv-i1');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Compté ligne 2'), '880');
    await user.click(screen.getByRole('button', { name: "Valider l'inventaire" }));
    const dialog = await screen.findByRole('dialog');
    failWith = { url: /validate$/, status: 409, message: 'Inventaire déjà validé' };
    await user.click(within(dialog).getByRole('button', { name: 'Valider' }));
    expect(await within(dialog).findByText('Inventaire déjà validé')).toBeInTheDocument();
    failWith = null;
    await user.click(within(dialog).getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes().map((w) => `${w.method} ${w.url}`)).toEqual([
      'PUT /api/inventories/i1/lines', 'POST /api/inventories/i1/validate', 'PUT /api/inventories/i1/lines', 'POST /api/inventories/i1/validate',
    ]);
  });

  it('is read-only under all farms', async () => {
    mountDetail('inv-i1', { farm: 'all' });
    expect(await screen.findByLabelText('Compté ligne 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Enregistrer le brouillon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Valider l'inventaire" })).not.toBeInTheDocument();
  });
});

describe('inventory draft grid: built from the session response only', () => {
  const draftWith = (lines: unknown[]) => { draftData = { ...DRAFT, lines }; };

  it('does not read /stock: the theoretical quantities come from the session', async () => {
    mountDetail('inv-i1');
    await screen.findByLabelText('Compté ligne 2');
    expect(calls.some((c) => /^\/api\/stock(\?|\/|$)/.test(c.url))).toBe(false);
    // Theoretical column: the session's own figures (4 200 on line 1).
    expect(screen.getByText('Théorique ligne 1 :').parentElement?.textContent).toBe('Théorique ligne 1 : 4\u202f200');
  });

  it('shows the API gap of a saved row, and the local rounded gap once the count is edited', async () => {
    draftWith([draftLine('s1', 'Aliment croissance chair', 4200, 4180, -20), draftLine('s2', 'Aliment ponte', 900)]);
    mountDetail('inv-i1');
    const user = userEvent.setup();
    await screen.findByLabelText('Compté ligne 1');
    expect(screen.getByLabelText('Compté ligne 1')).toHaveValue(4180);
    expect(screen.getByTestId('gap-1')).toHaveTextContent('Écart ligne 1 : −20');
    expect(screen.getByTestId('gap-2')).toHaveTextContent('—');
    await user.clear(screen.getByLabelText('Compté ligne 1'));
    await user.type(screen.getByLabelText('Compté ligne 1'), '4190');
    expect(screen.getByTestId('gap-1')).toHaveTextContent('Écart ligne 1 : −10');
  });

  it('rounds the gap to 2 decimals (10.3 counted against 10.1 is +0.2, not +0.20000000000000107)', async () => {
    draftWith([draftLine('s1', 'Aliment croissance chair', 10.1)]);
    mountDetail('inv-i1');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Compté ligne 1'), '10.3');
    expect(screen.getByTestId('gap-1')).toHaveTextContent('Écart ligne 1 : +0.2');
    expect(screen.getByTestId('gap-1')).not.toHaveTextContent('0000');
  });

  it('says there is no active article when the session has no line', async () => {
    draftWith([]);
    mountDetail('inv-i1');
    expect(await screen.findByText('Aucun article actif')).toBeInTheDocument();
    expect(screen.queryByLabelText('Compté ligne 1')).not.toBeInTheDocument();
  });

  it('re-reads the session after a save: the gap is the one the API now returns', async () => {
    draftWith([draftLine('s1', 'Aliment croissance chair', 4200)]);
    mountDetail('inv-i1');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Compté ligne 1'), '4180');
    expect(screen.getByTestId('gap-1')).toHaveTextContent('Écart ligne 1 : −20');
    // What the server holds once the count is saved: its own theoretical quantity and gap (4 190 at the session date).
    draftWith([draftLine('s1', 'Aliment croissance chair', 4190, 4180, -10)]);
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await screen.findByText('Brouillon enregistré');
    await waitFor(() => expect(screen.getByTestId('gap-1')).toHaveTextContent('Écart ligne 1 : −10'));
    expect(screen.getByText('Théorique ligne 1 :').parentElement?.textContent).toBe('Théorique ligne 1 : 4\u202f190');
    expect(screen.getByLabelText('Compté ligne 1')).toHaveValue(4180);
  });

  it('keeps the saved count of an article no longer active in the grid and in the saved lines', async () => {
    draftWith([draftLine('s1', 'Aliment croissance chair', 4200), draftLine('old', 'Ancien article', 7, 5, -2)]);
    mountDetail('inv-i1');
    const user = userEvent.setup();
    expect(await screen.findByText('Ancien article')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Compté ligne 1'), '4000');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ lines: [{ itemId: 's1', countedQty: 4000 }, { itemId: 'old', countedQty: 5 }] });
  });
});
