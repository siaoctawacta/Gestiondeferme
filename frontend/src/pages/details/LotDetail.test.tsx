import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../lib/auth';
import { setAccessToken, setFarmHeader } from '../../lib/api';
import { LotDetail } from './LotDetail';

// The chart chunk stays "loading" until the test releases it.
const chunk = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
});
vi.mock('./WeightCurve', async () => {
  await chunk.gate;
  return { default: () => <div role="img" aria-label="Courbe de poids moyen" /> };
});

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const LOT = {
  id: 'l1', code: 'LC-2026-14', type: 'CHAIR', species: 'AVICOLE', breedId: null, breedName: null, buildingId: 'b1', buildingName: 'Poulailler A',
  entryDate: '2026-09-20', initialCount: 5000, deaths: 0, alive: 5000, mortalityRate: 0, averageWeightG: 1450, status: 'EN_COURS', ageDays: 55,
  supplierName: null, purchasePrice: null, responsibleId: null, responsibleName: null, closedAt: null, notes: null,
  performance: { ageDays: 55, alive: 5000, deaths: 0, mortalityRate: 0, firstWeightG: 42, lastWeightG: 1450, dailyGainG: 55, feedKg: null, feedConversion: null, feedCost: null },
};
const page = (items: unknown[]) => json(200, { items, total: items.length, page: 1, pageSize: 25 });
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: { lots: ['read', 'create', 'update', 'delete'] } });
    }
    if (/^\/api\/batches\/l1(\?|$)/.test(url)) return json(200, LOT);
    if (/^\/api\/batches\/l1\/events/.test(url)) return page([]);
    if (/^\/api\/batches\/l1\/weighings/.test(url)) {
      return page([
        { id: 'w1', date: '2026-10-01', sampleSize: 30, averageWeightG: 600, note: null },
        { id: 'w2', date: '2026-10-08', sampleSize: 30, averageWeightG: 1000, note: null },
      ]);
    }
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('lot detail: the weight curve chunk', () => {
  it('shows a skeleton while the chart loads and keeps the rest of the page interactive, then the chart', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <LotDetail id="l1" />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Pesées' }));
    // The chunk is pending: only the curve's own slot shows a skeleton; the page around it is still there.
    expect(await screen.findByTestId('weight-curve-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'LC-2026-14' })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: 'POIDS MOYEN (G)' })).toBeInTheDocument();
    expect(screen.getByText('1 000')).toBeInTheDocument();
    // Still interactive: switching tab works while the chart is loading.
    await user.click(screen.getByRole('tab', { name: 'Mouvements' }));
    expect(screen.getByRole('tab', { name: 'Mouvements' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Pesées' }));
    expect(screen.getByTestId('weight-curve-skeleton')).toBeInTheDocument();

    chunk.release();
    expect(await screen.findByRole('img', { name: 'Courbe de poids moyen' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('weight-curve-skeleton')).not.toBeInTheDocument());
  });
});
