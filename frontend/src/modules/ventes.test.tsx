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
import { InvoiceDetail } from '../pages/details/InvoiceDetail';
import { clients } from './clients';
import { ModuleRoute } from '../pages/ModuleRoute';
import { MODULES } from './registry';
import './index';
import { avoirs, ventes } from './ventes';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'COMMERCIAL', twoFactorEnabled: true };
/** Spaces of every kind (the formatters use narrow and no-break ones) as one plain space. */
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const cells = (tr: Element | null) => flat(Array.from(tr!.querySelectorAll('td')).map((c) => c.textContent).join(' '));

const inv = (id: string, number: string | null, status: string, over: object = {}) => ({
  id, date: '2026-10-21', number, customerId: 'c1', customerName: 'Restaurant Le Palmier', product: 'Poulets de chair', quantity: 300, unit: null,
  total: 1050000, paid: 1050000, credited: 0, refunded: 0, due: 0, refundDue: 0, status, dueDate: '2026-11-05', overdue: false, ...over,
});
const INVOICES = [
  inv('i1', 'FA-0310', 'SOLDEE', { credited: 105000, refunded: 105000 }),
  inv('i2', 'FA-0309', 'PARTIELLE', {
    date: '2026-10-20', customerId: 'c2', customerName: 'Marché Hédzranawoé — Mme Afi', product: 'Œufs (plateau)', quantity: 400,
    total: 1000000, paid: 600000, due: 400000,
  }),
  inv('i3', 'FA-0305', 'SOLDEE', { date: '2026-10-12', customerId: 'c3', customerName: 'SuperMarché Ramco', product: 'Porcs', quantity: 12, total: 1620000, paid: 1620000 }),
  inv('i4', 'FA-0301', 'SOLDEE', { date: '2026-10-05', product: 'Porcelets', quantity: 10, total: 300000, paid: 300000 }),
  inv('i5', null, 'BROUILLON', { date: '2026-11-14', product: 'Aliment ponte', quantity: 100, unit: 'kg', total: 32000, paid: 0, due: 32000, dueDate: null }),
  inv('i6', 'FA-0311', 'EMISE', { date: '2026-10-25', product: 'Poulets de chair', quantity: 100, total: 500000, paid: 0, due: 500000, dueDate: '2026-11-01', overdue: true }),
  inv('i7', 'FA-0312', 'SOLDEE', { product: 'Poulets de chair', credited: 105000, paid: 1050000, refundDue: 105000 }),
  inv('i8', 'FA-0313', 'ANNULEE', { product: 'Porcs', quantity: 1, total: 135000, paid: 0, due: 0 }),
  // A second credit completing a line already partly credited (2.5 kg x 333.33 = 833.33, credited 1.25 for 416.66).
  inv('i10', 'FA-0314', 'EMISE', { product: 'Aliment croissance', quantity: 2.5, unit: 'kg', total: 833.33, paid: 0, credited: 416.66, due: 416.67 }),
  inv('i11', 'FA-0316', 'EMISE', { product: 'Aliment croissance', quantity: 3, unit: 'kg', total: 300, paid: 0, due: 300 }),
  // Nothing to pay: settled at issue, no payment, no credit note.
  inv('i12', 'FA-0315', 'SOLDEE', { product: 'Prestation offerte', quantity: 1, total: 0, paid: 0, due: 0 }),
];
const COUNTS = { BROUILLON: 1, EMISE: 1, PARTIELLE: 1, SOLDEE: 4, ANNULEE: 1 };

const line = (over: object) => ({
  id: 'ln1', position: 1, kind: 'LOT', batchId: 'l1', animalId: null, stockItemId: null, sourceLabel: 'LC-2026-12', designation: 'Poulets de chair',
  unit: null, eggsPerUnit: null, quantity: 300, unitPrice: 3500, amount: 1050000, weightKg: null, creditedQuantity: 30, creditableQuantity: 270, creditableAmount: 945000,
  activity: 'AVICOLE', category: 'VENTE_ANIMAUX', ...over,
});
const detailOf = (row: object, over: object) => ({
  ...row, customerPhone: '+228 93 12 34 56', customerAddress: 'Rue des Palmiers, Lomé', quoteId: null, quoteNumber: null, note: null, cancelReason: null,
  lines: [], payments: [], creditNotes: [], history: [], ...over,
});
const PAYMENT = { id: 'p1', number: 'RC-0001', kind: 'ENCAISSEMENT', date: '2026-10-20', amount: 600000, method: 'ESPECES', reference: null };
const DETAILS: Record<string, unknown> = {
  i1: detailOf(INVOICES[0], {
    lines: [line({})],
    payments: [{ ...PAYMENT, id: 'p9', number: 'RC-0010', amount: 1050000, date: '2026-10-21' }],
    creditNotes: [{ id: 'cn1', number: 'AV-0001', date: '2026-11-02', reason: 'Poulets non conformes', withReturn: true, total: 105000 }],
    history: [
      { step: 'BROUILLON', at: '2026-10-21T08:00:00.000Z', by: 'Koffi' },
      { step: 'EMISE', at: '2026-10-21T09:00:00.000Z', by: 'Koffi' },
    ],
  }),
  i2: detailOf(INVOICES[1], {
    customerAddress: 'Marché central, Lomé',
    lines: [line({
      kind: 'OEUFS', batchId: 'e1', sourceLabel: 'LP-2026-03', designation: 'Œufs (plateau)', unit: 'PLATEAU', eggsPerUnit: 30, quantity: 400,
      unitPrice: 2500, amount: 1000000, creditedQuantity: 0, creditableQuantity: 400, creditableAmount: 1000000, activity: 'AVICOLE', category: 'VENTE_OEUFS',
    }), line({
      id: 'ln2', position: 2, kind: 'SERVICE', batchId: null, sourceLabel: null, designation: 'Livraison à domicile', quantity: 1, unitPrice: 0, amount: 0,
      creditedQuantity: 0, creditableQuantity: 1, creditableAmount: 0, activity: 'GENERAL', category: 'PRESTATIONS',
    })],
    payments: [PAYMENT],
  }),
  i5: detailOf(INVOICES[4], {
    lines: [line({
      kind: 'ARTICLE', batchId: null, stockItemId: 's2', sourceLabel: 'Aliment ponte', designation: 'Aliment ponte', unit: 'kg', quantity: 100, unitPrice: 320,
      amount: 32000, creditedQuantity: 0, creditableQuantity: 100, creditableAmount: 32000, activity: 'GENERAL', category: 'VENTE_ARTICLES',
    })],
  }),
  i7: detailOf(INVOICES[6], { lines: [line({})] }),
  i10: detailOf(INVOICES[8], {
    lines: [line({
      kind: 'ARTICLE', batchId: null, stockItemId: 's2', sourceLabel: 'Aliment ponte', designation: 'Aliment ponte', unit: 'kg', quantity: 2.5, unitPrice: 333.33,
      amount: 833.33, creditedQuantity: 1.25, creditableQuantity: 1.25, creditableAmount: 416.67, category: 'VENTE_ARTICLES',
    })],
  }),
  // A previous credit rounded up: what is left in money (250) is below the proportional amount of a smaller quantity.
  i11: detailOf(INVOICES[9], {
    lines: [line({
      kind: 'ARTICLE', batchId: null, stockItemId: 's2', sourceLabel: 'Aliment ponte', designation: 'Aliment ponte', unit: 'kg', quantity: 3, unitPrice: 100,
      amount: 300, creditedQuantity: 0.1, creditableQuantity: 2.9, creditableAmount: 250, category: 'VENTE_ARTICLES',
    })],
  }),
  i8: detailOf(INVOICES[7], { cancelReason: 'Erreur de client', lines: [line({ creditedQuantity: 0, creditableQuantity: 0 })] }),
  // Amounts the API stored differ from quantity × unit price: they are what is shown.
  i9: detailOf(inv('i9', 'FA-0320', 'EMISE', { total: 250, paid: 0, due: 250 }), {
    lines: [line({ quantity: 2, unitPrice: 100, amount: 250, creditedQuantity: 0, creditableQuantity: 2, creditableAmount: 250 })],
  }),
};

const CUSTOMERS = [
  { id: 'c1', name: 'Restaurant Le Palmier', type: 'RESTAURANT', phone: '+228 93 12 34 56', email: null, city: 'Lomé', address: null, active: true, balance: 0 },
  { id: 'c2', name: 'Marché Hédzranawoé — Mme Afi', type: 'REVENDEUR', phone: '+228 98 65 43 21', email: null, city: 'Lomé', address: null, active: true, balance: 400000 },
];
const CUSTOMER_DETAIL = { ...CUSTOMERS[1], invoiced: 1000000, paid: 600000, credited: 0, balance: 400000 };

const CREDIT_NOTES = [{
  id: 'cn1', number: 'AV-0001', date: '2026-11-02', invoiceId: 'i1', invoiceNumber: 'FA-0310', customerName: 'Restaurant Le Palmier',
  reason: 'Poulets non conformes', withReturn: true, total: 105000,
}];
const CREDIT_NOTE_DETAIL = {
  ...CREDIT_NOTES[0], customerPhone: '+228 93 12 34 56', customerAddress: 'Rue des Palmiers, Lomé',
  lines: [{ id: 'cl1', invoiceLineId: 'ln1', kind: 'LOT', designation: 'Poulets de chair', unit: null, quantity: 30, unitPrice: 3500, amount: 105000 }],
};
const QUOTES = [{
  id: 'q1', reference: 'DV-0001', date: '2026-11-10', validUntil: null, customerId: 'c1', customerName: 'Restaurant Le Palmier', product: 'Poulets de chair',
  quantity: 300, unit: null, total: 1050000, status: 'BROUILLON', invoiceId: null, invoiceNumber: null,
}];

const SELLABLES: Record<string, unknown[]> = {
  LOT: [{ id: 'l1', kind: 'LOT', label: 'LC-2026-14 — Poulets de chair (4 820 vivants)', designation: 'Poulets de chair', unit: null, available: 4820, withdrawalUntil: null, sellable: true, reason: null }],
};
const SETTINGS = { invoiceDueDays: 15, eggsPerTray: 30, legal: { name: 'Ferme du Golfe SARL', address: 'Route de Kpalimé, Lomé', nif: '1001234567', rccm: 'TG-LOM-2020-B-1234' } };

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });
let failWith: { url: RegExp; status: number; message: string } | null = null;

const COMMERCIAL = { clients: ['read', 'update', 'delete'], ventes: ['read', 'create', 'update', 'delete'], parametres: ['read'] };
const COMPTABLE = { clients: ['read'], ventes: ['read', 'update', 'validate'], parametres: ['read'] };
const PROPRIETAIRE = { clients: [], ventes: ['read', 'validate'], parametres: ['read'] };

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
    if (url.startsWith('/api/sales/sellables')) return json(200, { items: SELLABLES[new URL(url, 'http://x').searchParams.get('kind') ?? ''] ?? [] });
    const invoice = /^\/api\/sales\/(\w+)(\?|$)/.exec(url);
    if (invoice) return DETAILS[invoice[1]] ? json(200, DETAILS[invoice[1]]) : json(404, { message: 'Introuvable' });
    if (url.startsWith('/api/sales')) {
      const customerId = new URL(url, 'http://x').searchParams.get('customerId');
      return page(customerId ? INVOICES.filter((i) => i.customerId === customerId) : INVOICES, { statusCounts: COUNTS });
    }
    if (url === '/api/credit-notes/cn1') return json(200, CREDIT_NOTE_DETAIL);
    if (url.startsWith('/api/credit-notes')) return page(CREDIT_NOTES);
    if (url.startsWith('/api/quotes')) return page(QUOTES);
    const customer = /^\/api\/customers\/(\w+)(\?|$)/.exec(url);
    if (customer) return customer[1] === 'c2' ? json(200, CUSTOMER_DETAIL) : json(404, { message: 'Introuvable' });
    if (url.startsWith('/api/customers')) return page(CUSTOMERS);
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
const rowOf = (text: string) => within(screen.getByText(text).closest('tr')!);
const tone = (row: ReturnType<typeof rowOf>, label: string) => row.getByText(label, { selector: 'span' }).getAttribute('data-tone');
const print = vi.fn();

beforeEach(() => {
  calls.length = 0;
  failWith = null;
  print.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('print', print);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('ventes list', () => {
  it('renders the reference header, subtitle, the single tile, the seven columns and the reference rows with their pills', async () => {
    mountList(ventes);
    expect(await screen.findByText('FA-0301')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ventes' })).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    expect(screen.getByText('Factures, paiements comptants, partiels ou à crédit.')).toBeInTheDocument();
    for (const h of ['DATE', 'N° FACTURE', 'CLIENT', 'PRODUIT', 'QUANTITÉ', 'TOTAL', 'RESTE DÛ']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    // `Total enregistrements` only: no per-status tile, no status filter.
    expect(screen.getByText('Total enregistrements', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Émise', { selector: 'p' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Tous les statuts' })).not.toBeInTheDocument();
    expect(cells(screen.getByText('FA-0309').closest('tr'))).toContain('2026-10-20 FA-0309 Marché Hédzranawoé — Mme Afi Œufs (plateau) 400 1 000 000 FCFA 400 000 FCFA');
    expect(cells(screen.getByText('FA-0310').closest('tr'))).toContain('2026-10-21 FA-0310 Restaurant Le Palmier Poulets de chair 300 1 050 000 FCFA 0 FCFA');
    expect(tone(rowOf('FA-0309'), '400 000 FCFA')).toBe('warning');
    expect(tone(rowOf('FA-0310'), '0 FCFA')).toBe('success');
    expect(rowOf('FA-0310').getByRole('link')).toHaveAttribute('href', '/m/ventes/i1');
  });

  it('shows a dash for a draft number and the pill of each case: Brouillon, overdue, À rembourser, Annulée', async () => {
    mountList(ventes);
    await screen.findByText('FA-0301');
    const draft = within(screen.getByText('Aliment ponte').closest('tr')!);
    expect(cells(draft.getByText('Aliment ponte').closest('tr'))).toContain('2026-11-14 — Restaurant Le Palmier Aliment ponte 100 32 000 FCFA Brouillon');
    expect(tone(draft, 'Brouillon')).toBe('neutral');
    // The reference shows what is still due in yellow, overdue or not (the Créance alert carries the lateness).
    expect(tone(rowOf('FA-0311'), '500 000 FCFA')).toBe('warning');
    expect(tone(rowOf('FA-0312'), 'À rembourser 105 000 FCFA')).toBe('danger');
    expect(tone(rowOf('FA-0313'), 'Annulée')).toBe('neutral');
  });

  it('has the tabs Factures, Devis and Avoirs', async () => {
    mountList(ventes);
    await screen.findByText('FA-0301');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Factures', 'Devis', 'Avoirs']);
  });
});

describe('invoice form', () => {
  async function openForm(opts?: Parameters<typeof mount>[1]) {
    mountList(ventes, opts);
    await screen.findByText('FA-0301');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Ventes' });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Restaurant Le Palmier' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Client'), 'Restaurant Le Palmier');
    await user.selectOptions(within(dialog).getByLabelText('Type ligne 1'), 'Prestation');
    await user.type(within(dialog).getByLabelText('Désignation ligne 1'), 'Transport');
    await user.type(within(dialog).getByLabelText('Quantité ligne 1'), '10');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 1'), '2500');
    return { user, dialog };
  }

  it('issues by default: the box is checked, the cash payment and its method go to /sales/issued with the lines', async () => {
    const { user, dialog } = await openForm();
    expect(within(dialog).getByLabelText('Émettre la facture')).toBeChecked();
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    expect(flat(within(dialog).getByText(/^Total :/).textContent)).toBe('Total : 25 000 FCFA');
    await user.type(within(dialog).getByLabelText('Payé comptant'), '10000');
    await user.selectOptions(within(dialog).getByLabelText('Mode de paiement'), 'Mobile money');
    expect(within(dialog).getAllByRole('option', { name: /Espèces|Virement|Mobile money|Chèque/ }).map((o) => o.textContent)).toEqual(['Espèces', 'Virement', 'Mobile money', 'Chèque']);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      url: '/api/sales/issued',
      body: {
        customerId: 'c1',
        date: todayIso(),
        lines: [{ kind: 'SERVICE', designation: 'Transport', quantity: 10, unitPrice: 2500 }],
        payment: { amount: 10000, method: 'MOBILE_MONEY' },
      },
    });
  });

  it('saves a draft on /sales, without payment fields, when Émettre la facture is unchecked', async () => {
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText('Payé comptant'), '10000');
    await user.click(within(dialog).getByLabelText('Émettre la facture'));
    expect(within(dialog).queryByLabelText('Payé comptant')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Mode de paiement')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      url: '/api/sales',
      body: { customerId: 'c1', date: todayIso(), lines: [{ kind: 'SERVICE', designation: 'Transport', quantity: 10, unitPrice: 2500 }] },
    });
  });

  it('offers no issue box to a role without update on ventes: it only saves drafts', async () => {
    const { user, dialog } = await openForm({ perms: { clients: ['read'], ventes: ['read', 'create'] } });
    expect(within(dialog).queryByLabelText('Émettre la facture')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Payé comptant')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/sales' });
  });

  it('refuses a cash payment above the total before posting', async () => {
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText('Payé comptant'), '25001');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le montant dépasse le reste dû')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('shows the API refusal of a lot under withdrawal in the dialog', async () => {
    failWith = { url: /\/sales\/issued$/, status: 400, message: "Le lot LC-2026-15 est en délai d'attente jusqu'au 2026-11-20 : vente impossible" };
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("Le lot LC-2026-15 est en délai d'attente jusqu'au 2026-11-20 : vente impossible")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Ajouter — Ventes' })).toBeInTheDocument();
  });

  it('prints the due date the API will give (date + invoiceDueDays) under Échéance, and sends a typed one', async () => {
    const { user, dialog } = await openForm();
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-11-15');
    expect(await within(dialog).findByText('Par défaut : 2026-11-30')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Échéance')).toHaveAccessibleDescription('Par défaut : 2026-11-30');
    await user.type(within(dialog).getByLabelText('Échéance'), '2026-12-05');
    await user.click(within(dialog).getByLabelText('Émettre la facture'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ date: '2026-11-15', dueDate: '2026-12-05' });
  });

  it('shows no due-date hint, and asks for no settings, to a role that cannot read them', async () => {
    const { user, dialog } = await openForm({ perms: { clients: ['read'], ventes: ['read', 'create', 'update'] } });
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-11-15');
    expect(within(dialog).queryByText(/Par défaut/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Échéance')).not.toHaveAccessibleDescription();
    expect(calls.some((c) => c.url === '/api/settings')).toBe(false);
  });

  it('edits a draft after loading it, sending only what changed', async () => {
    mountList(ventes);
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(rowOf('Aliment ponte').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Ventes' });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité ligne 1')).toHaveValue(100));
    expect(within(dialog).queryByLabelText('Émettre la facture')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);

    await user.click(rowOf('Aliment ponte').getByRole('button', { name: 'Modifier' }));
    const again = await screen.findByRole('dialog', { name: 'Modifier — Ventes' });
    await waitFor(() => expect(within(again).getByLabelText('Quantité ligne 1')).toHaveValue(100));
    await user.type(within(again).getByLabelText('Échéance'), '2026-12-01');
    await user.click(within(again).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'PATCH', url: '/api/sales/i5', body: { dueDate: '2026-12-01' } });
  });
});

describe('row actions by status and permission', () => {
  const has = (ref: string, name: string) => rowOf(ref).queryByRole('button', { name }) !== null;
  const matrix = (names: string[], refs: string[]) => Object.fromEntries(refs.map((r) => [r, names.filter((n) => has(r, n))]));

  it('gives the commercial Émettre on a draft and Encaisser on what is due, never Avoir, Annuler or Rembourser', async () => {
    mountList(ventes);
    await screen.findByText('FA-0301');
    expect(matrix(['Émettre', 'Encaisser', 'Avoir', 'Rembourser', 'Annuler'], ['FA-0309', 'FA-0310', 'FA-0311', 'FA-0312', 'FA-0313'])).toEqual({
      'FA-0309': ['Encaisser'], 'FA-0310': [], 'FA-0311': ['Encaisser'], 'FA-0312': ['Rembourser'], 'FA-0313': [],
    });
    expect(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Émettre' })).toBeInTheDocument();
  });

  it('gives the accountant Encaisser, Avoir, Rembourser and Annuler by status, no Émettre on nothing but drafts, and no Ajouter', async () => {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0301');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(matrix(['Émettre', 'Encaisser', 'Avoir', 'Rembourser', 'Annuler'], ['FA-0309', 'FA-0310', 'FA-0311', 'FA-0312', 'FA-0313'])).toEqual({
      // Annuler only an issued invoice with no payment and no credit note.
      'FA-0309': ['Encaisser', 'Avoir'], 'FA-0310': ['Avoir'], 'FA-0311': ['Encaisser', 'Avoir', 'Annuler'], 'FA-0312': ['Avoir', 'Rembourser'], 'FA-0313': [],
    });
    expect(within(screen.getByText('Aliment ponte').closest('tr')!).queryByRole('button', { name: 'Avoir' })).not.toBeInTheDocument();
    expect(within(screen.getByText('Aliment ponte').closest('tr')!).getByRole('button', { name: 'Émettre' })).toBeInTheDocument();
  });

  it('gives the owner (read, validate) the credit note and the cancellation but no payment, no issue', async () => {
    mountList(ventes, { perms: PROPRIETAIRE });
    await screen.findByText('FA-0301');
    expect(matrix(['Émettre', 'Encaisser', 'Avoir', 'Rembourser', 'Annuler'], ['FA-0309', 'FA-0311'])).toEqual({ 'FA-0309': ['Avoir'], 'FA-0311': ['Avoir', 'Annuler'] });
  });

  it('locks edit and delete of an issued invoice with the reason, and leaves a draft open', async () => {
    mountList(ventes);
    await screen.findByText('FA-0301');
    for (const ref of ['FA-0309', 'FA-0310', 'FA-0313']) {
      expect(rowOf(ref).getByRole('button', { name: 'Modifier' })).toHaveAttribute('aria-disabled', 'true');
      expect(rowOf(ref).getByRole('button', { name: 'Supprimer' })).toHaveAttribute('title', 'Enregistrement verrouillé');
    }
    const draft = within(screen.getByText('Aliment ponte').closest('tr')!);
    expect(draft.getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    expect(draft.getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute('aria-disabled');
  });

  it('is read-only under all farms', async () => {
    mountList(ventes, { farm: 'all' });
    await screen.findByText('FA-0301');
    expect(screen.queryByRole('button', { name: /Ajouter|Émettre|Encaisser|Avoir|Rembourser|Annuler|Modifier|Supprimer/ })).not.toBeInTheDocument();
  });
});

describe('issue', () => {
  const openIssue = async (opts?: Parameters<typeof mount>[1]) => {
    mountList(ventes, opts);
    await screen.findByText('Aliment ponte');
    const user = userEvent.setup();
    await user.click(within(screen.getByText('Aliment ponte', { selector: 'td' }).closest('tr')!).getByRole('button', { name: 'Émettre' }));
    return { user, dialog: await screen.findByRole('dialog') };
  };

  it('confirms with what it will decrement, then posts the issue with no payment', async () => {
    const { user, dialog } = await openIssue();
    expect(flat(dialog.textContent)).toContain('Émettre Restaurant Le Palmier — 32 000 FCFA ? Les animaux, œufs et articles vendus seront sortis des lots et du stock.');
    expect(within(dialog).getByLabelText('Paiement comptant')).not.toBeChecked();
    expect(within(dialog).queryByLabelText('Montant (FCFA)')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Émettre' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', url: '/api/sales/i5/issue', body: {} });
  });

  it('lets an accountant issue with an optional cash payment (amount prefilled with the total, method, reference)', async () => {
    const { user, dialog } = await openIssue({ perms: COMPTABLE });
    await user.click(within(dialog).getByLabelText('Paiement comptant'));
    expect(within(dialog).getByLabelText('Montant (FCFA)')).toHaveValue(32000);
    expect(within(dialog).getByLabelText('Mode de paiement')).toHaveValue('ESPECES');
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '12000');
    await user.selectOptions(within(dialog).getByLabelText('Mode de paiement'), 'Mobile money');
    await user.type(within(dialog).getByLabelText('Référence'), 'MM-7');
    await user.click(within(dialog).getByRole('button', { name: 'Émettre' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/sales/i5/issue', body: { payment: { amount: 12000, method: 'MOBILE_MONEY', reference: 'MM-7' } },
    });
  });

  it('refuses a cash payment above the total before posting', async () => {
    const { user, dialog } = await openIssue();
    await user.click(within(dialog).getByLabelText('Paiement comptant'));
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '32001');
    await user.click(within(dialog).getByRole('button', { name: 'Émettre' }));
    expect(await within(dialog).findByText('Le montant dépasse le reste dû')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it.each([
    [400, 'Effectif insuffisant'],
    [400, 'Œufs disponibles insuffisants pour LP-2026-03 (4 710 disponibles)'],
    [400, 'Stock insuffisant pour Aliment ponte'],
    [409, 'Un inventaire validé le 2026-11-01 verrouille les mouvements antérieurs de Aliment ponte'],
  ])("shows the API's %i message: %s", async (status, message) => {
    failWith = { url: /\/issue$/, status, message };
    const { user, dialog } = await openIssue();
    await user.click(within(dialog).getByRole('button', { name: 'Émettre' }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });
});

describe('payment', () => {
  const openPay = async () => {
    mountList(ventes);
    await screen.findByText('FA-0309');
    const user = userEvent.setup();
    await user.click(rowOf('FA-0309').getByRole('button', { name: 'Encaisser' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Encaisser FA-0309' }) };
  };

  it('prefills the amount with the due, offers the four methods and posts the payment', async () => {
    const { user, dialog } = await openPay();
    expect(within(dialog).getByLabelText('Montant (FCFA)')).toHaveValue(400000);
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    expect(within(dialog).getByLabelText('Mode de paiement')).toHaveValue('ESPECES');
    await user.selectOptions(within(dialog).getByLabelText('Mode de paiement'), 'Virement');
    await user.type(within(dialog).getByLabelText('Référence'), 'VIR-12');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/sales/i2/payments', body: { date: todayIso(), amount: 400000, method: 'VIREMENT', reference: 'VIR-12' },
    });
  });

  it('refuses an amount above the due before posting', async () => {
    const { user, dialog } = await openPay();
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '400001');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le montant dépasse le reste dû')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("shows the API's refusal", async () => {
    failWith = { url: /\/payments$/, status: 400, message: 'La date du paiement ne peut pas précéder la facture' };
    const { user, dialog } = await openPay();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('La date du paiement ne peut pas précéder la facture')).toBeInTheDocument();
  });
});

describe('credit note', () => {
  const openCredit = async () => {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0310');
    const user = userEvent.setup();
    await user.click(rowOf('FA-0310').getByRole('button', { name: 'Avoir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Avoir FA-0310' });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité à créditer ligne 1')).toBeInTheDocument());
    return { user, dialog };
  };

  it('shows the invoice lines with what is still creditable, a computed amount, and posts the credit note with the return', async () => {
    const { user, dialog } = await openCredit();
    expect(within(dialog).getByText('Poulets de chair')).toBeInTheDocument();
    expect(within(dialog).getByText('270')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '30');
    expect(flat(within(dialog).getByTestId('amount-1').textContent)).toContain('105 000 FCFA');
    await user.type(within(dialog).getByLabelText('Motif'), 'Poulets non conformes');
    await user.click(within(dialog).getByLabelText('Retour des marchandises'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST',
      url: '/api/sales/i1/credit-notes',
      body: { date: todayIso(), reason: 'Poulets non conformes', withReturn: true, lines: [{ lineId: 'ln1', quantity: 30 }] },
    });
  });

  it('refuses a quantity above the creditable one before posting', async () => {
    const { user, dialog } = await openCredit();
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '271');
    await user.type(within(dialog).getByLabelText('Motif'), 'Erreur');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('La quantité dépasse la quantité restant à créditer (270)')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('needs a reason and at least one quantity', async () => {
    const { user, dialog } = await openCredit();
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/« Motif » est requis/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Motif'), 'Erreur');
    await user.clear(within(dialog).getByLabelText('Quantité à créditer ligne 1'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Indiquez au moins une quantité à créditer')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("shows the API's refusal of a return", async () => {
    failWith = { url: /credit-notes$/, status: 409, message: 'Ce lot est clôturé' };
    const { user, dialog } = await openCredit();
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '5');
    await user.type(within(dialog).getByLabelText('Motif'), 'Erreur');
    await user.click(within(dialog).getByLabelText('Retour des marchandises'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Ce lot est clôturé')).toBeInTheDocument();
    expect(writes()[0].body).toMatchObject({ withReturn: true });
  });
});

describe('cancel and refund', () => {
  it('cancels an issued invoice with a required reason', async () => {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0311');
    const user = userEvent.setup();
    await user.click(rowOf('FA-0311').getByRole('button', { name: 'Annuler' }));
    const dialog = await screen.findByRole('dialog', { name: 'Annuler FA-0311' });
    await user.click(within(dialog).getByRole('button', { name: "Confirmer l'annulation" }));
    expect(await within(dialog).findByText(/« Motif » est requis/)).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.type(within(dialog).getByLabelText('Motif'), 'Erreur de client');
    await user.click(within(dialog).getByRole('button', { name: "Confirmer l'annulation" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: 'POST', url: '/api/sales/i6/cancel', body: { reason: 'Erreur de client' } });
  });

  it('shows the API refusal of a cancellation (closed lot)', async () => {
    failWith = { url: /\/cancel$/, status: 409, message: 'Ce lot est clôturé' };
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0311');
    const user = userEvent.setup();
    await user.click(rowOf('FA-0311').getByRole('button', { name: 'Annuler' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Motif'), 'Erreur');
    await user.click(within(dialog).getByRole('button', { name: "Confirmer l'annulation" }));
    expect(await within(dialog).findByText('Ce lot est clôturé')).toBeInTheDocument();
  });

  it('refunds what is owed back: prefilled, capped, sent as a REMBOURSEMENT', async () => {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0312');
    const user = userEvent.setup();
    await user.click(rowOf('FA-0312').getByRole('button', { name: 'Rembourser' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rembourser FA-0312' });
    expect(within(dialog).getByLabelText('Montant (FCFA)')).toHaveValue(105000);
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '105001');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le montant dépasse le montant à rembourser')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '105000');
    await user.selectOptions(within(dialog).getByLabelText('Mode de paiement'), 'Mobile money');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: 'POST', url: '/api/sales/i7/payments', body: { date: todayIso(), amount: 105000, method: 'MOBILE_MONEY', kind: 'REMBOURSEMENT' },
    });
  });
});

describe('avoirs tab', () => {
  async function openTab() {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0301');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Avoirs' }));
    await screen.findByText('AV-0001');
    return user;
  }

  it('lists the credit notes with the reference columns, and offers neither Ajouter nor edit nor delete', async () => {
    await openTab();
    for (const h of ['DATE', 'N° AVOIR', 'FACTURE', 'CLIENT', 'MOTIF', 'RETOUR', 'MONTANT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('AV-0001').closest('tr'))).toContain('2026-11-02 AV-0001 FA-0310 Restaurant Le Palmier Poulets non conformes Oui 105 000 FCFA');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier|Supprimer/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/credit-notes'))).toBe(true);
  });

  it('prints a credit note: the sheet carries the legal block, the client, the lines and the API total', async () => {
    const user = await openTab();
    await user.click(rowOf('AV-0001').getByRole('button', { name: 'Imprimer' }));
    const sheet = await screen.findByRole('region', { name: 'Avoir' });
    expect(await within(sheet).findByText('Ferme du Golfe SARL')).toBeInTheDocument();
    expect(within(sheet).getByText('NIF : 1001234567 · RCCM : TG-LOM-2020-B-1234')).toBeInTheDocument();
    expect(within(sheet).getByText('Référence : AV-0001')).toBeInTheDocument();
    expect(within(sheet).getByText('Facture : FA-0310')).toBeInTheDocument();
    expect(within(sheet).getByText('Restaurant Le Palmier')).toBeInTheDocument();
    expect(within(sheet).getByText('Poulets de chair')).toBeInTheDocument();
    expect(flat(within(sheet).getByText(/^Total :/).textContent)).toBe('Total : 105 000 FCFA');
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
  });

  it('is available to a read-only role (printing is a read)', async () => {
    mountList(ventes, { perms: { ventes: ['read'] } });
    await screen.findByText('FA-0301');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Avoirs' }));
    await screen.findByText('AV-0001');
    expect(rowOf('AV-0001').getByRole('button', { name: 'Imprimer' })).toBeInTheDocument();
  });
});

describe('invoice detail', () => {
  it('shows the number, the client, the status pill, the four amounts from the API and the lines tab', async () => {
    mount(<InvoiceDetail id="i2" />);
    expect(await screen.findByRole('heading', { name: 'FA-0309' })).toBeInTheDocument();
    expect(screen.getByText('Marché Hédzranawoé — Mme Afi')).toBeInTheDocument();
    expect(screen.getByText('Partielle', { selector: 'span' }).getAttribute('data-tone')).toBe('warning');
    for (const [label, value] of [['Total', '1 000 000 FCFA'], ['Payé', '600 000 FCFA'], ['Avoirs', '0 FCFA'], ['Reste dû', '400 000 FCFA']]) {
      expect(flat(screen.getByText(label, { selector: 'p' }).nextElementSibling!.textContent)).toBe(value);
    }
    for (const h of ['TYPE', 'DÉSIGNATION', 'SOURCE', 'QUANTITÉ', 'PRIX UNITAIRE', 'TOTAL', 'CRÉDITÉ']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(within(screen.getByRole('tabpanel')).getByText('Œufs (plateau)').closest('tr'))).toBe('Œufs Œufs (plateau) LP-2026-03 400 plateau 2 500 FCFA 1 000 000 FCFA 0');
  });

  it('shows Brouillon as the title of a draft, with Émettre and no print buttons', async () => {
    mount(<InvoiceDetail id="i5" />);
    expect(await screen.findByRole('heading', { name: 'Brouillon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Émettre' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimer la facture' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bon de livraison' })).not.toBeInTheDocument();
  });

  it('offers the same actions as the list row, by permission, and none under all farms', async () => {
    mount(<InvoiceDetail id="i2" />);
    await screen.findByRole('heading', { name: 'FA-0309' });
    expect(screen.getByRole('button', { name: 'Encaisser' })).toBeInTheDocument();
    for (const name of ['Avoir', 'Annuler', 'Rembourser', 'Émettre']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    cleanup();
    mount(<InvoiceDetail id="i2" />, { perms: COMPTABLE });
    await screen.findByRole('heading', { name: 'FA-0309' });
    expect(screen.getByRole('button', { name: 'Avoir' })).toBeInTheDocument();
    cleanup();
    mount(<InvoiceDetail id="i2" />, { perms: COMPTABLE, farm: 'all' });
    await screen.findByRole('heading', { name: 'FA-0309' });
    for (const name of ['Encaisser', 'Avoir']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimer la facture' })).toBeInTheDocument();
  });

  it('shows the cancellation reason of a cancelled invoice and no print button', async () => {
    mount(<InvoiceDetail id="i8" />);
    expect(await screen.findByText("Motif de l'annulation : Erreur de client")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimer la facture' })).not.toBeInTheDocument();
  });

  it('prints the invoice: legal block, client block, lines with the API amounts and the API total, no tax line', async () => {
    mount(<InvoiceDetail id="i9" />);
    await screen.findByRole('heading', { name: 'FA-0320' });
    expect(screen.queryByRole('region', { name: 'Facture' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Imprimer la facture' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    const sheet = await screen.findByRole('region', { name: 'Facture' });
    expect(await within(sheet).findByText('Ferme du Golfe SARL')).toBeInTheDocument();
    expect(within(sheet).getByText('Route de Kpalimé, Lomé')).toBeInTheDocument();
    expect(within(sheet).getByText('NIF : 1001234567 · RCCM : TG-LOM-2020-B-1234')).toBeInTheDocument();
    expect(within(sheet).getByText('Référence : FA-0320')).toBeInTheDocument();
    expect(within(sheet).getByText('Restaurant Le Palmier')).toBeInTheDocument();
    expect(within(sheet).getByText('Rue des Palmiers, Lomé')).toBeInTheDocument();
    expect(within(sheet).getAllByText(/^250\sFCFA$/)).toHaveLength(1);
    expect(within(sheet).queryByText(/^200\sFCFA$/)).not.toBeInTheDocument();
    expect(flat(within(sheet).getByText(/^Total :/).textContent)).toBe('Total : 250 FCFA');
    expect(within(sheet).queryByText(/TVA|taxe/i)).not.toBeInTheDocument();
  });

  it('prints the delivery note with quantities and no prices', async () => {
    mount(<InvoiceDetail id="i2" />);
    await screen.findByRole('heading', { name: 'FA-0309' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bon de livraison' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    const sheet = await screen.findByRole('region', { name: 'Bon de livraison' });
    expect(within(sheet).getByText('Œufs (plateau)')).toBeInTheDocument();
    expect(within(sheet).getByText('400 plateau')).toBeInTheDocument();
    expect(within(sheet).queryByText('PRIX UNITAIRE')).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/FCFA/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/^Total/)).not.toBeInTheDocument();
    // Goods only: the prestation line stays on the invoice.
    expect(within(sheet).queryByText('Livraison à domicile')).not.toBeInTheDocument();
  });

  it('lists the payments, deletes one after a confirmation and prints its receipt', async () => {
    mount(<InvoiceDetail id="i2" />);
    await screen.findByRole('heading', { name: 'FA-0309' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Paiements' }));
    for (const h of ['N° REÇU', 'DATE', 'MODE', 'MONTANT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('RC-0001').closest('tr'))).toBe('RC-0001 2026-10-20 Espèces 600 000 FCFA');

    await user.click(rowOf('RC-0001').getByRole('button', { name: 'Reçu' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    const sheet = await screen.findByRole('region', { name: 'Reçu' });
    expect(within(sheet).getByText('Référence : RC-0001')).toBeInTheDocument();
    expect(within(sheet).getByText('Facture : FA-0309')).toBeInTheDocument();
    expect(flat(within(sheet).getByText(/^Montant reçu/).textContent)).toBe('Montant reçu : 600 000 FCFA');
    expect(within(sheet).getByText('Mode de paiement : Espèces')).toBeInTheDocument();

    await user.click(rowOf('RC-0001').getByRole('button', { name: 'Supprimer' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/sales/i2/payments/p1' });
  });

  it("shows the API's refusal of a payment deletion, and offers no delete without update", async () => {
    failWith = { url: /payments\/p1$/, status: 409, message: "Supprimez d'abord le remboursement" };
    mount(<InvoiceDetail id="i2" />);
    await screen.findByRole('heading', { name: 'FA-0309' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Paiements' }));
    await user.click(rowOf('RC-0001').getByRole('button', { name: 'Supprimer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText("Supprimez d'abord le remboursement")).toBeInTheDocument();
    cleanup();
    mount(<InvoiceDetail id="i2" />, { perms: PROPRIETAIRE });
    await screen.findByRole('heading', { name: 'FA-0309' });
    await user.click(screen.getByRole('tab', { name: 'Paiements' }));
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(rowOf('RC-0001').getByRole('button', { name: 'Reçu' })).toBeInTheDocument();
  });

  it('lists the credit notes of the invoice and the history', async () => {
    mount(<InvoiceDetail id="i1" />);
    await screen.findByRole('heading', { name: 'FA-0310' });
    expect(flat(screen.getByText('Avoirs', { selector: 'p' }).nextElementSibling!.textContent)).toBe('105 000 FCFA');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Avoirs' }));
    expect(cells(screen.getByText('AV-0001').closest('tr'))).toBe('2026-11-02 AV-0001 Poulets non conformes Oui 105 000 FCFA');
    await user.click(screen.getByRole('tab', { name: 'Historique' }));
    expect(screen.getByText('Émission')).toBeInTheDocument();
  });

  it('shows the not-found card for an unknown invoice', async () => {
    mount(<InvoiceDetail id="zz" />);
    expect(await screen.findByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
  });
});

describe('customer detail embeds the invoices', () => {
  const CustomerDetail = clients.detail!;

  it("lists this customer's invoices through the ventes list, read-only", async () => {
    mount(<CustomerDetail id="c2" />);
    expect(await screen.findByText('FA-0309')).toBeInTheDocument();
    expect(screen.queryByText('FA-0310')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/sales') && c.url.includes('customerId=c2'))).toBe(true);
    expect(screen.queryByRole('button', { name: /Ajouter|Encaisser|Avoir|Annuler|Modifier|Supprimer/ })).not.toBeInTheDocument();
  });

  it('says so when the role cannot read the invoices', async () => {
    mount(<CustomerDetail id="c2" />, { perms: { clients: ['read'] } });
    expect(await screen.findByText('Factures non accessibles avec votre rôle')).toBeInTheDocument();
  });
});

describe('role views', () => {
  it('registers the ventes module, with the Devis and Avoirs tabs', () => {
    expect(MODULES.ventes).toBe(ventes);
    expect(ventes.tabs?.map((t) => t.label)).toEqual(['Devis', 'Avoirs']);
    expect(avoirs.endpoint).toBe('/credit-notes');
  });

  it('gives the storekeeper no access', async () => {
    mount(<Routes><Route path="/m/:module" element={<ModuleRoute />} /></Routes>, { perms: { stocks: ['read'] }, route: '/m/ventes' });
    expect(await screen.findByText('Accès non autorisé')).toBeInTheDocument();
  });
});

describe('credit preview of a line already partly credited', () => {
  const openCredit = async (ref: string) => {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText(ref);
    const user = userEvent.setup();
    await user.click(rowOf(ref).getByRole('button', { name: 'Avoir' }));
    const dialog = await screen.findByRole('dialog', { name: `Avoir ${ref}` });
    await waitFor(() => expect(within(dialog).getByLabelText('Quantité à créditer ligne 1')).toBeInTheDocument());
    return { user, dialog };
  };

  it('previews the remaining amount (416.67, not 416.66 again) when the credit takes everything creditable', async () => {
    const { user, dialog } = await openCredit('FA-0314');
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '1.25');
    expect(flat(within(dialog).getByTestId('amount-1').textContent)).toContain('416.67 FCFA');
    expect(flat(within(dialog).getByText(/^Total :/).textContent)).toBe('Total : 416.67 FCFA');
  });

  it('previews the proportional amount of a smaller quantity', async () => {
    const { user, dialog } = await openCredit('FA-0314');
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '0.5');
    expect(flat(within(dialog).getByTestId('amount-1').textContent)).toContain('166.67 FCFA');
  });

  it('never previews more than what is left of the line', async () => {
    const { user, dialog } = await openCredit('FA-0316');
    await user.type(within(dialog).getByLabelText('Quantité à créditer ligne 1'), '2.8');
    expect(flat(within(dialog).getByTestId('amount-1').textContent)).toContain('250 FCFA');
    expect(flat(within(dialog).getByText(/^Total :/).textContent)).toBe('Total : 250 FCFA');
  });
});

describe('cancelling and the total-0 invoice', () => {
  it('offers Annuler on an invoice settled at issue with nothing paid and nothing credited (the gate is payment and credit note, not the status)', async () => {
    mountList(ventes, { perms: COMPTABLE });
    await screen.findByText('FA-0315');
    expect(rowOf('FA-0315').getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    expect(rowOf('FA-0310').queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
  });
});

describe('read-only roles', () => {
  it.each([['DIRECTEUR_FERME'], ['AUDITEUR']])('gives %s (read only) no action on any status, in the list or on the detail', async () => {
    const perms = { clients: ['read'], ventes: ['read'] };
    mountList(ventes, { perms });
    await screen.findByText('FA-0301');
    expect(screen.queryByRole('button', { name: /Ajouter|Émettre|Encaisser|Avoir|Rembourser|Annuler|Modifier|Supprimer/ })).not.toBeInTheDocument();
    cleanup();
    for (const id of ['i1', 'i2', 'i5', 'i7', 'i8']) {
      mount(<InvoiceDetail id={id} />, { perms });
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Lignes' })).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Émettre|Encaisser|Avoir|Rembourser|Annuler/ })).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('refetch after an action', () => {
  const listGets = () => calls.filter((c) => c.method === 'GET' && /^\/api\/sales\?/.test(c.url)).length;
  const detailGets = (id: string) => calls.filter((c) => c.method === 'GET' && c.url === `/api/sales/${id}`).length;

  it('reloads the list after a payment', async () => {
    mountList(ventes);
    await screen.findByText('FA-0309');
    const before = listGets();
    const user = userEvent.setup();
    await user.click(rowOf('FA-0309').getByRole('button', { name: 'Encaisser' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(listGets()).toBeGreaterThan(before));
  });

  it('reloads the detail after an action on it', async () => {
    mount(<InvoiceDetail id="i2" />);
    await screen.findByRole('heading', { name: 'FA-0309' });
    const before = detailGets('i2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Encaisser' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() => expect(detailGets('i2')).toBeGreaterThan(before));
  });

  it('reloads the detail after a payment deletion', async () => {
    mount(<InvoiceDetail id="i2" />);
    await screen.findByRole('heading', { name: 'FA-0309' });
    const before = detailGets('i2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Paiements' }));
    await user.click(rowOf('RC-0001').getByRole('button', { name: 'Supprimer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(detailGets('i2')).toBeGreaterThan(before));
  });
});
