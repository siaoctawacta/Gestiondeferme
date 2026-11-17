import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { parseDay } from '../src/common/days';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskAlertsService } from '../src/tasks/task-alerts.service';
import { TaskReads } from '../src/tasks/task-reads.service';
import type { RequestContext } from '../src/access/decorators';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { countQueries } from './query-counter';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface Task extends Id {
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string;
  dueTime: string | null;
  priority: string;
  status: string;
  overdue: boolean;
  recurrence: string;
  target: { kind: string; id: string; label: string } | null;
  completedDate: string | null;
  hasProof: boolean;
  mine: boolean;
}
interface Employee extends Id {
  name: string;
}
interface Page {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}
interface AlertsBody {
  total: number;
  items: { key: string; title: string; detail: string; level: string }[];
}

const tomorrow = () => daysAgo(-1);
const nextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15))
    .toISOString()
    .slice(0, 10);
};
const STAFF = [
  { name: 'Kodjo A.', jobTitle: "Agent d'élevage", hireDate: '2025-01-06' },
  { name: 'Dr Koffi', jobTitle: 'Vétérinaire', hireDate: '2026-01-01' },
  { name: 'Yawa M.', jobTitle: 'Ouvrière', hireDate: '2026-03-01' },
  { name: 'Ama K.', jobTitle: "Agent d'élevage", hireDate: '2024-06-01' },
];
const PHOTO_REFUSED = 'Photo invalide : JPEG, PNG ou WebP de 5 Mo au plus';
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(120, 7),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(120, 3),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x40, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(100, 1),
]);

describe('Tâches: workflow, recurrence, proof, alerts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let uploads: string;
  let director: Headers;
  let poultry: Headers;
  let agent: Headers;
  let kodjo: Employee;
  let koffi: Employee;
  let yawa: Employee;
  let ama: Employee;
  let lot: Id & { code: string };
  let pesee: Task;
  let vaccination: Task;
  let nettoyage: Task;
  let collecte: Task;

  beforeAll(async () => {
    uploads = mkdtempSync(join(tmpdir(), 'agripilot-uploads-'));
    process.env.UPLOAD_DIR = uploads;
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    rmSync(uploads, { recursive: true, force: true });
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    poultry = await world.actor('RESP_AVICOLE');
    const made: Employee[] = [];
    for (const s of STAFF) {
      made.push(
        await world.post<Employee>(director, '/employees', {
          ...s,
          contractType: 'CDI',
        }),
      );
    }
    [kodjo, koffi, yawa, ama] = made;
    const user = await createUser({
      organizationId: world.orgId,
      role: 'AGENT_ELEVAGE',
      farmIds: [world.farmId],
      name: 'Kodjo Agent',
    });
    agent = {
      Authorization: `Bearer ${await tokenFor(user.id)}`,
      'X-Farm-Id': world.farmId,
    };
    await world
      .http()
      .patch(`/api/employees/${kodjo.id}`)
      .set(director)
      .send({ userId: user.id })
      .expect(200);
    lot = await world.lot(poultry);
  });

  afterAll(async () => {
    rmSync(uploads, { recursive: true, force: true });
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const make = (body: Record<string, unknown>, h = poultry) =>
    world.post<Task>(h, '/tasks', { dueDate: '2026-10-23', ...body });
  const act = (
    id: string,
    verb: string,
    body: object = {},
    status = 200,
    h: Headers = poultry,
  ) =>
    http()
      .post(`/api/tasks/${id}/${verb}`)
      .set(h)
      .send(body)
      .expect(status)
      .then((res) => res.body as Task & Msg);
  const patch = (id: string, body: object, status = 200, h = poultry) =>
    http()
      .patch(`/api/tasks/${id}`)
      .set(h)
      .send(body)
      .expect(status)
      .then((res) => res.body as Task & Msg);
  const list = (query = '', h = poultry) =>
    http()
      .get(`/api/tasks${query}`)
      .set(h)
      .expect(200)
      .then((res) => res.body as Page);
  const message = (res: { message: string | string[] }) => res.message;
  const audit = () =>
    prisma.auditLog.findMany({
      where: { module: 'taches' },
      orderBy: { createdAt: 'asc' },
    });

  /** The four reference tasks of the demo data. */
  const reference = async () => {
    pesee = await make({
      title: 'Pesée hebdomadaire LC-2026-14',
      assigneeId: kodjo.id,
      dueDate: '2026-10-23',
      priority: 'NORMALE',
      batchId: lot.id,
      recurrence: 'HEBDOMADAIRE',
    });
    vaccination = await make({
      title: 'Vaccination Gumboro LC-2026-15',
      assigneeId: koffi.id,
      dueDate: '2026-10-24',
      priority: 'HAUTE',
    });
    nettoyage = await make({
      title: 'Nettoyage Porcherie 2',
      assigneeId: yawa.id,
      dueDate: '2026-10-18',
      priority: 'URGENTE',
      buildingId: world.pigBld,
    });
    await act(nettoyage.id, 'start');
    collecte = await make({
      title: 'Collecte des œufs',
      assigneeId: ama.id,
      dueDate: '2026-10-22',
    });
    await act(collecte.id, 'complete', { date: daysAgo(1) });
  };

  describe('the list', () => {
    it('lists the reference tasks with their shape, counts and the default order', async () => {
      await reference();
      const page = await list();
      expect(page.statusCounts).toEqual({
        A_FAIRE: 2,
        EN_COURS: 1,
        TERMINEE: 1,
      });
      expect(page).toMatchObject({ total: 4, page: 1, pageSize: 25 });
      expect(page.items.map((t) => t.title)).toEqual([
        'Nettoyage Porcherie 2',
        'Collecte des œufs',
        'Pesée hebdomadaire LC-2026-14',
        'Vaccination Gumboro LC-2026-15',
      ]);
      const [clean, eggs, weigh, vacc] = page.items;
      expect(clean).toMatchObject({
        id: nettoyage.id,
        description: null,
        assigneeId: yawa.id,
        assigneeName: 'Yawa M.',
        dueDate: '2026-10-18',
        dueTime: null,
        priority: 'URGENTE',
        status: 'EN_COURS',
        overdue: true,
        recurrence: 'AUCUNE',
        target: { kind: 'BATIMENT', id: world.pigBld, label: 'Porcherie' },
        completedDate: null,
        hasProof: false,
        mine: false,
      });
      expect(eggs).toMatchObject({
        status: 'TERMINEE',
        overdue: false,
        completedDate: daysAgo(1),
        target: null,
      });
      expect(weigh).toMatchObject({
        status: 'A_FAIRE',
        overdue: true,
        recurrence: 'HEBDOMADAIRE',
        target: { kind: 'LOT', id: lot.id, label: lot.code },
      });
      expect(vacc).toMatchObject({
        priority: 'HAUTE',
        assigneeName: 'Dr Koffi',
      });
    });

    it('orders by due date, then urgent first, then title', async () => {
      await make({ title: 'B normale', priority: 'NORMALE' });
      await make({ title: 'A normale', priority: 'NORMALE' });
      await make({ title: 'C urgente', priority: 'URGENTE' });
      await make({ title: 'D haute', priority: 'HAUTE' });
      await make({ title: 'Z plus tard', dueDate: '2026-10-24' });
      expect((await list()).items.map((t) => t.title)).toEqual([
        'C urgente',
        'D haute',
        'A normale',
        'B normale',
        'Z plus tard',
      ]);
      expect(
        (await list('?sort=title:desc')).items.map((t) => t.title)[0],
      ).toBe('Z plus tard');
      expect(
        (await list('?sort=dueDate:desc')).items.map((t) => t.title)[0],
      ).toBe('Z plus tard');
      expect(
        (await list('?sort=priority:desc')).items.map((t) => t.priority)[0],
      ).toBe('URGENTE');
      await http().get('/api/tasks?sort=cost:asc').set(poultry).expect(400);
    });

    it('filters by status, assignee, priority, period, search and target, counts staying over the other filters', async () => {
      await reference();
      const titles = async (q: string) =>
        (await list(q)).items.map((t) => t.title);
      expect(await titles('?status=EN_COURS')).toEqual([
        'Nettoyage Porcherie 2',
      ]);
      const open = await list('?status=A_FAIRE');
      expect(open.total).toBe(2);
      expect(open.statusCounts).toEqual({
        A_FAIRE: 2,
        EN_COURS: 1,
        TERMINEE: 1,
      });
      expect(await titles(`?assigneeId=${kodjo.id}`)).toEqual([
        'Pesée hebdomadaire LC-2026-14',
      ]);
      expect(await titles('?priority=HAUTE')).toEqual([
        'Vaccination Gumboro LC-2026-15',
      ]);
      expect(await titles('?from=2026-10-23&to=2026-10-24')).toEqual([
        'Pesée hebdomadaire LC-2026-14',
        'Vaccination Gumboro LC-2026-15',
      ]);
      expect(await titles('?search=yawa')).toEqual(['Nettoyage Porcherie 2']);
      expect(await titles('?search=GUMBORO')).toEqual([
        'Vaccination Gumboro LC-2026-15',
      ]);
      expect(await titles(`?batchId=${lot.id}`)).toEqual([
        'Pesée hebdomadaire LC-2026-14',
      ]);
      expect(await titles(`?buildingId=${world.pigBld}`)).toEqual([
        'Nettoyage Porcherie 2',
      ]);
      expect(await titles('?equipmentId=nope')).toEqual([]);
      const counted = await list('?priority=NORMALE');
      expect(counted.statusCounts).toEqual({
        A_FAIRE: 1,
        EN_COURS: 0,
        TERMINEE: 1,
      });
      for (const bad of [
        'status=FINI',
        'priority=X',
        'mine=maybe',
        'from=hier',
      ]) {
        await http().get(`/api/tasks?${bad}`).set(poultry).expect(400);
      }
    });

    it('exports the list in French, the status and priority as labels', async () => {
      await reference();
      const res = await http()
        .get('/api/tasks?format=csv')
        .set(poultry)
        .expect(200);
      const lines = res.text.replace(/^\uFEFF/, '').split(/\r?\n/);
      expect(lines[0]).toBe(
        'Tâche;Responsable;Échéance;Heure;Priorité;Statut;Cible;Récurrence',
      );
      expect(lines[1]).toBe(
        'Nettoyage Porcherie 2;Yawa M.;2026-10-18;;Urgente;En cours;Porcherie;Aucune',
      );
      await http().get('/api/tasks?format=xlsx').set(poultry).expect(200);
    });

    it('gets one task, 404 for an unknown one, and 404 for the other farm', async () => {
      await reference();
      const one = await http()
        .get(`/api/tasks/${pesee.id}`)
        .set(poultry)
        .expect(200);
      expect(one.body).toMatchObject({ id: pesee.id, title: pesee.title });
      await http().get('/api/tasks/nope').set(poultry).expect(404);
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const userB = await createUser({
        organizationId: world.orgId,
        role: 'RESP_AVICOLE',
        farmIds: [farmB.id],
      });
      const other = {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      };
      await http().get(`/api/tasks/${pesee.id}`).set(other).expect(404);
      await act(pesee.id, 'start', {}, 404, other);
      await patch(pesee.id, { title: 'x' }, 404, other);
      await http().delete(`/api/tasks/${pesee.id}`).set(other).expect(404);
      expect((await list('', other)).total).toBe(0);
    });
  });

  describe('permissions', () => {
    it('lets the agent advance only his own tasks, and see them with mine=true', async () => {
      await reference();
      await http()
        .post('/api/tasks')
        .set(agent)
        .send({ title: 'x', dueDate: '2026-10-23' })
        .expect(403);
      const started = await act(pesee.id, 'start', {}, 200, agent);
      expect(started).toMatchObject({ status: 'EN_COURS', mine: true });
      const refused = await act(nettoyage.id, 'complete', {}, 403, agent);
      expect(message(refused)).toBe(
        'Vous ne pouvez faire avancer que les tâches qui vous sont assignées',
      );
      await act(vaccination.id, 'start', {}, 403, agent);
      const mine = await list('?mine=true', agent);
      expect(mine.items.map((t) => t.id)).toEqual([pesee.id]);
      expect((await list('', agent)).items.filter((t) => t.mine)).toHaveLength(
        1,
      );
      expect(mine.statusCounts).toEqual({
        A_FAIRE: 0,
        EN_COURS: 1,
        TERMINEE: 0,
      });
      // His own task may be completed and reopened by him, never edited or deleted.
      await act(pesee.id, 'complete', {}, 200, agent);
      await patch(pesee.id, { title: 'y' }, 403, agent);
      await http().delete(`/api/tasks/${pesee.id}`).set(agent).expect(403);
    });

    it('does not let the agent advance an unassigned task', async () => {
      const loose = await make({ title: 'Sans responsable' });
      await act(loose.id, 'start', {}, 403, agent);
      await act(loose.id, 'start');
    });

    it('lets a manager advance any task, a reader only read', async () => {
      await reference();
      const auditor = await world.actor('AUDITEUR');
      expect((await list('', auditor)).total).toBe(4);
      await act(vaccination.id, 'start', {}, 403, auditor);
      await http()
        .post('/api/tasks')
        .set(auditor)
        .send({ title: 'x', dueDate: '2026-10-23' })
        .expect(403);
    });

    it('refuses a role without taches read, and hides the alert from it', async () => {
      await reference();
      const sales = await world.actor('COMMERCIAL');
      await http().get('/api/tasks').set(sales).expect(403);
      const seen = await http().get('/api/alerts').set(sales).expect(200);
      expect(
        (seen.body as AlertsBody).items.some(
          (a) => a.title === 'Tâche en retard',
        ),
      ).toBe(false);
      const own = await http().get('/api/alerts').set(poultry).expect(200);
      expect(
        (own.body as AlertsBody).items.filter(
          (a) => a.title === 'Tâche en retard',
        ),
      ).toHaveLength(3);
    });

    it('refuses to write under all farms', async () => {
      await http()
        .post('/api/tasks')
        .set({ ...poultry, 'X-Farm-Id': 'all' })
        .send({ title: 'x', dueDate: '2026-10-23' })
        .expect(403);
    });
  });

  describe('writes and validation', () => {
    it('creates a task with its defaults, a planned due date in the future included', async () => {
      const created = await make({
        title: '  Contrôle  ',
        dueDate: nextMonth(),
      });
      expect(created).toMatchObject({
        title: 'Contrôle',
        priority: 'NORMALE',
        status: 'A_FAIRE',
        recurrence: 'AUCUNE',
        assigneeId: null,
        assigneeName: null,
        target: null,
        overdue: false,
        hasProof: false,
        mine: false,
      });
      const timed = await make({ title: 'Heure', dueTime: '06:30' });
      expect(timed.dueTime).toBe('06:30');
    });

    it('validates the body', async () => {
      const bad = (body: object) =>
        http()
          .post('/api/tasks')
          .set(poultry)
          .send({ title: 'x', dueDate: '2026-10-23', ...body })
          .expect(400);
      await bad({ title: '' });
      await bad({ title: undefined });
      await bad({ dueDate: undefined });
      await bad({ dueDate: '2026-02-30' });
      await bad({ dueTime: '25:00' });
      await bad({ dueTime: '6:30' });
      await bad({ priority: 'MAX' });
      await bad({ recurrence: 'ANNUELLE' });
      await bad({ extra: 1 });
      await bad({ priority: null });
    });

    it('checks the assignee: of the farm, and in post on the due date', async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const stranger = await prisma.employee.create({
        data: {
          farmId: farmB.id,
          name: 'Étranger',
          jobTitle: 'x',
          contractType: 'CDI',
          hireDate: new Date('2025-01-01'),
        },
      });
      const wrong = await http()
        .post('/api/tasks')
        .set(poultry)
        .send({ title: 'x', dueDate: '2026-10-23', assigneeId: stranger.id })
        .expect(400);
      expect((wrong.body as Msg).message).toBe(
        'Responsable invalide pour cette ferme',
      );
      const early = await http()
        .post('/api/tasks')
        .set(poultry)
        .send({ title: 'x', dueDate: '2026-02-01', assigneeId: yawa.id })
        .expect(400);
      expect((early.body as Msg).message).toBe(
        "Yawa M. n'est pas en poste à cette date",
      );
      const left = await prisma.employee.update({
        where: { id: ama.id },
        data: { endDate: new Date('2026-06-30') },
      });
      const late = await http()
        .post('/api/tasks')
        .set(poultry)
        .send({ title: 'x', dueDate: '2026-07-01', assigneeId: left.id })
        .expect(400);
      expect((late.body as Msg).message).toBe(
        "Ama K. n'est pas en poste à cette date",
      );
      await make({ title: 'ok', dueDate: '2026-06-30', assigneeId: ama.id });
    });

    it('checks the target: of the farm, open, and at most one', async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const siteB = await prisma.site.create({
        data: { farmId: farmB.id, name: 'Site B' },
      });
      const buildingB = await prisma.building.create({
        data: {
          farmId: farmB.id,
          siteId: siteB.id,
          name: 'B1',
          type: 'AVICOLE',
          capacity: 10,
        },
      });
      const bad = async (body: object, expected: string) => {
        const res = await http()
          .post('/api/tasks')
          .set(poultry)
          .send({ title: 'x', dueDate: '2026-10-23', ...body })
          .expect(400);
        expect((res.body as Msg).message).toBe(expected);
      };
      await bad(
        { buildingId: buildingB.id },
        'Bâtiment invalide pour cette ferme',
      );
      await bad({ batchId: 'nope' }, 'Lot invalide pour cette ferme');
      await bad(
        { equipmentId: 'nope' },
        'Équipement invalide pour cette ferme',
      );
      await bad(
        { batchId: lot.id, buildingId: world.pigBld },
        'Une tâche concerne au plus un lot, un bâtiment ou un équipement',
      );
      await bad(
        { batchId: lot.id, equipmentId: 'x' },
        'Une tâche concerne au plus un lot, un bâtiment ou un équipement',
      );
      await prisma.animalBatch.update({
        where: { id: lot.id },
        data: { status: 'CLOTURE' },
      });
      await bad({ batchId: lot.id }, 'Lot invalide pour cette ferme');
    });

    it('edits an open task, clearing optional fields with null, and refuses nulls elsewhere', async () => {
      const task = await make({
        title: 'Complète',
        description: 'Détail',
        assigneeId: kodjo.id,
        dueTime: '07:00',
        batchId: lot.id,
      });
      const cleared = await patch(task.id, {
        description: null,
        assigneeId: null,
        dueTime: null,
        batchId: null,
      });
      expect(cleared).toMatchObject({
        description: null,
        assigneeId: null,
        assigneeName: null,
        dueTime: null,
        target: null,
      });
      const moved = await patch(task.id, {
        buildingId: world.pigBld,
        priority: 'HAUTE',
        title: 'Renommée',
      });
      expect(moved).toMatchObject({
        title: 'Renommée',
        priority: 'HAUTE',
        target: { kind: 'BATIMENT', label: 'Porcherie' },
      });
      const both = await patch(task.id, { batchId: lot.id }, 400);
      expect(message(both)).toBe(
        'Une tâche concerne au plus un lot, un bâtiment ou un équipement',
      );
      const swapped = await patch(task.id, {
        batchId: lot.id,
        buildingId: null,
      });
      expect(swapped.target).toMatchObject({ kind: 'LOT', id: lot.id });
      for (const key of ['title', 'dueDate', 'priority', 'recurrence']) {
        await patch(task.id, { [key]: null }, 400);
      }
      await patch(task.id, { dueDate: '2026-02-30' }, 400);
      await patch(task.id, { status: 'TERMINEE' }, 400);
    });

    it('re-checks the assignee when the assignee or the due date change', async () => {
      const task = await make({ title: 't', assigneeId: yawa.id });
      const res = await patch(task.id, { dueDate: '2026-02-01' }, 400);
      expect(message(res)).toBe("Yawa M. n'est pas en poste à cette date");
      await patch(task.id, { assigneeId: ama.id, dueDate: '2026-02-01' });
    });

    it('deletes an open task and refuses a finished one', async () => {
      const open = await make({ title: 'À supprimer' });
      await http().delete(`/api/tasks/${open.id}`).set(poultry).expect(200);
      await http().get(`/api/tasks/${open.id}`).set(poultry).expect(404);
      const done = await make({ title: 'Faite' });
      await act(done.id, 'complete', { date: daysAgo(0) });
      const refused = await http()
        .delete(`/api/tasks/${done.id}`)
        .set(poultry)
        .expect(409);
      expect((refused.body as Msg).message).toBe(
        'Une tâche terminée ne peut pas être supprimée',
      );
    });
  });

  describe('workflow and recurrence', () => {
    it('refuses what the status does not allow, with the exact messages', async () => {
      const task = await make({ title: 't' });
      const started = await act(task.id, 'start');
      expect(started).toMatchObject({ status: 'EN_COURS' });
      expect(message(await act(task.id, 'start', {}, 409))).toBe(
        'Seule une tâche à faire peut être démarrée',
      );
      expect(message(await act(task.id, 'reopen', {}, 409))).toBe(
        'Seule une tâche terminée peut être rouverte',
      );
      const done = await act(task.id, 'complete', { date: daysAgo(0) });
      expect(done).toMatchObject({
        status: 'TERMINEE',
        completedDate: daysAgo(0),
        overdue: false,
      });
      expect(message(await act(task.id, 'complete', {}, 409))).toBe(
        'Cette tâche est déjà terminée',
      );
      expect(message(await act(task.id, 'start', {}, 409))).toBe(
        'Seule une tâche à faire peut être démarrée',
      );
      expect(message(await patch(task.id, { title: 'y' }, 409))).toBe(
        'Une tâche terminée ne peut plus être modifiée : rouvrez-la',
      );
      const reopened = await act(task.id, 'reopen');
      expect(reopened).toMatchObject({
        status: 'A_FAIRE',
        completedDate: null,
      });
      await act(task.id, 'start');
    });

    it('checks the completion date: default today, never future, not long before the due date', async () => {
      const task = await make({ title: 't', dueDate: '2026-10-23' });
      const future = await act(task.id, 'complete', { date: tomorrow() }, 400);
      expect(message(future)).toBe('La date ne peut pas être dans le futur');
      const early = await act(task.id, 'complete', { date: '2026-09-22' }, 400);
      expect(message(early)).toBe('Date de réalisation invalide');
      await act(task.id, 'complete', { date: 'hier' }, 400);
      await act(task.id, 'complete', { date: '2026-09-23' });
      const second = await make({ title: 'défaut' });
      expect((await act(second.id, 'complete')).completedDate).toBe(daysAgo(0));
    });

    it('creates the next occurrence on completion and deletes it on reopen while untouched', async () => {
      await reference();
      const done = await act(pesee.id, 'complete', { date: '2026-11-14' });
      expect(done.completedDate).toBe('2026-11-14');
      const next = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: pesee.id },
      });
      expect(next).toMatchObject({
        title: 'Pesée hebdomadaire LC-2026-14',
        status: 'A_FAIRE',
        assigneeId: kodjo.id,
        priority: 'NORMALE',
        recurrence: 'HEBDOMADAIRE',
        batchId: lot.id,
        completedDate: null,
        proofPath: null,
        farmId: world.farmId,
      });
      expect(next.dueDate.toISOString().slice(0, 10)).toBe('2026-10-30');
      expect((await list()).statusCounts).toEqual({
        A_FAIRE: 2,
        EN_COURS: 1,
        TERMINEE: 2,
      });

      await act(pesee.id, 'reopen');
      expect(
        await prisma.task.count({ where: { previousTaskId: pesee.id } }),
      ).toBe(0);
      expect(await prisma.task.count()).toBe(4);

      await act(pesee.id, 'complete', { date: '2026-11-14' });
      const again = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: pesee.id },
      });
      await act(again.id, 'start');
      const blocked = await act(pesee.id, 'reopen', {}, 409);
      expect(message(blocked)).toBe(
        "L'occurrence suivante a déjà commencé : rouvrez-la ou modifiez-la",
      );
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: pesee.id } }))
          .status,
      ).toBe('TERMINEE');
    });

    it('keeps an occurrence that has a proof when its predecessor is reopened', async () => {
      const task = await make({ title: 'Hebdo', recurrence: 'HEBDOMADAIRE' });
      await act(task.id, 'complete', { date: daysAgo(0) });
      const next = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: task.id },
      });
      await http()
        .post(`/api/tasks/${next.id}/proof`)
        .set(poultry)
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      await act(task.id, 'reopen', {}, 409);
    });

    it('creates the next occurrence of other recurrences, clamped to the month', async () => {
      const daily = await make({
        title: 'Jour',
        recurrence: 'QUOTIDIENNE',
        dueDate: '2026-10-31',
      });
      await act(daily.id, 'complete', { date: '2026-11-01' });
      const monthly = await make({
        title: 'Mois',
        recurrence: 'MENSUELLE',
        dueDate: '2026-10-31',
      });
      await act(monthly.id, 'complete', { date: '2026-11-01' });
      const due = async (id: string) =>
        (
          await prisma.task.findFirstOrThrow({ where: { previousTaskId: id } })
        ).dueDate
          .toISOString()
          .slice(0, 10);
      expect(await due(daily.id)).toBe('2026-11-01');
      expect(await due(monthly.id)).toBe('2026-11-30');
    });

    it('keeps a monthly series on its anchor day: 31 Jan, 28 Feb, 31 Mar, 30 Apr', async () => {
      let task = await make({
        title: 'Loyer',
        recurrence: 'MENSUELLE',
        dueDate: '2026-01-31',
      });
      const dues: string[] = [];
      for (let i = 0; i < 3; i++) {
        await act(task.id, 'complete', { date: '2026-11-10' });
        const next = await prisma.task.findFirstOrThrow({
          where: { previousTaskId: task.id },
        });
        dues.push(next.dueDate.toISOString().slice(0, 10));
        task = { ...task, id: next.id };
      }
      expect(dues).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('re-anchors the series when the due date of an occurrence is edited', async () => {
      const first = await make({
        title: 'Loyer',
        recurrence: 'MENSUELLE',
        dueDate: '2026-01-31',
      });
      await act(first.id, 'complete', { date: '2026-11-10' });
      const next = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: first.id },
      });
      await patch(next.id, { dueDate: '2026-02-20' });
      await act(next.id, 'complete', { date: '2026-11-10' });
      const third = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: next.id },
      });
      expect(third.dueDate.toISOString().slice(0, 10)).toBe('2026-03-20');
    });

    it('creates the occurrence without its lot when the lot has been closed, and still completes', async () => {
      const task = await make({
        title: 'Pesée',
        recurrence: 'HEBDOMADAIRE',
        batchId: lot.id,
      });
      await prisma.animalBatch.update({
        where: { id: lot.id },
        data: { status: 'CLOTURE' },
      });
      const done = await act(task.id, 'complete', { date: daysAgo(0) });
      expect(done.status).toBe('TERMINEE');
      const next = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: task.id },
      });
      expect(next).toMatchObject({ batchId: null, title: 'Pesée' });
    });

    it('creates the occurrence unassigned when the assignee has left by then', async () => {
      const task = await make({
        title: 'Hebdo',
        assigneeId: kodjo.id,
        recurrence: 'HEBDOMADAIRE',
        dueDate: '2026-10-23',
      });
      await prisma.employee.update({
        where: { id: kodjo.id },
        data: { endDate: new Date('2026-10-25') },
      });
      await act(task.id, 'complete', { date: '2026-10-24' });
      const next = await prisma.task.findFirstOrThrow({
        where: { previousTaskId: task.id },
      });
      expect(next.assigneeId).toBeNull();
    });

    it('creates one occurrence only when two completions race', async () => {
      const task = await make({ title: 'Course', recurrence: 'QUOTIDIENNE' });
      const results = await Promise.all([
        http().post(`/api/tasks/${task.id}/complete`).set(poultry).send({}),
        http().post(`/api/tasks/${task.id}/complete`).set(director).send({}),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.task.count({ where: { previousTaskId: task.id } }),
      ).toBe(1);
    });

    it('audits one row per action, plus the generated occurrence', async () => {
      const task = await make({
        title: 'Audit',
        recurrence: 'HEBDOMADAIRE',
        dueDate: '2026-10-23',
      });
      await patch(task.id, { title: 'Audit 2' });
      await patch(task.id, { title: 'Audit 2' });
      await act(task.id, 'start');
      await act(task.id, 'complete', { date: '2026-11-14' });
      await act(task.id, 'reopen');
      await http()
        .post(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      await http()
        .delete(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .expect(200);
      await http().delete(`/api/tasks/${task.id}`).set(poultry).expect(200);
      const rows = await audit();
      // One transaction shares one timestamp: compare as a set.
      expect(rows.map((r) => `${r.action}:${r.label}`).sort()).toEqual(
        [
          'CREATE:Audit',
          'UPDATE:Audit 2',
          'UPDATE:Audit 2',
          'UPDATE:Audit 2',
          'UPDATE:Audit 2',
          'UPDATE:Audit 2',
          'UPDATE:Audit 2',
          'CREATE:Audit 2',
          'DELETE:Audit 2',
          'DELETE:Audit 2',
        ].sort(),
      );
      expect(rows.every((r) => r.farmId === world.farmId)).toBe(true);
    });
  });

  describe('proof photo', () => {
    const upload = (
      id: string,
      file: Buffer,
      filename = 'photo.png',
      status = 201,
      h: Headers = poultry,
    ) =>
      http()
        .post(`/api/tasks/${id}/proof`)
        .set(h)
        .attach('file', file, { filename })
        .expect(status);
    const files = () =>
      existsSync(join(uploads, 'tasks'))
        ? readdirSync(join(uploads, 'tasks')).flatMap((farm) =>
            readdirSync(join(uploads, 'tasks', farm)).map(
              (f) => `${farm}/${f}`,
            ),
          )
        : [];

    it('stores a valid PNG under the farm folder with a generated name, and serves it back', async () => {
      const task = await make({ title: 'Preuve' });
      const res = await upload(task.id, PNG, '../../etc/passwd.png');
      expect(res.body).toMatchObject({ id: task.id, hasProof: true });
      const row = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(row.proofMime).toBe('image/png');
      expect(row.proofPath).toMatch(
        new RegExp(`^tasks/${world.farmId}/[0-9a-f-]{36}\\.png$`),
      );
      expect(readFileSync(join(uploads, row.proofPath as string))).toEqual(PNG);
      expect(files()).toHaveLength(1);
      const got = await http()
        .get(`/api/tasks/${task.id}/proof`)
        .set(director)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(got.headers['content-type']).toBe('image/png');
      expect(got.headers['cache-control']).toBe('private, no-store');
      expect(got.body).toEqual(PNG);
      expect((await list('?search=Preuve')).items[0].hasProof).toBe(true);
    });

    it('detects the type from the bytes, never from the client name or type', async () => {
      const task = await make({ title: 'Types' });
      await upload(task.id, JPEG, 'x.png');
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
          .proofMime,
      ).toBe('image/jpeg');
      await upload(task.id, WEBP, 'x.jpg');
      const row = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(row.proofMime).toBe('image/webp');
      expect(row.proofPath).toMatch(/\.webp$/);
      expect(files()).toHaveLength(1);
    });

    it('refuses a photo that is too big, not an image, or missing', async () => {
      const task = await make({ title: 'Refus' });
      const big = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]);
      const tooBig = await upload(task.id, big, 'big.jpg', 400);
      expect((tooBig.body as Msg).message).toBe(PHOTO_REFUSED);
      const text = await upload(
        task.id,
        Buffer.from('ceci est du texte'),
        'x.png',
        400,
      );
      expect((text.body as Msg).message).toBe(PHOTO_REFUSED);
      const gif = await upload(
        task.id,
        Buffer.from('GIF89a......'),
        'x.gif',
        400,
      );
      expect((gif.body as Msg).message).toBe(PHOTO_REFUSED);
      const empty = await upload(task.id, Buffer.alloc(0), 'x.png', 400);
      expect((empty.body as Msg).message).toBe(PHOTO_REFUSED);
      const none = await http()
        .post(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .send({})
        .expect(400);
      expect((none.body as Msg).message).toBe(PHOTO_REFUSED);
      expect(files()).toHaveLength(0);
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: task.id } }))
          .proofPath,
      ).toBeNull();
    });

    it('refuses a text field next to the file', async () => {
      const task = await make({ title: 'Champ' });
      const res = await http()
        .post(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .field('note', 'x')
        .attach('file', PNG, { filename: 'a.png' })
        .expect(400);
      expect((res.body as Msg).message).toBe(PHOTO_REFUSED);
      expect(files()).toHaveLength(0);
    });

    it('keeps the new photo when the old file cannot be removed, on replacement and on deletion of the task', async () => {
      const task = await make({ title: 'Remplacée' });
      // A directory where the old file should be: its removal fails.
      const stuck = `tasks/${world.farmId}/stuck`;
      mkdirSync(join(uploads, stuck), { recursive: true });
      await prisma.task.update({
        where: { id: task.id },
        data: { proofPath: stuck, proofMime: 'image/png' },
      });
      const res = await upload(task.id, JPEG, 'b.jpg');
      expect(res.body).toMatchObject({ hasProof: true });
      const row = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(row.proofPath).toMatch(/\.jpg$/);
      expect(existsSync(join(uploads, row.proofPath as string))).toBe(true);
      await prisma.task.update({
        where: { id: task.id },
        data: { proofPath: stuck },
      });
      await http().delete(`/api/tasks/${task.id}`).set(poultry).expect(200);
    });

    it('accepts a photo on a completed task, replaces the previous file, and removes it with DELETE', async () => {
      const task = await make({ title: 'Terminée' });
      await act(task.id, 'complete', { date: daysAgo(0) });
      await upload(task.id, PNG);
      const first = files();
      expect(first).toHaveLength(1);
      await upload(task.id, JPEG, 'b.jpg');
      expect(files()).toHaveLength(1);
      expect(files()).not.toEqual(first);
      await http()
        .delete(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .expect(200);
      expect(files()).toHaveLength(0);
      expect((await act(task.id, 'reopen')).hasProof).toBe(false);
      await http().get(`/api/tasks/${task.id}/proof`).set(poultry).expect(404);
      await http()
        .delete(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .expect(404);
    });

    it('answers 404, not 500, when the stored file has gone missing', async () => {
      const task = await make({ title: 'Perdue' });
      await upload(task.id, PNG);
      rmSync(join(uploads, 'tasks'), { recursive: true, force: true });
      const res = await http()
        .get(`/api/tasks/${task.id}/proof`)
        .set(poultry)
        .expect(404);
      expect((res.body as Msg).message).toBe('Photo introuvable');
    });

    it('removes the photo of a task that is deleted', async () => {
      const task = await make({ title: 'Supprimée' });
      await upload(task.id, PNG);
      expect(files()).toHaveLength(1);
      await http().delete(`/api/tasks/${task.id}`).set(poultry).expect(200);
      expect(files()).toHaveLength(0);
    });

    it("answers 404 for another farm's proof and the assignee rule for the agent", async () => {
      const task = await make({ title: 'Mienne', assigneeId: kodjo.id });
      const other = await make({ title: 'Autre', assigneeId: yawa.id });
      await upload(task.id, PNG, 'a.png', 201, agent);
      await upload(other.id, PNG, 'a.png', 403, agent);
      await http().get(`/api/tasks/${task.id}/proof`).set(agent).expect(200);
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const userB = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [farmB.id],
      });
      const headersB = {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      };
      await http().get(`/api/tasks/${task.id}/proof`).set(headersB).expect(404);
      await upload(task.id, PNG, 'a.png', 404, headersB);
      await http()
        .delete(`/api/tasks/${task.id}/proof`)
        .set(headersB)
        .expect(404);
      const sales = await world.actor('COMMERCIAL');
      await http().get(`/api/tasks/${task.id}/proof`).set(sales).expect(403);
    });
  });

  describe('alerts, dashboard figures and employees', () => {
    const ctxOf = (): RequestContext => ({
      user: {
        id: 'u',
        name: 'u',
        role: 'RESP_AVICOLE',
        organizationId: world.orgId,
      },
      farmId: world.farmId,
      allFarms: false,
      farmIds: [world.farmId],
    });

    it('runs the overdue rule in one query whatever the number of tasks, listing them in order', async () => {
      const service = app.get(TaskAlertsService);
      const run = () =>
        countQueries(app, async () => {
          await service.overdue(ctxOf(), parseDay(daysAgo(0)) as Date);
        });
      await reference();
      expect(await run()).toBe(1);
      const day = parseDay('2026-10-01') as Date;
      const user = await prisma.user.findFirstOrThrow();
      await prisma.task.createMany({
        data: Array.from({ length: 57 }, (_, i) => ({
          farmId: world.farmId,
          title: `Retard ${i}`,
          dueDate: day,
          assigneeId: i % 2 ? kodjo.id : null,
          createdById: user.id,
        })),
      });
      expect(await run()).toBe(1);
      const alerts = await http().get('/api/alerts').set(poultry).expect(200);
      const late = (alerts.body as AlertsBody).items.filter(
        (a) => a.title === 'Tâche en retard',
      );
      expect(late).toHaveLength(60);
      expect(late.every((a) => a.level === 'A_VOIR')).toBe(true);
    });

    it('lists the overdue alerts in order with the reference details, none for a task due today', async () => {
      await reference();
      await make({ title: 'Aujourd’hui', dueDate: daysAgo(0) });
      const alerts = await http().get('/api/alerts').set(poultry).expect(200);
      const late = (alerts.body as AlertsBody).items.filter(
        (a) => a.title === 'Tâche en retard',
      );
      expect(late.map((a) => a.detail)).toEqual([
        'Nettoyage Porcherie 2 (Yawa M.)',
        'Pesée hebdomadaire LC-2026-14 (Kodjo A.)',
        'Vaccination Gumboro LC-2026-15 (Dr Koffi)',
      ]);
      expect(late.map((a) => a.key)).toEqual([
        `task:${nettoyage.id}`,
        `task:${pesee.id}`,
        `task:${vaccination.id}`,
      ]);
    });

    it('answers the counts, the upcoming tasks and the period figures of TaskReads', async () => {
      await reference();
      const reads = app.get(TaskReads);
      const farmIds = [world.farmId];
      const now = parseDay(daysAgo(0)) as Date;
      expect(await reads.counts(farmIds, now)).toEqual({ done: 1, pending: 3 });
      const upcoming = await reads.upcoming(farmIds, 5);
      expect(upcoming).toEqual([
        {
          id: nettoyage.id,
          title: 'Nettoyage Porcherie 2',
          assignee: 'Yawa M.',
          dueDate: '2026-10-18',
          priority: 'URGENTE',
        },
        {
          id: pesee.id,
          title: 'Pesée hebdomadaire LC-2026-14',
          assignee: 'Kodjo A.',
          dueDate: '2026-10-23',
          priority: 'NORMALE',
        },
        {
          id: vaccination.id,
          title: 'Vaccination Gumboro LC-2026-15',
          assignee: 'Dr Koffi',
          dueDate: '2026-10-24',
          priority: 'HAUTE',
        },
      ]);
      expect(await reads.upcoming(farmIds, 2)).toHaveLength(2);
      const figures = await reads.periodFigures(
        farmIds,
        parseDay('2026-10-01') as Date,
        parseDay('2026-10-31') as Date,
      );
      // The tasks were all created today: none existed at the end of October.
      expect(figures).toEqual({ completed: 0, overdueAtEnd: 0, created: 0 });
      const user = await prisma.user.findFirstOrThrow();
      await prisma.task.create({
        data: {
          farmId: world.farmId,
          title: 'Ancienne',
          dueDate: parseDay('2026-10-15') as Date,
          createdAt: new Date('2026-10-10T08:00:00Z'),
          createdById: user.id,
        },
      });
      // Due on the last day of the period and still open at its end: overdue at the end.
      await prisma.task.create({
        data: {
          farmId: world.farmId,
          title: 'Échue le 31',
          dueDate: parseDay('2026-10-31') as Date,
          createdAt: new Date('2026-10-12T08:00:00Z'),
          createdById: user.id,
        },
      });
      expect(
        await reads.periodFigures(
          farmIds,
          parseDay('2026-10-01') as Date,
          parseDay('2026-10-31') as Date,
        ),
      ).toEqual({ completed: 0, overdueAtEnd: 2, created: 2 });
      const wide = await reads.periodFigures(
        farmIds,
        parseDay('2026-10-01') as Date,
        now,
      );
      expect(wide).toEqual({ completed: 1, overdueAtEnd: 5, created: 6 });
    });

    it('counts the tasks completed in the last 30 days only, today and 29 days back included', async () => {
      const reads = app.get(TaskReads);
      const user = await prisma.user.findFirstOrThrow();
      const done = (title: string, ago: number) =>
        prisma.task.create({
          data: {
            farmId: world.farmId,
            title,
            dueDate: parseDay('2026-01-01') as Date,
            status: 'TERMINEE',
            completedDate: parseDay(daysAgo(ago)) as Date,
            createdById: user.id,
          },
        });
      await done('today', 0);
      await done('edge', 29);
      await done('old', 30);
      expect(
        await reads.counts([world.farmId], parseDay(daysAgo(0)) as Date),
      ).toEqual({ done: 2, pending: 0 });
    });

    it("records a real departure date even when a manager completed the leaver's task later", async () => {
      const task = await make({
        title: 'Livraison',
        assigneeId: yawa.id,
        dueDate: '2026-10-30',
      });
      await act(task.id, 'complete', { date: '2026-11-14' });
      await http()
        .patch(`/api/employees/${yawa.id}`)
        .set(director)
        .send({ endDate: '2026-11-01' })
        .expect(200);
      const hire = await make({
        title: 'Avant',
        assigneeId: koffi.id,
        dueDate: '2026-01-10',
      });
      await act(hire.id, 'complete', { date: '2026-01-09' });
      await http()
        .patch(`/api/employees/${koffi.id}`)
        .set(director)
        .send({ hireDate: '2026-02-01' })
        .expect(200);
    });

    it('fills the open tasks of an employee and keeps an employee with tasks from deletion or leaving early', async () => {
      await reference();
      const detail = async (id: string) =>
        (await http().get(`/api/employees/${id}`).set(director).expect(200))
          .body as { openTasks: number };
      expect((await detail(kodjo.id)).openTasks).toBe(1);
      expect((await detail(yawa.id)).openTasks).toBe(1);
      expect((await detail(ama.id)).openTasks).toBe(0);

      const del = await http()
        .delete(`/api/employees/${kodjo.id}`)
        .set(director)
        .expect(409);
      expect((del.body as Msg).message).toBe(
        'Cet employé a un historique : indiquez sa date de départ',
      );
      const doneToo = await http()
        .delete(`/api/employees/${ama.id}`)
        .set(director)
        .expect(409);
      expect((doneToo.body as Msg).message).toBe(
        'Cet employé a un historique : indiquez sa date de départ',
      );
      const end = await http()
        .patch(`/api/employees/${kodjo.id}`)
        .set(director)
        .send({ endDate: '2026-10-20' })
        .expect(409);
      expect((end.body as Msg).message).toBe(
        'Des présences ou des tâches sont enregistrées après cette date',
      );
      await http()
        .patch(`/api/employees/${kodjo.id}`)
        .set(director)
        .send({ endDate: '2026-10-23' })
        .expect(200);
      // A finished task never blocks, whatever the day a manager completed it on.
      await http()
        .patch(`/api/employees/${ama.id}`)
        .set(director)
        .send({ endDate: '2026-10-22' })
        .expect(200);
      const hired = await http()
        .patch(`/api/employees/${yawa.id}`)
        .set(director)
        .send({ hireDate: '2026-10-19' })
        .expect(409);
      expect((hired.body as Msg).message).toBe(
        'Des présences ou des tâches sont enregistrées avant cette date',
      );
    });
  });
});
