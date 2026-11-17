import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModuleList, ModulePage } from '../components/module/ModulePage';
import { alimentation } from './alimentation';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];

const DISTRIBUTIONS = [
  { id: 'd1', date: '2026-10-22', target: 'LC-2026-14', targetKind: 'LOT', batchId: 'l1', buildingId: null, feedName: 'Croissance chair', feedProductId: 'p1', formulaId: null, quantityKg: 620, waterLiters: 1250, unitCost: 340, cost: 210800, note: null },
  { id: 'd2', date: '2026-10-22', target: 'Porcherie 1', targetKind: 'BATIMENT', batchId: null, buildingId: 'b2', feedName: 'Engraissement porc', feedProductId: null, formulaId: 'f1', quantityKg: 540, waterLiters: null, unitCost: 280, cost: 151200, note: null },
];
let distributions: unknown[] = DISTRIBUTIONS;
const PRODUCTS = [
  { id: 'p1', name: 'Croissance chair', kind: 'ALIMENT_COMPLET', unit: 'kg', unitCost: 340, active: true },
  { id: 'p2', name: 'Maïs', kind: 'MATIERE_PREMIERE', unit: 'kg', unitCost: 200, active: true },
  { id: 'p3', name: 'Tourteau de soja', kind: 'MATIERE_PREMIERE', unit: 'kg', unitCost: 400, active: false },
];
const FORMULAS = [
  { id: 'f1', name: 'Engraissement porc', species: 'PORCIN', stage: 'Engraissement', active: true, costPerKg: 280, items: [{ feedProductId: 'p2', name: 'Maïs', percentage: 100, unitCost: 280 }] },
];

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

function mount(ui: React.ReactNode, { perms = ALL, farm, modules = {} }: { perms?: string[]; farm?: string; modules?: Record<string, string[]> } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: { alimentation: perms, lots: perms, porcs: perms, ...modules } });
    }
    if (call.method !== 'GET') return json(201, { id: 'x' });
    const url = call.url;
    if (url.startsWith('/api/feed-distributions')) return page(distributions);
    if (url.startsWith('/api/feed-products')) return page(url.includes('active=true') ? PRODUCTS.filter((p) => p.active) : PRODUCTS);
    if (url.startsWith('/api/feed-formulas')) return page(FORMULAS);
    if (url.startsWith('/api/stock-items')) return page([{ id: 'si1', name: 'Maïs (stock)' }]);
    if (url.startsWith('/api/batches')) {
      return url.includes('species=PORCIN') ? page([{ id: 'l9', code: 'LOT-ENG-07' }]) : page([{ id: 'l1', code: 'LC-2026-14' }]);
    }
    if (url.startsWith('/api/buildings')) return page([{ id: 'b2', name: 'Porcherie 1' }]);
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
  mount(<Routes><Route path="*" element={<ModulePage config={alimentation} />} /></Routes>, opts);

beforeEach(() => {
  distributions = DISTRIBUTIONS;
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

describe('alimentation costs', () => {
  it('hides the COÛT column without finance:read', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    expect(screen.queryByRole('columnheader', { name: 'COÛT' })).not.toBeInTheDocument();
    expect(screen.queryByText('210 800 FCFA')).not.toBeInTheDocument();
  });

  it('shows a dash for a null cost with finance:read, never 0 FCFA', async () => {
    distributions = DISTRIBUTIONS.map((d) => ({ ...d, cost: null, unitCost: null }));
    mountPage({ modules: { finance: ['read'] } });
    const row = (await screen.findByText('LC-2026-14')).closest('tr')!;
    expect(screen.getByRole('columnheader', { name: 'COÛT' })).toBeInTheDocument();
    expect(within(row).getAllByText('—')).toHaveLength(1);
    expect(row.textContent).not.toMatch(/FCFA/);
  });
});

describe('alimentation', () => {
  it('renders the reference headers, tile, subtitle, tabs and figures', async () => {
    mountPage({ modules: { finance: ['read'] } });
    expect(await screen.findByText('LC-2026-14')).toBeInTheDocument();
    for (const h of ['DATE', 'LOT / BÂTIMENT', 'ALIMENT', 'ALIMENT (KG)', 'EAU (L)', 'COÛT']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText("Distributions d'aliment et consommation d'eau par lot.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Total enregistrements', { selector: 'p' }).nextElementSibling).toHaveTextContent('2'));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Distributions', 'Aliments', 'Formules']);
    const first = screen.getByText('LC-2026-14').closest('tr')!;
    for (const t of ['2026-10-22', 'Croissance chair', '620', '1 250', '210 800 FCFA']) expect(within(first).getByText(t)).toBeInTheDocument();
    const second = screen.getByText('Porcherie 1').closest('tr')!;
    expect(within(second).getByText('—')).toBeInTheDocument();
    expect(within(second).getByText('151 200 FCFA')).toBeInTheDocument();
  });

  it('adds a distribution on a lot of either species with a product and water', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Alimentation & eau' });
    const lot = within(dialog).getByRole('combobox', { name: 'Lot' });
    await waitFor(() => expect(within(lot).getByRole('option', { name: 'LOT-ENG-07' })).toBeInTheDocument());
    await user.selectOptions(lot, 'LC-2026-14');
    const product = within(dialog).getByRole('combobox', { name: 'Aliment' });
    await waitFor(() => expect(within(product).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    expect(within(product).queryByRole('option', { name: 'Tourteau de soja' })).not.toBeInTheDocument();
    await user.selectOptions(product, 'Maïs');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-02' } });
    await user.type(within(dialog).getByLabelText('Quantité (kg)'), '50.5');
    await user.type(within(dialog).getByLabelText('Eau (L)'), '120');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/feed-distributions',
      body: { date: '2026-11-02', batchId: 'l1', feedProductId: 'p2', quantityKg: 50.5, waterLiters: 120 },
    });
    expect(calls.some((c) => c.url.includes('/api/batches?') && c.url.includes('species=AVICOLE') && c.url.includes('status=EN_COURS'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/api/feed-products?') && c.url.includes('active=true'))).toBe(true);
  });

  it('adds a distribution on a building with a formula, without water', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Bâtiment' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Formule' }));
    const building = within(dialog).getByRole('combobox', { name: 'Bâtiment' });
    await waitFor(() => expect(within(building).getByRole('option', { name: 'Porcherie 1' })).toBeInTheDocument());
    await user.selectOptions(building, 'Porcherie 1');
    const formula = within(dialog).getByRole('combobox', { name: 'Formule' });
    await waitFor(() => expect(within(formula).getByRole('option', { name: 'Engraissement porc' })).toBeInTheDocument());
    await user.selectOptions(formula, 'Engraissement porc');
    await user.type(within(dialog).getByLabelText('Quantité (kg)'), '540');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = writes()[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ buildingId: 'b2', formulaId: 'f1', quantityKg: 540 });
    expect(body).not.toHaveProperty('waterLiters');
    expect(body).not.toHaveProperty('batchId');
    expect(body).not.toHaveProperty('feedProductId');
  });

  it('asks for a target, a feed and a positive quantity', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le champ « Lot » est requis')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('inside a lot, hides the target and posts the scope', async () => {
    mount(<ModuleList config={alimentation} scope={{ batchId: 'l1' }} />);
    await screen.findByText('LC-2026-14');
    expect(calls.some((c) => c.url.startsWith('/api/feed-distributions?') && c.url.includes('batchId=l1'))).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Cible')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Lot' })).not.toBeInTheDocument();
    const product = within(dialog).getByRole('combobox', { name: 'Aliment' });
    await waitFor(() => expect(within(product).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    await user.selectOptions(product, 'Maïs');
    await user.type(within(dialog).getByLabelText('Quantité (kg)'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ batchId: 'l1', feedProductId: 'p2', quantityKg: 10 });
    expect(calls.some((c) => c.url.startsWith('/api/batches?'))).toBe(false);
  });

  it('edits with the stored target and feed preselected and sends only what changed', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Alimentation & eau' });
    expect(within(dialog).getByRole('combobox', { name: 'Lot' })).toHaveValue('l1');
    expect(within(dialog).getByRole('combobox', { name: 'Lot' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Aliment' })).toHaveValue('p1'));
    expect(within(dialog).getByLabelText('Quantité (kg)')).toHaveValue(620);
    expect(within(dialog).getByLabelText('Eau (L)')).toHaveValue(1250);
    await user.clear(within(dialog).getByLabelText('Quantité (kg)'));
    await user.type(within(dialog).getByLabelText('Quantité (kg)'), '650');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/feed-distributions/d1', body: { quantityKg: 650 } });
    expect(writes()[0].body).toEqual({ quantityKg: 650 });
  });

  it('sends the new feed id when the feed changes', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    const product = within(dialog).getByRole('combobox', { name: 'Aliment' });
    await waitFor(() => expect(within(product).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    await user.selectOptions(product, 'Maïs');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ feedProductId: 'p2' });
  });

  it('edits a distribution whose product is no longer selectable, and restores the stored feed when toggling back', async () => {
    PRODUCTS[0].active = false;
    try {
      mountPage();
      await screen.findByText('LC-2026-14');
      const user = userEvent.setup();
      await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('combobox', { name: 'Aliment' })).toHaveValue('p1');
      await user.click(within(dialog).getByRole('radio', { name: 'Formule' }));
      expect(within(dialog).getByRole('combobox', { name: 'Formule' })).toHaveValue('');
      await user.click(within(dialog).getByRole('radio', { name: 'Aliment' }));
      await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Aliment' })).toHaveValue('p1'));
      await user.clear(within(dialog).getByLabelText('Quantité (kg)'));
      await user.type(within(dialog).getByLabelText('Quantité (kg)'), '700');
      await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0].body).toEqual({ quantityKg: 700 });
    } finally {
      PRODUCTS[0].active = true;
    }
  });

  it('asks for a new feed when the kind was changed on an edit', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Formule' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le champ « Formule » est requis')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('refuses to empty the water of the row that carries it', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Eau du jour pour cette cible (une seule valeur par jour)')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Eau (L)'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("La consommation d'eau ne peut pas être vidée ici")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('disables the water of a row that is not the first of its target and day, and never sends it', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('Porcherie 1').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Eau (L)')).toBeDisabled();
    expect(within(dialog).getByText("La consommation d'eau du jour est portée par la première distribution")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Quantité (kg)'));
    await user.type(within(dialog).getByLabelText('Quantité (kg)'), '500');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ quantityKg: 500 });
  });

  describe('water, when the API says whether the row may carry it (waterEditable)', () => {
    const edit = async (target: string) => {
      mountPage();
      await screen.findByText('LC-2026-14');
      const user = userEvent.setup();
      await user.click(within(screen.getByText(target).closest('tr')!).getByRole('button', { name: 'Modifier' }));
      return { user, dialog: await screen.findByRole('dialog') };
    };
    const withFlag = async (index: number, flag: boolean, run: () => Promise<void>) => {
      Object.assign(DISTRIBUTIONS[index], { waterEditable: flag });
      try {
        await run();
      } finally {
        delete (DISTRIBUTIONS[index] as { waterEditable?: boolean }).waterEditable;
      }
    };

    it('adds water to a distribution that has none', async () => {
      await withFlag(1, true, async () => {
        const { user, dialog } = await edit('Porcherie 1');
        expect(within(dialog).getByLabelText('Eau (L)')).toBeEnabled();
        await user.type(within(dialog).getByLabelText('Eau (L)'), '300');
        await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
        await waitFor(() => expect(writes()).toHaveLength(1));
        expect(writes()[0].body).toEqual({ waterLiters: 300 });
      });
    });

    it('changes the water, and clears it as null', async () => {
      await withFlag(0, true, async () => {
        const { user, dialog } = await edit('LC-2026-14');
        await user.clear(within(dialog).getByLabelText('Eau (L)'));
        await user.type(within(dialog).getByLabelText('Eau (L)'), '1300');
        await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
        await waitFor(() => expect(writes()).toHaveLength(1));
        expect(writes()[0].body).toEqual({ waterLiters: 1300 });
      });
      calls.length = 0;
      cleanup();
      await withFlag(0, true, async () => {
        const { user, dialog } = await edit('LC-2026-14');
        await user.clear(within(dialog).getByLabelText('Eau (L)'));
        await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
        await waitFor(() => expect(writes()).toHaveLength(1));
        expect(writes()[0].body).toEqual({ waterLiters: null });
      });
    });

    it('disables the water of a row the API says cannot carry it, even when it holds a value', async () => {
      await withFlag(0, false, async () => {
        const { dialog } = await edit('LC-2026-14');
        expect(within(dialog).getByLabelText('Eau (L)')).toBeDisabled();
        expect(within(dialog).getByText("La consommation d'eau du jour est portée par la première distribution")).toBeInTheDocument();
      });
    });
  });

  it('sends nothing when an edit changes nothing', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);
  });

  it('shows the server message when the API refuses', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('LC-2026-14').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    fetchMock.mockImplementationOnce(async () => json(400, { message: 'La date ne peut pas être dans le futur' }));
    await user.clear(within(dialog).getByLabelText('Quantité (kg)'));
    await user.type(within(dialog).getByLabelText('Quantité (kg)'), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('La date ne peut pas être dans le futur')).toBeInTheDocument();
  });
});

describe('aliments', () => {
  it('lists products with their unit cost and adds one, even under all farms', async () => {
    mountPage({ farm: 'all' });
    await screen.findByText('LC-2026-14');
    // Distributions are farm-owned: no add under "all farms".
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Aliments' }));
    expect(await screen.findByText('Maïs')).toBeInTheDocument();
    for (const h of ['NOM', 'TYPE', 'COÛT UNITAIRE', 'ACTIF']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    const row = screen.getByText('Maïs').closest('tr')!;
    expect(within(row).getByText('Matière première')).toBeInTheDocument();
    expect(within(row).getByText('200 FCFA/kg')).toBeInTheDocument();
    expect(within(screen.getByText('Tourteau de soja').closest('tr')!).getByText('Inactif')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Aliments' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Son de blé');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Matière première');
    await user.type(within(dialog).getByLabelText('Coût unitaire (FCFA/kg)'), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/feed-products',
      body: { name: 'Son de blé', kind: 'MATIERE_PREMIERE', unitCost: 150, active: true },
    });
  });
});

describe('aliments: stock article', () => {
  it('offers the feed stock items and sends the chosen one as stockItemId', async () => {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Aliments' }));
    await screen.findByText('Maïs');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Aliments' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Son de blé');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Matière première');
    await user.type(within(dialog).getByLabelText('Coût unitaire (FCFA/kg)'), '150');
    const article = within(dialog).getByLabelText('Article de stock');
    await waitFor(() => expect(within(article).getByRole('option', { name: 'Maïs (stock)' })).toBeInTheDocument());
    expect(calls.some((c) => c.url.startsWith('/api/stock-items?') && c.url.includes('category=ALIMENT') && c.url.includes('active=true'))).toBe(true);
    await user.selectOptions(article, 'Maïs (stock)');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ name: 'Son de blé', stockItemId: 'si1' });
  });
});

describe('formules', () => {
  async function openForm() {
    mountPage();
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Formules' }));
    expect(await screen.findByText('Engraissement porc')).toBeInTheDocument();
    return user;
  }

  it('lists formulas with their cost per kg', async () => {
    await openForm();
    for (const h of ['NOM', 'ESPÈCE', 'STADE', 'COÛT / KG']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    const row = screen.getByText('Engraissement porc').closest('tr')!;
    for (const t of ['Porcin', 'Engraissement', '280 FCFA']) expect(within(row).getByText(t)).toBeInTheDocument();
  });

  it('adds lines, follows the total and the live cost per kg, and posts the items at 100 %', async () => {
    const user = await openForm();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Formules' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Ponte phase 2');
    await user.type(within(dialog).getByLabelText('Stade'), 'Ponte');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());

    await user.selectOptions(within(dialog).getByLabelText('Aliment ligne 1'), 'Maïs');
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 1'), '60');
    expect(within(dialog).getByTestId('formula-total')).toHaveTextContent('Total : 60% (doit atteindre 100%)');
    expect(within(dialog).getByTestId('formula-cost')).toHaveTextContent('120 FCFA');

    await user.click(within(dialog).getByRole('button', { name: 'Ajouter une ligne' }));
    const second = within(dialog).getByLabelText('Aliment ligne 2');
    // The product of line 1 is not offered again; an inactive product is not offered for a new line.
    expect(within(second).queryByRole('option', { name: 'Maïs' })).not.toBeInTheDocument();
    expect(within(second).queryByRole('option', { name: 'Tourteau de soja' })).not.toBeInTheDocument();
    await user.selectOptions(second, 'Croissance chair');
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 2'), '40');
    expect(within(dialog).getByTestId('formula-total')).toHaveTextContent(/^Total : 100%$/);
    expect(within(dialog).getByTestId('formula-cost')).toHaveTextContent('256 FCFA');

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/feed-formulas',
      body: {
        name: 'Ponte phase 2', species: 'AVICOLE', stage: 'Ponte', active: true,
        items: [{ feedProductId: 'p2', percentage: 60 }, { feedProductId: 'p1', percentage: 40 }],
      },
    });
  });

  it('shows two decimals when the total is not exactly 100, never 100% next to the warning', async () => {
    const user = await openForm();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Aliment ligne 1'), 'Maïs');
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 1'), '99.95');
    expect(within(dialog).getByTestId('formula-total')).toHaveTextContent('Total : 99.95% (doit atteindre 100%)');
  });

  it('shows an error when the products catalogue cannot be loaded', async () => {
    const user = await openForm();
    fetchMock.mockImplementation(async (input) => (String(input).startsWith('/api/feed-products') ? json(500, { message: 'Erreur serveur' }) : page([])));
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Erreur serveur')).toBeInTheDocument();
  });

  it('refuses a total below 100 % without a request, and removes a line', async () => {
    const user = await openForm();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nom'), 'X');
    await user.type(within(dialog).getByLabelText('Stade'), 'Y');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maïs' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Aliment ligne 1'), 'Maïs');
    await user.type(within(dialog).getByLabelText('Pourcentage ligne 1'), '90');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Les pourcentages doivent totaliser 100 %')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Ajouter une ligne' }));
    expect(within(dialog).getByLabelText('Aliment ligne 2')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Retirer la ligne 2' }));
    expect(within(dialog).queryByLabelText('Aliment ligne 2')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Retirer la ligne 1' })).toBeDisabled();
  });

  it('edits a formula and sends only the changed fields', async () => {
    const user = await openForm();
    await user.click(within(screen.getByText('Engraissement porc').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Formules' });
    expect(within(dialog).getByLabelText('Pourcentage ligne 1')).toHaveValue(100);
    await user.clear(within(dialog).getByLabelText('Stade'));
    await user.type(within(dialog).getByLabelText('Stade'), 'Finition');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/feed-formulas/f1', body: { stage: 'Finition' } });
    expect(writes()[0].body).toEqual({ stage: 'Finition' });
  });
});
