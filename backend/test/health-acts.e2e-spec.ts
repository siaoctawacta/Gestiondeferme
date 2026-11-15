import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import {
  createFarm,
  createOrganization,
  createUser,
  createTestApp,
  tokenFor,
} from './setup';

const plusDays = (n: number) => daysAgo(-n);

interface Act extends Id {
  date: string;
  doneDate: string | null;
  target: string;
  targetKind: string;
  type: string;
  productName: string | null;
  stockItemId: string | null;
  stockBatchId: string | null;
  dose: string | null;
  quantity: number | null;
  veterinarian: string | null;
  status: string;
  planId: string | null;
  withdrawalUntil: string | null;
  enteredDone: boolean;
}
interface Page<T> {
  items: T[];
  total: number;
  statusCounts?: Record<string, number>;
}
interface Detail {
  quantity: number;
  batches: { id: string; lotNumber: string | null; quantity: number }[];
  movements: {
    type: string;
    quantity: number;
    reason: string;
    sourceType: string | null;
    sourceId: string | null;
  }[];
}
interface Plan extends Id {
  name: string;
  species: string;
  type: string | null;
  items: {
    ageDays: number;
    productName: string;
    stockItemId: string | null;
    dose: string | null;
  }[];
}

describe('Health acts, vaccination plans and biosecurity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  let lotId: string;
  let lotCode: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    h = await world.actor('DIRECTEUR_FERME');
    const lot = await world.lot(h);
    lotId = lot.id;
    lotCode = lot.code;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();

  const item = (name: string, category = 'VACCIN', unit = 'flacon') =>
    world.post<Id>(h, '/stock-items', { name, category, unit });

  const entry = (
    itemId: string,
    quantity: number,
    over: Record<string, unknown> = {},
  ) =>
    world.post(h, '/stock/movements', {
      itemId,
      type: 'ENTREE',
      date: daysAgo(40),
      quantity,
      unitCost: 1000,
      reason: 'ACHAT',
      ...over,
    });

  const detail = async (itemId: string) =>
    (await http().get(`/api/stock/${itemId}`).set(h).expect(200))
      .body as Detail;

  const act = (over: Record<string, unknown> = {}, status = 201, who = h) =>
    world.post<Act>(
      who,
      '/health-acts',
      {
        type: 'VACCINATION',
        status: 'PLANIFIE',
        batchId: lotId,
        date: plusDays(2),
        productName: 'Gumboro',
        ...over,
      },
      status,
    );

  const done = (over: Record<string, unknown> = {}, status = 201) =>
    act({ status: 'REALISE', date: daysAgo(1), ...over }, status);

  const list = async (query: Record<string, string> = {}, who = h) =>
    (await http().get('/api/health-acts').query(query).set(who).expect(200))
      .body as Page<Act>;

  const complete = (id: string, body: object, status = 200) =>
    http()
      .post(`/api/health-acts/${id}/complete`)
      .set(h)
      .send(body)
      .expect(status);

  const message = (res: { body: unknown }) => (res.body as Msg).message;

  /** Sells the whole lot, then closes it. */
  async function closeLot(id: string) {
    await world.post(h, `/batches/${id}/events`, {
      type: 'VENTE',
      date: daysAgo(1),
      quantity: 100,
    });
    await http().post(`/api/batches/${id}/close`).set(h).expect(200);
  }

  /** A vaccine article holding 12 flacons in one lot. */
  async function stocked(name = 'Gumboro', over: Record<string, unknown> = {}) {
    const it = await item(name);
    await entry(it.id, 12, {
      lotNumber: 'L1',
      expiryDate: '2030-01-01',
      ...over,
    });
    return it;
  }

  describe('acts and their derived status', () => {
    it('plans a vaccination in 2 days as PLANIFIE and reproduces a reference row', async () => {
      const a = await act({
        date: plusDays(2),
        dose: '1 goutte',
        veterinarian: 'Dr Koffi',
      });
      expect(a).toMatchObject({
        date: plusDays(2),
        doneDate: null,
        target: lotCode,
        targetKind: 'LOT',
        type: 'VACCINATION',
        productName: 'Gumboro',
        dose: '1 goutte',
        veterinarian: 'Dr Koffi',
        status: 'PLANIFIE',
        withdrawalUntil: null,
        enteredDone: false,
      });
      const row = (await list()).items[0];
      expect(row).toMatchObject({
        id: a.id,
        date: plusDays(2),
        target: lotCode,
        status: 'PLANIFIE',
        enteredDone: false,
      });
    });

    it('exposes enteredDone: true for an act entered as done, false once completed from a plan, on the row and the response', async () => {
      const entered = await done();
      expect(entered.enteredDone).toBe(true);
      const planned = await act({ date: plusDays(1) });
      expect(planned.enteredDone).toBe(false);
      await complete(planned.id, { doneDate: daysAgo(0) });
      const rows = (await list()).items;
      expect(rows.find((r) => r.id === entered.id)?.enteredDone).toBe(true);
      const completed = rows.find((r) => r.id === planned.id);
      expect(completed).toMatchObject({
        status: 'REALISE',
        enteredDone: false,
      });
    });

    it('derives EN_RETARD for a planned act dated yesterday, in the list, the filter and the counts', async () => {
      await act({ date: plusDays(2) });
      const late = await act({ date: daysAgo(1) });
      const page = await list();
      expect(page.items.find((r) => r.id === late.id)?.status).toBe(
        'EN_RETARD',
      );
      expect(page.statusCounts).toEqual({
        PLANIFIE: 1,
        REALISE: 0,
        EN_RETARD: 1,
        ANNULE: 0,
      });
      expect(
        (await list({ status: 'EN_RETARD' })).items.map((r) => r.id),
      ).toEqual([late.id]);
      expect((await list({ status: 'PLANIFIE' })).items).toHaveLength(1);
      await http()
        .get('/api/health-acts')
        .query({ status: 'BOF' })
        .set(h)
        .expect(400);
    });

    it('filters by type, lot and dates, and searches', async () => {
      const pig = await world.pigLot(h);
      await act({ date: daysAgo(5) });
      await act({
        type: 'TRAITEMENT',
        batchId: pig.id,
        productName: 'Amox',
        date: daysAgo(3),
      });
      expect((await list({ type: 'TRAITEMENT' })).items).toHaveLength(1);
      expect((await list({ batchId: lotId })).items).toHaveLength(1);
      expect((await list({ from: daysAgo(4) })).items).toHaveLength(1);
      expect((await list({ to: daysAgo(4) })).items).toHaveLength(1);
      expect((await list({ search: 'amox' })).items).toHaveLength(1);
    });

    it('refuses a bad target, a future done act and a date before the lot entered', async () => {
      const bld = world.poultryBld;
      await act({ batchId: undefined }, 400);
      await act({ buildingId: bld }, 400);
      await act({ type: 'DESINFECTION', batchId: lotId }, 400);
      await act({ type: 'DESINFECTION', batchId: undefined, buildingId: bld });
      await done({ date: plusDays(1) }, 400);
      await act({ date: daysAgo(31) }, 400);
      await act({ batchId: 'inconnu' }, 400);
    });

    it('creates a disinfection on a building without any lot', async () => {
      const a = await act({
        type: 'DESINFECTION',
        batchId: undefined,
        buildingId: world.poultryBld,
        productName: 'Virkon',
        date: daysAgo(1),
        status: 'REALISE',
      });
      expect(a).toMatchObject({
        target: 'Poulailler',
        targetKind: 'BATIMENT',
        status: 'REALISE',
        doneDate: daysAgo(1),
      });
    });

    it('edits a planned act, completes it, and refuses to edit a cancelled one', async () => {
      const a = await act();
      const edited = await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ dose: '2 gouttes', date: plusDays(3), veterinarian: 'Dr Aka' })
        .expect(200);
      expect(edited.body).toMatchObject({
        dose: '2 gouttes',
        date: plusDays(3),
        veterinarian: 'Dr Aka',
      });
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ batchId: lotId })
        .expect(400);
      const completed = await complete(a.id, { doneDate: daysAgo(1) });
      expect(completed.body).toMatchObject({
        status: 'REALISE',
        doneDate: daysAgo(1),
        date: plusDays(3),
      });
      await complete(a.id, { doneDate: daysAgo(1) }, 409);
      const cancelled = await http()
        .post(`/api/health-acts/${a.id}/cancel`)
        .set(h)
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'ANNULE',
        doneDate: null,
      });
      await http().post(`/api/health-acts/${a.id}/cancel`).set(h).expect(409);
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ dose: 'x' })
        .expect(409);
      await complete(a.id, { doneDate: daysAgo(1) }, 409);
      await http().delete(`/api/health-acts/${a.id}`).set(h).expect(200);
      expect((await list()).items).toHaveLength(0);
    });

    it('refuses to complete in the future or before the lot entered', async () => {
      const a = await act();
      await complete(a.id, { doneDate: plusDays(1) }, 400);
      await complete(a.id, { doneDate: daysAgo(40) }, 400);
      await complete(a.id, {}, 400);
    });
  });

  describe('stock consumption', () => {
    it('completing with 2 flacons from a batch makes it REALISE and takes the stock from 12 to 10', async () => {
      const it = await stocked();
      const a = await act({
        stockItemId: it.id,
        productName: undefined,
        date: daysAgo(1),
      });
      expect(a.productName).toBe('Gumboro');
      expect((await detail(it.id)).quantity).toBe(12);
      const batch = (await detail(it.id)).batches[0].id;
      const res = await complete(a.id, {
        doneDate: daysAgo(1),
        quantity: 2,
        stockBatchId: batch,
      });
      expect(res.body).toMatchObject({
        status: 'REALISE',
        quantity: 2,
        stockBatchId: batch,
      });
      const d = await detail(it.id);
      expect(d.quantity).toBe(10);
      const exit = d.movements.find((m) => m.type === 'SORTIE');
      expect(exit).toMatchObject({
        quantity: -2,
        reason: 'TRAITEMENT',
        sourceType: 'HEALTH_ACT',
        sourceId: a.id,
      });
    });

    it('consumes FEFO when no batch is given, at creation of a done act', async () => {
      const it = await stocked();
      await entry(it.id, 5, { lotNumber: 'L0', expiryDate: '2029-01-01' });
      await done({ stockItemId: it.id, quantity: 6, productName: undefined });
      const d = await detail(it.id);
      expect(d.quantity).toBe(11);
      expect(d.batches.find((b) => b.lotNumber === 'L0')?.quantity).toBe(0);
    });

    it('refuses an expired batch and keeps the act planned', async () => {
      const it = await item('Périmé');
      await entry(it.id, 5, { lotNumber: 'OLD', expiryDate: daysAgo(10) });
      const batch = (await detail(it.id)).batches[0].id;
      const a = await act({ stockItemId: it.id, date: daysAgo(1) });
      const res = await complete(
        a.id,
        { doneDate: daysAgo(0), quantity: 1, stockBatchId: batch },
        400,
      );
      expect(message(res)).toBe('Lot périmé');
      expect((await list()).items[0].status).toBe('EN_RETARD');
      expect((await detail(it.id)).quantity).toBe(5);
    });

    it('refuses a feed article as product', async () => {
      const feed = await item('Maïs', 'ALIMENT', 'kg');
      const bad = await http()
        .post('/api/health-acts')
        .set(h)
        .send({
          type: 'TRAITEMENT',
          status: 'PLANIFIE',
          batchId: lotId,
          date: plusDays(1),
          stockItemId: feed.id,
        })
        .expect(400);
      expect(message(bad)).toBe("Ce produit n'est pas un produit vétérinaire");
    });

    it('refuses more than available and writes nothing', async () => {
      const it = await stocked();
      const res = await http()
        .post('/api/health-acts')
        .set(h)
        .send({
          type: 'VACCINATION',
          status: 'REALISE',
          batchId: lotId,
          date: daysAgo(1),
          stockItemId: it.id,
          quantity: 13,
        })
        .expect(400);
      expect(message(res)).toEqual(
        expect.stringContaining('Stock insuffisant'),
      );
      expect((await list()).items).toHaveLength(0);
      expect((await detail(it.id)).quantity).toBe(12);
    });

    it('refuses a quantity without a product, a batch of another article and a planned batch', async () => {
      const it = await stocked();
      const other = await stocked('Autre');
      await act({ quantity: 1 }, 400);
      await done(
        {
          stockItemId: it.id,
          quantity: 1,
          stockBatchId: (await detail(other.id)).batches[0].id,
        },
        400,
      );
      await act(
        {
          stockItemId: it.id,
          stockBatchId: (await detail(it.id)).batches[0].id,
        },
        400,
      );
      await done(
        {
          stockItemId: it.id,
          stockBatchId: (await detail(it.id)).batches[0].id,
        },
        400,
      );
    });

    it('restores the stock when the done act is deleted or cancelled', async () => {
      const it = await stocked();
      const a = await done({
        stockItemId: it.id,
        quantity: 2,
        productName: undefined,
      });
      expect((await detail(it.id)).quantity).toBe(10);
      await http().delete(`/api/health-acts/${a.id}`).set(h).expect(200);
      expect((await detail(it.id)).quantity).toBe(12);
      const b = await done({
        stockItemId: it.id,
        quantity: 3,
        productName: undefined,
      });
      expect((await detail(it.id)).quantity).toBe(9);
      await http().post(`/api/health-acts/${b.id}/cancel`).set(h).expect(200);
      const d = await detail(it.id);
      expect(d.quantity).toBe(12);
      expect(
        d.movements.filter((m) => m.sourceType === 'HEALTH_ACT'),
      ).toHaveLength(0);
    });

    it('re-books the exit when a done act is edited, and refuses an edit the stock cannot cover', async () => {
      const it = await stocked();
      const a = await done({
        stockItemId: it.id,
        quantity: 2,
        productName: undefined,
      });
      const up = await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ quantity: 5 })
        .expect(200);
      expect(up.body).toMatchObject({ quantity: 5 });
      expect((await detail(it.id)).quantity).toBe(7);
      const bad = await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ quantity: 50 })
        .expect(400);
      expect(message(bad)).toEqual(
        expect.stringContaining('Stock insuffisant'),
      );
      expect((await detail(it.id)).quantity).toBe(7);
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ quantity: null })
        .expect(200);
      expect((await detail(it.id)).quantity).toBe(12);
      const other = await stocked('Autre');
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ stockItemId: other.id })
        .expect(400);
    });

    it('moves the exit with the done date', async () => {
      const it = await stocked();
      const a = await done({
        stockItemId: it.id,
        quantity: 2,
        productName: undefined,
        date: daysAgo(3),
      });
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ date: daysAgo(5) })
        .expect(200);
      const rows = (
        await http()
          .get('/api/stock/movements')
          .query({ itemId: it.id })
          .set(h)
          .expect(200)
      ).body as Page<{ date: string; sourceType: string | null }>;
      expect(rows.items.find((m) => m.sourceType === 'HEALTH_ACT')?.date).toBe(
        daysAgo(5),
      );
    });

    it('lets a free-text planned act pick a stock item at completion, and refuses a different one when it has one', async () => {
      const it = await stocked();
      const other = await stocked('Autre');
      const a = await act({ date: daysAgo(1) });
      expect(a.stockItemId).toBeNull();
      const res = await complete(a.id, {
        doneDate: daysAgo(0),
        stockItemId: it.id,
        quantity: 1,
      });
      expect(res.body).toMatchObject({ stockItemId: it.id, quantity: 1 });
      expect((await detail(it.id)).quantity).toBe(11);
      const b = await act({
        stockItemId: it.id,
        date: daysAgo(1),
        productName: undefined,
      });
      const bad = await complete(
        b.id,
        { doneDate: daysAgo(0), stockItemId: other.id, quantity: 1 },
        400,
      );
      expect(message(bad)).toBe(
        "Le produit de l'intervention ne peut pas être changé",
      );
      await complete(b.id, {
        doneDate: daysAgo(0),
        stockItemId: it.id,
        quantity: 1,
      });
      expect((await detail(it.id)).quantity).toBe(10);
    });

    it('a planned act consumes nothing', async () => {
      const it = await stocked();
      await act({
        stockItemId: it.id,
        quantity: 3,
        date: plusDays(1),
        productName: undefined,
      });
      expect((await detail(it.id)).quantity).toBe(12);
    });

    it('lets a role with sante rights but no stocks rights consume stock implicitly', async () => {
      const it = await stocked();
      const agent = await world.actor('AGENT_ELEVAGE');
      const a = await act(
        {
          status: 'REALISE',
          date: daysAgo(1),
          stockItemId: it.id,
          quantity: 1,
          productName: undefined,
        },
        201,
        agent,
      );
      expect(a.status).toBe('REALISE');
      expect((await detail(it.id)).quantity).toBe(11);
    });

    it('serialises two simultaneous completions of the same act', async () => {
      const it = await stocked();
      const a = await act({
        stockItemId: it.id,
        date: daysAgo(1),
        quantity: 2,
        productName: undefined,
      });
      const calls = await Promise.all(
        [1, 2].map(() =>
          http()
            .post(`/api/health-acts/${a.id}/complete`)
            .set(h)
            .send({ doneDate: daysAgo(0), quantity: 2 }),
        ),
      );
      expect(calls.map((c) => c.status).sort()).toEqual([200, 409]);
      expect((await detail(it.id)).quantity).toBe(10);
    });
  });

  describe('withdrawal period', () => {
    it('exposes withdrawalUntil = doneDate + duration + withdrawal on the lot and the animal', async () => {
      const t = await done({
        type: 'TRAITEMENT',
        productName: 'Amox',
        date: daysAgo(0),
        durationDays: 5,
        withdrawalDays: 7,
      });
      expect(t.withdrawalUntil).toBe(plusDays(12));
      const lot = (await http().get(`/api/batches/${lotId}`).set(h).expect(200))
        .body as { withdrawalUntil: string | null };
      expect(lot.withdrawalUntil).toBe(plusDays(12));
      await done({
        type: 'TRAITEMENT',
        productName: 'Autre',
        date: daysAgo(3),
        durationDays: 1,
        withdrawalDays: 1,
      });
      const again = (
        await http().get(`/api/batches/${lotId}`).set(h).expect(200)
      ).body as { withdrawalUntil: string | null };
      expect(again.withdrawalUntil).toBe(plusDays(12));

      const sow = await world.animal(h);
      const clean = (
        await http().get(`/api/animals/${sow.id}`).set(h).expect(200)
      ).body as { withdrawalUntil: string | null };
      expect(clean.withdrawalUntil).toBeNull();
      await done({
        type: 'TRAITEMENT',
        batchId: undefined,
        animalId: sow.id,
        date: daysAgo(1),
        withdrawalDays: 2,
      });
      const treated = (
        await http().get(`/api/animals/${sow.id}`).set(h).expect(200)
      ).body as { withdrawalUntil: string | null };
      expect(treated.withdrawalUntil).toBe(plusDays(1));
    });

    it('ignores planned and cancelled acts, and follows the act when it is edited or cancelled', async () => {
      await act({
        type: 'TRAITEMENT',
        date: plusDays(1),
        durationDays: 5,
        withdrawalDays: 7,
      });
      const get = async () =>
        (
          (await http().get(`/api/batches/${lotId}`).set(h).expect(200))
            .body as {
            withdrawalUntil: string | null;
          }
        ).withdrawalUntil;
      expect(await get()).toBeNull();
      const t = await done({
        type: 'TRAITEMENT',
        date: daysAgo(2),
        durationDays: 1,
        withdrawalDays: 3,
      });
      expect(await get()).toBe(daysAgo(-2));
      await http()
        .patch(`/api/health-acts/${t.id}`)
        .set(h)
        .send({ withdrawalDays: 10 })
        .expect(200);
      expect(await get()).toBe(plusDays(9));
      await http().post(`/api/health-acts/${t.id}/cancel`).set(h).expect(200);
      expect(await get()).toBeNull();
    });
  });

  describe('permissions and farms', () => {
    it('RESP_AVICOLE cannot act on a pig lot or animal, VETERINAIRE can on both species', async () => {
      const pig = await world.pigLot(h);
      const sow = await world.animal(h);
      const avicole = await world.actor('RESP_AVICOLE');
      await act({ batchId: pig.id }, 403, avicole);
      await act({ batchId: undefined, animalId: sow.id }, 403, avicole);
      await act({}, 201, avicole);
      const vet = await world.actor('VETERINAIRE');
      await act({ batchId: pig.id }, 201, vet);
      await act({ batchId: undefined, animalId: sow.id }, 201, vet);
      await act({}, 201, vet);
      const porcin = await world.actor('RESP_PORCIN');
      await act({}, 403, porcin);
      const seen = await list({}, avicole);
      expect(
        seen.items.every((r) => r.targetKind === 'LOT' && r.target === lotCode),
      ).toBe(true);
      expect(seen.items.length).toBeGreaterThan(0);
    });

    it('needs sante rights: read for lists, create for the daily routes', async () => {
      const auditeur = await world.actor('AUDITEUR');
      await http().get('/api/health-acts').set(auditeur).expect(200);
      await act({}, 403, auditeur);
      const a = await act();
      await http().delete(`/api/health-acts/${a.id}`).set(auditeur).expect(403);
      await http()
        .post(`/api/health-acts/${a.id}/cancel`)
        .set(auditeur)
        .expect(403);
      const stock = await world.actor('RESP_STOCK');
      await http().get('/api/health-acts').set(stock).expect(403);
    });

    it('reads under all farms but refuses every farm-scoped write', async () => {
      const a = await act();
      const admin = await world.actor('SUPER_ADMIN');
      const all = { ...admin, 'X-Farm-Id': 'all' };
      expect((await list({}, all)).items).toHaveLength(1);
      await act({}, 403, all);
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(all)
        .send({ dose: 'x' })
        .expect(403);
      await http().delete(`/api/health-acts/${a.id}`).set(all).expect(403);
      await http()
        .post(`/api/health-acts/${a.id}/complete`)
        .set(all)
        .send({ doneDate: daysAgo(0) })
        .expect(403);
      await http()
        .post('/api/quarantines')
        .set(all)
        .send({ batchId: lotId, startDate: daysAgo(1), reason: 'x' })
        .expect(403);
      await http()
        .post('/api/incidents')
        .set(all)
        .send({ date: daysAgo(1), title: 'x', severity: 'FAIBLE' })
        .expect(403);
      await http()
        .post('/api/biosecurity-logs')
        .set(all)
        .send({ date: daysAgo(1), type: 'NETTOYAGE' })
        .expect(403);
    });

    it("answers 404 for another farm's records and 400 for a foreign id in a body", async () => {
      const a = await act();
      const farmB = await createFarm(world.orgId, 'Ferme B');
      const userB = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [farmB.id],
      });
      const b: Headers = {
        Authorization: `Bearer ${await tokenFor(userB.id)}`,
        'X-Farm-Id': farmB.id,
      };
      expect((await list({}, b)).items).toHaveLength(0);
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(b)
        .send({ dose: 'x' })
        .expect(404);
      await http().delete(`/api/health-acts/${a.id}`).set(b).expect(404);
      await http()
        .post(`/api/health-acts/${a.id}/complete`)
        .set(b)
        .send({ doneDate: daysAgo(0) })
        .expect(404);
      await http().post(`/api/health-acts/${a.id}/cancel`).set(b).expect(404);
      await act({}, 400, b);
      const q = await world.post<Id>(h, '/quarantines', {
        batchId: lotId,
        startDate: daysAgo(1),
        reason: 'toux',
      });
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(b)
        .send({ date: daysAgo(0) })
        .expect(404);
      await http()
        .post('/api/biosecurity-logs')
        .set(b)
        .send({
          date: daysAgo(1),
          type: 'NETTOYAGE',
          buildingId: world.poultryBld,
        })
        .expect(400);
    });

    it('refuses a stock article of another organisation', async () => {
      const other = await createOrganization('Autre org');
      const foreign = await prisma.stockItem.create({
        data: {
          organizationId: other.id,
          name: 'Étranger',
          category: 'VACCIN',
          unit: 'dose',
        },
      });
      await act({ stockItemId: foreign.id }, 400);
      await http()
        .post('/api/vaccination-plans')
        .set(h)
        .send({
          name: 'P',
          species: 'AVICOLE',
          items: [{ ageDays: 1, productName: 'x', stockItemId: foreign.id }],
        })
        .expect(400);
    });
  });

  describe('vaccination plans', () => {
    const plan = (over: Record<string, unknown> = {}, status = 201, who = h) =>
      world.post<Plan>(
        who,
        '/vaccination-plans',
        {
          name: 'Chair standard',
          species: 'AVICOLE',
          type: 'CHAIR',
          items: [
            { ageDays: 14, productName: 'Gumboro', dose: '1 goutte' },
            { ageDays: 1, productName: 'Newcastle' },
            { ageDays: 7, productName: 'Bronchite' },
          ],
          ...over,
        },
        status,
      );
    const apply = (id: string, body: object, status = 201, who = h) =>
      http()
        .post(`/api/vaccination-plans/${id}/apply`)
        .set(who)
        .send(body)
        .expect(status);

    it('creates, lists, edits and deletes a plan (master data, items ordered by age)', async () => {
      const p = await plan();
      expect(p.items.map((i) => i.ageDays)).toEqual([1, 7, 14]);
      const page = (
        await http().get('/api/vaccination-plans').set(h).expect(200)
      ).body as Page<Plan>;
      expect(page.items).toHaveLength(1);
      expect(page.items[0].items).toHaveLength(3);
      await plan({}, 409);
      await plan({ name: 'Mauvais', type: 'PORCELET' }, 400);
      await plan({ name: 'Vide', items: [] }, 400);
      await plan(
        { name: 'Neg', items: [{ ageDays: -1, productName: 'x' }] },
        400,
      );
      const upd = await http()
        .patch(`/api/vaccination-plans/${p.id}`)
        .set(h)
        .send({
          name: 'Chair 2',
          items: [{ ageDays: 3, productName: 'Marek' }],
        })
        .expect(200);
      expect((upd.body as Plan).items).toEqual([
        expect.objectContaining({ ageDays: 3, productName: 'Marek' }),
      ]);
      await http().delete(`/api/vaccination-plans/${p.id}`).set(h).expect(200);
      expect(
        (
          (await http().get('/api/vaccination-plans').set(h).expect(200))
            .body as Page<Plan>
        ).items,
      ).toHaveLength(0);
    });

    it('needs update on sante for master data, and is writable under all farms', async () => {
      const admin = await world.actor('SUPER_ADMIN');
      const agent = await world.actor('AGENT_ELEVAGE');
      await plan({}, 403, agent);
      await http().get('/api/vaccination-plans').set(agent).expect(200);
      const all = { ...admin, 'X-Farm-Id': 'all' };
      const p = await plan({}, 201, all);
      const seen = (
        await http().get('/api/vaccination-plans').set(all).expect(200)
      ).body as Page<Plan>;
      expect(seen.items.map((x) => x.id)).toEqual([p.id]);
      await apply(p.id, { batchId: lotId }, 403, all);
      await apply(p.id, { batchId: lotId }, 403, agent);
    });

    it('stores a vaccine stock article on a step and copies it to the generated acts', async () => {
      const it = await item('Gumboro');
      const feed = await item('Maïs', 'ALIMENT', 'kg');
      await plan(
        {
          name: 'Mauvais',
          items: [{ ageDays: 1, productName: 'x', stockItemId: feed.id }],
        },
        400,
      );
      const p = await plan({
        items: [{ ageDays: 1, productName: 'Gumboro', stockItemId: it.id }],
      });
      expect(p.items[0].stockItemId).toBe(it.id);
      await apply(p.id, { batchId: lotId });
      const acts = (await list()).items;
      expect(acts).toHaveLength(1);
      expect(acts[0]).toMatchObject({
        stockItemId: it.id,
        productName: 'Gumboro',
      });
      await http().delete(`/api/stock-items/${it.id}`).set(h).expect(409);
    });

    it('applies a plan to a lot entered 3 days ago: acts at entry + age, none done, twice is a 409', async () => {
      const lot = await world.lot(h, { entryDate: daysAgo(3) });
      const p = await plan();
      const res = await apply(p.id, { batchId: lot.id });
      expect((res.body as Act[]).length).toBe(3);
      const acts = (await list({ batchId: lot.id })).items;
      expect(
        acts.map((a) => [a.date, a.productName, a.status, a.planId]),
      ).toEqual([
        [plusDays(11), 'Gumboro', 'PLANIFIE', p.id],
        [plusDays(4), 'Bronchite', 'PLANIFIE', p.id],
        [daysAgo(2), 'Newcastle', 'EN_RETARD', p.id],
      ]);
      expect(
        acts.every((a) => a.type === 'VACCINATION' && a.doneDate === null),
      ).toBe(true);
      const again = await apply(p.id, { batchId: lot.id }, 409);
      expect(message(again)).toBe('Ce plan a déjà été appliqué à ce lot');
      expect((await list({ batchId: lot.id })).items).toHaveLength(3);
      await http().delete(`/api/vaccination-plans/${p.id}`).set(h).expect(409);
      await http()
        .patch(`/api/vaccination-plans/${p.id}`)
        .set(h)
        .send({ name: 'Renommé' })
        .expect(200);
    });

    it('refuses a lot of another species or type, a closed lot and an unknown lot', async () => {
      const p = await plan();
      const pig = await world.pigLot(h);
      await apply(p.id, { batchId: pig.id }, 400);
      const layer = await world.lot(h, { type: 'PONDEUSE' });
      await apply(p.id, { batchId: layer.id }, 400);
      await apply(p.id, { batchId: 'inconnu' }, 400);
      await apply(p.id, {}, 400);
      await closeLot(lotId);
      await apply(p.id, { batchId: lotId }, 409);
      await http()
        .post('/api/vaccination-plans/inconnu/apply')
        .set(h)
        .send({ batchId: layer.id })
        .expect(404);
    });

    it('applies two different plans to the same lot, and the same plan to two lots', async () => {
      const p = await plan();
      const q = await plan({
        name: 'Autre',
        items: [{ ageDays: 2, productName: 'Marek' }],
      });
      const lot2 = await world.lot(h);
      await apply(p.id, { batchId: lotId });
      await apply(q.id, { batchId: lotId });
      await apply(p.id, { batchId: lot2.id });
      expect((await list()).items).toHaveLength(7);
    });
  });

  describe('quarantines', () => {
    it('creates, edits, lifts and deletes a quarantine', async () => {
      const q = await world.post<{
        id: string;
        status: string;
        target: string;
      }>(h, '/quarantines', {
        batchId: lotId,
        startDate: daysAgo(2),
        reason: 'Toux',
      });
      expect(q).toMatchObject({ status: 'EN_COURS', target: lotCode });
      const page = (
        await http()
          .get('/api/quarantines')
          .query({ status: 'EN_COURS' })
          .set(h)
          .expect(200)
      ).body as Page<{ id: string }>;
      expect(page.items.map((r) => r.id)).toEqual([q.id]);
      await http()
        .patch(`/api/quarantines/${q.id}`)
        .set(h)
        .send({ reason: 'Toux grasse', endDate: plusDays(5) })
        .expect(200);
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(h)
        .send({ date: daysAgo(3) })
        .expect(400);
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(h)
        .send({ date: plusDays(1) })
        .expect(400);
      const lifted = await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(h)
        .send({ date: daysAgo(0) })
        .expect(200);
      expect(lifted.body).toMatchObject({
        status: 'LEVEE',
        endDate: daysAgo(0),
      });
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(h)
        .send({ date: daysAgo(0) })
        .expect(409);
      await http()
        .patch(`/api/quarantines/${q.id}`)
        .set(h)
        .send({ reason: 'x' })
        .expect(409);
      await http().delete(`/api/quarantines/${q.id}`).set(h).expect(200);
    });

    it('targets exactly one lot or animal, and lifting needs the daily right only', async () => {
      const sow = await world.animal(h);
      await http()
        .post('/api/quarantines')
        .set(h)
        .send({ startDate: daysAgo(1), reason: 'x' })
        .expect(400);
      await http()
        .post('/api/quarantines')
        .set(h)
        .send({
          batchId: lotId,
          animalId: sow.id,
          startDate: daysAgo(1),
          reason: 'x',
        })
        .expect(400);
      await http()
        .post('/api/quarantines')
        .set(h)
        .send({
          buildingId: world.poultryBld,
          startDate: daysAgo(1),
          reason: 'x',
        })
        .expect(400);
      const q = await world.post<Id>(h, '/quarantines', {
        animalId: sow.id,
        startDate: daysAgo(1),
        reason: 'Boiterie',
      });
      const agent = await world.actor('AGENT_ELEVAGE');
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(agent)
        .send({ date: daysAgo(0) })
        .expect(200);
      const avicole = await world.actor('RESP_AVICOLE');
      await world.post(avicole, '/quarantines', {
        batchId: lotId,
        startDate: daysAgo(1),
        reason: 'x',
      });
      await http()
        .post('/api/quarantines')
        .set(avicole)
        .send({ animalId: sow.id, startDate: daysAgo(1), reason: 'x' })
        .expect(403);
    });

    it('can still be lifted after the lot is closed', async () => {
      const q = await world.post<Id>(h, '/quarantines', {
        batchId: lotId,
        startDate: daysAgo(1),
        reason: 'x',
      });
      await closeLot(lotId);
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(h)
        .send({ date: daysAgo(0) })
        .expect(200);
    });
  });

  describe('incidents', () => {
    it('creates, edits, closes and deletes an incident', async () => {
      const i = await world.post<{
        id: string;
        status: string;
        target: string | null;
      }>(h, '/incidents', {
        date: daysAgo(1),
        title: 'Mortalité anormale',
        severity: 'GRAVE',
        batchId: lotId,
      });
      expect(i).toMatchObject({ status: 'OUVERT', target: lotCode });
      const noTarget = await world.post<{ target: string | null }>(
        h,
        '/incidents',
        { date: daysAgo(1), title: 'Panne', severity: 'FAIBLE' },
      );
      expect(noTarget.target).toBeNull();
      const byBuilding = await world.post<{ target: string | null }>(
        h,
        '/incidents',
        {
          date: daysAgo(1),
          title: 'Fuite',
          severity: 'MOYENNE',
          buildingId: world.pigBld,
        },
      );
      expect(byBuilding.target).toBe('Porcherie');
      const graves = (
        await http()
          .get('/api/incidents')
          .query({ severity: 'GRAVE' })
          .set(h)
          .expect(200)
      ).body as Page<{ id: string }>;
      expect(graves.items.map((r) => r.id)).toEqual([i.id]);
      expect(
        (
          (
            await http()
              .get('/api/incidents')
              .query({ status: 'OUVERT' })
              .set(h)
              .expect(200)
          ).body as Page<Id>
        ).total,
      ).toBe(3);
      await http()
        .patch(`/api/incidents/${i.id}`)
        .set(h)
        .send({ description: 'Détails', severity: 'MOYENNE' })
        .expect(200);
      const closed = await http()
        .post(`/api/incidents/${i.id}/close`)
        .set(h)
        .expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOS' });
      await http().post(`/api/incidents/${i.id}/close`).set(h).expect(409);
      await http()
        .patch(`/api/incidents/${i.id}`)
        .set(h)
        .send({ title: 'x' })
        .expect(409);
      await http().delete(`/api/incidents/${i.id}`).set(h).expect(200);
      await world.post(
        h,
        '/incidents',
        { date: plusDays(1), title: 'Futur', severity: 'FAIBLE' },
        400,
      );
    });
  });

  describe('biosecurity logs', () => {
    it('creates, filters, edits and deletes a log', async () => {
      const l = await world.post<{ id: string; buildingName: string | null }>(
        h,
        '/biosecurity-logs',
        {
          date: daysAgo(1),
          type: 'DESINFECTION',
          buildingId: world.poultryBld,
          productName: 'Virkon',
        },
      );
      expect(l.buildingName).toBe('Poulailler');
      await world.post(h, '/biosecurity-logs', {
        date: daysAgo(1),
        type: 'VISITEUR',
        visitorName: 'M. Diallo',
      });
      const visitors = (
        await http()
          .get('/api/biosecurity-logs')
          .query({ type: 'VISITEUR' })
          .set(h)
          .expect(200)
      ).body as Page<{ visitorName: string }>;
      expect(visitors.items.map((r) => r.visitorName)).toEqual(['M. Diallo']);
      expect(
        (
          (
            await http()
              .get('/api/biosecurity-logs')
              .query({ buildingId: world.poultryBld })
              .set(h)
              .expect(200)
          ).body as Page<Id>
        ).total,
      ).toBe(1);
      await http()
        .patch(`/api/biosecurity-logs/${l.id}`)
        .set(h)
        .send({ note: 'ok', productName: null })
        .expect(200);
      await http().delete(`/api/biosecurity-logs/${l.id}`).set(h).expect(200);
      await world.post(
        h,
        '/biosecurity-logs',
        { date: plusDays(1), type: 'NETTOYAGE' },
        400,
      );
      await world.post(
        h,
        '/biosecurity-logs',
        { date: daysAgo(1), type: 'NETTOYAGE', buildingId: 'inconnu' },
        400,
      );
    });
  });

  describe('audit and export', () => {
    it('writes exactly one audit row per create, update and delete, in the same transaction', async () => {
      const it = await stocked();
      const a = await done({
        stockItemId: it.id,
        quantity: 2,
        productName: undefined,
      });
      await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ quantity: 3 })
        .expect(200);
      await http().delete(`/api/health-acts/${a.id}`).set(h).expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'sante', recordId: a.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
      // A refused write leaves no row behind.
      const before = await prisma.auditLog.count({
        where: { module: 'sante' },
      });
      await http()
        .post('/api/health-acts')
        .set(h)
        .send({
          type: 'VACCINATION',
          status: 'REALISE',
          batchId: lotId,
          date: daysAgo(1),
          stockItemId: it.id,
          quantity: 99,
        })
        .expect(400);
      expect(await prisma.auditLog.count({ where: { module: 'sante' } })).toBe(
        before,
      );
      const plan = await world.post<Plan>(h, '/vaccination-plans', {
        name: 'P',
        species: 'AVICOLE',
        items: [{ ageDays: 1, productName: 'x' }],
      });
      const q = await world.post<Id>(h, '/quarantines', {
        batchId: lotId,
        startDate: daysAgo(1),
        reason: 'x',
      });
      await http()
        .post(`/api/quarantines/${q.id}/lift`)
        .set(h)
        .send({ date: daysAgo(0) })
        .expect(200);
      expect(
        (await prisma.auditLog.findMany({ where: { recordId: q.id } })).map(
          (r) => r.action,
        ),
      ).toEqual(['CREATE', 'UPDATE']);
      expect(
        await prisma.auditLog.count({
          where: { recordId: plan.id, action: 'CREATE' },
        }),
      ).toBe(1);
    });

    it('exports the acts as CSV with the reference columns', async () => {
      await act({
        date: plusDays(2),
        dose: '1 goutte',
        veterinarian: 'Dr Koffi',
      });
      const res = await http()
        .get('/api/health-acts')
        .query({ format: 'csv' })
        .set(h)
        .expect(200);
      const text = (
        res.text ?? Buffer.from(res.body as Buffer).toString('utf8')
      ).replace('﻿', '');
      const [header, row] = text.split('\r\n');
      expect(header).toBe(
        'Date;Lot / Animal;Type;Produit;Dose;Vétérinaire;Statut',
      );
      expect(row).toBe(
        `${plusDays(2)};${lotCode};Vaccination;Gumboro;1 goutte;Dr Koffi;Planifié`,
      );
    });
  });

  describe('validation and edge cases', () => {
    it('rejects unknown, null and malformed fields', async () => {
      const a = await act();
      const patch = (body: object, status = 400) =>
        http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send(body)
          .expect(status);
      await patch({ date: null });
      await patch({ date: '2026-13-40' });
      await patch({ type: 'TRAITEMENT' });
      await patch({ status: 'REALISE' });
      await patch({ doneDate: daysAgo(1) });
      await patch({ withdrawalDays: -1 });
      await patch({ quantity: 0 });
      await patch({ dose: null, note: null, symptoms: null }, 200);
      await act({ type: 'BOF' }, 400);
      await act({ status: 'ANNULE' }, 400);
      await act({ doneDate: daysAgo(1) }, 400);
    });

    it('lets a planned act change its product, within veterinary articles', async () => {
      const it = await stocked();
      const feed = await item('Maïs', 'ALIMENT', 'kg');
      const a = await act();
      const patch = (body: object, status = 200) =>
        http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send(body)
          .expect(status);
      await patch({ stockItemId: feed.id }, 400);
      expect(
        ((await patch({ stockItemId: it.id })).body as Act).stockItemId,
      ).toBe(it.id);
      expect(
        ((await patch({ stockItemId: null })).body as Act).stockItemId,
      ).toBeNull();
    });

    it('counts the statuses over the filters but the status', async () => {
      const pig = await world.pigLot(h);
      await act({ date: daysAgo(2) });
      await act({ date: plusDays(2) });
      await act({ batchId: pig.id, date: daysAgo(2) });
      const counts = (await list({ batchId: lotId })).statusCounts;
      expect(counts).toEqual({
        PLANIFIE: 1,
        REALISE: 0,
        EN_RETARD: 1,
        ANNULE: 0,
      });
      const filtered = await list({ batchId: lotId, status: 'EN_RETARD' });
      expect(filtered.total).toBe(1);
      expect(filtered.statusCounts).toEqual(counts);
    });

    it('gives the roles without sante rights no access to any route', async () => {
      const stock = await world.actor('RESP_STOCK');
      for (const path of [
        '/vaccination-plans',
        '/quarantines',
        '/incidents',
        '/biosecurity-logs',
      ]) {
        await http().get(`/api${path}`).set(stock).expect(403);
      }
      const auditeur = await world.actor('AUDITEUR');
      for (const path of ['/quarantines', '/incidents', '/biosecurity-logs']) {
        await http().get(`/api${path}`).set(auditeur).expect(200);
        await http().post(`/api${path}`).set(auditeur).send({}).expect(403);
      }
    });

    it('writes one audit row per generated act when a plan is applied', async () => {
      const p = await world.post<Plan>(h, '/vaccination-plans', {
        name: 'P',
        species: 'AVICOLE',
        items: [
          { ageDays: 1, productName: 'a' },
          { ageDays: 2, productName: 'b' },
        ],
      });
      const res = await http()
        .post(`/api/vaccination-plans/${p.id}/apply`)
        .set(h)
        .send({ batchId: lotId })
        .expect(201);
      const ids = (res.body as Act[]).map((a) => a.id);
      expect(
        await prisma.auditLog.count({
          where: { module: 'sante', action: 'CREATE', recordId: { in: ids } },
        }),
      ).toBe(2);
    });

    it('refuses a new act on an exited animal and on a closed lot', async () => {
      const sow = await world.animal(h);
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ reason: 'VENDU', date: daysAgo(1) })
        .expect(200);
      await act({ batchId: undefined, animalId: sow.id }, 409);
      const lot = await world.lot(h);
      await closeLot(lot.id);
      await act({ batchId: lot.id }, 409);
    });
  });

  describe('lot history', () => {
    const ENTRY = "La date est antérieure à l'entrée du lot";
    const move = (to: string, status: number) =>
      http()
        .patch(`/api/batches/${lotId}`)
        .set(h)
        .send({ entryDate: to })
        .expect(status);

    it("refuses to move a lot's entry date after its first health record, and only because of it", async () => {
      const a = await done({ date: daysAgo(5) });
      expect(message(await move(daysAgo(2), 400))).toBe(ENTRY);
      await http().delete(`/api/health-acts/${a.id}`).set(h).expect(200);
      await move(daysAgo(2), 200);
    });

    it('looks at the day an act was done when it is earlier than its date, and ignores cancelled acts', async () => {
      const a = await act({ date: daysAgo(1) });
      await complete(a.id, { doneDate: daysAgo(10) });
      expect(message(await move(daysAgo(5), 400))).toBe(ENTRY);
      await http().post(`/api/health-acts/${a.id}/cancel`).set(h).expect(200);
      await move(daysAgo(5), 200);
    });

    it('is pinned by quarantines and incidents too', async () => {
      const q = await world.post<Id>(h, '/quarantines', {
        batchId: lotId,
        startDate: daysAgo(6),
        reason: 'x',
      });
      expect(message(await move(daysAgo(2), 400))).toBe(ENTRY);
      await http().delete(`/api/quarantines/${q.id}`).set(h).expect(200);
      await world.post(h, '/incidents', {
        date: daysAgo(6),
        title: 'x',
        severity: 'FAIBLE',
        batchId: lotId,
      });
      expect(message(await move(daysAgo(2), 400))).toBe(ENTRY);
    });
  });

  describe('fix round 1', () => {
    const BATCH = 'Lot invalide pour cet article';

    it('answers 400 (not 500) for an unknown product lot on create, edit and complete', async () => {
      const it = await stocked();
      const bad = await http()
        .post('/api/health-acts')
        .set(h)
        .send({
          type: 'VACCINATION',
          status: 'REALISE',
          batchId: lotId,
          date: daysAgo(1),
          stockItemId: it.id,
          quantity: 1,
          stockBatchId: 'inconnu',
        })
        .expect(400);
      expect(message(bad)).toBe(BATCH);
      const a = await done({
        stockItemId: it.id,
        quantity: 1,
        productName: undefined,
      });
      const patch = await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ stockBatchId: 'inconnu' })
        .expect(400);
      expect(message(patch)).toBe(BATCH);
      const p = await act({
        stockItemId: it.id,
        date: daysAgo(1),
        productName: undefined,
      });
      const res = await complete(
        p.id,
        { doneDate: daysAgo(0), quantity: 1, stockBatchId: 'inconnu' },
        400,
      );
      expect(message(res)).toBe(BATCH);
      expect((await detail(it.id)).quantity).toBe(11);
      expect((await list({ status: 'EN_RETARD' })).total).toBe(1);
    });

    it('refuses a lot of another article of the same farm', async () => {
      const it = await stocked();
      const other = await stocked('Autre');
      const foreign = (await detail(other.id)).batches[0].id;
      const res = await http()
        .post('/api/health-acts')
        .set(h)
        .send({
          type: 'VACCINATION',
          status: 'REALISE',
          batchId: lotId,
          date: daysAgo(1),
          stockItemId: it.id,
          quantity: 1,
          stockBatchId: foreign,
        })
        .expect(400);
      expect(message(res)).toBe(BATCH);
    });

    describe('planned acts on a closed lot or an exited animal', () => {
      const counts = async () => (await list()).statusCounts;

      it('list as PLANIFIE (never late), can be cancelled and deleted, not completed nor edited', async () => {
        const lot = await world.lot(h);
        const onLot = await act({ batchId: lot.id, date: daysAgo(2) });
        const onLot2 = await act({ batchId: lot.id, date: daysAgo(2) });
        const open = await act({ date: daysAgo(2) });
        expect(await counts()).toEqual({
          PLANIFIE: 0,
          REALISE: 0,
          EN_RETARD: 3,
          ANNULE: 0,
        });
        await closeLot(lot.id);
        const rows = (await list()).items;
        expect(rows.find((r) => r.id === onLot.id)?.status).toBe('PLANIFIE');
        expect(rows.find((r) => r.id === open.id)?.status).toBe('EN_RETARD');
        expect(await counts()).toEqual({
          PLANIFIE: 2,
          REALISE: 0,
          EN_RETARD: 1,
          ANNULE: 0,
        });
        expect(
          (await list({ status: 'EN_RETARD' })).items.map((r) => r.id),
        ).toEqual([open.id]);
        expect((await list({ status: 'PLANIFIE' })).total).toBe(2);
        await complete(onLot.id, { doneDate: daysAgo(0) }, 409);
        await http()
          .patch(`/api/health-acts/${onLot.id}`)
          .set(h)
          .send({ dose: 'x' })
          .expect(409);
        await http()
          .post(`/api/health-acts/${onLot.id}/cancel`)
          .set(h)
          .expect(200);
        await http().delete(`/api/health-acts/${onLot2.id}`).set(h).expect(200);
        expect(await counts()).toEqual({
          PLANIFIE: 0,
          REALISE: 0,
          EN_RETARD: 1,
          ANNULE: 1,
        });
      });

      it('holds for an exited animal', async () => {
        const sow = await world.animal(h);
        const a = await act({
          batchId: undefined,
          animalId: sow.id,
          date: daysAgo(2),
        });
        const b = await act({
          batchId: undefined,
          animalId: sow.id,
          date: daysAgo(2),
        });
        await http()
          .post(`/api/animals/${sow.id}/exit`)
          .set(h)
          .send({ reason: 'VENDU', date: daysAgo(1) })
          .expect(200);
        expect(
          (await list({ animalId: sow.id })).items.map((r) => r.status),
        ).toEqual(['PLANIFIE', 'PLANIFIE']);
        expect(await counts()).toEqual({
          PLANIFIE: 2,
          REALISE: 0,
          EN_RETARD: 0,
          ANNULE: 0,
        });
        await complete(a.id, { doneDate: daysAgo(0) }, 409);
        await http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send({ dose: 'x' })
          .expect(409);
        await http().post(`/api/health-acts/${a.id}/cancel`).set(h).expect(200);
        await http().delete(`/api/health-acts/${b.id}`).set(h).expect(200);
      });

      it('keeps a done act on a closed lot untouchable (stock stays booked)', async () => {
        const it = await stocked();
        const lot = await world.lot(h);
        const d = await act({
          batchId: lot.id,
          status: 'REALISE',
          date: daysAgo(1),
          stockItemId: it.id,
          quantity: 1,
          productName: undefined,
        });
        await closeLot(lot.id);
        await http().post(`/api/health-acts/${d.id}/cancel`).set(h).expect(409);
        await http().delete(`/api/health-acts/${d.id}`).set(h).expect(409);
        expect((await detail(it.id)).quantity).toBe(11);
      });
    });

    describe('entered as done versus completed later', () => {
      const exitDate = async (itemId: string) =>
        (
          (
            await http()
              .get('/api/stock/movements')
              .query({ itemId })
              .set(h)
              .expect(200)
          ).body as Page<{
            date: string;
            sourceType: string | null;
          }>
        ).items.find((m) => m.sourceType === 'HEALTH_ACT')?.date;

      it('refuses a done act whose date differs from its done day, and a done day in the future', async () => {
        await done({ date: daysAgo(3), doneDate: daysAgo(1) }, 400);
        await done({ date: plusDays(1), doneDate: plusDays(1) }, 400);
        await done({ date: daysAgo(1), doneDate: daysAgo(1) });
      });

      it('an act entered as done is edited through its date only', async () => {
        const a = await done({ date: daysAgo(3) });
        const res = await http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send({ doneDate: daysAgo(2) })
          .expect(400);
        expect(message(res)).toBe(
          'Cette intervention a été saisie réalisée : modifiez sa date',
        );
        const ok = await http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send({ date: daysAgo(4) })
          .expect(200);
        expect(ok.body).toMatchObject({
          date: daysAgo(4),
          doneDate: daysAgo(4),
        });
      });

      it('a planned act completed on its own planned day keeps them apart: date moves the plan, doneDate the exit', async () => {
        const it = await stocked();
        const a = await act({
          stockItemId: it.id,
          quantity: 2,
          date: daysAgo(3),
          productName: undefined,
        });
        await complete(a.id, { doneDate: daysAgo(3) });
        expect(await exitDate(it.id)).toBe(daysAgo(3));
        const moved = await http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send({ date: daysAgo(5) })
          .expect(200);
        expect(moved.body).toMatchObject({
          date: daysAgo(5),
          doneDate: daysAgo(3),
        });
        expect(await exitDate(it.id)).toBe(daysAgo(3));
        const exit = await http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send({ doneDate: daysAgo(2) })
          .expect(200);
        expect(exit.body).toMatchObject({
          date: daysAgo(5),
          doneDate: daysAgo(2),
        });
        expect(await exitDate(it.id)).toBe(daysAgo(2));
        await http()
          .patch(`/api/health-acts/${a.id}`)
          .set(h)
          .send({ doneDate: plusDays(1) })
          .expect(400);
      });
    });

    describe('inactive and retyped articles', () => {
      it('completing refuses an inactive article', async () => {
        const it = await stocked();
        const a = await act({
          stockItemId: it.id,
          quantity: 1,
          date: daysAgo(1),
          productName: undefined,
        });
        await http()
          .patch(`/api/stock-items/${it.id}`)
          .set(h)
          .send({ active: false })
          .expect(200);
        const res = await complete(a.id, { doneDate: daysAgo(0) }, 400);
        expect(message(res)).toBe('Produit invalide');
      });

      it('apply copies a step whose article is no longer a usable vaccine as free text', async () => {
        const good = await item('Bon');
        const inactive = await item('Inactif');
        const retyped = await item('Retypé');
        const p = await world.post<Plan>(h, '/vaccination-plans', {
          name: 'P',
          species: 'AVICOLE',
          items: [
            { ageDays: 1, productName: 'Bon', stockItemId: good.id },
            { ageDays: 2, productName: 'Inactif', stockItemId: inactive.id },
            { ageDays: 3, productName: 'Retypé', stockItemId: retyped.id },
          ],
        });
        await http()
          .patch(`/api/stock-items/${inactive.id}`)
          .set(h)
          .send({ active: false })
          .expect(200);
        await http()
          .patch(`/api/stock-items/${retyped.id}`)
          .set(h)
          .send({ category: 'ALIMENT' })
          .expect(200);
        const res = await http()
          .post(`/api/vaccination-plans/${p.id}/apply`)
          .set(h)
          .send({ batchId: lotId })
          .expect(201);
        expect(
          (res.body as Act[]).map((a) => [a.productName, a.stockItemId]),
        ).toEqual([
          ['Bon', good.id],
          ['Inactif', null],
          ['Retypé', null],
        ]);
      });
    });

    describe('quarantines and incidents', () => {
      it('allows one open quarantine per lot or animal', async () => {
        const sow = await world.animal(h);
        const q = await world.post<Id>(h, '/quarantines', {
          batchId: lotId,
          startDate: daysAgo(2),
          reason: 'a',
        });
        const dup = await http()
          .post('/api/quarantines')
          .set(h)
          .send({ batchId: lotId, startDate: daysAgo(1), reason: 'b' })
          .expect(409);
        expect(message(dup)).toBe('Une quarantaine est déjà en cours');
        await world.post(h, '/quarantines', {
          animalId: sow.id,
          startDate: daysAgo(2),
          reason: 'a',
        });
        await http()
          .post('/api/quarantines')
          .set(h)
          .send({ animalId: sow.id, startDate: daysAgo(1), reason: 'b' })
          .expect(409);
        await http()
          .post(`/api/quarantines/${q.id}/lift`)
          .set(h)
          .send({ date: daysAgo(0) })
          .expect(200);
        await world.post(h, '/quarantines', {
          batchId: lotId,
          startDate: daysAgo(0),
          reason: 'c',
        });
      });

      it('locks the lot when a date is edited: refused on a closed lot, other fields stay editable', async () => {
        const lot = await world.lot(h);
        const q = await world.post<Id>(h, '/quarantines', {
          batchId: lot.id,
          startDate: daysAgo(5),
          reason: 'a',
        });
        const i = await world.post<Id>(h, '/incidents', {
          date: daysAgo(5),
          title: 'a',
          severity: 'FAIBLE',
          batchId: lot.id,
        });
        await closeLot(lot.id);
        await http()
          .patch(`/api/quarantines/${q.id}`)
          .set(h)
          .send({ startDate: daysAgo(4) })
          .expect(409);
        await http()
          .patch(`/api/quarantines/${q.id}`)
          .set(h)
          .send({ reason: 'b' })
          .expect(200);
        await http()
          .patch(`/api/incidents/${i.id}`)
          .set(h)
          .send({ date: daysAgo(4) })
          .expect(409);
        await http()
          .patch(`/api/incidents/${i.id}`)
          .set(h)
          .send({ title: 'b' })
          .expect(200);
      });
    });

    describe('plans applied', () => {
      const mk = (name = 'P') =>
        world.post<Plan>(h, '/vaccination-plans', {
          name,
          species: 'AVICOLE',
          type: 'CHAIR',
          items: [{ ageDays: 1, productName: 'a' }],
        });

      it('applying twice at once creates the acts once', async () => {
        const p = await mk();
        const calls = await Promise.all(
          [1, 2, 3].map(() =>
            http()
              .post(`/api/vaccination-plans/${p.id}/apply`)
              .set(h)
              .send({ batchId: lotId }),
          ),
        );
        expect(calls.map((c) => c.status).sort()).toEqual([201, 409, 409]);
        expect((await list()).items).toHaveLength(1);
      });

      it('freezes species and type once applied, still allows a rename and new steps, and cannot be deleted', async () => {
        const p = await mk();
        await http()
          .patch(`/api/vaccination-plans/${p.id}`)
          .set(h)
          .send({ type: 'PONDEUSE' })
          .expect(200);
        await http()
          .patch(`/api/vaccination-plans/${p.id}`)
          .set(h)
          .send({ type: 'CHAIR' })
          .expect(200);
        const res = await http()
          .post(`/api/vaccination-plans/${p.id}/apply`)
          .set(h)
          .send({ batchId: lotId })
          .expect(201);
        for (const body of [
          { type: 'PONDEUSE' },
          { type: null },
          { species: 'PORCIN', type: 'PORCELET' },
        ]) {
          const r = await http()
            .patch(`/api/vaccination-plans/${p.id}`)
            .set(h)
            .send(body)
            .expect(409);
          expect(message(r)).toBe(
            'Ce plan a été appliqué à des lots : son espèce et son type ne peuvent plus changer',
          );
        }
        await http()
          .patch(`/api/vaccination-plans/${p.id}`)
          .set(h)
          .send({
            name: 'Renommé',
            type: 'CHAIR',
            items: [{ ageDays: 2, productName: 'z' }],
          })
          .expect(200);
        const del = await http()
          .delete(`/api/vaccination-plans/${p.id}`)
          .set(h)
          .expect(409);
        expect(message(del)).toBe(
          'Ce plan a été appliqué à des lots : il ne peut pas être supprimé',
        );
        for (const a of res.body as Act[])
          await http().delete(`/api/health-acts/${a.id}`).set(h).expect(200);
        await http()
          .delete(`/api/vaccination-plans/${p.id}`)
          .set(h)
          .expect(200);
      });
    });

    it('returns withdrawalUntil null on a created animal and lot, like their detail', async () => {
      const sow = await world.animal(h);
      expect(sow).toHaveProperty('withdrawalUntil', null);
      const lot = await world.lot(h);
      expect(lot).toHaveProperty('withdrawalUntil', null);
    });
  });

  describe('final fix wave: stock ledger', () => {
    async function validatedCount(itemId: string, date: string, qty: number) {
      const session = await world.post<Id>(h, '/inventories', { date });
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

    it('a validated inventory locks the acts positioned before it, not those on or after the count day', async () => {
      const it = await stocked('Gumboro');
      const a = await done({
        stockItemId: it.id,
        quantity: 2,
        date: daysAgo(10),
        productName: undefined,
      });
      const planned = await act({
        stockItemId: it.id,
        date: daysAgo(3),
        productName: undefined,
      });
      expect((await detail(it.id)).quantity).toBe(10);
      await validatedCount(it.id, daysAgo(5), 9); // theoretical 10: −1
      const locked = `Un inventaire validé le ${daysAgo(5)} verrouille les mouvements antérieurs de Gumboro`;

      const edit = await http()
        .patch(`/api/health-acts/${a.id}`)
        .set(h)
        .send({ quantity: 3 })
        .expect(409);
      expect(message(edit)).toBe(locked);
      const del = await http()
        .delete(`/api/health-acts/${a.id}`)
        .set(h)
        .expect(409);
      expect(message(del)).toBe(locked);
      expect(
        message(
          await complete(
            planned.id,
            { doneDate: daysAgo(7), quantity: 1 },
            409,
          ),
        ),
      ).toBe(locked);
      expect((await detail(it.id)).quantity).toBe(9);

      // The count day itself, after the count, and later days stay open.
      await complete(planned.id, { doneDate: daysAgo(5), quantity: 1 });
      expect((await detail(it.id)).quantity).toBe(8);
    });

    it("never answers 500 when an act names a lot while the lot's only entry is deleted (several rounds)", async () => {
      for (let round = 0; round < 6; round++) {
        const it = await item(`Race ${round}`);
        const mv = (await entry(it.id, 5, {
          lotNumber: `R${round}`,
          expiryDate: '2030-01-01',
        })) as unknown as { id: string }[];
        const batch = (await detail(it.id)).batches[0].id;
        const planned = await act({ stockItemId: it.id, date: daysAgo(1) });
        const [completed, removed] = await Promise.all([
          http()
            .post(`/api/health-acts/${planned.id}/complete`)
            .set(h)
            .send({ doneDate: daysAgo(0), quantity: 1, stockBatchId: batch }),
          http().delete(`/api/stock/movements/${mv[0].id}`).set(h),
        ]);
        expect([200, 400, 409]).toContain(completed.status);
        expect([200, 400, 409]).toContain(removed.status);
        // One of them wins: the exit consumed the lot, or the entry is gone.
        expect(completed.status === 200 && removed.status === 200).toBe(false);
        if (removed.status === 200) {
          expect((await detail(it.id)).quantity).toBe(0);
          expect((await detail(it.id)).batches).toEqual([]);
        } else {
          expect((await detail(it.id)).quantity).toBe(4);
        }
      }
    });
  });
});
