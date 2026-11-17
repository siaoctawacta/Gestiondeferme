import { spawnSync } from 'child_process';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { signAccessToken } from '../src/access/access-token';
import type { RequestContext } from '../src/access/decorators';
import { AlertsRegistry } from '../src/indicators/alerts/alerts-registry';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, migrateTestDb, resetDb } from './setup';

/**
 * The demo loaded on a day other than the real one, the first of a month (so the month to date holds only today):
 * the clock of the seed process (test/fake-clock.js, DEMO_TODAY) and of this test (fake timers) are moved to it.
 */
const BACKEND = join(__dirname, '..');
const DAY = '2026-12-01';
const ADMIN_EMAIL = 'admin@demo.test';

function run(
  command: string,
  args: string[],
  env: Record<string, string | undefined> = {},
) {
  const result = spawnSync(command, args, {
    cwd: BACKEND,
    env: {
      ...process.env,
      SEED_ADMIN_EMAIL: ADMIN_EMAIL,
      SEED_ADMIN_PASSWORD: 'MotDePasseAdmin-2026',
      DEMO_PASSWORD: 'MotDePasseDemo-2026',
      ...env,
    },
    encoding: 'utf8',
    timeout: 240_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe(`Demo seed loaded on ${DAY}, the first of a month (e2e)`, () => {
  jest.setTimeout(300_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let farmId: string;
  let headers: Record<string, string>;
  let loaded: { status: number | null; out: string };

  const get = async <T = never>(path: string): Promise<T> =>
    (
      await request(app.getHttpServer() as App)
        .get(`/api${path}`)
        .set(headers)
        .expect(200)
    ).body as T;

  beforeAll(async () => {
    migrateTestDb();
    await resetDb();
    expect(run('npx', ['tsx', 'prisma/seed.ts']).status).toBe(0);
    expect(run('npm', ['run', 'build:demo']).status).toBe(0);
    loaded = run('node', ['dist-demo/prisma/demo/seed-demo.js'], {
      DEMO_TODAY: DAY,
      NODE_OPTIONS: `--require ${join(__dirname, 'fake-clock.js')}`,
    });
    app = await createTestApp();
    prisma = new PrismaService();
    // Only the clock is faked: timers and I/O keep running.
    jest.useFakeTimers({
      now: new Date(`${DAY}T12:00:00Z`),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
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
    jest.useRealTimers();
    await prisma.$disconnect();
    await app.close();
  });

  it('completes', () => {
    expect(loaded.out).toContain('Démo chargée');
    expect(loaded.status).toBe(0);
  });

  it('dates everything relative to that day: the pump is due tomorrow, tasks are completed today', async () => {
    const equipment = await get<{
      items: { name: string; nextMaintenance: string }[];
    }>('/equipment');
    expect(
      equipment.items.find((e) => e.name.startsWith('Pompe'))?.nextMaintenance,
    ).toBe('2026-12-02');
    const tasks = await get<{
      items: { status: string; completedDate: string | null }[];
    }>('/tasks');
    expect(
      tasks.items.find((t) => t.status === 'TERMINEE')?.completedDate,
    ).toBe(DAY);
    const attendance = await get<{ items: { date: string }[] }>(
      '/attendance?pageSize=200',
    );
    expect(new Set(attendance.items.map((a) => a.date))).toEqual(
      new Set(['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30', DAY]),
    );
  });

  it('fires every alert rule', async () => {
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
    const alerts = await get<{ total: number }>('/alerts');
    expect(alerts.total).toBe(21);
  });

  it('has a month to date that is not empty on the first of the month', async () => {
    const summary = await get<{ revenue: number; expenses: number }>(
      `/finance/summary?from=${DAY}&to=${DAY}`,
    );
    expect(summary.revenue).toBeGreaterThan(0);
    expect(summary.expenses).toBeGreaterThan(0);
    const dashboard = await get<{
      profitability: { revenue: number; expenses: number };
    }>('/dashboard');
    expect(dashboard.profitability.revenue).toBeGreaterThan(0);
    expect(dashboard.profitability.expenses).toBeGreaterThan(0);
  });

  it('answers the monthly report with non-empty sections', async () => {
    const report = await get<{
      from: string;
      to: string;
      sections: {
        key: string;
        rows?: unknown[];
        cards?: unknown[];
        table?: { rows: unknown[] };
      }[];
    }>(`/reports/mensuel?date=${DAY}`);
    expect(report.from).toBe(DAY);
    for (const section of report.sections) {
      expect(
        (section.rows?.length ?? 0) +
          (section.cards?.length ?? 0) +
          (section.table?.rows.length ?? 0),
      ).toBeGreaterThan(0);
    }
    const finance = report.sections.find((s) => s.key === 'finance');
    expect(finance?.table?.rows.length).toBeGreaterThanOrEqual(2);
    const synthese = await get<{
      sections: { rows?: { value: number | null }[] }[];
    }>('/reports/synthese');
    expect(synthese.sections[0].rows?.some((r) => (r.value ?? 0) !== 0)).toBe(
      true,
    );
  });
});
