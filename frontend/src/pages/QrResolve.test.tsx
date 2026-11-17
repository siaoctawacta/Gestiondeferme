import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import QrResolve from './QrResolve';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const FARMS = [{ id: 'f1', name: 'Ferme Nord' }, { id: 'f2', name: 'Ferme Sud' }];

interface Call { method: string; url: string; farm: string | null }
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();
let qr: (url: string) => Response;

function mount(path: string, { canSeeAllFarms = false, farm = 'f1' }: { canSeeAllFarms?: boolean; farm?: string } = {}) {
  localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const farmHeader = new Headers(init?.headers).get('X-Farm-Id');
    calls.push({ method: init?.method ?? 'GET', url, farm: farmHeader });
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: FARMS, canSeeAllFarms, permissions: { lots: ['read'] } });
    if (url.startsWith('/api/qr/')) return qr(url);
    throw new Error(`unexpected ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/q/:kind/:id" element={<QrResolve />} />
            <Route path="/m/lots/:id" element={<p>Page du lot</p>} />
            <Route path="/" element={<p>Tableau de bord</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const answer = (farmId: string | null) => ({
  kind: 'lot', id: 'abc', farmId, farmName: 'Ferme Sud', path: '/m/lots/abc', url: 'http://localhost:5173/q/lot/abc',
  label: 'LC-2026-14', sublabel: 'Poulets de chair', svg: '<svg/>',
});

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

describe('/q/:kind/:id', () => {
  it('asks the API and opens the record of the active farm', async () => {
    qr = () => json(200, answer('f1'));
    mount('/q/lot/abc');
    expect(await screen.findByText('Page du lot')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/qr/lot/abc')).toBe(true);
    expect(localStorage.getItem('ap_farm')).toBe('f1');
  });

  it('switches to the record’s farm when the user has it, then opens the record', async () => {
    qr = () => json(200, answer('f2'));
    mount('/q/lot/abc');
    expect(await screen.findByText('Page du lot')).toBeInTheDocument();
    expect(localStorage.getItem('ap_farm')).toBe('f2');
  });

  it('keeps the active farm for a record of no farm (an article) and under all farms', async () => {
    qr = () => json(200, answer(null));
    mount('/q/lot/abc');
    expect(await screen.findByText('Page du lot')).toBeInTheDocument();
    expect(localStorage.getItem('ap_farm')).toBe('f1');
  });

  it('does not switch farm for a farm the user is not assigned to', async () => {
    qr = () => json(200, answer('f9'));
    mount('/q/lot/abc');
    expect(await screen.findByText('Page du lot')).toBeInTheDocument();
    expect(localStorage.getItem('ap_farm')).toBe('f1');
  });

  it('shows one card for a missing or forbidden record, with a way back', async () => {
    qr = () => json(404, { message: 'QR code inconnu ou inaccessible' });
    mount('/q/lot/abc');
    expect(await screen.findByText('QR code inconnu ou inaccessible')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour au tableau de bord' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Page du lot')).toBeNull();
  });

  it('asks the API again with the same card for any failure of the lookup', async () => {
    qr = () => json(500, { message: 'Erreur interne' });
    mount('/q/lot/abc');
    await waitFor(() => expect(screen.getByText('QR code inconnu ou inaccessible')).toBeInTheDocument());
  });
});
