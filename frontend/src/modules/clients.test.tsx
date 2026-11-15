import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import type { ModuleConfig } from '../components/module/types';
import { todayIso } from '../lib/format';
import { QuoteDetail } from '../pages/details/QuoteDetail';
import { clients } from './clients';
import { ModuleRoute } from '../pages/ModuleRoute';
import './index';
import { devis } from './salesShared';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'COMMERCIAL', twoFactorEnabled: true };
/** Spaces of every kind (the formatters use narrow and no-break ones) as one plain space. */
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const cells = (tr: Element | null) => flat(Array.from(tr!.querySelectorAll('td')).map((c) => c.textContent).join(' '));

const CUSTOMERS = [
  { id: 'c1', name: 'Restaurant Le Palmier', type: 'RESTAURANT', phone: '+228 93 12 34 56', email: null, city: 'Lomé', address: null, active: true, balance: 0 },
  { id: 'c2', name: 'Marché Hédzranawoé — Mme Afi', type: 'REVENDEUR', phone: '+228 98 65 43 21', email: 'afi@x.tg', city: 'Lomé', address: 'Marché central', active: true, balance: 400000 },
  { id: 'c3', name: 'SuperMarché Ramco', type: 'GROSSISTE', phone: '+228 22 21 00 00', email: null, city: 'Lomé', address: null, active: false, balance: 0 },
];
const CUSTOMER_DETAIL = { ...CUSTOMERS[1], invoiced: 1000000, paid: 600000, credited: 0, balance: 400000 };

const q = (id: string, reference: string, status: string, over: object = {}) => ({
  id, reference, date: '2026-11-10', validUntil: '2026-11-30', customerId: 'c1', customerName: 'Restaurant Le Palmier',
  product: 'Poulets de chair +1', quantity: 300, unit: null, total: 1075000, status, invoiceId: null, invoiceNumber: null, ...over,
});
const QUOTES = [
  q('q1', 'DV-0001', 'BROUILLON'),
  q('q2', 'DV-0002', 'ENVOYE'),
  q('q3', 'DV-0003', 'ACCEPTE'),
  q('q4', 'DV-0004', 'REFUSE'),
  q('q5', 'DV-0005', 'FACTURE', { invoiceId: 'i1', invoiceNumber: 'FA-0310' }),
  q('q6', 'DV-0006', 'EXPIRE', { validUntil: '2026-11-01' }),
  q('q8', 'DV-0008', 'BROUILLON'),
];
const QUOTE_COUNTS = { BROUILLON: 2, ENVOYE: 1, ACCEPTE: 1, REFUSE: 1, FACTURE: 1, EXPIRE: 1 };
const QUOTE_DETAIL = {
  ...QUOTES[0], customerPhone: '+228 93 12 34 56', customerAddress: null, note: null,
  lines: [
    { position: 1, kind: 'LOT', batchId: 'l1', animalId: null, stockItemId: null, sourceLabel: 'LC-2026-14', designation: 'Poulets de chair', unit: null, eggsPerUnit: null, quantity: 300, unitPrice: 3500, amount: 1050000, weightKg: null },
    { position: 2, kind: 'SERVICE', batchId: null, animalId: null, stockItemId: null, sourceLabel: null, designation: 'Transport', unit: null, eggsPerUnit: null, quantity: 10, unitPrice: 2500, amount: 25000, weightKg: null },
  ],
  history: [{ step: 'BROUILLON', at: '2026-11-10T09:00:00.000Z', by: 'Koffi' }],
};

// A draft whose lot has since been sold out: its source is no longer offered, its stored label is.
const QUOTE_GONE = {
  ...QUOTE_DETAIL, ...QUOTES[6],
  lines: [{ ...QUOTE_DETAIL.lines[0], batchId: 'gone', sourceLabel: 'LC-2026-09', quantity: 10, amount: 35000 }],
};
const QUOTE_SENT = { ...QUOTE_DETAIL, ...QUOTES[1] };
// The API's amounts are what is shown: here they differ from quantity × unit price (a stored rounding, a past price rule).
const QUOTE_API = {
  ...QUOTE_DETAIL, id: 'q7', reference: 'DV-0007', total: 250,
  lines: [{ ...QUOTE_DETAIL.lines[0], quantity: 2, unitPrice: 100, amount: 250, designation: 'Poulets de chair' }],
};

const SELLABLES: Record<string, unknown[]> = {
  LOT: [{ id: 'l1', kind: 'LOT', label: 'LC-2026-14 — Poulets de chair (4 820 vivants)', designation: 'Poulets de chair', unit: null, available: 4820, withdrawalUntil: null, sellable: true, reason: null }],
  ANIMAL: [
    { id: 'a1', kind: 'ANIMAL', label: 'TR-027 — Truie Large White', designation: 'Truie TR-027', unit: null, available: 1, withdrawalUntil: null, sellable: true, reason: null },
    { id: 'a2', kind: 'ANIMAL', label: 'TR-014 — Truie Landrace', designation: 'Truie TR-014', unit: null, available: 1, withdrawalUntil: null, sellable: false, reason: 'Gestante' },
  ],
  OEUFS: [{ id: 'e1', kind: 'OEUFS', label: 'LP-2026-03 — 4 710 œufs disponibles', designation: 'Œufs (plateau)', unit: 'plateau', available: 4710, eggsPerTray: 30, withdrawalUntil: null, sellable: true, reason: null }],
  ARTICLE: [{ id: 's2', kind: 'ARTICLE', label: 'Aliment ponte — 900 kg', designation: 'Aliment ponte', unit: 'kg', available: 900, withdrawalUntil: null, sellable: true, reason: null }],
};
const SETTINGS = { legal: { name: 'Ferme du Golfe SARL', address: 'Route de Kpalimé, Lomé', nif: '1001234567', rccm: 'TG-LOM-2020-B-1234' } };

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });
let failWith: { url: RegExp; status: number; message: string } | null = null;

const COMMERCIAL = { clients: ['read', 'update', 'delete'], ventes: ['read', 'create', 'update', 'delete'], parametres: ['read'] };
const COMPTABLE = { clients: ['read'], ventes: ['read', 'update', 'validate'], parametres: ['read'] };

function mount(ui: React.ReactNode, { perms = COMMERCIAL, farm, route = '/' }: { perms?: Record<string, string[]>; farm?: string; route?: string } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    }
    if (call.method !== 'GET') {
      if (failWith && failWith.url.test(call.url)) return json(failWith.status, { message: failWith.message });
      return json(201, { id: 'new1' });
    }
    const url = call.url;
    if (url.startsWith('/api/sales/sellables')) {
      return json(200, { items: SELLABLES[new URL(url, 'http://x').searchParams.get('kind') ?? ''] ?? [] });
    }
    if (url.startsWith('/api/sales')) {
      return page([{
        id: 'i2', date: '2026-10-20', number: 'FA-0309', customerId: 'c2', customerName: 'Marché Hédzranawoé — Mme Afi', product: 'Œufs (plateau)', quantity: 400,
        unit: null, total: 1000000, paid: 600000, credited: 0, refunded: 0, due: 400000, refundDue: 0, status: 'PARTIELLE', dueDate: '2026-11-05', overdue: false,
      }]);
    }
    const customer = /^\/api\/customers\/(\w+)(\?|$)/.exec(url);
    if (customer) return customer[1] === 'c2' ? json(200, CUSTOMER_DETAIL) : json(404, { message: 'Introuvable' });
    if (url.startsWith('/api/customers')) return page(url.includes('active=true') ? CUSTOMERS.filter((c) => c.active) : CUSTOMERS);
    const quote = /^\/api\/quotes\/(\w+)(\?|$)/.exec(url);
    if (quote) {
      const found: Record<string, unknown> = { q1: QUOTE_DETAIL, q2: QUOTE_SENT, q7: QUOTE_API, q8: QUOTE_GONE };
      return found[quote[1]] ? json(200, found[quote[1]]) : json(404, { message: 'Introuvable' });
    }
    if (url.startsWith('/api/quotes')) return page(QUOTES, { statusCounts: QUOTE_COUNTS });
    if (url === '/api/settings') return json(200, SETTINGS);
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mountList = (config: ModuleConfig<any>, opts?: Parameters<typeof mount>[1]) =>
  mount(<Routes><Route path="*" element={<ModulePage config={config} />} /></Routes>, opts);
const CustomerDetail = clients.detail!;
const rowOf = (text: string) => within(screen.getByText(text).closest('tr')!);

beforeEach(() => {
  calls.length = 0;
  failWith = null;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('clients list', () => {
  it('renders the reference headers, tile, subtitle and rows', async () => {
    mountList(clients);
    expect(await screen.findByText('SuperMarché Ramco')).toBeInTheDocument();
    for (const h of ['NOM', 'TYPE', 'TÉLÉPHONE', 'VILLE']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('Particuliers, revendeurs, restaurants et grossistes.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Total enregistrements', { selector: 'p' }).nextElementSibling).toHaveTextContent('3'));
    expect(cells(screen.getByText('Restaurant Le Palmier').closest('tr'))).toContain('Restaurant Le Palmier Restaurant +228 93 12 34 56 Lomé');
    expect(cells(screen.getByText('Marché Hédzranawoé — Mme Afi').closest('tr'))).toContain('Revendeur +228 98 65 43 21 Lomé');
    expect(cells(screen.getByText('SuperMarché Ramco').closest('tr'))).toContain('Grossiste +228 22 21 00 00 Lomé');
  });

  it('shows the accountant no Ajouter, and the commercial one (also under all farms: customers belong to the organisation)', async () => {
    mountList(clients, { perms: COMPTABLE });
    await screen.findByText('SuperMarché Ramco');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier|Supprimer/ })).not.toBeInTheDocument();
  });

  it('lets the commercial add (without the Actif box) and edit (with it) a customer', async () => {
    mountList(clients, { farm: 'all' });
    await screen.findByText('SuperMarché Ramco');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    let dialog = await screen.findByRole('dialog', { name: 'Ajouter — Clients' });
    expect(within(dialog).queryByLabelText('Actif')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Nom'), 'Chez Kossi');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Particulier');
    await user.type(within(dialog).getByLabelText('Ville'), 'Kpalimé');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', url: '/api/customers', body: { name: 'Chez Kossi', type: 'PARTICULIER', city: 'Kpalimé' } });

    await user.click(await within(screen.getByText('SuperMarché Ramco').closest('tr')!).findByRole('button', { name: 'Modifier' }));
    dialog = await screen.findByRole('dialog', { name: 'Modifier — Clients' });
    expect(within(dialog).getByLabelText('Actif')).not.toBeChecked();
    await user.click(within(dialog).getByLabelText('Actif'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({ method: 'PATCH', url: '/api/customers/c3', body: { active: true } });
  });
});

describe('customer detail', () => {
  it('shows what was invoiced, paid, credited and is still due, and the customer\'s invoices through the ventes list', async () => {
    mount(<CustomerDetail id="c2" />);
    expect(await screen.findByRole('heading', { name: 'Marché Hédzranawoé — Mme Afi' })).toBeInTheDocument();
    for (const [label, value] of [['Facturé', '1 000 000 FCFA'], ['Payé', '600 000 FCFA'], ['Avoirs', '0 FCFA'], ['Reste dû', '400 000 FCFA']]) {
      expect(flat(screen.getByText(label, { selector: 'p' }).nextElementSibling!.textContent)).toBe(value);
    }
    // The real ventes list, read-only, scoped to the customer.
    expect(await screen.findByText('FA-0309')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'RESTE DÛ' })).toBeInTheDocument();
    expect(screen.getByText('400 000 FCFA', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajouter|Encaisser|Avoir|Modifier|Supprimer/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/sales') && c.url.includes('customerId=c2'))).toBe(true);
  });

  it('shows the not-found card for an unknown customer', async () => {
    mount(<CustomerDetail id="zz" />);
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
  });
});

describe('devis tab', () => {
  it('renders the reference headers and one pill per status', async () => {
    mountList(devis);
    expect(await screen.findByText('DV-0006')).toBeInTheDocument();
    for (const h of ['DATE', 'N° DEVIS', 'CLIENT', 'PRODUIT', 'TOTAL', 'VALIDITÉ', 'STATUT']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(cells(screen.getByText('DV-0001').closest('tr'))).toContain('2026-11-10 DV-0001 Restaurant Le Palmier Poulets de chair +1 1 075 000 FCFA 2026-11-30 Brouillon');
    for (const [ref, label] of [['DV-0001', 'Brouillon'], ['DV-0002', 'Envoyé'], ['DV-0003', 'Accepté'], ['DV-0004', 'Refusé'], ['DV-0005', 'Facturé'], ['DV-0006', 'Expiré']]) {
      expect(rowOf(ref).getByText(label, { selector: 'span' })).toBeInTheDocument();
    }
    const tone = (ref: string, label: string) => rowOf(ref).getByText(label, { selector: 'span' }).getAttribute('data-tone');
    expect(
      [['DV-0001', 'Brouillon'], ['DV-0002', 'Envoyé'], ['DV-0003', 'Accepté'], ['DV-0004', 'Refusé'], ['DV-0005', 'Facturé'], ['DV-0006', 'Expiré']].map(([r, l]) => tone(r, l)),
    ).toEqual(['neutral', 'warning', 'success', 'danger', 'success', 'danger']);
    expect(screen.getByRole('link', { name: 'DV-0001' })).toHaveAttribute('href', '/m/ventes/devis/q1');
  });

  it('offers each workflow button on the statuses it applies to only', async () => {
    mountList(devis);
    await screen.findByText('DV-0006');
    const has = (ref: string, name: string) => rowOf(ref).queryByRole('button', { name }) !== null;
    expect(['DV-0001', 'DV-0002', 'DV-0003', 'DV-0004', 'DV-0005', 'DV-0006'].map((r) => has(r, 'Envoyer'))).toEqual([true, false, false, false, false, false]);
    expect(['DV-0001', 'DV-0002', 'DV-0003', 'DV-0004', 'DV-0005', 'DV-0006'].map((r) => has(r, 'Accepter'))).toEqual([false, true, false, false, false, true]);
    expect(['DV-0001', 'DV-0002', 'DV-0003', 'DV-0004', 'DV-0005', 'DV-0006'].map((r) => has(r, 'Refuser'))).toEqual([false, true, false, false, false, true]);
    expect(['DV-0001', 'DV-0002', 'DV-0003', 'DV-0004', 'DV-0005', 'DV-0006'].map((r) => has(r, 'Facturer'))).toEqual([false, true, true, false, false, true]);
  });

  it('turns an accepted quote into an invoice draft after a confirmation', async () => {
    mountList(devis);
    await screen.findByText('DV-0003');
    const user = userEvent.setup();
    await user.click(rowOf('DV-0003').getByRole('button', { name: 'Facturer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Créer une facture brouillon à partir de DV-0003 ?')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Facturer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/quotes/q3/convert' });
  });

  it('sends a draft and shows the API refusal in the dialog', async () => {
    failWith = { url: /\/send$/, status: 409, message: 'Ce devis a déjà été envoyé' };
    mountList(devis);
    await screen.findByText('DV-0001');
    const user = userEvent.setup();
    await user.click(rowOf('DV-0001').getByRole('button', { name: 'Envoyer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByText('Ce devis a déjà été envoyé')).toBeInTheDocument();
    expect(writes()[0].url).toBe('/api/quotes/q1/send');
  });

  it('locks edit and delete outside the draft, with the reason', async () => {
    mountList(devis);
    await screen.findByText('DV-0001');
    expect(rowOf('DV-0001').getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    expect(rowOf('DV-0001').getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute('aria-disabled');
    for (const ref of ['DV-0002', 'DV-0005']) {
      expect(rowOf(ref).getByRole('button', { name: 'Modifier' })).toHaveAttribute('aria-disabled', 'true');
      expect(rowOf(ref).getByRole('button', { name: 'Supprimer' })).toHaveAttribute('title', 'Enregistrement verrouillé');
    }
  });

  it('gives the accountant (no create on ventes) no button to write, and nobody any under all farms', async () => {
    mountList(devis, { perms: COMPTABLE });
    await screen.findByText('DV-0001');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    for (const name of ['Envoyer', 'Accepter', 'Refuser', 'Facturer', 'Modifier', 'Supprimer']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('is read-only under all farms', async () => {
    mountList(devis, { farm: 'all' });
    await screen.findByText('DV-0001');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Envoyer' })).not.toBeInTheDocument();
  });
});

describe('devis form', () => {
  async function openForm() {
    mountList(devis);
    await screen.findByText('DV-0001');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Devis' });
    return { user, dialog };
  }

  it('builds the lines from the sellable sources, shows the live totals and posts the sources by kind', async () => {
    const { user, dialog } = await openForm();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Restaurant Le Palmier' })).toBeInTheDocument());
    // Inactive customers are not offered.
    expect(within(dialog).queryByRole('option', { name: 'SuperMarché Ramco' })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Client'), 'Restaurant Le Palmier');
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    expect(within(dialog).getByLabelText('Source ligne 1')).toBeDisabled();

    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Lot');
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: 'Source ligne 1' }), 'LC-2026-14 — Poulets de chair (4 820 vivants)');
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('Poulets de chair');
    await user.type(within(dialog).getByLabelText('Quantité ligne 1'), '300');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 1'), '3500');
    expect(flat(within(dialog).getByTestId('amount-1').textContent)).toContain('1 050 000 FCFA');

    await user.click(within(dialog).getByRole('button', { name: 'Ajouter une ligne' }));
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 2'), 'Œufs');
    await user.selectOptions(await within(dialog).findByRole('option', { name: 'LP-2026-03 — 4 710 œufs disponibles' }).then(() => within(dialog).getByLabelText('Source ligne 2')), 'e1');
    expect(within(dialog).getByLabelText('Unité ligne 2')).toHaveValue('PLATEAU');
    await user.type(within(dialog).getByLabelText('Quantité ligne 2'), '2');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 2'), '2500');

    await user.click(within(dialog).getByRole('button', { name: 'Ajouter une ligne' }));
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 3'), 'Prestation');
    expect(within(dialog).getByLabelText('Source ligne 3')).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Désignation ligne 3'), 'Transport');
    await user.type(within(dialog).getByLabelText('Quantité ligne 3'), '10');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 3'), '2500');
    expect(flat(within(dialog).getByText(/^Total :/).textContent)).toBe('Total : 1 080 000 FCFA');

    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      url: '/api/quotes',
      body: {
        customerId: 'c1',
        date: todayIso(),
        lines: [
          { kind: 'LOT', batchId: 'l1', designation: 'Poulets de chair', quantity: 300, unitPrice: 3500 },
          { kind: 'OEUFS', batchId: 'e1', designation: 'Œufs (plateau)', unit: 'PLATEAU', quantity: 2, unitPrice: 2500 },
          { kind: 'SERVICE', designation: 'Transport', quantity: 10, unitPrice: 2500 },
        ],
      },
    });
  });

  it('lists a source that cannot be sold as a disabled option with its reason', async () => {
    const { user, dialog } = await openForm();
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Animal');
    const blocked = await within(dialog).findByRole('option', { name: 'TR-014 — Truie Landrace (Gestante)' });
    expect(blocked).toBeDisabled();
    expect(within(dialog).getByRole('option', { name: 'TR-027 — Truie Large White' })).toBeEnabled();
    expect(calls.some((c) => c.url === `/api/sales/sellables?kind=ANIMAL&date=${todayIso()}`)).toBe(true);
  });

  it('asks for the sellables of the quote date, and for an article its unit-less line', async () => {
    const { user, dialog } = await openForm();
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-11-12');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Article');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/sales/sellables?kind=ARTICLE&date=2026-11-12')).toBe(true));
    expect(within(dialog).getByLabelText('Unité ligne 1')).toBeDisabled();
  });

  it('edits only what changed after loading the quote', async () => {
    mountList(devis);
    await screen.findByText('DV-0001');
    const user = userEvent.setup();
    await user.click(rowOf('DV-0001').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Devis' });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité ligne 1')).toHaveValue(300));
    expect(within(dialog).getByLabelText('Valable jusqu\'au')).toHaveValue('2026-11-30');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);

    await user.click(rowOf('DV-0001').getByRole('button', { name: 'Modifier' }));
    const again = await screen.findByRole('dialog', { name: 'Modifier — Devis' });
    await waitFor(() => expect(within(again).getByLabelText('Quantité ligne 1')).toHaveValue(300));
    await user.clear(within(again).getByLabelText('Valable jusqu\'au'));
    await user.click(within(again).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/quotes/q1', body: { validUntil: null } });
  });
});

describe('quote detail', () => {
  it('shows the lines, the history and the printable sheet with the legal block and the validity', async () => {
    mount(<QuoteDetail id="q1" />);
    expect(await screen.findByRole('heading', { name: 'DV-0001' })).toBeInTheDocument();
    expect(screen.getByText('Brouillon', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimer' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getByText('Poulets de chair')).toBeInTheDocument();
    const sheet = await screen.findByLabelText('Devis', { selector: 'section' });
    expect(await within(sheet).findByText('Ferme du Golfe SARL')).toBeInTheDocument();
    expect(within(sheet).getByText('Valable jusqu\'au 2026-11-30')).toBeInTheDocument();
    expect(flat(within(sheet).getByText(/^Total :/).textContent)).toBe('Total : 1 075 000 FCFA');
    expect(within(sheet).getByText('Transport')).toBeInTheDocument();
  });

  it('shows the not-found card for an unknown quote', async () => {
    mount(<QuoteDetail id="zz" />);
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
  });
});

describe('customers: permissions and refusals', () => {
  it('shows the delete icon to a role with update (master data) and not to one with delete only', async () => {
    mountList(clients, { perms: { clients: ['read', 'update'] } });
    await screen.findByText('SuperMarché Ramco');
    expect(rowOf('SuperMarché Ramco').getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
    cleanup();
    mountList(clients, { perms: { clients: ['read', 'delete'] } });
    await screen.findByText('SuperMarché Ramco');
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('deletes a customer after a confirmation and shows the API refusal', async () => {
    failWith = { url: /customers/, status: 409, message: 'Ce client a des documents : désactivez-le' };
    mountList(clients);
    await screen.findByText('SuperMarché Ramco');
    const user = userEvent.setup();
    await user.click(rowOf('SuperMarché Ramco').getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    expect(await within(dialog).findByText('Ce client a des documents : désactivez-le')).toBeInTheDocument();
    expect(writes()).toEqual([expect.objectContaining({ method: 'DELETE', url: '/api/customers/c3' })]);
  });
});

describe('customer detail: invoices area', () => {
  it('says so when the role cannot read the invoices', async () => {
    mount(<CustomerDetail id="c2" />, { perms: { clients: ['read'] } });
    expect(await screen.findByText('Factures non accessibles avec votre rôle')).toBeInTheDocument();
  });
});

describe('role views', () => {
  it('gives the owner read-only quotes and no access to Clients', async () => {
    mountList(devis, { perms: { ventes: ['read', 'validate'] } });
    await screen.findByText('DV-0001');
    for (const name of ['Ajouter', 'Envoyer', 'Facturer', 'Modifier', 'Supprimer']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    cleanup();
    mount(<Routes><Route path="/m/:module" element={<ModuleRoute />} /></Routes>, { perms: { ventes: ['read', 'validate'] }, route: '/m/clients' });
    expect(await screen.findByText('Accès non autorisé')).toBeInTheDocument();
  });

  it('gives the farm director read-only customers and quotes', async () => {
    const perms = { clients: ['read'], ventes: ['read'] };
    mountList(clients, { perms });
    await screen.findByText('SuperMarché Ramco');
    expect(screen.queryByRole('button', { name: /Ajouter|Modifier|Supprimer/ })).not.toBeInTheDocument();
    cleanup();
    mountList(devis, { perms });
    await screen.findByText('DV-0001');
    expect(screen.queryByRole('button', { name: /Ajouter|Envoyer|Facturer|Modifier|Supprimer/ })).not.toBeInTheDocument();
  });

  it('gives the storekeeper neither module', async () => {
    for (const module of ['clients', 'ventes']) {
      mount(<Routes><Route path="/m/:module" element={<ModuleRoute />} /></Routes>, { perms: { stocks: ['read'] }, route: `/m/${module}` });
      expect(await screen.findByText('Accès non autorisé')).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('quote refusals and detail under all farms', () => {
  it('shows the API refusal of a conversion in its dialog', async () => {
    failWith = { url: /\/convert$/, status: 409, message: 'Seul un devis envoyé ou accepté peut être facturé' };
    mountList(devis);
    await screen.findByText('DV-0002');
    const user = userEvent.setup();
    await user.click(rowOf('DV-0002').getByRole('button', { name: 'Facturer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Facturer' }));
    expect(await screen.findByText('Seul un devis envoyé ou accepté peut être facturé')).toBeInTheDocument();
  });

  it('shows the API refusal of a creation in the form', async () => {
    failWith = { url: /\/quotes$/, status: 400, message: 'Ce client est inactif' };
    mountList(devis);
    await screen.findByText('DV-0001');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Devis' });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Restaurant Le Palmier' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Client'), 'Restaurant Le Palmier');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Prestation');
    await user.type(within(dialog).getByLabelText('Désignation ligne 1'), 'Transport');
    await user.type(within(dialog).getByLabelText('Quantité ligne 1'), '1');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 1'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Ce client est inactif')).toBeInTheDocument();
  });

  it('offers Facturer on a sent quote\'s detail, and not under all farms', async () => {
    mount(<QuoteDetail id="q2" />);
    expect(await screen.findByRole('button', { name: 'Facturer' })).toBeInTheDocument();
    cleanup();
    mount(<QuoteDetail id="q2" />, { farm: 'all' });
    expect(await screen.findByRole('heading', { name: 'DV-0002' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Facturer' })).not.toBeInTheDocument();
  });

  it('prints the amounts the API stored, not quantity × unit price', async () => {
    mount(<QuoteDetail id="q7" />);
    const sheet = await screen.findByLabelText('Devis', { selector: 'section' });
    expect(within(sheet).getAllByText(/^250\sFCFA$/)).toHaveLength(1);
    expect(within(sheet).queryByText(/^200\sFCFA$/)).not.toBeInTheDocument();
    expect(flat(within(sheet).getByText(/^Total :/).textContent)).toBe('Total : 250 FCFA');
  });
});

describe('devis form lines', () => {
  async function openForm() {
    mountList(devis);
    await screen.findByText('DV-0001');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Ajouter — Devis' }) };
  }

  it('asks for a whole quantity for a lot, an animal and eggs, and for a decimal one for an article and a prestation', async () => {
    const { user, dialog } = await openForm();
    const quantity = () => within(dialog).getByLabelText('Quantité ligne 1');
    for (const [label, step] of [['Lot', '1'], ['Animal', '1'], ['Œufs', '1'], ['Article', '0.01'], ['Prestation', '0.01']]) {
      await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), label);
      expect(quantity()).toHaveAttribute('step', step);
    }
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Lot');
    await user.selectOptions(await within(dialog).findByRole('option', { name: /LC-2026-14/ }).then(() => within(dialog).getByLabelText('Source ligne 1')), 'l1');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Restaurant Le Palmier' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Client'), 'Restaurant Le Palmier');
    await user.type(quantity(), '2.5');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 1'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/La quantité doit être un nombre entier/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('clears the designation a pick prefilled when the kind changes, and keeps a typed one', async () => {
    const { user, dialog } = await openForm();
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Lot');
    await user.selectOptions(await within(dialog).findByRole('option', { name: /LC-2026-14/ }).then(() => within(dialog).getByLabelText('Source ligne 1')), 'l1');
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('Poulets de chair');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Prestation');
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('');
    expect(within(dialog).getByLabelText('Source ligne 1')).toHaveValue('');
    await user.type(within(dialog).getByLabelText('Désignation ligne 1'), 'Transport');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Article');
    expect(within(dialog).getByLabelText('Désignation ligne 1')).toHaveValue('Transport');
  });

  it('asks for no sources while the quote date is empty', async () => {
    const { user, dialog } = await openForm();
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Lot');
    expect(within(dialog).getByLabelText('Source ligne 1')).toBeDisabled();
    expect(calls.some((c) => c.url.startsWith('/api/sales/sellables'))).toBe(false);
  });

  it('shows a stored source no longer sellable under its own label', async () => {
    mountList(devis);
    await screen.findByText('DV-0008');
    const user = userEvent.setup();
    await user.click(rowOf('DV-0008').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Devis' });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité ligne 1')).toHaveValue(10));
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'LC-2026-14 — Poulets de chair (4 820 vivants)' })).toBeInTheDocument());
    expect(within(dialog).getByRole('option', { name: 'LC-2026-09' })).toBeDisabled();
    expect(within(dialog).queryByRole('option', { name: 'Valeur actuelle' })).not.toBeInTheDocument();
  });
});
