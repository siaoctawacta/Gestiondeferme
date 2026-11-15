import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Role } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockLedgerService } from '../src/stock/stock-ledger.service';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

interface Item {
  id: string;
  name: string;
  category: string;
  unit: string;
  active: boolean;
}
interface Row {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minQty: number;
  maxQty: number | null;
  level: 'ok' | 'faible' | 'critique';
  daysOfStock: number | null;
  averageCost: number;
  value: number;
  nextExpiry: string | null;
}
interface Mv {
  id: string;
  operationId: string;
  lotExplicit: boolean;
  date: string;
  itemId: string;
  type: string;
  quantity: number;
  unitCost: number;
  value: number;
  reason: string;
  batchId: string | null;
  lotNumber: string | null;
  sourceType: string | null;
  manual: boolean;
}
interface Page<T> {
  items: T[];
  total: number;
  levelCounts?: Record<string, number>;
}
interface Msg {
  message: string | string[];
}
interface Inventory {
  id: string;
  date: string;
  status: string;
  lines: {
    itemId: string;
    theoreticalQty: number;
    countedQty: number;
    difference: number;
  }[];
}

const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

describe('Stock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;

  const http = () => request(app.getHttpServer() as App);

  async function actor(role: Role, farmIds: string[] = [farmA], farm = farmA) {
    const user = await createUser({ organizationId: orgId, role, farmIds });
    return {
      user,
      headers: {
        Authorization: `Bearer ${await tokenFor(user.id)}`,
        'X-Farm-Id': farm,
      },
    };
  }

  type Headers = Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await createOrganization()).id;
    farmA = (await createFarm(orgId, 'Ferme A')).id;
    farmB = (await createFarm(orgId, 'Ferme B')).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function item(
    h: Headers,
    name: string,
    over: Record<string, unknown> = {},
  ): Promise<Item> {
    const res = await http()
      .post('/api/stock-items')
      .set(h)
      .send({ name, category: 'ALIMENT', unit: 'kg', ...over })
      .expect(201);
    return res.body as Item;
  }

  const move = (h: Headers, body: Record<string, unknown>) =>
    http().post('/api/stock/movements').set(h).send(body);

  async function entry(
    h: Headers,
    itemId: string,
    quantity: number,
    unitCost: number,
    date = daysAgo(40),
    over: Record<string, unknown> = {},
  ): Promise<Mv> {
    const res = await move(h, {
      itemId,
      type: 'ENTREE',
      date,
      quantity,
      unitCost,
      reason: 'ACHAT',
      ...over,
    }).expect(201);
    return (res.body as Mv[])[0];
  }

  /** Like `entry` but hands back the response, whatever its status. */
  function entry409(
    h: Headers,
    itemId: string,
    quantity: number,
    date = daysAgo(40),
  ) {
    return move(h, {
      itemId,
      type: 'ENTREE',
      date,
      quantity,
      unitCost: 10,
      reason: 'ACHAT',
    });
  }

  function exit(
    h: Headers,
    itemId: string,
    quantity: number,
    date = daysAgo(1),
    over: Record<string, unknown> = {},
  ) {
    return move(h, {
      itemId,
      type: 'SORTIE',
      date,
      quantity,
      reason: 'CONSOMMATION',
      ...over,
    });
  }

  const thresholds = (
    h: Headers,
    itemId: string,
    minQty: number,
    maxQty?: number | null,
  ) =>
    http()
      .put(`/api/stock/${itemId}/thresholds`)
      .set(h)
      .send({ minQty, ...(maxQty !== undefined ? { maxQty } : {}) });

  const list = async (h: Headers, qs = '') =>
    (await http().get(`/api/stock${qs}`).set(h).expect(200)).body as Page<Row>;

  describe('reference levels', () => {
    it('labels 900/1500 faible, 600/1500 critique, 4200/2000 ok, and counts them', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const ponte = await item(h, 'Aliment ponte');
      const porc = await item(h, 'Aliment engraissement porc');
      const chair = await item(h, 'Aliment croissance chair');
      await entry(h, ponte.id, 900, 300);
      await entry(h, porc.id, 600, 280);
      await entry(h, chair.id, 4200, 310);
      await thresholds(h, ponte.id, 1500).expect(200);
      await thresholds(h, porc.id, 1500).expect(200);
      await thresholds(h, chair.id, 2000).expect(200);

      const page = await list(h);
      const by = Object.fromEntries(page.items.map((r) => [r.name, r]));
      expect(by['Aliment ponte']).toMatchObject({
        quantity: 900,
        minQty: 1500,
        level: 'faible',
        unit: 'kg',
        averageCost: 300,
        value: 270000,
      });
      expect(by['Aliment engraissement porc']).toMatchObject({
        quantity: 600,
        level: 'critique',
      });
      expect(by['Aliment croissance chair']).toMatchObject({
        quantity: 4200,
        minQty: 2000,
        level: 'ok',
      });
      expect(page.levelCounts).toEqual({ ok: 1, faible: 1, critique: 1 });

      const filtered = await list(h, '?level=critique');
      expect(filtered.items.map((r) => r.name)).toEqual([
        'Aliment engraissement porc',
      ]);
      expect(filtered.total).toBe(1);
      expect(filtered.levelCounts).toEqual({ ok: 1, faible: 1, critique: 1 });
    });

    it('treats exactly the minimum as ok, exactly half of it as faible, below half as critique', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const a = await item(h, 'A');
      const b = await item(h, 'B');
      const c = await item(h, 'C');
      for (const [it, qty] of [
        [a, 1500],
        [b, 750],
        [c, 749],
      ] as const) {
        await entry(h, it.id, qty, 10);
        await thresholds(h, it.id, 1500).expect(200);
      }
      const levels = Object.fromEntries(
        (await list(h)).items.map((r) => [r.name, r.level]),
      );
      expect(levels).toEqual({ A: 'ok', B: 'faible', C: 'critique' });
    });

    it('shows 6 days of stock for 4200 kg with 21 000 kg consumed over 30 days', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const chair = await item(h, 'Aliment croissance chair');
      await entry(h, chair.id, 25200, 300, daysAgo(40));
      for (const d of [2, 10, 20]) {
        await exit(h, chair.id, 7000, daysAgo(d)).expect(201);
      }
      const row = (await list(h)).items[0];
      expect(row.quantity).toBe(4200);
      expect(row.daysOfStock).toBe(6);
    });

    it('has no days of stock without consumption, and ignores losses', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment');
      await entry(h, it.id, 100, 10);
      await exit(h, it.id, 10, daysAgo(2), { reason: 'PERTE' }).expect(201);
      expect((await list(h)).items[0].daysOfStock).toBeNull();
    });

    it('lists an article with no movement at zero, and filters by category and search', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      await item(h, 'Vaccin Gumboro', { category: 'VACCIN', unit: 'flacon' });
      await item(h, 'Aliment ponte');
      const all = await list(h);
      expect(all.items.find((r) => r.name === 'Aliment ponte')).toMatchObject({
        quantity: 0,
        level: 'ok',
        value: 0,
      });
      expect((await list(h, '?category=VACCIN')).items).toHaveLength(1);
      expect((await list(h, '?search=ponte')).items).toHaveLength(1);
      await http().get('/api/stock?level=bad').set(h).expect(400);
      await http().get('/api/stock?sort=quantity:asc').set(h).expect(200);
      await http().get('/api/stock?sort=nope:asc').set(h).expect(400);
    });

    it('shows the next expiry among batches that still hold stock', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      await entry(h, it.id, 10, 100, daysAgo(40), {
        lotNumber: 'A',
        expiryDate: '2027-03-01',
      });
      await entry(h, it.id, 10, 100, daysAgo(40), {
        lotNumber: 'B',
        expiryDate: '2027-01-01',
      });
      expect((await list(h)).items[0].nextExpiry).toBe('2027-01-01');
      await exit(h, it.id, 10, daysAgo(1)).expect(201);
      expect((await list(h)).items[0].nextExpiry).toBe('2027-03-01');
    });

    it('exports the same rows as CSV with the French header', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 900, 300);
      await thresholds(h, it.id, 1500).expect(200);
      const res = await http().get('/api/stock?format=csv').set(h).expect(200);
      const lines = res.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
      expect(lines[0]).toBe(
        'Article;Catégorie;Quantité;Unité;Seuil minimum;Niveau;Jours de stock',
      );
      expect(lines[1]).toBe('Aliment ponte;Aliment;900;kg;1500;faible;');
    });
  });

  describe('farms', () => {
    it('keeps farm B blind to farm A, with its own thresholds', async () => {
      const a = await actor('DIRECTEUR_FERME');
      const b = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const it = await item(a.headers, 'Aliment ponte');
      await entry(a.headers, it.id, 900, 300);
      await thresholds(a.headers, it.id, 1500).expect(200);
      const seen = (await list(b.headers)).items[0];
      expect(seen).toMatchObject({ quantity: 0, minQty: 0, level: 'ok' });
      await http()
        .get(`/api/stock/movements?itemId=${it.id}`)
        .set(b.headers)
        .expect(200)
        .expect((r) => expect((r.body as Page<Mv>).total).toBe(0));
      await exit(b.headers, it.id, 10).expect(400);
    });

    it('sums the farms under X-Farm-Id: all and shows the worst level', async () => {
      const owner = await actor('SUPER_ADMIN', [farmA, farmB]);
      const hA = { ...owner.headers, 'X-Farm-Id': farmA };
      const hB = { ...owner.headers, 'X-Farm-Id': farmB };
      const hAll = { ...owner.headers, 'X-Farm-Id': 'all' };
      const it = await item(hA, 'Aliment ponte');
      await entry(hA, it.id, 900, 300);
      await entry(hB, it.id, 5000, 330);
      await thresholds(hA, it.id, 1500).expect(200);
      await thresholds(hB, it.id, 1500).expect(200);
      const row = (await list(hAll)).items[0];
      expect(row).toMatchObject({
        quantity: 5900,
        minQty: 3000,
        level: 'faible',
        value: 270000 + 1650000,
      });
      await move(hAll, {
        itemId: it.id,
        type: 'ENTREE',
        date: daysAgo(1),
        quantity: 1,
        unitCost: 1,
        reason: 'ACHAT',
      }).expect(403);
    });

    it('refuses a foreign article id in a body with a 400, and an unknown article detail with a 404', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const org2 = await createOrganization('Autre');
      const foreign = await prisma.stockItem.create({
        data: {
          organizationId: org2.id,
          name: 'Étranger',
          category: 'MATERIEL',
          unit: 'u',
        },
      });
      await move(h, {
        itemId: foreign.id,
        type: 'ENTREE',
        date: daysAgo(1),
        quantity: 1,
        unitCost: 1,
        reason: 'ACHAT',
      }).expect(400);
      await http().get(`/api/stock/${foreign.id}`).set(h).expect(404);
      await thresholds(h, foreign.id, 5).expect(404);
    });
  });

  describe('items', () => {
    it('creates, renames, deactivates and deletes an article, auditing each once', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const created = await item(h, 'Aliment ponte');
      await http()
        .patch(`/api/stock-items/${created.id}`)
        .set(h)
        .send({ name: 'Aliment ponte 16%', active: false })
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({
            name: 'Aliment ponte 16%',
            active: false,
          }),
        );
      await http().delete(`/api/stock-items/${created.id}`).set(h).expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'stocks' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    });

    it('refuses a duplicate name with 409 and bad bodies with 400', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      await item(h, 'Aliment ponte');
      await http()
        .post('/api/stock-items')
        .set(h)
        .send({ name: 'Aliment ponte', category: 'ALIMENT', unit: 'kg' })
        .expect(409);
      await http()
        .post('/api/stock-items')
        .set(h)
        .send({ name: 'X', category: 'NOPE', unit: 'kg' })
        .expect(400);
      await http()
        .post('/api/stock-items')
        .set(h)
        .send({ name: 'X', category: 'ALIMENT', unit: 'kg', extra: 1 })
        .expect(400);
    });

    it('refuses to delete an article that has movements (409) and to change its unit', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 10, 100);
      await http()
        .delete(`/api/stock-items/${it.id}`)
        .set(h)
        .expect(409)
        .expect((r) =>
          expect((r.body as Msg).message).toBe(
            'Cet article a des mouvements : désactivez-le plutôt',
          ),
        );
      await http()
        .patch(`/api/stock-items/${it.id}`)
        .set(h)
        .send({ unit: 'sac' })
        .expect(409);
      await http()
        .patch(`/api/stock-items/${it.id}`)
        .set(h)
        .send({ active: false })
        .expect(200);
    });

    it('lists the catalogue for pickers, filtered by activity', async () => {
      const { headers: h } = await actor('MAGASINIER');
      const owner = (await actor('RESP_STOCK')).headers;
      const off = await item(owner, 'Ancien');
      await item(owner, 'Récent');
      await http()
        .patch(`/api/stock-items/${off.id}`)
        .set(owner)
        .send({ active: false })
        .expect(200);
      const res = await http()
        .get('/api/stock-items?active=true')
        .set(h)
        .expect(200);
      expect((res.body as Page<Item>).items.map((i) => i.name)).toEqual([
        'Récent',
      ]);
    });

    it('sets thresholds per farm, validates them and audits the change', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await thresholds(h, it.id, 1500, 5000)
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({ minQty: 1500, maxQty: 5000 }),
        );
      await thresholds(h, it.id, 1500, 1000).expect(400);
      await thresholds(h, it.id, -1).expect(400);
      await thresholds(h, it.id, 100, null)
        .expect(200)
        .expect((r) => expect((r.body as Row).maxQty).toBeNull());
      expect(
        await prisma.auditLog.count({
          where: { module: 'stocks', action: 'UPDATE', farmId: farmA },
        }),
      ).toBe(2);
    });
  });

  describe('movements', () => {
    it('records an entry with a lot, an exit valued at the average, and refuses a negative stock', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      const first = await entry(h, it.id, 1000, 300, daysAgo(10), {
        lotNumber: 'L1',
        expiryDate: '2027-06-30',
      });
      expect(first).toMatchObject({
        quantity: 1000,
        unitCost: 300,
        lotNumber: 'L1',
        manual: true,
      });
      await entry(h, it.id, 500, 360, daysAgo(9));
      const out = await exit(h, it.id, 600, daysAgo(8)).expect(201);
      expect((out.body as Mv[])[0]).toMatchObject({
        type: 'SORTIE',
        quantity: -600,
        unitCost: 320,
        value: 192000,
      });
      await exit(h, it.id, 1000, daysAgo(7))
        .expect(400)
        .expect((r) =>
          expect((r.body as Msg).message).toBe(
            'Stock insuffisant pour Aliment ponte (disponible 900 kg)',
          ),
        );
      expect((await list(h)).items[0]).toMatchObject({
        quantity: 900,
        averageCost: 320,
        value: 288000,
      });
    });

    it('lets two parallel exits of 600 on 1000 through once', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 1000, 300);
      const results = await Promise.all([
        exit(h, it.id, 600),
        exit(h, it.id, 600),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect((await list(h)).items[0].quantity).toBe(400);
    });

    it('FEFO takes the earliest-expiring lot first and skips an expired one', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      await entry(h, it.id, 10, 100, daysAgo(60), {
        lotNumber: 'PERIME',
        expiryDate: daysAgo(30),
      });
      await entry(h, it.id, 10, 100, daysAgo(60), {
        lotNumber: 'TARD',
        expiryDate: '2028-01-01',
      });
      await entry(h, it.id, 10, 100, daysAgo(60), {
        lotNumber: 'TOT',
        expiryDate: '2027-01-01',
      });
      const out = await exit(h, it.id, 12, daysAgo(1)).expect(201);
      const parts = out.body as Mv[];
      expect(parts.map((p) => [p.lotNumber, p.quantity])).toEqual([
        ['TOT', -10],
        ['TARD', -2],
      ]);
      const detail = (
        await http().get(`/api/stock/${it.id}`).set(h).expect(200)
      ).body as {
        quantity: number;
        batches: { lotNumber: string; quantity: number; expired: boolean }[];
      };
      expect(detail.quantity).toBe(18);
      expect(
        Object.fromEntries(
          detail.batches.map((b) => [b.lotNumber, [b.quantity, b.expired]]),
        ),
      ).toEqual({
        PERIME: [10, true],
        TARD: [8, false],
        TOT: [0, false],
      });
    });

    it('answers 400 "Lot périmé" when only expired stock remains', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      await entry(h, it.id, 10, 100, daysAgo(60), {
        lotNumber: 'PERIME',
        expiryDate: daysAgo(30),
      });
      await exit(h, it.id, 1)
        .expect(400)
        .expect((r) => expect((r.body as Msg).message).toBe('Lot périmé'));
      expect((await list(h)).items[0].quantity).toBe(10);
      // A loss writes it off.
      await exit(h, it.id, 10, daysAgo(1), { reason: 'PERTE' }).expect(201);
      expect((await list(h)).items[0].quantity).toBe(0);
    });

    it('takes from a named lot and refuses more than it holds', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      const a = await entry(h, it.id, 10, 100, daysAgo(60), {
        lotNumber: 'A',
        expiryDate: '2027-06-01',
      });
      await entry(h, it.id, 10, 100, daysAgo(60), {
        lotNumber: 'B',
        expiryDate: '2027-01-01',
      });
      await exit(h, it.id, 11, daysAgo(1), { stockBatchId: a.batchId }).expect(
        400,
      );
      const ok = await exit(h, it.id, 4, daysAgo(1), {
        stockBatchId: a.batchId,
      }).expect(201);
      expect((ok.body as Mv[])[0].lotNumber).toBe('A');
    });

    it('edits a manual entry and recomputes the cost of the later exits', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      const first = await entry(h, it.id, 100, 100, daysAgo(10));
      await entry(h, it.id, 100, 200, daysAgo(9));
      const out = (await exit(h, it.id, 120, daysAgo(8)).expect(201))
        .body as Mv[];
      expect(out[0].unitCost).toBe(150);
      await http()
        .patch(`/api/stock/movements/${first.id}`)
        .set(h)
        .send({ unitCost: 300, note: 'prix corrigé' })
        .expect(200);
      const after = (
        await http()
          .get(`/api/stock/movements?itemId=${it.id}&type=SORTIE`)
          .set(h)
          .expect(200)
      ).body as Page<Mv>;
      expect(after.items[0].unitCost).toBe(250);
      // A quantity change that would starve the exit is refused, one that keeps it covered is not.
      await http()
        .patch(`/api/stock/movements/${first.id}`)
        .set(h)
        .send({ quantity: 10 })
        .expect(400);
      await http()
        .patch(`/api/stock/movements/${first.id}`)
        .set(h)
        .send({ quantity: 20 })
        .expect(200);
    });

    it('deletes a manual movement unless a later exit depends on it', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      const e1 = await entry(h, it.id, 100, 100, daysAgo(10));
      await exit(h, it.id, 80, daysAgo(8)).expect(201);
      await http().delete(`/api/stock/movements/${e1.id}`).set(h).expect(400);
      const tail = (
        await http()
          .get(`/api/stock/movements?itemId=${it.id}&type=SORTIE`)
          .set(h)
      ).body as Page<Mv>;
      await http()
        .delete(`/api/stock/movements/${tail.items[0].id}`)
        .set(h)
        .expect(200);
      await http().delete(`/api/stock/movements/${e1.id}`).set(h).expect(200);
      expect((await list(h)).items[0].quantity).toBe(0);
    });

    it('refuses to edit or delete a movement written by another operation (409)', async () => {
      const { headers: h, user } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 100, 100, daysAgo(10));
      const ledger = app.get(StockLedgerService);
      await prisma.$transaction((tx) =>
        ledger.record(tx, {
          farmId: farmA,
          stockItemId: it.id,
          date: new Date(`${daysAgo(5)}T00:00:00.000Z`),
          type: 'SORTIE',
          quantity: -10,
          reason: 'CONSOMMATION',
          sourceType: 'FEED_DISTRIBUTION',
          sourceId: 'dist-1',
          userId: user.id,
        }),
      );
      const linked = (
        (
          await http()
            .get(`/api/stock/movements?itemId=${it.id}&type=SORTIE`)
            .set(h)
            .expect(200)
        ).body as Page<Mv>
      ).items[0];
      expect(linked).toMatchObject({
        manual: false,
        sourceType: 'FEED_DISTRIBUTION',
      });
      const expected =
        "Ce mouvement provient d'une autre opération ; corrigez l'opération d'origine";
      await http()
        .patch(`/api/stock/movements/${linked.id}`)
        .set(h)
        .send({ note: 'x' })
        .expect(409)
        .expect((r) => expect((r.body as Msg).message).toBe(expected));
      await http()
        .delete(`/api/stock/movements/${linked.id}`)
        .set(h)
        .expect(409)
        .expect((r) => expect((r.body as Msg).message).toBe(expected));
    });

    it('validates the body: type and reason, cost rules, sign, date, batch', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 100, 100, daysAgo(10));
      const base = {
        itemId: it.id,
        date: daysAgo(1),
        quantity: 1,
        reason: 'CONSOMMATION',
      };
      const bad = async (body: Record<string, unknown>) =>
        move(h, { ...base, ...body }).expect(400);
      await bad({ type: 'ENTREE', reason: 'ACHAT' }); // no cost
      await bad({ type: 'ENTREE', reason: 'PERTE', unitCost: 1 }); // reason for another type
      await bad({ type: 'ENTREE', reason: 'ACHAT', unitCost: -1 });
      await bad({ type: 'ENTREE', reason: 'ACHAT', unitCost: 1, quantity: -1 });
      await bad({ type: 'SORTIE', unitCost: 5 });
      await bad({ type: 'SORTIE', quantity: -1 });
      await bad({ type: 'SORTIE', reason: 'ACHAT' });
      await bad({ type: 'AJUSTEMENT', reason: 'INVENTAIRE', quantity: 0 });
      await bad({ type: 'AJUSTEMENT', reason: 'CONSOMMATION', quantity: 1 });
      await bad({
        type: 'AJUSTEMENT',
        reason: 'INVENTAIRE',
        quantity: -1,
        unitCost: 3,
      });
      await bad({ type: 'TRANSFERT_ENTREE', reason: 'AUTRE' });
      await bad({ type: 'SORTIE', date: daysAgo(-1) });
      await bad({ type: 'SORTIE', stockBatchId: 'nope' });
      await bad({ type: 'SORTIE', itemId: 'nope' });
      await bad({ type: 'SORTIE', quantity: 1.234 });
      await bad({ type: 'SORTIE', extra: true });
      expect((await list(h)).items[0].quantity).toBe(100);
    });

    it('records an adjustment either way, a positive one valued at the average by default', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 100, 200, daysAgo(10));
      const up = (
        await move(h, {
          itemId: it.id,
          type: 'AJUSTEMENT',
          reason: 'INVENTAIRE',
          date: daysAgo(5),
          quantity: 10,
        }).expect(201)
      ).body as Mv[];
      expect(up[0]).toMatchObject({ quantity: 10, unitCost: 200 });
      const down = (
        await move(h, {
          itemId: it.id,
          type: 'AJUSTEMENT',
          reason: 'AUTRE',
          date: daysAgo(4),
          quantity: -30,
        }).expect(201)
      ).body as Mv[];
      expect(down[0]).toMatchObject({ quantity: -30, unitCost: 200 });
      expect((await list(h)).items[0].quantity).toBe(80);
    });

    it('lists movements newest first with filters and audits each write once', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      const other = await item(h, 'Autre');
      const e = await entry(h, it.id, 100, 100, daysAgo(10));
      await exit(h, it.id, 10, daysAgo(5)).expect(201);
      await entry(h, other.id, 5, 5, daysAgo(3));
      await http()
        .patch(`/api/stock/movements/${e.id}`)
        .set(h)
        .send({ note: 'n' })
        .expect(200);
      const all = (await http().get('/api/stock/movements').set(h).expect(200))
        .body as Page<Mv>;
      expect(all.total).toBe(3);
      expect(all.items.map((m) => m.date)).toEqual([
        daysAgo(3),
        daysAgo(5),
        daysAgo(10),
      ]);
      const filtered = (
        await http()
          .get(
            `/api/stock/movements?itemId=${it.id}&from=${daysAgo(6)}&to=${daysAgo(4)}`,
          )
          .set(h)
          .expect(200)
      ).body as Page<Mv>;
      expect(filtered.items.map((m) => m.type)).toEqual(['SORTIE']);
      await http().get('/api/stock/movements?type=BAD').set(h).expect(400);
      const audits = await prisma.auditLog.findMany({
        where: { module: 'stocks', recordId: { not: null } },
      });
      // 2 articles and 3 movements created, 1 movement updated
      expect(audits.filter((a) => a.action === 'CREATE').length).toBe(5);
      expect(audits.filter((a) => a.action === 'UPDATE')).toHaveLength(1);
    });

    it('shows an article detail with farm levels, lots and last movements', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 100, 100, daysAgo(10), {
        lotNumber: 'L1',
        expiryDate: '2027-02-01',
      });
      await thresholds(h, it.id, 500).expect(200);
      const d = (await http().get(`/api/stock/${it.id}`).set(h).expect(200))
        .body as Row & {
        farms: { farmId: string; quantity: number; level: string }[];
        batches: { lotNumber: string; expiryDate: string; quantity: number }[];
        movements: Mv[];
      };
      expect(d).toMatchObject({
        name: 'Aliment ponte',
        quantity: 100,
        level: 'critique',
        nextExpiry: '2027-02-01',
      });
      expect(d.farms).toEqual([
        expect.objectContaining({ farmId: farmA, quantity: 100 }),
      ]);
      expect(d.batches).toEqual([
        expect.objectContaining({
          lotNumber: 'L1',
          expiryDate: '2027-02-01',
          quantity: 100,
        }),
      ]);
      expect(d.movements).toHaveLength(1);
    });

    it("answers 404 when another farm's movement is edited or deleted", async () => {
      const a = await actor('DIRECTEUR_FERME');
      const b = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const it = await item(a.headers, 'Aliment ponte');
      const e = await entry(a.headers, it.id, 100, 100, daysAgo(10));
      await http()
        .patch(`/api/stock/movements/${e.id}`)
        .set(b.headers)
        .send({ note: 'x' })
        .expect(404);
      await http()
        .delete(`/api/stock/movements/${e.id}`)
        .set(b.headers)
        .expect(404);
      expect((await list(a.headers)).items[0].quantity).toBe(100);
    });

    it('rejects a null quantity or cost in a PATCH with a 400', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Aliment ponte');
      const e = await entry(h, it.id, 100, 100, daysAgo(10));
      for (const body of [{ quantity: null }, { unitCost: null }]) {
        await http()
          .patch(`/api/stock/movements/${e.id}`)
          .set(h)
          .send(body)
          .expect(400);
      }
    });

    it('treats an exit split across lots as one operation: PATCH re-plans it, DELETE removes it whole', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      await entry(h, it.id, 100, 10, daysAgo(40), {
        lotNumber: 'A',
        expiryDate: '2027-06-01',
      });
      await entry(h, it.id, 100, 10, daysAgo(40), {
        lotNumber: 'B',
        expiryDate: '2027-12-01',
      });
      const out = (await exit(h, it.id, 150, daysAgo(2)).expect(201))
        .body as Mv[];
      expect(out).toHaveLength(2);
      expect(out[0].operationId).toBe(out[1].operationId);
      const entries = (
        await http()
          .get(`/api/stock/movements?itemId=${it.id}&type=ENTREE`)
          .set(h)
      ).body as Page<Mv>;
      expect(new Set(entries.items.map((m) => m.operationId)).size).toBe(2);

      const patched = (
        await http()
          .patch(`/api/stock/movements/${out[1].id}`)
          .set(h)
          .send({ quantity: 120 })
          .expect(200)
      ).body as Mv[];
      expect(
        patched
          .map((m) => [m.lotNumber, m.quantity])
          .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      ).toEqual([
        ['A', -100],
        ['B', -20],
      ]);
      expect(patched[0].operationId).toBe(out[0].operationId);
      expect((await list(h)).items[0].quantity).toBe(80);

      await http()
        .delete(`/api/stock/movements/${patched[0].id}`)
        .set(h)
        .expect(200);
      const left = (
        await http()
          .get(`/api/stock/movements?itemId=${it.id}&type=SORTIE`)
          .set(h)
      ).body as Page<Mv>;
      expect(left.total).toBe(0);
      expect((await list(h)).items[0].quantity).toBe(200);
      const audits = await prisma.auditLog.findMany({
        where: { recordId: out[0].operationId },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((a) => a.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
    });

    it('flags an exit asked from a lot, keeps it on that lot when edited, and refuses what the lot cannot hold', async () => {
      const { headers: h } = await actor('RESP_STOCK');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      await entry(h, it.id, 50, 10, daysAgo(40), {
        lotNumber: 'A',
        expiryDate: '2027-06-01',
      });
      const b = await entry(h, it.id, 50, 10, daysAgo(40), {
        lotNumber: 'B',
        expiryDate: '2027-12-01',
      });
      const named = (
        await exit(h, it.id, 10, daysAgo(2), {
          stockBatchId: b.batchId,
        }).expect(201)
      ).body as Mv[];
      expect(named[0].lotExplicit).toBe(true);
      const fefo = (await exit(h, it.id, 5, daysAgo(2)).expect(201))
        .body as Mv[];
      expect(fefo[0].lotExplicit).toBe(false);
      await http()
        .patch(`/api/stock/movements/${named[0].id}`)
        .set(h)
        .send({ quantity: 50 })
        .expect(200);
      await http()
        .patch(`/api/stock/movements/${named[0].id}`)
        .set(h)
        .send({ quantity: 51 })
        .expect(400)
        .expect((r) =>
          expect((r.body as Msg).message).toBe(
            'Stock insuffisant pour Vaccin, lot B (disponible 50 flacon)',
          ),
        );
    });
  });

  describe('inventories', () => {
    async function counted(h: Headers, date: string, lines: object[]) {
      const session = (
        await http()
          .post('/api/inventories')
          .set(h)
          .send({ date, note: 'Fin de mois' })
          .expect(201)
      ).body as Inventory;
      await http()
        .put(`/api/inventories/${session.id}/lines`)
        .set(h)
        .send({ lines })
        .expect(200);
      return session;
    }

    it('counts 880 against 900, validates into a −20 adjustment and freezes the session', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const mag = (await actor('MAGASINIER')).headers;
      const director = (await actor('DIRECTEUR_FERME')).headers;
      const it = await item(resp, 'Aliment ponte');
      await entry(resp, it.id, 1000, 300, daysAgo(10));
      await exit(resp, it.id, 100, daysAgo(5)).expect(201);
      const s = await counted(resp, daysAgo(1), [
        { itemId: it.id, countedQty: 880 },
      ]);
      const draft = (
        await http().get(`/api/inventories/${s.id}`).set(resp).expect(200)
      ).body as Inventory;
      expect(draft.status).toBe('BROUILLON');
      expect(draft.lines[0]).toMatchObject({
        theoreticalQty: 900,
        countedQty: 880,
        difference: -20,
      });
      expect((await list(resp)).items[0].quantity).toBe(900);

      // The stock manager validates; the storekeeper who counts cannot.
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(mag)
        .expect(403);
      const done = (
        await http()
          .post(`/api/inventories/${s.id}/validate`)
          .set(resp)
          .expect(201)
      ).body as Inventory;
      expect(done.status).toBe('VALIDEE');
      expect((await list(resp)).items[0].quantity).toBe(880);
      const adj = (
        await http()
          .get(`/api/stock/movements?itemId=${it.id}&type=AJUSTEMENT`)
          .set(resp)
          .expect(200)
      ).body as Page<Mv>;
      expect(adj.items[0]).toMatchObject({
        quantity: -20,
        reason: 'INVENTAIRE',
        sourceType: 'INVENTORY',
        unitCost: 300,
        manual: false,
      });

      // Immutable and not validable twice.
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(director)
        .expect(409);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({ lines: [] })
        .expect(409);
      await http().delete(`/api/inventories/${s.id}`).set(resp).expect(409);
      await http()
        .patch(`/api/stock/movements/${adj.items[0].id}`)
        .set(resp)
        .send({ note: 'x' })
        .expect(409);
    });

    it('recomputes the theoretical quantity at validation, when movements came in after the count', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const director = (await actor('DIRECTEUR_FERME')).headers;
      const it = await item(resp, 'Aliment ponte');
      await entry(resp, it.id, 1000, 300, daysAgo(10));
      const s = await counted(resp, daysAgo(2), [
        { itemId: it.id, countedQty: 1000 },
      ]);
      // A back-dated entry lands before the session date.
      await entry(resp, it.id, 50, 300, daysAgo(3));
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(director)
        .expect(201);
      const adj = (
        await http()
          .get(`/api/stock/movements?itemId=${it.id}&type=AJUSTEMENT`)
          .set(resp)
      ).body as Page<Mv>;
      expect(adj.items[0].quantity).toBe(-50);
      expect((await list(resp)).items[0].quantity).toBe(1000);
    });

    it('writes nothing for a line with no difference, and adds stock found at the average', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const director = (await actor('DIRECTEUR_FERME')).headers;
      const a = await item(resp, 'A');
      const b = await item(resp, 'B');
      await entry(resp, a.id, 10, 50, daysAgo(10));
      await entry(resp, b.id, 10, 80, daysAgo(10));
      const s = await counted(resp, daysAgo(1), [
        { itemId: a.id, countedQty: 10 },
        { itemId: b.id, countedQty: 14 },
      ]);
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(director)
        .expect(201);
      const adj = (
        await http().get('/api/stock/movements?type=AJUSTEMENT').set(resp)
      ).body as Page<Mv>;
      expect(adj.items).toHaveLength(1);
      expect(adj.items[0]).toMatchObject({ quantity: 4, unitCost: 80 });
    });

    it('replaces the draft lines, refuses duplicates, unknown articles, a future date and an empty validation', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const director = (await actor('DIRECTEUR_FERME')).headers;
      const it = await item(resp, 'Aliment ponte');
      await entry(resp, it.id, 100, 10, daysAgo(10));
      await http()
        .post('/api/inventories')
        .set(resp)
        .send({ date: daysAgo(-1) })
        .expect(400);
      const s = await counted(resp, daysAgo(1), [
        { itemId: it.id, countedQty: 90 },
      ]);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({
          lines: [
            { itemId: it.id, countedQty: 1 },
            { itemId: it.id, countedQty: 2 },
          ],
        })
        .expect(400);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({ lines: [{ itemId: 'nope', countedQty: 1 }] })
        .expect(400);
      const org2 = await createOrganization('Autre');
      const foreign = await prisma.stockItem.create({
        data: {
          organizationId: org2.id,
          name: 'Étranger',
          category: 'MATERIEL',
          unit: 'u',
        },
      });
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({ lines: [{ itemId: foreign.id, countedQty: 1 }] })
        .expect(400);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({ lines: [{ itemId: it.id, countedQty: -1 }] })
        .expect(400);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({ lines: [{ itemId: it.id, countedQty: 95 }] })
        .expect(200);
      const read = (await http().get(`/api/inventories/${s.id}`).set(resp))
        .body as Inventory;
      expect(read.lines).toHaveLength(1);
      expect(read.lines[0].countedQty).toBe(95);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(resp)
        .send({ lines: [] })
        .expect(200);
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(director)
        .expect(400);
      await http().delete(`/api/inventories/${s.id}`).set(resp).expect(200);
      await http().get(`/api/inventories/${s.id}`).set(resp).expect(404);
    });

    it("lists a farm's sessions only, and audits each step once", async () => {
      const a = await actor('DIRECTEUR_FERME');
      const b = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const it = await item(a.headers, 'Aliment ponte');
      await entry(a.headers, it.id, 10, 10, daysAgo(10));
      const s = await counted(a.headers, daysAgo(1), [
        { itemId: it.id, countedQty: 8 },
      ]);
      expect(
        (
          (await http().get('/api/inventories').set(a.headers).expect(200))
            .body as Page<Inventory>
        ).total,
      ).toBe(1);
      expect(
        (
          (await http().get('/api/inventories').set(b.headers).expect(200))
            .body as Page<Inventory>
        ).total,
      ).toBe(0);
      await http().get(`/api/inventories/${s.id}`).set(b.headers).expect(404);
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(b.headers)
        .send({ lines: [] })
        .expect(404);
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(a.headers)
        .expect(201);
      const rows = await prisma.auditLog.findMany({
        where: { recordId: s.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
      await http()
        .get('/api/inventories?status=VALIDEE')
        .set(a.headers)
        .expect(200);
      await http()
        .get('/api/inventories?status=NOPE')
        .set(a.headers)
        .expect(400);
    });
    it('validates once when two validations run in parallel (one 201, one 409)', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const it = await item(resp, 'Aliment ponte');
      await entry(resp, it.id, 100, 10, daysAgo(10));
      const s = await counted(resp, daysAgo(1), [
        { itemId: it.id, countedQty: 90 },
      ]);
      const results = await Promise.all([
        http().post(`/api/inventories/${s.id}/validate`).set(resp),
        http().post(`/api/inventories/${s.id}/validate`).set(resp),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await list(resp)).items[0].quantity).toBe(90);
      expect(
        await prisma.stockMovement.count({ where: { type: 'AJUSTEMENT' } }),
      ).toBe(1);
    });

    it('validates a count dated before a FEFO consumption emptied the earliest lot', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const it = await item(resp, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      await entry(resp, it.id, 100, 10, daysAgo(40), {
        lotNumber: 'A',
        expiryDate: '2027-06-01',
      });
      await entry(resp, it.id, 100, 10, daysAgo(40), {
        lotNumber: 'B',
        expiryDate: '2027-12-01',
      });
      await exit(resp, it.id, 100, daysAgo(1)).expect(201); // empties lot A
      const s = await counted(resp, daysAgo(2), [
        { itemId: it.id, countedQty: 180 },
      ]);
      await http()
        .post(`/api/inventories/${s.id}/validate`)
        .set(resp)
        .expect(201);
      const detail = (await http().get(`/api/stock/${it.id}`).set(resp))
        .body as {
        quantity: number;
        batches: { lotNumber: string; quantity: number }[];
      };
      expect(detail.quantity).toBe(80);
      expect(
        Object.fromEntries(
          detail.batches.map((b) => [b.lotNumber, b.quantity]),
        ),
      ).toEqual({ A: 0, B: 80 });
    });
  });

  describe('roles', () => {
    it('lets MAGASINIER post movements and read, but not create or change articles or thresholds', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const mag = (await actor('MAGASINIER')).headers;
      const it = await item(resp, 'Aliment ponte');
      await entry(mag, it.id, 100, 100, daysAgo(5));
      await exit(mag, it.id, 10).expect(201);
      await list(mag);
      await http()
        .post('/api/stock-items')
        .set(mag)
        .send({ name: 'Nouveau', category: 'ALIMENT', unit: 'kg' })
        .expect(403);
      await http()
        .patch(`/api/stock-items/${it.id}`)
        .set(mag)
        .send({ name: 'Autre' })
        .expect(403);
      await http().delete(`/api/stock-items/${it.id}`).set(mag).expect(403);
      await thresholds(mag, it.id, 5).expect(403);
    });

    it('lets MAGASINIER count (create, save lines) but not validate', async () => {
      const resp = (await actor('RESP_STOCK')).headers;
      const mag = (await actor('MAGASINIER')).headers;
      const it = await item(resp, 'Aliment ponte');
      await entry(resp, it.id, 10, 10, daysAgo(5));
      const s = await counted_by(mag, it.id);
      await http().post(`/api/inventories/${s}/validate`).set(mag).expect(403);
    });

    async function counted_by(h: Headers, itemId: string): Promise<string> {
      const s = (
        await http()
          .post('/api/inventories')
          .set(h)
          .send({ date: daysAgo(1) })
          .expect(201)
      ).body as Inventory;
      await http()
        .put(`/api/inventories/${s.id}/lines`)
        .set(h)
        .send({ lines: [{ itemId, countedQty: 9 }] })
        .expect(200);
      return s.id;
    }

    it.each(['AUDITEUR', 'RESP_AVICOLE', 'COMMERCIAL'] as Role[])(
      'keeps %s read-only on stock',
      async (role) => {
        const resp = (await actor('RESP_STOCK')).headers;
        const ro = (await actor(role)).headers;
        const it = await item(resp, 'Aliment ponte');
        const e = await entry(resp, it.id, 10, 10, daysAgo(5));
        await list(ro);
        await http().get(`/api/stock/${it.id}`).set(ro).expect(200);
        await http().get('/api/stock/movements').set(ro).expect(200);
        await http().get('/api/inventories').set(ro).expect(200);
        await http().get('/api/stock-items').set(ro).expect(200);
        const attempts = [
          move(ro, {
            itemId: it.id,
            type: 'ENTREE',
            date: daysAgo(1),
            quantity: 1,
            unitCost: 1,
            reason: 'ACHAT',
          }),
          http()
            .patch(`/api/stock/movements/${e.id}`)
            .set(ro)
            .send({ note: 'x' }),
          http().delete(`/api/stock/movements/${e.id}`).set(ro),
          thresholds(ro, it.id, 1),
          http()
            .post('/api/inventories')
            .set(ro)
            .send({ date: daysAgo(1) }),
          http()
            .post('/api/stock-items')
            .set(ro)
            .send({ name: 'N', category: 'ALIMENT', unit: 'kg' }),
        ];
        expect((await Promise.all(attempts)).map((r) => r.status)).toEqual(
          Array(6).fill(403),
        );
      },
    );

    it('refuses a role with no stocks permission', async () => {
      const { headers: h } = await actor('COMPTABLE');
      await http().get('/api/stock').set(h).expect(403);
      await http().get('/api/stock/movements').set(h).expect(403);
      await http().get('/api/inventories').set(h).expect(403);
    });
  });

  describe('final fix wave: the ledger', () => {
    async function validatedCount(
      h: Headers,
      itemId: string,
      date: string,
      qty: number,
    ) {
      const session = (
        await http().post('/api/inventories').set(h).send({ date }).expect(201)
      ).body as Inventory;
      await http()
        .put(`/api/inventories/${session.id}/lines`)
        .set(h)
        .send({ lines: [{ itemId, countedQty: qty }] })
        .expect(200);
      await http()
        .post(`/api/inventories/${session.id}/validate`)
        .set(h)
        .expect(201);
    }

    it('a validated inventory closes the past: the reviewer repro through manual movements', async () => {
      const { headers: h } = await actor('DIRECTEUR_FERME');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 100, 10, daysAgo(20)); // lot 100 on D1
      const out = await exit(h, it.id, 10, daysAgo(15)).expect(201); // D5
      await validatedCount(h, it.id, daysAgo(10), 80); // D10: theoretical 90 → −10
      const locked = `Un inventaire validé le ${daysAgo(10)} verrouille les mouvements antérieurs de Aliment ponte`;
      const id = (out.body as Mv[])[0].id;
      const before = (await list(h)).items[0];

      for (const res of [
        await http()
          .patch(`/api/stock/movements/${id}`)
          .set(h)
          .send({ quantity: 20 }),
        await http().delete(`/api/stock/movements/${id}`).set(h),
        await entry409(h, it.id, 50, daysAgo(12)),
        await exit(h, it.id, 1, daysAgo(11)),
      ]) {
        expect(res.status).toBe(409);
        expect((res.body as Msg).message).toBe(locked);
      }
      expect((await list(h)).items[0]).toEqual(before);
      expect(before.quantity).toBe(80);

      // The count day, after the count, stays open: level = counted − quantity.
      await exit(h, it.id, 7, daysAgo(10)).expect(201);
      expect((await list(h)).items[0].quantity).toBe(73);
    });

    it('a count with no difference closes the past too; another article and another farm stay open', async () => {
      const { headers: h } = await actor('DIRECTEUR_FERME');
      const a = await item(h, 'A');
      const b = await item(h, 'B');
      await entry(h, a.id, 10, 5, daysAgo(20));
      await entry(h, b.id, 10, 5, daysAgo(20));
      await validatedCount(h, a.id, daysAgo(10), 10);
      expect(
        (await http().get('/api/stock/movements?type=AJUSTEMENT').set(h)).body,
      ).toMatchObject({ total: 0 });
      expect((await exit(h, a.id, 1, daysAgo(12))).status).toBe(409);
      await exit(h, b.id, 1, daysAgo(12)).expect(201);
      const other = (await actor('DIRECTEUR_FERME', [farmA, farmB], farmB))
        .headers;
      await entry(other, a.id, 5, 5, daysAgo(30));
      await exit(other, a.id, 1, daysAgo(12)).expect(201);
    });

    it('keeps an emptied lot but lists no lot that has no movement; a lot emptied by exits stays listed', async () => {
      const { headers: h } = await actor('DIRECTEUR_FERME');
      const it = await item(h, 'Vaccin', {
        category: 'VACCIN',
        unit: 'flacon',
      });
      const gone = await entry(h, it.id, 4, 100, daysAgo(10), {
        lotNumber: 'GONE',
      });
      const used = await entry(h, it.id, 3, 100, daysAgo(10), {
        lotNumber: 'USED',
      });
      await exit(h, it.id, 3, daysAgo(5), {
        stockBatchId: used.batchId,
      }).expect(201);
      await http().delete(`/api/stock/movements/${gone.id}`).set(h).expect(200);
      const detail = (
        await http().get(`/api/stock/${it.id}`).set(h).expect(200)
      ).body as { batches: { lotNumber: string; quantity: number }[] };
      expect(detail.batches.map((b) => [b.lotNumber, b.quantity])).toEqual([
        ['USED', 0],
      ]);
      expect(
        await prisma.stockBatch.count({ where: { stockItemId: it.id } }),
      ).toBe(2);
    });

    it('reads GET /stock and GET /stock/:id with a fixed number of queries whatever the history', async () => {
      const { headers: h } = await actor('DIRECTEUR_FERME');
      const it = await item(h, 'Aliment ponte');
      await entry(h, it.id, 1000, 10, daysAgo(40));
      const measure = async () => {
        const served = app.get(PrismaService);
        const counts = { n: 0 };
        const spies = (
          ['findMany', 'groupBy', 'count', 'findFirst', 'findUnique'] as const
        ).flatMap((method) =>
          [
            served.stockMovement,
            served.stockBatch,
            served.stockItem,
            served.farmStockItem,
            served.farm,
          ].map((delegate) => {
            const original = delegate[method].bind(delegate) as (
              ...a: unknown[]
            ) => unknown;
            return jest.spyOn(delegate, method as never).mockImplementation(((
              ...a: unknown[]
            ) => {
              counts.n += 1;
              return original(...a);
            }) as never);
          }),
        );
        try {
          await list(h);
          await http().get(`/api/stock/${it.id}`).set(h).expect(200);
        } finally {
          spies.forEach((spy) => spy.mockRestore());
        }
        return counts.n;
      };
      const small = await measure();
      for (let i = 0; i < 12; i++) {
        await exit(h, it.id, 1, daysAgo(30 - i)).expect(201);
      }
      expect(await measure()).toBe(small);
      expect((await list(h)).items[0].quantity).toBe(988);
    });

    it('an article cannot be retyped or deleted under a movement in flight: never a 500', async () => {
      const { headers: h } = await actor('DIRECTEUR_FERME');
      const codes: number[] = [];
      for (let round = 0; round < 5; round++) {
        const it = await item(h, `Race ${round}`);
        const [moved, changed, removed] = await Promise.all([
          entry409(h, it.id, 5, daysAgo(2)),
          http()
            .patch(`/api/stock-items/${it.id}`)
            .set(h)
            .send({ unit: 'sac' }),
          http().delete(`/api/stock-items/${it.id}`).set(h),
        ]);
        codes.push(moved.status, changed.status, removed.status);
        const movements = await prisma.stockMovement.count({
          where: { stockItemId: it.id },
        });
        const current = await prisma.stockItem.findUnique({
          where: { id: it.id },
        });
        if (current) {
          // Retyped only when no movement came in.
          expect(movements > 0 ? current.unit : 'kg').toBe('kg');
        } else {
          expect(movements).toBe(0);
        }
      }
      expect(codes.filter((c) => c >= 500)).toEqual([]);
    });
  });
});
