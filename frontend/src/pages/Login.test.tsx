import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken } from '../lib/api';
import Login from './Login';

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

function mockRoutes(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input) => {
    const handler = routes[String(input).replace('/api', '')];
    if (!handler) throw new Error(`unexpected fetch ${String(input)}`);
    return handler();
  });
}

const ME = {
  user: { id: 'u1', name: 'Awa Mensah', email: 'awa@x.tg', role: 'COMMERCIAL', twoFactorEnabled: false },
  farms: [{ id: 'f1', name: 'Ferme Kpalimé' }],
  permissions: { dashboard: ['read'] },
  canSeeAllFarms: false,
};

async function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Connexion' });
}

async function submitCredentials() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Adresse e-mail'), 'awa@x.tg');
  await user.type(screen.getByLabelText('Mot de passe'), 'mauvais-mot-de-passe');
  await user.click(screen.getByRole('button', { name: 'Se connecter' }));
  return user;
}

const calledMe = () => fetchMock.mock.calls.some(([u]) => u === '/api/auth/me');

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Login', () => {
  it('shows an error for wrong credentials', async () => {
    mockRoutes({
      '/auth/refresh': () => json(401, { message: 'Unauthorized' }),
      '/auth/login': () => json(401, { message: 'Identifiants invalides' }),
    });
    await renderLogin();
    await submitCredentials();
    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides');
  });

  it('asks for the verification code when 2FA is required', async () => {
    mockRoutes({
      '/auth/refresh': () => json(401, { message: 'Unauthorized' }),
      '/auth/login': () => json(200, { twoFactorRequired: true, challengeToken: 'chal' }),
    });
    await renderLogin();
    await submitCredentials();
    expect(await screen.findByLabelText('Code de vérification')).toBeInTheDocument();
    expect(screen.getByText(/code de secours/i)).toBeInTheDocument();
  });

  it('sends the challenge token and signs in after a valid code', async () => {
    mockRoutes({
      '/auth/refresh': () => json(401, { message: 'Unauthorized' }),
      '/auth/login': () => json(200, { twoFactorRequired: true, challengeToken: 'chal' }),
      '/auth/2fa/verify': () => json(200, { accessToken: 'acc', user: ME.user }),
      '/auth/me': () => json(200, ME),
    });
    await renderLogin();
    const user = await submitCredentials();
    await user.type(await screen.findByLabelText('Code de vérification'), '123456');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    await vi.waitFor(() => expect(calledMe()).toBe(true));
    const verify = fetchMock.mock.calls.find(([u]) => u === '/api/auth/2fa/verify')!;
    expect(new Headers((verify[1] as RequestInit).headers).get('Authorization')).toBe('Bearer chal');
  });

  it('shows the QR code, then the backup codes, when 2FA setup is required', async () => {
    mockRoutes({
      '/auth/refresh': () => json(401, { message: 'Unauthorized' }),
      '/auth/login': () => json(200, { twoFactorSetupRequired: true, setupToken: 'setup' }),
      '/auth/2fa/setup': () =>
        json(200, { otpauthUrl: 'otpauth://x', qrDataUrl: 'data:image/png;base64,AAAA', secret: 'JBSWY3DP' }),
      '/auth/2fa/enable': () =>
        json(200, {
          backupCodes: ['aaaa-1111', 'bbbb-2222', 'cccc-3333', 'dddd-4444', 'eeee-5555', 'ffff-6666', 'gggg-7777', 'hhhh-8888'],
          accessToken: 'acc',
          user: ME.user,
        }),
      '/auth/me': () => json(200, ME),
    });
    await renderLogin();
    const user = await submitCredentials();
    expect(await screen.findByAltText('QR code de double authentification')).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code de vérification'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByText('aaaa-1111')).toBeInTheDocument();
    expect(screen.getByText('hhhh-8888')).toBeInTheDocument();
    // not signed in until the codes are acknowledged
    expect(calledMe()).toBe(false);
    await user.click(screen.getByRole('button', { name: "J'ai enregistré mes codes" }));
    await vi.waitFor(() => expect(calledMe()).toBe(true));
  });

  it('returns to the credentials with an error when the session cannot be loaded after verify', async () => {
    mockRoutes({
      '/auth/refresh': () => json(401, { message: 'Unauthorized' }),
      '/auth/login': () => json(200, { twoFactorRequired: true, challengeToken: 'chal' }),
      '/auth/2fa/verify': () => json(200, { accessToken: 'acc', user: ME.user }),
      '/auth/me': () => json(500, { message: 'boom' }),
    });
    await renderLogin();
    const user = await submitCredentials();
    await user.type(await screen.findByLabelText('Code de vérification'), '123456');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('la session n\'a pas pu être chargée');
  });

  it('shows the lock message with the unlock time in French', async () => {
    mockRoutes({
      '/auth/refresh': () => json(401, { message: 'Unauthorized' }),
      '/auth/login': () =>
        json(423, {
          message: 'Compte verrouillé après trop de tentatives. Réessayez plus tard.',
          lockedUntil: '2026-11-14T15:42:00.000Z',
        }),
    });
    await renderLogin();
    await submitCredentials();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Compte verrouillé');
    expect(alert).toHaveTextContent('novembre 2026');
    expect(alert).toHaveTextContent(/à partir du/);
  });
});
