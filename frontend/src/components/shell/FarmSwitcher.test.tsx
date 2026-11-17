import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { FarmSwitcher } from './FarmSwitcher';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const USER = { id: 'u1', name: 'Awa Koffi', email: 'awa@x.tg', role: 'MAGASINIER', twoFactorEnabled: true };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/auth/refresh') return json({ accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json({ user: USER, farms: [{ id: 'f1', name: 'Ferme Nord' }], canSeeAllFarms: false, permissions: {} });
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('the user card menu', () => {
  it('links to the QR scanner, whatever the role grants', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AuthProvider><FarmSwitcher /></AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: /Awa Koffi/ }));
    expect(screen.getByRole('menuitem', { name: 'Scanner un QR code' })).toHaveAttribute('href', '/scan');
    expect(screen.getByRole('menuitem', { name: 'Mon compte' })).toHaveAttribute('href', '/compte');
  });
});
