import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import Settings from './Settings';
import Users from './Users';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'SUPER_ADMIN', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];
interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();

function mount(page: ReactElement, routes: (c: Call) => Response | undefined) {
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, {
        user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true,
        permissions: { utilisateurs: ALL, parametres: ALL },
      });
    }
    const res = routes(call);
    if (res) return res;
    throw new Error(`unexpected ${call.method} ${call.url}`);
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
  calls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

const USERS = {
  items: [
    { id: 'u2', name: 'Koffi Mensah', email: 'koffi@x.tg', role: 'RESP_AVICOLE', active: true, farms: [{ id: 'f1', name: 'Ferme A' }, { id: 'f2', name: 'Ferme B' }], twoFactorEnabled: false, lastLoginAt: null },
  ],
  total: 1, page: 1, pageSize: 25,
};

describe('Users page', () => {
  it('shows French role labels, farm names and 2FA / status pills', async () => {
    mount(<Users />, (c) => (c.url.startsWith('/api/users') ? json(200, USERS) : undefined));
    expect(await screen.findByText('Koffi Mensah')).toBeInTheDocument();
    expect(screen.getByText('Responsable avicole')).toBeInTheDocument();
    expect(screen.getByText('Ferme A, Ferme B')).toBeInTheDocument();
    expect(screen.getByText('Non activée')).toBeInTheDocument();
    expect(screen.getByText('Actif')).toBeInTheDocument();
  });

  it('shows the reset link with its expiry in a dialog', async () => {
    mount(<Users />, (c) => {
      if (c.method === 'POST' && c.url === '/api/users/u2/reset-link') return json(201, { url: 'https://app.test/reset/abc', expiresAt: '2026-11-15T10:00:00.000Z' });
      return c.url.startsWith('/api/users') ? json(200, USERS) : undefined;
    });
    await screen.findByText('Koffi Mensah');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lien de réinitialisation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lien de réinitialisation' });
    const input = await within(dialog).findByDisplayValue('https://app.test/reset/abc');
    expect(input).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('button', { name: 'Copier' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Valable jusqu’au');
  });

  it('creates a user with a password and selected farms, and omits them on edit', async () => {
    mount(<Users />, (c) => {
      if (c.url.startsWith('/api/farms')) return json(200, { items: [{ id: 'f1', name: 'Ferme A' }], total: 1, page: 1, pageSize: 200 });
      if (c.method === 'POST' && c.url === '/api/users') return json(201, {});
      if (c.method === 'PATCH') return json(200, {});
      return c.url.startsWith('/api/users') ? json(200, USERS) : undefined;
    });
    await screen.findByText('Koffi Mensah');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Utilisateurs' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Ama');
    await user.type(within(dialog).getByLabelText('E-mail'), 'ama@x.tg');
    await user.selectOptions(within(dialog).getByLabelText('Rôle'), 'Comptable');
    await user.click(await within(dialog).findByLabelText('Ferme A'));
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'court');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/au moins 10 caractères/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Mot de passe'));
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'un-long-secret');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/users')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/users')?.body).toEqual({
      name: 'Ama', email: 'ama@x.tg', role: 'COMPTABLE', farmIds: ['f1'], password: 'un-long-secret',
    });

    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    const edit = await screen.findByRole('dialog', { name: 'Modifier — Utilisateurs' });
    expect(within(edit).queryByLabelText('Mot de passe')).not.toBeInTheDocument();
    expect(within(edit).queryByLabelText('E-mail')).not.toBeInTheDocument();
    // Saving without a change sends nothing and closes.
    await user.click(within(edit).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    const again = await screen.findByRole('dialog', { name: 'Modifier — Utilisateurs' });
    await user.clear(within(again).getByLabelText('Nom'));
    await user.type(within(again).getByLabelText('Nom'), 'Koffi M.');
    await user.click(within(again).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Koffi M.' });
  });
});

describe('Users page, farm assignment', () => {
  const fill = async (role: string) => {
    mount(<Users />, (c) => {
      if (c.url.startsWith('/api/farms')) return json(200, { items: [{ id: 'f1', name: 'Ferme A' }], total: 1, page: 1, pageSize: 200 });
      if (c.method === 'POST' && c.url === '/api/users') return json(201, {});
      return c.url.startsWith('/api/users') ? json(200, USERS) : undefined;
    });
    await screen.findByText('Koffi Mensah');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Utilisateurs' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Ama');
    await user.type(within(dialog).getByLabelText('E-mail'), 'ama@x.tg');
    await user.selectOptions(within(dialog).getByLabelText('Rôle'), role);
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'un-long-secret');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    return dialog;
  };

  it('requires at least one farm for a farm-bound role', async () => {
    const dialog = await fill('Comptable');
    expect(await within(dialog).findByText(/sélectionnez au moins une ferme/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/users')).toBe(false);
  });

  it.each(['Super Administrateur', 'Propriétaire / Direction', 'Auditeur'])('lets %s be created without a farm', async (role) => {
    await fill(role);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/users')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/users')?.body).toMatchObject({ farmIds: [] });
  });
});

describe('Settings page', () => {
  const SETTINGS = {
    currency: 'FCFA', mortalityDailyPct: 0.5, mortalityCumulPct: 3, consumptionDeviationPct: 25,
    expiryWarningDays: 30, farrowingWarningDays: 7, vaccinationWarningDays: 3, biosecurityWarningDays: 0, gestationDays: 114,
    legal: { name: 'AgriPilot SARL', address: 'Lomé', nif: '123', rccm: 'TG-LOM' },
  };

  it('saves a group and confirms inline, then shows server errors', async () => {
    let fail = false;
    mount(<Settings />, (c) => {
      if (c.method === 'GET' && c.url === '/api/settings') return json(200, SETTINGS);
      if (c.method === 'PUT') return fail ? json(400, { message: 'La durée de gestation doit être un nombre supérieur à 0' }) : json(200, {});
      return undefined;
    });
    expect(await screen.findByRole('heading', { name: 'Reproduction' })).toBeInTheDocument();
    for (const t of ["Seuils d'alerte", 'Mentions légales', 'Devise']) expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();

    const user = userEvent.setup();
    const card = screen.getByRole('heading', { name: 'Reproduction' }).closest('form')!;
    const days = within(card).getByLabelText('Durée de gestation (jours)');
    await user.clear(days);
    await user.type(days, '115');
    await user.click(within(card).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(card).findByText('Paramètres enregistrés')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PUT').map((c) => [c.url, c.body])).toEqual([
      ['/api/settings/farrowingWarningDays', { value: 7 }],
      ['/api/settings/gestationDays', { value: 115 }],
    ]);

    fail = true;
    await user.click(within(card).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(card).findByText('La durée de gestation doit être un nombre supérieur à 0')).toBeInTheDocument();
  });

  it('offers the vaccination and biosecurity thresholds in the alert card and saves them', async () => {
    mount(<Settings />, (c) => {
      if (c.method === 'GET' && c.url === '/api/settings') return json(200, SETTINGS);
      if (c.method === 'PUT') return json(200, {});
      return undefined;
    });
    const card = (await screen.findByRole('heading', { name: "Seuils d'alerte" })).closest('form')!;
    expect(within(card).getByLabelText('Alerte vaccination (jours avant)')).toHaveValue(3);
    const delay = within(card).getByLabelText('Alerte biosécurité (jours de retard tolérés)');
    expect(delay).toHaveValue(0);
    const user = userEvent.setup();
    await user.clear(delay);
    await user.type(delay, '2');
    await user.click(within(card).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => [c.url, c.body]);
    expect(puts).toContainEqual(['/api/settings/vaccinationWarningDays', { value: 3 }]);
    expect(puts).toContainEqual(['/api/settings/biosecurityWarningDays', { value: 2 }]);
  });

  it('does not send a cleared number field as 0', async () => {
    mount(<Settings />, (c) => {
      if (c.method === 'GET' && c.url === '/api/settings') return json(200, SETTINGS);
      if (c.method === 'PUT') return json(200, {});
      return undefined;
    });
    const card = (await screen.findByRole('heading', { name: 'Reproduction' })).closest('form')!;
    const user = userEvent.setup();
    await user.clear(within(card).getByLabelText('Durée de gestation (jours)'));
    await user.click(within(card).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(card).findByText(/Durée de gestation \(jours\) » est requis/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('sends the legal fields as one object', async () => {
    mount(<Settings />, (c) => {
      if (c.method === 'GET' && c.url === '/api/settings') return json(200, SETTINGS);
      if (c.method === 'PUT') return json(200, {});
      return undefined;
    });
    const card = (await screen.findByRole('heading', { name: 'Mentions légales' })).closest('form')!;
    const user = userEvent.setup();
    await user.clear(within(card).getByLabelText('NIF'));
    await user.type(within(card).getByLabelText('NIF'), '999');
    await user.click(within(card).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/settings/legal',
      body: { value: { name: 'AgriPilot SARL', address: 'Lomé', nif: '999', rccm: 'TG-LOM' } },
    });
  });
});
