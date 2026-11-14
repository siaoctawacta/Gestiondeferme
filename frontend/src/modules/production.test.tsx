import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModuleList, ModulePage } from '../components/module/ModulePage';
import type { ModuleConfig } from '../components/module/types';
import { ponte } from './ponte';
import { porcs } from './porcs';
import { reproduction } from './reproduction';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];

const EGGS = [
  { id: 'e1', date: '2026-10-22', batchId: 'l1', batchCode: 'LP-2026-03', collected: 2480, broken: 42, downgraded: 0, toIncubation: 0, marketable: 2438, breakageRate: 1.7, layingRate: 87 },
  { id: 'e2', date: '2026-10-20', batchId: 'l1', batchCode: 'LP-2026-03', collected: 2455, broken: 88, downgraded: 0, toIncubation: 0, marketable: 2367, breakageRate: 3.6, layingRate: 86 },
  { id: 'e3', date: '2026-10-19', batchId: 'l1', batchCode: 'LP-2026-03', collected: 2530, broken: 52, downgraded: 0, toIncubation: 0, marketable: 2478, breakageRate: 2.1, layingRate: 88 },
];
const INCUBATIONS = [
  { id: 'i1', code: 'INC-2026-01', incubator: 'Couveuse 1', startDate: '2026-10-01', eggsSet: 300, fertileEggs: 280, expectedHatchDate: '2026-10-22', chicksHatched: null, hatchRate: null, fertilityRate: 93.3, status: 'EN_COURS' },
  { id: 'i2', code: 'INC-2026-00', incubator: 'Couveuse 1', startDate: '2026-09-01', eggsSet: 300, fertileEggs: 280, expectedHatchDate: '2026-09-22', chicksHatched: 260, hatchRate: 86.7, status: 'ECLOSE' },
];
const HERD = [
  { id: 'a1', kind: 'ANIMAL', identifier: 'TR-014', category: 'Truie', breedName: 'Large White', buildingName: 'Maternité', birthDate: '2024-02-10', weightKg: 210, headcount: 1, status: 'GESTANTE' },
  { id: 'a2', kind: 'ANIMAL', identifier: 'VR-002', category: 'Verrat', breedName: 'Duroc', buildingName: 'Maternité', birthDate: '2023-05-01', weightKg: 260, headcount: 1, status: 'ACTIF' },
  { id: 'p1', kind: 'LOT', identifier: 'LOT-ENG-01', category: 'Engraissement', breedName: null, buildingName: 'Porcherie 1', entryDate: '2026-09-01', weightKg: 62, headcount: 240, status: 'EN_COURS' },
];
const BREEDING = [
  { id: 'b1', sowId: 'a1', sowTag: 'TR-014', sire: 'VR-002', serviceDate: '2026-07-05', expectedFarrowingDate: '2026-10-27', bornTotal: 0, bornAlive: 0, weanedCount: 0, status: 'GESTATION', daysToFarrowing: -18 },
  { id: 'b2', sowId: 'a3', sowTag: 'TR-020', sire: 'IA Pietrain', serviceDate: '2026-10-01', expectedFarrowingDate: '2027-01-23', bornTotal: 0, bornAlive: 0, weanedCount: 0, status: 'GESTATION', daysToFarrowing: 70 },
  { id: 'b3', sowId: 'a4', sowTag: 'TR-021', sire: 'VR-002', serviceDate: '2026-06-01', expectedFarrowingDate: '2026-09-23', bornTotal: 13, bornAlive: 12, weanedCount: 0, status: 'MISE_BAS', daysToFarrowing: -52 },
];
const animalOf = (a: (typeof HERD)[number], sex: 'F' | 'M') => ({ ...a, sex, sireTag: null, damTag: null, exitDate: null, exitReason: null, notes: null });

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
let handler: (c: Call) => Response | undefined;

const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

function mount(ui: React.ReactNode, { perms = ALL, path = '/' }: { perms?: string[]; path?: string } = {}) {
  handler = () => undefined;
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: { ponte: perms, porcs: perms, reproduction: perms, lots: perms } });
    }
    const custom = handler(call);
    if (custom) return custom;
    if (call.method !== 'GET') return json(201, { id: 'x' });
    const url = call.url;
    if (url.startsWith('/api/egg-production')) return page(EGGS);
    if (url.startsWith('/api/incubations')) return page(INCUBATIONS);
    if (url.startsWith('/api/pig-herd')) return page(HERD, { statusCounts: { ACTIF: 3, GESTANTE: 1, ALLAITANTE: 1 }, total: 5 });
    if (url.startsWith('/api/breeding')) return page(BREEDING, { statusCounts: { GESTATION: 2, MISE_BAS: 1, SEVRAGE: 0 } });
    if (/^\/api\/animals\/a1\/weighings/.test(url)) return page([{ id: 'w1', date: '2026-10-01', weightKg: 205.5 }]);
    if (/^\/api\/animals\/a1\/heats/.test(url)) return page([{ id: 'h1', date: '2026-04-01', note: 'Nette' }]);
    if (/^\/api\/animals\/a1\/breeding-history/.test(url)) {
      return json(200, {
        items: [{ id: 'b0', serviceDate: '2025-05-01', sire: 'VR-002', farrowingDate: '2025-08-23', bornTotal: 13, bornAlive: 12, weanedCount: 11, status: 'SEVRAGE' }],
        totals: { litters: 1, averageBornAlive: 12, averageWeaned: 11 },
      });
    }
    if (/^\/api\/animals\/a1(\?|$)/.test(url)) return json(200, animalOf(HERD[0], 'F'));
    if (/^\/api\/animals\/a2(\?|$)/.test(url)) return json(200, animalOf(HERD[1], 'M'));
    if (url.startsWith('/api/animals')) {
      return page([{ id: 'a2', tag: 'VR-002' }, { id: 'a1', tag: 'TR-014' }]);
    }
    if (url.startsWith('/api/batches')) {
      return page([
        { id: 'l1', code: 'LP-2026-03', type: 'PONDEUSE' },
        { id: 'l2', code: 'LC-2026-14', type: 'CHAIR' },
      ]);
    }
    if (url.startsWith('/api/breeds')) return page([{ id: 'br1', name: 'Large White' }]);
    if (url.startsWith('/api/buildings')) {
      return page([{ id: 'b1', name: 'Poulailler A', type: 'AVICOLE' }, { id: 'b2', name: 'Maternité', type: 'PORCIN' }]);
    }
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mountPage = (config: ModuleConfig<any>, opts?: Parameters<typeof mount>[1]) =>
  mount(<Routes><Route path="*" element={<ModulePage config={config} />} /></Routes>, opts);

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

const headers = (names: string[]) => names.forEach((h) => expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument());

describe('ponte', () => {
  it('renders the reference headers, a row and the breakage pills', async () => {
    mountPage(ponte);
    expect(await screen.findByText('2026-10-22')).toBeInTheDocument();
    headers(['DATE', 'LOT', 'ŒUFS COLLECTÉS', 'ŒUFS CASSÉS', 'MIS EN INCUBATION', 'TAUX DE CASSE']);
    expect(screen.getByText('Production d\'œufs journalière, casse et incubation.')).toBeInTheDocument();
    expect(screen.getByText('Total enregistrements')).toBeInTheDocument();
    const row = screen.getByText('2026-10-22').closest('tr')!;
    for (const t of ['LP-2026-03', '2 480', '42', '0', '1.7%']) expect(within(row).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(row).getByText('1.7%').className).toContain('bg-primary-soft');
    expect(within(screen.getByText('2026-10-19').closest('tr')!).getByText('2.1%').className).toContain('bg-warning');
    expect(within(screen.getByText('2026-10-20').closest('tr')!).getByText('3.6%').className).toContain('bg-destructive');
    expect(screen.getByRole('tab', { name: 'Incubation' })).toBeInTheDocument();
  });

  it('inside a lot, adds a record without the lot select and with the scope batchId', async () => {
    mount(<ModuleList config={ponte} scope={{ batchId: 'l1' }} />);
    await screen.findByText('2026-10-22');
    expect(calls.some((c) => c.url.startsWith('/api/egg-production?') && c.url.includes('batchId=l1'))).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Lot')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-01' } });
    await user.type(within(dialog).getByLabelText('Œufs collectés'), '2400');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/egg-production',
      body: { date: '2026-11-01', batchId: 'l1', collected: 2400, broken: 0, downgraded: 0, toIncubation: 0 },
    });
  });

  it('offers only laying lots in the lot select of the page form', async () => {
    mountPage(ponte);
    await screen.findByText('2026-10-22');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ajouter' }));
    const select = await screen.findByLabelText('Lot');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'LP-2026-03' })).toBeInTheDocument());
    expect(within(select).queryByRole('option', { name: 'LC-2026-14' })).not.toBeInTheDocument();
  });

  it('hatches an incubation through POST /incubations/:id/hatch, only while in progress', async () => {
    mountPage(ponte);
    await screen.findByText('2026-10-22');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Incubation' }));
    const running = (await screen.findByText('INC-2026-01')).closest('tr')!;
    headers(['CODE', 'COUVEUSE', 'DÉBUT', 'ŒUFS INCUBÉS', 'FERTILES', 'ÉCLOSION PRÉVUE', 'POUSSINS', "TAUX D'ÉCLOSION", 'STATUT']);
    const done = screen.getByText('INC-2026-00').closest('tr')!;
    for (const a of ['Mirage', 'Éclosion', 'Échec']) {
      expect(within(running).getByRole('button', { name: a })).toBeInTheDocument();
      expect(within(done).queryByRole('button', { name: a })).not.toBeInTheDocument();
    }
    expect(within(done).getByText('86.7%')).toBeInTheDocument();
    await user.click(within(running).getByRole('button', { name: 'Éclosion' }));
    const dialog = await screen.findByRole('dialog', { name: 'Éclosion — INC-2026-01' });
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-22' } });
    await user.type(within(dialog).getByLabelText('Poussins éclos'), '260');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Poulailler A' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Bâtiment'), 'Poulailler A');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      url: '/api/incubations/i1/hatch',
      body: { date: '2026-10-22', chicksHatched: 260, buildingId: 'b1' },
    });
  });

  it('shows the server message when an action is refused', async () => {
    mountPage(ponte);
    await screen.findByText('2026-10-22');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Incubation' }));
    await user.click(within((await screen.findByText('INC-2026-01')).closest('tr')!).getByRole('button', { name: 'Mirage' }));
    const dialog = await screen.findByRole('dialog');
    handler = (c) => (c.method === 'POST' ? json(400, { message: 'Trop d\'œufs fertiles' }) : undefined);
    await user.type(within(dialog).getByLabelText('Œufs fertiles'), '250');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("Trop d'œufs fertiles")).toBeInTheDocument();
  });
});

describe('porcs', () => {
  it('renders the reference headers, the tiles and the mixed rows with their links', async () => {
    mountPage(porcs);
    expect(await screen.findByText('TR-014')).toBeInTheDocument();
    headers(['IDENTIFIANT', 'CATÉGORIE', 'RACE', 'BÂTIMENT', 'DATE DE NAISSANCE', 'POIDS (KG)', 'STATUT']);
    expect(screen.getByText('Truies, verrats, porcelets, croissance et engraissement.')).toBeInTheDocument();
    for (const [label, n] of [['Total enregistrements', '5'], ['Actif', '3'], ['Gestante', '1'], ['Allaitante', '1']]) {
      expect(screen.getByText(label, { selector: 'p' }).nextElementSibling).toHaveTextContent(n);
    }
    const row = screen.getByText('TR-014').closest('tr')!;
    for (const t of ['Truie', 'Large White', 'Maternité', '2024-02-10', '210', 'Gestante']) expect(within(row).getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'TR-014' })).toHaveAttribute('href', '/m/porcs/a1');
    expect(screen.getByRole('link', { name: 'LOT-ENG-01' })).toHaveAttribute('href', '/m/lots/p1');
    const lot = screen.getByText('LOT-ENG-01').closest('tr')!;
    expect(within(lot).getByText('2026-09-01')).toBeInTheDocument();
    expect(within(lot).getByText('Actif')).toBeInTheDocument();
    expect(within(lot).queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(within(lot).queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  });

  it('deletes an animal through DELETE /animals/:id', async () => {
    mountPage(porcs);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('VR-002').closest('tr')!).getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/animals/a2' });
  });

  it('edits an animal through PATCH /animals/:id', async () => {
    mountPage(porcs);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('TR-014').closest('tr')!).getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Animal individuel' });
    expect(within(dialog).getByLabelText('Catégorie')).toHaveValue('TRUIE');
    fireEvent.change(within(dialog).getByLabelText('Date de naissance'), { target: { value: '2024-02-11' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/animals/a1', body: { tag: 'TR-014', category: 'TRUIE', sex: 'F', birthDate: '2024-02-11' } });
  });

  it('asks animal or lot, then posts the animal to /animals with its sex', async () => {
    mountPage(porcs);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Animal individuel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Animal individuel' });
    await user.selectOptions(within(dialog).getByLabelText('Catégorie'), 'Verrat');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maternité' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Bâtiment'), 'Maternité');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/animals', body: { category: 'VERRAT', sex: 'M', buildingId: 'b2' } });
    expect(Object.keys(writes()[0].body as object).sort()).toEqual(['buildingId', 'category', 'sex']);
  });

  it('lists the porcine buildings first and posts a lot to /batches with the species', async () => {
    mountPage(porcs);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lot de porcs' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Lot de porcs' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Engraissement');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maternité' })).toBeInTheDocument());
    const options = within(within(dialog).getByLabelText('Bâtiment')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Sélectionner…', 'Maternité', 'Poulailler A']);
    await user.selectOptions(within(dialog).getByLabelText('Bâtiment'), 'Maternité');
    fireEvent.change(within(dialog).getByLabelText("Date d'entrée"), { target: { value: '2026-11-01' } });
    await user.type(within(dialog).getByLabelText('Effectif initial'), '240');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/batches',
      body: { species: 'PORCIN', type: 'ENGRAISSEMENT', buildingId: 'b2', entryDate: '2026-11-01', initialCount: 240 },
    });
  });
});

describe('animal detail', () => {
  const mountDetail = (id: string, opts?: Parameters<typeof mount>[1]) => {
    const Detail = porcs.detail!;
    mount(
      <Routes>
        <Route path="/m/porcs/:id" element={<Detail id={id} />} />
        <Route path="/m/porcs" element={<p>Cheptel</p>} />
      </Routes>,
      { ...opts, path: `/m/porcs/${id}` },
    );
  };

  it('shows the figures, the weighings and the breeding history of a sow', async () => {
    mountDetail('a1');
    expect(await screen.findByRole('heading', { name: 'TR-014' })).toBeInTheDocument();
    expect(screen.getByText('Poids', { selector: 'p' }).nextElementSibling).toHaveTextContent('210 kg');
    expect(screen.getByText('Statut', { selector: 'p' }).nextElementSibling).toHaveTextContent('Gestante');
    expect(screen.getByText('Âge', { selector: 'p' }).nextElementSibling).toHaveTextContent(/ans|mois/);
    expect(await screen.findByText('205.5')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Reproduction' }));
    expect(await screen.findByText('2025-08-23')).toBeInTheDocument();
    expect(screen.getByText('Portées').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Nés vivants (moy.)').nextElementSibling).toHaveTextContent('12.0');
    expect(screen.getByText('Sevrés (moy.)').nextElementSibling).toHaveTextContent('11.0');
    await user.click(screen.getByRole('tab', { name: 'Chaleurs' }));
    expect(await screen.findByText('Nette')).toBeInTheDocument();
  });

  it('has no breeding tabs for a boar', async () => {
    mountDetail('a2');
    await screen.findByRole('heading', { name: 'VR-002' });
    expect(screen.getByRole('tab', { name: 'Pesées' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Reproduction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Chaleurs' })).not.toBeInTheDocument();
  });

  it('records an exit through POST /animals/:id/exit, and hides the action without update permission', async () => {
    mountDetail('a1');
    await screen.findByRole('heading', { name: 'TR-014' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sortie' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-10' } });
    await user.selectOptions(within(dialog).getByLabelText('Motif'), 'Vendu');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/animals/a1/exit', body: { date: '2026-11-10', reason: 'VENDU' } });
  });

  it('hides the exit action for a read-only user', async () => {
    mountDetail('a1', { perms: ['read'] });
    await screen.findByRole('heading', { name: 'TR-014' });
    expect(screen.queryByRole('button', { name: 'Sortie' })).not.toBeInTheDocument();
  });
});

describe('reproduction', () => {
  it('renders the reference headers, the tiles and a row with its overdue date in red', async () => {
    mountPage(reproduction);
    expect(await screen.findByText('2026-10-27')).toBeInTheDocument();
    headers(['TRUIE', 'VERRAT / IA', 'DATE SAILLIE', 'NÉS TOTAUX', 'NÉS VIVANTS', 'SEVRÉS', 'STATUT', 'MISE BAS PRÉVUE']);
    expect(screen.getByText('Saillies, gestations, mises bas et sevrages.')).toBeInTheDocument();
    for (const [label, n] of [['Total enregistrements', '3'], ['Gestation', '2'], ['Mise bas', '1'], ['Sevrage', '0']]) {
      expect(screen.getByText(label, { selector: 'p' }).nextElementSibling).toHaveTextContent(n);
    }
    const row = screen.getByText('TR-014').closest('tr')!;
    for (const t of ['VR-002', '2026-07-05', 'Gestation']) expect(within(row).getByText(t)).toBeInTheDocument();
    expect(within(row).getAllByText('0')).toHaveLength(3);
    expect(screen.getByText('2026-10-27').className).toContain('text-destructive');
    expect(screen.getByText('2027-01-23').className).not.toContain('text-destructive');
    // Overdue but already farrowed: not red.
    expect(screen.getByText('2026-09-23').className).not.toContain('text-destructive');
  });

  it('offers each action only on its statuses and hides edit and delete once farrowed', async () => {
    mountPage(reproduction);
    await screen.findByText('TR-014');
    const gestation = screen.getByText('TR-014').closest('tr')!;
    const farrowed = screen.getByText('TR-021').closest('tr')!;
    expect(within(gestation).getByRole('button', { name: 'Mise bas' })).toBeInTheDocument();
    expect(within(gestation).getByRole('button', { name: 'Échec' })).toBeInTheDocument();
    expect(within(gestation).queryByRole('button', { name: 'Sevrage' })).not.toBeInTheDocument();
    expect(within(gestation).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(within(farrowed).queryByRole('button', { name: 'Mise bas' })).not.toBeInTheDocument();
    expect(within(farrowed).queryByRole('button', { name: 'Échec' })).not.toBeInTheDocument();
    expect(within(farrowed).getByRole('button', { name: 'Sevrage' })).toBeInTheDocument();
    expect(within(farrowed).queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(within(farrowed).queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('records a farrowing through POST /breeding/:id/farrowing', async () => {
    mountPage(reproduction);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('TR-014').closest('tr')!).getByRole('button', { name: 'Mise bas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mise bas — TR-014' });
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-29' } });
    await user.type(within(dialog).getByLabelText('Nés totaux'), '13');
    await user.type(within(dialog).getByLabelText('Nés vivants'), '12');
    await user.type(within(dialog).getByLabelText('Mort-nés'), '1');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Maternité' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Bâtiment de la portée'), 'Maternité');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      url: '/api/breeding/b1/farrowing',
      body: { date: '2026-10-29', bornTotal: 13, bornAlive: 12, stillborn: 1, buildingId: 'b2' },
    });
  });

  it('records a weaning and a failure', async () => {
    mountPage(reproduction);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('TR-021').closest('tr')!).getByRole('button', { name: 'Sevrage' }));
    let dialog = await screen.findByRole('dialog', { name: 'Sevrage — TR-021' });
    await user.type(within(dialog).getByLabelText('Nombre sevrés'), '11');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/breeding/b3/weaning', body: { weanedCount: 11 } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(within(screen.getByText('TR-020').closest('tr')!).getByRole('button', { name: 'Échec' }));
    dialog = await screen.findByRole('dialog', { name: 'Échec — TR-020' });
    await user.type(within(dialog).getByLabelText('Note'), 'Retour en chaleur');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ url: '/api/breeding/b2/fail', body: { note: 'Retour en chaleur' } });
  });

  it('creates a saillie with a boar, then an IA with a semen label', async () => {
    mountPage(reproduction);
    await screen.findByText('TR-014');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    let dialog = await screen.findByRole('dialog', { name: 'Ajouter — Reproduction' });
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'TR-014' })).toHaveLength(2));
    expect(calls.some((c) => c.url.startsWith('/api/animals?') && c.url.includes('sex=F') && c.url.includes('status=ACTIF'))).toBe(true);
    expect(within(dialog).queryByLabelText('Semence')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Truie'), 'a1');
    await user.selectOptions(within(dialog).getByLabelText('Verrat'), 'VR-002');
    fireEvent.change(within(dialog).getByLabelText('Date de saillie'), { target: { value: '2026-11-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/breeding', body: { sowId: 'a1', method: 'SAILLIE', boarId: 'a2', serviceDate: '2026-11-01' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    dialog = await screen.findByRole('dialog', { name: 'Ajouter — Reproduction' });
    await user.selectOptions(within(dialog).getByLabelText('Méthode'), 'IA');
    expect(within(dialog).queryByLabelText('Verrat')).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getAllByRole('option', { name: 'TR-014' }).length).toBeGreaterThan(0));
    await user.selectOptions(within(dialog).getByLabelText('Truie'), 'a1');
    await user.type(within(dialog).getByLabelText('Semence'), 'Pietrain');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toMatchObject({ sowId: 'a1', method: 'IA', semenLabel: 'Pietrain' });
    expect(writes()[1].body).not.toHaveProperty('boarId');
  });
});
