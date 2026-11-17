import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmployeesService } from '../src/personnel/employees.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface Employee extends Id {
  name: string;
  fullName: string | null;
  jobTitle: string;
  phone: string | null;
  contractType: string;
  hireDate: string;
  endDate: string | null;
  status: string;
  userId: string | null;
  userName: string | null;
  monthlySalary: number | null;
  note: string | null;
}
interface Attendance extends Id {
  date: string;
  employeeId: string;
  employeeName: string;
  status: string;
  hours: number | null;
  note: string | null;
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}
interface Payroll {
  month: string;
  label: string;
  lines: {
    employeeId: string;
    name: string;
    jobTitle: string;
    monthlySalary: number;
  }[];
  total: number;
  existing: { id: string; amount: number } | null;
}

const DAY = '2026-10-20';
const tomorrow = () => daysAgo(-1);
const nextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);
};

const STAFF = [
  {
    name: 'Kodjo A.',
    fullName: 'Kodjo Amegah',
    jobTitle: "Agent d'élevage",
    contractType: 'CDI',
    hireDate: '2025-01-06',
    monthlySalary: 85_000,
  },
  {
    name: 'Dr Koffi',
    jobTitle: 'Vétérinaire',
    contractType: 'CDD',
    hireDate: '2026-01-01',
    monthlySalary: 250_000,
  },
  {
    name: 'Yawa M.',
    jobTitle: 'Ouvrière',
    contractType: 'JOURNALIER',
    hireDate: '2026-03-01',
    monthlySalary: 60_000,
  },
  {
    name: 'Ama K.',
    jobTitle: "Agent d'élevage",
    contractType: 'CDI',
    hireDate: '2024-06-01',
    monthlySalary: 80_000,
  },
];

describe('Personnel: employees, attendance, payroll (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let accountant: Headers;
  let poultry: Headers;
  let agent: Headers;
  let kodjo: Employee;
  let koffi: Employee;
  let yawa: Employee;
  let ama: Employee;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    accountant = await world.actor('COMPTABLE');
    poultry = await world.actor('RESP_AVICOLE');
    agent = await world.actor('AGENT_ELEVAGE');
    const made: Employee[] = [];
    for (const s of STAFF) made.push(await hire(s));
    [kodjo, koffi, yawa, ama] = made;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const hire = (body: Record<string, unknown>, h = director) =>
    world.post<Employee>(h, '/employees', body);
  const patch = (
    id: string,
    body: object,
    status = 200,
    h: Headers = director,
  ) => http().patch(`/api/employees/${id}`).set(h).send(body).expect(status);
  const sheet = (
    entries: object[],
    date = DAY,
    status = 200,
    h: Headers = poultry,
  ) =>
    http()
      .post('/api/attendance/day')
      .set(h)
      .send({ date, entries })
      .expect(status);
  const message = (res: { body: unknown }) => (res.body as Msg).message;
  const audit = (module = 'personnel') =>
    prisma.auditLog.findMany({
      where: { module },
      orderBy: { createdAt: 'asc' },
    });

  describe('employee writes', () => {
    it('the Directeur creates the reference staff; each is Actif, with the salary he may read', () => {
      expect(kodjo).toMatchObject({
        name: 'Kodjo A.',
        fullName: 'Kodjo Amegah',
        jobTitle: "Agent d'élevage",
        contractType: 'CDI',
        hireDate: '2025-01-06',
        endDate: null,
        status: 'ACTIF',
        userId: null,
        userName: null,
        monthlySalary: 85_000,
        note: null,
      });
      expect(koffi.fullName).toBeNull();
    });

    it('links an employee to the farm user and refuses a second link to the same user', async () => {
      const user = await createUser({
        organizationId: world.orgId,
        role: 'AGENT_ELEVAGE',
        farmIds: [world.farmId],
        name: 'Kodjo Agent',
      });
      const linked = await patch(kodjo.id, { userId: user.id });
      expect(linked.body).toMatchObject({
        userId: user.id,
        userName: 'Kodjo Agent',
      });
      const twice = await patch(yawa.id, { userId: user.id }, 409);
      expect(message(twice)).toBe(
        'Cet utilisateur est déjà lié à un employé de cette ferme',
      );
      const created = await http()
        .post('/api/employees')
        .set(director)
        .send({ ...STAFF[0], name: 'Autre', userId: user.id })
        .expect(409);
      expect(message(created)).toBe(
        'Cet utilisateur est déjà lié à un employé de cette ferme',
      );
    });

    it('creates an employee already linked to a user', async () => {
      const user = await createUser({
        organizationId: world.orgId,
        role: 'AGENT_ELEVAGE',
        farmIds: [world.farmId],
      });
      const res = await hire({ ...STAFF[0], name: 'Lié', userId: user.id });
      expect(res.userId).toBe(user.id);
    });

    it('refuses a user of another farm, an unknown user and an inactive one with 400', async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const other = await createUser({
        organizationId: world.orgId,
        role: 'AGENT_ELEVAGE',
        farmIds: [farmB.id],
      });
      const inactive = await createUser({
        organizationId: world.orgId,
        role: 'AGENT_ELEVAGE',
        farmIds: [world.farmId],
        active: false,
      });
      for (const userId of [other.id, 'inconnu', inactive.id]) {
        const res = await patch(kodjo.id, { userId }, 400);
        expect(message(res)).toBe('Utilisateur invalide pour cette ferme');
      }
    });

    it('refuses a duplicate name with 409, on create and on rename', async () => {
      const dup = await http()
        .post('/api/employees')
        .set(director)
        .send({ ...STAFF[0], hireDate: '2026-01-01' })
        .expect(409);
      expect(message(dup)).toBe(
        'Un employé porte déjà ce nom dans cette ferme',
      );
      const rename = await patch(yawa.id, { name: 'Ama K.' }, 409);
      expect(message(rename)).toBe(
        'Un employé porte déjà ce nom dans cette ferme',
      );
    });

    it('allows the same name in another farm', async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const user = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [farmB.id],
      });
      const hB: Headers = {
        Authorization: `Bearer ${await tokenFor(user.id)}`,
        'X-Farm-Id': farmB.id,
      };
      await hire(STAFF[0], hB);
    });

    it('refuses the roles that do not manage staff', async () => {
      await http()
        .post('/api/employees')
        .set(poultry)
        .send(STAFF[0])
        .expect(403);
      await http()
        .patch(`/api/employees/${kodjo.id}`)
        .set(poultry)
        .send({ note: 'x' })
        .expect(403);
      await http()
        .delete(`/api/employees/${kodjo.id}`)
        .set(poultry)
        .expect(403);
      await http()
        .post('/api/employees')
        .set(accountant)
        .send(STAFF[0])
        .expect(403);
    });

    it('validates the body: required fields, contract, salary, dates, null on a required field', async () => {
      const bad = async (body: object) =>
        http().post('/api/employees').set(director).send(body).expect(400);
      await bad({});
      await bad({ ...STAFF[0], name: 'Z', contractType: 'AUTRE' });
      await bad({ ...STAFF[0], name: 'Z', monthlySalary: -1 });
      await bad({ ...STAFF[0], name: 'Z', hireDate: '2026-13-01' });
      await bad({ ...STAFF[0], name: 'Z', extra: 1 });
      const end = await bad({ ...STAFF[0], name: 'Z', endDate: '2024-01-01' });
      expect(message(end)).toBe(
        "La date de départ est antérieure à l'embauche",
      );
      for (const key of ['name', 'jobTitle', 'contractType', 'hireDate']) {
        await patch(kodjo.id, { [key]: null }, 400);
      }
    });

    it('PATCH null clears the optional fields', async () => {
      const user = await createUser({
        organizationId: world.orgId,
        role: 'AGENT_ELEVAGE',
        farmIds: [world.farmId],
      });
      await patch(yawa.id, {
        endDate: '2026-12-31',
        userId: user.id,
        note: 'Remarque',
        phone: '0100000000',
      });
      const res = await patch(yawa.id, {
        endDate: null,
        userId: null,
        monthlySalary: null,
        note: null,
        phone: null,
        fullName: null,
      });
      expect(res.body).toMatchObject({
        endDate: null,
        userId: null,
        userName: null,
        monthlySalary: null,
        note: null,
        phone: null,
        fullName: null,
        status: 'ACTIF',
      });
    });

    it('stores a blank optional text as null', async () => {
      const res = await hire({
        ...STAFF[0],
        name: 'Vide',
        note: '  ',
        phone: '',
      });
      expect(res).toMatchObject({ note: null, phone: null });
    });

    it('marks an employee Parti once the end date is past', async () => {
      const res = await patch(yawa.id, { endDate: daysAgo(1) });
      expect((res.body as Employee).status).toBe('PARTI');
      const today = await patch(ama.id, { endDate: daysAgo(0) });
      expect((today.body as Employee).status).toBe('ACTIF');
    });

    it('ignores a salary written without finance:read (never a 403)', async () => {
      const service = app.get(EmployeesService);
      const actor = await createUser({
        organizationId: world.orgId,
        role: 'RESP_AVICOLE',
        farmIds: [world.farmId],
      });
      const ctx = {
        user: {
          id: actor.id,
          name: actor.name,
          role: 'RESP_AVICOLE' as const,
          organizationId: world.orgId,
        },
        farmId: world.farmId,
        allFarms: false,
        farmIds: [world.farmId],
      };
      const res = await service.update(ctx, kodjo.id, {
        monthlySalary: 1,
        note: 'ok',
      });
      expect(res).toMatchObject({ monthlySalary: null, note: 'ok' });
      const stored = await prisma.employee.findUniqueOrThrow({
        where: { id: kodjo.id },
      });
      expect(stored.monthlySalary?.toNumber()).toBe(85_000);
      const made = await service.create(ctx, {
        ...STAFF[0],
        contractType: 'CDI',
        name: 'Sans salaire',
        monthlySalary: 9,
      });
      expect(made.monthlySalary).toBeNull();
      const row = await prisma.employee.findUniqueOrThrow({
        where: { id: made.id },
      });
      expect(row.monthlySalary).toBeNull();
    });

    it('refuses an end date before attendance already entered, and a hire date after it', async () => {
      await sheet([{ employeeId: kodjo.id, status: 'PRESENT', hours: 8 }]);
      const end = await patch(kodjo.id, { endDate: '2026-10-10' }, 409);
      expect(message(end)).toBe(
        'Des présences ou des tâches sont enregistrées après cette date',
      );
      const hireLater = await patch(kodjo.id, { hireDate: '2026-10-25' }, 409);
      expect(message(hireLater)).toBe(
        'Des présences ou des tâches sont enregistrées avant cette date',
      );
      await patch(kodjo.id, { endDate: DAY });
    });

    it('never lets an end date and a day sheet after it both succeed when they race', async () => {
      const [end, day] = await Promise.all([
        http()
          .patch(`/api/employees/${kodjo.id}`)
          .set(director)
          .send({ endDate: '2026-10-10' }),
        http()
          .post('/api/attendance/day')
          .set(poultry)
          .send({
            date: DAY,
            entries: [{ employeeId: kodjo.id, status: 'PRESENT', hours: 8 }],
          }),
      ]);
      expect([end.status, day.status].sort()).not.toEqual([200, 200]);
      expect([200, 400, 409]).toContain(end.status);
      expect([200, 400, 409]).toContain(day.status);
      const stored = await prisma.employee.findUniqueOrThrow({
        where: { id: kodjo.id },
      });
      const sheets = await prisma.attendance.count({
        where: { employeeId: kodjo.id, date: new Date(DAY) },
      });
      // Either the departure stands and no row follows it, or the row stands and the departure was refused.
      expect(stored.endDate !== null && sheets > 0).toBe(false);
    });

    it('refuses an end date before the hire date with 400', async () => {
      const res = await patch(kodjo.id, { endDate: '2024-01-01' }, 400);
      expect(message(res)).toBe(
        "La date de départ est antérieure à l'embauche",
      );
    });

    it('deletes an employee with no history, and refuses one with attendance', async () => {
      await sheet([{ employeeId: kodjo.id, status: 'PRESENT' }]);
      const refused = await http()
        .delete(`/api/employees/${kodjo.id}`)
        .set(director)
        .expect(409);
      expect(message(refused)).toBe(
        'Cet employé a un historique : indiquez sa date de départ',
      );
      await http().delete(`/api/employees/${ama.id}`).set(director).expect(200);
      await http().get(`/api/employees/${ama.id}`).set(director).expect(404);
    });

    it('writes exactly one audit row per change and none for a no-op', async () => {
      expect(await audit()).toHaveLength(4);
      await patch(kodjo.id, { jobTitle: 'Chef' });
      expect(await audit()).toHaveLength(5);
      await patch(kodjo.id, { jobTitle: 'Chef' });
      expect(await audit()).toHaveLength(5);
      await http().delete(`/api/employees/${ama.id}`).set(director).expect(200);
      const rows = await audit();
      expect(rows.map((r) => r.action)).toEqual([
        'CREATE',
        'CREATE',
        'CREATE',
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
      expect(rows[5]).toMatchObject({ recordId: ama.id, label: 'Ama K.' });
    });

    it('rolls the audit back with a refused write', async () => {
      await http()
        .post('/api/employees')
        .set(director)
        .send(STAFF[0])
        .expect(409);
      expect(await audit()).toHaveLength(4);
    });
  });

  describe('employee reads', () => {
    const list = async (q: object = {}, h = accountant) =>
      (await http().get('/api/employees').query(q).set(h).expect(200))
        .body as Page<Employee>;

    it('the Comptable reads the salaries, the Resp. avicole gets null, the Agent is refused', async () => {
      const full = await list();
      expect(full.total).toBe(4);
      expect(full.items.find((e) => e.name === 'Kodjo A.')?.monthlySalary).toBe(
        85_000,
      );
      const masked = await list({}, poultry);
      expect(masked.items.map((e) => e.monthlySalary)).toEqual([
        null,
        null,
        null,
        null,
      ]);
      await http().get('/api/employees').set(agent).expect(403);
      await http().get(`/api/employees/${kodjo.id}`).set(agent).expect(403);
    });

    it('reads the employee and attendance lists with personnel:read alone (the Comptable), options for any user', async () => {
      await sheet([{ employeeId: kodjo.id, status: 'PRESENT', hours: 8 }]);
      const employees = await http()
        .get('/api/employees')
        .set(accountant)
        .expect(200);
      expect((employees.body as Page<Employee>).total).toBe(4);
      const attendance = await http()
        .get('/api/attendance')
        .set(accountant)
        .expect(200);
      expect((attendance.body as Page<Attendance>).total).toBe(1);
      await http().get('/api/employees/options').set(accountant).expect(200);
      await http().get('/api/employees/options').set(agent).expect(200);
    });

    it('lists by name and exposes the paging, note and userName', async () => {
      const page = await list();
      expect(page.items.map((e) => e.name)).toEqual([
        'Ama K.',
        'Dr Koffi',
        'Kodjo A.',
        'Yawa M.',
      ]);
      expect(page).toMatchObject({ page: 1, pageSize: 25 });
      expect(page.items[0]).toHaveProperty('note');
      expect(page.items[0]).toHaveProperty('userName');
    });

    it('sorts by hire date and refuses another field', async () => {
      const page = await list({ sort: 'hireDate:desc' });
      expect(page.items.map((e) => e.name)).toEqual([
        'Yawa M.',
        'Dr Koffi',
        'Kodjo A.',
        'Ama K.',
      ]);
      await http()
        .get('/api/employees')
        .query({ sort: 'monthlySalary:asc' })
        .set(accountant)
        .expect(400);
    });

    it('filters by status and search, with statusCounts over the other filters', async () => {
      await patch(yawa.id, { endDate: daysAgo(1) });
      const parti = await list({ status: 'PARTI' });
      expect(parti.items.map((e) => e.name)).toEqual(['Yawa M.']);
      expect(parti.total).toBe(1);
      expect(parti.statusCounts).toEqual({ ACTIF: 3, PARTI: 1 });
      const searched = await list({ search: 'agent' });
      expect(searched.items.map((e) => e.name)).toEqual(['Ama K.', 'Kodjo A.']);
      expect(searched.statusCounts).toEqual({ ACTIF: 2, PARTI: 0 });
      await http()
        .get('/api/employees')
        .query({ status: 'X' })
        .set(accountant)
        .expect(400);
    });

    it('exports CSV; the salary column exists only with finance:read', async () => {
      const withSalary = await http()
        .get('/api/employees')
        .query({ format: 'csv' })
        .set(accountant)
        .expect(200);
      const lines = withSalary.text.replace('﻿', '').split('\r\n');
      expect(lines[0]).toBe(
        'Nom;Nom complet;Poste;Contrat;Téléphone;Embauche;Départ;Statut;Salaire mensuel',
      );
      expect(lines).toContain(
        "Kodjo A.;Kodjo Amegah;Agent d'élevage;CDI;;2025-01-06;;Actif;85000",
      );
      const without = await http()
        .get('/api/employees')
        .query({ format: 'csv' })
        .set(poultry)
        .expect(200);
      const text = without.text.replace('﻿', '');
      expect(text.split('\r\n')[0]).toBe(
        'Nom;Nom complet;Poste;Contrat;Téléphone;Embauche;Départ;Statut',
      );
      expect(text).not.toContain('85000');
      expect(text).toContain('Journalier');
    });

    it('shows one employee with the last 30 days of attendance', async () => {
      await sheet(
        [{ employeeId: kodjo.id, status: 'PRESENT', hours: 8 }],
        daysAgo(2),
      );
      await sheet([{ employeeId: kodjo.id, status: 'ABSENT' }], daysAgo(1));
      await sheet([{ employeeId: kodjo.id, status: 'MALADIE' }], daysAgo(40));
      const res = await http()
        .get(`/api/employees/${kodjo.id}`)
        .set(accountant)
        .expect(200);
      expect(res.body).toMatchObject({
        id: kodjo.id,
        monthlySalary: 85_000,
        attendanceLast30: { PRESENT: 1, ABSENT: 1, CONGE: 0, MALADIE: 0 },
        openTasks: 0,
      });
      const masked = await http()
        .get(`/api/employees/${kodjo.id}`)
        .set(poultry)
        .expect(200);
      expect((masked.body as Employee).monthlySalary).toBeNull();
    });

    it('options: any user of the farm gets id, name, job and user of the employees in post, with no salary', async () => {
      await patch(yawa.id, { endDate: '2026-09-30' });
      const res = await http()
        .get('/api/employees/options')
        .set(agent)
        .expect(200);
      const body = res.body as { items: Record<string, unknown>[] };
      expect(body.items.map((i) => i.name)).toEqual([
        'Ama K.',
        'Dr Koffi',
        'Kodjo A.',
      ]);
      expect(Object.keys(body.items[0]).sort()).toEqual([
        'id',
        'jobTitle',
        'name',
        'userId',
      ]);
      const past = await http()
        .get('/api/employees/options')
        .query({ at: '2026-09-15' })
        .set(agent)
        .expect(200);
      expect(
        (past.body as { items: { name: string }[] }).items.map((i) => i.name),
      ).toEqual(['Ama K.', 'Dr Koffi', 'Kodjo A.', 'Yawa M.']);
      const early = await http()
        .get('/api/employees/options')
        .query({ at: '2025-01-05' })
        .set(agent)
        .expect(200);
      expect(
        (early.body as { items: { name: string }[] }).items.map((i) => i.name),
      ).toEqual(['Ama K.']);
      await http()
        .get('/api/employees/options')
        .query({ at: 'demain' })
        .set(agent)
        .expect(400);
    });

    it('user-options: the active users of the farm not yet linked, for personnel:update only', async () => {
      const free = await createUser({
        organizationId: world.orgId,
        role: 'MAGASINIER',
        farmIds: [world.farmId],
        name: 'Libre',
      });
      const farmB = await createFarm(world.orgId, 'Ferme B');
      await createUser({
        organizationId: world.orgId,
        role: 'MAGASINIER',
        farmIds: [farmB.id],
        name: 'Ailleurs',
      });
      await createUser({
        organizationId: world.orgId,
        role: 'MAGASINIER',
        farmIds: [world.farmId],
        active: false,
        name: 'Inactif',
      });
      const taken = await createUser({
        organizationId: world.orgId,
        role: 'MAGASINIER',
        farmIds: [world.farmId],
        name: 'Déjà lié',
      });
      await patch(kodjo.id, { userId: taken.id });
      const res = await http()
        .get('/api/employees/user-options')
        .set(director)
        .expect(200);
      const items = (res.body as { items: Record<string, string>[] }).items;
      const names = items.map((u) => u.name);
      expect(names).toContain('Libre');
      expect(names).not.toContain('Ailleurs');
      expect(names).not.toContain('Inactif');
      expect(names).not.toContain('Déjà lié');
      expect(items.find((u) => u.id === free.id)).toEqual({
        id: free.id,
        name: 'Libre',
        email: expect.stringContaining('@') as string,
        role: 'MAGASINIER',
      });
      await http().get('/api/employees/user-options').set(poultry).expect(403);
      await http()
        .get('/api/employees/user-options')
        .set(accountant)
        .expect(403);
    });
  });

  describe('attendance', () => {
    const list = async (q: object = {}, h: Headers = accountant) =>
      (await http().get('/api/attendance').query(q).set(h).expect(200))
        .body as Page<Attendance>;

    it('the day sheet inserts, repeats idempotently and audits only the changes', async () => {
      const first = await sheet([
        { employeeId: kodjo.id, status: 'PRESENT', hours: 8 },
        { employeeId: yawa.id, status: 'ABSENT', note: 'Prévenue' },
      ]);
      const rows = first.body as Attendance[];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        date: DAY,
        employeeId: kodjo.id,
        employeeName: 'Kodjo A.',
        status: 'PRESENT',
        hours: 8,
        note: null,
      });
      expect(rows[1]).toMatchObject({
        employeeName: 'Yawa M.',
        status: 'ABSENT',
        hours: null,
        note: 'Prévenue',
      });
      expect(await audit()).toHaveLength(6);
      const again = await sheet([
        { employeeId: kodjo.id, status: 'PRESENT', hours: 8 },
        { employeeId: yawa.id, status: 'ABSENT', note: 'Prévenue' },
      ]);
      expect((again.body as Attendance[]).map((r) => r.id)).toEqual(
        rows.map((r) => r.id),
      );
      expect(await audit()).toHaveLength(6);
      const changed = await sheet([
        { employeeId: kodjo.id, status: 'PRESENT', hours: 7.5 },
        { employeeId: yawa.id, status: 'ABSENT', note: 'Prévenue' },
      ]);
      expect((changed.body as Attendance[])[0].hours).toBe(7.5);
      const rowsAfter = await audit();
      expect(rowsAfter).toHaveLength(7);
      expect(rowsAfter[6]).toMatchObject({
        action: 'UPDATE',
        label: `Kodjo A. · ${DAY}`,
      });
      expect(await prisma.attendance.count()).toBe(2);
    });

    it('the day sheet leaves the other employees of the day alone', async () => {
      await sheet([{ employeeId: kodjo.id, status: 'PRESENT' }]);
      await sheet([{ employeeId: ama.id, status: 'CONGE' }]);
      expect((await list({ from: DAY, to: DAY })).total).toBe(2);
    });

    it('refuses hours on an absence, naming the rule', async () => {
      const res = await sheet(
        [{ employeeId: kodjo.id, status: 'ABSENT', hours: 8 }],
        DAY,
        400,
      );
      expect(message(res)).toBe(
        "Les heures ne s'indiquent que pour une présence",
      );
      expect(await prisma.attendance.count()).toBe(0);
    });

    it('refuses an employee who is not in post that day, and writes nothing of the sheet', async () => {
      await patch(yawa.id, { endDate: '2026-10-25' });
      const res = await sheet(
        [
          { employeeId: kodjo.id, status: 'PRESENT' },
          { employeeId: yawa.id, status: 'PRESENT' },
        ],
        '2026-11-02',
        400,
      );
      expect(message(res)).toBe("Yawa M. n'est pas en poste le 2026-11-02");
      expect(await prisma.attendance.count()).toBe(0);
      const before = await sheet(
        [{ employeeId: koffi.id, status: 'PRESENT' }],
        '2025-12-31',
        400,
      );
      expect(message(before)).toBe("Dr Koffi n'est pas en poste le 2025-12-31");
    });

    it('refuses a future date, on the sheet and on a single entry', async () => {
      const entries = [{ employeeId: kodjo.id, status: 'PRESENT' }];
      const res = await sheet(entries, tomorrow(), 400);
      expect(message(res)).toBe('La date ne peut pas être dans le futur');
      const single = await http()
        .post('/api/attendance')
        .set(poultry)
        .send({ employeeId: kodjo.id, date: tomorrow(), status: 'PRESENT' })
        .expect(400);
      expect(message(single)).toBe('La date ne peut pas être dans le futur');
    });

    it('refuses an employee of another farm with 400, and the same employee twice', async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const userB = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [farmB.id],
      });
      const hB: Headers = {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      };
      const foreign = await hire({ ...STAFF[0], name: 'Étranger' }, hB);
      const res = await sheet(
        [{ employeeId: foreign.id, status: 'PRESENT' }],
        DAY,
        400,
      );
      expect(message(res)).toBe('Employé invalide pour cette ferme');
      const single = await http()
        .post('/api/attendance')
        .set(poultry)
        .send({ employeeId: foreign.id, date: DAY, status: 'PRESENT' })
        .expect(400);
      expect(message(single)).toBe('Employé invalide pour cette ferme');
      const twice = await sheet(
        [
          { employeeId: kodjo.id, status: 'PRESENT' },
          { employeeId: kodjo.id, status: 'ABSENT' },
        ],
        DAY,
        400,
      );
      expect(message(twice)).toBe(
        'Un employé figure deux fois dans la feuille',
      );
      await sheet([], DAY, 400);
      await sheet(
        [{ employeeId: kodjo.id, status: 'PRESENT', hours: 25 }],
        DAY,
        400,
      );
      await sheet(
        [{ employeeId: kodjo.id, status: 'PRESENT', hours: 0 }],
        DAY,
        400,
      );
    });

    it('creates one entry, refuses a duplicate with 409 and the hours of a non-presence', async () => {
      const made = await http()
        .post('/api/attendance')
        .set(poultry)
        .send({
          employeeId: kodjo.id,
          date: DAY,
          status: 'PRESENT',
          hours: 8.5,
        })
        .expect(201);
      expect(made.body).toMatchObject({ hours: 8.5, status: 'PRESENT' });
      const dup = await http()
        .post('/api/attendance')
        .set(poultry)
        .send({ employeeId: kodjo.id, date: DAY, status: 'ABSENT' })
        .expect(409);
      expect(message(dup)).toBe(
        `La présence de Kodjo A. le ${DAY} est déjà saisie`,
      );
      const hours = await http()
        .post('/api/attendance')
        .set(poultry)
        .send({ employeeId: ama.id, date: DAY, status: 'CONGE', hours: 2 })
        .expect(400);
      expect(message(hours)).toBe(
        "Les heures ne s'indiquent que pour une présence",
      );
      const notInPost = await http()
        .post('/api/attendance')
        .set(poultry)
        .send({ employeeId: koffi.id, date: '2025-06-01', status: 'PRESENT' })
        .expect(400);
      expect(message(notInPost)).toBe(
        "Dr Koffi n'est pas en poste le 2025-06-01",
      );
      expect(await audit()).toHaveLength(5);
    });

    it('edits a row: status, hours (null clears), note; leaving presence clears the hours', async () => {
      const made = (
        await sheet([{ employeeId: kodjo.id, status: 'PRESENT', hours: 8 }])
      ).body as Attendance[];
      const id = made[0].id;
      const edit = (body: object, status = 200) =>
        http()
          .patch(`/api/attendance/${id}`)
          .set(poultry)
          .send(body)
          .expect(status);
      expect((await edit({ hours: 6 })).body).toMatchObject({ hours: 6 });
      expect((await edit({ hours: null, note: 'Retard' })).body).toMatchObject({
        hours: null,
        note: 'Retard',
      });
      await edit({ hours: 7 });
      expect((await edit({ status: 'MALADIE' })).body).toMatchObject({
        status: 'MALADIE',
        hours: null,
      });
      const bad = await edit({ hours: 5 }, 400);
      expect(message(bad)).toBe(
        "Les heures ne s'indiquent que pour une présence",
      );
      await edit({ status: null }, 400);
      await edit({ status: 'PRESENT', hours: 25 }, 400);
      expect((await edit({ note: null })).body).toMatchObject({ note: null });
      const rows = await audit();
      expect(rows.filter((r) => r.action === 'UPDATE').length).toBeGreaterThan(
        3,
      );
    });

    it('deletes a row with its audit, and answers 404 for an unknown one', async () => {
      const made = (await sheet([{ employeeId: kodjo.id, status: 'PRESENT' }]))
        .body as Attendance[];
      await http()
        .delete(`/api/attendance/${made[0].id}`)
        .set(poultry)
        .expect(200);
      expect(await prisma.attendance.count()).toBe(0);
      const rows = await audit();
      expect(rows[rows.length - 1]).toMatchObject({ action: 'DELETE' });
      await http().delete('/api/attendance/inconnu').set(poultry).expect(404);
    });

    it('the Directeur and the Resp. avicole write; the Comptable, the Agent and the Auditeur do not', async () => {
      const body = {
        date: DAY,
        entries: [{ employeeId: kodjo.id, status: 'PRESENT' }],
      };
      await http()
        .post('/api/attendance/day')
        .set(director)
        .send(body)
        .expect(200);
      for (const role of [
        'COMPTABLE',
        'AGENT_ELEVAGE',
        'AUDITEUR',
        'PROPRIETAIRE',
      ] as const) {
        const h = await world.actor(role);
        await http().post('/api/attendance/day').set(h).send(body).expect(403);
        await http().post('/api/attendance').set(h).send({}).expect(403);
      }
      const porcin = await world.actor('RESP_PORCIN');
      await http()
        .post('/api/attendance/day')
        .set(porcin)
        .send({ ...body, date: '2026-10-21' })
        .expect(200);
    });

    it('lists with filters, search, sort, statusCounts and a page size of 200', async () => {
      await sheet([
        { employeeId: kodjo.id, status: 'PRESENT', hours: 8 },
        { employeeId: yawa.id, status: 'ABSENT' },
        { employeeId: ama.id, status: 'PRESENT', hours: 6 },
      ]);
      await sheet([{ employeeId: kodjo.id, status: 'MALADIE' }], '2026-10-21');
      const all = await list({ pageSize: 200 });
      expect(all.pageSize).toBe(200);
      expect(all.total).toBe(4);
      expect(all.items.map((r) => `${r.date} ${r.employeeName}`)).toEqual([
        '2026-10-21 Kodjo A.',
        '2026-10-20 Ama K.',
        '2026-10-20 Kodjo A.',
        '2026-10-20 Yawa M.',
      ]);
      expect(all.statusCounts).toEqual({
        PRESENT: 2,
        ABSENT: 1,
        CONGE: 0,
        MALADIE: 1,
      });
      const day = await list({ from: DAY, to: DAY, status: 'PRESENT' });
      expect(day.items.map((r) => r.employeeName)).toEqual([
        'Ama K.',
        'Kodjo A.',
      ]);
      expect(day.statusCounts).toEqual({
        PRESENT: 2,
        ABSENT: 1,
        CONGE: 0,
        MALADIE: 0,
      });
      const one = await list({ employeeId: yawa.id });
      expect(one.items.map((r) => r.employeeName)).toEqual(['Yawa M.']);
      const search = await list({ search: 'kod' });
      expect(search.total).toBe(2);
      const byName = await list({ sort: 'employeeName:desc' });
      expect(byName.items[0].employeeName).toBe('Yawa M.');
      const asc = await list({ sort: 'date:asc' });
      expect(asc.items[0].date).toBe(DAY);
      await http()
        .get('/api/attendance')
        .query({ sort: 'hours:asc' })
        .set(accountant)
        .expect(400);
      await http()
        .get('/api/attendance')
        .query({ status: 'X' })
        .set(accountant)
        .expect(400);
      await http()
        .get('/api/attendance')
        .query({ from: 'x' })
        .set(accountant)
        .expect(400);
      await http()
        .get('/api/attendance')
        .query({ pageSize: 201 })
        .set(accountant)
        .expect(400);
      await http().get('/api/attendance').set(agent).expect(403);
    });

    it('exports the list as CSV in French', async () => {
      await sheet([
        { employeeId: kodjo.id, status: 'PRESENT', hours: 8 },
        { employeeId: yawa.id, status: 'ABSENT', note: 'Prévenue' },
      ]);
      const res = await http()
        .get('/api/attendance')
        .query({ format: 'csv' })
        .set(accountant)
        .expect(200);
      expect(res.text.replace('﻿', '').split('\r\n')).toEqual([
        'Date;Employé;Statut;Heures;Note',
        `${DAY};Kodjo A.;Présent;8;`,
        `${DAY};Yawa M.;Absent;;Prévenue`,
        '',
      ]);
    });
  });

  describe('payroll preview', () => {
    const payroll = (month: string, h: Headers = accountant, status = 200) =>
      http()
        .get('/api/employees/payroll')
        .query({ month })
        .set(h)
        .expect(status);

    it('totals the salaries of the staff in post in the month, with no proration', async () => {
      const res = await payroll('2026-10');
      const body = res.body as Payroll;
      expect(body).toMatchObject({
        month: '2026-10',
        label: 'Salaires octobre 2026',
        total: 475_000,
        existing: null,
      });
      expect(
        body.lines.map((l) => [l.name, l.jobTitle, l.monthlySalary]),
      ).toEqual([
        ['Ama K.', "Agent d'élevage", 80_000],
        ['Dr Koffi', 'Vétérinaire', 250_000],
        ['Kodjo A.', "Agent d'élevage", 85_000],
        ['Yawa M.', 'Ouvrière', 60_000],
      ]);
      expect(body.lines[0].employeeId).toBe(ama.id);
    });

    it('follows hires and departures month by month', async () => {
      await patch(yawa.id, { endDate: '2026-09-30' });
      expect(((await payroll('2026-10')).body as Payroll).total).toBe(415_000);
      expect(((await payroll('2026-09')).body as Payroll).total).toBe(475_000);
      expect(((await payroll('2026-01')).body as Payroll).total).toBe(415_000);
      await hire({
        ...STAFF[0],
        name: 'Tard',
        hireDate: '2026-10-31',
        monthlySalary: 1000,
      });
      expect(((await payroll('2026-10')).body as Payroll).total).toBe(416_000);
      await hire({ ...STAFF[0], name: 'Sans', monthlySalary: undefined });
      expect(((await payroll('2026-10')).body as Payroll).lines).toHaveLength(
        4,
      );
    });

    it('reports the manual entry already posted for the month, and writes nothing', async () => {
      expect(await prisma.financeEntry.count()).toBe(0);
      await payroll('2026-10');
      expect(await prisma.financeEntry.count()).toBe(0);
      const entry = await http()
        .post('/api/finance/entries')
        .set(accountant)
        .send({
          date: '2026-10-31',
          kind: 'DEPENSE',
          label: 'Salaires octobre 2026',
          activity: 'GENERAL',
          category: 'SALAIRES',
          amount: 475_000,
        })
        .expect(201);
      const res = (await payroll('2026-10')).body as Payroll;
      expect(res.existing).toEqual({
        id: (entry.body as Id).id,
        amount: 475_000,
      });
      expect(((await payroll('2026-09')).body as Payroll).existing).toBeNull();
    });

    it("is the Comptable's: the Directeur is refused, a bad or future month is a 400", async () => {
      await payroll('2026-10', director, 403);
      await payroll('2026-10', poultry, 403);
      for (const month of ['2026-1', '2026-13', 'octobre', '']) {
        await payroll(month, accountant, 400);
      }
      await http().get('/api/employees/payroll').set(accountant).expect(400);
      const future = await payroll(nextMonth(), accountant, 400);
      expect(message(future)).toBe('Le mois ne peut pas être dans le futur');
      await payroll(new Date().toISOString().slice(0, 7));
    });

    it('is refused under all farms', async () => {
      const admin = await world.actor('SUPER_ADMIN');
      await payroll('2026-10', { ...admin, 'X-Farm-Id': 'all' }, 403);
      await payroll('2026-10', admin, 200);
    });
  });

  describe('isolation between farms', () => {
    it("answers 404 for another farm's employee and attendance, and keeps its staff out of lists, options and payroll", async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const userB = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [farmB.id],
      });
      const hB: Headers = {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      };
      const other = await hire(
        { ...STAFF[0], name: 'B-Employé', monthlySalary: 1 },
        hB,
      );
      const otherSheet = await sheet(
        [{ employeeId: other.id, status: 'PRESENT' }],
        DAY,
        200,
        hB,
      );
      const attendanceId = (otherSheet.body as Attendance[])[0].id;

      await http().get(`/api/employees/${other.id}`).set(director).expect(404);
      await patch(other.id, { note: 'x' }, 404);
      await http()
        .delete(`/api/employees/${other.id}`)
        .set(director)
        .expect(404);
      await http()
        .patch(`/api/attendance/${attendanceId}`)
        .set(poultry)
        .send({ note: 'x' })
        .expect(404);
      await http()
        .delete(`/api/attendance/${attendanceId}`)
        .set(poultry)
        .expect(404);

      const names = (
        (await http().get('/api/employees').set(director).expect(200))
          .body as Page<Employee>
      ).items.map((e) => e.name);
      expect(names).not.toContain('B-Employé');
      expect(
        (
          (await http().get('/api/attendance').set(director).expect(200))
            .body as Page<Attendance>
        ).total,
      ).toBe(0);
      const options = await http()
        .get('/api/employees/options')
        .set(agent)
        .expect(200);
      expect(JSON.stringify(options.body)).not.toContain('B-Employé');
      const payroll = await http()
        .get('/api/employees/payroll')
        .query({ month: '2026-10' })
        .set(accountant)
        .expect(200);
      expect((payroll.body as Payroll).total).toBe(475_000);
    });

    it("an owner under all farms reads every farm's staff", async () => {
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const userB = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [farmB.id],
      });
      const hB: Headers = {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      };
      await hire({ ...STAFF[0], name: 'B-Employé' }, hB);
      const owner = await world.actor('PROPRIETAIRE');
      const res = await http()
        .get('/api/employees')
        .set({ ...owner, 'X-Farm-Id': 'all' })
        .expect(200);
      expect((res.body as Page<Employee>).total).toBe(5);
    });
  });
});
