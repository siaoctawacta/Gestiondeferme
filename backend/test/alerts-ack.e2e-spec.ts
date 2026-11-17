import { INestApplication } from '@nestjs/common';
import type { RequestContext } from '../src/access/decorators';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { AlertAcksService } from '../src/indicators/alerts/alert-acks.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Msg, World } from './fixtures';
import { countQueries } from './query-counter';
import { createTestApp } from './setup';

interface Alert {
  key: string;
  title: string;
  level: string;
  acknowledged?: boolean;
}
interface Alerts {
  total: number;
  acknowledgedCount?: number;
  items: Alert[];
}

const DAY_MS = 86_400_000;

describe('Per-user alert acknowledgement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let admin: Headers;
  let alice: Headers;
  let bob: Headers;
  let acks: AlertAcksService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
    acks = app.get(AlertAcksService);
  });

  beforeEach(async () => {
    await world.reset();
    acks.now = () => new Date();
    admin = await world.actor('SUPER_ADMIN');
    alice = await world.actor('DIRECTEUR_FERME');
    bob = await world.actor('DIRECTEUR_FERME');
  });

  afterAll(async () => {
    acks.now = () => new Date();
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const alerts = async (h: Headers, qs = ''): Promise<Alerts> =>
    (await http().get(`/api/alerts${qs}`).set(h).expect(200)).body as Alerts;
  const ack = (h: Headers, key: string) =>
    http().post('/api/alerts/ack').set(h).send({ key });
  const unack = (h: Headers, key: string) =>
    http().post('/api/alerts/unack').set(h).send({ key });
  const dashboardTotal = async (h: Headers) =>
    (
      (await http().get('/api/dashboard').set(h).expect(200)).body as {
        alerts: Alerts;
      }
    ).alerts.total;
  const clockPlus = (days: number) => {
    acks.now = () => new Date(Date.now() + days * DAY_MS);
  };

  async function overdueTask(title = 'Nettoyer le silo') {
    const user = await prisma.user.findFirstOrThrow();
    const task = await prisma.task.create({
      data: {
        farmId: world.farmId,
        title,
        dueDate: new Date(daysAgo(3)),
        createdById: user.id,
      },
    });
    return `task:${task.id}`;
  }

  describe('acknowledging', () => {
    it('hides the alert for that user only: the list, the dashboard and the count; the report ignores it', async () => {
      const key = await overdueTask();
      expect((await alerts(alice)).total).toBe(1);
      expect(await dashboardTotal(alice)).toBe(1);
      const before = (await http().get('/api/reports/synthese').set(admin))
        .body as { sections: { rows?: { key: string; value: number }[] }[] };
      const open = (b: typeof before) =>
        b.sections[0].rows!.find((r) => r.key === 'alerts')!.value;
      expect(open(before)).toBe(1);

      await ack(alice, key).expect(200);

      const mine = await alerts(alice);
      expect(mine).toMatchObject({ total: 0, acknowledgedCount: 1, items: [] });
      expect(await dashboardTotal(alice)).toBe(0);
      const theirs = await alerts(bob);
      expect(theirs.total).toBe(1);
      expect(theirs.acknowledgedCount).toBe(0);
      expect(await dashboardTotal(bob)).toBe(1);
      const report = (
        await http().get('/api/reports/synthese').set(alice).expect(200)
      ).body as typeof before;
      expect(open(report)).toBe(1);
    });

    it('lists it with the flag under ?acknowledged=include, without counting it', async () => {
      const key = await overdueTask();
      await ack(alice, key).expect(200);
      const all = await alerts(alice, '?acknowledged=include');
      expect(all.total).toBe(0);
      expect(all.acknowledgedCount).toBe(1);
      expect(all.items).toMatchObject([{ key, acknowledged: true }]);
      const other = await alerts(bob, '?acknowledged=include');
      expect(other.items).toMatchObject([{ key, acknowledged: false }]);
    });

    it('is a no-op when repeated, and an unknown key is a 404', async () => {
      const key = await overdueTask();
      await ack(alice, key).expect(200);
      const first = await prisma.alertAck.findFirstOrThrow();
      await ack(alice, key).expect(200);
      const rows = await prisma.alertAck.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].acknowledgedAt).toEqual(first.acknowledgedAt);
      const res = await ack(alice, 'task:inconnue').expect(404);
      expect((res.body as Msg).message).toBe('Alerte introuvable');
      expect(await prisma.alertAck.count()).toBe(1);
    });

    it('un-hides with unack, and unack of a key never hidden is harmless', async () => {
      const key = await overdueTask();
      await ack(alice, key).expect(200);
      await unack(alice, key).expect(200);
      expect((await alerts(alice)).total).toBe(1);
      expect(await prisma.alertAck.count()).toBe(0);
      await unack(alice, key).expect(200);
    });

    it('shows the alert again after alertAckDays (7 by default), not before', async () => {
      const key = await overdueTask();
      await ack(alice, key).expect(200);
      clockPlus(6);
      expect((await alerts(alice)).total).toBe(0);
      clockPlus(8);
      const again = await alerts(alice);
      expect(again.total).toBe(1);
      expect(again.acknowledgedCount).toBe(0);
      expect(await dashboardTotal(alice)).toBe(1);
      // Acknowledging again hides it for another period.
      await ack(alice, key).expect(200);
      expect((await alerts(alice)).total).toBe(0);
    });

    it('follows the alertAckDays setting', async () => {
      const key = await overdueTask();
      await http()
        .put('/api/settings/alertAckDays')
        .set(admin)
        .send({ value: 2 })
        .expect(200);
      await ack(alice, key).expect(200);
      clockPlus(1);
      expect((await alerts(alice)).total).toBe(0);
      clockPlus(3);
      expect((await alerts(alice)).total).toBe(1);
    });

    it('shows an acknowledged A_VOIR stock alert again when it turns URGENT', async () => {
      const item = (
        await http()
          .post('/api/stock-items')
          .set(admin)
          .send({ name: 'Aliment ponte', category: 'ALIMENT', unit: 'kg' })
          .expect(201)
      ).body as { id: string };
      const move = (body: Record<string, unknown>) =>
        http()
          .post('/api/stock/movements')
          .set(admin)
          .send({ itemId: item.id, date: daysAgo(10), ...body })
          .expect(201);
      await move({
        type: 'ENTREE',
        quantity: 1000,
        unitCost: 300,
        reason: 'ACHAT',
      });
      await http()
        .put(`/api/stock/${item.id}/thresholds`)
        .set(admin)
        .send({ minQty: 1500 })
        .expect(200);
      const first = await alerts(alice);
      expect(first.items).toMatchObject([
        { title: 'Stock faible : Aliment ponte', level: 'A_VOIR' },
      ]);
      await ack(alice, first.items[0].key).expect(200);
      expect((await alerts(alice)).total).toBe(0);

      await move({
        type: 'SORTIE',
        quantity: 500,
        reason: 'CONSOMMATION',
        date: daysAgo(1),
      });
      const worse = await alerts(alice);
      expect(worse.items).toMatchObject([
        { key: first.items[0].key, level: 'URGENT' },
      ]);
      expect(worse.total).toBe(1);
      expect(worse.acknowledgedCount).toBe(0);
    });

    it('refuses a missing or non-string key, and an extra field', async () => {
      await http().post('/api/alerts/ack').set(alice).send({}).expect(400);
      await http()
        .post('/api/alerts/ack')
        .set(alice)
        .send({ key: 12 })
        .expect(400);
      await http()
        .post('/api/alerts/unack')
        .set(alice)
        .send({ key: 'x', extra: true })
        .expect(400);
    });

    it('does not let a user acknowledge an alert he cannot see', async () => {
      const key = await overdueTask();
      // The task alert needs taches:read, which the accountant lacks.
      const compta = await world.actor('COMPTABLE');
      expect((await alerts(compta)).total).toBe(0);
      await ack(compta, key).expect(404);
      expect(await prisma.alertAck.count()).toBe(0);
    });
  });

  describe('cost', () => {
    it('adds exactly one query to the open alerts, whatever the number of acknowledgements', async () => {
      const keys = [
        await overdueTask('Une'),
        await overdueTask('Deux'),
        await overdueTask('Trois'),
      ];
      const dashboard = app.get(DashboardService);
      const user = await prisma.user.findFirstOrThrow({
        where: { role: 'DIRECTEUR_FERME' },
      });
      const ctx: RequestContext = {
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
        },
        farmId: world.farmId,
        allFarms: false,
        farmIds: [world.farmId],
      };
      const open = await countQueries(app, async () => {
        await dashboard.openAlerts(ctx);
      });
      const none = await countQueries(app, async () => {
        await dashboard.alerts(ctx, { includeAcknowledged: false });
      });
      expect(none).toBe(open + 1);
      for (const k of keys) {
        await prisma.alertAck.create({
          data: { userId: user.id, key: k, level: 'A_VOIR' },
        });
      }
      const three = await countQueries(app, async () => {
        const res = await dashboard.alerts(ctx, { includeAcknowledged: true });
        expect(res.acknowledgedCount).toBe(3);
      });
      expect(three).toBe(none);
    });
  });
});
