import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createOrganization, createTestApp } from './setup';

interface Product extends Id {
  name: string;
  unitCost: number;
  stockItemId: string | null;
}
interface Dist extends Id {
  quantityKg: number;
  unitCost: number;
  cost: number;
}
interface Level {
  quantity: number;
  averageCost: number;
}
interface Mv {
  type: string;
  quantity: number;
  unitCost: number;
  reason: string;
  sourceType: string | null;
}
interface Page<T> {
  items: T[];
}

describe('Feed distributions consume stock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  let lotId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    h = await world.actor('DIRECTEUR_FERME');
    lotId = (await world.lot(h)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();

  const stockItem = (name: string, over: Record<string, unknown> = {}) =>
    world.post<Id>(h, '/stock-items', {
      name,
      category: 'ALIMENT',
      unit: 'kg',
      ...over,
    });

  const entry = (
    itemId: string,
    quantity: number,
    unitCost: number,
    date = daysAgo(40),
  ) =>
    world.post(h, '/stock/movements', {
      itemId,
      type: 'ENTREE',
      date,
      quantity,
      unitCost,
      reason: 'ACHAT',
    });

  const product = (
    name: string,
    unitCost: number,
    over: Record<string, unknown> = {},
    status = 201,
  ) =>
    world.post<Product>(
      h,
      '/feed-products',
      { name, kind: 'ALIMENT_COMPLET', unitCost, ...over },
      status,
    );

  /** A feed product linked to a stock item holding `qty` kg at `cost` (and `qty2` at `cost2`). */
  async function stocked(
    name: string,
    lots: [number, number][],
    catalogue = 999,
  ) {
    const item = await stockItem(name);
    for (const [qty, cost] of lots) await entry(item.id, qty, cost);
    const p = await product(name, catalogue, { stockItemId: item.id });
    return { item, product: p };
  }

  const level = async (itemId: string) =>
    (await http().get(`/api/stock/${itemId}`).set(h).expect(200)).body as Level;
  const movements = async (itemId: string) =>
    (
      (
        await http()
          .get('/api/stock/movements')
          .query({ itemId })
          .set(h)
          .expect(200)
      ).body as Page<Mv>
    ).items;

  const distribute = (over: Record<string, unknown> = {}, status = 201) =>
    world.post<Dist>(
      h,
      '/feed-distributions',
      { batchId: lotId, date: daysAgo(1), quantityKg: 10, ...over },
      status,
    );

  const patch = (id: string, body: Record<string, unknown>, status = 200) =>
    http()
      .patch(`/api/feed-distributions/${id}`)
      .set(h)
      .send(body)
      .expect(status);

  const exits = async (itemId: string) =>
    (await movements(itemId)).filter(
      (m) => m.type === 'SORTIE' && m.sourceType === 'FEED_DISTRIBUTION',
    );

  describe('linking a product to a stock item', () => {
    it('links on create and on patch, exposes stockItemId, and unlinks with null', async () => {
      const item = await stockItem('Maïs');
      const p = await product('Maïs', 300, { stockItemId: item.id });
      expect(p.stockItemId).toBe(item.id);
      const free = await product('Son', 200);
      expect(free.stockItemId).toBeNull();
      const body = (
        await http()
          .patch(`/api/feed-products/${p.id}`)
          .set(h)
          .send({ stockItemId: null })
          .expect(200)
      ).body as Product;
      expect(body.stockItemId).toBeNull();
      const again = (
        await http()
          .patch(`/api/feed-products/${p.id}`)
          .set(h)
          .send({ stockItemId: item.id })
          .expect(200)
      ).body as Product;
      expect(again.stockItemId).toBe(item.id);
    });

    it('refuses an item of another category, another unit, another organisation, or already linked', async () => {
      const med = await stockItem('Vermifuge', { category: 'MEDICAMENT' });
      const msg = (await product(
        'A',
        1,
        { stockItemId: med.id },
        400,
      )) as unknown as Msg;
      expect(msg.message).toBe(
        "L'article de stock doit être de catégorie Aliment",
      );
      const sacs = await stockItem('Sacs', { unit: 'sac' });
      expect(
        (
          (await product(
            'B',
            1,
            { stockItemId: sacs.id },
            400,
          )) as unknown as Msg
        ).message,
      ).toBe("L'article de stock doit être en kg");
      const otherOrg = await createOrganization();
      const foreign = await prisma.stockItem.create({
        data: {
          organizationId: otherOrg.id,
          name: 'Étranger',
          category: 'ALIMENT',
          unit: 'kg',
        },
      });
      await product('C', 1, { stockItemId: foreign.id }, 400);
      await product('D', 1, { stockItemId: 'inconnu' }, 400);
      const ok = await stockItem('Maïs');
      await product('E', 1, { stockItemId: ok.id });
      await product('F', 1, { stockItemId: ok.id }, 409);
    });

    it('refuses to link or unlink a product that already has distributions (409)', async () => {
      const item = await stockItem('Maïs');
      await entry(item.id, 100, 300);
      const p = await product('Maïs', 300);
      await distribute({ feedProductId: p.id });
      const link = await http()
        .patch(`/api/feed-products/${p.id}`)
        .set(h)
        .send({ stockItemId: item.id })
        .expect(409);
      expect((link.body as Msg).message).toMatch(/distributions/);
      const linked = await stocked('Soja', [[100, 400]]);
      await distribute({ feedProductId: linked.product.id });
      await http()
        .patch(`/api/feed-products/${linked.product.id}`)
        .set(h)
        .send({ stockItemId: null })
        .expect(409);
      // Resending the current link is not a change.
      await http()
        .patch(`/api/feed-products/${linked.product.id}`)
        .set(h)
        .send({ stockItemId: linked.item.id, unitCost: 410 })
        .expect(200);
    });

    it('create-stock-item makes an ALIMENT kg article, links it, and refuses a second time (409)', async () => {
      const p = await product('Tourteau', 250);
      const done = (
        await http()
          .post(`/api/feed-products/${p.id}/create-stock-item`)
          .set(h)
          .expect(201)
      ).body as Product;
      expect(done.stockItemId).toEqual(expect.any(String));
      const item = await prisma.stockItem.findUniqueOrThrow({
        where: { id: done.stockItemId ?? '' },
      });
      expect(item).toMatchObject({
        name: 'Tourteau',
        category: 'ALIMENT',
        unit: 'kg',
        organizationId: world.orgId,
      });
      await http()
        .post(`/api/feed-products/${p.id}/create-stock-item`)
        .set(h)
        .expect(409);
      expect(
        await prisma.stockItem.count({ where: { name: 'Tourteau' } }),
      ).toBe(1);
      await http()
        .post('/api/feed-products/inconnu/create-stock-item')
        .set(h)
        .expect(404);
    });

    it('create-stock-item is master data: a role without update on alimentation gets 403', async () => {
      const p = await product('Tourteau', 250);
      const reader = await world.actor('VETERINAIRE');
      await http()
        .post(`/api/feed-products/${p.id}/create-stock-item`)
        .set(reader)
        .expect(403);
    });
  });

  describe('a linked product', () => {
    it('consumes stock at the weighted-average cost: create, edit, delete', async () => {
      const { item, product: p } = await stocked('Maïs', [
        [1000, 300],
        [500, 360],
      ]);
      expect((await level(item.id)).averageCost).toBe(320);

      const d = await distribute({ feedProductId: p.id, quantityKg: 620 });
      expect(d).toMatchObject({ unitCost: 320, cost: 198400 });
      expect(await level(item.id)).toMatchObject({ quantity: 880 });
      const [out] = await exits(item.id);
      expect(out).toMatchObject({
        quantity: -620,
        reason: 'CONSOMMATION',
        unitCost: 320,
      });

      const edited = (await patch(d.id, { quantityKg: 520 })).body as Dist;
      expect(edited).toMatchObject({ unitCost: 320, cost: 166400 });
      expect(await level(item.id)).toMatchObject({ quantity: 980 });
      expect(await exits(item.id)).toHaveLength(1);

      await http().delete(`/api/feed-distributions/${d.id}`).set(h).expect(200);
      expect(await level(item.id)).toMatchObject({
        quantity: 1500,
        averageCost: 320,
      });
      expect(await exits(item.id)).toHaveLength(0);
    });

    it('moving the date or changing the feed re-plans the exit', async () => {
      const a = await stocked('Maïs', [[100, 300]]);
      const b = await stocked('Soja', [[100, 500]]);
      const d = await distribute({
        feedProductId: a.product.id,
        quantityKg: 40,
      });
      const moved = (
        await patch(d.id, { feedProductId: b.product.id, quantityKg: 10 })
      ).body as Dist;
      expect(moved).toMatchObject({ unitCost: 500, cost: 5000 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 100 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 90 });
      await patch(d.id, { date: daysAgo(2) });
      expect((await exits(b.item.id))[0]).toMatchObject({ quantity: -10 });
    });

    it('records the exit on the distribution farm and names the distribution as source', async () => {
      const { item, product: p } = await stocked('Maïs', [[100, 300]]);
      const d = await distribute({ feedProductId: p.id, quantityKg: 5 });
      const rows = await prisma.stockMovement.findMany({
        where: { sourceId: d.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        farmId: world.farmId,
        stockItemId: item.id,
        sourceType: 'FEED_DISTRIBUTION',
      });
    });

    it('refuses a distribution larger than the stock and writes nothing', async () => {
      const { item, product: p } = await stocked('Maïs', [[100, 300]]);
      const res = await http()
        .post('/api/feed-distributions')
        .set(h)
        .send({
          batchId: lotId,
          date: daysAgo(1),
          feedProductId: p.id,
          quantityKg: 101,
        })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        'Stock insuffisant pour Maïs (disponible 100 kg)',
      );
      expect(await prisma.feedDistribution.count()).toBe(0);
      expect(await level(item.id)).toMatchObject({ quantity: 100 });
      // An edit past the stock is refused as well and leaves the row and the stock alone.
      const d = await distribute({ feedProductId: p.id, quantityKg: 60 });
      await patch(d.id, { quantityKg: 150 }, 400);
      expect(await level(item.id)).toMatchObject({ quantity: 40 });
      expect(
        Number(
          (
            await prisma.feedDistribution.findUniqueOrThrow({
              where: { id: d.id },
            })
          ).quantityKg,
        ),
      ).toBe(60);
    });

    it('keeps the cost frozen when a later (or back-dated) purchase changes the average', async () => {
      const { item, product: p } = await stocked('Maïs', [
        [1000, 300],
        [500, 360],
      ]);
      const d = await distribute({ feedProductId: p.id, quantityKg: 620 });
      await entry(item.id, 1000, 500, daysAgo(1));
      const stored = await prisma.feedDistribution.findUniqueOrThrow({
        where: { id: d.id },
      });
      expect(Number(stored.unitCost)).toBe(320);
      expect(Number(stored.cost)).toBe(198400);
      // A back-dated entry re-costs the ledger's exit, not the distribution: known limitation.
      await entry(item.id, 1000, 100, daysAgo(39));
      const [out] = await exits(item.id);
      expect(out.unitCost).not.toBe(320);
      const after = await prisma.feedDistribution.findUniqueOrThrow({
        where: { id: d.id },
      });
      expect(Number(after.cost)).toBe(198400);
      // An edit that changes neither quantity, date nor feed keeps the frozen cost.
      const edited = (await patch(d.id, { note: 'matin' })).body as Dist;
      expect(edited).toMatchObject({ unitCost: 320, cost: 198400 });
    });

    it('batchPerformance.feedCost is the sum of the stock-valued costs', async () => {
      const { product: p } = await stocked('Maïs', [
        [1000, 300],
        [500, 360],
      ]);
      await distribute({ feedProductId: p.id, quantityKg: 620 });
      await distribute({ feedProductId: p.id, quantityKg: 100 });
      const res = await http().get(`/api/batches/${lotId}`).set(h).expect(200);
      const perf = (
        res.body as { performance: { feedCost: number; feedKg: number } }
      ).performance;
      expect(perf).toMatchObject({ feedKg: 720, feedCost: 198400 + 32000 });
    });
  });

  describe('a formula', () => {
    const formula = (items: [string, number][]) =>
      world.post<Id>(h, '/feed-formulas', {
        name: `Formule ${items.length}`,
        species: 'AVICOLE',
        stage: 'Croissance',
        items: items.map(([feedProductId, percentage]) => ({
          feedProductId,
          percentage,
        })),
      });

    it('consumes every ingredient and costs Σ exit cost / quantity', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[1000, 500]]);
      const f = await formula([
        [a.product.id, 60],
        [b.product.id, 40],
      ]);
      const d = await distribute({ formulaId: f.id, quantityKg: 100 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 940 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 960 });
      expect(d).toMatchObject({ unitCost: 380, cost: 38000 });
      expect(
        await prisma.stockMovement.count({ where: { sourceId: d.id } }),
      ).toBe(2);
      const edited = (await patch(d.id, { quantityKg: 50 })).body as Dist;
      expect(edited).toMatchObject({ unitCost: 380, cost: 19000 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 970 });
      await http().delete(`/api/feed-distributions/${d.id}`).set(h).expect(200);
      expect(await level(a.item.id)).toMatchObject({ quantity: 1000 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 1000 });
    });

    it('fails entirely when one ingredient is short: nothing is consumed', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[10, 500]]);
      const f = await formula([
        [a.product.id, 60],
        [b.product.id, 40],
      ]);
      const res = await http()
        .post('/api/feed-distributions')
        .set(h)
        .send({
          batchId: lotId,
          date: daysAgo(1),
          formulaId: f.id,
          quantityKg: 100,
        })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        'Stock insuffisant pour Soja (disponible 10 kg)',
      );
      expect(await level(a.item.id)).toMatchObject({ quantity: 1000 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 10 });
      expect(await prisma.feedDistribution.count()).toBe(0);
      expect(
        await prisma.stockMovement.count({
          where: { sourceType: 'FEED_DISTRIBUTION' },
        }),
      ).toBe(0);
    });

    it('mixes linked ingredients (ledger cost) and unlinked ones (catalogue price × share)', async () => {
      const a = await stocked('Maïs', [
        [1000, 300],
        [500, 360],
      ]);
      const son = await product('Son', 200);
      const f = await formula([
        [a.product.id, 60],
        [son.id, 40],
      ]);
      const d = await distribute({ formulaId: f.id, quantityKg: 100 });
      // 60 kg at 320 + 40 kg at 200
      expect(d).toMatchObject({ unitCost: 272, cost: 27200 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 1440 });
      expect(
        await prisma.stockMovement.count({ where: { sourceId: d.id } }),
      ).toBe(1);
    });
  });

  describe('an unlinked product', () => {
    it('moves no stock and keeps the catalogue price', async () => {
      const p = await product('Son', 200);
      const d = await distribute({ feedProductId: p.id, quantityKg: 50 });
      expect(d).toMatchObject({ unitCost: 200, cost: 10000 });
      await patch(d.id, { quantityKg: 60 });
      await http().delete(`/api/feed-distributions/${d.id}`).set(h).expect(200);
      expect(await prisma.stockMovement.count()).toBe(0);
    });

    it('editing a distribution from a linked to an unlinked feed gives the stock back', async () => {
      const a = await stocked('Maïs', [[100, 300]]);
      const son = await product('Son', 200);
      const d = await distribute({
        feedProductId: a.product.id,
        quantityKg: 40,
      });
      const edited = (await patch(d.id, { feedProductId: son.id }))
        .body as Dist;
      expect(edited).toMatchObject({ unitCost: 200, cost: 8000 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 100 });
    });
  });

  describe('concurrency', () => {
    it('parallel distributions on a short stock: exactly one succeeds', async () => {
      const { item, product: p } = await stocked('Maïs', [[50, 300]]);
      const lots = [
        lotId,
        (await world.lot(h)).id,
        (await world.lot(h)).id,
        (await world.lot(h)).id,
      ];
      const results = await Promise.all(
        lots.map((batchId) =>
          http()
            .post('/api/feed-distributions')
            .set(h)
            .send({
              batchId,
              date: daysAgo(1),
              feedProductId: p.id,
              quantityKg: 40,
            }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400, 400]);
      expect(await level(item.id)).toMatchObject({ quantity: 10 });
      expect(await prisma.feedDistribution.count()).toBe(1);
    });

    const post = (body: Record<string, unknown>) =>
      http()
        .post('/api/feed-distributions')
        .set(h)
        .send({ date: daysAgo(1), ...body });

    it('two parallel edits of the same distribution leave exactly one set of movements', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[1000, 500]]);
      const f = await world.post<Id>(h, '/feed-formulas', {
        name: 'F',
        species: 'AVICOLE',
        stage: 'x',
        items: [
          { feedProductId: a.product.id, percentage: 50 },
          { feedProductId: b.product.id, percentage: 50 },
        ],
      });
      const d = await distribute({
        batchId: undefined,
        buildingId: world.poultryBld,
        formulaId: f.id,
        quantityKg: 100,
      });
      for (let round = 1; round <= 4; round++) {
        const rs = await Promise.all([
          patch(d.id, { quantityKg: 100 + round }),
          patch(d.id, { quantityKg: 200 + round }),
          patch(d.id, { quantityKg: 300 + round }),
        ]);
        expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
        const rows = await prisma.stockMovement.findMany({
          where: { sourceId: d.id },
        });
        expect(rows).toHaveLength(2);
        const stored = Number(
          (
            await prisma.feedDistribution.findUniqueOrThrow({
              where: { id: d.id },
            })
          ).quantityKg,
        );
        expect(rows.map((r) => Math.abs(Number(r.quantity)))).toEqual([
          stored / 2,
          stored / 2,
        ]);
      }
    });

    it('parallel edits and deletes of formula distributions in opposite ingredient order never deadlock', async () => {
      const a = await stocked('Maïs', [[10000, 300]]);
      const b = await stocked('Soja', [[10000, 500]]);
      const f1 = await world.post<Id>(h, '/feed-formulas', {
        name: 'F1',
        species: 'AVICOLE',
        stage: 'x',
        items: [
          { feedProductId: a.product.id, percentage: 50 },
          { feedProductId: b.product.id, percentage: 50 },
        ],
      });
      const f2 = await world.post<Id>(h, '/feed-formulas', {
        name: 'F2',
        species: 'AVICOLE',
        stage: 'x',
        items: [
          { feedProductId: b.product.id, percentage: 70 },
          { feedProductId: a.product.id, percentage: 30 },
        ],
      });
      const lot2 = (await world.lot(h)).id;
      const d1 = await distribute({ formulaId: f1.id, quantityKg: 100 });
      const d2 = await distribute({
        batchId: lot2,
        formulaId: f2.id,
        quantityKg: 100,
      });
      for (let round = 1; round <= 3; round++) {
        const rs = await Promise.all([
          patch(d1.id, { quantityKg: 100 + round }),
          patch(d2.id, { quantityKg: 100 + round }),
          post({ batchId: lotId, formulaId: f1.id, quantityKg: 5 }),
          post({ batchId: lot2, formulaId: f2.id, quantityKg: 5 }),
        ]);
        expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(
          true,
        );
      }
      const total = await prisma.stockMovement.aggregate({
        where: { stockItemId: a.item.id, type: 'SORTIE' },
        _sum: { quantity: true },
      });
      const dists = await prisma.feedDistribution.findMany();
      const expected = dists.reduce(
        (n, d) =>
          n + Number(d.quantityKg) * (d.formulaId === f1.id ? 0.5 : 0.3),
        0,
      );
      expect(Math.abs(Number(total._sum.quantity))).toBeCloseTo(expected, 5);
    });
  });

  it('audits each write once: the distribution row only', async () => {
    const { product: p } = await stocked('Maïs', [[100, 300]]);
    const d = await distribute({ feedProductId: p.id, quantityKg: 10 });
    await patch(d.id, { quantityKg: 20 });
    await http().delete(`/api/feed-distributions/${d.id}`).set(h).expect(200);
    const rows = await prisma.auditLog.findMany({ where: { recordId: d.id } });
    expect(rows.map((r) => r.action).sort()).toEqual([
      'CREATE',
      'DELETE',
      'UPDATE',
    ]);
  });
});
