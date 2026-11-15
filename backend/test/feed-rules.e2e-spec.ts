import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createTestApp } from './setup';

interface Dist extends Id {
  date: string;
  quantityKg: number;
  waterLiters: number | null;
  waterEditable: boolean;
  unitCost: number;
  cost: number;
}
interface Page<T> {
  items: T[];
  total: number;
}

describe('Water rows and incubation list (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  let productId: string;
  let lotId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    h = await world.actor('DIRECTEUR_FERME');
    productId = (
      await world.post<Id>(h, '/feed-products', {
        name: 'Aliment',
        kind: 'ALIMENT_COMPLET',
        unitCost: 300,
      })
    ).id;
    lotId = (await world.lot(h)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const distribute = (over: Record<string, unknown> = {}, status = 201) =>
    world.post<Dist>(
      h,
      '/feed-distributions',
      {
        batchId: lotId,
        date: daysAgo(1),
        feedProductId: productId,
        quantityKg: 10,
        ...over,
      },
      status,
    );
  const list = async () =>
    (
      (
        await http()
          .get(`/api/feed-distributions?batchId=${lotId}`)
          .set(h)
          .expect(200)
      ).body as Page<Dist>
    ).items;

  describe('water of the day (D14)', () => {
    it('flags the row that carries (or would carry) the water of its target and date', async () => {
      const first = await distribute({ waterLiters: 800 });
      const second = await distribute({ quantityKg: 20 });
      const other = await distribute({ date: daysAgo(2) });
      const rows = await list();
      const by = (id: string) => rows.find((r) => r.id === id)!;
      expect(by(first.id)).toMatchObject({
        waterLiters: 800,
        waterEditable: true,
      });
      expect(by(second.id)).toMatchObject({
        waterLiters: null,
        waterEditable: false,
      });
      // No water record that day: the first distribution of the day may get one.
      expect(by(other.id)).toMatchObject({
        waterLiters: null,
        waterEditable: true,
      });
    });

    it('creates the water record from a PATCH on a lone distribution', async () => {
      const d = await distribute();
      const res = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(h)
        .send({ waterLiters: 500 })
        .expect(200);
      expect(res.body).toMatchObject({ waterLiters: 500, waterEditable: true });
      const water = await prisma.waterConsumption.findMany();
      expect(water.map((w) => Number(w.liters))).toEqual([500]);
      const audit = await prisma.auditLog.findMany({
        where: { recordId: water[0].id },
      });
      expect(audit.map((a) => a.action)).toEqual(['CREATE']);
      await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(h)
        .send({ waterLiters: 650 })
        .expect(200);
      expect(
        (await prisma.waterConsumption.findMany()).map((w) => Number(w.liters)),
      ).toEqual([650]);
    });

    it('refuses water on a distribution that is not the first of its day', async () => {
      await distribute();
      const second = await distribute({ quantityKg: 20 });
      const res = await http()
        .patch(`/api/feed-distributions/${second.id}`)
        .set(h)
        .send({ waterLiters: 500 })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        "La consommation d'eau du jour est portée par la première distribution",
      );
      expect(await prisma.waterConsumption.count()).toBe(0);
    });

    it('deletes the water record when the water row is sent null', async () => {
      const d = await distribute({ waterLiters: 800 });
      const res = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(h)
        .send({ waterLiters: null })
        .expect(200);
      expect(res.body).toMatchObject({
        waterLiters: null,
        waterEditable: true,
      });
      expect(await prisma.waterConsumption.count()).toBe(0);
      const audit = await prisma.auditLog.findMany({
        where: { label: { startsWith: 'Eau' } },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['CREATE', 'DELETE']);
      // Nothing to delete: still a success.
      await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(h)
        .send({ waterLiters: null })
        .expect(200);
    });
  });

  describe('incubation list (D13)', () => {
    it('returns the status counts like the other lists', async () => {
      const make = (over: Record<string, unknown> = {}) =>
        world.post<Id>(h, '/incubations', {
          startDate: daysAgo(25),
          eggsSet: 100,
          ...over,
        });
      await make();
      const failed = await make();
      const hatched = await make();
      await http()
        .post(`/api/incubations/${failed.id}/fail`)
        .set(h)
        .send({})
        .expect(200);
      await http()
        .post(`/api/incubations/${hatched.id}/hatch`)
        .set(h)
        .send({
          date: daysAgo(4),
          chicksHatched: 50,
          buildingId: world.poultryBld,
        })
        .expect(200);
      const res = await http()
        .get('/api/incubations?status=ECHEC')
        .set(h)
        .expect(200);
      expect((res.body as { statusCounts: unknown }).statusCounts).toEqual({
        EN_COURS: 1,
        ECLOSE: 1,
        ECHEC: 1,
      });
      expect((res.body as { total: number }).total).toBe(1);
    });
  });
});
