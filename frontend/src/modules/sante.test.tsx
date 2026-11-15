import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import { todayIso } from '../lib/format';
import { AnimalDetail } from '../pages/details/AnimalDetail';
import { LotDetail } from '../pages/details/LotDetail';
import { MODULES } from './index';

const sante = MODULES.sante!;

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'VETERINAIRE', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete', 'validate'];
const FULL = { sante: ALL, lots: ALL, porcs: ALL, stocks: ALL, alimentation: ALL };

const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const act = (o: Record<string, unknown>) => ({
  batchId: 'l1', animalId: null, buildingId: null, stockItemId: null, quantity: null, planId: null, targetKind: 'LOT',
  withdrawalUntil: null, doneDate: null, stockBatchId: null, enteredDone: o.status === 'REALISE' && !('planId' in o && o.planId), ...o,
});
const ACTS = [
  act({ id: 'a1', date: '2026-10-24', target: 'LC-2026-15', type: 'VACCINATION', productName: 'Gumboro', dose: '1 goutte', veterinarian: 'Dr Koffi', status: 'PLANIFIE', stockItemId: 's4', quantity: 2 }),
  act({ id: 'a2', date: '2026-10-18', target: 'LC-2026-14', type: 'VACCINATION', productName: 'Newcastle', dose: 'Eau de boisson', veterinarian: 'Dr Koffi', status: 'REALISE', doneDate: '2026-10-18' }),
  act({ id: 'a3', date: '2026-10-20', target: 'TR-021', type: 'TRAITEMENT', productName: 'Fer injectable porcelets', dose: '1 ml', veterinarian: 'Dr Amah', status: 'REALISE', doneDate: '2026-10-20', batchId: null, animalId: 'p1', targetKind: 'ANIMAL' }),
  act({ id: 'a4', date: '2026-10-15', target: 'Porcherie 2', type: 'DESINFECTION', productName: 'Virkon S', dose: '1%', veterinarian: 'Équipe', status: 'EN_RETARD', batchId: null, buildingId: 'bd1', targetKind: 'BATIMENT' }),
  act({ id: 'a6', date: '2026-12-01', target: 'LC-2026-14', type: 'VACCINATION', productName: 'Marek libre', dose: null, veterinarian: null, status: 'PLANIFIE' }),
  act({ id: 'a7', date: '2026-10-05', target: 'LC-2026-14', type: 'VACCINATION', productName: 'Gumboro fait', dose: null, veterinarian: null, status: 'REALISE', doneDate: '2026-10-05', stockItemId: 's4', quantity: 2 }),
  // Planned for 2026-09-30, completed on 2026-10-02: the planned date and the day it was done differ.
  act({ id: 'a8', enteredDone: false, date: '2026-09-30', doneDate: '2026-10-02', target: 'LC-2026-14', type: 'VACCINATION', productName: 'Marek fait', dose: null, veterinarian: null, status: 'REALISE', planId: 'pl1' }),
  // Planned for 2026-10-04 and completed that very day: same two dates as an entered-done act, but not entered as done.
  act({ id: 'a9', enteredDone: false, date: '2026-10-04', doneDate: '2026-10-04', target: 'LC-2026-14', type: 'VACCINATION', productName: 'Marek même jour', dose: null, veterinarian: null, status: 'REALISE', planId: 'pl1' }),
  act({ id: 'a5', date: '2026-10-01', target: 'LC-2026-14', type: 'DIAGNOSTIC', productName: null, dose: null, veterinarian: null, status: 'ANNULE' }),
];
const STATUS_COUNTS = { PLANIFIE: 1, REALISE: 2, EN_RETARD: 1, ANNULE: 1 };

const PLANS = [
  { id: 'pl1', name: 'Programme chair', species: 'AVICOLE', type: 'CHAIR', items: [{ ageDays: 1, productName: 'Marek', dose: '1 dose', stockItemId: 's4' }, { ageDays: 7, productName: 'Gumboro', dose: null, stockItemId: 's4' }] },
];
const QUARANTINES = [
  { id: 'q1', target: 'LC-2026-14', targetKind: 'LOT', batchId: 'l1', animalId: null, startDate: '2026-11-01', endDate: null, reason: 'Toux', status: 'EN_COURS' },
  { id: 'q2', target: 'TR-021', targetKind: 'ANIMAL', batchId: null, animalId: 'p1', startDate: '2026-10-01', endDate: '2026-10-09', reason: 'Boiterie', status: 'LEVEE' },
];
const INCIDENTS = [
  { id: 'i1', date: '2026-11-03', title: 'Chute de ponte', description: null, severity: 'GRAVE', target: 'LC-2026-14', batchId: 'l1', buildingId: null, status: 'OUVERT' },
  { id: 'i2', date: '2026-10-03', title: 'Panne eau', description: null, severity: 'FAIBLE', target: 'Poulailler A', batchId: null, buildingId: 'bd1', status: 'CLOS' },
];
const LOGS = [
  { id: 'g1', date: '2026-11-04', type: 'PEDILUVE', buildingId: 'bd1', buildingName: 'Poulailler A', productName: 'Virkon S', visitorName: null, note: null },
  { id: 'g2', date: '2026-11-05', type: 'VISITEUR', buildingId: null, buildingName: null, productName: null, visitorName: 'M. Mensah', note: 'Camion aliment' },
];

const LOT = {
  id: 'l1', code: 'LC-2026-14', type: 'CHAIR', species: 'AVICOLE', breedId: null, breedName: null, buildingId: 'bd1', buildingName: 'Poulailler A',
  entryDate: '2026-09-20', initialCount: 5000, deaths: 0, alive: 5000, mortalityRate: 0, averageWeightG: 1450, status: 'EN_COURS', ageDays: 55,
  supplierName: null, purchasePrice: null, responsibleId: null, responsibleName: null, closedAt: null, notes: null, withdrawalUntil: null,
  performance: { ageDays: 55, alive: 5000, deaths: 0, mortalityRate: 0, firstWeightG: 42, lastWeightG: 1450, dailyGainG: 55, feedKg: null, feedConversion: null, feedCost: null },
};
const ANIMAL = {
  id: 'p1', tag: 'TR-021', category: 'TRUIE', sex: 'F', breedId: null, breedName: null, buildingId: 'bd2', buildingName: 'Porcherie 2',
  birthDate: '2025-01-01', sireId: null, sireTag: null, damId: null, damTag: null, status: 'ACTIF', weightKg: 180, exitDate: null, exitReason: null, notes: null,
  withdrawalUntil: null,
};
const STOCK_DETAIL = {
  id: 's4', name: 'Vaccin Gumboro', category: 'VACCIN', unit: 'flacons', quantity: 12, minQty: 5, maxQty: null, level: 'ok', daysOfStock: null, averageCost: 100, value: 0, nextExpiry: null,
  batches: [
    { id: 'sb1', lotNumber: 'GB-77', expiryDate: '2027-01-01', receivedDate: '2026-10-01', quantity: 8 },
    { id: 'sb2', lotNumber: null, expiryDate: null, receivedDate: '2026-10-05', quantity: 4 },
  ],
};

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

let failWith: { url: RegExp; status: number; message: string } | null = null;
let lotData: object = LOT;
let animalData: object = ANIMAL;

function mount(ui: React.ReactNode, { perms = FULL, farm }: { perms?: Record<string, string[]>; farm?: string } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    }
    if (call.method !== 'GET') {
      if (failWith && failWith.url.test(call.url)) return json(failWith.status, { message: failWith.message });
      return json(201, { id: 'new1' });
    }
    const url = call.url;
    if (url.startsWith('/api/health-acts')) return page(ACTS, { statusCounts: STATUS_COUNTS });
    if (url.startsWith('/api/vaccination-plans')) return page(PLANS);
    if (url.startsWith('/api/quarantines')) return page(QUARANTINES);
    if (url.startsWith('/api/incidents')) return page(INCIDENTS);
    if (url.startsWith('/api/biosecurity-logs')) return page(LOGS);
    if (url.startsWith('/api/stock-items')) {
      return url.includes('category=MEDICAMENT') ? page([{ id: 's5', name: 'Amoxicilline' }]) : page([{ id: 's4', name: 'Vaccin Gumboro' }]);
    }
    if (/^\/api\/stock\/s5(\?|$)/.test(url)) return json(200, { ...STOCK_DETAIL, id: 's5', name: 'Amoxicilline', batches: [{ id: 'mb1', lotNumber: 'AM-1', expiryDate: null, receivedDate: '2026-10-01', quantity: 5 }] });
    if (/^\/api\/stock\/s4(\?|$)/.test(url)) return json(200, STOCK_DETAIL);
    if (/^\/api\/(batches\/l1|animals\/p1)\/(events|weighings)/.test(url)) return page([]);
    if (/^\/api\/batches\/l1(\?|$)/.test(url)) return json(200, lotData);
    if (/^\/api\/animals\/p1(\?|$)/.test(url)) return json(200, animalData);
    if (url.startsWith('/api/batches')) {
      return new URL(url, 'http://x').searchParams.get('species') === 'PORCIN'
        ? page([{ id: 'l9', code: 'PC-2026-01' }])
        : page([{ id: 'l1', code: 'LC-2026-14' }, { id: 'l2', code: 'LC-2026-15' }]);
    }
    if (url.startsWith('/api/animals')) return page([{ id: 'p1', tag: 'TR-021' }]);
    if (url.startsWith('/api/buildings')) return page([{ id: 'bd1', name: 'Poulailler A' }, { id: 'bd2', name: 'Porcherie 2' }]);
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
  mount(<Routes><Route path="*" element={<ModulePage config={sante} />} /></Routes>, opts);

beforeEach(() => {
  calls.length = 0;
  failWith = null;
  lotData = LOT;
  animalData = ANIMAL;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;
const openTab = async (name: string) => userEvent.setup().click(await screen.findByRole('tab', { name }));
const button = (name: string) => screen.getByRole('button', { name });

describe('sante list', () => {
  it('renders the reference headers, tiles, subtitle, tabs and rows with status pills', async () => {
    mountPage();
    expect(await screen.findByText('Gumboro')).toBeInTheDocument();
    for (const h of ['DATE', 'LOT / ANIMAL', 'TYPE', 'PRODUIT', 'DOSE', 'VÉTÉRINAIRE', 'STATUT']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText("Vaccinations, traitements, diagnostics et délais d'attente.")).toBeInTheDocument();
    expect(screen.getByText('Santé', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(
      ['Interventions', 'Plans vaccinaux', 'Biosécurité', 'Quarantaines', 'Incidents'],
    );
    await waitFor(() => expect(screen.getByText('Total enregistrements', { selector: 'p' }).nextElementSibling).toHaveTextContent('5'));
    for (const [label, n] of [['Planifié', '1'], ['Réalisé', '2'], ['En retard', '1']]) {
      expect(screen.getByText(label, { selector: 'p' }).nextElementSibling).toHaveTextContent(n);
    }

    const gumboro = rowOf('Gumboro');
    for (const t of ['2026-10-24', 'LC-2026-15', 'Vaccination', '1 goutte', 'Dr Koffi', 'Planifié']) {
      expect(within(gumboro).getByText(t)).toBeInTheDocument();
    }
    expect(within(rowOf('Fer injectable porcelets')).getByText('Traitement')).toBeInTheDocument();
    expect(within(rowOf('Virkon S')).getByText('Désinfection')).toBeInTheDocument();
    expect(within(rowOf('Virkon S')).getByText('En retard')).toBeInTheDocument();
    expect(within(rowOf('Newcastle')).getByText('Réalisé')).toBeInTheDocument();
    expect(within(screen.getByText('2026-10-01').closest('tr')!).getByText('Annulé')).toBeInTheDocument();
  });
});

describe('sante row actions', () => {
  it('offers Marquer réalisé on Planifié and En retard rows only', async () => {
    mountPage();
    await screen.findByText('Gumboro');
    const has = (text: string, name: string) => within(rowOf(text)).queryByRole('button', { name }) !== null;
    expect(has('Gumboro', 'Marquer réalisé')).toBe(true);
    expect(has('Virkon S', 'Marquer réalisé')).toBe(true);
    expect(has('Newcastle', 'Marquer réalisé')).toBe(false);
    expect(has('Fer injectable porcelets', 'Marquer réalisé')).toBe(false);
    expect(within(screen.getByText('2026-10-01').closest('tr')!).queryByRole('button', { name: 'Marquer réalisé' })).toBeNull();
    // A cancelled act cannot be cancelled again or edited.
    expect(within(screen.getByText('2026-10-01').closest('tr')!).queryByRole('button', { name: 'Annuler' })).toBeNull();
    expect(within(screen.getByText('2026-10-01').closest('tr')!).getByRole('button', { name: 'Modifier' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('completes an act with the date, quantity and product batch (POST /complete) and shows the API refusal', async () => {
    failWith = { url: /complete/, status: 400, message: 'Lot périmé' };
    mountPage();
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(within(rowOf('Gumboro')).getByRole('button', { name: 'Marquer réalisé' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Date de réalisation')).toHaveValue(todayIso());
    await within(dialog).findByRole('option', { name: 'GB-77 (8)' });
    await user.selectOptions(within(dialog).getByLabelText('Lot de produit'), 'GB-77 (8)');
    // The quantity planned on the act is prefilled.
    expect(within(dialog).getByLabelText('Quantité')).toHaveValue(2);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Lot périmé')).toBeInTheDocument();
    expect(writes()).toEqual([
      { method: 'POST', url: '/api/health-acts/a1/complete', body: { doneDate: todayIso(), quantity: 2, stockBatchId: 'sb1' } },
    ]);
    failWith = null;
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('completes an act without a stock product with the date only', async () => {
    mountPage();
    await screen.findByText('Virkon S');
    const user = userEvent.setup();
    await user.click(within(rowOf('Virkon S')).getByRole('button', { name: 'Marquer réalisé' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Quantité')).toBeNull();
    expect(within(dialog).queryByLabelText('Lot de produit')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toEqual([
      { method: 'POST', url: '/api/health-acts/a4/complete', body: { doneDate: todayIso() } },
    ]));
  });

  it('cancels an act after confirmation (POST /cancel)', async () => {
    mountPage();
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(within(rowOf('Gumboro')).getByRole('button', { name: 'Annuler' }));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Annuler l\'intervention' }));
    await waitFor(() => expect(writes()).toEqual([{ method: 'POST', url: '/api/health-acts/a1/cancel', body: {} }]));
  });

  it('offers no write control without write rights or under all farms', async () => {
    mountPage({ perms: { sante: ['read'] } });
    await screen.findByText('Gumboro');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marquer réalisé' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('is read-only under all farms', async () => {
    mountPage({ farm: 'all' });
    await screen.findByText('Gumboro');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Marquer réalisé' })).toHaveLength(0);
    expect(screen.getByText('Sélectionnez une ferme pour modifier les données.')).toBeInTheDocument();
  });
});

describe('intervention form', () => {
  async function openForm(opts?: Parameters<typeof mount>[1]) {
    mountPage(opts);
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    return { user, dialog: await screen.findByRole('dialog') };
  }

  it('shows the product batch and quantity only for a done act with a stock product', async () => {
    const { user, dialog } = await openForm();
    await user.selectOptions(await within(dialog).findByLabelText('Lot'), 'LC-2026-14');
    // No product yet.
    expect(within(dialog).queryByLabelText('Quantité')).toBeNull();
    await within(dialog).findByRole('option', { name: 'Vaccin Gumboro' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    expect(within(dialog).queryByLabelText('Produit (texte libre)')).toBeNull();
    expect(await within(dialog).findByLabelText('Quantité')).toBeInTheDocument();
    await within(dialog).findByRole('option', { name: 'GB-77 (8)' });
    expect(within(dialog).getByLabelText('Lot de produit')).toBeInTheDocument();
    // Planned: nothing is consumed yet.
    await user.click(within(dialog).getByRole('radio', { name: 'Planifié' }));
    expect(within(dialog).queryByLabelText('Quantité')).toBeNull();
    expect(within(dialog).queryByLabelText('Lot de produit')).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Réalisé' }));
    expect(within(dialog).getByLabelText('Quantité')).toBeInTheDocument();
    // The vaccine list is the VACCIN category; a treatment draws on MEDICAMENT.
    expect(calls.some((c) => c.url.startsWith('/api/stock-items') && c.url.includes('category=VACCIN') && c.url.includes('active=true'))).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'Traitement' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('category=MEDICAMENT'))).toBe(true));
    expect(within(dialog).getByLabelText('Durée (jours)')).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Délai d'attente (jours)")).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Symptômes')).toBeInTheDocument();
    // The product picked for the vaccine does not follow the type change.
    expect(within(dialog).getByLabelText('Produit en stock')).toHaveValue('');
    expect(within(dialog).queryByLabelText('Quantité')).toBeNull();
  });

  it('posts a done vaccination with the lot, stock product, quantity and product batch', async () => {
    failWith = { url: /health-acts/, status: 400, message: 'Stock insuffisant' };
    const { user, dialog } = await openForm();
    await user.selectOptions(await within(dialog).findByLabelText('Lot'), 'LC-2026-14');
    await within(dialog).findByRole('option', { name: 'Vaccin Gumboro' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    fireEvent.change(await within(dialog).findByLabelText('Quantité'), { target: { value: '2' } });
    await within(dialog).findByRole('option', { name: 'GB-77 (8)' });
    await user.selectOptions(within(dialog).getByLabelText('Lot de produit'), 'GB-77 (8)');
    await user.type(within(dialog).getByLabelText('Dose'), '1 goutte');
    await user.type(within(dialog).getByLabelText('Vétérinaire'), 'Dr Koffi');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Stock insuffisant')).toBeInTheDocument();
    expect(writes()).toEqual([{
      method: 'POST',
      url: '/api/health-acts',
      body: {
        type: 'VACCINATION', status: 'REALISE', date: todayIso(), batchId: 'l1', stockItemId: 's4', quantity: 2, stockBatchId: 'sb1',
        dose: '1 goutte', veterinarian: 'Dr Koffi',
      },
    }]);
  });

  it('plans a disinfection of a building with a free-text product', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'Désinfection' }));
    // A disinfection targets a building: no lot / animal choice.
    expect(within(dialog).queryByRole('radiogroup', { name: 'Type de cible' })).toBeNull();
    await user.selectOptions(await within(dialog).findByLabelText('Bâtiment'), 'Porcherie 2');
    await user.click(within(dialog).getByRole('radio', { name: 'Planifié' }));
    await user.type(within(dialog).getByLabelText('Produit (texte libre)'), 'Virkon S');
    expect(within(dialog).queryByLabelText('Produit en stock')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      type: 'DESINFECTION', status: 'PLANIFIE', date: todayIso(), buildingId: 'bd2', productName: 'Virkon S',
    });
  });

  it('requires a target', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le champ « Lot » est requis')).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it('lets a veterinarian pick an animal; a poultry manager sees no pig target', async () => {
    const vet = await openForm();
    await vet.user.click(within(vet.dialog).getByRole('radio', { name: 'Animal' }));
    await vet.user.selectOptions(await within(vet.dialog).findByLabelText('Animal'), 'TR-021');
    // The lot select is replaced by the animal one: no lot option is offered any more.
    expect(within(vet.dialog).queryByLabelText('Lot')).toBeNull();
    expect(within(vet.dialog).queryByRole('option', { name: 'PC-2026-01' })).toBeNull();
    expect(within(vet.dialog).queryByRole('option', { name: 'LC-2026-14' })).toBeNull();
    await vet.user.click(within(vet.dialog).getByRole('radio', { name: 'Lot' }));
    await within(vet.dialog).findByRole('option', { name: 'PC-2026-01' });
  });

  it('shows a poultry manager poultry lots only', async () => {
    const { dialog } = await openForm({ perms: { sante: ['read', 'create'], lots: ['read'] } });
    await within(dialog).findByRole('option', { name: 'LC-2026-14' });
    expect(within(dialog).queryByRole('option', { name: 'PC-2026-01' })).toBeNull();
    expect(within(dialog).queryByRole('radio', { name: 'Animal' })).toBeNull();
    expect(calls.some((c) => c.url.includes('species=PORCIN'))).toBe(false);
    expect(calls.some((c) => c.url.startsWith('/api/animals'))).toBe(false);
  });

  it('edits a done act: only what changed is sent and the stock product is fixed', async () => {
    mountPage();
    await screen.findByText('Newcastle');
    const user = userEvent.setup();
    await user.click(within(rowOf('Newcastle')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('radiogroup', { name: 'Type' })).toBeNull();
    expect(within(dialog).queryByLabelText('Produit en stock')).toBeNull();
    await user.clear(within(dialog).getByLabelText('Dose'));
    await user.type(within(dialog).getByLabelText('Dose'), '2 ml');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/health-acts/a2', body: { dose: '2 ml' } });
  });

  it('moves an act entered as done by `date` alone: no doneDate is sent (the API moves both)', async () => {
    mountPage();
    await screen.findByText('Newcastle');
    const user = userEvent.setup();
    await user.click(within(rowOf('Newcastle')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Réalisé le')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-17' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ date: '2026-10-17' });
    expect(writes()[0].body).not.toHaveProperty('doneDate');
  });
});

describe('vaccination plans', () => {
  it('lists plans and applies one to a lot of its species, showing the 409', async () => {
    failWith = { url: /apply/, status: 409, message: 'Ce plan est déjà appliqué à ce lot' };
    mountPage();
    await openTab('Plans vaccinaux');
    expect(await screen.findByText('Programme chair')).toBeInTheDocument();
    for (const h of ['NOM', 'ESPÈCE', 'TYPE DE LOT', 'ÉTAPES']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    const row = rowOf('Programme chair');
    expect(within(row).getByText('Avicole')).toBeInTheDocument();
    expect(within(row).getByText('Chair')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Appliquer à un lot' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'LC-2026-14' });
    expect(calls.some((c) => c.url.startsWith('/api/batches') && c.url.includes('species=AVICOLE'))).toBe(true);
    await user.selectOptions(within(dialog).getByLabelText('Lot'), 'LC-2026-14');
    await user.click(within(dialog).getByRole('button', { name: 'Appliquer' }));
    expect(await within(dialog).findByText('Ce plan est déjà appliqué à ce lot')).toBeInTheDocument();
    expect(writes()).toEqual([{ method: 'POST', url: '/api/vaccination-plans/pl1/apply', body: { batchId: 'l1' } }]);
  });

  it('creates a plan with its steps (age, product, dose)', async () => {
    mountPage();
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nom'), 'Programme pondeuse');
    await user.selectOptions(within(dialog).getByLabelText('Espèce'), 'Avicole');
    fireEvent.change(within(dialog).getByLabelText('Âge (jours) ligne 1'), { target: { value: '14' } });
    await user.type(within(dialog).getByLabelText('Produit ligne 1'), 'Newcastle');
    await user.type(within(dialog).getByLabelText('Dose ligne 1'), '1 goutte');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      url: '/api/vaccination-plans',
      body: { name: 'Programme pondeuse', species: 'AVICOLE', items: [{ ageDays: 14, productName: 'Newcastle', dose: '1 goutte' }] },
    });
  });

  it('is a master list: a daily-entry agent neither adds nor applies', async () => {
    mountPage({ perms: { sante: ['read', 'create'], lots: ALL } });
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Appliquer à un lot' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
  });
});

describe('biosécurité, quarantaines and incidents', () => {
  it('lists the biosecurity journal and records an entry', async () => {
    mountPage();
    await openTab('Biosécurité');
    expect(await screen.findByText('M. Mensah')).toBeInTheDocument();
    for (const h of ['DATE', 'TYPE', 'BÂTIMENT', 'PRODUIT', 'VISITEUR', 'NOTE']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(within(rowOf('M. Mensah')).getByText('Visiteur')).toBeInTheDocument();
    expect(within(rowOf('Virkon S')).getByText('Pédiluve')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Visiteur');
    expect(within(dialog).queryByLabelText('Produit')).toBeNull();
    await user.type(within(dialog).getByLabelText('Nom du visiteur'), 'Mme Adjo');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/biosecurity-logs', body: { date: todayIso(), type: 'VISITEUR', visitorName: 'Mme Adjo' },
    });
  });

  it('lifts a quarantine in progress (POST /lift) and offers it on that status only', async () => {
    mountPage();
    await openTab('Quarantaines');
    expect(await screen.findByText('Toux')).toBeInTheDocument();
    expect(within(rowOf('Toux')).getByText('En cours')).toBeInTheDocument();
    expect(within(rowOf('Boiterie')).getByText('Levée')).toBeInTheDocument();
    expect(within(rowOf('Boiterie')).queryByRole('button', { name: 'Lever la quarantaine' })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(rowOf('Toux')).getByRole('button', { name: 'Lever la quarantaine' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Lever' }));
    await waitFor(() => expect(writes()).toEqual([
      { method: 'POST', url: '/api/quarantines/q1/lift', body: { date: todayIso() } },
    ]));
  });

  it('closes an open incident (POST /close) and shows its severity', async () => {
    mountPage();
    await openTab('Incidents');
    expect(await screen.findByText('Chute de ponte')).toBeInTheDocument();
    expect(within(rowOf('Chute de ponte')).getByText('Grave')).toBeInTheDocument();
    expect(within(rowOf('Panne eau')).queryByRole('button', { name: "Clore l'incident" })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(rowOf('Chute de ponte')).getByRole('button', { name: "Clore l'incident" }));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Clore' }));
    await waitFor(() => expect(writes()).toEqual([{ method: 'POST', url: '/api/incidents/i1/close', body: {} }]));
  });

  it('declares an incident on a lot', async () => {
    mountPage();
    await openTab('Incidents');
    await screen.findByText('Chute de ponte');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Titre'), 'Mortalité anormale');
    await user.selectOptions(within(dialog).getByLabelText('Gravité'), 'Moyenne');
    await within(dialog).findByRole('option', { name: 'LC-2026-14' });
    await user.selectOptions(within(dialog).getByLabelText('Lot'), 'LC-2026-14');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/incidents', body: { date: todayIso(), title: 'Mortalité anormale', severity: 'MOYENNE', batchId: 'l1' },
    });
  });

  it('starts a quarantine on an animal', async () => {
    mountPage();
    await openTab('Quarantaines');
    await screen.findByText('Toux');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Animal' }));
    await user.selectOptions(await within(dialog).findByLabelText('Animal'), 'TR-021');
    await user.type(within(dialog).getByLabelText('Motif'), 'Toux');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/quarantines', body: { animalId: 'p1', startDate: todayIso(), reason: 'Toux' },
    });
  });
});

describe('API refusals shown in the dialog', () => {
  it('shows the 409 of a plan whose species changed after it was applied', async () => {
    failWith = { url: /vaccination-plans\/pl1$/, status: 409, message: 'Ce plan a été appliqué à des lots : son espèce et son type ne peuvent plus changer' };
    mountPage();
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    const user = userEvent.setup();
    await user.click(within(rowOf('Programme chair')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Espèce'), 'Porcin');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/ne peuvent plus changer/)).toBeInTheDocument();
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/vaccination-plans/pl1', body: { species: 'PORCIN' } });
  });

  it('shows the 409 of a second quarantine on the same lot', async () => {
    failWith = { url: /\/api\/quarantines$/, status: 409, message: 'Une quarantaine est déjà en cours' };
    mountPage();
    await openTab('Quarantaines');
    await screen.findByText('Toux');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText('Lot'), 'LC-2026-14');
    await user.type(within(dialog).getByLabelText('Motif'), 'Toux');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Une quarantaine est déjà en cours')).toBeInTheDocument();
  });

  it('shows the 400 of a product batch that is not the product’s', async () => {
    failWith = { url: /\/api\/health-acts$/, status: 400, message: 'Lot invalide pour cet article' };
    mountPage();
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText('Lot'), 'LC-2026-14');
    await within(dialog).findByRole('option', { name: 'Vaccin Gumboro' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    fireEvent.change(await within(dialog).findByLabelText('Quantité'), { target: { value: '1' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Lot invalide pour cet article')).toBeInTheDocument();
  });
});

describe('withdrawal period on lot and animal pages', () => {
  const NOTICE = /Délai d'attente jusqu'au/;
  const mountLot = (opts?: Parameters<typeof mount>[1]) => mount(<LotDetail id="l1" />, opts);

  it('shows a warning notice under the lot header while the withdrawal lasts', async () => {
    lotData = { ...LOT, withdrawalUntil: plusDays(3) };
    mountLot();
    expect(await screen.findByText(`Délai d'attente jusqu'au ${plusDays(3)}`)).toBeInTheDocument();
  });

  it('still shows the notice on the last day of the withdrawal (inclusive)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T23:59:59Z'));
    lotData = { ...LOT, withdrawalUntil: '2026-11-15' };
    mountLot();
    expect(await screen.findByText("Délai d'attente jusqu'au 2026-11-15")).toBeInTheDocument();
  });

  it('hides the notice the day after the end date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T00:00:00Z'));
    lotData = { ...LOT, withdrawalUntil: '2026-11-15' };
    mountLot();
    await screen.findByText('LC-2026-14');
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('shows no notice when the lot has no withdrawal', async () => {
    mountLot();
    await screen.findByText('LC-2026-14');
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('shows the notice on an animal page too', async () => {
    animalData = { ...ANIMAL, withdrawalUntil: plusDays(1) };
    mount(<AnimalDetail id="p1" />);
    expect(await screen.findByText(`Délai d'attente jusqu'au ${plusDays(1)}`)).toBeInTheDocument();
  });

  it('adds a Santé tab listing the acts of the lot, scoped to it', async () => {
    mountLot();
    await screen.findByText('LC-2026-14');
    await openTab('Santé');
    expect(await screen.findByText('Gumboro')).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/health-acts') && c.url.includes('batchId=l1'))).toBe(true);
  });

  it('adds a Santé tab on an animal page scoped by animalId and creates for that animal', async () => {
    mount(<AnimalDetail id="p1" />);
    await screen.findByText('TR-021', { selector: 'h1' });
    await openTab('Santé');
    await screen.findByText('Gumboro');
    expect(calls.some((c) => c.url.startsWith('/api/health-acts') && c.url.includes('animalId=p1'))).toBe(true);
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    // The target is the animal: not asked again.
    expect(within(dialog).queryByRole('radiogroup', { name: 'Type de cible' })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Planifié' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ type: 'VACCINATION', status: 'PLANIFIE', date: todayIso(), animalId: 'p1' });
  });

  it('has no Santé tab without read rights on sante', async () => {
    mountLot({ perms: { lots: ALL } });
    await screen.findByText('LC-2026-14');
    expect(screen.queryByRole('tab', { name: 'Santé' })).toBeNull();
  });
});

describe('plans: stock product per step, farm scope, lot filter', () => {
  it('keeps the stock product of every step when one step is edited', async () => {
    mountPage();
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    const user = userEvent.setup();
    await user.click(within(rowOf('Programme chair')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Produit en stock ligne 1')).toHaveValue('s4');
    await user.type(within(dialog).getByLabelText('Dose ligne 2'), '2 gouttes');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'PATCH',
      url: '/api/vaccination-plans/pl1',
      body: {
        items: [
          { ageDays: 1, productName: 'Marek', dose: '1 dose', stockItemId: 's4' },
          { ageDays: 7, productName: 'Gumboro', dose: '2 gouttes', stockItemId: 's4' },
        ],
      },
    });
    expect(calls.some((c) => c.url.startsWith('/api/stock-items') && c.url.includes('category=VACCIN') && c.url.includes('active=true'))).toBe(true);
  });

  it('filters the lots offered by the plan species and lot type', async () => {
    mountPage();
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    await userEvent.setup().click(within(rowOf('Programme chair')).getByRole('button', { name: 'Appliquer à un lot' }));
    await within(await screen.findByRole('dialog')).findByRole('option', { name: 'LC-2026-14' });
    expect(calls.some((c) => c.url.startsWith('/api/batches') && c.url.includes('species=AVICOLE') && c.url.includes('type=CHAIR'))).toBe(true);
  });

  it('offers Appliquer à un lot only for a plan whose species module the user can read (no empty required select)', async () => {
    const pig = { id: 'pl2', name: 'Programme porcelet', species: 'PORCIN', type: 'PORCELET', items: [{ ageDays: 1, productName: 'Fer', dose: '1 ml', stockItemId: 's4' }] };
    PLANS.push(pig);
    try {
      mountPage({ perms: { sante: ALL, lots: ALL } });
      await openTab('Plans vaccinaux');
      await screen.findByText('Programme porcelet');
      expect(within(rowOf('Programme chair')).getByRole('button', { name: 'Appliquer à un lot' })).toBeInTheDocument();
      expect(within(rowOf('Programme porcelet')).queryByRole('button', { name: 'Appliquer à un lot' })).toBeNull();
      cleanup();
      mountPage({ perms: { sante: ALL, porcs: ALL } });
      await openTab('Plans vaccinaux');
      await screen.findByText('Programme porcelet');
      expect(within(rowOf('Programme porcelet')).getByRole('button', { name: 'Appliquer à un lot' })).toBeInTheDocument();
      expect(within(rowOf('Programme chair')).queryByRole('button', { name: 'Appliquer à un lot' })).toBeNull();
    } finally {
      PLANS.pop();
    }
  });

  it('is organisation data: writable under all farms, but a plan is applied to a lot of one farm only', async () => {
    mountPage({ farm: 'all' });
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
    expect(within(rowOf('Programme chair')).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Appliquer à un lot' })).toBeNull();
  });
});

describe('stock gating and targets', () => {
  const NO_STOCK = { sante: ['read', 'create'], lots: ['read'] };
  const stockCalls = () => calls.filter((c) => /^\/api\/stock(-items)?(\/|\?|$)/.test(c.url));

  it('offers no stock product without read rights on stocks (create and complete), only free text', async () => {
    mountPage({ perms: NO_STOCK });
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    let dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'LC-2026-14' });
    expect(within(dialog).queryByLabelText('Produit en stock')).toBeNull();
    expect(within(dialog).getByLabelText('Produit (texte libre)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await user.click(within(rowOf('Gumboro')).getByRole('button', { name: 'Marquer réalisé' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Quantité')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Lot de produit')).toBeNull();
    expect(stockCalls()).toEqual([]);
  });

  it('says no target is accessible and refuses to submit when the user may read no lot or animal', async () => {
    mountPage({ perms: { sante: ['read', 'create'] } });
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Aucune cible accessible/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('radiogroup', { name: 'Type de cible' })).toBeNull();
    expect(dialog.textContent).not.toContain('undefined');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findAllByText(/Aucune cible accessible/)).not.toHaveLength(0);
    expect(writes()).toEqual([]);
  });

  it('does not offer a disinfection inside a lot page', async () => {
    mount(<LotDetail id="l1" />);
    await screen.findByText('LC-2026-14', { selector: 'h1' });
    await openTab('Santé');
    await screen.findByText('Gumboro');
    await userEvent.setup().click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Traitement' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: 'Désinfection' })).toBeNull();
  });

  it('the incident form does not load animals', async () => {
    mountPage();
    await openTab('Incidents');
    await screen.findByText('Chute de ponte');
    await userEvent.setup().click(button('Ajouter'));
    await within(await screen.findByRole('dialog')).findByRole('option', { name: 'LC-2026-14' });
    expect(calls.some((c) => c.url.startsWith('/api/animals'))).toBe(false);
  });
});

describe('complete and edit with stock', () => {
  it('lets a free-text planned act consume stock when it is completed', async () => {
    mountPage();
    await screen.findByText('Marek libre');
    const user = userEvent.setup();
    await user.click(within(rowOf('Marek libre')).getByRole('button', { name: 'Marquer réalisé' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Quantité')).toBeNull();
    await within(dialog).findByRole('option', { name: 'Vaccin Gumboro' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    fireEvent.change(await within(dialog).findByLabelText('Quantité'), { target: { value: '1' } });
    await within(dialog).findByRole('option', { name: 'GB-77 (8)' });
    await user.selectOptions(within(dialog).getByLabelText('Lot de produit'), 'GB-77 (8)');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/health-acts/a6/complete',
      body: { doneDate: todayIso(), stockItemId: 's4', quantity: 1, stockBatchId: 'sb1' },
    });
  });

  it('edits the quantity of a done stock act', async () => {
    mountPage();
    await screen.findByText('Gumboro fait');
    const user = userEvent.setup();
    await user.click(within(rowOf('Gumboro fait')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Quantité')).toHaveValue(2);
    fireEvent.change(within(dialog).getByLabelText('Quantité'), { target: { value: '3' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/health-acts/a7', body: { quantity: 3 } });
  });

  it('shows the plain date, with no second pill, for a planned act from a plan', async () => {
    mountPage();
    await screen.findByText('Gumboro');
    expect(within(rowOf('Gumboro')).queryByText('À faire')).toBeNull();
  });
});

describe('Santé tab when the target is closed', () => {
  const names = (text: string) => within(rowOf(text)).queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);

  it('on a closed lot: no add, and only the planned acts can be cancelled or deleted', async () => {
    lotData = { ...LOT, status: 'CLOTURE', closedAt: '2026-11-01' };
    mount(<LotDetail id="l1" />);
    await screen.findByText('LC-2026-14', { selector: 'h1' });
    await openTab('Santé');
    await screen.findByText('Gumboro');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
    // Planned (or overdue): cancel and delete, but neither complete nor edit.
    expect(names('Gumboro')).toEqual(['Annuler', 'Supprimer']);
    expect(names('Marek libre')).toEqual(['Annuler', 'Supprimer']);
    // Done, and cancelled: the API refuses any change on a closed lot, so no icon at all.
    expect(names('Newcastle')).toEqual([]);
    expect(names('Marek fait')).toEqual([]);
    const cancelled = screen.getAllByRole('row').find((r) => within(r).queryByText('Annulé'));
    expect(within(cancelled!).queryAllByRole('button')).toEqual([]);

    const user = userEvent.setup();
    await user.click(within(rowOf('Gumboro')).getByRole('button', { name: 'Annuler' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: "Annuler l'intervention" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/health-acts/a1/cancel' });
    await user.click(within(rowOf('Marek libre')).getByRole('button', { name: 'Supprimer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: 'DELETE', url: '/api/health-acts/a6' });
  });

  it('on an animal that left: the same, planned acts only', async () => {
    animalData = { ...ANIMAL, status: 'VENDU', exitDate: '2026-11-01', exitReason: 'VENDU' };
    mount(<AnimalDetail id="p1" />);
    await screen.findByText('TR-021', { selector: 'h1' });
    await openTab('Santé');
    await screen.findByText('Gumboro');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marquer réalisé' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
    expect(names('Gumboro')).toEqual(['Annuler', 'Supprimer']);
    expect(names('Newcastle')).toEqual([]);
  });

  it('keeps the planned acts untouchable without the daily permission', async () => {
    lotData = { ...LOT, status: 'CLOTURE', closedAt: '2026-11-01' };
    mount(<LotDetail id="l1" />, { perms: { ...FULL, sante: ['read'], lots: ['read'] } });
    await screen.findByText('LC-2026-14', { selector: 'h1' });
    await openTab('Santé');
    await screen.findByText('Gumboro');
    expect(names('Gumboro')).toEqual([]);
  });
});

describe('the day an act was done', () => {
  it('shows it under the planned date when they differ, and nowhere else', async () => {
    mountPage();
    await screen.findByText('Marek fait');
    expect(within(rowOf('Marek fait')).getByText('Réalisé le 2026-10-02')).toBeInTheDocument();
    expect(within(rowOf('Newcastle')).queryByText(/Réalisé le/)).toBeNull();
    expect(within(rowOf('Gumboro')).queryByText(/Réalisé le/)).toBeNull();
  });

  it('edits the day it was done of an act completed from a plan, apart from its planned date', async () => {
    mountPage();
    await screen.findByText('Marek fait');
    const user = userEvent.setup();
    await user.click(within(rowOf('Marek fait')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Date prévue')).toHaveValue('2026-09-30');
    const done = within(dialog).getByLabelText('Réalisé le');
    expect(done).toHaveValue('2026-10-02');
    fireEvent.change(done, { target: { value: '2026-10-03' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/health-acts/a8', body: { doneDate: '2026-10-03' } });
  });

  it('edits both dates of an act completed the day it was planned: the API moves them apart', async () => {
    mountPage();
    await screen.findByText('Marek même jour');
    const user = userEvent.setup();
    expect(within(rowOf('Marek même jour')).queryByText(/Réalisé le/)).toBeNull();
    await user.click(within(rowOf('Marek même jour')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Date prévue')).toHaveValue('2026-10-04');
    const done = within(dialog).getByLabelText('Réalisé le');
    expect(done).toHaveValue('2026-10-04');
    fireEvent.change(done, { target: { value: '2026-10-05' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    // Only the exit's day: the planned date stays where it was.
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/health-acts/a9', body: { doneDate: '2026-10-05' } });
  });

  it('has a single Date field for an act entered as done, where the API moves both dates', async () => {
    mountPage();
    await screen.findByText('Newcastle');
    await userEvent.setup().click(within(rowOf('Newcastle')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-10-18');
    expect(within(dialog).queryByLabelText('Réalisé le')).toBeNull();
    expect(within(dialog).queryByLabelText('Date prévue')).toBeNull();
  });
});

describe('stale product batch', () => {
  async function openForm() {
    mountPage();
    await screen.findByText('Gumboro');
    const user = userEvent.setup();
    await user.click(button('Ajouter'));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText('Lot'), 'LC-2026-14');
    return { user, dialog };
  }

  it('does not send the batch of a treatment product with a vaccine picked after a change of type', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('radio', { name: 'Traitement' }));
    await within(dialog).findByRole('option', { name: 'Amoxicilline' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Amoxicilline');
    fireEvent.change(await within(dialog).findByLabelText('Quantité'), { target: { value: '1' } });
    await within(dialog).findByRole('option', { name: 'AM-1 (5)' });
    await user.selectOptions(within(dialog).getByLabelText('Lot de produit'), 'AM-1 (5)');
    await user.click(within(dialog).getByRole('radio', { name: 'Vaccination' }));
    await within(dialog).findByRole('option', { name: 'Vaccin Gumboro' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    fireEvent.change(await within(dialog).findByLabelText('Quantité'), { target: { value: '1' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      type: 'VACCINATION', status: 'REALISE', date: todayIso(), batchId: 'l1', stockItemId: 's4', quantity: 1,
    });
  });

  it('does not bring back the old batch after a planned detour and another product choice', async () => {
    const { user, dialog } = await openForm();
    await within(dialog).findByRole('option', { name: 'Vaccin Gumboro' });
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    fireEvent.change(await within(dialog).findByLabelText('Quantité'), { target: { value: '1' } });
    await within(dialog).findByRole('option', { name: 'GB-77 (8)' });
    await user.selectOptions(within(dialog).getByLabelText('Lot de produit'), 'GB-77 (8)');
    await user.click(within(dialog).getByRole('radio', { name: 'Planifié' }));
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), '');
    await user.selectOptions(within(dialog).getByLabelText('Produit en stock'), 'Vaccin Gumboro');
    await user.click(within(dialog).getByRole('radio', { name: 'Réalisé' }));
    await within(dialog).findByRole('option', { name: 'GB-77 (8)' });
    expect(within(dialog).getByLabelText('Lot de produit')).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText('Quantité'), { target: { value: '1' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      type: 'VACCINATION', status: 'REALISE', date: todayIso(), batchId: 'l1', stockItemId: 's4', quantity: 1,
    });
  });
});

describe('plan steps without read rights on stocks', () => {
  it('edits a step name without any stock request and resends every stock product', async () => {
    mountPage({ perms: { sante: ['read', 'update'] } });
    await openTab('Plans vaccinaux');
    await screen.findByText('Programme chair');
    const user = userEvent.setup();
    await user.click(within(rowOf('Programme chair')).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Produit en stock ligne 1')).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Produit ligne 1'), ' B');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      items: [
        { ageDays: 1, productName: 'Marek B', dose: '1 dose', stockItemId: 's4' },
        { ageDays: 7, productName: 'Gumboro', stockItemId: 's4' },
      ],
    });
    expect(calls.some((c) => c.url.startsWith('/api/stock'))).toBe(false);
  });
});
