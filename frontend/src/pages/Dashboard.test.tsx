import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import Alerts from './Alerts';
import Audit from './Audit';
import Dashboard from './Dashboard';
import '../modules';
import { EggChart, niceDomain } from './dashboard/EggChart';
import { Shell } from '../App';
import { RequireAuth } from '../components/shell/guards';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'SUPER_ADMIN', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];
const fetchMock = vi.fn<typeof fetch>();
const urls: string[] = [];

const ALERT_ITEMS = [
  { key: 'a1', title: 'Stock faible : Aliment ponte', detail: '900 kg (seuil 1500)', level: 'A_VOIR', module: 'stocks' },
  { key: 'a2', title: 'Stock critique : Aliment engraissement porc', detail: '600 kg (seuil 1500)', level: 'URGENT', module: 'stocks' },
];

const FULL = {
  farmName: 'Ferme Kpalimé',
  tasks: { done: 1, pending: 3 },
  kpis: { poultryAlive: 11570, activePoultryBatches: 3, pigs: 245, eggsLastDay: 2480, layingRate: 87, mortalityRate: 3.6 },
  eggSeries: [
    { date: '2026-10-18', eggs: 2490 }, { date: '2026-10-19', eggs: 2530 }, { date: '2026-10-20', eggs: 2455 },
    { date: '2026-10-21', eggs: 2510 }, { date: '2026-10-22', eggs: 2480 },
  ],
  profitability: { revenue: 3970000, expenses: 2835000, margin: 1135000, marginPct: 29, receivables: 400000 },
  activeBuildings: 5,
  feedDistributedKg: 1800,
  waterConsumedL: 4370,
  revenueVsExpenses: [
    { activity: 'AVICOLE', revenue: 2050000, expenses: 1140000, margin: 910000 },
    { activity: 'PORCIN', revenue: 1920000, expenses: 560000, margin: 1360000 },
    { activity: 'GENERAL', revenue: 0, expenses: 1135000, margin: -1135000 },
  ],
  alerts: { total: 14, items: ALERT_ITEMS },
  upcomingTasks: [
    { id: 't1', title: 'Pesée hebdomadaire LC-2026-14', assignee: 'Kodjo A.', dueDate: '2026-10-23', priority: 'NORMALE' },
    { id: 't2', title: 'Vaccination Gumboro LC-2026-15', assignee: 'Dr Koffi', dueDate: '2026-10-24', priority: 'HAUTE' },
  ],
};

const EMPTY = {
  farmName: 'Ferme Kpalimé',
  tasks: { done: 0, pending: 0 },
  kpis: { poultryAlive: 0, activePoultryBatches: 0, pigs: 0, eggsLastDay: 0, layingRate: null, mortalityRate: null },
  eggSeries: [],
  profitability: { revenue: 0, expenses: 0, margin: 0, marginPct: null, receivables: 0 },
  activeBuildings: 2,
  feedDistributedKg: 0,
  waterConsumedL: 0,
  revenueVsExpenses: [
    { activity: 'AVICOLE', revenue: 0, expenses: 0, margin: 0 },
    { activity: 'PORCIN', revenue: 0, expenses: 0, margin: 0 },
    { activity: 'GENERAL', revenue: 0, expenses: 0, margin: 0 },
  ],
  alerts: { total: 0, items: [] },
  upcomingTasks: [],
};

function mount(page: ReactElement, routes: (url: string) => Response | undefined, perms: Record<string, string[]> = { dashboard: ALL, alertes: ALL, rapports: ALL, audit: ['read'] }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') {
      return json(200, {
        user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true,
        permissions: perms,
      });
    }
    const res = routes(url);
    if (res) return res;
    throw new Error(`unexpected ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>{page}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  urls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('Dashboard', () => {
  it('shows the reference values', async () => {
    mount(<Dashboard />, (u) => (u === '/api/dashboard' ? json(200, FULL) : undefined));
    expect(await screen.findByText('Bonjour 👋 — Ferme Kpalimé')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument();
    expect(screen.getByText('11 570')).toBeInTheDocument();
    expect(screen.getByText('3 lots en cours')).toBeInTheDocument();
    expect(screen.getByText('245')).toBeInTheDocument();
    expect(screen.getByText('2 480')).toBeInTheDocument();
    expect(screen.getByText('Taux de ponte 87%')).toBeInTheDocument();
    expect(screen.getByText('3.6%')).toBeInTheDocument();
    expect(screen.getByText('3 970 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('2 835 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('1 135 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('29%')).toBeInTheDocument();
    expect(screen.getByText('5 bâtiments actifs')).toBeInTheDocument();
    expect(screen.getByText('1 800 kg')).toBeInTheDocument();
    expect(screen.getByText('Alertes ouvertes')).toBeInTheDocument();
    expect(screen.getByText('(14)')).toBeInTheDocument();
    expect(screen.getByText('À voir')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gérer' })).toHaveAttribute('href', '/m/taches');
    expect(screen.getByText(/Tâches terminées/)).toHaveTextContent('Tâches terminées 1');
    expect(screen.getByText(/En attente/)).toHaveTextContent('En attente 3');
    expect(screen.getByText('Haute')).toBeInTheDocument();
  });

  it('shows dashes and empty states for the slice-1 empty data', async () => {
    mount(<Dashboard />, (u) => (u === '/api/dashboard' ? json(200, EMPTY) : undefined));
    await screen.findByText('Bonjour 👋 — Ferme Kpalimé');
    const mortality = screen.getByText('Mortalité lots').closest('div')!.parentElement!;
    expect(within(mortality).getByText('—')).toBeInTheDocument();
    expect(screen.getAllByText('Aucune donnée pour le moment').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2 bâtiments actifs')).toBeInTheDocument();
  });

  it('offers a retry when the dashboard cannot be loaded', async () => {
    let calls = 0;
    mount(<Dashboard />, (u) => {
      if (u !== '/api/dashboard') return undefined;
      calls += 1;
      return calls === 1 ? json(500, { message: 'Erreur serveur' }) : json(200, EMPTY);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Bonjour 👋 — Ferme Kpalimé')).toBeInTheDocument();
  });
});

describe('Dashboard new task', () => {
  const routes = (u: string) => {
    if (u === '/api/dashboard') return json(200, FULL);
    if (u === '/api/tasks') return json(201, { id: 't9' });
    if (u.startsWith('/api/employees/options')) return json(200, { items: [{ id: 'e1', name: 'Kodjo A.', jobTitle: 'Agent', userId: null }] });
    return undefined;
  };

  it('opens the task dialog for a user who may create tasks, and refreshes the dashboard after saving', async () => {
    mount(<Dashboard />, routes, { dashboard: ['read'], taches: ['read', 'create'] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Nouvelle tâche/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Tâches & personnel' });
    await user.type(within(dialog).getByLabelText('Tâche'), 'Contrôle eau');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(urls.filter((u) => u === '/api/dashboard').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no Nouvelle tâche for a user who cannot create tasks', async () => {
    mount(<Dashboard />, routes, { dashboard: ['read'], taches: ['read'] });
    await screen.findByText('Bonjour 👋 — Ferme Kpalimé');
    expect(screen.queryByRole('button', { name: /Nouvelle tâche/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nouvelle tâche/ })).not.toBeInTheDocument();
  });
});

describe('Dashboard without finance access', () => {
  const layout = (id: string) => screen.getByTestId(id).className;

  it.each([
    ['the card is null', { profitability: null }, 'lg:col-span-3', 'lg:grid-cols-3', true, false],
    ['the chart is null', { revenueVsExpenses: null }, 'lg:col-span-2', 'lg:grid-cols-2', false, true],
    ['both are null', { profitability: null, revenueVsExpenses: null }, 'lg:col-span-3', 'lg:grid-cols-2', true, true],
  ])('closes the grid up when %s, with no placeholder and no /finance request', async (_name, over, eggSpan, rowCols, noCard, noChart) => {
    mount(<Dashboard />, (u) => (u === '/api/dashboard' ? json(200, { ...FULL, ...over }) : undefined));
    await screen.findByText('Bonjour 👋 — Ferme Kpalimé');
    expect(screen.queryByText('Rentabilité du mois') === null).toBe(noCard);
    expect(screen.queryByText('Recettes vs dépenses') === null).toBe(noChart);
    if (noCard) expect(screen.queryByText("Chiffre d'affaires")).not.toBeInTheDocument();
    expect(screen.queryByText('0 FCFA')).not.toBeInTheDocument();
    expect(layout('egg-chart-cell')).toContain(eggSpan);
    expect(layout('farm-alerts-row')).toContain(rowCols);
    if (noChart) expect(layout('farm-alerts-row')).not.toContain('lg:grid-cols-3');
    else expect(layout('farm-alerts-row')).toContain('lg:grid-cols-3');
    expect(urls.some((u) => u.includes('/finance'))).toBe(false);
  });

  it('keeps the three-column layout for a role that sees everything', async () => {
    mount(<Dashboard />, (u) => (u === '/api/dashboard' ? json(200, FULL) : undefined));
    await screen.findByText('Bonjour 👋 — Ferme Kpalimé');
    expect(layout('egg-chart-cell')).toContain('lg:col-span-2');
    expect(layout('farm-alerts-row')).toContain('lg:grid-cols-3');
  });

});

describe('Alerts', () => {
  it('lists alerts with their module label', async () => {
    mount(<Alerts />, (u) => (u === '/api/alerts' ? json(200, { total: 2, items: ALERT_ITEMS }) : undefined));
    expect(await screen.findByText('2 alertes ouvertes, calculées automatiquement à partir de vos données.')).toBeInTheDocument();
    expect(screen.getByText('Stock critique : Aliment engraissement porc')).toBeInTheDocument();
    expect(screen.getAllByText('Stocks')).toHaveLength(2);
  });

  it('shows an empty state', async () => {
    mount(<Alerts />, (u) => (u === '/api/alerts' ? json(200, { total: 0, items: [] }) : undefined));
    expect(await screen.findByText('Aucune alerte pour le moment.')).toBeInTheDocument();
  });
});

describe('Audit', () => {
  const ITEM = {
    id: 'l1', createdAt: '2026-11-14T09:05:00.000Z', userName: 'Awa', action: 'CREATE',
    module: 'batiments', label: 'Poulailler A', recordId: 'b1',
  };

  it('renders entries with French labels', async () => {
    mount(<Audit />, (u) => (u.startsWith('/api/audit') ? json(200, { items: [ITEM], total: 1, page: 1, pageSize: 25 }) : undefined));
    expect(await screen.findByText('Création')).toBeInTheDocument();
    expect(screen.getByText('Bâtiments', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('Poulailler A')).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.queryByText(/Page 1 sur/)).not.toBeInTheDocument();
  });

  it('shows the empty text and paginates when there are more rows than a page', async () => {
    mount(<Audit />, (u) => (u.startsWith('/api/audit') ? json(200, { items: [], total: 0, page: 1, pageSize: 25 }) : undefined));
    expect(await screen.findByText('Aucune action enregistrée pour le moment.')).toBeInTheDocument();
  });

  it('paginates and filters by module', async () => {
    mount(<Audit />, (u) => (u.startsWith('/api/audit') ? json(200, { items: [ITEM], total: 60, page: 1, pageSize: 25 }) : undefined));
    expect(await screen.findByText('Page 1 sur 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/api/audit') && u.includes('page=2'))).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText('Filtrer par module'), 'batiments');
    await waitFor(() => expect(urls.some((u) => u.includes('module=batiments') && u.includes('page=1'))).toBe(true));
  });
});

describe('Dashboard edge cases', () => {
  it('shows a dash for a null margin rate even with revenue', async () => {
    const dto = { ...FULL, profitability: { ...FULL.profitability, marginPct: null } };
    mount(<Dashboard />, (u) => (u === '/api/dashboard' ? json(200, dto) : undefined));
    const card = (await screen.findByText('Rentabilité du mois')).closest('div')!;
    expect(within(card).getByText('—')).toBeInTheDocument();
    expect(within(card).getByText('3 970 000 FCFA')).toBeInTheDocument();
    expect(within(card).queryByText('0%')).not.toBeInTheDocument();
  });

  it('takes the alert count from the shared alerts hook', async () => {
    mount(<Dashboard />, (u) => (u === '/api/dashboard' ? json(200, FULL) : u === '/api/alerts' ? json(200, { total: 9, items: ALERT_ITEMS }) : undefined));
    expect(await screen.findByText('(9)')).toBeInTheDocument();
  });
});

describe('Shell alert indicators', () => {
  const shell = (total: number) =>
    mount(<RequireAuth><Shell><p>page</p></Shell></RequireAuth>, (u) => (u === '/api/alerts' ? json(200, { total, items: [] }) : undefined));

  it('shows the pill and the dot when alerts exist', async () => {
    shell(14);
    const sidebarLink = await screen.findByRole('link', { name: /^Alertes\s*14$/ });
    expect(sidebarLink).toBeInTheDocument();
    const bell = screen.getByRole('link', { name: 'Alertes (14 ouvertes)' });
    expect(bell.querySelector('.bg-destructive')).not.toBeNull();
  });

  it('shows neither pill nor dot without alerts', async () => {
    shell(0);
    await screen.findByText('page');
    await waitFor(() => expect(urls).toContain('/api/alerts'));
    const bell = document.querySelector('a[aria-label="Alertes"]')!;
    expect(bell.querySelector('.bg-destructive')).toBeNull();
  });
});

describe('EggChart', () => {
  const renderChart = (series: { date: string; eggs: number }[]) =>
    render(<MemoryRouter><EggChart series={series} /></MemoryRouter>);

  it('gives flat series a range with distinct ticks', () => {
    expect(niceDomain([0, 0, 0])).toEqual([0, 4]);
    expect(niceDomain([2480])).toEqual([2478, 2482]);
    const { container } = renderChart(['18', '19', '20'].map((d) => ({ date: `2026-10-${d}`, eggs: 0 })));
    const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map((t) => t.textContent);
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it('draws a visible dot for a one-point series', () => {
    const { container } = renderChart([{ date: '2026-10-22', eggs: 2480 }]);
    expect(container.querySelector('.recharts-dot')).not.toBeNull();
  });
});

describe('Audit pills and search', () => {
  const entry = (id: string, action: string) => ({
    id, createdAt: '2026-11-14T09:05:00.000Z', userName: 'Awa', action, module: 'batiments', label: `L-${id}`, recordId: id,
  });

  it('labels every action and falls back to Autre', async () => {
    const items = ['UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'WHATEVER'].map((a, i) => entry(String(i), a));
    mount(<Audit />, (u) => (u.startsWith('/api/audit') ? json(200, { items, total: 5, page: 1, pageSize: 25 }) : undefined));
    for (const label of ['Modification', 'Suppression', 'Connexion', 'Déconnexion', 'Autre']) {
      expect(await screen.findByText(label, { selector: 'span' })).toBeInTheDocument();
    }
  });

  it('sends the search term after the debounce', async () => {
    mount(<Audit />, (u) => (u.startsWith('/api/audit') ? json(200, { items: [], total: 0, page: 1, pageSize: 25 }) : undefined));
    await screen.findByText('Aucune action enregistrée pour le moment.');
    await userEvent.type(screen.getByLabelText('Rechercher'), 'poul');
    await waitFor(() => expect(urls.some((u) => u.includes('/api/audit') && u.includes('search=poul'))).toBe(true));
  });
});
