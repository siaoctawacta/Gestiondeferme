import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Role } from '../src/generated/prisma/enums';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

interface Product {
  id: string;
  name: string;
  kind: string;
  unit: string;
  unitCost: number;
  active: boolean;
}
interface Formula {
  id: string;
  name: string;
  species: string;
  stage: string;
  active: boolean;
  costPerKg: number;
  items: { feedProductId: string; name: string; percentage: number }[];
}
interface Dist {
  id: string;
  date: string;
  target: string;
  targetKind: 'LOT' | 'BATIMENT';
  batchId: string | null;
  buildingId: string | null;
  feedName: string;
  feedProductId: string | null;
  formulaId: string | null;
  quantityKg: number;
  waterLiters: number | null;
  unitCost: number;
  cost: number;
}
interface Water {
  id: string;
  date: string;
  target: string;
  targetKind: string;
  liters: number;
}
interface Page<T> {
  items: T[];
  total: number;
}
interface Msg {
  message: string | string[];
}

const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);

describe('Feed and water (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let bldA: string;
  let bldB: string;

  const http = () => request(app.getHttpServer() as App);

  async function actor(role: Role, farmIds: string[] = [farmA], farm = farmA) {
    const user = await createUser({ organizationId: orgId, role, farmIds });
    const token = await tokenFor(user.id);
    return {
      user,
      headers: { Authorization: `Bearer ${token}`, 'X-Farm-Id': farm },
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await createOrganization()).id;
    farmA = (await createFarm(orgId, 'Ferme A')).id;
    farmB = (await createFarm(orgId, 'Ferme B')).id;
    const siteA = await prisma.site.create({
      data: { farmId: farmA, name: 'Site A' },
    });
    const siteB = await prisma.site.create({
      data: { farmId: farmB, name: 'Site B' },
    });
    bldA = (
      await prisma.building.create({
        data: {
          farmId: farmA,
          siteId: siteA.id,
          name: 'Poulailler 1',
          type: 'AVICOLE',
          capacity: 10000,
        },
      })
    ).id;
    bldB = (
      await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: siteB.id,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 10000,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  type Headers = Record<string, string>;

  async function lot(
    headers: Headers,
    over: Record<string, unknown> = {},
    building = bldA,
  ): Promise<{ id: string; code: string }> {
    const res = await http()
      .post('/api/batches')
      .set(headers)
      .send({
        species: 'AVICOLE',
        type: 'CHAIR',
        buildingId: building,
        entryDate: daysAgo(30),
        initialCount: 4820,
        ...over,
      })
      .expect(201);
    return res.body as { id: string; code: string };
  }

  async function product(
    headers: Headers,
    over: Record<string, unknown> = {},
  ): Promise<Product> {
    const res = await http()
      .post('/api/feed-products')
      .set(headers)
      .send({
        name: 'Croissance chair',
        kind: 'ALIMENT_COMPLET',
        unitCost: 340,
        ...over,
      })
      .expect(201);
    return res.body as Product;
  }

  const dist = (over: Record<string, unknown>) => ({
    date: daysAgo(1),
    quantityKg: 620,
    ...over,
  });

  /** A lot is closed once its animals have left: sells the whole lot the day before. */
  async function sell(
    headers: Record<string, string>,
    id: string,
    quantity: number,
  ) {
    await http()
      .post(`/api/batches/${id}/events`)
      .set(headers)
      .send({ type: 'VENTE', date: daysAgo(1), quantity })
      .expect(201);
  }

  async function distribute(
    headers: Headers,
    body: Record<string, unknown>,
    status = 201,
  ) {
    return http()
      .post('/api/feed-distributions')
      .set(headers)
      .send(dist(body))
      .expect(status);
  }

  describe('products', () => {
    it('creates, lists, filters on active, updates and deletes a product', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      expect(p).toMatchObject({
        name: 'Croissance chair',
        kind: 'ALIMENT_COMPLET',
        unit: 'kg',
        unitCost: 340,
        active: true,
      });
      const off = await product(headers, { name: 'Ancien', unitCost: 100 });
      await http()
        .patch(`/api/feed-products/${off.id}`)
        .set(headers)
        .send({ active: false })
        .expect(200);
      const all = await http().get('/api/feed-products').set(headers);
      expect((all.body as Page<Product>).total).toBe(2);
      const active = await http()
        .get('/api/feed-products?active=true')
        .set(headers)
        .expect(200);
      expect((active.body as Page<Product>).items.map((i) => i.name)).toEqual([
        'Croissance chair',
      ]);
      await http()
        .delete(`/api/feed-products/${off.id}`)
        .set(headers)
        .expect(200);
      expect(await prisma.feedProduct.count()).toBe(1);
    });

    it('rejects a duplicate name and bad figures', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await product(headers);
      await http()
        .post('/api/feed-products')
        .set(headers)
        .send({
          name: 'Croissance chair',
          kind: 'ALIMENT_COMPLET',
          unitCost: 1,
        })
        .expect(409);
      await http()
        .post('/api/feed-products')
        .set(headers)
        .send({ name: 'Maïs', kind: 'MATIERE_PREMIERE', unitCost: -5 })
        .expect(400);
      await http()
        .post('/api/feed-products')
        .set(headers)
        .send({ name: 'Maïs', kind: 'AUTRE', unitCost: 5 })
        .expect(400);
    });

    it('is shared by every farm of the organisation but not by another organisation', async () => {
      const a = await actor('DIRECTEUR_FERME');
      const p = await product(a.headers);
      const b = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const list = await http().get('/api/feed-products').set(b.headers);
      expect((list.body as Page<Product>).items.map((i) => i.id)).toEqual([
        p.id,
      ]);
      const otherOrg = (await createOrganization('Autre')).id;
      const foreign = await createUser({
        organizationId: otherOrg,
        role: 'DIRECTEUR_FERME',
      });
      const token = await tokenFor(foreign.id);
      const fh = { Authorization: `Bearer ${token}` };
      const res = await http().get('/api/feed-products').set(fh).expect(200);
      expect((res.body as Page<Product>).total).toBe(0);
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(fh)
        .send({ name: 'x' })
        .expect(404);
    });

    it('refuses to delete a used product with 409', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      await distribute(headers, { batchId: l.id, feedProductId: p.id });
      const res = await http()
        .delete(`/api/feed-products/${p.id}`)
        .set(headers)
        .expect(409);
      expect((res.body as Msg).message).toBe(
        'Cet élément est utilisé ailleurs',
      );
    });
  });

  describe('formulas', () => {
    const formula = (maize: string, soy: string, over = {}) => ({
      name: 'Démarrage maison',
      species: 'AVICOLE',
      stage: 'DEMARRAGE',
      items: [
        { feedProductId: maize, percentage: 60 },
        { feedProductId: soy, percentage: 40 },
      ],
      ...over,
    });

    async function setup(headers: Headers) {
      const maize = await product(headers, {
        name: 'Maïs',
        kind: 'MATIERE_PREMIERE',
        unitCost: 200,
      });
      const soy = await product(headers, {
        name: 'Soja',
        kind: 'MATIERE_PREMIERE',
        unitCost: 450,
      });
      return { maize, soy };
    }

    it('computes costPerKg from the current product costs', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { maize, soy } = await setup(headers);
      const res = await http()
        .post('/api/feed-formulas')
        .set(headers)
        .send(formula(maize.id, soy.id))
        .expect(201);
      const f = res.body as Formula;
      expect(f.costPerKg).toBe(300);
      expect(f.items).toHaveLength(2);
      expect(f.items.find((i) => i.name === 'Maïs')?.percentage).toBe(60);
      await http()
        .patch(`/api/feed-products/${soy.id}`)
        .set(headers)
        .send({ unitCost: 500 })
        .expect(200);
      const list = await http().get('/api/feed-formulas').set(headers);
      expect((list.body as Page<Formula>).items[0].costPerKg).toBe(320);
    });

    it('requires the items to total 100 and to be distinct organisation products', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { maize, soy } = await setup(headers);
      await http()
        .post('/api/feed-formulas')
        .set(headers)
        .send(
          formula(maize.id, soy.id, {
            items: [
              { feedProductId: maize.id, percentage: 60 },
              { feedProductId: soy.id, percentage: 35 },
            ],
          }),
        )
        .expect(400);
      await http()
        .post('/api/feed-formulas')
        .set(headers)
        .send(
          formula(maize.id, soy.id, {
            items: [
              { feedProductId: maize.id, percentage: 50 },
              { feedProductId: maize.id, percentage: 50 },
            ],
          }),
        )
        .expect(400);
      await http()
        .post('/api/feed-formulas')
        .set(headers)
        .send(formula(maize.id, 'nope'))
        .expect(400);
      await http()
        .post('/api/feed-formulas')
        .set(headers)
        .send(formula(maize.id, soy.id, { items: [] }))
        .expect(400);
    });

    it('updates items, refuses a bad total on update, deletes when unused', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { maize, soy } = await setup(headers);
      const f = (
        await http()
          .post('/api/feed-formulas')
          .set(headers)
          .send(formula(maize.id, soy.id))
          .expect(201)
      ).body as Formula;
      const upd = await http()
        .patch(`/api/feed-formulas/${f.id}`)
        .set(headers)
        .send({
          items: [
            { feedProductId: maize.id, percentage: 80 },
            { feedProductId: soy.id, percentage: 20 },
          ],
        })
        .expect(200);
      expect((upd.body as Formula).costPerKg).toBe(250);
      await http()
        .patch(`/api/feed-formulas/${f.id}`)
        .set(headers)
        .send({ items: [{ feedProductId: maize.id, percentage: 99 }] })
        .expect(400);
      await http()
        .delete(`/api/feed-formulas/${f.id}`)
        .set(headers)
        .expect(200);
      expect(await prisma.feedFormulaItem.count()).toBe(0);
    });

    it('a distribution from a formula copies costPerKg and keeps it; a used formula cannot be deleted', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { maize, soy } = await setup(headers);
      const f = (
        await http()
          .post('/api/feed-formulas')
          .set(headers)
          .send(formula(maize.id, soy.id))
          .expect(201)
      ).body as Formula;
      const l = await lot(headers);
      const d = (await distribute(headers, { batchId: l.id, formulaId: f.id }))
        .body as Dist;
      expect(d).toMatchObject({
        feedName: 'Démarrage maison',
        formulaId: f.id,
        feedProductId: null,
        unitCost: 300,
        cost: 186000,
      });
      await http()
        .patch(`/api/feed-products/${soy.id}`)
        .set(headers)
        .send({ unitCost: 900 })
        .expect(200);
      const list = await http()
        .get(`/api/feed-distributions?batchId=${l.id}`)
        .set(headers);
      expect((list.body as Page<Dist>).items[0]).toMatchObject({
        unitCost: 300,
        cost: 186000,
      });
      await http()
        .delete(`/api/feed-formulas/${f.id}`)
        .set(headers)
        .expect(409);
    });
  });

  describe('distributions', () => {
    it('hides cost and unitCost (list, writes, CSV) from a role without finance read, shows them with it', async () => {
      const { headers: director } = await actor('DIRECTEUR_FERME');
      const p = await product(director);
      const l = await lot(director);
      await distribute(director, { batchId: l.id, feedProductId: p.id });
      const { headers: resp } = await actor('RESP_AVICOLE');
      const list = await http()
        .get('/api/feed-distributions')
        .set(resp)
        .expect(200);
      expect((list.body as Page<Dist>).items[0]).toMatchObject({
        quantityKg: 620,
        unitCost: null,
        cost: null,
      });
      const made = (
        await distribute(resp, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      expect(made).toMatchObject({ unitCost: null, cost: null });
      const edited = await http()
        .patch(`/api/feed-distributions/${made.id}`)
        .set(resp)
        .send({ quantityKg: 100 })
        .expect(200);
      expect(edited.body).toMatchObject({ unitCost: null, cost: null });
      const csv = await http()
        .get('/api/feed-distributions?format=csv')
        .set(resp)
        .expect(200);
      const head = csv.text.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
      expect(head).toBe('Date;Lot / Bâtiment;Aliment;Aliment (kg);Eau (L)');
      for (const role of ['AUDITEUR', 'DIRECTEUR_FERME'] as const) {
        const { headers } = await actor(role);
        const seen = await http()
          .get('/api/feed-distributions')
          .set(headers)
          .expect(200);
        expect(
          (seen.body as Page<Dist>).items
            .map((i) => i.cost)
            .sort((a, b) => a - b),
        ).toEqual([34000, 210800]);
        const full = await http()
          .get('/api/feed-distributions?format=csv')
          .set(headers)
          .expect(200);
        expect(full.text).toContain(';Coût');
      }
    });

    it('costs a distribution at the product price and keeps it when the price changes', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      expect(d).toMatchObject({
        date: daysAgo(1),
        target: l.code,
        targetKind: 'LOT',
        batchId: l.id,
        buildingId: null,
        feedName: 'Croissance chair',
        quantityKg: 620,
        waterLiters: null,
        unitCost: 340,
        cost: 210800,
      });
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(headers)
        .send({ unitCost: 400 })
        .expect(200);
      const list = await http()
        .get('/api/feed-distributions')
        .set(headers)
        .expect(200);
      expect((list.body as Page<Dist>).items[0]).toMatchObject({
        unitCost: 340,
        cost: 210800,
      });
    });

    it('feeds a building and shows its name as target', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const d = (
        await distribute(headers, { buildingId: bldA, feedProductId: p.id })
      ).body as Dist;
      expect(d).toMatchObject({
        target: 'Poulailler 1',
        targetKind: 'BATIMENT',
        buildingId: bldA,
        batchId: null,
      });
    });

    it('requires exactly one target and exactly one feed source', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const both = await distribute(
        headers,
        { batchId: l.id, buildingId: bldA, feedProductId: p.id },
        400,
      );
      expect((both.body as Msg).message).toBe('Indiquez un lot ou un bâtiment');
      const none = await distribute(headers, { feedProductId: p.id }, 400);
      expect((none.body as Msg).message).toBe('Indiquez un lot ou un bâtiment');
      const noFeed = await distribute(headers, { batchId: l.id }, 400);
      expect((noFeed.body as Msg).message).toBe(
        'Indiquez un aliment ou une formule',
      );
      const f = await prisma.feedFormula.create({
        data: {
          organizationId: orgId,
          name: 'F',
          species: 'AVICOLE',
          stage: 'X',
        },
      });
      await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, formulaId: f.id },
        400,
      );
    });

    it('refuses foreign lots and buildings, foreign or inactive feed, bad quantities', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const foreign = await lot(other.headers, {}, bldB);
      await distribute(
        headers,
        { batchId: foreign.id, feedProductId: p.id },
        400,
      );
      await distribute(headers, { buildingId: bldB, feedProductId: p.id }, 400);
      const l = await lot(headers);
      await distribute(headers, { batchId: l.id, feedProductId: 'nope' }, 400);
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(headers)
        .send({ active: false })
        .expect(200);
      await distribute(headers, { batchId: l.id, feedProductId: p.id }, 400);
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(headers)
        .send({ active: true })
        .expect(200);
      await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, quantityKg: 0 },
        400,
      );
    });

    it('refuses future dates, dates before entry and closed lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const future = await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, date: daysAhead(2) },
        400,
      );
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, date: daysAgo(40) },
        400,
      );
      const closed = await lot(headers, { initialCount: 100 });
      await sell(headers, closed.id, 100);
      await http()
        .post(`/api/batches/${closed.id}/close`)
        .set(headers)
        .expect(200);
      const res = await distribute(
        headers,
        { batchId: closed.id, feedProductId: p.id },
        409,
      );
      expect((res.body as Msg).message).toBe('Ce lot est clôturé');
    });

    it('accepts pig lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const pigBld = await prisma.building.create({
        data: {
          farmId: farmA,
          siteId: (
            await prisma.site.findFirstOrThrow({ where: { farmId: farmA } })
          ).id,
          name: 'Porcherie',
          type: 'PORCIN',
          capacity: 500,
        },
      });
      const pigs = await lot(
        headers,
        { species: 'PORCIN', type: 'ENGRAISSEMENT', initialCount: 50 },
        pigBld.id,
      );
      await distribute(headers, { batchId: pigs.id, feedProductId: p.id });
    });

    it('recomputes the cost on a quantity change and recopies the cost on a feed change', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(headers)
        .send({ unitCost: 400 })
        .expect(200);
      const qty = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ quantityKg: 100 })
        .expect(200);
      expect(qty.body).toMatchObject({
        quantityKg: 100,
        unitCost: 340,
        cost: 34000,
      });
      const other = await product(headers, { name: 'Finition', unitCost: 250 });
      const swap = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ feedProductId: other.id })
        .expect(200);
      expect(swap.body).toMatchObject({
        feedName: 'Finition',
        unitCost: 250,
        cost: 25000,
      });
      const note = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ note: 'ok' })
        .expect(200);
      expect(note.body).toMatchObject({ unitCost: 250, cost: 25000 });
    });

    it('rounds the cost to 2 decimals', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers, { unitCost: 12.35 });
      const l = await lot(headers);
      const d = (
        await distribute(headers, {
          batchId: l.id,
          feedProductId: p.id,
          quantityKg: 10.25,
        })
      ).body as Dist;
      expect(d.cost).toBe(126.59); // 126.5875
    });

    it('shows the water of the same target and date on the row', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      await distribute(headers, { batchId: l.id, feedProductId: p.id });
      await distribute(headers, {
        batchId: l.id,
        feedProductId: p.id,
        date: daysAgo(2),
      });
      await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: l.id, date: daysAgo(1), liters: 1250 })
        .expect(201);
      const list = await http()
        .get(`/api/feed-distributions?batchId=${l.id}`)
        .set(headers);
      const items = (list.body as Page<Dist>).items;
      expect(items.map((i) => [i.date, i.waterLiters])).toEqual([
        [daysAgo(1), 1250],
        [daysAgo(2), null],
      ]);
    });

    it('creates or updates the water record when waterLiters is given', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, {
          batchId: l.id,
          feedProductId: p.id,
          waterLiters: 900,
        })
      ).body as Dist;
      expect(d.waterLiters).toBe(900);
      expect(await prisma.waterConsumption.count()).toBe(1);
      const upd = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ waterLiters: 1100 })
        .expect(200);
      expect((upd.body as Dist).waterLiters).toBe(1100);
      expect(await prisma.waterConsumption.count()).toBe(1);
      // A later row of the same lot and day may not overwrite the day's water.
      const second = await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, waterLiters: 1300 },
        400,
      );
      expect((second.body as { message: string }).message).toBe(
        "La consommation d'eau du jour est portée par la première distribution",
      );
      expect(await prisma.feedDistribution.count()).toBe(1);
      expect(
        (await prisma.waterConsumption.findMany()).map((w) => Number(w.liters)),
      ).toEqual([1100]);
      const audits = await prisma.auditLog.findMany({
        where: { module: 'alimentation' },
      });
      expect(audits.length).toBe(5); // product + distribution, water create + water update + distribution update
    });

    it('filters, searches, sorts and exports', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      await distribute(headers, { batchId: l.id, feedProductId: p.id });
      await distribute(headers, {
        buildingId: bldA,
        feedProductId: p.id,
        date: daysAgo(3),
        quantityKg: 50,
      });
      const q = async (qs: string) =>
        (
          (
            await http()
              .get(`/api/feed-distributions?${qs}`)
              .set(headers)
              .expect(200)
          ).body as Page<Dist>
        ).items;
      expect((await q('')).map((i) => i.date)).toEqual([
        daysAgo(1),
        daysAgo(3),
      ]);
      expect(await q(`batchId=${l.id}`)).toHaveLength(1);
      expect(await q(`buildingId=${bldA}`)).toHaveLength(1);
      expect(await q(`from=${daysAgo(2)}`)).toHaveLength(1);
      expect(await q(`to=${daysAgo(2)}`)).toHaveLength(1);
      expect(await q(`search=${l.code.toLowerCase()}`)).toHaveLength(1);
      expect(await q('search=poulailler')).toHaveLength(1);
      expect(await q('search=croissance')).toHaveLength(2);
      expect((await q('sort=quantityKg:asc'))[0].quantityKg).toBe(50);
      await http()
        .get('/api/feed-distributions?sort=bogus:asc')
        .set(headers)
        .expect(400);
      // the stored cost is not the ledger cost shown: no sort on it
      for (const sort of ['cost', 'cost:asc', 'cost:desc']) {
        const res = await http()
          .get(`/api/feed-distributions?sort=${sort}`)
          .set(headers)
          .expect(400);
        expect((res.body as { message: string }).message).toBe('Tri invalide');
      }
      const csv = await http()
        .get('/api/feed-distributions?format=csv')
        .set(headers)
        .expect(200);
      expect(csv.text.split('\r\n')[0]).toBe(
        '﻿Date;Lot / Bâtiment;Aliment;Aliment (kg);Eau (L);Coût',
      );
    });

    it('scopes by farm and enforces permissions', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const list = await http()
        .get('/api/feed-distributions')
        .set(other.headers);
      expect((list.body as Page<Dist>).total).toBe(0);
      await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(other.headers)
        .send({ quantityKg: 1 })
        .expect(404);
      await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(other.headers)
        .expect(404);

      const magasinier = await actor('MAGASINIER');
      await http()
        .get('/api/feed-distributions')
        .set(magasinier.headers)
        .expect(403);
      const stock = await actor('RESP_STOCK');
      await http()
        .get('/api/feed-distributions')
        .set(stock.headers)
        .expect(200);
      await http().get('/api/feed-products').set(stock.headers).expect(200);
      await http()
        .post('/api/feed-distributions')
        .set(stock.headers)
        .send(dist({ batchId: l.id, feedProductId: p.id }))
        .expect(403);
      await http()
        .post('/api/feed-products')
        .set(stock.headers)
        .send({ name: 'x', kind: 'MATIERE_PREMIERE', unitCost: 1 })
        .expect(403);
      const agent = await actor('AGENT_ELEVAGE');
      await http()
        .post('/api/water')
        .set(agent.headers)
        .send({ batchId: l.id, date: daysAgo(1), liters: 10 })
        .expect(201);
      // Daily entries are corrected and deleted with `create`: a field agent may.
      await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(agent.headers)
        .expect(200);
    });

    it('refuses writes on a lot closed after the entry, and deletes with an audit row', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers, { initialCount: 100 });
      const d = (
        await distribute(headers, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ quantityKg: 5 })
        .expect(200);
      await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'alimentation', recordId: d.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
      expect(await prisma.feedDistribution.count()).toBe(0);
      const d2 = (
        await distribute(headers, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      await sell(headers, l.id, 100);
      await http().post(`/api/batches/${l.id}/close`).set(headers).expect(200);
      await http()
        .patch(`/api/feed-distributions/${d2.id}`)
        .set(headers)
        .send({ quantityKg: 5 })
        .expect(409);
      await http()
        .delete(`/api/feed-distributions/${d2.id}`)
        .set(headers)
        .expect(409);
    });
  });

  describe('water', () => {
    it('records, lists, updates and deletes water; one record per target and date', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      const w = (
        await http()
          .post('/api/water')
          .set(headers)
          .send({ batchId: l.id, date: daysAgo(1), liters: 1250 })
          .expect(201)
      ).body as Water;
      expect(w).toMatchObject({
        date: daysAgo(1),
        target: l.code,
        targetKind: 'LOT',
        liters: 1250,
      });
      const dup = await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: l.id, date: daysAgo(1), liters: 10 })
        .expect(409);
      expect((dup.body as Msg).message).toBe(
        'Un enregistrement existe déjà pour cette date',
      );
      await http()
        .post('/api/water')
        .set(headers)
        .send({ buildingId: bldA, date: daysAgo(1), liters: 500 })
        .expect(201);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ buildingId: bldA, date: daysAgo(1), liters: 500 })
        .expect(409);
      const list = await http().get('/api/water').set(headers).expect(200);
      expect((list.body as Page<Water>).total).toBe(2);
      const upd = await http()
        .patch(`/api/water/${w.id}`)
        .set(headers)
        .send({ liters: 1300 })
        .expect(200);
      expect((upd.body as Water).liters).toBe(1300);
      await http().delete(`/api/water/${w.id}`).set(headers).expect(200);
      expect(await prisma.waterConsumption.count()).toBe(1);
    });

    it('validates target, date, lot state and liters', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: l.id, buildingId: bldA, date: daysAgo(1), liters: 5 })
        .expect(400);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ date: daysAgo(1), liters: 5 })
        .expect(400);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: l.id, date: daysAhead(1), liters: 5 })
        .expect(400);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: l.id, date: daysAgo(1), liters: 0 })
        .expect(400);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ buildingId: bldB, date: daysAgo(1), liters: 5 })
        .expect(400);
      const closed = await lot(headers, { initialCount: 100 });
      await sell(headers, closed.id, 100);
      await http()
        .post(`/api/batches/${closed.id}/close`)
        .set(headers)
        .expect(200);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: closed.id, date: daysAgo(1), liters: 5 })
        .expect(409);
    });

    it('audits every write and hides other farms', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      const w = (
        await http()
          .post('/api/water')
          .set(headers)
          .send({ batchId: l.id, date: daysAgo(1), liters: 1250 })
          .expect(201)
      ).body as Water;
      await http()
        .patch(`/api/water/${w.id}`)
        .set(headers)
        .send({ liters: 1 })
        .expect(200);
      await http().delete(`/api/water/${w.id}`).set(headers).expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'alimentation', recordId: w.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
      const w2 = (
        await http()
          .post('/api/water')
          .set(headers)
          .send({ batchId: l.id, date: daysAgo(2), liters: 5 })
          .expect(201)
      ).body as Water;
      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      await http()
        .patch(`/api/water/${w2.id}`)
        .set(other.headers)
        .send({ liters: 2 })
        .expect(404);
      await http().delete(`/api/water/${w2.id}`).set(other.headers).expect(404);
    });
  });

  describe('history, integrity and edge cases', () => {
    it('keeps the stored unitCost when a PATCH resends the same feed, even once it is deactivated', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, { batchId: l.id, feedProductId: p.id })
      ).body as Dist;
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(headers)
        .send({ unitCost: 500 })
        .expect(200);
      const same = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ feedProductId: p.id, quantityKg: 100 })
        .expect(200);
      expect(same.body).toMatchObject({ unitCost: 340, cost: 34000 });
      await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(headers)
        .send({ active: false })
        .expect(200);
      const off = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ feedProductId: p.id, quantityKg: 200 })
        .expect(200);
      expect(off.body).toMatchObject({ unitCost: 340, cost: 68000 });
    });

    it('refuses to delete a lot or a building that has feed or water, with a 409', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const feedLot = await lot(headers);
      await distribute(headers, { batchId: feedLot.id, feedProductId: p.id });
      const waterLot = await lot(headers);
      await http()
        .post('/api/water')
        .set(headers)
        .send({ batchId: waterLot.id, date: daysAgo(1), liters: 10 })
        .expect(201);
      for (const id of [feedLot.id, waterLot.id]) {
        const res = await http()
          .delete(`/api/batches/${id}`)
          .set(headers)
          .expect(409);
        expect((res.body as Msg).message).toBe(
          'Ce lot a un historique ; clôturez-le plutôt',
        );
      }
      const site = await prisma.site.findFirstOrThrow({
        where: { farmId: farmA },
      });
      const mk = (name: string) =>
        prisma.building.create({
          data: {
            farmId: farmA,
            siteId: site.id,
            name,
            type: 'AVICOLE',
            capacity: 10,
          },
        });
      const feedBld = await mk('B feed');
      const waterBld = await mk('B water');
      await distribute(headers, {
        buildingId: feedBld.id,
        feedProductId: p.id,
      });
      await http()
        .post('/api/water')
        .set(headers)
        .send({ buildingId: waterBld.id, date: daysAgo(1), liters: 10 })
        .expect(201);
      for (const id of [feedBld.id, waterBld.id]) {
        const res = await http()
          .delete(`/api/buildings/${id}`)
          .set(headers)
          .expect(409);
        expect((res.body as Msg).message).toBe(
          'Ce bâtiment est occupé ou a un historique',
        );
      }
      expect(await prisma.feedDistribution.count()).toBe(2);
      expect(await prisma.waterConsumption.count()).toBe(2);
    });

    it('enforces the invariants in the database', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const base = {
        farmId: farmA,
        date: new Date(daysAgo(1)),
        quantityKg: 1,
        unitCost: 1,
        cost: 1,
      };
      const bad: Record<string, unknown>[] = [
        { ...base, feedProductId: p.id },
        { ...base, batchId: l.id, buildingId: bldA, feedProductId: p.id },
        { ...base, batchId: l.id },
        { ...base, batchId: l.id, feedProductId: p.id, quantityKg: 0 },
        { ...base, batchId: l.id, feedProductId: p.id, unitCost: -1 },
        { ...base, batchId: l.id, feedProductId: p.id, cost: -1 },
      ];
      for (const data of bad) {
        await expect(
          prisma.feedDistribution.create({ data: data as never }),
        ).rejects.toThrow();
      }
      for (const data of [
        { farmId: farmA, date: new Date(daysAgo(1)), liters: 5 },
        {
          farmId: farmA,
          date: new Date(daysAgo(1)),
          liters: 5,
          batchId: l.id,
          buildingId: bldA,
        },
        { farmId: farmA, date: new Date(daysAgo(1)), liters: 0, batchId: l.id },
      ]) {
        await expect(
          prisma.waterConsumption.create({ data }),
        ).rejects.toThrow();
      }
      await expect(
        prisma.feedProduct.create({
          data: {
            organizationId: orgId,
            name: 'neg',
            kind: 'MATIERE_PREMIERE',
            unitCost: -1,
          },
        }),
      ).rejects.toThrow();
      const f = await prisma.feedFormula.create({
        data: {
          organizationId: orgId,
          name: 'F',
          species: 'AVICOLE',
          stage: 'X',
        },
      });
      await expect(
        prisma.feedFormulaItem.create({
          data: { formulaId: f.id, feedProductId: p.id, percentage: 0 },
        }),
      ).rejects.toThrow();
    });

    it('shows the day water on the first distribution of a target and date only', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const first = (
        await distribute(headers, {
          batchId: l.id,
          feedProductId: p.id,
          quantityKg: 10,
          waterLiters: 800,
        })
      ).body as Dist;
      const second = (
        await distribute(headers, {
          batchId: l.id,
          feedProductId: p.id,
          quantityKg: 20,
        })
      ).body as Dist;
      expect(first.waterLiters).toBe(800);
      expect(second.waterLiters).toBeNull();
      const list = await http()
        .get(`/api/feed-distributions?batchId=${l.id}&sort=quantityKg:desc`)
        .set(headers);
      expect(
        (list.body as Page<Dist>).items.map((i) => [
          i.quantityKg,
          i.waterLiters,
        ]),
      ).toEqual([
        [20, null],
        [10, 800],
      ]);
    });

    it('rejects amounts that would overflow the cost column with a 400', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await http()
        .post('/api/feed-products')
        .set(headers)
        .send({
          name: 'Trop cher',
          kind: 'MATIERE_PREMIERE',
          unitCost: 1_000_000,
        })
        .expect(400);
      const p = await product(headers, { name: 'Max', unitCost: 999_999 });
      const l = await lot(headers);
      const res = await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, quantityKg: 2_000_000 },
        400,
      );
      expect((res.body as Msg).message).toContain(
        'La quantité est trop élevée',
      );
      await distribute(
        headers,
        { batchId: l.id, feedProductId: p.id, quantityKg: 1_000_000 },
        201,
      );
    });

    it('moves a distribution to another date with its water, leaving the old water record alone', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, {
          batchId: l.id,
          feedProductId: p.id,
          waterLiters: 700,
        })
      ).body as Dist;
      const moved = await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .send({ date: daysAgo(3), waterLiters: 900 })
        .expect(200);
      expect(moved.body).toMatchObject({ date: daysAgo(3), waterLiters: 900 });
      const water = await http().get('/api/water').set(headers);
      expect(
        (water.body as Page<Water>).items.map((w) => [w.date, w.liters]),
      ).toEqual([
        [daysAgo(1), 700],
        [daysAgo(3), 900],
      ]);
    });

    it('keeps the water record when its distribution is deleted', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const d = (
        await distribute(headers, {
          batchId: l.id,
          feedProductId: p.id,
          waterLiters: 700,
        })
      ).body as Dist;
      await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(headers)
        .expect(200);
      const water = await http().get('/api/water').set(headers).expect(200);
      expect((water.body as Page<Water>).items.map((w) => w.liters)).toEqual([
        700,
      ]);
    });
  });

  describe('indicators', () => {
    it('gives the lot a feed conversion once feed is recorded', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const p = await product(headers);
      const l = await lot(headers);
      const perf = async () =>
        (
          (await http().get(`/api/batches/${l.id}`).set(headers).expect(200))
            .body as { performance: Record<string, number | null> }
        ).performance;
      expect((await perf()).feedConversion).toBeNull();
      for (const [date, weight] of [
        [daysAgo(15), 620],
        [daysAgo(0), 1450],
      ] as const) {
        await http()
          .post(`/api/batches/${l.id}/weighings`)
          .set(headers)
          .send({ date, sampleSize: 50, averageWeightG: weight })
          .expect(201);
      }
      await distribute(headers, {
        batchId: l.id,
        feedProductId: p.id,
        quantityKg: 6000,
      });
      await distribute(headers, {
        batchId: l.id,
        feedProductId: p.id,
        quantityKg: 200,
        date: daysAgo(2),
      });
      // building-level feed is not attributed to the lot
      await distribute(headers, {
        buildingId: bldA,
        feedProductId: p.id,
        quantityKg: 999,
      });
      const result = await perf();
      expect(result.feedKg).toBe(6200);
      expect(result.feedCost).toBe(2108000);
      expect(result.feedConversion).not.toBeNull();
      // 6200 kg / (0.83 kg x 4820 alive)
      expect(result.feedConversion).toBeCloseTo(1.55, 2);
    });
  });
});
