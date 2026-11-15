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
import { achats } from './achats';
import { fournisseurs } from './fournisseurs';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const ALL = ['read', 'create', 'update', 'delete', 'validate'];
/** Spaces of every kind (the formatters use narrow and no-break ones) as one plain space. */
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
/** The cells of a row, one space apart. */
const cells = (tr: Element | null) => flat(Array.from(tr!.querySelectorAll('td')).map((c) => c.textContent).join(' '));

const SUPPLIERS = [
  { id: 'sup1', name: 'Agro Provende SA', products: 'Aliments volaille & porc', phone: '+228 90 11 22 33', email: 'ventes@agroprovende.tg', balance: 850000 },
  { id: 'sup2', name: 'VetoPlus', address: 'Rue des Vaccins', active: true, products: 'Vaccins, médicaments', phone: '+228 91 44 55 66', email: 'contact@vetoplus.tg', balance: 120000 },
  { id: 'sup3', name: 'Couvoir du Golfe', products: "Poussins d'un jour", phone: '+228 92 77 88 99', email: 'info@couvoirgolfe.tg', balance: 0 },
];

// The detail carries these beside the list row (`requestNumber` stays after the order, `orderNumber` is the BC).
const base = { supplierId: 'sup1', orderNumber: null, note: null, requestNumber: 'DA-0001', receivedDate: null, cancelReason: null };
const LIST = [
  { id: 'p1', date: '2026-10-20', reference: 'BC-0142', supplierName: 'Agro Provende SA', article: 'Aliment ponte', quantity: 3000, status: 'COMMANDEE', amount: 930000, paid: 0, remaining: 930000 },
  { id: 'p2', date: '2026-10-15', reference: 'BC-0141', supplierName: 'VetoPlus', article: 'Vaccin Gumboro', quantity: 10, status: 'RECUE', amount: 120000, paid: 0, remaining: 120000 },
  { id: 'p3', date: '2026-10-22', reference: 'DA-0089', supplierName: 'Agro Provende SA', article: 'Aliment engraissement porc', quantity: 4000, status: 'DEMANDE', amount: 1120000, paid: 0, remaining: 1120000 },
];
const COUNTS = { DEMANDE: 1, VALIDEE: 0, COMMANDEE: 1, RECUE: 1, PAYEE: 0, ANNULEE: 0 };

const line = (o: object) => ({ receivedQuantity: null, lotNumber: null, expiryDate: null, unit: 'kg', ...o });
const DETAILS: Record<string, unknown> = {
  p1: {
    ...LIST[0], ...base,
    supplierPhone: '+228 90 11 22 33', supplierAddress: 'Zone industrielle, Lomé', orderedAt: '2026-10-21T09:00:00.000Z',
    lines: [line({ itemId: 's2', itemName: 'Aliment ponte', quantity: 3000, unitPrice: 310 })],
    payments: [],
    history: [
      { step: 'DEMANDE', at: '2026-10-18T09:00:00.000Z', by: 'Koffi' },
      { step: 'VALIDEE', at: '2026-10-19T09:00:00.000Z', by: 'Awa' },
      { step: 'COMMANDEE', at: '2026-10-20T09:00:00.000Z', by: 'Awa' },
    ],
  },
  p2: {
    ...LIST[1], ...base, supplierId: 'sup2', paid: 50000, remaining: 70000,
    lines: [line({ itemId: 's4', itemName: 'Vaccin Gumboro', unit: 'flacons', quantity: 10, unitPrice: 12000, receivedQuantity: 10, lotNumber: 'G-9', expiryDate: '2027-01-31' })],
    payments: [{ id: 'pay1', date: '2026-10-25', amount: 50000, method: 'VIREMENT', reference: 'VIR-1' }],
    history: [{ step: 'DEMANDE', at: '2026-10-10T09:00:00.000Z', by: 'Koffi' }, { step: 'RECUE', at: '2026-10-15T09:00:00.000Z', by: 'Yao' }],
  },
  p3: {
    ...LIST[2], ...base,
    lines: [line({ itemId: 's3', itemName: 'Aliment engraissement porc', quantity: 4000, unitPrice: 280 })],
    payments: [],
    history: [{ step: 'DEMANDE', at: '2026-10-22T09:00:00.000Z', by: 'Koffi' }],
  },
};

/** Rows of `GET /purchases`; a test may change them. */
let rows: unknown[] = LIST;
// Detail-only purchases: a request of a supplier since deactivated, and an order of three lines.
DETAILS.p4 = { ...(DETAILS.p3 as object), id: 'p4', supplierId: 'sup9', supplierName: 'Ancien fournisseur' };
DETAILS.p6 = {
  ...(DETAILS.p1 as object), id: 'p6', reference: 'BC-0150',
  lines: [
    line({ itemId: 's2', itemName: 'Aliment ponte', quantity: 3000, unitPrice: 310 }),
    line({ itemId: 's1', itemName: 'Aliment croissance chair', quantity: 500, unitPrice: 300 }),
    line({ itemId: 's4', itemName: 'Vaccin Gumboro', unit: 'flacons', quantity: 10, unitPrice: 12000 }),
  ],
};
// A purchase worth 0 is paid as soon as it is received; a cancelled one owes nothing and keeps its reason.
DETAILS.p7 = {
  ...(DETAILS.p2 as object), id: 'p7', reference: 'BC-0160', status: 'PAYEE', amount: 0, paid: 0, remaining: 0, payments: [],
  lines: [line({ itemId: 's4', itemName: 'Vaccin Gumboro', unit: 'flacons', quantity: 10, unitPrice: 0, receivedQuantity: 10 })],
};
DETAILS.p8 = {
  ...(DETAILS.p1 as object), id: 'p8', reference: 'BC-0161', status: 'ANNULEE', remaining: 0, cancelReason: 'Doublon de commande',
  history: [
    { step: 'DEMANDE', at: '2026-10-18T09:00:00.000Z', by: 'Koffi' },
    { step: 'ANNULEE', at: '2026-10-19T09:00:00.000Z', by: 'Awa', note: 'Doublon de commande' },
  ],
};
const VALIDEE = { id: 'p5', date: '2026-10-23', reference: 'DA-0090', supplierName: 'VetoPlus', article: 'Vaccin Gumboro', quantity: 5, status: 'VALIDEE', amount: 60000, paid: 0, remaining: 60000 };

const STOCK_ITEMS = [{ id: 's1', name: 'Aliment croissance chair' }, { id: 's2', name: 'Aliment ponte' }];
const SETTINGS = { legal: { name: 'Ferme du Golfe SARL', address: 'Route de Kpalimé, Lomé', nif: '1001234567', rccm: 'TG-LOM-2020-B-1234' } };

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

/** Set per test to make a write fail. */
let failWith: { url: RegExp; status: number; message: string } | null = null;

function mount(ui: React.ReactNode, { perms = ALL, farm, settings = true }: { perms?: string[]; farm?: string; settings?: boolean } = {}) {
  if (farm) localStorage.setItem('ap_farm', farm);
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (call.url === '/api/auth/me') {
      return json(200, {
        user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true,
        permissions: { achats: perms, fournisseurs: perms, ...(settings ? { parametres: ['read'] } : {}) },
      });
    }
    if (call.method !== 'GET') {
      if (failWith && failWith.url.test(call.url)) return json(failWith.status, { message: failWith.message });
      return json(201, { id: 'new1' });
    }
    const url = call.url;
    const detail = /^\/api\/purchases\/(\w+)(\?|$)/.exec(url);
    if (detail) return DETAILS[detail[1]] ? json(200, DETAILS[detail[1]]) : json(404, { message: 'Introuvable' });
    if (url.startsWith('/api/purchases')) return page(rows, { statusCounts: COUNTS });
    // `active=true` lists the active suppliers only (VetoPlus is inactive).
    if (url.startsWith('/api/suppliers')) return page(url.includes('active=true') ? SUPPLIERS.filter((x) => x.id !== 'sup2') : SUPPLIERS);
    if (url.startsWith('/api/stock-items')) return page(STOCK_ITEMS);
    if (url === '/api/settings') return json(200, SETTINGS);
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mountList = (config: ModuleConfig<any>, opts?: Parameters<typeof mount>[1]) =>
  mount(<Routes><Route path="*" element={<ModulePage config={config} />} /></Routes>, opts);
const Detail = achats.detail!;
const mountDetail = (id: string, opts?: Parameters<typeof mount>[1]) => mount(<Detail id={id} />, opts);
const rowOf = (text: string) => within(screen.getByText(text).closest('tr')!);

beforeEach(() => {
  calls.length = 0;
  failWith = null;
  rows = LIST;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('fournisseurs list', () => {
  it('renders the reference headers, tile, subtitle and rows with the balance in FCFA', async () => {
    mountList(fournisseurs);
    expect(await screen.findByText('VetoPlus')).toBeInTheDocument();
    for (const h of ['NOM', 'PRODUITS FOURNIS', 'TÉLÉPHONE', 'EMAIL', 'SOLDE']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('Fiches fournisseurs, produits et soldes.')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Total enregistrements', { selector: 'p' }).nextElementSibling).toHaveTextContent('3'));
    expect(cells(screen.getByText('Agro Provende SA').closest('tr'))).toContain(
      'Agro Provende SA Aliments volaille & porc +228 90 11 22 33 ventes@agroprovende.tg 850 000 FCFA',
    );
    expect(rowOf('Couvoir du Golfe').getByText(/^0\sFCFA$/)).toBeInTheDocument();
  });

  it('adds a supplier and shows the API refusal when deleting one that is used', async () => {
    mountList(fournisseurs);
    await screen.findByText('VetoPlus');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Fournisseurs' });
    await user.type(within(dialog).getByLabelText('Nom'), 'Avipharma');
    await user.type(within(dialog).getByLabelText('Téléphone'), '+228 93 00 00 00');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/suppliers', body: { name: 'Avipharma', phone: '+228 93 00 00 00' } });

    failWith = { url: /\/api\/suppliers\/sup2$/, status: 409, message: 'Fournisseur utilisé par des achats' };
    await user.click(rowOf('VetoPlus').getByRole('button', { name: 'Supprimer' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirmer la suppression' });
    await user.click(within(confirm).getByRole('button', { name: 'Supprimer' }));
    expect(await within(confirm).findByText('Fournisseur utilisé par des achats')).toBeInTheDocument();
  });

  it('is master data: no Ajouter without update', async () => {
    mountList(fournisseurs, { perms: ['read', 'create'] });
    await screen.findByText('VetoPlus');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });

  it('stays writable under all farms, being organisation data', async () => {
    mountList(fournisseurs, { farm: 'all' });
    await screen.findByText('VetoPlus');
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
    expect(rowOf('VetoPlus').getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  });

  it('edits the address and the active flag, sending only what changed, and checks the email', async () => {
    mountList(fournisseurs);
    await screen.findByText('VetoPlus');
    const user = userEvent.setup();
    await user.click(rowOf('VetoPlus').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Fournisseurs' });
    expect(within(dialog).getByLabelText('Adresse')).toHaveValue('Rue des Vaccins');
    expect(within(dialog).getByLabelText('Actif')).toBeChecked();
    await user.clear(within(dialog).getByLabelText('Email'));
    await user.type(within(dialog).getByLabelText('Email'), 'pas-un-email');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("L'adresse email n'est pas valide")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText('Email'));
    await user.type(within(dialog).getByLabelText('Email'), 'vente@vetoplus.tg');
    await user.click(within(dialog).getByLabelText('Actif'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/suppliers/sup2', body: { email: 'vente@vetoplus.tg', active: false } });
  });
});

describe('achats list', () => {
  it('renders the reference headers, tiles, subtitle and rows with status pills', async () => {
    mountList(achats);
    expect(await screen.findByText('BC-0142')).toBeInTheDocument();
    for (const h of ['DATE', 'RÉFÉRENCE', 'FOURNISSEUR', 'ARTICLE', 'QUANTITÉ', 'STATUT', 'MONTANT']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText('Demandes, validation, bons de commande et réception.')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Total enregistrements', { selector: 'p' }).nextElementSibling).toHaveTextContent('3'));
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(tile('Demande')).toHaveTextContent('1');
    expect(tile('Validée')).toHaveTextContent('0');
    expect(tile('Commandée')).toHaveTextContent('1');

    expect(cells(screen.getByText('BC-0142').closest('tr'))).toContain(
      '2026-10-20 BC-0142 Agro Provende SA Aliment ponte 3 000 Commandée 930 000 FCFA',
    );
    expect(cells(screen.getByText('DA-0089').closest('tr'))).toContain('Demande 1 120 000 FCFA');
    expect(rowOf('BC-0141').getByText('Reçue')).toBeInTheDocument();
    const statuses = screen.getByRole('combobox', { name: 'Tous les statuts' });
    expect(within(statuses).getAllByRole('option').map((o) => o.textContent)).toEqual(
      ['Tous les statuts', 'Demande', 'Validée', 'Commandée', 'Reçue', 'Payée', 'Annulée'],
    );
  });

  it('offers each transition only on the right status and to the right role', async () => {
    mountList(achats);
    await screen.findByText('BC-0142');
    const names = (ref: string) => rowOf(ref).queryAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names('DA-0089')).toEqual(['Valider', 'Annuler', 'Modifier', 'Supprimer']);
    expect(names('BC-0142')).toEqual(['Réceptionner', 'Annuler', 'Modifier', 'Supprimer']);
    expect(names('BC-0141')).toEqual(['Payer', 'Modifier', 'Supprimer']);
  });

  const ROLE_ROWS = ['DA-0089', 'DA-0090', 'BC-0142', 'BC-0141'];
  it.each([
    ['DIRECTEUR_FERME', ALL, [
      ['Valider', 'Annuler', 'Modifier', 'Supprimer'], ['Commander', 'Annuler', 'Modifier', 'Supprimer'],
      ['Réceptionner', 'Annuler', 'Modifier', 'Supprimer'], ['Payer', 'Modifier', 'Supprimer'],
    ], true],
    ['RESP_STOCK', ['read', 'create', 'update'], [
      ['Modifier', 'Supprimer'], ['Modifier', 'Supprimer'], ['Réceptionner', 'Modifier', 'Supprimer'], ['Modifier', 'Supprimer'],
    ], true],
    ['MAGASINIER', ['read', 'update'], [[], [], ['Réceptionner'], []], false],
    ['PROPRIETAIRE', ['read', 'validate'], [['Valider', 'Annuler'], ['Commander', 'Annuler'], ['Annuler'], ['Payer']], false],
    ['COMPTABLE', ['read'], [[], [], [], []], false],
  ])('shows %s exactly its actions on each status', async (_role, perms, expected, canAdd) => {
    rows = [LIST[2], VALIDEE, LIST[0], LIST[1]];
    mountList(achats, { perms: perms as string[] });
    await screen.findByText('BC-0142');
    ROLE_ROWS.forEach((ref, i) => {
      expect(rowOf(ref).queryAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(expected[i]);
    });
    expect(!!screen.queryByRole('button', { name: 'Ajouter' })).toBe(canAdd);
  });

  it('validates a request after a confirmation', async () => {
    mountList(achats);
    await screen.findByText('DA-0089');
    const user = userEvent.setup();
    await user.click(rowOf('DA-0089').getByRole('button', { name: 'Valider' }));
    const dialog = await screen.findByRole('dialog', { name: 'Valider la demande DA-0089' });
    await user.click(within(dialog).getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/purchases/p3/validate' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('receives an order: lines prefilled with the ordered quantity, posted to /receive', async () => {
    mountList(achats);
    await screen.findByText('BC-0142');
    const user = userEvent.setup();
    await user.click(rowOf('BC-0142').getByRole('button', { name: 'Réceptionner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Réceptionner — BC-0142' });
    const received = await within(dialog).findByLabelText('Quantité reçue ligne 1');
    expect(received).toHaveValue(3000);
    expect(within(dialog).getByText('Aliment ponte')).toBeInTheDocument();
    // The rows are the order's: no add or remove.
    expect(within(dialog).queryByRole('button', { name: 'Ajouter une ligne' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Retirer la ligne 1' })).not.toBeInTheDocument();
    await user.clear(received);
    await user.type(received, '2800');
    await user.type(within(dialog).getByLabelText('N° de lot ligne 1'), 'L-77');
    await user.type(within(dialog).getByLabelText('Péremption ligne 1'), '2027-03-01');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/purchases/p1/receive',
      body: { date: todayIso(), lines: [{ itemId: 's2', receivedQuantity: 2800, lotNumber: 'L-77', expiryDate: '2027-03-01' }] },
    });
  });

  it('receives several lines: a partial quantity, a zero and an untouched one', async () => {
    rows = [{ ...LIST[0], id: 'p6', reference: 'BC-0150' }];
    mountList(achats);
    await screen.findByText('BC-0150');
    const user = userEvent.setup();
    await user.click(rowOf('BC-0150').getByRole('button', { name: 'Réceptionner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Réceptionner — BC-0150' });
    const first = await within(dialog).findByLabelText('Quantité reçue ligne 1');
    expect(within(dialog).getByLabelText('Quantité reçue ligne 3')).toHaveValue(10);
    await user.clear(first);
    await user.type(first, '2800');
    await user.clear(within(dialog).getByLabelText('Quantité reçue ligne 2'));
    await user.type(within(dialog).getByLabelText('Quantité reçue ligne 2'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      date: todayIso(),
      lines: [
        { itemId: 's2', receivedQuantity: 2800 },
        { itemId: 's1', receivedQuantity: 0 },
        { itemId: 's4', receivedQuantity: 10 },
      ],
    });
  });

  it('caps the received quantity at the ordered one, with the API message, before any request', async () => {
    mountList(achats);
    await screen.findByText('BC-0142');
    const user = userEvent.setup();
    await user.click(rowOf('BC-0142').getByRole('button', { name: 'Réceptionner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Réceptionner — BC-0142' });
    const received = await within(dialog).findByLabelText('Quantité reçue ligne 1');
    await user.clear(received);
    await user.type(received, '3001');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('La quantité reçue dépasse la quantité commandée')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    // Exactly the ordered quantity is allowed.
    await user.clear(received);
    await user.type(received, '3000');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
  });

  it('shows the API refusal in the receive and the cancel dialogs', async () => {
    mountList(achats);
    await screen.findByText('BC-0142');
    const user = userEvent.setup();
    failWith = { url: /\/receive$/, status: 409, message: 'Achat déjà réceptionné' };
    await user.click(rowOf('BC-0142').getByRole('button', { name: 'Réceptionner' }));
    let dialog = await screen.findByRole('dialog', { name: 'Réceptionner — BC-0142' });
    await within(dialog).findByLabelText('Quantité reçue ligne 1');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Achat déjà réceptionné')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));

    failWith = { url: /\/cancel$/, status: 409, message: 'Achat déjà reçu' };
    await user.click(rowOf('BC-0142').getByRole('button', { name: 'Annuler' }));
    dialog = await screen.findByRole('dialog', { name: 'Annuler — BC-0142' });
    await user.type(within(dialog).getByLabelText('Motif'), 'Erreur');
    await user.click(within(dialog).getByRole('button', { name: "Confirmer l'annulation" }));
    expect(await within(dialog).findByText('Achat déjà reçu')).toBeInTheDocument();
  });

  it('refuses a payment above the remaining before sending, shows the API refusal, then pays', async () => {
    mountList(achats);
    await screen.findByText('BC-0141');
    const user = userEvent.setup();
    await user.click(rowOf('BC-0141').getByRole('button', { name: 'Payer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Payer — BC-0141' });
    expect(within(dialog).getByLabelText('Montant (FCFA)')).toHaveValue(120000);
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '999999');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le montant dépasse le reste à payer')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);

    failWith = { url: /\/payments$/, status: 409, message: 'Achat déjà payé' };
    await user.clear(within(dialog).getByLabelText('Montant (FCFA)'));
    await user.type(within(dialog).getByLabelText('Montant (FCFA)'), '120000');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Achat déjà payé')).toBeInTheDocument();
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/purchases/p2/payments', body: { date: todayIso(), amount: 120000, method: 'ESPECES' },
    });

    failWith = null;
    await user.selectOptions(within(dialog).getByLabelText('Mode de paiement'), 'Mobile money');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()[1].body).toMatchObject({ amount: 120000, method: 'MOBILE_MONEY' });
  });

  it('asks for a reason to cancel', async () => {
    mountList(achats);
    await screen.findByText('DA-0089');
    const user = userEvent.setup();
    await user.click(rowOf('DA-0089').getByRole('button', { name: 'Annuler' }));
    const dialog = await screen.findByRole('dialog', { name: 'Annuler — DA-0089' });
    await user.type(within(dialog).getByLabelText('Motif'), 'Doublon');
    await user.click(within(dialog).getByRole('button', { name: "Confirmer l'annulation" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/purchases/p3/cancel', body: { reason: 'Doublon' } });
  });

  it('locks edit and delete outside Demande with the reason, and keeps them on a Demande', async () => {
    mountList(achats);
    await screen.findByText('BC-0141');
    for (const ref of ['BC-0141', 'BC-0142']) {
      for (const name of ['Modifier', 'Supprimer']) {
        const button = rowOf(ref).getByRole('button', { name });
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('title', 'Enregistrement verrouillé');
      }
    }
    expect(rowOf('DA-0089').getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
    expect(rowOf('DA-0089').getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute('aria-disabled');
  });

  it('creates a request with lines and a live total', async () => {
    mountList(achats);
    await screen.findByText('BC-0142');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Achats' });
    await within(dialog).findByRole('option', { name: 'Agro Provende SA' });
    // Only active suppliers are offered.
    expect(within(dialog).queryByRole('option', { name: 'VetoPlus' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/suppliers') && c.url.includes('active=true'))).toBe(true);
    await user.selectOptions(within(dialog).getByLabelText('Fournisseur'), 'Agro Provende SA');
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    await within(dialog).findByRole('option', { name: 'Aliment ponte' });
    await user.selectOptions(within(dialog).getByLabelText('Article ligne 1'), 'Aliment croissance chair');
    await user.type(within(dialog).getByLabelText('Quantité ligne 1'), '10');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 1'), '300');
    expect(flat(within(dialog).getByText(/Total/).textContent)).toContain('3 000 FCFA');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      url: '/api/purchases',
      body: { supplierId: 'sup1', date: todayIso(), lines: [{ itemId: 's1', quantity: 10, unitPrice: 300 }] },
    });
  });

  it('totals the lines from rounded line amounts', async () => {
    mountList(achats);
    await screen.findByText('BC-0142');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Achats' });
    await within(dialog).findByRole('option', { name: 'Aliment ponte' });
    await user.selectOptions(within(dialog).getByLabelText('Article ligne 1'), 'Aliment ponte');
    await user.type(within(dialog).getByLabelText('Quantité ligne 1'), '3');
    await user.type(within(dialog).getByLabelText('Prix unitaire ligne 1'), '1.1');
    expect(flat(within(dialog).getByText(/Total/).textContent)).toBe('Total : 3.3 FCFA');
  });

  it('edits a request from its stored lines and sends only what changed', async () => {
    mountList(achats);
    await screen.findByText('DA-0089');
    const user = userEvent.setup();
    await user.click(rowOf('DA-0089').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Achats' });
    const quantity = await within(dialog).findByLabelText('Quantité ligne 1');
    expect(quantity).toHaveValue(4000);
    await user.clear(within(dialog).getByLabelText('Date'));
    await user.type(within(dialog).getByLabelText('Date'), '2026-10-23');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(expect.objectContaining({ method: 'PATCH', url: '/api/purchases/p3', body: { date: '2026-10-23' } }));
  });

  it('keeps the current supplier of an edited request in the choices even when inactive', async () => {
    const Form = achats.form!;
    mount(<Form row={{ ...LIST[2], id: 'p4' } as never} onSaved={() => undefined} onClose={() => undefined} />);
    const select = await screen.findByLabelText('Fournisseur');
    await within(select).findByRole('option', { name: 'Agro Provende SA' });
    expect(within(select).getByRole('option', { name: 'Ancien fournisseur' })).toBeInTheDocument();
    expect(select).toHaveValue('sup9');
    expect(within(select).queryByRole('option', { name: 'VetoPlus' })).not.toBeInTheDocument();
  });

  it('is read-only under all farms', async () => {
    mountList(achats, { farm: 'all' });
    await screen.findByText('BC-0142');
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réceptionner' })).not.toBeInTheDocument();
  });
});

describe('purchase detail', () => {
  it('shows the header figures, the lines and the actions of the status', async () => {
    mountDetail('p1');
    expect(await screen.findByRole('heading', { name: 'BC-0142' })).toBeInTheDocument();
    expect(screen.getByText('Agro Provende SA', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Commandée')).toBeInTheDocument();
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(flat(tile('Montant')!.textContent)).toBe('930 000 FCFA');
    expect(flat(tile('Payé')!.textContent)).toBe('0 FCFA');
    expect(flat(tile('Reste')!.textContent)).toBe('930 000 FCFA');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lignes', 'Paiements', 'Historique']);
    expect(cells(screen.getAllByText('Aliment ponte')[0].closest('tr'))).toContain('3 000 kg 310 FCFA');
    expect(screen.getByRole('button', { name: 'Réceptionner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument();
  });

  it('offers no payment on a purchase worth 0, paid at reception', async () => {
    mountDetail('p7');
    expect(await screen.findByRole('heading', { name: 'BC-0160' })).toBeInTheDocument();
    expect(screen.getByText('Payée')).toBeInTheDocument();
    expect(flat(screen.getByText('Reste', { selector: 'p' }).nextElementSibling!.textContent)).toBe('0 FCFA');
    expect(screen.queryByRole('button', { name: 'Payer' })).not.toBeInTheDocument();
  });

  it('shows the cancellation reason of a cancelled purchase, which owes nothing', async () => {
    mountDetail('p8');
    expect(await screen.findByRole('heading', { name: 'BC-0161' })).toBeInTheDocument();
    expect(screen.getByText("Motif de l'annulation : Doublon de commande")).toBeInTheDocument();
    expect(flat(screen.getByText('Reste', { selector: 'p' }).nextElementSibling!.textContent)).toBe('0 FCFA');
    for (const name of ['Réceptionner', 'Payer', 'Annuler', 'Valider']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('prints the request number beside the order number on the bon de commande', async () => {
    mountDetail('p1');
    const sheet = await screen.findByRole('region', { name: 'Bon de commande' });
    expect(within(sheet).getByText('Demande : DA-0001')).toBeInTheDocument();
  });

  it('shows the not-found card for an unknown purchase', async () => {
    mountDetail('p9');
    expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  });

  it('lists the steps with their dates in the history tab', async () => {
    mountDetail('p1');
    await screen.findByRole('heading', { name: 'BC-0142' });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Historique' }));
    const validated = within(screen.getByRole('cell', { name: 'Validée' }).closest('tr')!);
    expect(validated.getByText('Awa')).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getAllByRole('row')).toHaveLength(4);
  });

  it('pays from the header and deletes a payment from the Paiements tab', async () => {
    mountDetail('p2');
    await screen.findByRole('heading', { name: 'BC-0141' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Payer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Payer — BC-0141' });
    expect(within(dialog).getByLabelText('Montant (FCFA)')).toHaveValue(70000);
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/purchases/p2/payments', body: { amount: 70000 } });

    await user.click(screen.getByRole('tab', { name: 'Paiements' }));
    expect(screen.queryByRole('button', { name: 'Ajouter un paiement' })).not.toBeInTheDocument();
    const payment = within(screen.getByText('VIR-1').closest('tr')!);
    expect(cells(screen.getByText('VIR-1').closest('tr'))).toContain('2026-10-25 50 000 FCFA Virement VIR-1');
    await user.click(payment.getByRole('button', { name: 'Supprimer' }));
    const confirm = await screen.findByRole('dialog', { name: 'Supprimer le paiement' });
    await user.click(within(confirm).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: 'DELETE', url: '/api/purchases/p2/payments/pay1' });
  });

  it.each([
    ['DIRECTEUR_FERME', ALL, { p1: ['Réceptionner', 'Annuler', 'Imprimer'], p2: ['Payer', 'Imprimer'], p3: ['Valider', 'Annuler'] }, true],
    ['MAGASINIER', ['read', 'update'], { p1: ['Réceptionner', 'Imprimer'], p2: ['Imprimer'], p3: [] }, false],
  ])('gives %s exactly its header actions, as on the list rows', async (_role, perms, expected, canDelete) => {
    for (const [id, names] of Object.entries(expected)) {
      cleanup();
      mountDetail(id, { perms: perms as string[] });
      await screen.findByRole('heading', { name: new RegExp(`^(BC|DA)-`) });
      // Every button of the page is a header action (the tabs are tabs).
      expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(names);
    }
    cleanup();
    mountDetail('p2', { perms: perms as string[] });
    await screen.findByRole('heading', { name: 'BC-0141' });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Paiements' }));
    expect(!!screen.queryByRole('button', { name: 'Supprimer' })).toBe(canDelete);
  });

  it('is read-only under all farms', async () => {
    mountDetail('p2', { farm: 'all' });
    await screen.findByRole('heading', { name: 'BC-0141' });
    expect(screen.queryByRole('button', { name: 'Payer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimer' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Paiements' }));
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('rounds line amounts to 2 decimals on the Lignes tab and the printed sheet', async () => {
    DETAILS.p7 = {
      ...(DETAILS.p1 as object), id: 'p7', reference: 'BC-0160', amount: 868435.05 + 3.3,
      lines: [
        line({ itemId: 's2', itemName: 'Aliment ponte', quantity: 2800.5, unitPrice: 310.1 }),
        line({ itemId: 's1', itemName: 'Aliment croissance chair', quantity: 3, unitPrice: 1.1 }),
      ],
    };
    mountDetail('p7');
    await screen.findByRole('heading', { name: 'BC-0160' });
    expect(cells(screen.getAllByText('Aliment croissance chair')[0].closest('tr'))).toContain('3.3 FCFA');
    expect(cells(screen.getAllByText('Aliment ponte')[0].closest('tr'))).toContain('868 435.05 FCFA');
    const sheet = screen.getByRole('region', { name: 'Bon de commande' });
    expect(cells(within(sheet).getByText('Aliment croissance chair').closest('tr'))).toContain('3.3 FCFA');
    expect(flat(within(sheet).getByText(/^Total/).textContent)).toBe('Total : 868 438.35 FCFA');
  });

  it('prints the bon de commande once ordered, with the farm legal block and the ordered lines', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    mountDetail('p1');
    await screen.findByRole('heading', { name: 'BC-0142' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Imprimer' }));
    expect(print).toHaveBeenCalledOnce();
    const sheet = await screen.findByRole('region', { name: 'Bon de commande' });
    expect(within(sheet).getByText('Ferme du Golfe SARL')).toBeInTheDocument();
    expect(within(sheet).getByText(/NIF : 1001234567/)).toBeInTheDocument();
    expect(within(sheet).getByText(/RCCM : TG-LOM-2020-B-1234/)).toBeInTheDocument();
    expect(within(sheet).getByText('Route de Kpalimé, Lomé')).toBeInTheDocument();
    expect(within(sheet).getByText(/BC-0142/)).toBeInTheDocument();
    // The order date, not the request date; the supplier's contact details.
    expect(within(sheet).getByText('Date : 2026-10-21')).toBeInTheDocument();
    expect(within(sheet).getByText('Zone industrielle, Lomé')).toBeInTheDocument();
    expect(within(sheet).getByText('+228 90 11 22 33')).toBeInTheDocument();
    expect(cells(within(sheet).getByText('Aliment ponte').closest('tr'))).toContain('3 000 kg 310 FCFA 930 000 FCFA');
    expect(flat(within(sheet).getByText(/^Total/).textContent)).toContain('930 000 FCFA');
  });

  it('offers no print before the order', async () => {
    mountDetail('p3');
    await screen.findByRole('heading', { name: 'DA-0089' });
    expect(screen.queryByRole('button', { name: 'Imprimer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bon de commande' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument();
  });

  it('prints without the legal block when settings are not readable', async () => {
    mountDetail('p1', { settings: false });
    await screen.findByRole('heading', { name: 'BC-0142' });
    expect(calls.some((c) => c.url === '/api/settings')).toBe(false);
    expect(await screen.findByRole('region', { name: 'Bon de commande' })).toBeInTheDocument();
  });
});
