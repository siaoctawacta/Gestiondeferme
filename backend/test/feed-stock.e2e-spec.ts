import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  tokenFor,
} from './setup';

interface Product extends Id {
  name: string;
  unitCost: number;
  stockItemId: string | null;
}
interface Dist extends Id {
  date: string;
  quantityKg: number;
  unitCost: number;
  cost: number;
}
interface Level {
  quantity: number;
  averageCost: number;
}
interface Mv {
  date: string;
  type: string;
  quantity: number;
  unitCost: number;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
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
      for (const [name, id] of [
        ['C', foreign.id],
        ['D', 'inconnu'],
      ]) {
        expect(
          ((await product(name, 1, { stockItemId: id }, 400)) as unknown as Msg)
            .message,
        ).toBe('Article de stock invalide');
      }
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
      expect((await exits(b.item.id))[0]).toMatchObject({
        quantity: -10,
        date: daysAgo(2),
      });
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

    it('shows the ledger cost: a back-dated purchase re-values the list, the detail and batchPerformance.feedCost', async () => {
      // Purchase A at 100 on D1; distributions on D10..D15; purchase B received dated D10 at 200.
      const { item, product: p } = await stocked('Maïs', [[10000, 100]]);
      const son = await product('Son', 50);
      const rows: Dist[] = [];
      for (let i = 0; i < 6; i++) {
        rows.push(
          await distribute({
            feedProductId: p.id,
            quantityKg: 100,
            date: daysAgo(30 - i),
          }),
        );
      }
      const free = await distribute({
        feedProductId: son.id,
        quantityKg: 10,
        date: daysAgo(27),
      });
      expect(rows.map((r) => r.cost)).toEqual(Array(6).fill(10000));
      await entry(item.id, 10000, 200, daysAgo(30));

      const out = await exits(item.id);
      const ledgerCost = new Map(
        out.map((m) => [
          m.sourceId,
          Math.round(-m.quantity * m.unitCost * 100) / 100,
        ]),
      );
      // The exits were re-valued (D10's distribution came before the purchase, the others after).
      expect([...ledgerCost.values()].filter((c) => c !== 10000).length).toBe(
        5,
      );

      const listed = (
        (
          await http()
            .get('/api/feed-distributions')
            .query({ batchId: lotId })
            .set(h)
            .expect(200)
        ).body as Page<Dist>
      ).items;
      for (const r of rows) {
        const row = listed.find((l) => l.id === r.id);
        expect(row?.cost).toBe(ledgerCost.get(r.id));
        expect(row?.unitCost).toBe(
          Math.round(((ledgerCost.get(r.id) ?? 0) / 100) * 100) / 100,
        );
      }
      // The unlinked product keeps its catalogue price.
      expect(listed.find((l) => l.id === free.id)).toMatchObject({
        unitCost: 50,
        cost: 500,
      });
      // The detail (the response of an edit that leaves the feed alone) agrees.
      const edited = (await patch(rows[5].id, { note: 'soir' })).body as Dist;
      expect(edited.cost).toBe(ledgerCost.get(rows[5].id));
      // Export: the same figures.
      const csv = await http()
        .get('/api/feed-distributions')
        .query({ batchId: lotId, format: 'csv' })
        .set(h)
        .expect(200);
      expect(String(csv.text)).toContain(String(ledgerCost.get(rows[5].id)));
      // The lot's feed cost is the sum of the ledger's exits plus the unlinked product.
      const perf = (
        (await http().get(`/api/batches/${lotId}`).set(h).expect(200)).body as {
          performance: { feedCost: number; feedKg: number };
        }
      ).performance;
      const total = [...ledgerCost.values()].reduce((a, c) => a + c, 0) + 500;
      expect(perf.feedKg).toBe(610);
      expect(perf.feedCost).toBeCloseTo(total, 2);
      // The stored columns stay the snapshot written at entry.
      const stored = await prisma.feedDistribution.findUniqueOrThrow({
        where: { id: rows[5].id },
      });
      expect(Number(stored.cost)).toBe(10000);
    });

    it('a formula mixing a linked and an unlinked ingredient shows ledger cost + catalogue part', async () => {
      const { item, product: maize } = await stocked('Maïs', [[10000, 100]]);
      const son = await product('Son', 50);
      const f = await world.post<Id>(h, '/feed-formulas', {
        name: 'Mixte',
        species: 'AVICOLE',
        stage: 'Croissance',
        items: [
          { feedProductId: maize.id, percentage: 60 },
          { feedProductId: son.id, percentage: 40 },
        ],
      });
      const d = await distribute({
        formulaId: f.id,
        quantityKg: 100,
        date: daysAgo(20),
      });
      // 60 kg of maize at 100 + 40 kg of bran at 50.
      expect(d.cost).toBe(6000 + 2000);
      await entry(item.id, 10000, 300, daysAgo(25));
      const [out] = await exits(item.id);
      const ledgerPart = Math.round(-out.quantity * out.unitCost * 100) / 100;
      expect(ledgerPart).not.toBe(6000);
      const row = (
        (
          await http()
            .get('/api/feed-distributions')
            .query({ batchId: lotId })
            .set(h)
            .expect(200)
        ).body as Page<Dist>
      ).items.find((l) => l.id === d.id);
      expect(row?.cost).toBe(ledgerPart + 2000);
      expect(row?.unitCost).toBe((ledgerPart + 2000) / 100);
    });

    it('refuses a distribution whose cost does not fit the column (400, not a 500) and writes nothing', async () => {
      const { item, product: p } = await stocked('Maïs', []);
      await entry(item.id, 1_000_000, 5_000_000, daysAgo(40));
      const body = await distribute(
        { feedProductId: p.id, quantityKg: 1_000_000 },
        400,
      );
      expect((body as unknown as Msg).message).toBe(
        'Le coût de la distribution est trop élevé : réduisez la quantité',
      );
      expect(await prisma.feedDistribution.count()).toBe(0);
      expect(await exits(item.id)).toEqual([]);
      // A smaller one fits, and cannot be edited past the limit.
      const ok = await distribute({ feedProductId: p.id, quantityKg: 100_000 });
      expect(ok.cost).toBe(500_000_000_000);
      await patch(ok.id, { quantityKg: 1_000_000 }, 400);
      expect((await level(item.id)).quantity).toBe(900_000);
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

    it('shares the quantity by largest remainder: 50/50 of 10.01 kg consumes 10.01 kg', async () => {
      const a = await stocked('Maïs', [[100, 300]]);
      const b = await stocked('Soja', [[100, 500]]);
      const f = await formula([
        [a.product.id, 50],
        [b.product.id, 50],
      ]);
      const d = await distribute({ formulaId: f.id, quantityKg: 10.01 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 94.99 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 95 });
      // 5.01 x 300 + 5.00 x 500
      expect(d).toMatchObject({ cost: 4003, unitCost: 399.9 });
    });

    it('0.01 kg of a formula in thirds moves exactly one hundredth', async () => {
      const a = await stocked('Maïs', [[100, 300]]);
      const b = await stocked('Soja', [[100, 500]]);
      const son = await product('Son', 200);
      const f = await formula([
        [a.product.id, 33.33],
        [b.product.id, 33.33],
        [son.id, 33.34],
      ]);
      const d = await distribute({ formulaId: f.id, quantityKg: 0.01 });
      expect(
        await prisma.stockMovement.count({ where: { sourceId: d.id } }),
      ).toBe(0);
      expect(d.cost).toBe(2);
    });

    it('validates the items of a payload that looks unchanged: a duplicated ingredient is a 400', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[1000, 500]]);
      const f = await formula([
        [a.product.id, 60],
        [b.product.id, 40],
      ]);
      // Same size as the stored composition and every pair already in it.
      const res = await http()
        .patch(`/api/feed-formulas/${f.id}`)
        .set(h)
        .send({
          items: [
            { feedProductId: a.product.id, percentage: 60 },
            { feedProductId: a.product.id, percentage: 60 },
          ],
        })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        'Un aliment ne peut figurer qu’une fois',
      );
      await distribute({ formulaId: f.id, quantityKg: 10 });
      await http()
        .patch(`/api/feed-formulas/${f.id}`)
        .set(h)
        .send({
          items: [
            { feedProductId: a.product.id, percentage: 60 },
            { feedProductId: a.product.id, percentage: 60 },
          ],
        })
        .expect(400);
    });

    it('switching an entry from a formula to a product on another article gives the ingredients back and consumes the product', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[1000, 500]]);
      const c = await stocked('Sorgho', [[1000, 200]]);
      const f = await formula([
        [a.product.id, 60],
        [b.product.id, 40],
      ]);
      const d = await distribute({ formulaId: f.id, quantityKg: 100 });
      expect(await level(a.item.id)).toMatchObject({ quantity: 940 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 960 });
      const switched = (await patch(d.id, { feedProductId: c.product.id }))
        .body as Dist;
      expect(await level(a.item.id)).toMatchObject({ quantity: 1000 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 1000 });
      expect(await level(c.item.id)).toMatchObject({ quantity: 900 });
      expect(switched).toMatchObject({ cost: 20000, unitCost: 200 });
      expect(await exits(a.item.id)).toEqual([]);
      expect(await exits(c.item.id)).toHaveLength(1);
      const rows = await prisma.stockMovement.findMany({
        where: { sourceId: d.id },
      });
      expect(rows.map((r) => r.stockItemId)).toEqual([c.item.id]);
    });

    it('refuses to change the items of a formula that has distributions (409), not its name', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[1000, 500]]);
      const f = await formula([
        [a.product.id, 60],
        [b.product.id, 40],
      ]);
      const url = `/api/feed-formulas/${f.id}`;
      const same = [
        { feedProductId: a.product.id, percentage: 60 },
        { feedProductId: b.product.id, percentage: 40 },
      ];
      // No distribution yet: the composition is free.
      await http()
        .patch(url)
        .set(h)
        .send({ items: [{ feedProductId: a.product.id, percentage: 100 }] })
        .expect(200);
      await http().patch(url).set(h).send({ items: same }).expect(200);
      await distribute({ formulaId: f.id, quantityKg: 10 });
      const res = await http()
        .patch(url)
        .set(h)
        .send({ items: [{ feedProductId: a.product.id, percentage: 100 }] })
        .expect(409);
      expect((res.body as Msg).message).toBe(
        'Cette formule a déjà des distributions : créez une nouvelle formule',
      );
      await http()
        .patch(url)
        .set(h)
        .send({ items: [...same].reverse() })
        .expect(200);
      await http()
        .patch(url)
        .set(h)
        .send({
          name: 'Renommée',
          stage: 'Finition',
          active: true,
          items: same,
        })
        .expect(200);
      // The hole: a product consumed through the formula cannot be detached by removing it first.
      await http()
        .patch(`/api/feed-products/${b.product.id}`)
        .set(h)
        .send({ stockItemId: null })
        .expect(409);
    });

    it('switching an entry between a product and a formula re-plans the stock', async () => {
      const a = await stocked('Maïs', [[1000, 300]]);
      const b = await stocked('Soja', [[1000, 500]]);
      const f = await formula([
        [a.product.id, 60],
        [b.product.id, 40],
      ]);
      const d = await distribute({
        feedProductId: a.product.id,
        quantityKg: 100,
      });
      expect(await level(b.item.id)).toMatchObject({ quantity: 1000 });
      await patch(d.id, { formulaId: f.id });
      expect(await level(a.item.id)).toMatchObject({ quantity: 940 });
      expect(await level(b.item.id)).toMatchObject({ quantity: 960 });
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

  describe('permissions', () => {
    it('create-stock-item needs master on alimentation AND stocks', async () => {
      const p = await product('Tourteau', 250);
      const url = `/api/feed-products/${p.id}/create-stock-item`;
      // alimentation master but only read on stocks
      await http()
        .post(url)
        .set(await world.actor('RESP_AVICOLE'))
        .expect(403);
      await http()
        .post(url)
        .set(await world.actor('RESP_PORCIN'))
        .expect(403);
      // stocks rights but only read on alimentation
      await http()
        .post(url)
        .set(await world.actor('RESP_STOCK'))
        .expect(403);
      expect(await prisma.stockItem.count()).toBe(0);
      await http().post(url).set(h).expect(201);
    });

    it('linking an existing article needs master on alimentation only', async () => {
      const item = await stockItem('Maïs');
      const avicole = await world.actor('RESP_AVICOLE');
      const res = await http()
        .post('/api/feed-products')
        .set(avicole)
        .send({
          name: 'Maïs',
          kind: 'ALIMENT_COMPLET',
          unitCost: 300,
          stockItemId: item.id,
        })
        .expect(201);
      expect((res.body as Product).stockItemId).toBe(item.id);
    });

    it('a role with alimentation create but no stocks rights consumes stock implicitly', async () => {
      const { product: p } = await stocked('Maïs', [[100, 300]]);
      const avicole = await world.actor('RESP_AVICOLE');
      const res = await http()
        .post('/api/feed-distributions')
        .set(avicole)
        .send({
          batchId: lotId,
          date: daysAgo(1),
          feedProductId: p.id,
          quantityKg: 500,
        })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        'Stock insuffisant pour Maïs (disponible 100 kg)',
      );
    });
  });

  describe('link rules', () => {
    it('refuses an inactive article; deactivating a linked one keeps consumption going', async () => {
      const off = await stockItem('Vieux', { active: false });
      expect(
        (
          (await product(
            'A',
            1,
            { stockItemId: off.id },
            400,
          )) as unknown as Msg
        ).message,
      ).toBe("L'article de stock est inactif");
      const { item, product: p } = await stocked('Maïs', [[100, 300]]);
      await http()
        .patch(`/api/stock-items/${item.id}`)
        .set(h)
        .send({ active: false })
        .expect(200);
      expect(
        await distribute({ feedProductId: p.id, quantityKg: 10 }),
      ).toMatchObject({
        cost: 3000,
      });
      expect(await level(item.id)).toMatchObject({ quantity: 90 });
    });

    it('an article linked to a feed product cannot change unit or category, even with no movement (409)', async () => {
      const { item } = await stocked('Maïs', []);
      for (const body of [{ unit: 'sac' }, { category: 'CONSOMMABLE' }]) {
        const res = await http()
          .patch(`/api/stock-items/${item.id}`)
          .set(h)
          .send(body)
          .expect(409);
        expect((res.body as Msg).message).toBe(
          "Cet article est lié à un aliment : l'unité et la catégorie ne peuvent pas changer",
        );
      }
      await http()
        .patch(`/api/stock-items/${item.id}`)
        .set(h)
        .send({ name: 'Maïs grain' })
        .expect(200);
    });

    it('a linked article cannot be deleted even with no movement (409)', async () => {
      const item = await stockItem('Maïs');
      await product('Maïs', 300, { stockItemId: item.id });
      await http().delete(`/api/stock-items/${item.id}`).set(h).expect(409);
    });

    it('a product used only through a formula cannot be linked or unlinked once the formula has distributions', async () => {
      const item = await stockItem('Maïs');
      await entry(item.id, 100, 300);
      const a = await product('Maïs', 300);
      const b = await product('Soja', 500);
      const f = await world.post<Id>(h, '/feed-formulas', {
        name: 'F',
        species: 'AVICOLE',
        stage: 'x',
        items: [
          { feedProductId: a.id, percentage: 50 },
          { feedProductId: b.id, percentage: 50 },
        ],
      });
      await distribute({ formulaId: f.id, quantityKg: 10 });
      const res = await http()
        .patch(`/api/feed-products/${a.id}`)
        .set(h)
        .send({ stockItemId: item.id })
        .expect(409);
      expect((res.body as Msg).message).toMatch(/distributions/);
    });

    it('two products linked to the same article in parallel: one wins, the other gets the right 409', async () => {
      for (let round = 0; round < 4; round++) {
        const item = await stockItem(`Article ${round}`);
        const a = await product(`P${round}a`, 1);
        const b = await product(`P${round}b`, 1);
        const rs = await Promise.all(
          [a, b].map((p) =>
            http()
              .patch(`/api/feed-products/${p.id}`)
              .set(h)
              .send({ stockItemId: item.id }),
          ),
        );
        expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
        const loser = rs.find((r) => r.status === 409);
        expect((loser?.body as Msg).message).toBe(
          'Cet article de stock est déjà lié à un autre aliment',
        );
      }
    });

    it('a link change racing the first distribution of the product never deadlocks and stays consistent', async () => {
      for (let round = 0; round < 5; round++) {
        const item = await stockItem(`Article ${round}`);
        await entry(item.id, 100, 300);
        const p = await product(`Produit ${round}`, 200);
        const [link, dist] = await Promise.all([
          http()
            .patch(`/api/feed-products/${p.id}`)
            .set(h)
            .send({ stockItemId: item.id }),
          http()
            .post('/api/feed-distributions')
            .set(h)
            .send({
              batchId: lotId,
              date: daysAgo(1),
              feedProductId: p.id,
              quantityKg: 10,
            }),
        ]);
        expect(dist.status).toBe(201);
        expect([200, 409]).toContain(link.status);
        const moved = await prisma.stockMovement.count({
          where: { stockItemId: item.id, type: 'SORTIE' },
        });
        // Linked first: the distribution consumed stock; distribution first: the link was refused.
        expect(moved).toBe(link.status === 200 ? 1 : 0);
        expect((dist.body as Dist).unitCost).toBe(
          link.status === 200 ? 300 : 200,
        );
      }
    });
  });

  describe('farms', () => {
    it('stock on one farm is not available to a distribution on another; edits and deletes act on the row farm', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const siteB = await prisma.site.create({
        data: { farmId: farmB, name: 'Site B' },
      });
      const bldB = await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: siteB.id,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 1000,
        },
      });
      const user = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onA = { Authorization: auth, 'X-Farm-Id': world.farmId };
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const { item, product: p } = await stocked('Maïs', [[100, 300]]);
      const body = {
        date: daysAgo(1),
        buildingId: bldB.id,
        feedProductId: p.id,
        quantityKg: 30,
      };
      const refused = await http()
        .post('/api/feed-distributions')
        .set(onB)
        .send(body)
        .expect(400);
      expect((refused.body as Msg).message).toBe(
        'Stock insuffisant pour Maïs (disponible 0 kg)',
      );
      await http()
        .post('/api/stock/movements')
        .set(onB)
        .send({
          itemId: item.id,
          type: 'ENTREE',
          date: daysAgo(40),
          quantity: 50,
          unitCost: 400,
          reason: 'ACHAT',
        })
        .expect(201);
      const d = (
        await http()
          .post('/api/feed-distributions')
          .set(onB)
          .send(body)
          .expect(201)
      ).body as Dist;
      expect(d).toMatchObject({ unitCost: 400, cost: 12000 });
      const levelOn = async (headers: Headers) =>
        (await http().get(`/api/stock/${item.id}`).set(headers).expect(200))
          .body as Level;
      expect(await levelOn(onA)).toMatchObject({ quantity: 100 });
      expect(await levelOn(onB)).toMatchObject({ quantity: 20 });
      // Another farm's distribution is 404 and its stock is untouched.
      await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(onA)
        .send({ quantityKg: 40 })
        .expect(404);
      await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(onA)
        .expect(404);
      expect(await levelOn(onB)).toMatchObject({ quantity: 20 });
      await http()
        .patch(`/api/feed-distributions/${d.id}`)
        .set(onB)
        .send({ quantityKg: 40 })
        .expect(200);
      expect(await levelOn(onB)).toMatchObject({ quantity: 10 });
      expect(await levelOn(onA)).toMatchObject({ quantity: 100 });
      await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(onB)
        .expect(200);
      expect(await levelOn(onB)).toMatchObject({ quantity: 50 });
      expect(await levelOn(onA)).toMatchObject({ quantity: 100 });
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

    it('a stale read of the row cannot desynchronise stock from the row (building target)', async () => {
      const { item, product: p } = await stocked('Maïs', [[10000, 300]]);
      const d = await distribute({
        batchId: undefined,
        buildingId: world.poultryBld,
        feedProductId: p.id,
        quantityKg: 100,
      });
      for (let round = 0; round < 8; round++) {
        await Promise.all([
          patch(d.id, { quantityKg: 200 }),
          patch(d.id, { quantityKg: 100 }),
        ]);
        const row = await prisma.feedDistribution.findUniqueOrThrow({
          where: { id: d.id },
        });
        const moved = await prisma.stockMovement.findMany({
          where: { sourceId: d.id },
        });
        expect(moved.map((m) => Math.abs(Number(m.quantity)))).toEqual([
          Number(row.quantityKg),
        ]);
        expect(await level(item.id)).toMatchObject({
          quantity: 10000 - Number(row.quantityKg),
        });
        // Put the row back to 100 for the next round whichever order won.
        await patch(d.id, { quantityKg: 100 });
      }
    });

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

  describe('a validated inventory closes the past', () => {
    it('the reviewer repro: lot 100 on D1, distribution 10 on D5, count 80 on D10; the D5 distribution is locked', async () => {
      const { item, product: p } = await stocked('Maïs', [[100, 300]]);
      const d = await distribute({
        feedProductId: p.id,
        quantityKg: 10,
        date: daysAgo(15),
      });
      const session = await world.post<Id>(h, '/inventories', {
        date: daysAgo(10),
      });
      await http()
        .put(`/api/inventories/${session.id}/lines`)
        .set(h)
        .send({ lines: [{ itemId: item.id, countedQty: 80 }] })
        .expect(200);
      await http()
        .post(`/api/inventories/${session.id}/validate`)
        .set(h)
        .expect(201);
      expect((await level(item.id)).quantity).toBe(80);
      const locked = `Un inventaire validé le ${daysAgo(10)} verrouille les mouvements antérieurs de Maïs`;

      const edit = await patch(d.id, { quantityKg: 20 }, 409);
      expect((edit.body as Msg).message).toBe(locked);
      const del = await http()
        .delete(`/api/feed-distributions/${d.id}`)
        .set(h)
        .expect(409);
      expect((del.body as Msg).message).toBe(locked);
      const late = await distribute(
        { feedProductId: p.id, date: daysAgo(12) },
        409,
      );
      expect((late as unknown as Msg).message).toBe(locked);
      expect((await level(item.id)).quantity).toBe(80);
      expect((await exits(item.id)).map((m) => m.quantity)).toEqual([-10]);

      // The count day and later days stay open: level = counted − quantity.
      await distribute({
        feedProductId: p.id,
        quantityKg: 5,
        date: daysAgo(10),
      });
      expect((await level(item.id)).quantity).toBe(75);
      // A distribution made after the count can still be edited or deleted.
      const after = await distribute({
        feedProductId: p.id,
        quantityKg: 5,
        date: daysAgo(3),
      });
      await patch(after.id, { quantityKg: 8 });
      await http()
        .delete(`/api/feed-distributions/${after.id}`)
        .set(h)
        .expect(200);
      expect((await level(item.id)).quantity).toBe(75);
    });
  });
});
