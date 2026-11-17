import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import Reports from './Reports';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'SUPER_ADMIN', twoFactorEnabled: true };
const fetchMock = vi.fn<typeof fetch>();
const urls: string[] = [];

const ROWS = [
  { key: 'poultry', label: 'Volailles vivantes', value: 11570, unit: '' },
  { key: 'pigs', label: 'Porcs (cheptel)', value: 245, unit: '' },
  { key: 'mortality', label: 'Taux de mortalité (lots en cours)', value: 3.6, unit: '%' },
  { key: 'eggs', label: 'Œufs produits (dernier jour)', value: 2480, unit: '' },
  { key: 'laying', label: 'Taux de ponte', value: 87, unit: '%' },
  { key: 'feed', label: 'Aliment distribué', value: 1800, unit: 'kg' },
  { key: 'water', label: 'Eau consommée', value: 4370, unit: 'L' },
];
const MONEY_ROWS = [
  { key: 'revenue', label: "Chiffre d'affaires", value: 3970000, unit: 'FCFA' },
  { key: 'expenses', label: 'Dépenses', value: 2835000, unit: 'FCFA' },
  { key: 'margin', label: 'Marge indicative', value: 1135000, unit: 'FCFA' },
  { key: 'receivables', label: 'Créances clients', value: 400000, unit: 'FCFA' },
];
const ALERTS_ROW = { key: 'alerts', label: 'Alertes ouvertes', value: 14, unit: '' };
const CARDS = [
  { activity: 'AVICOLE', revenue: 2050000, expenses: 1140000, margin: 910000 },
  { activity: 'PORCIN', revenue: 1920000, expenses: 560000, margin: 1360000 },
  { activity: 'GENERAL', revenue: 0, expenses: 1135000, margin: -1135000 },
];
const base = { generatedAt: '2026-11-14T15:42:00.000Z', farmName: 'Ferme Kpalimé', from: '2026-11-01', to: '2026-11-14' };
const SYNTHESE = {
  ...base, type: 'synthese', title: 'Synthèse au 14/11/2026',
  sections: [
    { key: 'indicateurs', title: 'Indicateurs', rows: [...ROWS, ...MONEY_ROWS, ALERTS_ROW] },
    { key: 'activites', title: 'Activités', cards: CARDS },
  ],
};
const SYNTHESE_NO_MONEY = {
  ...SYNTHESE, sections: [{ key: 'indicateurs', title: 'Indicateurs', rows: [...ROWS, ALERTS_ROW] }],
};
const MENSUEL = {
  ...base, type: 'mensuel', title: 'Rapport mensuel — octobre 2026', from: '2026-10-01', to: '2026-10-31',
  sections: [
    { key: 'avicole', title: 'Production avicole', rows: [{ key: 'collected', label: 'Œufs collectés', value: 12465, unit: '' }] },
    {
      key: 'finance', title: 'Finance',
      rows: [{ key: 'revenue', label: "Chiffre d'affaires", value: 3970000, unit: 'FCFA' }, { key: 'marginPct', label: 'Taux de marge', value: null, unit: '%' }],
      table: {
        columns: [{ key: 'category', header: 'CATÉGORIE' }, { key: 'type', header: 'TYPE' }, { key: 'amount', header: 'MONTANT', unit: 'FCFA' }],
        rows: [{ category: 'Ventes', type: 'Recette', amount: 3970000 }],
      },
    },
  ],
};
const ALL_TYPES = {
  types: ['synthese', 'quotidien', 'hebdomadaire', 'mensuel', 'annuel', 'sanitaire', 'zootechnique'].map((type) => ({
    type, label: type === 'synthese' ? 'Synthèse' : type[0].toUpperCase() + type.slice(1),
  })),
};
const LEGAL = { legal: { name: 'SARL Ferme Kpalimé', address: '', nif: '', rccm: '' }, invoiceDueDays: 30, eggsPerTray: 30 };

function mount(routes: (url: string) => Response | undefined, entry = '/rapports') {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') {
      return json(200, {
        user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true,
        permissions: { rapports: ['read'] },
      });
    }
    if (url === '/api/settings/documents') return json(200, LEGAL);
    const res = routes(url);
    if (res) return res;
    throw new Error(`unexpected ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <AuthProvider><Reports /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  urls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
  setFarmHeader(null);
});

const synthesisOnly = (report: unknown) => (u: string) =>
  u === '/api/reports' ? json(200, { types: [{ type: 'synthese', label: 'Synthèse' }] })
    : u === '/api/reports/synthese' ? json(200, report) : undefined;
const everything = (u: string) =>
  u === '/api/reports' ? json(200, ALL_TYPES)
    : u === '/api/reports/synthese' ? json(200, SYNTHESE)
      : u.startsWith('/api/reports/mensuel') ? json(200, MENSUEL) : undefined;

describe('Reports: synthèse', () => {
  it("renders the API's title and the 12 reference rows in order, then the three activity cards", async () => {
    mount(synthesisOnly(SYNTHESE));
    expect(await screen.findByText('Synthèse au 14/11/2026', { selector: '.print\\:hidden p' })).toBeInTheDocument();
    expect(screen.getByText('Synthèse au 14/11/2026', { selector: 'header p, header h2' })).toBeInTheDocument();
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(13);
    expect(rows.slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      'Volailles vivantes', 'Porcs (cheptel)', 'Taux de mortalité (lots en cours)', 'Œufs produits (dernier jour)', 'Taux de ponte',
      'Aliment distribué', 'Eau consommée', "Chiffre d'affaires", 'Dépenses', 'Marge indicative', 'Créances clients', 'Alertes ouvertes',
    ]);
    expect(within(rows[3]).getByText('3.6%')).toBeInTheDocument();
    expect(within(rows[6]).getByText('1 800 kg')).toBeInTheDocument();
    expect(within(rows[7]).getByText('4 370 L')).toBeInTheDocument();
    expect(within(rows[8]).getByText('3 970 000 FCFA')).toBeInTheDocument();
    expect(within(rows[12]).getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Activité Avicole')).toBeInTheDocument();
    expect(screen.getByText('910 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('−1 135 000 FCFA')).toBeInTheDocument();
    expect(screen.getByText('Recettes 2 050 000 FCFA · Dépenses 1 140 000 FCFA')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument(); // no title, no accessible name
    // On paper the page header is hidden: only the print header carries the title.
    expect(screen.getByRole('heading', { level: 1, name: 'Rapports' }).closest('.print\\:hidden')).not.toBeNull();
    expect(screen.getByText('Généré le', { exact: false }).closest('header')).toHaveClass('print:block');
  });

  it('renders no money row and no activity card when the API sends none', async () => {
    mount(synthesisOnly(SYNTHESE_NO_MONEY));
    expect(await screen.findAllByRole('row')).toHaveLength(9);
    for (const label of ["Chiffre d'affaires", 'Dépenses', 'Marge indicative', 'Créances clients']) expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Activité /)).not.toBeInTheDocument();
  });

  it('renders no tab bar when only the synthèse is listed', async () => {
    mount(synthesisOnly(SYNTHESE));
    await screen.findAllByRole('row');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows the access message of a 403', async () => {
    mount((u) => (u === '/api/reports' ? json(200, { types: [{ type: 'synthese', label: 'Synthèse' }] })
      : u === '/api/reports/synthese' ? json(403, { message: "Ce rapport n'est pas accessible à votre rôle" }) : undefined));
    expect(await screen.findByText("Ce rapport n'est pas accessible à votre rôle")).toBeInTheDocument();
  });
});

describe('Reports: files and print', () => {
  it('downloads the CSV and the Excel file of the same report with the API filename', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const file = (name: string) => Object.assign(
      new Response(null, { status: 200, headers: { 'content-disposition': `attachment; filename="${name}"` } }),
      { blob: async () => new Blob(['x']) },
    );
    mount((u) => synthesisOnly(SYNTHESE)(u)
      ?? (u === '/api/reports/synthese?format=csv' ? file('rapport-synthese-2026-11-01_2026-11-14.csv')
        : u === '/api/reports/synthese?format=xlsx' ? file('rapport-synthese-2026-11-01_2026-11-14.xlsx') : undefined));
    await screen.findAllByRole('row');
    await userEvent.click(screen.getByRole('button', { name: 'CSV' }));
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(urls).toContain('/api/reports/synthese?format=xlsx'));
    expect(urls).toContain('/api/reports/synthese?format=csv');
  });

  it('prints with window.print and carries a print header with the legal name, title and generation time', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    mount(synthesisOnly(SYNTHESE));
    await screen.findAllByRole('row');
    expect(await screen.findByText('SARL Ferme Kpalimé')).toBeInTheDocument();
    expect(screen.getByText(/^Généré le \d{2}\/\d{2}\/2026 à \d{2}:\d{2}$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Imprimer/ }));
    expect(print).toHaveBeenCalledOnce();
  });
});

describe('Reports: periodic types', () => {
  it('lists the types as tabs, requests the month chosen and renders titled sections and table headers', async () => {
    mount(everything);
    await screen.findAllByRole('row');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Synthèse', 'Quotidien', 'Hebdomadaire', 'Mensuel', 'Annuel', 'Sanitaire', 'Zootechnique',
    ]);
    await userEvent.click(screen.getByRole('tab', { name: 'Mensuel' }));
    fireEvent.change(await screen.findByLabelText('Mois'), { target: { value: '2026-10' } });
    expect(await screen.findByRole('heading', { name: 'Production avicole' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(urls).toContain('/api/reports/mensuel?date=2026-10-01');
    expect(screen.getAllByText('Rapport mensuel — octobre 2026')).toHaveLength(2);
    for (const h of ['CATÉGORIE', 'TYPE', 'MONTANT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('Recette')).toBeInTheDocument();
    expect(screen.getAllByText('3 970 000 FCFA', { selector: 'td' })).toHaveLength(2); // the row and the table
    expect(within(screen.getByText('Taux de marge').closest('tr')!).getByText('—')).toBeInTheDocument();
    const tab = screen.getByRole('tab', { name: 'Mensuel' });
    const panel = screen.getByRole('tabpanel');
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('puts the chosen period of a sanitaire report in the request and caps inputs at today', async () => {
    mount((u) => (u === '/api/reports' ? json(200, ALL_TYPES)
      : u === '/api/reports/synthese' ? json(200, SYNTHESE)
        : u.startsWith('/api/reports/sanitaire') ? json(200, { ...MENSUEL, type: 'sanitaire', title: 'Rapport sanitaire' }) : undefined));
    await screen.findAllByRole('row');
    await userEvent.click(screen.getByRole('tab', { name: 'Sanitaire' }));
    const from = await screen.findByLabelText('Du');
    expect(from).toHaveAttribute('max');
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(urls).toContain('/api/reports/sanitaire?from=2026-10-01&to=2026-10-31'));
  });
});

const today = new Date().toISOString().slice(0, 10);

describe('Reports: inputs', () => {
  it('caps every date input at today', async () => {
    mount(everything);
    await screen.findAllByRole('row');
    await userEvent.click(screen.getByRole('tab', { name: 'Quotidien' }));
    expect(await screen.findByLabelText('Jour')).toHaveAttribute('max', today);
    await userEvent.click(screen.getByRole('tab', { name: 'Mensuel' }));
    expect(await screen.findByLabelText('Mois')).toHaveAttribute('max', today.slice(0, 7));
  });

  it('lets the year be typed over the current one', async () => {
    mount(everything, '/rapports?type=annuel');
    const year = await screen.findByLabelText('Année');
    await userEvent.clear(year);
    await userEvent.type(year, '2025');
    await waitFor(() => expect(urls).toContain('/api/reports/annuel?date=2025-01-01'));
    expect(year).toHaveValue(2025);
  });

  it('refuses a start after the end without a request and says so under the fields', async () => {
    mount(everything, '/rapports?type=sanitaire&from=2026-10-01&to=2026-10-31');
    await screen.findByLabelText('Du');
    const before = urls.filter((u) => u.includes('/reports/sanitaire')).length;
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-11-05' } });
    expect(await screen.findByText('La date de début est après la date de fin')).toBeInTheDocument();
    expect(urls.filter((u) => u.includes('/reports/sanitaire'))).toHaveLength(before);
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });
});

describe('Reports: errors and files', () => {
  it('shows a 403 of a listed type without a retry button', async () => {
    mount((u) => (u === '/api/reports' ? json(200, ALL_TYPES)
      : u === '/api/reports/synthese' ? json(200, SYNTHESE)
        : u.startsWith('/api/reports/mensuel') ? json(403, { message: "Ce rapport n'est pas accessible à votre rôle" }) : undefined));
    await screen.findAllByRole('row');
    await userEvent.click(screen.getByRole('tab', { name: 'Mensuel' }));
    expect(await screen.findByText("Ce rapport n'est pas accessible à votre rôle")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });

  it('disables the file buttons while a download runs, and clears its error when the type changes', async () => {
    let release: (r: Response) => void = () => {};
    let calls = 0;
    mount((u) => {
      if (u === '/api/reports/synthese?format=csv') {
        calls += 1;
        return calls === 1 ? (new Promise<Response>((r) => { release = r; }) as unknown as Response) : undefined;
      }
      return everything(u);
    });
    await screen.findAllByRole('row');
    const csv = screen.getByRole('button', { name: 'CSV' });
    await userEvent.click(csv);
    expect(csv).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Excel' })).toBeDisabled();
    release(json(500, { message: 'Export impossible' }));
    expect(await screen.findByText('Export impossible')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Mensuel' }));
    expect(screen.queryByText('Export impossible')).not.toBeInTheDocument();
  });

  it('writes negative amounts of a table with the project minus and right-aligns an empty numeric cell', async () => {
    const report = {
      ...MENSUEL,
      sections: [{
        key: 't', title: 'Rentabilité',
        table: {
          columns: [{ key: 'lot', header: 'LOT' }, { key: 'margin', header: 'MARGE', unit: 'FCFA' }],
          rows: [{ lot: 'LC-1', margin: -105000 }, { lot: 'LC-2', margin: 500 }, { lot: 'LC-3', margin: null }],
        },
      }],
    };
    mount((u) => (u === '/api/reports' ? json(200, ALL_TYPES) : u === '/api/reports/synthese' ? json(200, report) : undefined));
    expect(await screen.findByText('−105 000 FCFA')).toHaveClass('text-right');
    const empty = within(screen.getByText('LC-3').closest('tr')!).getByText('—');
    expect(empty).toHaveClass('text-right');
  });
});
