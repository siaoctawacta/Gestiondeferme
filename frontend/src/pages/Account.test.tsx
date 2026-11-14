import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { safeRedirect } from '../components/shell/guards';
import Account from './Account';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa Mensah', email: 'awa@x.tg', role: 'COMMERCIAL', twoFactorEnabled: false };
const ME = { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], permissions: { dashboard: ['read'] }, canSeeAllFarms: false };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('Account 2FA enrolment', () => {
  it('still shows the one-time backup codes when /auth/me fails after enabling', async () => {
    let meCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      switch (String(input)) {
        case '/api/auth/refresh': return json(200, { accessToken: 'acc', user: USER });
        case '/api/auth/me': return ++meCalls === 1 ? json(200, ME) : json(500, { message: 'boom' });
        case '/api/auth/2fa/setup': return json(200, { otpauthUrl: 'o', qrDataUrl: 'data:image/png;base64,AA', secret: 'SECRET' });
        case '/api/auth/2fa/enable': return json(200, { backupCodes: ['aaaa-1111', 'bbbb-2222'] });
        default: throw new Error(`unexpected ${String(input)}`);
      }
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AuthProvider>
            <Account />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Activer la double authentification' }));
    await user.type(await screen.findByLabelText('Code de vérification'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(meCalls).toBe(2);
  });
});

describe('safeRedirect', () => {
  it('only accepts in-app paths', () => {
    expect(safeRedirect('/m/lots?x=1')).toBe('/m/lots?x=1');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', undefined, 42, '']) {
      expect(safeRedirect(bad)).toBe('/');
    }
  });
});
