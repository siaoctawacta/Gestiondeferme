import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import type { QrTarget } from '../../lib/qr';
import { lots } from '../../modules/lots';
import { porcs } from '../../modules/porcs';
import type { Batch } from '../../modules/lotsShared';
import { ModulePage } from './ModulePage';
import type { ModuleConfig } from './types';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete'];

const batch = (id: string, code: string): Batch => ({
  id, code, type: 'CHAIR', breedId: 'br1', breedName: 'Cobb 500', buildingId: 'b1', buildingName: 'Poulailler A',
  entryDate: '2026-09-20', initialCount: 5000, deaths: 180, alive: 4820, mortalityRate: 3.6, averageWeightG: 1450, status: 'EN_COURS', ageDays: 55,
});
const LOTS = [batch('l1', 'LC-2026-14'), batch('l2', 'LC-2026-15'), batch('l3', 'LC-2026-16')];

const MOCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" id="mock-qr" viewBox="0 0 2 2"><path d="M0 0h1v1H0z"/></svg>';
const target = (id: string, label: string, kind: QrTarget['kind'] = 'lot'): QrTarget => ({
  kind, id, farmId: 'f1', farmName: 'Ferme Kpalimé', path: `/m/lots/${id}`, url: `http://localhost:5173/q/${kind}/${id}`,
  label, sublabel: 'Poulets de chair — Poulailler A', svg: MOCK_SVG,
});

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();
let handler: (c: Call) => Response | undefined;

function mount(config: ModuleConfig<never>, items: unknown[], perms: Record<string, string[]>) {
  handler = () => undefined;
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    const custom = handler(call);
    if (custom) return custom;
    if (call.method === 'GET' && /^\/api\/(batches|pig-herd)\?/.test(call.url)) return json(200, { items, total: items.length, page: 1, pageSize: 25 });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider><ModulePage config={config as ModuleConfig<{ id: string }>} /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const print = vi.fn();
beforeEach(() => {
  calls.length = 0;
  fetchMock.mockReset();
  print.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('print', print);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

const rowOf = (text: string) => within(screen.getByText(text).closest('tr')!);

describe('the QR code of a row', () => {
  it('opens a dialog with the label, the farm, the address and the picture the API drew', async () => {
    mount(lots as never, LOTS, { lots: ALL });
    handler = (c) => (c.url === '/api/qr/lot/l1' ? json(200, target('l1', 'LC-2026-14')) : undefined);
    await screen.findByText('LC-2026-14');
    const row = rowOf('LC-2026-14');
    await userEvent.setup().click(row.getByRole('button', { name: 'QR code' }));

    const dialog = await screen.findByRole('dialog', { name: 'QR code — LC-2026-14' });
    const img = await within(dialog).findByRole('img', { name: 'QR code LC-2026-14' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(img.getAttribute('src')!)).toContain('id="mock-qr"');
    // The SVG is a picture, never markup of the page.
    expect(document.getElementById('mock-qr')).toBeNull();
    expect(within(dialog).getByText('Poulets de chair — Poulailler A')).toBeInTheDocument();
    expect(within(dialog).getByText('Ferme Kpalimé')).toBeInTheDocument();
    expect(within(dialog).getByText('http://localhost:5173/q/lot/l1')).toBeInTheDocument();
    // The row's icon no longer links to the record: it opens the dialog.
    expect(row.getByRole('button', { name: 'QR code' })).toBeInTheDocument();
    expect(row.queryByRole('link', { name: 'QR code' })).toBeNull();
  });

  it('prints the label and closes', async () => {
    mount(lots as never, LOTS, { lots: ALL });
    handler = (c) => (c.url === '/api/qr/lot/l1' ? json(200, target('l1', 'LC-2026-14')) : undefined);
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(rowOf('LC-2026-14').getByRole('button', { name: 'QR code' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: 'QR code LC-2026-14' });
    await user.click(within(dialog).getByRole('button', { name: "Imprimer l'étiquette" }));
    expect(print).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getAllByRole('button', { name: 'Fermer' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the API refusal in the dialog', async () => {
    mount(lots as never, LOTS, { lots: ALL });
    handler = (c) => (c.url === '/api/qr/lot/l1' ? json(404, { message: 'QR code inconnu ou inaccessible' }) : undefined);
    await screen.findByText('LC-2026-14');
    await userEvent.setup().click(rowOf('LC-2026-14').getByRole('button', { name: 'QR code' }));
    expect(await screen.findByText('QR code inconnu ou inaccessible')).toBeInTheDocument();
  });

  it('is chosen per row by a function: a pig lot and an animal have different kinds', async () => {
    const herd = [
      { id: 'p1', kind: 'LOT', identifier: 'LOT-ENG-01', category: 'ENGRAISSEMENT', breedName: null, buildingName: 'P1', birthDate: null, entryDate: null, weightKg: null, status: 'EN_COURS' },
      { id: 'a1', kind: 'ANIMAL', identifier: 'TR-027', category: 'TRUIE', breedName: null, buildingName: 'P1', birthDate: null, entryDate: null, weightKg: null, status: 'ACTIF' },
    ];
    mount(porcs as never, herd, { porcs: ALL });
    await screen.findByText('TR-027');
    expect(typeof porcs.qr).toBe('function');
    expect(porcs.qr).toBeDefined();
    handler = (c) => (c.url === '/api/qr/animal/a1' ? json(200, target('a1', 'TR-027', 'animal')) : undefined);
    await userEvent.setup().click(rowOf('TR-027').getByRole('button', { name: 'QR code' }));
    expect(await screen.findByRole('dialog', { name: 'QR code — TR-027' })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/qr/animal/a1')).toBe(true);
  });
});

describe('the label sheet', () => {
  it('posts the ids of the visible page and shows one label per answer, then prints', async () => {
    mount(lots as never, LOTS, { lots: ALL });
    handler = (c) =>
      c.method === 'POST' && c.url === '/api/qr/labels'
        ? json(200, { labels: LOTS.map((l) => target(l.id, l.code)) })
        : undefined;
    await screen.findByText('LC-2026-14');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Exporter' }));
    await user.click(screen.getByRole('menuitem', { name: 'Étiquettes QR' }));

    const dialog = await screen.findByRole('dialog', { name: 'Étiquettes QR — Lots avicoles' });
    await waitFor(() => expect(within(dialog).getAllByRole('img')).toHaveLength(3));
    expect(calls.find((c) => c.url === '/api/qr/labels')!.body).toEqual({ kind: 'lot', ids: ['l1', 'l2', 'l3'] });
    for (const code of ['LC-2026-14', 'LC-2026-15', 'LC-2026-16']) expect(within(dialog).getByText(code)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Imprimer' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('is not offered without a QR on the config', async () => {
    mount({ ...lots, qr: undefined } as never, LOTS, { lots: ALL });
    await screen.findByText('LC-2026-14');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Exporter' }));
    expect(screen.queryByRole('menuitem', { name: 'Étiquettes QR' })).toBeNull();
  });

  it('asks once per kind for a list that mixes kinds, and keeps the rows order', async () => {
    const herd = [
      { id: 'a1', kind: 'ANIMAL', identifier: 'TR-027', category: 'TRUIE', breedName: null, buildingName: 'P1', birthDate: null, entryDate: null, weightKg: null, status: 'ACTIF' },
      { id: 'p1', kind: 'LOT', identifier: 'LOT-ENG-01', category: 'ENGRAISSEMENT', breedName: null, buildingName: 'P1', birthDate: null, entryDate: null, weightKg: null, status: 'EN_COURS' },
    ];
    mount(porcs as never, herd, { porcs: ALL });
    handler = (c) => {
      if (c.method !== 'POST' || c.url !== '/api/qr/labels') return undefined;
      const body = c.body as { kind: string };
      return json(200, { labels: body.kind === 'lot' ? [target('p1', 'LOT-ENG-01')] : [target('a1', 'TR-027', 'animal')] });
    };
    await screen.findByText('TR-027');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Exporter' }));
    await user.click(screen.getByRole('menuitem', { name: 'Étiquettes QR' }));
    const dialog = await screen.findByRole('dialog', { name: /Étiquettes QR/ });
    await waitFor(() => expect(within(dialog).getAllByRole('img')).toHaveLength(2));
    const posts = calls.filter((c) => c.url === '/api/qr/labels').map((c) => c.body);
    expect(posts).toEqual(expect.arrayContaining([{ kind: 'animal', ids: ['a1'] }, { kind: 'lot', ids: ['p1'] }]));
    const codes = within(dialog).getAllByText(/^(TR-027|LOT-ENG-01)$/).map((e) => e.textContent);
    expect(codes).toEqual(['TR-027', 'LOT-ENG-01']);
  });
});
