import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import { todayIso } from '../lib/format';
import { EquipmentDetail } from '../pages/details/EquipmentDetail';
import { MODULES } from './registry';
import './index';
import { equipements } from './equipements';
import { addDays } from './equipementsShared';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Awa', email: 'awa@x.tg', role: 'DIRECTEUR_FERME', twoFactorEnabled: true };
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const cells = (tr: Element | null) => flat(Array.from(tr!.querySelectorAll('td')).map((c) => c.textContent).join(' '));
const tone = (scope: ReturnType<typeof within>, text: string) => scope.getByText(text).closest('[data-tone]')?.getAttribute('data-tone');

const equipment = (id: string, name: string, type: string, location: string, over: object = {}) => ({
  id, name, type, location, siteId: null, buildingId: null, condition: 'BON', nextMaintenance: '2026-10-30', maintenanceDue: true, retiredAt: null,
  openBreakdown: null, hasHistory: false, maintenanceIntervalDays: 90, ...over,
});
const EQUIPMENT = [
  equipment('eq1', 'Groupe électrogène 20 kVA', 'GROUPE_ELECTROGENE', 'Site Nord', { siteId: 's1', hasHistory: true }),
  equipment('eq2', 'Couveuse 1200 œufs', 'COUVEUSE', 'Incubation', { siteId: 's2', condition: 'A_SURVEILLER', nextMaintenance: '2026-10-25', maintenanceIntervalDays: null }),
  equipment('eq3', 'Pompe forage', 'POMPE', 'Site Sud', { siteId: 's3', nextMaintenance: '2026-11-15', maintenanceDue: false }),
  equipment('eq4', 'Ventilateur Poulailler B #3', 'VENTILATEUR', 'Poulailler B', {
    buildingId: 'b1', condition: 'EN_PANNE', nextMaintenance: '2026-10-20', hasHistory: true,
    openBreakdown: { id: 'bk1', date: '2026-11-02', description: 'Moteur grillé' },
  }),
];
const COUNTS = { BON: 2, A_SURVEILLER: 1, EN_PANNE: 1 };
const RETIRED = [equipment('eq9', 'Balance 300 kg', 'BALANCE', 'Site Nord', { retiredAt: '2026-09-01', nextMaintenance: null })];

const MAINTENANCE = [
  {
    id: 'm1', date: '2026-11-10', equipmentId: 'eq1', equipmentName: 'Groupe électrogène 20 kVA', kind: 'PREVENTIVE', description: 'Vidange', performedBy: 'Kossi',
    supplierId: 'sup1', supplierName: 'Garage Lomé', cost: 45000, nextDate: '2027-02-10', repairs: false,
  },
];

const detailOf = (row: (typeof EQUIPMENT)[number], over: object = {}) => ({
  ...row, brand: 'Honda', serialNumber: 'SN-42', purchaseDate: '2025-03-01', firstMaintenanceDate: '2026-10-30', note: 'Près du magasin',
  interventions: MAINTENANCE, breakdowns: [{ id: 'bk1', date: '2026-11-02', description: 'Moteur grillé', repairId: null, resolvedDate: null }, { id: 'bk0', date: '2026-08-01', description: 'Courroie', repairId: 'm0', resolvedDate: '2026-08-05' }],
  openTasks: 1, maintenanceCost: 45000, ...over,
});

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

const MAINTENANCE_ROWS = (perms: Record<string, string[]>) => MAINTENANCE.map((m) => ({ ...m, cost: perms.finance?.includes('read') ? m.cost : null }));
const DIRECTEUR: Record<string, string[]> = { equipements: ['read', 'create', 'update', 'delete'], finance: ['read'], fournisseurs: ['read'], taches: ['read'], batiments: ['read'] };
const RESP_AVICOLE: Record<string, string[]> = { equipements: ['read', 'create', 'update'], fournisseurs: ['read'], batiments: ['read'] };
const AGENT: Record<string, string[]> = { equipements: ['read', 'create'] };

function mount({ perms = DIRECTEUR, items = EQUIPMENT, route = '/', detail, missing = false }: { perms?: Record<string, string[]>; items?: unknown[]; route?: string; detail?: unknown; missing?: boolean } = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const url = call.url;
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    if (call.method !== 'GET') return json(201, { id: 'new1' });
    const one = /^\/api\/equipment\/(eq\d)(\?|$)/.exec(url);
    if (one && missing) return json(404, { message: 'Introuvable' });
    if (one) return json(200, detail ?? detailOf(EQUIPMENT.find((e) => e.id === one[1])!));
    if (url.startsWith('/api/equipment')) return url.includes('retired=true') ? page(RETIRED) : page(items, { statusCounts: COUNTS });
    if (url.startsWith('/api/maintenance')) return page(MAINTENANCE_ROWS(perms));
    if (url.startsWith('/api/sites')) return page([{ id: 's1', name: 'Site Nord' }, { id: 's2', name: 'Incubation' }]);
    if (url.startsWith('/api/buildings')) return page([{ id: 'b1', name: 'Poulailler B' }]);
    if (url.startsWith('/api/suppliers')) return page([{ id: 'sup1', name: 'Garage Lomé' }]);
    if (url.startsWith('/api/tasks')) return page([{ id: 't1', title: 'Graisser le moteur', description: null, assigneeId: null, assigneeName: null, dueDate: '2026-11-20', dueTime: null, priority: 'NORMALE', status: 'A_FAIRE', overdue: false, recurrence: 'AUCUNE', target: null, completedDate: null, hasProof: false, mine: false }], { statusCounts: { A_FAIRE: 1 } });
    if (url.startsWith('/api/employees/options')) return json(200, { items: [] });
    if (url.startsWith('/api/qr/equipement/')) {
      return json(200, { kind: 'equipement', id: 'eq1', farmId: 'f1', farmName: 'Ferme', path: '/m/equipements/eq1', url: 'http://x/q/equipement/eq1', label: 'Groupe électrogène 20 kVA', sublabel: 'Site Nord', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <Routes>
            <Route path="/m/equipements/:id" element={<EquipmentDetailRoute />} />
            <Route path="*" element={<ModulePage config={equipements} />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function EquipmentDetailRoute() {
  return <EquipmentDetail id={useParams().id!} />;
}
const rowOf = (text: string) => within(screen.getByText(text).closest('tr')!);

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('addDays', () => {
  it('adds calendar days across months and years', () => {
    expect(addDays('2026-11-10', 90)).toBe('2027-02-08');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('equipements list', () => {
  it('is registered as the equipements module', () => {
    expect(MODULES.equipements).toBe(equipements);
  });

  it('renders the reference header, the five columns, the four rows with their pills and the 4/2/1/1 tiles', async () => {
    mount();
    expect(await screen.findByText('Ventilateur Poulailler B #3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Équipements' })).toBeInTheDocument();
    expect(screen.getByText('Opérations')).toBeInTheDocument();
    expect(screen.getByText('Couveuses, balances, pompes, groupes et maintenance.')).toBeInTheDocument();
    for (const h of ['ÉQUIPEMENT', 'TYPE', 'EMPLACEMENT', 'PROCHAINE MAINTENANCE', 'ÉTAT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Ventilateur Poulailler B #3').closest('tr'))).toBe('Ventilateur Poulailler B #3 Ventilateur Poulailler B 2026-10-20 En panne');
    expect(cells(screen.getByText('Groupe électrogène 20 kVA').closest('tr'))).toBe('Groupe électrogène 20 kVA Groupe électrogène Site Nord 2026-10-30 Bon');
    expect(cells(screen.getByText('Couveuse 1200 œufs').closest('tr'))).toBe('Couveuse 1200 œufs Couveuse Incubation 2026-10-25 À surveiller');
    expect(cells(screen.getByText('Pompe forage').closest('tr'))).toBe('Pompe forage Pompe Site Sud 2026-11-15 Bon');
    expect(tone(rowOf('Ventilateur Poulailler B #3'), 'En panne')).toBe('danger');
    expect(tone(rowOf('Couveuse 1200 œufs'), 'À surveiller')).toBe('warning');
    expect(tone(rowOf('Pompe forage'), 'Bon')).toBe('success');
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(tile('Total enregistrements')).toHaveTextContent('4');
    expect(tile('Bon')).toHaveTextContent('2');
    expect(tile('À surveiller')).toHaveTextContent('1');
    expect(tile('En panne')).toHaveTextContent('1');
    expect(screen.getByLabelText('Tous les statuts')).toBeInTheDocument();
  });

  it('shows a dash for an equipment without location or maintenance date', async () => {
    mount({ items: [equipment('eq7', 'Balance 5 kg', 'BALANCE', '', { location: null, nextMaintenance: null })] });
    expect(cells((await screen.findByText('Balance 5 kg')).closest('tr'))).toBe('Balance 5 kg Balance — — Bon');
  });

  it('opens the QR dialog of the equipment kind from the row', async () => {
    mount();
    await screen.findByText('Pompe forage');
    await userEvent.setup().click(rowOf('Groupe électrogène 20 kVA').getByRole('button', { name: 'QR code' }));
    expect(await screen.findByRole('dialog', { name: 'QR code — Groupe électrogène 20 kVA' })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/qr/equipement/eq1')).toBe(true);
  });

  it('has the Équipements, Interventions and Réformés tabs', async () => {
    mount();
    await screen.findByText('Pompe forage');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Équipements', 'Interventions', 'Réformés']);
  });
});

describe('equipements gating', () => {
  it('lets an agent declare a breakdown only: no Intervention, no Réformer, no Ajouter, no edit', async () => {
    mount({ perms: AGENT });
    await screen.findByText('Pompe forage');
    expect(rowOf('Pompe forage').getByRole('button', { name: 'Déclarer une panne' })).toBeInTheDocument();
    expect(rowOf('Ventilateur Poulailler B #3').queryByRole('button', { name: 'Déclarer une panne' })).not.toBeInTheDocument();
    for (const name of ['Intervention', 'Réformer', 'Modifier', 'Supprimer', 'Ajouter']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('offers every action to a director, in the row order', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const names = (text: string) => rowOf(text).queryAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names('Pompe forage')).toEqual(['Déclarer une panne', 'Intervention', 'Réformer', 'QR code', 'Modifier', 'Supprimer']);
    expect(names('Ventilateur Poulailler B #3')).toEqual(['Intervention', 'Réformer', 'QR code', 'Modifier', 'Supprimer']);
  });

  it('disables the delete icon of an equipment with history, with the exact reason', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const withHistory = rowOf('Groupe électrogène 20 kVA').getByRole('button', { name: 'Supprimer' });
    expect(withHistory).toHaveAttribute('aria-disabled', 'true');
    expect(withHistory).toHaveAttribute('title', 'Équipement avec historique — réformez-le');
    expect(rowOf('Pompe forage').getByRole('button', { name: 'Supprimer' })).not.toHaveAttribute('aria-disabled');
  });

  it('shows the cost field and the COÛT column to finance readers only', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(rowOf('Pompe forage').getByRole('button', { name: 'Intervention' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText('Coût (FCFA)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await user.click(screen.getByRole('tab', { name: 'Interventions' }));
    expect(await screen.findByRole('columnheader', { name: 'COÛT' })).toBeInTheDocument();
    expect(await screen.findByText(/45\s000/)).toBeInTheDocument();
    cleanup();
    mount({ perms: RESP_AVICOLE });
    await screen.findByText('Pompe forage');
    await user.click(rowOf('Pompe forage').getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Description')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Coût (FCFA)')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await user.click(screen.getByRole('tab', { name: 'Interventions' }));
    await screen.findByText('Vidange');
    expect(screen.queryByRole('columnheader', { name: 'COÛT' })).not.toBeInTheDocument();
  });
});

describe('equipment actions', () => {
  it('declares a breakdown with a date and a description', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(rowOf('Pompe forage').getByRole('button', { name: 'Déclarer une panne' }));
    const dialog = await screen.findByRole('dialog', { name: 'Déclarer une panne — Pompe forage' });
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    await user.type(within(dialog).getByLabelText('Description'), 'Ne démarre plus');
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-12' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/equipment/eq3/breakdowns', body: { date: '2026-11-12', description: 'Ne démarre plus' } });
  });

  it('posts a preventive intervention with its next date defaulting to the interval', async () => {
    mount();
    await screen.findByText('Groupe électrogène 20 kVA');
    const user = userEvent.setup();
    await user.click(rowOf('Groupe électrogène 20 kVA').getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog', { name: 'Intervention — Groupe électrogène 20 kVA' });
    expect(within(dialog).getByRole('radio', { name: 'Préventive' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Corrective' })).not.toBeChecked();
    expect(within(dialog).queryByLabelText(/Répare la panne/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-10' } });
    expect(within(dialog).getByText('Par défaut : 2027-02-08')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Description'), 'Vidange');
    await user.type(within(dialog).getByLabelText('Intervenant'), 'Kossi');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Garage Lomé' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Fournisseur'), 'Garage Lomé');
    await user.type(within(dialog).getByLabelText('Coût (FCFA)'), '45000');
    fireEvent.change(within(dialog).getByLabelText('Prochaine maintenance'), { target: { value: '2027-02-10' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/maintenance',
      body: { equipmentId: 'eq1', kind: 'PREVENTIVE', date: '2026-11-10', description: 'Vidange', performedBy: 'Kossi', supplierId: 'sup1', cost: 45000, nextDate: '2027-02-10' },
    });
    expect(writes()[0].body).not.toHaveProperty('repairsBreakdown');
  });

  it('shows no default hint on an equipment without interval', async () => {
    mount();
    await screen.findByText('Couveuse 1200 œufs');
    await userEvent.setup().click(rowOf('Couveuse 1200 œufs').getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Par défaut/)).not.toBeInTheDocument();
  });

  it('repairs the open breakdown of a broken equipment with a corrective intervention', async () => {
    mount();
    await screen.findByText('Ventilateur Poulailler B #3');
    const user = userEvent.setup();
    await user.click(rowOf('Ventilateur Poulailler B #3').getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Corrective' })).toBeChecked();
    const repair = within(dialog).getByRole('checkbox', { name: 'Répare la panne du 2026-11-02' });
    expect(repair).toBeChecked();
    expect(within(dialog).getByLabelText('État après intervention')).toHaveValue('BON');
    await user.type(within(dialog).getByLabelText('Description'), 'Remplacement moteur');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/maintenance',
      body: { equipmentId: 'eq4', kind: 'CORRECTIVE', description: 'Remplacement moteur', repairsBreakdown: true, conditionAfter: 'BON' },
    });
  });

  it('sends repairsBreakdown false once unchecked, and hides the state after intervention', async () => {
    mount();
    await screen.findByText('Ventilateur Poulailler B #3');
    const user = userEvent.setup();
    await user.click(rowOf('Ventilateur Poulailler B #3').getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Répare la panne du 2026-11-02' }));
    expect(within(dialog).queryByLabelText('État après intervention')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Description'), 'Contrôle');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ kind: 'CORRECTIVE', repairsBreakdown: false });
    expect(writes()[0].body).not.toHaveProperty('conditionAfter');
  });

  it('offers the repair only for a corrective intervention', async () => {
    mount();
    await screen.findByText('Ventilateur Poulailler B #3');
    const user = userEvent.setup();
    await user.click(rowOf('Ventilateur Poulailler B #3').getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Préventive' }));
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('retires an equipment after the confirmation, dated today', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(rowOf('Pompe forage').getByRole('button', { name: 'Réformer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Réformer Pompe forage ? Il n\'apparaîtra plus dans la liste ni dans les alertes.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Réformer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/equipment/eq3/retire', body: { date: todayIso() } });
  });
});

describe('equipements form', () => {
  async function openAdd() {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Ajouter — Équipements' }) };
  }

  it('has the fields of the brief on creation, without the state', async () => {
    const { dialog } = await openAdd();
    for (const l of ['Nom', 'Type', 'Marque', 'N° de série', "Date d'achat", 'Intervalle de maintenance (jours)', 'Prochaine maintenance', 'Note']) {
      expect(within(dialog).getByLabelText(l)).toBeInTheDocument();
    }
    expect(within(dialog).queryByLabelText('État')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Site', 'Bâtiment']);
    expect(within(dialog).getByRole('radio', { name: 'Site' })).toBeChecked();
    expect(within(dialog).getByLabelText('Type').querySelectorAll('option')).toHaveLength(11);
  });

  it('posts the equipment with its site and no building key', async () => {
    const { user, dialog } = await openAdd();
    await user.type(within(dialog).getByLabelText('Nom'), 'Balance 2');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Balance');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Site Nord' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Site'), 'Site Nord');
    await user.type(within(dialog).getByLabelText('Intervalle de maintenance (jours)'), '180');
    fireEvent.change(within(dialog).getByLabelText('Prochaine maintenance'), { target: { value: '2027-01-15' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/equipment', body: { name: 'Balance 2', type: 'BALANCE', siteId: 's1', maintenanceIntervalDays: 180, firstMaintenanceDate: '2027-01-15' } });
    expect(writes()[0].body).not.toHaveProperty('buildingId');
  });

  it('switches the location to a building', async () => {
    const { user, dialog } = await openAdd();
    await user.click(within(dialog).getByRole('radio', { name: 'Bâtiment' }));
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Poulailler B' })).toBeInTheDocument());
    await user.type(within(dialog).getByLabelText('Nom'), 'Ventilateur 4');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Ventilateur');
    await user.selectOptions(within(dialog).getByLabelText('Bâtiment'), 'Poulailler B');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ name: 'Ventilateur 4', type: 'VENTILATEUR', buildingId: 'b1' });
    expect(writes()[0].body).not.toHaveProperty('siteId');
  });

  it('edits from the loaded record, sends only what changed and clears a location moved to a building', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(rowOf('Groupe électrogène 20 kVA').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Équipements' });
    await waitFor(() => expect(within(dialog).getByLabelText('Marque')).toHaveValue('Honda'));
    expect(within(dialog).getByLabelText('N° de série')).toHaveValue('SN-42');
    expect(within(dialog).getByLabelText('Note')).toHaveValue('Près du magasin');
    expect(within(dialog).queryByLabelText('Prochaine maintenance')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('État')).toHaveValue('BON');
    await user.clear(within(dialog).getByLabelText('Marque'));
    await user.selectOptions(within(dialog).getByLabelText('État'), 'À surveiller');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/equipment/eq1', body: { brand: null, condition: 'A_SURVEILLER' } });
    expect(Object.keys(writes()[0].body as object).sort()).toEqual(['brand', 'condition']);
  });

  it('locks the state of a broken equipment with the hint', async () => {
    mount();
    await screen.findByText('Pompe forage');
    await userEvent.setup().click(rowOf('Ventilateur Poulailler B #3').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Équipements' });
    await waitFor(() => expect(within(dialog).getByLabelText('Marque')).toHaveValue('Honda'));
    expect(within(dialog).getByLabelText('État')).toBeDisabled();
    expect(within(dialog).getByLabelText('État')).toHaveValue('EN_PANNE');
    expect(within(dialog).getByText('Remis en service par une intervention corrective')).toBeInTheDocument();
  });

  it('deletes an equipment without history', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(rowOf('Pompe forage').getByRole('button', { name: 'Supprimer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', url: '/api/equipment/eq3' });
  });
});

describe('interventions and retired tabs', () => {
  it('lists the interventions with their columns and the cost for a finance reader', async () => {
    mount();
    await screen.findByText('Pompe forage');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Interventions' }));
    await screen.findByText('Vidange');
    for (const h of ['DATE', 'ÉQUIPEMENT', 'TYPE', 'DESCRIPTION', 'INTERVENANT', 'PROCHAINE DATE', 'COÛT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Vidange').closest('tr'))).toMatch(/^2026-11-10 Groupe électrogène 20 kVA Préventive Vidange Kossi 2027-02-10 45\s000\sFCFA$/);
  });

  it('adds an intervention from the tab with the equipment to choose, edits one with its stored values', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Interventions' }));
    await screen.findByText('Vidange');
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const add = await screen.findByRole('dialog', { name: 'Ajouter — Équipements' });
    expect(within(add).getByLabelText('Équipement')).toBeInTheDocument();
    await user.click(within(add).getByRole('button', { name: 'Annuler' }));
    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    const edit = await screen.findByRole('dialog', { name: 'Modifier — Équipements' });
    expect(within(edit).getByLabelText('Description')).toHaveValue('Vidange');
    expect(within(edit).getByLabelText('Intervenant')).toHaveValue('Kossi');
    expect(within(edit).queryByLabelText('Équipement')).not.toBeInTheDocument();
    await user.clear(within(edit).getByLabelText('Intervenant'));
    await user.click(within(edit).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/maintenance/m1', body: { performedBy: null } });
    expect(Object.keys(writes()[0].body as object)).toEqual(['performedBy']);
  });

  it('lists the retired equipment with its date, no Ajouter, and puts one back in service', async () => {
    mount();
    await screen.findByText('Pompe forage');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Réformés' }));
    await screen.findByText('Balance 300 kg');
    for (const h of ['ÉQUIPEMENT', 'TYPE', 'EMPLACEMENT', 'RÉFORMÉ LE']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Balance 300 kg').closest('tr'))).toBe('Balance 300 kg Balance Site Nord 2026-09-01');
    expect(calls.some((c) => c.url.startsWith('/api/equipment?') && c.url.includes('retired=true'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(rowOf('Balance 300 kg').queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    await user.click(rowOf('Balance 300 kg').getByRole('button', { name: 'Remettre en service' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/equipment/eq9/reinstate' });
  });
});

describe('EquipmentDetail', () => {
  const open = (perms = DIRECTEUR, detail?: unknown) => {
    mount({ perms, route: '/m/equipements/eq4', detail });
  };

  it('shows the header, the pill, the four tiles and the tabs', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Ventilateur Poulailler B #3' })).toBeInTheDocument();
    expect(screen.getByText('Ventilateur · Poulailler B')).toBeInTheDocument();
    expect(tone(within(document.body), 'En panne')).toBe('danger');
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(tile('Prochaine maintenance')).toHaveTextContent('2026-10-20');
    expect(tile('Interventions')).toHaveTextContent('1');
    expect(tile('Pannes')).toHaveTextContent('2');
    expect(tile('Coût de maintenance')?.textContent).toMatch(/45\s000/);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Interventions', 'Pannes', 'Tâches']);
  });

  it('omits the cost tile when the API gives null', async () => {
    open(DIRECTEUR, detailOf(EQUIPMENT[3], { maintenanceCost: null }));
    await screen.findByRole('heading', { name: 'Ventilateur Poulailler B #3' });
    expect(screen.queryByText('Coût de maintenance')).not.toBeInTheDocument();
  });

  it('lists the breakdowns with their repair date, and the embedded interventions and tasks scoped to the equipment', async () => {
    open();
    await screen.findByRole('heading', { name: 'Ventilateur Poulailler B #3' });
    const user = userEvent.setup();
    await screen.findByText('Vidange');
    expect(calls.some((c) => c.url.startsWith('/api/maintenance?') && c.url.includes('equipmentId=eq4'))).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Pannes' }));
    for (const h of ['DATE', 'DESCRIPTION', 'RÉPARÉE LE']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Moteur grillé').closest('tr'))).toBe('2026-11-02 Moteur grillé —');
    expect(cells(screen.getByText('Courroie').closest('tr'))).toBe('2026-08-01 Courroie 2026-08-05');
    await user.click(screen.getByRole('tab', { name: 'Tâches' }));
    await screen.findByText('Graisser le moteur');
    expect(calls.some((c) => c.url.startsWith('/api/tasks?') && c.url.includes('equipmentId=eq4'))).toBe(true);
  });

  it('has the shared actions and the QR button; the actions follow the permissions', async () => {
    open();
    await screen.findByRole('heading', { name: 'Ventilateur Poulailler B #3' });
    expect(screen.getByRole('button', { name: 'Intervention' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réformer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Déclarer une panne' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'QR code' }));
    expect(await screen.findByRole('dialog', { name: /QR code/ })).toBeInTheDocument();
    cleanup();
    open(AGENT, detailOf(EQUIPMENT[2]));
    await screen.findByRole('heading', { name: 'Pompe forage' });
    expect(screen.getByRole('button', { name: 'Déclarer une panne' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Intervention' })).not.toBeInTheDocument();
  });

  it('opens the intervention dialog from the page with the repair checkbox, and posts it', async () => {
    open();
    await screen.findByRole('heading', { name: 'Ventilateur Poulailler B #3' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Intervention' }));
    const dialog = await screen.findByRole('dialog', { name: 'Intervention — Ventilateur Poulailler B #3' });
    expect(within(dialog).getByRole('checkbox', { name: 'Répare la panne du 2026-11-02' })).toBeChecked();
    await user.type(within(dialog).getByLabelText('Description'), 'Moteur');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ equipmentId: 'eq4', repairsBreakdown: true });
  });

  it('shows the not-found card for an unknown equipment', async () => {
    mount({ route: '/m/equipements/eq4', missing: true });
    expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ventilateur Poulailler B #3' })).not.toBeInTheDocument();
  });
});
