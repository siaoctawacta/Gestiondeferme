import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { BuildingDetail } from './BuildingDetail';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

const OVERVIEW = {
  building: { id: 'b1', name: 'Poulailler B', type: 'AVICOLE', status: 'ACTIF' },
  site: { id: 's1', name: 'Site Nord' },
  occupation: 4820,
  capacity: 5000,
  lots: [{ id: 'l1', code: 'LC-2026-14', species: 'AVICOLE', alive: 4820 }],
  animals: null,
  equipment: [{ id: 'eq4', name: 'Ventilateur Poulailler B #3', condition: 'EN_PANNE', nextMaintenance: '2026-10-20' }],
  openTasks: 3,
  lastHealthActs: [{ id: 'h1', date: '2026-11-01', type: 'VACCINATION', productName: 'Gumboro', status: 'REALISE' }],
};

const fetchMock = vi.fn<typeof fetch>();
const urls: string[] = [];

function mount(overview: unknown = OVERVIEW, perms: Record<string, string[]> = { batiments: ALL }, missing = false) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    if (url.startsWith('/api/buildings/b1/overview')) return missing ? json(404, { message: 'Introuvable' }) : json(200, overview);
    if (url.startsWith('/api/qr/batiment/b1')) {
      return json(200, { kind: 'batiment', id: 'b1', farmId: 'f1', farmName: 'Ferme', path: '/m/batiments/b1', url: 'http://x/q/batiment/b1', label: 'Poulailler B', sublabel: 'Site Nord', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
    throw new Error(`unexpected ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AuthProvider><BuildingDetail id="b1" /></AuthProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  urls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('BuildingDetail', () => {
  it('shows the header, the status pill and the three tiles', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Poulailler B' })).toBeInTheDocument();
    expect(screen.getByText('Avicole · Site Nord')).toBeInTheDocument();
    expect(screen.getByText('Actif').closest('[data-tone]')).toHaveAttribute('data-tone', 'success');
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(flat(tile('Capacité')!.textContent)).toBe('5 000');
    expect(flat(tile('Occupation')!.textContent)).toBe('4 820');
    expect(tile("Taux d'occupation")!.textContent).toBe('96.4%');
    expect(urls).toContain('/api/buildings/b1/overview');
  });

  it('renders the four cards with their content when every part is readable', async () => {
    mount({ ...OVERVIEW, animals: 12 });
    await screen.findByRole('heading', { name: 'Poulailler B' });
    const card = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
    expect(within(card('Lots et animaux')).getByRole('link', { name: 'LC-2026-14' })).toHaveAttribute('href', '/m/lots/l1');
    expect(within(card('Lots et animaux')).getByText(/4\s820/)).toBeInTheDocument();
    expect(within(card('Lots et animaux')).getByText(/12 animaux/)).toBeInTheDocument();
    const equipment = within(card('Équipements'));
    expect(equipment.getByRole('link', { name: 'Ventilateur Poulailler B #3' })).toHaveAttribute('href', '/m/equipements/eq4');
    expect(equipment.getByText('En panne').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger');
    expect(equipment.getByText(/2026-10-20/)).toBeInTheDocument();
    expect(within(card('Tâches ouvertes')).getByText('3')).toBeInTheDocument();
    expect(within(card('Tâches ouvertes')).getByRole('link', { name: 'Voir les tâches' })).toHaveAttribute('href', '/m/taches');
    expect(within(card('Derniers actes sanitaires')).getByText(/Vaccination/)).toBeInTheDocument();
    expect(within(card('Derniers actes sanitaires')).getByText(/Gumboro/)).toBeInTheDocument();
  });

  it('renders no Lots et animaux card when the lots (and the animals) are null', async () => {
    mount({ ...OVERVIEW, lots: null, animals: null });
    await screen.findByRole('heading', { name: 'Poulailler B' });
    expect(screen.queryByRole('heading', { name: 'Lots et animaux' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Équipements' })).toBeInTheDocument();
  });

  it('keeps the card for the animals alone when only the lots are hidden', async () => {
    mount({ ...OVERVIEW, lots: null, animals: 12 });
    await screen.findByRole('heading', { name: 'Poulailler B' });
    const card = within(screen.getByRole('heading', { name: 'Lots et animaux' }).closest('section')!);
    expect(card.getByText(/12 animaux/)).toBeInTheDocument();
    expect(card.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders each other card only when its part is not null', async () => {
    mount({ ...OVERVIEW, equipment: null, openTasks: null, lastHealthActs: null });
    await screen.findByRole('heading', { name: 'Poulailler B' });
    for (const t of ['Équipements', 'Tâches ouvertes', 'Derniers actes sanitaires']) expect(screen.queryByRole('heading', { name: t })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lots et animaux' })).toBeInTheDocument();
  });

  it('says so in an empty card', async () => {
    mount({ ...OVERVIEW, lots: [], equipment: [], lastHealthActs: [], openTasks: 0 });
    await screen.findByRole('heading', { name: 'Poulailler B' });
    expect(screen.getByText('Aucun lot en cours')).toBeInTheDocument();
    expect(screen.getByText('Aucun équipement')).toBeInTheDocument();
    expect(screen.getByText('Aucun acte sanitaire')).toBeInTheDocument();
  });

  it('links a pig lot to the pig herd page', async () => {
    mount({ ...OVERVIEW, lots: [{ id: 'p1', code: 'LP-2026-02', species: 'PORCIN', alive: 40 }] });
    expect(await screen.findByRole('link', { name: 'LP-2026-02' })).toHaveAttribute('href', '/m/porcs/p1');
  });

  it('opens the QR dialog of the building from the QR button', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Poulailler B' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'QR code' }));
    expect(await screen.findByRole('dialog', { name: 'QR code — Poulailler B' })).toBeInTheDocument();
    await waitFor(() => expect(urls).toContain('/api/qr/batiment/b1'));
  });

  it('shows the not-found card for an unknown building', async () => {
    mount(OVERVIEW, { batiments: ALL }, true);
    expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  });
});
