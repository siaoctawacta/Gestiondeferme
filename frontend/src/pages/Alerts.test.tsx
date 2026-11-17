import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import Alerts from './Alerts';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const A1 = { key: 'stock:1', title: 'Stock faible : Aliment ponte', detail: '900 kg (seuil 1500)', level: 'A_VOIR', module: 'stocks' };
const A2 = { key: 'task:9', title: 'Tâche en retard : Pesée', detail: 'Échue le 2026-11-10', level: 'URGENT', module: 'taches' };

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();
/** The API's state: the keys this user has masked. */
let masked: Set<string>;

function alertsAnswer(url: string) {
  const include = url.includes('acknowledged=include');
  const all = [A1, A2].map((a) => ({ ...a, acknowledged: masked.has(a.key) }));
  const visible = all.filter((a) => !a.acknowledged);
  return {
    total: visible.length,
    acknowledgedCount: all.length - visible.length,
    items: include ? all : visible,
  };
}

function mount() {
  masked = new Set();
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: false, permissions: { alertes: ['read'] } });
    }
    if (call.method === 'GET' && call.url.startsWith('/api/alerts')) return json(200, alertsAnswer(call.url));
    if (call.method === 'POST' && call.url === '/api/alerts/ack') {
      masked.add((call.body as { key: string }).key);
      return json(201, { ok: true });
    }
    if (call.method === 'POST' && call.url === '/api/alerts/unack') {
      masked.delete((call.body as { key: string }).key);
      return json(201, { ok: true });
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider><Alerts /></AuthProvider>
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
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

const card = (title: string) => within(screen.getByText(title).closest('li')!);

describe('the alerts page', () => {
  it('masks an alert through the API and shows what the API then says is visible', async () => {
    mount();
    expect(await screen.findByText('Stock faible : Aliment ponte')).toBeInTheDocument();
    expect(screen.getByText('2 alertes ouvertes, calculées automatiquement à partir de vos données.')).toBeInTheDocument();
    expect(screen.queryByText(/Afficher les alertes masquées/)).toBeNull();

    await userEvent.setup().click(card('Stock faible : Aliment ponte').getByRole('button', { name: "Masquer l'alerte : Stock faible : Aliment ponte" }));
    await waitFor(() => expect(screen.queryByText('Stock faible : Aliment ponte')).toBeNull());
    expect(calls.find((c) => c.url === '/api/alerts/ack')!.body).toEqual({ key: 'stock:1' });
    // The subtitle counts what the API counts as open.
    expect(screen.getByText('1 alerte ouverte, calculées automatiquement à partir de vos données.')).toBeInTheDocument();
    expect(screen.getByText('Tâche en retard : Pesée')).toBeInTheDocument();
  });

  it('shows the masked alerts on demand, dimmed, with Réafficher', async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByText('Stock faible : Aliment ponte');
    await user.click(card('Stock faible : Aliment ponte').getByRole('button', { name: "Masquer l'alerte : Stock faible : Aliment ponte" }));
    await user.click(await screen.findByRole('link', { name: 'Afficher les alertes masquées (1)' }));

    const masked1 = await screen.findByText('Stock faible : Aliment ponte');
    expect(calls.some((c) => c.method === 'GET' && c.url.includes('acknowledged=include'))).toBe(true);
    expect(masked1.closest('li')!.className).toContain('opacity-60');
    expect(card('Stock faible : Aliment ponte').queryByRole('button', { name: "Masquer l'alerte : Stock faible : Aliment ponte" })).toBeNull();
    // The subtitle still counts the open ones only.
    expect(screen.getByText('1 alerte ouverte, calculées automatiquement à partir de vos données.')).toBeInTheDocument();

    await user.click(card('Stock faible : Aliment ponte').getByRole('button', { name: "Réafficher l'alerte : Stock faible : Aliment ponte" }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/alerts/unack')!.body).toEqual({ key: 'stock:1' }));
    await waitFor(() => expect(card('Stock faible : Aliment ponte').getByRole('button', { name: "Masquer l'alerte : Stock faible : Aliment ponte" })).toBeInTheDocument());
    expect(screen.queryByText(/Afficher les alertes masquées/)).toBeNull();
  });

  it('hides the masked alerts again', async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByText('Stock faible : Aliment ponte');
    await user.click(card('Stock faible : Aliment ponte').getByRole('button', { name: "Masquer l'alerte : Stock faible : Aliment ponte" }));
    await user.click(await screen.findByRole('link', { name: 'Afficher les alertes masquées (1)' }));
    await user.click(await screen.findByRole('link', { name: 'Ne plus afficher les alertes masquées' }));
    await waitFor(() => expect(screen.queryByText('Stock faible : Aliment ponte')).toBeNull());
  });

  it('moves the focus to the next card\'s button after masking, and to the page heading when none is left', async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByText('Stock faible : Aliment ponte');
    await user.click(card('Stock faible : Aliment ponte').getByRole('button', { name: "Masquer l'alerte : Stock faible : Aliment ponte" }));
    await waitFor(() => expect(screen.queryByText('Stock faible : Aliment ponte')).toBeNull());
    await waitFor(() => expect(card('Tâche en retard : Pesée').getByRole('button', { name: "Masquer l'alerte : Tâche en retard : Pesée" })).toHaveFocus());
    await user.click(card('Tâche en retard : Pesée').getByRole('button', { name: "Masquer l'alerte : Tâche en retard : Pesée" }));
    await waitFor(() => expect(screen.queryByText('Tâche en retard : Pesée')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Alertes & notifications' })).toHaveFocus());
  });
});
