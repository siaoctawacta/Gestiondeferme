import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { DashboardDto } from '../src/dashboard/dashboard.types';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

const DAY_MS = 86_400_000;
const dayStr = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
const day = (n: number) => new Date(dayStr(n));

interface AlertsBody {
  total: number;
  items: { key: string; title: string; detail: string; level: string }[];
}

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let farmA: string;
  let farmB: string;
  let orgId: string;
  let userId: string;
  let buildingA: string;
  let headersFor: (farm: string) => Record<string, string>;

  const http = () => request(app.getHttpServer() as App);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await resetDb();
    const org = await createOrganization();
    orgId = org.id;
    farmA = (await createFarm(org.id, 'Ferme Kpalimé')).id;
    farmB = (await createFarm(org.id, 'Ferme Atakpamé')).id;
    const site = await prisma.site.create({
      data: { farmId: farmA, name: 'Site A' },
    });
    const building = (name: string, status: 'ACTIF' | 'MAINTENANCE') =>
      prisma.building.create({
        data: {
          farmId: farmA,
          siteId: site.id,
          name,
          type: 'AVICOLE',
          capacity: 100,
          status,
        },
      });
    buildingA = (await building('B1', 'ACTIF')).id;
    await building('B2', 'ACTIF');
    await building('B3', 'MAINTENANCE');
    const user = await createUser({
      organizationId: org.id,
      role: 'PROPRIETAIRE',
      farmIds: [farmA, farmB],
    });
    userId = user.id;
    const token = await tokenFor(user.id);
    headersFor = (farm) => ({
      Authorization: `Bearer ${token}`,
      'X-Farm-Id': farm,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('returns the contract with real farmName and activeBuildings', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set(headersFor(farmA))
      .expect(200);
    const body = res.body as DashboardDto;
    expect(body.farmName).toBe('Ferme Kpalimé');
    expect(body.activeBuildings).toBe(2);
    expect(body.kpis.mortalityRate).toBeNull();
    expect(body.kpis.layingRate).toBeNull();
    expect(body.profitability).toEqual({
      revenue: 0,
      expenses: 0,
      margin: 0,
      marginPct: null,
      receivables: 0,
    });
    expect(body.revenueVsExpenses).toEqual([
      { activity: 'Avicole', revenue: 0, expenses: 0 },
      { activity: 'Porcin', revenue: 0, expenses: 0 },
      { activity: 'Général', revenue: 0, expenses: 0 },
    ]);
    expect(body.eggSeries).toEqual([]);
    expect(body.upcomingTasks).toEqual([]);
    expect(body.alerts).toEqual({ total: 0, items: [] });
  });

  it('scopes activeBuildings to the selected farm', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set(headersFor(farmB))
      .expect(200);
    const body = res.body as DashboardDto;
    expect(body.farmName).toBe('Ferme Atakpamé');
    expect(body.activeBuildings).toBe(0);
  });

  it('aggregates across farms under X-Farm-Id: all', async () => {
    const res = await http()
      .get('/api/dashboard')
      .set(headersFor('all'))
      .expect(200);
    const body = res.body as DashboardDto;
    expect(body.farmName).toBe('Toutes les fermes');
    expect(body.activeBuildings).toBe(2);
  });

  it('serves GET /api/alerts', async () => {
    const res = await http()
      .get('/api/alerts')
      .set(headersFor(farmA))
      .expect(200);
    expect(res.body).toEqual({ total: 0, items: [] });
  });

  it('requires authentication', async () => {
    await http().get('/api/dashboard').expect(401);
  });

  describe('production figures and alerts', () => {
    let lots: Record<'one' | 'two' | 'three', string>;

    beforeEach(() => {
      productId = undefined;
    });

    async function lot(
      farmId: string,
      buildingId: string,
      code: string,
      initialCount: number,
      over: Record<string, unknown> = {},
    ): Promise<string> {
      const created = await prisma.animalBatch.create({
        data: {
          farmId,
          buildingId,
          code,
          species: 'AVICOLE',
          type: 'PONDEUSE',
          entryDate: day(60),
          initialCount,
          ...over,
        },
      });
      return created.id;
    }

    async function deaths(farmId: string, batchId: string, quantity: number) {
      await prisma.batchEvent.create({
        data: {
          farmId,
          batchId,
          date: day(10),
          type: 'MORTALITE',
          quantity,
          createdById: userId,
        },
      });
    }

    let productId: string | undefined;
    const feed = async (batchId: string, date: number, quantityKg: number) => {
      productId ??= (
        await prisma.feedProduct.create({
          data: {
            organizationId: orgId,
            name: 'Aliment',
            kind: 'ALIMENT_COMPLET',
            unitCost: 300,
          },
        })
      ).id;
      return prisma.feedDistribution.create({
        data: {
          farmId: farmA,
          batchId,
          feedProductId: productId,
          date: day(date),
          quantityKg,
          unitCost: 300,
          cost: quantityKg * 300,
        },
      });
    };

    const eggs = (batchId: string, date: number, collected: number) =>
      prisma.eggProduction.create({
        data: { farmId: farmA, batchId, date: day(date), collected },
      });

    async function seedReference() {
      lots = {
        one: await lot(farmA, buildingA, 'LC-0001', 5000),
        two: await lot(farmA, buildingA, 'LC-0002', 4000),
        three: await lot(farmA, buildingA, 'LC-0003', 3000),
      };
      await deaths(farmA, lots.one, 180);
      await deaths(farmA, lots.two, 100);
      await deaths(farmA, lots.three, 150);
      await lot(farmA, buildingA, 'LC-OLD', 900, { status: 'CLOTURE' });
      // eggs: five recorded days, the last one only for the third lot
      for (const [date, one, two] of [
        [5, 1000, 900],
        [4, 1100, 950],
        [3, 1200, 1000],
        [2, 1250, 1010],
      ]) {
        await eggs(lots.one, date, one);
        await eggs(lots.two, date, two);
      }
      await eggs(lots.three, 6, 2000);
      await eggs(lots.three, 1, 2480);
      await feed(lots.one, 1, 800);
      await feed(lots.two, 1, 1000);
      await prisma.waterConsumption.createMany({
        data: [
          { farmId: farmA, batchId: lots.one, date: day(1), liters: 2000 },
          { farmId: farmA, batchId: lots.two, date: day(1), liters: 2370 },
        ],
      });
      // pigs: 4 live animals + a dead one + a lot of 241 = 245
      const sow = await prisma.animal.create({
        data: {
          farmId: farmA,
          tag: 'TR-001',
          category: 'TRUIE',
          sex: 'F',
          buildingId: buildingA,
          status: 'GESTANTE',
        },
      });
      for (const [tag, status] of [
        ['TR-002', 'ACTIF'],
        ['TR-003', 'ALLAITANTE'],
        ['VR-001', 'ACTIF'],
        ['TR-004', 'MORT'],
      ] as const) {
        await prisma.animal.create({
          data: {
            farmId: farmA,
            tag,
            category: tag.startsWith('VR') ? 'VERRAT' : 'TRUIE',
            sex: tag.startsWith('VR') ? 'M' : 'F',
            buildingId: buildingA,
            status,
          },
        });
      }
      await lot(farmA, buildingA, 'PE-0001', 241, {
        species: 'PORCIN',
        type: 'ENGRAISSEMENT',
      });
      await prisma.breedingRecord.create({
        data: {
          farmId: farmA,
          sowId: sow.id,
          method: 'SAILLIE',
          serviceDate: day(120),
          expectedFarrowingDate: day(6),
          status: 'GESTATION',
        },
      });
    }

    const dashboard = async (farm: string) =>
      (await http().get('/api/dashboard').set(headersFor(farm)).expect(200))
        .body as DashboardDto;

    it('computes the figures from the herd, eggs, feed and water records', async () => {
      await seedReference();
      const body = await dashboard(farmA);
      expect(body.kpis).toEqual({
        poultryAlive: 11570,
        activePoultryBatches: 3,
        pigs: 245,
        eggsLastDay: 2480,
        layingRate: 87,
        mortalityRate: 3.6,
      });
      expect(body.feedDistributedKg).toBe(1800);
      expect(body.waterConsumedL).toBe(4370);
      expect(body.eggSeries).toEqual([
        { date: dayStr(5), eggs: 1900 },
        { date: dayStr(4), eggs: 2050 },
        { date: dayStr(3), eggs: 2200 },
        { date: dayStr(2), eggs: 2260 },
        { date: dayStr(1), eggs: 2480 },
      ]);
      expect(body.tasks).toEqual({ done: 0, pending: 0 });
    });

    it('raises the mortality and farrowing alerts, URGENT first', async () => {
      await seedReference();
      const body = await dashboard(farmA);
      expect(body.alerts.total).toBe(3);
      const [first, ...rest] = body.alerts.items;
      expect(first).toMatchObject({
        title: 'Mise bas TR-001',
        detail: `Dépassée depuis 6 j (${dayStr(6)})`,
        level: 'URGENT',
        module: 'reproduction',
      });
      expect(rest.map((i) => [i.title, i.detail, i.level])).toEqual([
        ['Mortalité élevée LC-0001', '3.6% sur 5000 sujets', 'A_VOIR'],
        ['Mortalité élevée LC-0003', '5% sur 3000 sujets', 'A_VOIR'],
      ]);
      const res = await http()
        .get('/api/alerts')
        .set(headersFor(farmA))
        .expect(200);
      expect(res.body).toEqual(body.alerts);
    });

    it('follows the mortalityCumulPct setting', async () => {
      await seedReference();
      await prisma.setting.create({
        data: { organizationId: orgId, key: 'mortalityCumulPct', value: 2 },
      });
      const body = await dashboard(farmA);
      expect(body.alerts.items.map((i) => i.title)).toContain(
        'Mortalité élevée LC-0002',
      );
      expect(body.alerts.total).toBe(4);
    });

    it('raises an urgent alert for a bad day of mortality', async () => {
      const id = await lot(farmA, buildingA, 'LC-0007', 1000);
      await prisma.batchEvent.create({
        data: {
          farmId: farmA,
          batchId: id,
          date: day(0),
          type: 'MORTALITE',
          quantity: 8,
          createdById: userId,
        },
      });
      const body = await dashboard(farmA);
      expect(body.alerts.items).toEqual([
        expect.objectContaining({
          title: 'Mortalité élevée LC-0007',
          detail: `8 morts le ${dayStr(0)} (0.8% de l'effectif)`,
          level: 'URGENT',
        }),
      ]);
    });

    it('raises Consommation anormale for a feed day 40 % above the average', async () => {
      const id = await lot(farmA, buildingA, 'LC-0009', 1000);
      for (const d of [2, 3, 4, 5]) await feed(id, d, 100);
      await feed(id, 1, 140);
      const body = await dashboard(farmA);
      expect(body.alerts.items).toEqual([
        {
          key: `consumption:${id}:${dayStr(1)}:feed`,
          title: 'Consommation anormale LC-0009',
          detail: 'Aliment : 140 kg (moyenne 100 kg)',
          level: 'A_VOIR',
          module: 'alimentation',
        },
      ]);
    });

    it('needs three prior days to judge a consumption', async () => {
      const id = await lot(farmA, buildingA, 'LC-0009', 1000);
      for (const d of [2, 3]) await feed(id, d, 100);
      await feed(id, 1, 300);
      expect((await dashboard(farmA)).alerts.total).toBe(0);
    });

    it('caps the dashboard list at 5 while total and /alerts hold them all', async () => {
      for (let i = 1; i <= 6; i += 1) {
        const id = await lot(farmA, buildingA, `LC-10${i}`, 100);
        await deaths(farmA, id, 10);
      }
      const body = await dashboard(farmA);
      expect(body.alerts.total).toBe(6);
      expect(body.alerts.items).toHaveLength(5);
      const res = await http()
        .get('/api/alerts')
        .set(headersFor(farmA))
        .expect(200);
      const all = res.body as AlertsBody;
      expect(all.total).toBe(6);
      expect(all.items).toHaveLength(6);
      expect(body.alerts.items).toEqual(all.items.slice(0, 5));
    });

    it('keeps farms apart and sums them under all', async () => {
      await seedReference();
      const siteB = await prisma.site.create({
        data: { farmId: farmB, name: 'Site B' },
      });
      const buildingB = await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: siteB.id,
          name: 'PB',
          type: 'AVICOLE',
          capacity: 5000,
        },
      });
      const other = await lot(farmB, buildingB.id, 'LC-B001', 1000);
      await deaths(farmB, other, 50);
      const b = await dashboard(farmB);
      expect(b.kpis).toEqual({
        poultryAlive: 950,
        activePoultryBatches: 1,
        pigs: 0,
        eggsLastDay: 0,
        layingRate: null,
        mortalityRate: 5,
      });
      expect(b.eggSeries).toEqual([]);
      expect(b.feedDistributedKg).toBe(0);
      expect(b.waterConsumedL).toBe(0);
      expect(b.alerts.items.map((i) => i.title)).toEqual([
        'Mortalité élevée LC-B001',
      ]);
      const a = await dashboard(farmA);
      expect(a.alerts.items.map((i) => i.title)).not.toContain(
        'Mortalité élevée LC-B001',
      );
      const all = await dashboard('all');
      expect(all.kpis.poultryAlive).toBe(12520);
      expect(all.kpis.activePoultryBatches).toBe(4);
      expect(all.kpis.mortalityRate).toBe(3.7);
      expect(all.alerts.total).toBe(4);
    });
  });
});
