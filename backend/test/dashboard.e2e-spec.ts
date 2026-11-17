import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HealthAlertsService } from '../src/indicators/alerts/health-alerts.service';
import { StockAlertsService } from '../src/indicators/alerts/stock-alerts.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { countQueries } from './query-counter';
import { StockLedgerService } from '../src/stock/stock-ledger.service';
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
      { activity: 'AVICOLE', revenue: 0, expenses: 0, margin: 0 },
      { activity: 'PORCIN', revenue: 0, expenses: 0, margin: 0 },
      { activity: 'GENERAL', revenue: 0, expenses: 0, margin: 0 },
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
    expect(res.body).toEqual({ total: 0, acknowledgedCount: 0, items: [] });
  });

  it('requires authentication', async () => {
    await http().get('/api/dashboard').expect(401);
  });

  describe('profitability and revenue versus expenses', () => {
    const firstOfMonth = () => new Date().toISOString().slice(0, 8) + '01';
    const lastMonth = () =>
      new Date(new Date(firstOfMonth()).getTime() - DAY_MS)
        .toISOString()
        .slice(0, 10);
    const as = async (role: 'COMPTABLE' | 'AGENT_ELEVAGE', farms = [farmA]) => {
      const user = await createUser({
        organizationId: orgId,
        role,
        farmIds: farms,
      });
      return {
        Authorization: `Bearer ${await tokenFor(user.id)}`,
        'X-Farm-Id': farms[0],
      };
    };
    const post = (h: Record<string, string>, body: object) =>
      http().post('/api/finance/entries').set(h).send(body).expect(201);
    const entry = (over: Record<string, unknown>) => ({
      date: dayStr(0),
      kind: 'DEPENSE',
      label: 'Écriture',
      activity: 'AVICOLE',
      category: 'ALIMENT',
      amount: 1000,
      ...over,
    });
    const dashboard = async (h: Record<string, string>) =>
      (await http().get('/api/dashboard').set(h).expect(200))
        .body as DashboardDto;

    it('shows the month to date to a role that reads finance, from the same summary', async () => {
      const accountant = await as('COMPTABLE');
      await post(accountant, entry({}));
      await post(
        accountant,
        entry({
          kind: 'RECETTE',
          category: 'AUTRE_RECETTE',
          amount: 3000,
          label: 'Vente',
        }),
      );
      await post(
        accountant,
        entry({ activity: 'GENERAL', category: 'ENERGIE', amount: 200 }),
      );
      // last month does not belong to « Rentabilité du mois »
      await post(accountant, entry({ date: lastMonth(), amount: 99999 }));
      const body = await dashboard(accountant);
      expect(body.profitability).toEqual({
        revenue: 3000,
        expenses: 1200,
        margin: 1800,
        marginPct: 60,
        receivables: 0,
      });
      expect(body.revenueVsExpenses).toEqual([
        { activity: 'AVICOLE', revenue: 3000, expenses: 1000, margin: 2000 },
        { activity: 'PORCIN', revenue: 0, expenses: 0, margin: 0 },
        { activity: 'GENERAL', revenue: 0, expenses: 200, margin: -200 },
      ]);
      const summary = (
        await http()
          .get('/api/finance/summary')
          .query({
            from: new Date().toISOString().slice(0, 8) + '01',
            to: dayStr(0),
          })
          .set(accountant)
          .expect(200)
      ).body as { revenue: number; expenses: number; byActivity: unknown };
      expect(summary).toMatchObject({ revenue: 3000, expenses: 1200 });
      expect(summary.byActivity).toEqual(body.revenueVsExpenses);
    });

    it('is null for a role without finance read, and for the others a read-only view', async () => {
      const accountant = await as('COMPTABLE');
      await post(accountant, entry({}));
      const agent = await as('AGENT_ELEVAGE');
      const body = await dashboard(agent);
      expect(body.profitability).toBeNull();
      expect(body.revenueVsExpenses).toBeNull();
      // the rest of the dashboard is untouched
      expect(body.farmName).toBe('Ferme Kpalimé');
      expect(body.activeBuildings).toBe(2);
      const owner = await dashboard(headersFor(farmA));
      expect(owner.profitability?.expenses).toBe(1000);
      // all farms: summed over the visible farms
      expect((await dashboard(headersFor('all'))).profitability?.expenses).toBe(
        1000,
      );
    });

    it('runs the same number of queries whatever the number of entries', async () => {
      const accountant = await as('COMPTABLE');
      await post(accountant, entry({}));
      const count = (h: Record<string, string> = accountant) =>
        countQueries(app, async () => {
          await dashboard(h);
        });
      const one = await count();
      for (let i = 0; i < 5; i++) {
        await post(accountant, entry({ amount: 10 + i, category: 'EAU' }));
        await post(
          accountant,
          entry({ kind: 'RECETTE', category: 'AUTRE_RECETTE', amount: 5 }),
        );
      }
      expect(await count()).toBe(one);
      // without finance read the dashboard makes none of the finance reads (a raw query each)
      const agent = await as('AGENT_ELEVAGE');
      const raw = jest.spyOn(app.get(PrismaService), '$queryRaw');
      try {
        await dashboard(agent);
        expect(raw).not.toHaveBeenCalled();
      } finally {
        raw.mockRestore();
      }
    });
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
    const feed = async (
      batchId: string,
      date: number,
      quantityKg: number,
      farmId = farmA,
    ) => {
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
          farmId,
          batchId,
          feedProductId: productId,
          date: day(date),
          quantityKg,
          unitCost: 300,
          cost: quantityKg * 300,
        },
      });
    };

    const eggs = (
      batchId: string,
      date: number,
      collected: number,
      farmId = farmA,
    ) =>
      prisma.eggProduction.create({
        data: { farmId, batchId, date: day(date), collected },
      });

    const water = (
      batchId: string,
      date: number,
      liters: number,
      farmId = farmA,
    ) =>
      prisma.waterConsumption.create({
        data: { farmId, batchId, date: day(date), liters },
      });

    async function buildingOfFarmB(): Promise<string> {
      const siteB = await prisma.site.create({
        data: { farmId: farmB, name: 'Site B' },
      });
      const created = await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: siteB.id,
          name: 'PB',
          type: 'AVICOLE',
          capacity: 5000,
        },
      });
      return created.id;
    }

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

    it('runs the same number of queries whether one farm or several have records, under all', async () => {
      await seedReference();
      const count = (farm: string) =>
        countQueries(app, async () => {
          await dashboard(farm);
        });
      const one = await count('all'); // both farms in view, only farm A has data
      const bldB = await buildingOfFarmB();
      const lotB = await lot(farmB, bldB, 'LB-0001', 500);
      await eggs(lotB, 2, 300, farmB);
      await feed(lotB, 3, 200, farmB);
      await water(lotB, 4, 900, farmB);
      expect((await dashboard('all')).kpis.eggsLastDay).toBe(2480 + 300);
      expect((await dashboard('all')).feedDistributedKg).toBe(1800 + 200);
      expect(await count('all')).toBe(one);
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
      expect(res.body).toEqual({ ...body.alerts, acknowledgedCount: 0 });
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
          modules: ['alimentation', 'lots'],
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
      const other = await lot(farmB, await buildingOfFarmB(), 'LC-B001', 1000);
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

    const titles = (body: DashboardDto) =>
      body.alerts.items.map((i) => i.title).sort();

    it('judges the deaths of a lot on its arrival day against its opening count', async () => {
      const id = await lot(farmA, buildingA, 'LC-0008', 1000, {
        entryDate: day(0),
      });
      for (const quantity of [2, 3, 3]) {
        await prisma.batchEvent.create({
          data: {
            farmId: farmA,
            batchId: id,
            date: day(0),
            type: 'MORTALITE',
            quantity,
            createdById: userId,
          },
        });
      }
      const body = await dashboard(farmA);
      expect(body.alerts.items).toEqual([
        expect.objectContaining({
          title: 'Mortalité élevée LC-0008',
          detail: `8 morts le ${dayStr(0)} (0.8% de l'effectif)`,
          level: 'URGENT',
        }),
      ]);
    });

    it('raises the daily rule for deaths yesterday, summed over several events', async () => {
      const id = await lot(farmA, buildingA, 'LC-0006', 1000);
      for (const quantity of [3, 3]) {
        await prisma.batchEvent.create({
          data: {
            farmId: farmA,
            batchId: id,
            date: day(1),
            type: 'MORTALITE',
            quantity,
            createdById: userId,
          },
        });
      }
      const body = await dashboard(farmA);
      expect(body.alerts.items[0]).toMatchObject({
        detail: `6 morts le ${dayStr(1)} (0.6% de l'effectif)`,
        level: 'URGENT',
      });
    });

    it('does not raise a mortality alert that only reaches the threshold by rounding', async () => {
      const id = await lot(farmA, buildingA, 'LC-0005', 3000);
      await deaths(farmA, id, 89);
      expect((await dashboard(farmA)).alerts.total).toBe(0);
    });

    it('ignores closed lots and raises a pig lot alert under the pig module', async () => {
      const closed = await lot(farmA, buildingA, 'LC-OLD', 100, {
        status: 'CLOTURE',
      });
      await deaths(farmA, closed, 50);
      expect((await dashboard(farmA)).alerts.total).toBe(0);
      const pigs = await lot(farmA, buildingA, 'PE-0009', 100, {
        species: 'PORCIN',
        type: 'ENGRAISSEMENT',
      });
      await deaths(farmA, pigs, 10);
      const body = await dashboard(farmA);
      expect(body.alerts.items).toEqual([
        expect.objectContaining({
          title: 'Mortalité élevée PE-0009',
          detail: '10% sur 100 sujets',
          module: 'porcs',
        }),
      ]);
    });

    it('only warns about records still in gestation', async () => {
      await seedReference();
      await prisma.breedingRecord.updateMany({ data: { status: 'MISE_BAS' } });
      expect(titles(await dashboard(farmA))).toEqual([
        'Mortalité élevée LC-0001',
        'Mortalité élevée LC-0003',
      ]);
    });

    it('raises a water consumption alert', async () => {
      const id = await lot(farmA, buildingA, 'LC-0009', 1000);
      for (const d of [2, 3, 4, 5]) await water(id, d, 100);
      await water(id, 1, 140);
      const body = await dashboard(farmA);
      expect(body.alerts.items).toEqual([
        {
          key: `consumption:${id}:${dayStr(1)}:water`,
          title: 'Consommation anormale LC-0009',
          detail: 'Eau : 140 L (moyenne 100 L)',
          level: 'A_VOIR',
          module: 'alimentation',
          modules: ['alimentation', 'lots'],
        },
      ]);
    });

    it('judges with exactly 3 prior days and a 7-day window', async () => {
      const three = await lot(farmA, buildingA, 'LC-0010', 1000);
      for (const d of [2, 3, 4]) await feed(three, d, 100);
      await feed(three, 1, 140);
      // 7 days before the latest day (day 8) counts, 8 days before (day 9) does not
      const inside = await lot(farmA, buildingA, 'LC-0011', 1000);
      for (const d of [2, 3, 4]) await feed(inside, d, 100);
      await feed(inside, 8, 220);
      await feed(inside, 1, 140);
      const outside = await lot(farmA, buildingA, 'LC-0012', 1000);
      for (const d of [2, 3, 4]) await feed(outside, d, 100);
      await feed(outside, 9, 220);
      await feed(outside, 1, 140);
      const body = await dashboard(farmA);
      expect(titles(body)).toEqual([
        'Consommation anormale LC-0010',
        'Consommation anormale LC-0012',
      ]);
    });

    it("never shows farm A its neighbour's farrowing or consumption alerts", async () => {
      await seedReference();
      const id = await lot(farmA, buildingA, 'LC-0013', 1000);
      for (const d of [2, 3, 4, 5]) await feed(id, d, 100);
      await feed(id, 1, 140);
      const a = await dashboard(farmA);
      expect(titles(a)).toContain('Mise bas TR-001');
      expect(titles(a)).toContain('Consommation anormale LC-0013');
      const b = await dashboard(farmB);
      expect(b.alerts).toEqual({ total: 0, items: [] });
      expect((await dashboard('all')).alerts.total).toBe(a.alerts.total);
    });

    it('judges each farm on its own latest recorded day under all', async () => {
      const buildingB = await buildingOfFarmB();
      const lotA = await lot(farmA, buildingA, 'LC-A001', 1000);
      const lotB = await lot(farmB, buildingB, 'LC-B001', 2000);
      // farm A recorded today, farm B only yesterday
      await eggs(lotA, 0, 500);
      await eggs(lotB, 1, 800, farmB);
      for (const d of [1, 2, 3, 4]) await feed(lotA, d, 100);
      await feed(lotA, 0, 140);
      for (const d of [2, 3, 4, 5]) await feed(lotB, d, 100, farmB);
      await feed(lotB, 1, 140, farmB);
      await water(lotA, 0, 300);
      await water(lotB, 1, 700, farmB);
      const [a, b, all] = [
        await dashboard(farmA),
        await dashboard(farmB),
        await dashboard('all'),
      ];
      expect(a.kpis.eggsLastDay).toBe(500);
      expect(b.kpis.eggsLastDay).toBe(800);
      expect(a.kpis.layingRate).toBe(50);
      expect(b.kpis.layingRate).toBe(40);
      expect(all.kpis.eggsLastDay).toBe(1300);
      expect(all.kpis.layingRate).toBe(43.3);
      expect([a.feedDistributedKg, b.feedDistributedKg]).toEqual([140, 140]);
      expect(all.feedDistributedKg).toBe(280);
      expect([a.waterConsumedL, b.waterConsumedL]).toEqual([300, 700]);
      expect(all.waterConsumedL).toBe(1000);
      expect(all.eggSeries).toEqual([
        { date: dayStr(1), eggs: 800 },
        { date: dayStr(0), eggs: 500 },
      ]);
      expect(titles(a)).toEqual(['Consommation anormale LC-A001']);
      expect(titles(b)).toEqual(['Consommation anormale LC-B001']);
      expect(all.alerts.items.map((i) => i.key).sort()).toEqual(
        [...a.alerts.items, ...b.alerts.items].map((i) => i.key).sort(),
      );
    });
  });
  describe('stock, expiry, vaccination and health alerts', () => {
    // Today is frozen for the rules and for the seeds, so a run across UTC midnight cannot shift a boundary.
    let base = 0;
    const day = (n: number) => new Date(base - n * DAY_MS);
    const dayStr = (n: number) => day(n).toISOString().slice(0, 10);
    const ahead = (n: number) => day(-n);
    const aheadStr = (n: number) => dayStr(-n);
    let siteId: string;
    let porcherie: string;
    const clocks: { stock?: () => Date; health?: () => Date } = {};

    beforeAll(() => {
      clocks.stock = app.get(StockAlertsService).now;
      clocks.health = app.get(HealthAlertsService).now;
    });

    // The services outlive this block: give them their own clock back.
    afterAll(() => {
      if (clocks.stock) app.get(StockAlertsService).now = clocks.stock;
      if (clocks.health) app.get(HealthAlertsService).now = clocks.health;
    });

    beforeEach(async () => {
      const t = new Date();
      base = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      const frozen = () => new Date(base + 12 * 3_600_000);
      app.get(StockAlertsService).now = frozen;
      app.get(HealthAlertsService).now = frozen;
      siteId = (
        await prisma.site.findFirstOrThrow({ where: { farmId: farmA } })
      ).id;
      porcherie = (
        await prisma.building.create({
          data: {
            farmId: farmA,
            siteId,
            name: 'Porcherie 2',
            type: 'PORCIN',
            capacity: 50,
          },
        })
      ).id;
    });

    async function item(name: string, unit = 'kg', category = 'ALIMENT') {
      return (
        await prisma.stockItem.create({
          data: {
            organizationId: orgId,
            name,
            unit,
            category: category as 'ALIMENT',
          },
        })
      ).id;
    }

    /** One entry movement of `quantity`, on a lot (of `expiry` days from today) when given. */
    async function stockIn(
      farmId: string,
      stockItemId: string,
      quantity: number,
      lot?: { number: string; expiry: number },
    ) {
      // Through the ledger, like the application: it keeps the quantity cache.
      const ledger = app.get(StockLedgerService);
      const batch = await prisma.$transaction(async (tx) => {
        const created = lot
          ? await ledger.createBatch(tx, {
              farmId,
              stockItemId,
              lotNumber: lot.number,
              expiryDate: ahead(lot.expiry),
              receivedDate: day(60),
            })
          : null;
        await ledger.record(tx, {
          farmId,
          stockItemId,
          stockBatchId: created?.id ?? null,
          date: day(40),
          type: 'ENTREE',
          quantity,
          unitCost: 100,
          reason: 'ACHAT',
          userId,
        });
        return created;
      });
      return batch?.id;
    }

    /** The pair's row exists once the ledger has seen it: set the minimum on it, or create it. */
    const threshold = (farmId: string, stockItemId: string, minQty: number) =>
      prisma.farmStockItem.upsert({
        where: { farmId_stockItemId: { farmId, stockItemId } },
        update: { minQty },
        create: { farmId, stockItemId, minQty, averageCost: 0 },
      });

    async function poultryLot(
      code: string,
      over: Record<string, unknown> = {},
    ) {
      return (
        await prisma.animalBatch.create({
          data: {
            farmId: farmA,
            buildingId: buildingA,
            code,
            species: 'AVICOLE',
            type: 'PONDEUSE',
            entryDate: day(60),
            initialCount: 100,
            ...over,
          },
        })
      ).id;
    }

    function act(over: Record<string, unknown>) {
      return prisma.healthAct.create({
        data: {
          farmId: farmA,
          date: day(1),
          type: 'VACCINATION',
          productName: 'Gumboro',
          createdById: userId,
          ...over,
        } as never,
      });
    }

    const alerts = async (farm: string, headers = headersFor(farm)) =>
      (await http().get('/api/alerts').set(headers).expect(200))
        .body as AlertsBody;
    const rows = (a: AlertsBody) =>
      a.items.map((i) => [i.title, i.detail, i.level]);
    const as = async (
      role:
        | 'MAGASINIER'
        | 'AGENT_ELEVAGE'
        | 'RESP_AVICOLE'
        | 'COMPTABLE'
        | 'RESP_STOCK',
      farm = farmA,
    ) => {
      const user = await createUser({
        organizationId: orgId,
        role,
        farmIds: [farmA, farmB],
      });
      return {
        Authorization: `Bearer ${await tokenFor(user.id)}`,
        'X-Farm-Id': farm,
      };
    };

    async function seedReference() {
      const ponte = await item('Aliment ponte');
      const porc = await item('Aliment engraissement porc');
      await stockIn(farmA, ponte, 900);
      await stockIn(farmA, porc, 600);
      await threshold(farmA, ponte, 1500);
      await threshold(farmA, porc, 1500);
      const lot = await poultryLot('LC-2026-15');
      await act({ batchId: lot, date: day(2) });
      await act({
        buildingId: porcherie,
        type: 'DESINFECTION',
        productName: 'Virkon S',
        date: day(3),
      });
    }

    it('raises the reference alerts with their exact texts, URGENT before A_VOIR, by rule', async () => {
      await seedReference();
      expect(rows(await alerts(farmA))).toEqual([
        [
          'Stock critique : Aliment engraissement porc',
          '600 kg (seuil 1500)',
          'URGENT',
        ],
        ['Vaccination en retard', 'LC-2026-15 — Gumboro', 'URGENT'],
        ['Stock faible : Aliment ponte', '900 kg (seuil 1500)', 'A_VOIR'],
        ['Désinfection en retard', 'Porcherie 2 — Virkon S', 'A_VOIR'],
      ]);
    });

    it('draws the stock level boundaries from the level function', async () => {
      const at = async (quantity: number) => {
        const id = await item(`Article ${quantity}`);
        await stockIn(farmA, id, quantity);
        await threshold(farmA, id, 1500);
      };
      await at(1500);
      await at(1499);
      await at(750);
      await at(749);
      const noMin = await item('Sans seuil');
      await stockIn(farmA, noMin, 1);
      await threshold(farmA, noMin, 0);
      await item('Jamais stocké').then((id) => threshold(farmA, id, 10));
      expect((await alerts(farmA)).items.map((i) => i.title)).toEqual([
        'Stock critique : Article 749',
        'Stock critique : Jamais stocké',
        'Stock faible : Article 1499',
        'Stock faible : Article 750',
      ]);
    });

    it('warns of an expiry at exactly expiryWarningDays and not one day later', async () => {
      const vaccin = await item('Vaccin', 'dose', 'VACCIN');
      await stockIn(farmA, vaccin, 10, { number: 'L-30', expiry: 30 });
      await stockIn(farmA, vaccin, 10, { number: 'L-31', expiry: 31 });
      const soon = await stockIn(farmA, vaccin, 5, {
        number: 'L-0',
        expiry: 0,
      });
      const past = await stockIn(farmA, vaccin, 5, {
        number: 'L-P',
        expiry: -2,
      });
      const emptied = await stockIn(farmA, vaccin, 5, {
        number: 'L-E',
        expiry: -5,
      });
      // An expired lot can only leave as a loss, never as a treatment.
      await prisma.$transaction((tx) =>
        app.get(StockLedgerService).record(tx, {
          farmId: farmA,
          stockItemId: vaccin,
          stockBatchId: emptied,
          date: day(1),
          type: 'SORTIE',
          quantity: -5,
          reason: 'PERTE',
          userId,
        }),
      );
      const body = await alerts(farmA);
      expect(rows(body)).toEqual([
        [
          'Produit périmé : Vaccin',
          `Lot L-P — expiré le ${aheadStr(-2)}`,
          'URGENT',
        ],
        [
          'Produit bientôt périmé : Vaccin',
          `Lot L-0 — expire le ${aheadStr(0)}`,
          'A_VOIR',
        ],
        [
          'Produit bientôt périmé : Vaccin',
          `Lot L-30 — expire le ${aheadStr(30)}`,
          'A_VOIR',
        ],
      ]);
      expect(body.items.map((i) => i.key)).toEqual(
        expect.arrayContaining([`expiry:${past}`, `expiry:${soon}`]),
      );
    });

    it('follows the expiryWarningDays and vaccinationWarningDays settings', async () => {
      const vaccin = await item('Vaccin', 'dose', 'VACCIN');
      await stockIn(farmA, vaccin, 10, { number: 'L-30', expiry: 30 });
      const lot = await poultryLot('LC-1');
      await act({ batchId: lot, date: ahead(4) });
      expect((await alerts(farmA)).total).toBe(1);
      await prisma.setting.createMany({
        data: [
          { organizationId: orgId, key: 'expiryWarningDays', value: 29 },
          { organizationId: orgId, key: 'vaccinationWarningDays', value: 4 },
        ],
      });
      expect((await alerts(farmA)).items.map((i) => i.title)).toEqual([
        'Vaccination à venir',
      ]);
    });

    it('raises Vaccination à venir from today up to and including 3 days, planned acts only', async () => {
      const lot = await poultryLot('LC-1');
      await act({ batchId: lot, date: ahead(0), productName: 'A' });
      await act({ batchId: lot, date: ahead(3), productName: 'B' });
      await act({ batchId: lot, date: ahead(4), productName: 'C' });
      await act({
        batchId: lot,
        date: ahead(1),
        productName: 'D',
        status: 'ANNULE',
      });
      await act({
        batchId: lot,
        date: ahead(1),
        productName: 'E',
        status: 'REALISE',
        doneDate: day(0),
      });
      expect(rows(await alerts(farmA))).toEqual([
        ['Vaccination à venir', `LC-1 — A (${aheadStr(0)})`, 'A_VOIR'],
        ['Vaccination à venir', `LC-1 — B (${aheadStr(3)})`, 'A_VOIR'],
      ]);
    });

    it('agrees with the health list: closed lots and exited animals raise nothing', async () => {
      const open = await poultryLot('LC-OPEN');
      const closed = await poultryLot('LC-CLOS', { status: 'CLOTURE' });
      const sow = await prisma.animal.create({
        data: {
          farmId: farmA,
          tag: 'TR-9',
          category: 'TRUIE',
          sex: 'F',
          buildingId: porcherie,
          status: 'VENDU',
        },
      });
      const late = await act({ batchId: open });
      await act({ batchId: closed });
      await act({ animalId: sow.id });
      await act({ batchId: open, type: 'TRAITEMENT', productName: 'Amox' });
      const list = (
        await http()
          .get('/api/health-acts')
          .query({ status: 'EN_RETARD' })
          .set(headersFor(farmA))
          .expect(200)
      ).body as { items: { id: string; type: string }[] };
      const body = await alerts(farmA);
      expect(body.items.map((i) => i.key).sort()).toEqual(
        list.items
          .map((a) =>
            a.type === 'VACCINATION' ? `vaccination:${a.id}` : `health:${a.id}`,
          )
          .sort(),
      );
      expect(body.items).toHaveLength(2);
      expect(body.items.map((i) => i.key)).toContain(`vaccination:${late.id}`);
      expect(rows(body)).toEqual([
        ['Vaccination en retard', 'LC-OPEN — Gumboro', 'URGENT'],
        ['Traitement en retard', 'LC-OPEN — Amox', 'A_VOIR'],
      ]);
    });

    it('ignores a stored biosecurityWarningDays row (the setting was removed): a disinfection is late exactly when the list says EN_RETARD', async () => {
      await prisma.setting.create({
        data: {
          organizationId: orgId,
          key: 'biosecurityWarningDays',
          value: 2,
        },
      });
      const late = await act({
        buildingId: porcherie,
        type: 'DESINFECTION',
        productName: 'Virkon S',
        date: day(1),
      });
      const list = (
        await http()
          .get('/api/health-acts')
          .query({ status: 'EN_RETARD' })
          .set(headersFor(farmA))
          .expect(200)
      ).body as { items: { id: string }[] };
      expect(list.items.map((a) => a.id)).toEqual([late.id]);
      expect((await alerts(farmA)).items.map((i) => i.key)).toEqual([
        `health:${late.id}`,
      ]);
    });

    it('prints quantities with their decimals', async () => {
      const id = await item('Vermifuge', 'L');
      await stockIn(farmA, id, 749.96);
      await threshold(farmA, id, 1500);
      expect(rows(await alerts(farmA))).toEqual([
        ['Stock critique : Vermifuge', '749.96 L (seuil 1500)', 'URGENT'],
      ]);
    });

    it('names the farm in stock and expiry details only when several farms are in view', async () => {
      const vaccin = await item('Vaccin', 'dose', 'VACCIN');
      await stockIn(farmA, vaccin, 10, { number: 'L-1', expiry: 5 });
      await threshold(farmA, vaccin, 100);
      await stockIn(farmB, vaccin, 10, { number: 'L-2', expiry: 5 });
      await threshold(farmB, vaccin, 100);
      expect((await alerts(farmA)).items.map((i) => i.detail)).toEqual([
        '10 dose (seuil 100)',
        `Lot L-1 — expire le ${aheadStr(5)}`,
      ]);
      expect((await alerts('all')).items.map((i) => i.detail)).toEqual([
        '10 dose (seuil 100) — Ferme Atakpamé',
        '10 dose (seuil 100) — Ferme Kpalimé',
        `Lot L-2 — expire le ${aheadStr(5)} — Ferme Atakpamé`,
        `Lot L-1 — expire le ${aheadStr(5)} — Ferme Kpalimé`,
      ]);
    });

    it('judges each farm on its own threshold: stock on A with a threshold only on B', async () => {
      const id = await item('Maïs');
      await stockIn(farmA, id, 50);
      await threshold(farmB, id, 100);
      expect((await alerts(farmA)).items).toEqual([]);
      const b = await alerts(farmB);
      expect(rows(b)).toEqual([
        ['Stock critique : Maïs', '0 kg (seuil 100)', 'URGENT'],
      ]);
    });

    it('shows each role only the stock and health alerts of the modules it reads', async () => {
      await seedReference();
      const pigLot = await poultryLot('PE-1', {
        species: 'PORCIN',
        type: 'ENGRAISSEMENT',
      });
      await act({ batchId: pigLot, productName: 'Circo' });
      const titles = async (role: Parameters<typeof as>[0]) =>
        rows(await alerts(farmA, await as(role)));
      expect((await alerts(farmA)).total).toBe(5);
      // stocks only
      expect(await titles('MAGASINIER')).toEqual([
        [
          'Stock critique : Aliment engraissement porc',
          '600 kg (seuil 1500)',
          'URGENT',
        ],
        ['Stock faible : Aliment ponte', '900 kg (seuil 1500)', 'A_VOIR'],
      ]);
      // sante + species, no stocks: lot vaccination of both species, building
      const agent = await titles('AGENT_ELEVAGE');
      expect(agent.map((r) => r[0])).toEqual([
        'Vaccination en retard',
        'Vaccination en retard',
        'Désinfection en retard',
      ]);
      // sante + lots, not porcs: no pig lot
      const avicole = await titles('RESP_AVICOLE');
      expect(avicole.map((r) => r[1])).toEqual([
        '600 kg (seuil 1500)',
        'LC-2026-15 — Gumboro',
        '900 kg (seuil 1500)',
        'Porcherie 2 — Virkon S',
      ]);
      expect(await titles('RESP_STOCK')).toHaveLength(2);
      expect(await titles('COMPTABLE')).toEqual([]);
    });

    it('keeps farms apart and sums them under all', async () => {
      await seedReference();
      const other = await item('Aliment B');
      await stockIn(farmB, other, 10);
      await threshold(farmB, other, 100);
      const a = await alerts(farmA);
      const b = await alerts(farmB);
      const all = await alerts('all');
      expect(b.items.map((i) => i.title)).toEqual([
        'Stock critique : Aliment B',
      ]);
      expect(a.items.map((i) => i.title)).not.toContain(
        'Stock critique : Aliment B',
      );
      expect(all.items.map((i) => i.key).sort()).toEqual(
        [...a.items, ...b.items].map((i) => i.key).sort(),
      );
    });

    it('runs a fixed number of queries whatever the number of articles, lots and acts', async () => {
      const queries = () => {
        // The app's own client, not the test's.
        const served = app.get(PrismaService);
        const counts = { n: 0 };
        const spies = [
          ...(['findMany', 'groupBy', 'count', 'findFirst'] as const).flatMap(
            (method) =>
              [
                served.stockMovement,
                served.stockBatch,
                served.stockItem,
                served.farmStockItem,
                served.healthAct,
                served.farm,
              ].map((delegate) => {
                const original = delegate[method].bind(delegate) as (
                  ...a: unknown[]
                ) => unknown;
                return jest
                  .spyOn(delegate, method as never)
                  .mockImplementation(((...a: unknown[]) => {
                    counts.n += 1;
                    return original(...a);
                  }) as never);
              }),
          ),
        ];
        return { counts, restore: () => spies.forEach((s) => s.mockRestore()) };
      };
      const measure = async (farm = farmA) => {
        const { counts, restore } = queries();
        try {
          await alerts(farm);
        } finally {
          restore();
        }
        return counts.n;
      };
      const populate = async (n: number, tag: string) => {
        const lot = await poultryLot(`LC-${tag}`);
        for (let i = 0; i < n; i++) {
          const id = await item(`Article ${tag}${i}`);
          await stockIn(farmA, id, 10, { number: `L${i}`, expiry: i });
          await threshold(farmA, id, 100);
          await act({ batchId: lot, date: day(i + 1) });
          await act({ batchId: lot, type: 'TRAITEMENT', date: day(i + 1) });
        }
      };
      await populate(1, 'a');
      const small = await measure();
      await populate(6, 'b');
      expect((await alerts(farmA)).total).toBeGreaterThan(20);
      const large = await measure();
      // thresholds with their cached quantities, lots, their sums, article and farm names, 2 health reads, and the request's own farm scope lookup
      expect(small).toBe(8);
      expect(large).toBe(small);
      // Two farms in view cost the same.
      await stockIn(farmB, await item('Article B'), 5);
      expect(await measure('all')).toBe(small);
    });
  });

  describe('tasks', () => {
    const task = (
      farmId: string,
      title: string,
      due: string,
      over: Record<string, unknown> = {},
    ) =>
      prisma.task.create({
        data: {
          farmId,
          title,
          dueDate: new Date(due),
          createdById: userId,
          ...over,
        },
      });
    const employee = (farmId: string, name: string) =>
      prisma.employee.create({
        data: {
          farmId,
          name,
          jobTitle: 'Agent',
          contractType: 'CDI',
          hireDate: new Date('2025-01-01'),
        },
      });
    const dashboard = async (farm: string, h = headersFor(farm)) =>
      (await http().get('/api/dashboard').set(h).expect(200))
        .body as DashboardDto;

    /** The reference tasks: three open, one completed yesterday. */
    const reference = async () => {
      const [kodjo, koffi, yawa, ama] = await Promise.all(
        ['Kodjo A.', 'Dr Koffi', 'Yawa M.', 'Ama K.'].map((n) =>
          employee(farmA, n),
        ),
      );
      await task(farmA, 'Pesée hebdomadaire LC-2026-14', '2026-10-23', {
        assigneeId: kodjo.id,
        recurrence: 'HEBDOMADAIRE',
      });
      await task(farmA, 'Vaccination Gumboro LC-2026-15', '2026-10-24', {
        assigneeId: koffi.id,
        priority: 'HAUTE',
      });
      await task(farmA, 'Nettoyage Porcherie 2', '2026-10-18', {
        assigneeId: yawa.id,
        priority: 'URGENTE',
        status: 'EN_COURS',
      });
      await task(farmA, 'Collecte des œufs', '2026-10-22', {
        assigneeId: ama.id,
        status: 'TERMINEE',
        completedDate: day(1),
      });
    };

    it('counts the open tasks and those completed in the last 30 days, and lists the next ones', async () => {
      await reference();
      const body = await dashboard(farmA);
      expect(body.tasks).toEqual({ done: 1, pending: 3 });
      expect(body.upcomingTasks).toEqual([
        expect.objectContaining({
          title: 'Nettoyage Porcherie 2',
          assignee: 'Yawa M.',
          dueDate: '2026-10-18',
          priority: 'URGENTE',
        }),
        expect.objectContaining({
          title: 'Pesée hebdomadaire LC-2026-14',
          assignee: 'Kodjo A.',
          dueDate: '2026-10-23',
          priority: 'NORMALE',
        }),
        expect.objectContaining({
          title: 'Vaccination Gumboro LC-2026-15',
          assignee: 'Dr Koffi',
          dueDate: '2026-10-24',
          priority: 'HAUTE',
        }),
      ]);
    });

    it('lists five tasks at most, "—" for one without an assignee, and counts a completion older than 30 days out', async () => {
      for (let i = 0; i < 7; i++) {
        await task(farmA, `Tâche ${i}`, `2026-10-0${i + 1}`);
      }
      await task(farmA, 'Ancienne', '2026-01-01', {
        status: 'TERMINEE',
        completedDate: day(30),
      });
      const body = await dashboard(farmA);
      expect(body.upcomingTasks).toHaveLength(5);
      expect(body.upcomingTasks[0]).toMatchObject({
        title: 'Tâche 0',
        assignee: '—',
      });
      expect(body.tasks).toEqual({ done: 0, pending: 7 });
    });

    it('scopes the figures to the selected farm and sums them under all farms', async () => {
      await reference();
      await task(farmB, 'Tâche de B', '2026-10-30');
      expect((await dashboard(farmB)).tasks).toEqual({ done: 0, pending: 1 });
      expect((await dashboard('all')).tasks).toEqual({ done: 1, pending: 4 });
    });

    it('shows no task to a role that cannot read them', async () => {
      await reference();
      const sales = await createUser({
        organizationId: orgId,
        role: 'COMMERCIAL',
        farmIds: [farmA],
      });
      const h = {
        Authorization: `Bearer ${await tokenFor(sales.id)}`,
        'X-Farm-Id': farmA,
      };
      const body = await dashboard(farmA, h);
      expect(body.tasks).toEqual({ done: 0, pending: 0 });
      expect(body.upcomingTasks).toEqual([]);
    });
  });

  it('leaves the alert services on the wall clock once the frozen-clock block is done', () => {
    for (const service of [StockAlertsService, HealthAlertsService]) {
      const drift = Math.abs(app.get(service).now().getTime() - Date.now());
      expect(drift).toBeLessThan(60_000);
    }
  });
});
