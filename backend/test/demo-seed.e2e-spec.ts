import { spawnSync } from 'child_process';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { signAccessToken } from '../src/access/access-token';
import type { RequestContext } from '../src/access/decorators';
import { ALL_ROLES } from '../src/access/roles';
import { AlertsRegistry } from '../src/indicators/alerts/alerts-registry';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, migrateTestDb, resetDb } from './setup';

/**
 * The demo seed « Ferme Kpalimé » (prisma/demo): run as the operator runs it, a child process against the test
 * database, then read back through the API with the figures every screen computes.
 */
const BACKEND = join(__dirname, '..');
const ADMIN_EMAIL = 'admin@demo.test';
const DEMO_PASSWORD = 'MotDePasseDemo-2026';

interface Page<T = never> {
  items: T[];
  statusCounts: Record<string, number>;
}
interface Dashboard {
  kpis: Record<string, number>;
  activeBuildings: number;
  tasks: { done: number; pending: number };
  upcomingTasks: unknown[];
  eggSeries: unknown[];
  alerts: { total: number };
}
interface Summary {
  revenue: number;
  expenses: number;
  margin: number;
  receivables: number;
  byActivity: { revenue: number; expenses: number }[];
  byCategory: { kind: string; amount: number }[];
}

const DAY_MS = 86_400_000;
const day = (offset: number) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

interface Run {
  status: number | null;
  out: string;
}

function run(
  command: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): Run {
  const result = spawnSync(command, args, {
    cwd: BACKEND,
    env: {
      ...process.env,
      SEED_ADMIN_EMAIL: ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: 'MotDePasseAdmin-2026',
      DEMO_PASSWORD,
      ...env,
    },
    encoding: 'utf8',
    timeout: 240_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const seedDemo = (env: Record<string, string | undefined> = {}) =>
  run('node', ['dist-demo/prisma/demo/seed-demo.js'], env);

describe('Demo seed (e2e)', () => {
  jest.setTimeout(300_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let farmId: string;
  let first: Run;
  let headers: Record<string, string>;
  const marker = () => prisma.setting.findFirst({ where: { key: 'demoSeed' } });

  /** One count per table, so that a second run can be compared row for row. */
  async function tableCounts(): Promise<Record<string, number>> {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`;
    const counts: Record<string, number> = {};
    for (const { tablename } of tables) {
      const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "public"."${tablename}"`,
      );
      counts[tablename] = Number(row.n);
    }
    return counts;
  }

  beforeAll(async () => {
    migrateTestDb();
    await resetDb();
    const seeded = run('npx', ['tsx', 'prisma/seed.ts']);
    expect(seeded.status).toBe(0);
    const built = run('npm', ['run', 'build:demo']);
    expect(built.out).not.toMatch(/error TS/);
    expect(built.status).toBe(0);
    first = seedDemo();
    app = await createTestApp();
    prisma = new PrismaService();
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: ADMIN_EMAIL },
    });
    farmId = (
      await prisma.farm.findFirstOrThrow({ where: { name: 'Ferme Kpalimé' } })
    ).id;
    headers = {
      Authorization: `Bearer ${signAccessToken({ sub: admin.id, role: admin.role, org: admin.organizationId, stage: 'full' })}`,
      'X-Farm-Id': farmId,
    };
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const get = async <T = never>(path: string): Promise<T> =>
    (
      await request(app.getHttpServer() as App)
        .get(`/api${path}`)
        .set(headers)
        .expect(200)
    ).body as T;

  it('completes and writes its marker last', async () => {
    expect(first.out).toContain('Démo chargée');
    expect(first.status).toBe(0);
    const stored = await marker();
    expect(stored?.value).toEqual({
      version: 1,
      at: expect.any(String) as string,
    });
  });

  it('never writes the demo password: every account has an argon2 hash and the password is in no row', async () => {
    const users = await prisma.user.findMany();
    expect(users.every((u) => u.passwordHash.startsWith('$argon2'))).toBe(true);
    const found = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "AuditLog" WHERE "after"::text LIKE ${`%${DEMO_PASSWORD}%`} OR "before"::text LIKE ${`%${DEMO_PASSWORD}%`}`;
    expect(Number(found[0].n)).toBe(0);
    expect(first.out).not.toContain(DEMO_PASSWORD);
  });

  describe('users', () => {
    it('has one account per role, <role>@kpalime.demo, assigned to the farm', async () => {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: '@kpalime.demo' } },
        include: { farms: true },
      });
      expect(users.map((u) => u.role).sort()).toEqual([...ALL_ROLES].sort());
      for (const user of users) {
        expect(user.email).toBe(
          `${user.role.toLowerCase().replace(/_/g, '.')}@kpalime.demo`,
        );
        expect(user.farms.map((f) => f.farmId)).toEqual([farmId]);
      }
      expect(users.find((u) => u.role === 'AGENT_ELEVAGE')?.email).toBe(
        'agent.elevage@kpalime.demo',
      );
    });

    it('signs in with the demo password: the roles without a mandatory second factor get a session, the four others enrol first', async () => {
      const mandatory = [
        'SUPER_ADMIN',
        'PROPRIETAIRE',
        'DIRECTEUR_FERME',
        'COMPTABLE',
      ];
      for (const role of ALL_ROLES) {
        const email = `${role.toLowerCase().replace(/_/g, '.')}@kpalime.demo`;
        const res = await request(app.getHttpServer() as App)
          .post('/api/auth/login')
          .send({ email, password: DEMO_PASSWORD })
          .expect(200);
        const body = res.body as { accessToken?: string; setupToken?: string };
        if (mandatory.includes(role)) expect(body.setupToken).toBeDefined();
        else expect(body.accessToken).toBeDefined();
      }
    });

    it('links the employees to their users and the legal identity is set', async () => {
      const employees = await get<{
        items: { name: string; userName: string | null }[];
      }>('/employees');
      const byName = new Map(employees.items.map((e) => [e.name, e.userName]));
      expect(byName.get('Kodjo A.')).toBe('Démo Agent d’élevage');
      expect(byName.get('Dr Koffi')).toBe('Démo Vétérinaire');
      const docs = await get<{ legal: Record<string, string> }>(
        '/settings/documents',
      );
      expect(docs.legal).toEqual({
        name: 'Ferme Kpalimé',
        address: "Route d'Atakpamé, Kpalimé, Togo",
        nif: 'À compléter',
        rccm: 'À compléter',
      });
    });
  });

  describe('dashboard and lists', () => {
    it('shows the reference figures', async () => {
      const dash = await get<Dashboard>('/dashboard');
      expect(dash.kpis).toEqual({
        poultryAlive: 11570,
        activePoultryBatches: 3,
        pigs: 245,
        eggsLastDay: 2480,
        layingRate: 87,
        mortalityRate: 3.6,
      });
      expect(dash.activeBuildings).toBe(5);
      expect(dash.tasks).toEqual({ done: 1, pending: 3 });
      expect(dash.upcomingTasks).toHaveLength(3);
      expect(dash.eggSeries).toHaveLength(5);
      expect(dash.alerts.total).toBe(21);
    });

    it('lists tasks and equipment by status as the reference does', async () => {
      expect((await get<Page>('/tasks')).statusCounts).toEqual({
        A_FAIRE: 2,
        EN_COURS: 1,
        TERMINEE: 1,
      });
      expect((await get<Page>('/equipment')).statusCounts).toEqual({
        BON: 2,
        A_SURVEILLER: 1,
        EN_PANNE: 1,
      });
      expect((await get<Page>('/equipment?retired=true')).items).toHaveLength(
        1,
      );
      const tasks = (await get<Page>('/tasks')).items as {
        title: string;
        status: string;
        overdue: boolean;
        recurrence: string;
        completedDate: string | null;
      }[];
      expect(
        tasks
          .filter((t) => t.overdue)
          .map((t) => t.title)
          .sort(),
      ).toEqual([
        'Nettoyage Porcherie 2',
        'Pesée hebdomadaire LC-2026-14',
        'Vaccination Gumboro LC-2026-15',
      ]);
      expect(tasks.find((t) => t.recurrence === 'HEBDOMADAIRE')?.title).toBe(
        'Pesée hebdomadaire LC-2026-14',
      );
      expect(tasks.find((t) => t.status === 'TERMINEE')?.completedDate).toBe(
        day(0),
      );
    });

    it('has the equipment of the reference with their next maintenance relative to the day', async () => {
      const rows = (await get<Page>('/equipment')).items as {
        name: string;
        condition: string;
        nextMaintenance: string | null;
        maintenanceDue: boolean;
      }[];
      const by = (name: string) => rows.find((r) => r.name.startsWith(name))!;
      expect(by('Pompe').nextMaintenance).toBe(day(1));
      expect(by('Pompe').maintenanceDue).toBe(false);
      expect(by('Couveuse').condition).toBe('A_SURVEILLER');
      expect(by('Ventilateur').condition).toBe('EN_PANNE');
      expect(by('Groupe').maintenanceDue).toBe(true);
      const interventions = (await get<Page>('/maintenance')).items as {
        cost: number | null;
      }[];
      expect(interventions.length).toBeGreaterThanOrEqual(3);
      expect(interventions.every((i) => (i.cost ?? 0) > 0)).toBe(true);
    });

    it('holds a week of attendance for the four employees', async () => {
      const { items, total } = await get<{
        items: { date: string; status: string }[];
        total: number;
      }>('/attendance?pageSize=200');
      expect(total).toBe(20);
      expect(new Set(items.map((i) => i.date)).size).toBe(5);
      expect(new Set(items.map((i) => i.status))).toEqual(
        new Set(['PRESENT', 'ABSENT', 'CONGE', 'MALADIE']),
      );
      expect(items.every((i) => i.date <= day(0))).toBe(true);
    });

    it('has data in every module', async () => {
      const paths = [
        '/sites',
        '/buildings',
        '/zones',
        '/breeds',
        '/batches?species=AVICOLE',
        '/batches?species=PORCIN',
        '/animals',
        '/egg-production',
        '/incubations',
        '/breeding',
        '/feed-products',
        '/feed-distributions',
        '/stock',
        '/stock/movements',
        '/suppliers',
        '/purchases',
        '/health-acts',
        '/vaccination-plans',
        '/biosecurity-logs',
        '/incidents',
        '/quarantines',
        '/customers',
        '/quotes',
        '/sales',
        '/credit-notes',
        '/sales/payments',
        '/finance/entries',
        '/employees',
        '/attendance',
        '/tasks',
        '/equipment',
        '/maintenance',
      ];
      for (const path of paths) {
        const body = await get<
          { total?: number; items?: unknown[] } | unknown[]
        >(path);
        const rows = Array.isArray(body) ? body : (body.items ?? []);
        expect({ path, rows: rows.length > 0 }).toEqual({ path, rows: true });
      }
    });
  });

  describe('alerts', () => {
    it('opens every title of the reference, plus the ones its data cannot show', async () => {
      const { items } = await get<{
        items: { title: string; level: string }[];
      }>('/alerts');
      expect(items.map((a) => a.title).sort()).toEqual(
        [
          'Stock faible : Aliment ponte',
          'Stock critique : Aliment engraissement porc',
          'Produit périmé : Vaccin Newcastle',
          'Produit bientôt périmé : Vermifuge porcin',
          'Mortalité élevée LC-2026-14',
          'Mortalité élevée LC-2026-15',
          'Mortalité élevée LP-2026-03',
          'Mise bas TR-014',
          'Consommation anormale LC-2026-14',
          'Consommation anormale LC-2026-14',
          'Vaccination à venir',
          'Vaccination en retard',
          'Désinfection en retard',
          'Traitement en retard',
          'Tâche en retard',
          'Tâche en retard',
          'Tâche en retard',
          'Maintenance due',
          'Maintenance due',
          'Équipement en panne',
          'Créance FA-0309',
        ].sort(),
      );
      expect(new Set(items.map((a) => a.level))).toEqual(
        new Set(['URGENT', 'A_VOIR']),
      );
      const firstToWatch = items.findIndex((a) => a.level === 'A_VOIR');
      expect(
        items.slice(0, firstToWatch).every((a) => a.level === 'URGENT'),
      ).toBe(true);
      expect(items.slice(firstToWatch).every((a) => a.level === 'A_VOIR')).toBe(
        true,
      );
    });

    it('fires every registered rule at least once', async () => {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: ADMIN_EMAIL },
      });
      const ctx: RequestContext = {
        user: {
          id: admin.id,
          name: admin.name,
          role: admin.role,
          organizationId: admin.organizationId,
        },
        farmId,
        allFarms: false,
        farmIds: [farmId],
      };
      const stored = await get<Record<string, unknown>>('/settings');
      const settings = Object.fromEntries(
        Object.entries(stored).filter(([, v]) => typeof v === 'number'),
      ) as Record<string, number>;
      const rules = app.get(AlertsRegistry).all();
      expect(rules.length).toBeGreaterThanOrEqual(10);
      for (const [index, { rule }] of rules.entries()) {
        const items = await rule(ctx, settings);
        expect({ rule: index, fired: items.length > 0 }).toEqual({
          rule: index,
          fired: true,
        });
      }
    });
  });

  describe('every state of a document', () => {
    it('has the invoices of the reference with their remaining amount, a partial payment and a credit note', async () => {
      const { items } = await get<{
        items: {
          number: string | null;
          status: string;
          total: number;
          due: number;
          credited: number;
        }[];
      }>('/sales?pageSize=50');
      const by = (n: string) => items.find((i) => i.number === n)!;
      expect(by('FA-0310')).toMatchObject({
        status: 'SOLDEE',
        total: 1050000,
        due: 0,
      });
      expect(by('FA-0309')).toMatchObject({
        status: 'PARTIELLE',
        total: 1000000,
        due: 400000,
      });
      expect(by('FA-0305')).toMatchObject({
        status: 'SOLDEE',
        total: 1620000,
        due: 0,
      });
      expect(by('FA-0301')).toMatchObject({
        status: 'SOLDEE',
        total: 300000,
        due: 0,
      });
      expect(by('FA-0311')).toMatchObject({
        status: 'PARTIELLE',
        total: 250000,
        credited: 25000,
        due: 125000,
      });
      expect(by('FA-0312').status).toBe('ANNULEE');
      expect(items.filter((i) => i.status === 'BROUILLON')).toHaveLength(1);
    });

    it('has purchases in every state, quotes in every state and the stock levels of the reference', async () => {
      const purchases = await get<{ statusCounts: Record<string, number> }>(
        '/purchases',
      );
      expect(purchases.statusCounts).toEqual({
        DEMANDE: 1,
        VALIDEE: 1,
        COMMANDEE: 1,
        RECUE: 1,
        PAYEE: 1,
        ANNULEE: 1,
      });
      const quotes = (await get<{ items: { status: string }[] }>('/quotes'))
        .items;
      expect(new Set(quotes.map((q) => q.status)).size).toBeGreaterThanOrEqual(
        4,
      );
      const stock = (
        await get<{
          items: {
            name: string;
            quantity: number;
            level: string;
            daysOfStock: number | null;
          }[];
        }>('/stock')
      ).items;
      const by = (n: string) => stock.find((s) => s.name === n)!;
      expect(by('Aliment croissance chair')).toMatchObject({
        quantity: 4200,
        level: 'ok',
        daysOfStock: 6,
      });
      expect(by('Aliment ponte')).toMatchObject({
        quantity: 900,
        level: 'faible',
        daysOfStock: 2,
      });
      expect(by('Aliment engraissement porc')).toMatchObject({
        quantity: 600,
        level: 'critique',
        daysOfStock: 1,
      });
      expect(by('Vaccin Gumboro')).toMatchObject({ quantity: 12, level: 'ok' });
      expect(by('Copeaux litière')).toMatchObject({
        quantity: 80,
        level: 'ok',
        daysOfStock: 13,
      });
    });

    it('has a health act under withdrawal, acts planned late and one planned ahead', async () => {
      const acts = (
        await get<{
          items: {
            status: string;
            productName: string | null;
            withdrawalDays: number | null;
            withdrawalUntil: string | null;
          }[];
        }>('/health-acts?pageSize=50')
      ).items;
      const treated = acts.find((a) => a.productName === 'Amoxicilline');
      expect(treated).toMatchObject({
        status: 'REALISE',
        withdrawalDays: 10,
        withdrawalUntil: day(-4 + 3 + 10),
      });
      expect(
        acts
          .filter((a) => a.status === 'EN_RETARD')
          .map((a) => a.productName)
          .sort(),
      ).toEqual(['Déparasitage', 'Newcastle rappel', 'Virkon S']);
      expect(
        acts.filter((a) => a.status === 'PLANIFIE').map((a) => a.productName),
      ).toEqual(['Gumboro']);
      const report = await get<{
        sections: { key: string; table?: { rows: { target: string }[] } }[];
      }>(`/reports/sanitaire?from=${day(-60)}&to=${day(0)}`);
      expect(
        report.sections
          .find((s) => s.key === 'delais')
          ?.table?.rows.map((r) => r.target),
      ).toEqual(['LC-2026-15']);
    });
  });

  describe('finance', () => {
    it('holds its invariants: the summary equals the ledger, the activities and the categories', async () => {
      const summary = await get<Summary>('/finance/summary');
      // 3 970 000 of the reference invoices + FA-0311 (250 000 - 25 000 credited) + a manual receipt of 60 000.
      expect(summary.revenue).toBe(3970000 + 225000 + 60000);
      expect(summary.margin).toBe(summary.revenue - summary.expenses);
      const sum = (
        rows: { revenue?: number; expenses?: number; amount?: number }[],
        key: 'revenue' | 'expenses' | 'amount',
      ) => rows.reduce((acc, r) => acc + (r[key] ?? 0), 0);
      expect(sum(summary.byActivity, 'revenue')).toBe(summary.revenue);
      expect(sum(summary.byActivity, 'expenses')).toBe(summary.expenses);
      expect(
        sum(
          summary.byCategory.filter(
            (c: { kind: string }) => c.kind === 'RECETTE',
          ),
          'amount',
        ),
      ).toBe(summary.revenue);
      expect(
        sum(
          summary.byCategory.filter(
            (c: { kind: string }) => c.kind === 'DEPENSE',
          ),
          'amount',
        ),
      ).toBe(summary.expenses);

      const entries = (
        await get<{
          items: { kind: string; amount: number; origin: string }[];
        }>('/finance/entries?pageSize=200')
      ).items;
      const ledger = (kind: string) =>
        entries
          .filter((e) => e.kind === kind)
          .reduce((acc, e) => acc + e.amount, 0);
      expect(ledger('RECETTE')).toBe(summary.revenue);
      expect(ledger('DEPENSE')).toBe(summary.expenses);
      expect(new Set(entries.map((e) => e.origin))).toEqual(
        new Set(['MANUEL', 'ACHAT', 'FACTURE', 'AVOIR', 'MAINTENANCE']),
      );
    });

    it('owes what the invoices owe: the receivables are the sum of what is due on the issued invoices', async () => {
      const summary = await get<Summary>('/finance/summary');
      const { items } = await get<{ items: { status: string; due: number }[] }>(
        '/sales?pageSize=50',
      );
      const owed = items
        .filter((i) => i.status !== 'ANNULEE' && i.status !== 'BROUILLON')
        .reduce((acc, i) => acc + i.due, 0);
      expect(summary.receivables).toBe(owed);
      expect(summary.receivables).toBe(400000 + 125000);
    });

    it('keeps the birds alive and the stock levels equal to what the ledgers say', async () => {
      const lots = await get<{ items: { code: string; alive: number }[] }>(
        '/batches?species=AVICOLE&pageSize=50',
      );
      expect(lots.items.reduce((acc, l) => acc + l.alive, 0)).toBe(11570);
      const net = await prisma.$queryRaw<{ item: string; ledger: number }[]>`
        SELECT i."name" AS item, COALESCE(SUM(m."quantity"), 0)::float AS ledger
        FROM "StockItem" i LEFT JOIN "StockMovement" m ON m."stockItemId" = i."id" GROUP BY i."name"`;
      const stock = (
        await get<{ items: { name: string; quantity: number }[] }>('/stock')
      ).items;
      for (const row of net) {
        expect(stock.find((s) => s.name === row.item)?.quantity).toBe(
          row.ledger,
        );
      }
    });
  });

  describe('reports', () => {
    const hasContent = (report: {
      sections: {
        rows?: unknown[];
        cards?: unknown[];
        table?: { rows: unknown[] };
      }[];
    }) =>
      report.sections.every(
        (s) =>
          (s.rows?.length ?? 0) +
            (s.cards?.length ?? 0) +
            (s.table?.rows.length ?? 0) >
          0,
      );
    const numbers = (value: unknown): number[] =>
      JSON.stringify(value)
        .match(/"value":-?\d+(\.\d+)?/g)
        ?.map((m) => Number(m.slice(8))) ?? [];

    it.each([
      ['synthese', ''],
      ['quotidien', `?date=${day(-1)}`],
      ['hebdomadaire', `?date=${day(-1)}`],
      ['mensuel', `?date=${day(-20)}`],
      ['annuel', ''],
      ['sanitaire', `?from=${day(-60)}&to=${day(0)}`],
      ['zootechnique', `?from=${day(-60)}&to=${day(0)}`],
    ])(
      'the %s report answers with non-empty sections and figures',
      async (type, query) => {
        const report = await get<{
          type: string;
          sections: {
            rows?: unknown[];
            cards?: unknown[];
            table?: { rows: unknown[] };
          }[];
        }>(`/reports/${type}${query}`);
        expect(report.type).toBe(type);
        expect(report.sections.length).toBeGreaterThan(0);
        expect(hasContent(report)).toBe(true);
        expect(
          numbers(report.sections).some((n) => n !== 0) ||
            JSON.stringify(report.sections).includes('"rows":[{'),
        ).toBe(true);
      },
    );

    it('exports the synthesis to CSV and Excel', async () => {
      await request(app.getHttpServer() as App)
        .get('/api/reports/synthese?format=csv')
        .set(headers)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get('/api/reports/synthese?format=xlsx')
        .set(headers)
        .expect(200);
    });
  });

  describe('guards', () => {
    it('does nothing the second time: exit 0, « déjà chargées » and no row more or less in any table', async () => {
      const before = await tableCounts();
      const second = seedDemo();
      expect(second.status).toBe(0);
      expect(second.out).toContain('Données de démonstration déjà chargées');
      expect(await tableCounts()).toEqual(before);
    });

    it('is refused when NODE_ENV=production without ALLOW_DEMO_SEED=1', async () => {
      const before = await tableCounts();
      const refused = seedDemo({
        NODE_ENV: 'production',
        ALLOW_DEMO_SEED: undefined,
      });
      expect(refused.status).toBe(1);
      expect(refused.out).toContain(
        'La démo ne se charge pas en production (ALLOW_DEMO_SEED=1 pour forcer)',
      );
      const other = seedDemo({
        NODE_ENV: 'production',
        ALLOW_DEMO_SEED: 'true',
      });
      expect(other.status).toBe(1);
      expect(await tableCounts()).toEqual(before);
      // Forced, it still finds the marker and writes nothing.
      const forced = seedDemo({ NODE_ENV: 'production', ALLOW_DEMO_SEED: '1' });
      expect(forced.status).toBe(0);
      expect(forced.out).toContain('Données de démonstration déjà chargées');
      expect(await tableCounts()).toEqual(before);
    });

    it('refuses a farm that holds data without the marker, and says so (a failed run is never half-repeated)', async () => {
      const stored = await marker();
      await prisma.setting.delete({ where: { id: stored!.id } });
      try {
        const before = await tableCounts();
        const refused = seedDemo();
        expect(refused.status).toBe(1);
        expect(refused.out).toContain(
          'La ferme contient déjà des données : chargez la démo sur une base vierge (npm run demo:reset en développement)',
        );
        expect(await tableCounts()).toEqual(before);
      } finally {
        await prisma.setting.create({
          data: {
            organizationId: stored!.organizationId,
            key: 'demoSeed',
            value: stored!.value as object,
          },
        });
      }
    });

    it('refuses a missing or short DEMO_PASSWORD on a blank database, without writing', async () => {
      await resetDb();
      expect(run('npx', ['tsx', 'prisma/seed.ts']).status).toBe(0);
      const before = await tableCounts();
      const short = seedDemo({ DEMO_PASSWORD: 'court' });
      expect(short.status).toBe(1);
      expect(short.out).toContain(
        'DEMO_PASSWORD doit contenir au moins 10 caractères',
      );
      const missing = seedDemo({ DEMO_PASSWORD: undefined });
      expect(missing.status).toBe(1);
      expect(await tableCounts()).toEqual(before);
    });
  });
});
