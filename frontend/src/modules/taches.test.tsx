import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../lib/auth';
import { setAccessToken, setFarmHeader } from '../lib/api';
import { ModulePage } from '../components/module/ModulePage';
import { todayIso } from '../lib/format';
import { MODULES } from './registry';
import './index';
import { taches } from './taches';
import { nextDueDate } from './tachesShared';

function json(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const USER = { id: 'u1', name: 'Kodjo', email: 'agent@x.tg', role: 'AGENT_ELEVAGE', twoFactorEnabled: true };
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const cells = (tr: Element | null) => flat(Array.from(tr!.querySelectorAll('td')).map((c) => c.textContent).join(' '));
const tone = (scope: ReturnType<typeof within>, text: string) => scope.getByText(text).closest('[data-tone]')?.getAttribute('data-tone');

const task = (id: string, title: string, assigneeName: string | null, dueDate: string, priority: string, status: string, over: object = {}) => ({
  id, title, description: null, assigneeId: assigneeName ? `e-${id}` : null, assigneeName, dueDate, dueTime: null, priority, status, overdue: false,
  recurrence: 'AUCUNE', target: null, completedDate: status === 'TERMINEE' ? '2026-10-22' : null, hasProof: false, mine: false, ...over,
});
const TASKS = [
  task('t1', 'Pesée hebdomadaire LC-2026-14', 'Kodjo A.', '2026-10-23', 'NORMALE', 'A_FAIRE', {
    recurrence: 'HEBDOMADAIRE', mine: true, assigneeId: 'e1', target: { kind: 'LOT', id: 'l1', label: 'LC-2026-14' },
  }),
  task('t2', 'Vaccination Gumboro LC-2026-15', 'Dr Koffi', '2026-10-24', 'HAUTE', 'A_FAIRE'),
  task('t3', 'Nettoyage Porcherie 2', 'Yawa M.', '2026-10-18', 'URGENTE', 'EN_COURS', { overdue: true }),
  task('t4', 'Collecte des œufs', 'Ama K.', '2026-10-22', 'NORMALE', 'TERMINEE', { hasProof: true }),
];
const COUNTS = { A_FAIRE: 2, EN_COURS: 1, TERMINEE: 1 };

const EMPLOYEE_OPTIONS = [
  { id: 'e1', name: 'Kodjo A.', jobTitle: "Agent d'élevage", userId: 'u1' },
  { id: 'e2', name: 'Dr Koffi', jobTitle: 'Vétérinaire', userId: 'u9' },
  { id: 'e3', name: 'Yawa M.', jobTitle: 'Ouvrière', userId: null },
];
const employee = (id: string, name: string, jobTitle: string, contractType: string, hireDate: string, salary: number | null, over: object = {}) => ({
  id, name, fullName: null, jobTitle, phone: '+228 90 11 22 33', contractType, hireDate, endDate: null, status: 'ACTIF', userId: null, userName: null, monthlySalary: salary, note: null, ...over,
});
const EMPLOYEES = [
  employee('e1', 'Kodjo A.', "Agent d'élevage", 'CDI', '2025-01-06', 85000, { userId: 'u1', userName: 'Kodjo' }),
  employee('e2', 'Dr Koffi', 'Vétérinaire', 'CDD', '2026-01-01', 250000),
  employee('e3', 'Yawa M.', 'Ouvrière', 'JOURNALIER', '2026-03-01', 60000, { endDate: '2026-09-30', status: 'PARTI' }),
];
const ATTENDANCE = [
  { id: 'a1', date: '2026-10-20', employeeId: 'e1', employeeName: 'Kodjo A.', status: 'PRESENT', hours: 8, note: null },
  { id: 'a2', date: '2026-10-20', employeeId: 'e3', employeeName: 'Yawa M.', status: 'ABSENT', hours: null, note: 'Malade' },
];

interface Call { method: string; url: string; body?: unknown }
const calls: Call[] = [];
const writes = () => calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('/api/auth/'));
const fetchMock = vi.fn<typeof fetch>();
const page = (items: unknown[], extra: object = {}) => json(200, { items, total: items.length, page: 1, pageSize: 25, ...extra });

const RESP_AVICOLE: Record<string, string[]> = { taches: ['read', 'create', 'update', 'delete'], personnel: ['read', 'create'], lots: ['read'], batiments: ['read'] };
const AGENT = { taches: ['read', 'update'], equipements: ['read', 'create'] };
const COMPTABLE = { taches: ['read'], personnel: ['read'], finance: ['read', 'create', 'update', 'delete'] };
const DIRECTEUR = { taches: ['read', 'create', 'update', 'delete'], personnel: ['read', 'create', 'update', 'delete'], lots: ['read'], batiments: ['read'], equipements: ['read'] };

function mount({ perms = RESP_AVICOLE, tasks = TASKS, route = '/', employees = EMPLOYEE_OPTIONS }: { perms?: Record<string, string[]>; tasks?: unknown[]; route?: string; employees?: unknown[] } = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { method: init?.method ?? 'GET', url: String(input), body };
    calls.push(call);
    const url = call.url;
    if (url === '/api/auth/refresh') return json(200, { accessToken: 'acc', user: USER });
    if (url === '/api/auth/me') return json(200, { user: USER, farms: [{ id: 'f1', name: 'Ferme' }], canSeeAllFarms: true, permissions: perms });
    if (call.method !== 'GET') return json(201, { id: 'new1' });
    if (url.startsWith('/api/tasks/t4/proof')) return Object.assign(new Response(null, { status: 200 }), { blob: async () => new Blob(['img'], { type: 'image/png' }) });
    if (url.startsWith('/api/tasks')) return page(tasks, { statusCounts: COUNTS });
    if (url.startsWith('/api/employees/options')) return json(200, { items: employees });
    if (url.startsWith('/api/employees/user-options')) return json(200, { items: [{ id: 'u5', name: 'Awa', email: 'awa@x.tg', role: 'RESP_AVICOLE' }] });
    if (url.startsWith('/api/employees')) return page(EMPLOYEES, { statusCounts: { ACTIF: 2, PARTI: 1 } });
    if (url.startsWith('/api/attendance')) return page(url.includes('from=2026-10-20') ? ATTENDANCE : url.includes('from=') ? [] : ATTENDANCE, { statusCounts: { PRESENT: 1, ABSENT: 1 } });
    if (url.startsWith('/api/batches')) return page([{ id: 'l1', code: 'LC-2026-14' }, { id: 'l2', code: 'LC-2026-15' }]);
    if (url.startsWith('/api/buildings')) return page([{ id: 'b1', name: 'Porcherie 2' }]);
    throw new Error(`unexpected ${call.method} ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider><Routes><Route path="*" element={<ModulePage config={taches} />} /></Routes></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

describe('nextDueDate', () => {
  it('adds a day, a week, or a month clamped to its last day', () => {
    expect(nextDueDate('2026-10-23', 'HEBDOMADAIRE')).toBe('2026-10-30');
    expect(nextDueDate('2026-01-31', 'MENSUELLE')).toBe('2026-02-28');
    expect(nextDueDate('2026-12-31', 'QUOTIDIENNE')).toBe('2027-01-01');
    expect(nextDueDate('2026-12-31', 'MENSUELLE')).toBe('2027-01-31');
    expect(nextDueDate('2026-10-23', 'AUCUNE')).toBeNull();
  });
});

describe('taches list', () => {
  it('is registered as the taches module', () => {
    expect(MODULES.taches).toBe(taches);
  });

  it('renders the reference header, the five columns, the four rows with their pills and the 4/2/1/1 tiles', async () => {
    mount();
    expect(await screen.findByText('Nettoyage Porcherie 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tâches & personnel' })).toBeInTheDocument();
    expect(screen.getByText('Opérations')).toBeInTheDocument();
    expect(screen.getByText('Planification des tâches, responsables et priorités.')).toBeInTheDocument();
    for (const h of ['TÂCHE', 'RESPONSABLE', 'ÉCHÉANCE', 'PRIORITÉ', 'STATUT']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Nettoyage Porcherie 2').closest('tr'))).toBe('Nettoyage Porcherie 2 Yawa M. 2026-10-18 Urgente En cours');
    expect(cells(screen.getByText('Collecte des œufs').closest('tr'))).toBe('Collecte des œufs Ama K. 2026-10-22 Normale Terminée');
    expect(cells(screen.getByText('Pesée hebdomadaire LC-2026-14').closest('tr'))).toBe('Pesée hebdomadaire LC-2026-14 Kodjo A. 2026-10-23 Normale À faire');
    expect(tone(rowOf('Nettoyage Porcherie 2'), 'En cours')).toBe('warning');
    expect(tone(rowOf('Collecte des œufs'), 'Terminée')).toBe('success');
    expect(tone(rowOf('Vaccination Gumboro LC-2026-15'), 'À faire')).toBe('warning');
    const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling;
    expect(tile('Total enregistrements')).toHaveTextContent('4');
    expect(tile('À faire')).toHaveTextContent('2');
    expect(tile('En cours')).toHaveTextContent('1');
    expect(tile('Terminée')).toHaveTextContent('1');
    expect(screen.getByLabelText('Tous les statuts')).toBeInTheDocument();
  });

  it('shows a dash for a task without an assignee', async () => {
    mount({ tasks: [task('t9', 'Sans responsable', null, '2026-10-30', 'NORMALE', 'A_FAIRE')] });
    expect(cells((await screen.findByText('Sans responsable')).closest('tr'))).toBe('Sans responsable — 2026-10-30 Normale À faire');
  });

  it('has the Tâches, Employés and Présences tabs for a role that reads the personnel, and Tâches alone otherwise', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tâches', 'Employés', 'Présences']);
    cleanup();
    mount({ perms: AGENT });
    await screen.findByText('Nettoyage Porcherie 2');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('offers Mes tâches to a user linked to an employee, and sends mine=true', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const filter = await screen.findByLabelText('Toutes les tâches');
    await userEvent.setup().selectOptions(filter, 'Mes tâches');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/tasks?') && c.url.includes('mine=true'))).toBe(true));
  });

  it('has no Mes tâches filter for a user who is no employee of the farm', async () => {
    mount({ employees: EMPLOYEE_OPTIONS.map((e) => ({ ...e, userId: e.userId === 'u1' ? 'u7' : e.userId })) });
    await screen.findByText('Nettoyage Porcherie 2');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/employees/options'))).toBe(true));
    expect(screen.queryByLabelText('Toutes les tâches')).not.toBeInTheDocument();
  });
});

describe('taches gating', () => {
  it('lets an agent linked to Kodjo start his own task only: no Ajouter, no edit or delete icon', async () => {
    mount({ perms: AGENT, tasks: TASKS.map((t) => ({ ...t, mine: t.id === 't1' })) });
    await screen.findByText('Nettoyage Porcherie 2');
    expect(screen.getByRole('button', { name: 'Démarrer' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Démarrer' })).toHaveLength(1);
    expect(rowOf('Pesée hebdomadaire LC-2026-14').getByRole('button', { name: 'Démarrer' })).toBeInTheDocument();
    expect(rowOf('Pesée hebdomadaire LC-2026-14').getByRole('button', { name: 'Terminer' })).toBeInTheDocument();
    expect(rowOf('Vaccination Gumboro LC-2026-15').queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
  });

  it('offers each action on the statuses it applies to, to a manager', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const names = (text: string) => rowOf(text).queryAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names('Pesée hebdomadaire LC-2026-14')).toEqual(['Démarrer', 'Terminer', 'Modifier', 'Supprimer']);
    expect(names('Nettoyage Porcherie 2')).toEqual(['Terminer', 'Modifier', 'Supprimer']);
    expect(names('Collecte des œufs')).toEqual(['Rouvrir', 'Voir la preuve', 'Modifier', 'Supprimer']);
  });

  it('locks a finished task with the reason, on edit and delete', async () => {
    mount();
    await screen.findByText('Collecte des œufs');
    const done = rowOf('Collecte des œufs');
    expect(done.getByRole('button', { name: 'Modifier' })).toHaveAttribute('aria-disabled', 'true');
    expect(done.getByRole('button', { name: 'Modifier' })).toHaveAttribute('title', 'Tâche terminée — rouvrez-la');
    expect(done.getByRole('button', { name: 'Supprimer' })).toHaveAttribute('title', 'Une tâche terminée ne peut pas être supprimée');
    expect(rowOf('Nettoyage Porcherie 2').getByRole('button', { name: 'Modifier' })).not.toHaveAttribute('aria-disabled');
  });
});

describe('taches actions', () => {
  it('starts and reopens a task with one request each', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(rowOf('Pesée hebdomadaire LC-2026-14').getByRole('button', { name: 'Démarrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/tasks/t1/start' });
    await user.click(rowOf('Collecte des œufs').getByRole('button', { name: 'Rouvrir' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: 'POST', url: '/api/tasks/t4/reopen' });
  });

  it('completes with a photo: /complete first, then a multipart /proof, with the recurring hint', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(rowOf('Pesée hebdomadaire LC-2026-14').getByRole('button', { name: 'Terminer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Terminer — Pesée hebdomadaire LC-2026-14' });
    expect(within(dialog).getByLabelText('Date de réalisation')).toHaveValue(todayIso());
    expect(within(dialog).getByText('La prochaine occurrence sera créée pour le 2026-10-30')).toBeInTheDocument();
    const file = new File(['x'], 'preuve.png', { type: 'image/png' });
    fireEvent.change(within(dialog).getByLabelText('Photo (preuve)'), { target: { files: [file] } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/tasks/t1/complete', body: { date: todayIso() } });
    expect(writes()[1].method).toBe('POST');
    expect(writes()[1].url).toBe('/api/tasks/t1/proof');
    expect((writes()[1].body as FormData).get('file')).toBe(file);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('completes without a photo with the one request, and no recurrence hint on a one-off task', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(rowOf('Nettoyage Porcherie 2').getByRole('button', { name: 'Terminer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/prochaine occurrence/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Date de réalisation'), { target: { value: '2026-10-19' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/tasks/t3/complete', body: { date: '2026-10-19' } });
  });

  it('keeps the dialog open with the error, and the task completed, when the photo is refused', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => (String(input) === '/api/tasks/t3/proof' ? json(400, { message: 'Photo invalide : JPEG, PNG ou WebP de 5 Mo au plus' }) : base(input, init)));
    const user = userEvent.setup();
    await user.click(rowOf('Nettoyage Porcherie 2').getByRole('button', { name: 'Terminer' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Photo (preuve)'), { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/La tâche est terminée, mais la photo n'a pas été enregistrée : Photo invalide/)).toBeInTheDocument();
  });

  it('refuses a photo over 5 Mo before any request', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(rowOf('Nettoyage Porcherie 2').getByRole('button', { name: 'Terminer' }));
    const dialog = await screen.findByRole('dialog');
    const big = new File(['x'], 'p.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(within(dialog).getByLabelText('Photo (preuve)'), { target: { files: [big] } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Photo invalide : JPEG, PNG ou WebP de 5 Mo au plus')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('opens the proof fetched as a blob', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    URL.createObjectURL = vi.fn(() => 'blob:proof');
    URL.revokeObjectURL = vi.fn();
    mount();
    await screen.findByText('Collecte des œufs');
    await userEvent.setup().click(rowOf('Collecte des œufs').getByRole('button', { name: 'Voir la preuve' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:proof', '_blank'));
    expect(calls.some((c) => c.url === '/api/tasks/t4/proof')).toBe(true);
  });
});

describe('taches form', () => {
  async function openForm(perms = RESP_AVICOLE) {
    mount({ perms });
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Ajouter — Tâches & personnel' }) };
  }

  it('has the fields of the brief with Normale, Aucune and Rien as defaults', async () => {
    const { dialog } = await openForm();
    for (const l of ['Tâche', 'Description', 'Responsable', 'Échéance', 'Heure', 'Priorité', 'Récurrence']) expect(within(dialog).getByLabelText(l)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Priorité')).toHaveValue('NORMALE');
    expect(within(dialog).getByLabelText('Récurrence')).toHaveValue('AUCUNE');
    expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Rien', 'Lot', 'Bâtiment']);
    expect(within(dialog).getByRole('radio', { name: 'Rien' })).toBeChecked();
    const choices = (label: string) => Array.from(within(dialog).getByLabelText(label).querySelectorAll('option')).map((o) => o.textContent).filter((t) => t !== 'Sélectionner…');
    expect(choices('Priorité')).toEqual(['Normale', 'Haute', 'Urgente']);
    expect(choices('Récurrence')).toEqual(['Aucune', 'Tous les jours', 'Chaque semaine', 'Chaque mois']);
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Kodjo A.' })).toBeInTheDocument());
  });

  it('offers Équipement only to a user who reads the equipment', async () => {
    const { dialog } = await openForm(DIRECTEUR);
    expect(within(dialog).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Rien', 'Lot', 'Bâtiment', 'Équipement']);
  });

  it('posts the task with its lot target as batchId, and no other target key', async () => {
    const { user, dialog } = await openForm();
    await user.type(within(dialog).getByLabelText('Tâche'), 'Contrôle eau');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Kodjo A.' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Responsable'), 'Kodjo A.');
    fireEvent.change(within(dialog).getByLabelText('Échéance'), { target: { value: '2026-11-20' } });
    fireEvent.change(within(dialog).getByLabelText('Heure'), { target: { value: '07:30' } });
    await user.selectOptions(within(dialog).getByLabelText('Priorité'), 'Haute');
    await user.selectOptions(within(dialog).getByLabelText('Récurrence'), 'Chaque semaine');
    await user.click(within(dialog).getByRole('radio', { name: 'Lot' }));
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'LC-2026-14' })).toBeInTheDocument());
    expect(calls.some((c) => c.url.startsWith('/api/batches') && c.url.includes('status=EN_COURS'))).toBe(true);
    await user.selectOptions(within(dialog).getByLabelText('Lot'), 'LC-2026-14');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/tasks',
      body: { title: 'Contrôle eau', assigneeId: 'e1', dueDate: '2026-11-20', dueTime: '07:30', priority: 'HAUTE', recurrence: 'HEBDOMADAIRE', batchId: 'l1' },
    });
    expect(Object.keys(writes()[0].body as object).sort()).toEqual(['assigneeId', 'batchId', 'dueDate', 'dueTime', 'priority', 'recurrence', 'title']);
  });

  it('refuses a task without title or due date', async () => {
    const { user, dialog } = await openForm();
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText('Le champ « Tâche » est requis')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('edits only what changed, and clears the target (batchId: null) when it becomes Rien', async () => {
    mount();
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(rowOf('Pesée hebdomadaire LC-2026-14').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Tâches & personnel' });
    expect(within(dialog).getByRole('radio', { name: 'Lot' })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByLabelText('Lot')).toHaveValue('l1'));
    await user.selectOptions(within(dialog).getByLabelText('Priorité'), 'Urgente');
    await user.click(within(dialog).getByRole('radio', { name: 'Rien' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/tasks/t1', body: { priority: 'URGENTE', batchId: null } });
    expect(Object.keys(writes()[0].body as object).sort()).toEqual(['batchId', 'priority']);
  });
});

describe('employés tab', () => {
  const open = async (perms: Record<string, string[]>) => {
    mount({ perms });
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Employés' }));
    await screen.findByText('Kodjo A.', { selector: 'td' });
    return user;
  };

  it('lists the employees with a salary column for the accountant', async () => {
    await open(COMPTABLE);
    for (const h of ['NOM', 'POSTE', 'CONTRAT', 'TÉLÉPHONE', 'EMBAUCHE', 'STATUT', 'SALAIRE MENSUEL']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Kodjo A.', { selector: 'td' }).closest('tr'))).toBe("Kodjo A. Agent d'élevage CDI +228 90 11 22 33 2025-01-06 Actif 85 000 FCFA");
    expect(cells(screen.getByText('Yawa M.', { selector: 'td' }).closest('tr'))).toContain('Journalier');
    expect(tone(rowOf('Yawa M.'), 'Parti')).toBe('neutral');
    expect(tone(rowOf('Kodjo A.'), 'Actif')).toBe('success');
  });

  it('has no salary column without finance read', async () => {
    await open(COMPTABLE);
    cleanup();
    await open(RESP_AVICOLE);
    expect(screen.queryByRole('columnheader', { name: 'SALAIRE MENSUEL' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'NOM' })).toBeInTheDocument();
  });

  it('keeps the master data behind update: no Ajouter for a role that only creates attendance', async () => {
    await open(RESP_AVICOLE);
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).not.toBeInTheDocument();
  });

  it('adds an employee with the salary and the linked account', async () => {
    const user = await open({ ...DIRECTEUR, finance: ['read'] });
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Employés' });
    expect(within(dialog).queryByLabelText("Date de départ")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Nom affiché')).toHaveAccessibleDescription('Ex. Kodjo A.');
    await user.type(within(dialog).getByLabelText('Nom affiché'), 'Ama K.');
    await user.type(within(dialog).getByLabelText('Poste'), "Agent d'élevage");
    await user.selectOptions(within(dialog).getByLabelText('Contrat'), 'CDI');
    fireEvent.change(within(dialog).getByLabelText("Date d'embauche"), { target: { value: '2024-06-01' } });
    await user.type(within(dialog).getByLabelText('Salaire mensuel (FCFA)'), '80000');
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Awa (awa@x.tg)' })).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Compte utilisateur'), 'Awa (awa@x.tg)');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/employees',
      body: { name: 'Ama K.', jobTitle: "Agent d'élevage", contractType: 'CDI', hireDate: '2024-06-01', monthlySalary: 80000, userId: 'u5' },
    });
  });

  it('has no salary field without finance read, and the departure date when editing', async () => {
    const user = await open(DIRECTEUR);
    await user.click(rowOf('Yawa M.').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Employés' });
    expect(within(dialog).queryByLabelText('Salaire mensuel (FCFA)')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Date de départ')).toHaveValue('2026-09-30');
    await user.clear(within(dialog).getByLabelText('Date de départ'));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/employees/e3', body: { endDate: null } });
    expect(Object.keys(writes()[0].body as object)).toEqual(['endDate']);
  });
});

describe('présences tab', () => {
  const open = async (perms = RESP_AVICOLE) => {
    mount({ perms });
    await screen.findByText('Nettoyage Porcherie 2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Présences' }));
    await screen.findByText('Malade');
    return user;
  };

  it('lists the attendance with its status pills', async () => {
    await open();
    for (const h of ['DATE', 'EMPLOYÉ', 'STATUT', 'HEURES', 'NOTE']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(cells(screen.getByText('Malade').closest('tr'))).toBe('2026-10-20 Yawa M. Absent — Malade');
    expect(tone(rowOf('Malade'), 'Absent')).toBe('danger');
    expect(cells(screen.getByText('Kodjo A.', { selector: 'td' }).closest('tr'))).toBe('2026-10-20 Kodjo A. Présent 8 —');
    expect(tone(rowOf('Yawa M.'), 'Absent')).toBe('danger');
  });

  it('posts the day sheet: the grid of the employees active that day, one entry each', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Présences' });
    expect(within(dialog).getByLabelText('Date')).toHaveValue(todayIso());
    await waitFor(() => expect(within(dialog).getByText('Dr Koffi')).toBeInTheDocument());
    expect(calls.some((c) => c.url === `/api/employees/options?at=${todayIso()}`)).toBe(true);
    expect(within(dialog).getByLabelText('Statut ligne 1')).toHaveValue('PRESENT');
    fireEvent.change(within(dialog).getByLabelText('Heures ligne 1'), { target: { value: '8' } });
    await user.selectOptions(within(dialog).getByLabelText('Statut ligne 3'), 'Absent');
    await user.type(within(dialog).getByLabelText('Note ligne 3'), 'Malade');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: 'POST', url: '/api/attendance/day',
      body: {
        date: todayIso(),
        entries: [
          { employeeId: 'e1', status: 'PRESENT', hours: 8 },
          { employeeId: 'e2', status: 'PRESENT' },
          { employeeId: 'e3', status: 'ABSENT', note: 'Malade' },
        ],
      },
    });
    expect((writes()[0].body as { entries: object[] }).entries[1]).toEqual({ employeeId: 'e2', status: 'PRESENT' });
  });

  it('refuses hours on an absence before any request', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Présences' });
    await waitFor(() => expect(within(dialog).getByText('Dr Koffi')).toBeInTheDocument());
    await user.selectOptions(within(dialog).getByLabelText('Statut ligne 2'), 'Congé');
    fireEvent.change(within(dialog).getByLabelText('Heures ligne 2'), { target: { value: '4' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText("Les heures ne s'indiquent que pour une présence")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('loads the sheet already entered for the day, and follows a change of date', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ajouter — Présences' });
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-10-20' } });
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/employees/options?at=2026-10-20'))).toBe(true));
    await waitFor(() => expect(within(dialog).getByLabelText('Statut ligne 3')).toHaveValue('ABSENT'));
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-10-20');
    expect(within(dialog).getByLabelText('Heures ligne 1')).toHaveValue(8);
    expect(calls.some((c) => c.url.startsWith('/api/attendance?') && c.url.includes('from=2026-10-20') && c.url.includes('to=2026-10-20'))).toBe(true);
  });

  it('corrects a row: status, hours and note only, hours only for a presence', async () => {
    const user = await open();
    await user.click(rowOf('Malade').getByRole('button', { name: 'Modifier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier — Présences' });
    expect(within(dialog).queryByLabelText('Heures')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Statut'), 'Présent');
    fireEvent.change(within(dialog).getByLabelText('Heures'), { target: { value: '6' } });
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', url: '/api/attendance/a2', body: { status: 'PRESENT', hours: 6 } });
  });

  it('makes the attendance a daily entry: a manager without create sees no Ajouter', async () => {
    await open({ taches: ['read'], personnel: ['read'] });
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument();
  });
});
