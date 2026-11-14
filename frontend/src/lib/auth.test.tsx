import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { farmKey, useFarmQuery } from './query';
import { AuthProvider, useAuth } from './auth';
import { setAccessToken, setFarmHeader } from './api';
import { FarmSwitcher } from '../components/shell/FarmSwitcher';
import { RequirePermission } from '../components/shell/guards';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ME = {
  user: { id: 'u1', name: 'Awa Mensah', email: 'awa@x.tg', role: 'PROPRIETAIRE', twoFactorEnabled: true },
  farms: [{ id: 'f1', name: 'Ferme Kpalimé' }, { id: 'f2', name: 'Ferme Atakpamé' }],
  permissions: { dashboard: ['read'], finance: [] },
  canSeeAllFarms: true,
};

const fetchMock = vi.fn<typeof fetch>();

function Probe() {
  const { farmId } = useAuth();
  return <p data-testid="farm">{farmId}</p>;
}

function renderApp(ui: React.ReactNode, client = new QueryClient()) {
  fetchMock.mockImplementation(async (input) => {
    if (input === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: ME.user });
    if (input === '/api/auth/me') return json(200, ME);
    throw new Error(`unexpected ${String(input)}`);
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('AuthProvider', () => {
  it('restores the session on load and falls back to the first farm when the stored one is unknown', async () => {
    localStorage.setItem('ap_farm', 'gone');
    renderApp(<Probe />);
    expect(await screen.findByText('f1')).toBeInTheDocument();
  });

  it('keeps a remembered farm and the "all" choice for users who can see all farms', async () => {
    localStorage.setItem('ap_farm', 'all');
    renderApp(<Probe />);
    expect(await screen.findByText('all')).toBeInTheDocument();
  });

  it('switches farm from the menu and remembers it', async () => {
    renderApp(<><Probe /><FarmSwitcher /></>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Awa Mensah/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Ferme Atakpamé' }));
    expect(screen.getByTestId('farm')).toHaveTextContent('f2');
    expect(localStorage.getItem('ap_farm')).toBe('f2');
  });

  it('empties the cache of the previous farm on switch and keys farm queries by farm id', async () => {
    const client = new QueryClient();
    function Lots() {
      const q = useFarmQuery(['lots'], async () => 'lots-data');
      return <p>{q.data ?? 'vide'}</p>;
    }
    renderApp(<><Probe /><FarmSwitcher /><Lots /></>, client);
    const user = userEvent.setup();
    expect(await screen.findByText('lots-data')).toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: farmKey('f1', 'lots') })).toBeDefined();
    client.setQueryData(farmKey('f1', 'other'), 'stale');

    await user.click(screen.getByRole('button', { name: /Awa Mensah/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Ferme Atakpamé' }));
    await screen.findByText('f2');
    await vi.waitFor(() =>
      expect(client.getQueryCache().getAll().map((q) => q.queryKey[1])).not.toContain('f1'),
    );
    expect(client.getQueryCache().find({ queryKey: farmKey('f2', 'lots') })).toBeDefined();
  });

  it('shows the 403 card when read permission is missing', async () => {
    renderApp(
      <RequirePermission module="finance">
        <p>secret</p>
      </RequirePermission>,
    );
    expect(await screen.findByText('Accès non autorisé')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
});
