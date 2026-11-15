import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface Alerts {
  total: number;
  items: { key: string; title: string; level: string; module: string }[];
}

describe('Alert visibility and litter mortality (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const alerts = async (headers: Headers) =>
    (await http().get('/api/alerts').set(headers).expect(200)).body as Alerts;
  const kinds = (a: Alerts) =>
    [...new Set(a.items.map((i) => i.key.split(':')[0]))].sort();

  describe('role permissions (C4)', () => {
    async function seed() {
      const user = await prisma.user.findFirstOrThrow();
      const lot = await prisma.animalBatch.create({
        data: {
          farmId: world.farmId,
          buildingId: world.poultryBld,
          code: 'LC-1',
          species: 'AVICOLE',
          type: 'CHAIR',
          entryDate: new Date(daysAgo(30)),
          initialCount: 1000,
        },
      });
      await prisma.batchEvent.create({
        data: {
          farmId: world.farmId,
          batchId: lot.id,
          date: new Date(daysAgo(0)),
          type: 'MORTALITE',
          quantity: 20,
          createdById: user.id,
        },
      });
      const sow = await world.animal(director);
      await prisma.breedingRecord.create({
        data: {
          farmId: world.farmId,
          sowId: sow.id,
          method: 'IA',
          semenLabel: 'X',
          serviceDate: new Date(daysAgo(120)),
          expectedFarrowingDate: new Date(daysAgo(5)),
        },
      });
      const product = await prisma.feedProduct.create({
        data: {
          organizationId: world.orgId,
          name: 'Aliment',
          kind: 'ALIMENT_COMPLET',
          unitCost: 300,
        },
      });
      for (const [ago, kg] of [
        [4, 100],
        [3, 100],
        [2, 100],
        [1, 400],
      ]) {
        await prisma.feedDistribution.create({
          data: {
            farmId: world.farmId,
            batchId: lot.id,
            date: new Date(daysAgo(ago)),
            feedProductId: product.id,
            quantityKg: kg,
            unitCost: 300,
            cost: kg * 300,
          },
        });
      }
    }

    it('shows each role only the alerts of the modules it can read', async () => {
      await seed();
      expect(kinds(await alerts(director))).toEqual([
        'consumption',
        'farrowing',
        'mortality',
      ]);
      const commercial = await alerts(await world.actor('COMMERCIAL'));
      expect(kinds(commercial)).toEqual(['mortality']);
      expect(commercial.total).toBe(commercial.items.length);
      expect(commercial.total).toBe(1);
      const avicole = await alerts(await world.actor('RESP_AVICOLE'));
      expect(kinds(avicole)).toEqual(['consumption', 'mortality']);
      for (const role of ['COMPTABLE', 'MAGASINIER'] as const) {
        expect(await alerts(await world.actor(role))).toEqual({
          total: 0,
          items: [],
        });
      }
      const dash = await http()
        .get('/api/dashboard')
        .set(await world.actor('COMPTABLE'))
        .expect(200);
      expect((dash.body as { alerts: Alerts }).alerts).toEqual({
        total: 0,
        items: [],
      });
    });
  });

  describe('litter mortality (C8)', () => {
    async function litter() {
      const sow = await world.animal(director);
      const boar = await world.animal(director, { category: 'VERRAT' });
      const record = await world.post<Id>(director, '/breeding', {
        sowId: sow.id,
        method: 'SAILLIE',
        boarId: boar.id,
        serviceDate: daysAgo(120),
      });
      const done = (
        await http()
          .post(`/api/breeding/${record.id}/farrowing`)
          .set(director)
          .send({
            date: daysAgo(30),
            bornTotal: 12,
            bornAlive: 12,
            stillborn: 0,
            buildingId: world.pigBld,
          })
          .expect(200)
      ).body as { litterBatchId: string };
      return { record, litterId: done.litterBatchId };
    }
    const die = (batchId: string, quantity: number, ago = 0) =>
      world.post(director, `/batches/${batchId}/events`, {
        type: 'MORTALITE',
        date: daysAgo(ago),
        quantity,
      });

    it('raises nothing for a litter that lost 2 of 12, but does for a purchased lot', async () => {
      const { litterId } = await litter();
      await die(litterId, 2);
      const bought = await world.pigLot(director, { initialCount: 12 });
      await die(bought.id, 2);
      const result = await alerts(director);
      expect(result.items.map((i) => i.key)).toEqual([
        `mortality:${bought.id}`,
      ]);
      expect(result.items[0].level).toBe('URGENT');
    });

    it('ignores the weaning write-off and follows the litter again from the weaning', async () => {
      const { record, litterId } = await litter();
      await http()
        .post(`/api/breeding/${record.id}/weaning`)
        .set(director)
        .send({ date: daysAgo(1), weanedCount: 10 })
        .expect(200);
      // 2 piglets written off as deaths yesterday: not an alert.
      expect((await alerts(director)).items).toEqual([]);
      // A death of the weaned group counts against the weaned headcount.
      await die(litterId, 1);
      const result = await alerts(director);
      expect(result.items.map((i) => [i.key, i.level])).toEqual([
        [`mortality:${litterId}`, 'URGENT'],
      ]);
    });
  });
});
