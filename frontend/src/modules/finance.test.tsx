import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import { todayIso } from '../lib/format';
import { LotDetail } from '../pages/details/LotDetail';
import { MODULES } from './registry';
import './index';
import { finance } from './finance';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'COMPTABLE', twoFactorEnabled: true };
/** Spaces of every kind (the formatters use narrow and no-break ones) as one plain space. */
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const cells = (tr: Element | null) => flat(Array.from(tr!.querySelectorAll('td')).map((c) => c.textContent).join(' '));
const tone = (scope: ReturnType<typeof within>, text: string) => scope.getByText(text).closest('[data-tone]')?.getAttribute('data-tone');

const entry = (id: string, date: string, label: string, kind: string, activity: string, category: string, amount: number, over: object = {}) => ({
  id, origin: 'MANUEL', sourceId: null, date, label, kind, activity, category, amount, batchId: null, batchCode: null, note: null, editable: true, ...over,
});
const ENTRIES = [
  entry('m1', '2026-10-01', 'Salaires septembre', 'DEPENSE', 'GENERAL', 'SALAIRES', 950000),
  entry('m2', '2026-10-03', 'Aliment chair 6 t', 'DEPENSE', 'AVICOLE', 'ALIMENT', 1020000),
  entry('m3', '2026-10-08', 'Électricité CEET', 'DEPENSE', 'GENERAL', 'ENERGIE', 185000),
  entry('m4', '2026-10-10', 'Vaccins & médicaments', 'DEPENSE', 'AVICOLE', 'SANTE', 120000),
  entry('m5', '2026-10-14', 'Aliment porc 2 t', 'DEPENSE', 'PORCIN', 'ALIMENT', 560000),
];
const DERIVED = [
  entry('facture:i1:AVICOLE:VENTE_ANIMAUX', '2026-10-21', 'Facture FA-0310 — Restaurant Le Palmier', 'RECETTE', 'AVICOLE', 'VENTE_ANIMAUX', 1050000, { origin: 'FACTURE', sourceId: 'i1', editable: false }),
  entry('avoir:cn1:AVICOLE:VENTE_ANIMAUX', '2026-11-02', 'Avoir AV-0001 — Restaurant Le Palmier (FA-0310)', 'RECETTE', 'AVICOLE', 'VENTE_ANIMAUX', -105000, { origin: 'AVOIR', sourceId: 'cn1', editable: false }),
  entry('achat:p1:ALIMENT', '2026-10-30', 'Achat BC-0142 — Agro Provende SA', 'DEPENSE', 'AVICOLE', 'ALIMENT', 930000, { origin: 'ACHAT', sourceId: 'p1', editable: false }),
];

const SUMMARY = {
  from: '2026-10-01', to: '2026-10-31', revenue: 3970000, expenses: 2835000, margin: 1135000, marginPct: 29, receivables: 400000,
  byActivity: [
    { activity: 'Avicole', revenue: 2050000, expenses: 1140000, margin: 910000 },
    { activity: 'Porcin', revenue: 1920000, expenses: 560000, margin: 1360000 },
    { activity: 'Général', revenue: 0, expenses: 1135000, margin: -1135000 },
  ],
  byCategory: [
    { kind: 'DEPENSE', category: 'SALAIRES', label: 'Salaires', amount: 950000 },
    { kind: 'RECETTE', category: 'VENTE_ANIMAUX', label: "Ventes d'animaux", amount: 3970000 },
  ],
};
const BY_FARM = [
  { farmId: 'f1', farmName: 'Ferme Kpalimé', revenue: 3000000, expenses: 2000000, margin: 1000000 },
  { farmId: 'f2', farmName: 'Ferme Atakpamé', revenue: 970000, expenses: 835000, margin: 135000 },
];

const lotRow = (id: string, code: string, species: string, over: object = {}) => ({
  id, batchId: id, code, species, type: 'CHAIR', status: 'EN_COURS', animals: 4820, sold: 270, alive: 4550,
  costs: { animaux: 1500000, aliment: 198400, sante: 24000, autres: 50000 }, totalCost: 1772400, revenue: 945000, margin: -827400,
  costPerAnimal: 367.72, costPerKg: null, ...over,
});
const LOTS = [
  lotRow('l1', 'LC-2026-14', 'AVICOLE'),
  lotRow('l2', 'LC-2026-12', 'AVICOLE', { status: 'CLOTURE', totalCost: 1000000, revenue: 1500000, margin: 500000, costPerAnimal: 200, costPerKg: 1449.28, sold: 5000 }),
  lotRow('p1', 'PC-2026-03', 'PORCIN', { type: 'ENGRAISSEMENT', margin: 0, revenue: 100, totalCost: 100 }),
];
const LOT_DETAIL = {
  id: 'l1', code: 'LC-2026-14', type: 'CHAIR', species: 'AVICOLE', breedId: null, breedName: null, buildingId: 'b1', buildingName: 'Poulailler A',
  entryDate: '2026-09-20', initialCount: 5000, deaths: 0, alive: 5000, mortalityRate: 0, averageWeightG: 1450, status: 'EN_COURS', ageDays: 55,
  supplierName: null, purchasePrice: null, responsibleId: null, responsibleName: null, closedAt: null, notes: null,
  performance: { ageDays: 55, alive: 5000, deaths: 0, mortalityRate: 0, firstWeightG: 42, lastWeightG: 1450, dailyGainG: 55, feedKg: null, feedConversion: null, feedCost: null },
};

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

const COMPTABLE = { finance: ['read', 'create'], ventes: ['read'], achats: ['read'], lots: ['read'], porcs: ['read'] };
const PROPRIETAIRE = { finance: ['read'], ventes: ['read'], lots: ['read'] };

function mount(ui: React.ReactNode, { perms = COMPTABLE, farm, entries = [...ENTRIES, ...DERIVED], summary = SUMMARY }: { perms?: Record<string, string[]>; farm?: string; entries?: unknown[]; summary?: object } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    }
    if (call.method !== 'GET') return json(201, { id: 'new1' });
    const url = call.url;
    if (url.startsWith('/api/finance/entries')) return page(entries);
    if (url.startsWith('/api/finance/summary')) return json(200, summary);
    if (url === '/api/finance/lots/l1') return json(200, LOTS[0]);
    if (url.startsWith('/api/finance/lots')) return page(LOTS);
    if (url.startsWith('/api/batches?') && url.includes('species=AVICOLE')) return page([{ id: 'l1', code: 'LC-2026-14' }]);
    if (url.startsWith('/api/batches?') && url.includes('species=PORCIN')) return page([{ id: 'p1', code: 'PC-2026-03' }]);
    if (/^\/api\/batches\/l1(\?|$)/.test(url)) return json(200, LOT_DETAIL);
    if (/^\/api\/batches\/l1\/(events|weighings)/.test(url)) return page([]);
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
const mountPage = (opts?: Parameters<typeof mount>[1]) => mount(<Routes><Route path="*" element={<ModulePage config={finance} />} /></Routes>, opts);
const rowOf = (text: string) => within(screen.getByText(text).closest('tr')!);

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('finance list', () => {
  it('is registered as the finance module', () => {
    expect(MODULES.finance).toBe(finance);
  });

  it('renders the reference header, the six columns, the tile and the five reference rows with danger pills', async () => {
    mountPage();
    expect(await screen.findByText('Salaires septembre')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dépenses & recettes' })).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Recettes, dépenses, coûts et rentabilité par activité.')).toBeInTheDocument();
    for (const h of ['DATE', 'LIBELLÉ', 'TYPE', 'ACTIVITÉ', 'CATÉGORIE', 'MONTANT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('Total enregistrements', { selector: 'p' })).toBeInTheDocument();
    expect(cells(screen.getByText('Salaires septembre').closest('tr'))).toBe('2026-10-01 Salaires septembre Dépense Général Salaires 950 000 FCFA');
    expect(cells(screen.getByText('Aliment chair 6 t').closest('tr'))).toBe('2026-10-03 Aliment chair 6 t Dépense Avicole Aliment 1 020 000 FCFA');
    expect(cells(screen.getByText('Électricité CEET').closest('tr'))).toBe('2026-10-08 Électricité CEET Dépense Général Énergie 185 000 FCFA');
    expect(cells(screen.getByText('Vaccins & médicaments').closest('tr'))).toBe('2026-10-10 Vaccins & médicaments Dépense Avicole Santé 120 000 FCFA');
    expect(cells(screen.getByText('Aliment porc 2 t').closest('tr'))).toBe('2026-10-14 Aliment porc 2 t Dépense Porcin Aliment 560 000 FCFA');
    expect(tone(rowOf('Salaires septembre'), '950 000 FCFA')).toBe('danger');
  });

  it('shows a revenue as a success pill and a negative revenue (a credit note) as −105 000 FCFA in danger', async () => {
    mountPage();
    await screen.findByText('Salaires septembre');
    const invoice = rowOf('Facture FA-0310 — Restaurant Le Palmier');
    expect(cells(invoice.getByText('1 050 000 FCFA').closest('tr'))).toContain('Recette Avicole Ventes d\'animaux 1 050 000 FCFA');
    expect(tone(invoice, '1 050 000 FCFA')).toBe('success');
    const credit = rowOf('Avoir AV-0001 — Restaurant Le Palmier (FA-0310)');
    expect(tone(credit, '−105 000 FCFA')).toBe('danger');
  });

  it('locks derived rows with the reason and links them to their source document; manual rows stay open', async () => {
    mountPage();
    await screen.findByText('Salaires septembre');
    const invoice = rowOf('Facture FA-0310 — Restaurant Le Palmier');
    for (const name of ['Modifier', 'Supprimer']) {
      const button = invoice.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAttribute('title', "Écriture générée par une facture — corrigez le document d'origine");
    }
    expect(invoice.getByRole('link', { name: 'Facture FA-0310 — Restaurant Le Palmier' })).toHaveAttribute('href', '/m/ventes/i1');
    expect(rowOf('Achat BC-0142 — Agro Provende SA').getByRole('link')).toHaveAttribute('href', '/m/achats/p1');
    expect(rowOf('Achat BC-0142 — Agro Provende SA').getByRole('button', { name: 'Supprimer' })).toHaveAttribute('title', "Écriture générée par un achat — corrigez le document d'origine");
    const manual = rowOf('Salaires septembre');
    expect(manual.getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    expect(manual.getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute('aria-disabled');
  });

  it('has the period, activity and category filters and sends them to the entries endpoint', async () => {
    mountPage();
    await screen.findByText('Salaires septembre');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Toutes les activités'), 'Avicole');
    await user.selectOptions(screen.getByLabelText('Toutes les catégories'), 'Salaires');
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-10-01' } });
    await waitFor(() => {
      const last = calls.filter((c) => c.url.startsWith('/api/finance/entries')).at(-1)!.url;
      expect(last).toContain('activity=AVICOLE');
      expect(last).toContain('category=SALAIRES');
      expect(last).toContain('from=2026-10-01');
    });
  });

  it('has the three tabs', async () => {
    mountPage();
    await screen.findByText('Salaires septembre');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Dépenses & recettes', 'Synthèse', 'Rentabilité par lot']);
  });
});

describe('finance form', () => {
  async function openForm(opts?: Parameters<typeof mount>[1]) {
    mountPage(opts);
    await screen.findByText('Salaires septembre');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Ajouter — Dépenses & recettes' }) };
  }
  const optionsOf = (select: HTMLElement) => Array.from(select.querySelectorAll('option')).map((o) => o.textContent);

  it('offers the expense categories first and the revenue ones after switching Type', async () => {
    const { user, dialog } = await openForm();
    const category = within(dialog).getByLabelText('Catégorie');
    expect(optionsOf(category)).toContain('Salaires');
    expect(optionsOf(category)).toContain('Autres charges');
    expect(optionsOf(category)).not.toContain("Ventes d'animaux");
    await user.click(within(dialog).getByRole('radio', { name: 'Recette' }));
    expect(optionsOf(within(dialog).getByLabelText('Catégorie'))).toContain("Ventes d'animaux");
    expect(optionsOf(within(dialog).getByLabelText('Catégorie'))).toContain('Autres recettes');
    expect(optionsOf(within(dialog).getByLabelText('Catégorie'))).not.toContain('Salaires');
  });

  it('clears a category that does not belong to the new Type', async () => {
    const { user, dialog } = await openForm();
    await user.selectOptions(within(dialog).getByLabelText('Catégorie'), 'Salaires');
    await user.click(within(dialog).getByRole('radio', { name: 'Recette' }));
    expect(within(dialog).getByLabelText('Catégorie')).toHaveValue('');
  });

  it('offers the lot of the species for an Avicole or Porcin expense only', async () => {
    const { user, dialog } = await openForm();
    expect(within(dialog).queryByLabelText('Lot')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Activité'), 'Avicole');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'LC-2026-14' })).toBeInTheDocument());
    expect(within(dialog).queryByRole('option', { name: 'PC-2026-03' })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Activité'), 'Porcin');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'PC-2026-03' })).toBeInTheDocument());
    expect(within(dialog).queryByRole('option', { name: 'LC-2026-14' })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Activité'), 'Général');
    expect(within(dialog).queryByLabelText('Lot')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Activité'), 'Avicole');
    await user.click(within(dialog).getByRole('radio', { name: 'Recette' }));
    expect(within(dialog).queryByLabelText('Lot')).not.toBeInTheDocument();
  });

  it('posts the entry with its lot, today as default date, and the amount as a number', async () => {
    const { user, dialog } = await openForm();
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    await user.type(within(dialog).getByLabelText('Libellé'), 'Transport poussins');
    await user.selectOptions(within(dialog).getByLabelText('Activité'), 'Avicole');
    await user.selectOptions(within(dialog).getByLabelText('Catégorie'), 'Transport');
    await user.type(within(dialog).getByLabelText('Montant'), '50000');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'LC-2026-14' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Lot'), 'LC-2026-14');
    await user.type(within(dialog).getByLabelText('Note'), 'Camion loué');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/finance/entries',
      body: { date: todayIso(), kind: 'DEPENSE', label: 'Transport poussins', activity: 'AVICOLE', category: 'TRANSPORT', amount: 50000, batchId: 'l1', note: 'Camion loué' },
    });
  });

  it('edits only what changed on a manual row', async () => {
    mountPage();
    await screen.findByText('Salaires septembre');
    const user = userEvent.setup();
    await user.click(rowOf('Salaires septembre').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Montant');
    await user.clear(amount);
    await user.type(amount, '960000');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/finance/entries/m1', body: { amount: 960000 } });
    expect(Object.keys(writes()[0].body as object)).toEqual(['amount']);
  });

  it('has no Ajouter for a read-only role and under all farms', async () => {
    mountPage({ perms: PROPRIETAIRE });
    await screen.findByText('Salaires septembre');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    cleanup();
    mountPage({ farm: 'all' });
    await screen.findByText('Salaires septembre');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });
});

describe('Synthèse', () => {
  async function openSummary(opts?: Parameters<typeof mount>[1]) {
    mountPage(opts);
    await screen.findByText('Salaires septembre');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Synthèse' }));
    await screen.findByText("Chiffre d'affaires");
  }
  const tile = (label: string) => screen.getByText(label, { selector: 'p' }).parentElement!;

  it('reads the summary of the month to date by default and shows the reference figures', async () => {
    await openSummary();
    const request = calls.find((c) => c.url.startsWith('/api/finance/summary'))!;
    expect(request.url).toContain(`from=${todayIso().slice(0, 8)}01`);
    expect(request.url).toContain(`to=${todayIso()}`);
    expect(screen.getByLabelText('Du')).toHaveValue(`${todayIso().slice(0, 8)}01`);
    expect(screen.getByLabelText('Au')).toHaveValue(todayIso());
    await waitFor(() => expect(flat(tile("Chiffre d'affaires").textContent)).toContain('3 970 000 FCFA'));
    expect(flat(tile('Dépenses').textContent)).toContain('2 835 000 FCFA');
    expect(flat(tile('Marge').textContent)).toContain('1 135 000 FCFA');
    expect(flat(tile('Créances clients').textContent)).toContain('400 000 FCFA');
  });

  it('shows the activity cards as the reports screen does, a negative margin included', async () => {
    await openSummary();
    expect(await screen.findByText('Activité Avicole')).toBeInTheDocument();
    expect(screen.getByText('910 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('Recettes 2 050 000 FCFA · Dépenses 1 140 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('Activité Général')).toBeInTheDocument();
    expect(screen.getByText('-1 135 000 FCFA')).toBeInTheDocument();
  });

  it('lists the categories with their type and amount, and no per-farm table for one farm', async () => {
    await openSummary();
    for (const h of ['CATÉGORIE', 'TYPE', 'MONTANT']) expect(await screen.findByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Salaires').closest('tr'))).toBe('Salaires Dépense 950 000 FCFA');
    expect(cells(screen.getByText("Ventes d'animaux").closest('tr'))).toBe("Ventes d'animaux Recette 3 970 000 FCFA");
    expect(screen.queryByRole('columnheader', { name: 'FERME' })).not.toBeInTheDocument();
  });

  it('shows the per-farm table when the API gives one (all farms)', async () => {
    await openSummary({ summary: { ...SUMMARY, byFarm: BY_FARM } });
    for (const h of ['FERME', 'RECETTES', 'DÉPENSES', 'MARGE']) expect(await screen.findByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Ferme Atakpamé').closest('tr'))).toBe('Ferme Atakpamé 970 000 FCFA 835 000 FCFA 135 000 FCFA');
  });

  it('says that consumption is not an expense and that the farm margin and the lot margin do not add up', async () => {
    await openSummary();
    expect(await screen.findByText("La consommation d'aliments et de produits vétérinaires n'est pas une dépense : elle est comptée dans le coût des lots.")).toBeInTheDocument();
    expect(screen.getByText(/« Marge du lot »/)).toBeInTheDocument();
  });

  it('sends the chosen period to the summary endpoint', async () => {
    await openSummary();
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/finance/summary')).at(-1)!.url).toContain('from=2026-10-01&to=2026-10-31'));
  });
});

describe('Rentabilité par lot', () => {
  async function openLots(opts?: Parameters<typeof mount>[1]) {
    mountPage(opts);
    await screen.findByText('Salaires septembre');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Rentabilité par lot' }));
    await screen.findByText('LC-2026-14');
  }

  it('renders the nine columns, dashes for a missing cost per kg and the formula hint', async () => {
    await openLots();
    for (const h of ['LOT', 'TYPE', 'STATUT', 'VENDUS', 'COÛT TOTAL', 'RECETTES', 'MARGE', 'COÛT / ANIMAL', 'COÛT / KG']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('LC-2026-14').closest('tr'))).toBe('LC-2026-14 Chair En cours 270 1 772 400 FCFA 945 000 FCFA -827 400 FCFA 367.72 FCFA —');
    expect(cells(screen.getByText('LC-2026-12').closest('tr'))).toContain('Clôturé 5 000 1 000 000 FCFA 1 500 000 FCFA 500 000 FCFA 200 FCFA 1 449.28 FCFA');
    expect(screen.getByText('Marge du lot = recettes du lot − (achat des animaux + aliment + santé + charges affectées).')).toBeInTheDocument();
    expect(screen.getByText(/leurs sommes ne sont pas censées concorder/)).toBeInTheDocument();
  });

  it('shows a negative margin in danger, a positive one and zero in success, and links to the lot', async () => {
    await openLots();
    expect(tone(rowOf('LC-2026-14'), '-827 400 FCFA')).toBe('danger');
    expect(tone(rowOf('LC-2026-12'), '500 000 FCFA')).toBe('success');
    expect(rowOf('LC-2026-14').getByRole('link', { name: 'LC-2026-14' })).toHaveAttribute('href', '/m/lots/l1');
    expect(rowOf('PC-2026-03').getByRole('link', { name: 'PC-2026-03' })).toHaveAttribute('href', '/m/porcs/lot-p1');
    expect(tone(rowOf('PC-2026-03'), '0 FCFA')).toBe('success');
  });

  it('has the period and species filters and is read-only', async () => {
    await openLots();
    expect(screen.getByLabelText('Du')).toBeInTheDocument();
    expect(screen.getByLabelText('Toutes les espèces')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Toutes les espèces'), 'Porcin');
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/finance/lots')).at(-1)!.url).toContain('species=PORCIN'));
  });
});

describe('profitability card of the lot detail', () => {
  const mountLot = (perms: Record<string, string[]>) =>
    mount(<LotDetail id="l1" />, { perms });

  it('shows the cost lines, revenue, lot margin and unit costs for a role with finance read', async () => {
    mountLot({ lots: ['read'], finance: ['read'] });
    const card = await screen.findByRole('region', { name: 'Rentabilité' });
    await waitFor(() => expect(flat(card.textContent)).toContain('Coût total'));
    const text = Array.from(card.querySelectorAll('dl > div')).map((l) => `${l.querySelector('dt')!.textContent} ${l.querySelector('dd')!.textContent}`).map(flat);
    for (const part of [
      "Coût des animaux 1 500 000 FCFA", 'Aliment 198 400 FCFA', 'Santé 24 000 FCFA', 'Autres charges 50 000 FCFA', 'Coût total 1 772 400 FCFA',
      'Recettes 945 000 FCFA', 'Marge du lot -827 400 FCFA', 'Coût par animal 367.72 FCFA', 'Coût/kg —',
    ]) expect(text).toContain(part);
    expect(tone(within(card), '-827 400 FCFA')).toBe('danger');
  });

  it('needs finance read only: no card and no request without it', async () => {
    mountLot({ lots: ['read'] });
    await screen.findByText('LC-2026-14');
    expect(screen.queryByRole('region', { name: 'Rentabilité' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/finance'))).toBe(false);
  });
});
