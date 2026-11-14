import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from '../../App';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { AuthProvider } from '../../lib/auth';
import { RequireAuth } from './guards';

const json = (status: number, body?: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'RESP_AVICOLE', twoFactorEnabled: false };
const fetchMock = vi.fn<typeof fetch>();

function mount(path: string, canSeeAllFarms: boolean) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') {
      return json(200, { user: USER, farms: [], canSeeAllFarms, permissions: { dashboard: ['read'], alertes: ['read'] } });
    }
    return json(200, { total: 0, items: [] });
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <RequireAuth>
            <Shell><p>page</p></Shell>
          </RequireAuth>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('Shell without a farm', () => {
  it('says no farm is assigned instead of rendering the page', async () => {
    mount('/', false);
    expect(await screen.findByText('Aucune ferme ne vous est attribuée. Contactez un administrateur.')).toBeInTheDocument();
    expect(screen.queryByText('page')).not.toBeInTheDocument();
    expect(document.title).toBe('Aucune ferme — AgriPilot');
  });

  it('still renders the account page', async () => {
    mount('/compte', false);
    expect(await screen.findByText('page')).toBeInTheDocument();
  });

  it('renders the page for a user who can see all farms', async () => {
    mount('/', true);
    expect(await screen.findByText('page')).toBeInTheDocument();
  });
});
