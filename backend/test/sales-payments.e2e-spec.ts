import { INestApplication } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { receivablesOf, receivablesTotal } from '../src/sales/receivables';
import { OPEN_STATUSES } from '../src/sales/sale-workflow';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { countQueries } from './query-counter';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface Payment {
  id: string;
  number: string;
  kind: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
}
interface Step {
  step: string;
  at: string;
  by: string | null;
  note?: string | null;
}
interface Detail extends Id {
  number: string | null;
  date: string;
  dueDate: string | null;
  status: string;
  total: number;
  paid: number;
  credited: number;
  refunded: number;
  due: number;
  refundDue: number;
  overdue: boolean;
  lines: { id: string }[];
  payments: Payment[];
  creditNotes: unknown[];
  history: Step[];
}
interface Page<T> {
  items: T[];
  total: number;
}
interface Alerts {
  total: number;
  items: {
    key: string;
    title: string;
    detail: string;
    level: string;
    module: string;
  }[];
}
interface CustomerSheet {
  id: string;
  name: string;
  balance: number;
  invoiced?: number;
  paid?: number;
  credited?: number;
  refunded?: number;
}

const MARCHE = 'Marché Hédzranawoé — Mme Afi';
const FCFA = (n: string) => `${n}\u00a0FCFA`;

describe('Client payments and receivables (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let seller: Headers;
  let accountant: Headers;
  let director: Headers;
  let keeper: Headers;
  let owner: Headers;
  let customerId: string;
  let lotId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    seller = await world.actor('COMMERCIAL');
    accountant = await world.actor('COMPTABLE');
    director = await world.actor('DIRECTEUR_FERME');
    keeper = await world.actor('MAGASINIER');
    owner = await world.actor('PROPRIETAIRE');
    customerId = (
      await world.post(seller, '/customers', {
        name: MARCHE,
        type: 'REVENDEUR',
        phone: '+228 98 65 43 21',
      })
    ).id;
    lotId = (await world.lot(director, { initialCount: 400 })).id;
  });

  /** Property: whatever a test built, the aggregate is Σ of the per-invoice figures (every filter, every farm). */
  afterEach(async () => {
    const farmIds = (await prisma.farm.findMany({ select: { id: true } })).map(
      (f) => f.id,
    );
    for (const opts of [
      {},
      { statuses: OPEN_STATUSES },
      { statuses: OPEN_STATUSES, dueBefore: new Date() },
    ]) {
      const per = await receivablesOf(prisma, farmIds, opts);
      const sum = per.reduce((n, r) => n.add(r.due), new Decimal(0));
      const total = await receivablesTotal(prisma, farmIds, opts);
      expect(total.toFixed(2)).toBe(sum.toFixed(2));
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const msg = (r: { body: unknown }) => {
    const { message } = r.body as Msg;
    return Array.isArray(message) ? message.join(' | ') : message;
  };
  const lotLine = (over: Record<string, unknown> = {}) => ({
    kind: 'LOT',
    batchId: lotId,
    quantity: 300,
    unitPrice: 3500,
    ...over,
  });
  const body = (over: Record<string, unknown> = {}) => ({
    customerId,
    date: daysAgo(2),
    lines: [lotLine()],
    ...over,
  });
  const issued = (over: Record<string, unknown> = {}, h = accountant) =>
    world.post<Detail>(h, '/sales/issued', body(over));
  const get = async (id: string, h = seller) =>
    (await http().get(`/api/sales/${id}`).set(h).expect(200)).body as Detail;
  const pay = (
    id: string,
    payload: Record<string, unknown>,
    h = accountant,
    status = 201,
  ) =>
    http()
      .post(`/api/sales/${id}/payments`)
      .set(h)
      .send(payload)
      .expect(status);
  const encash = (
    id: string,
    amount: number,
    over: Record<string, unknown> = {},
    h = accountant,
  ) =>
    pay(id, { date: daysAgo(1), amount, method: 'ESPECES', ...over }, h).then(
      (r) => r.body as Detail,
    );
  const unpay = (id: string, paymentId: string, h = accountant, status = 200) =>
    http()
      .delete(`/api/sales/${id}/payments/${paymentId}`)
      .set(h)
      .expect(status);
  const alerts = async (h: Headers) =>
    (await http().get('/api/alerts').set(h).expect(200)).body as Alerts;
  const receivables = async (h: Headers) =>
    (await alerts(h)).items.filter((i) => i.key.startsWith('receivable:'));
  const customer = async (h = accountant) =>
    (await http().get(`/api/customers/${customerId}`).set(h).expect(200))
      .body as CustomerSheet;
  const counter = async (kind = 'RC') =>
    (
      await prisma.$queryRawUnsafe<{ last: number }[]>(
        `SELECT "last" FROM "DocumentCounter" WHERE "kind" = '${kind}'`,
      )
    )[0]?.last ?? null;
  const rows = (table: string) =>
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${table}" ORDER BY "createdAt"`,
    );
  const audits = (module = 'ventes') =>
    prisma.auditLog.findMany({
      where: { module },
      orderBy: { createdAt: 'asc' },
    });
  async function layerWithEggs(eggs: number) {
    const layer = await world.lot(director, {
      type: 'PONDEUSE',
      initialCount: 3000,
    });
    await world.post(director, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(3),
      collected: eggs,
    });
    return layer;
  }
  /** FA-0309: 400 plateaux of eggs, 1 000 000 FCFA, due yesterday. */
  async function fa0309(over: Record<string, unknown> = {}) {
    const layer = await layerWithEggs(12000);
    return issued({
      dueDate: daysAgo(1),
      lines: [
        { kind: 'OEUFS', batchId: layer.id, quantity: 400, unitPrice: 2500 },
      ],
      ...over,
    });
  }

  describe('encashments', () => {
    it('FA-0309: 600 000 in cash gives RC-0001, due 400 000, Partielle, and a step in the history', async () => {
      const inv = await fa0309();
      expect(inv).toMatchObject({
        total: 1000000,
        status: 'EMISE',
        due: 1000000,
        paid: 0,
        payments: [],
      });
      const res = await encash(inv.id, 600000);
      expect(res).toMatchObject({
        status: 'PARTIELLE',
        paid: 600000,
        due: 400000,
        refunded: 0,
        refundDue: 0,
      });
      expect(res.payments).toEqual([
        {
          id: expect.any(String) as string,
          number: 'RC-0001',
          kind: 'ENCAISSEMENT',
          date: daysAgo(1),
          amount: 600000,
          method: 'ESPECES',
          reference: null,
        },
      ]);
      expect(res.history.map((s) => s.step)).toEqual([
        'BROUILLON',
        'EMISE',
        'PAIEMENT',
      ]);
      expect(res.history[2]).toMatchObject({ note: 'RC-0001' });
      expect(await get(inv.id)).toMatchObject({
        status: 'PARTIELLE',
        due: 400000,
        overdue: true,
      });
      const list = (await http().get('/api/sales').set(seller).expect(200))
        .body as Page<Detail>;
      expect(list.items[0]).toMatchObject({ paid: 600000, due: 400000 });
    });

    it('refuses more than what is due (400 001 on 400 000), accepts exactly the rest and settles', async () => {
      const inv = await fa0309();
      await encash(inv.id, 600000);
      const over = await pay(
        inv.id,
        { date: daysAgo(1), amount: 400001, method: 'VIREMENT' },
        accountant,
        400,
      );
      expect(msg(over)).toBe('Le montant dépasse le reste dû');
      expect(await counter()).toBe(1);
      const done = await encash(inv.id, 400000, {
        method: 'MOBILE_MONEY',
        reference: 'TMoney 42',
      });
      expect(done).toMatchObject({
        status: 'SOLDEE',
        paid: 1000000,
        due: 0,
        overdue: false,
      });
      expect(done.payments.map((p) => p.number)).toEqual([
        'RC-0001',
        'RC-0002',
      ]);
      expect(done.payments[1]).toMatchObject({
        method: 'MOBILE_MONEY',
        reference: 'TMoney 42',
      });
      const again = await pay(
        inv.id,
        { date: daysAgo(1), amount: 1, method: 'ESPECES' },
        accountant,
        409,
      );
      expect(msg(again)).toBe(
        'Seule une facture émise et non soldée peut être payée',
      );
    });

    it('deleting a payment recomputes the status and the numbers are never given back', async () => {
      const inv = await fa0309();
      const first = await encash(inv.id, 600000);
      const second = await encash(inv.id, 400000);
      expect(second.status).toBe('SOLDEE');
      const after = (await unpay(inv.id, second.payments[1].id)).body as Detail;
      expect(after).toMatchObject({
        status: 'PARTIELLE',
        paid: 600000,
        due: 400000,
      });
      expect(after.payments.map((p) => p.number)).toEqual(['RC-0001']);
      const last = (await unpay(inv.id, first.payments[0].id)).body as Detail;
      expect(last).toMatchObject({ status: 'EMISE', paid: 0, due: 1000000 });
      const next = await encash(inv.id, 10);
      expect(next.payments[0].number).toBe('RC-0003');
      expect(await rows('CustomerPayment')).toHaveLength(1);
    });

    it('rejects the dates and amounts it must, writing nothing (not even a number)', async () => {
      const inv = await issued({ date: daysAgo(5) });
      const send = async (payload: Record<string, unknown>, status = 400) =>
        msg(await pay(inv.id, payload, accountant, status));
      expect(
        await send({ date: daysAgo(6), amount: 10, method: 'ESPECES' }),
      ).toBe('La date du paiement ne peut pas précéder la facture');
      expect(
        await send({ date: daysAgo(-1), amount: 10, method: 'ESPECES' }),
      ).toBe('La date ne peut pas être dans le futur');
      for (const amount of [0, -5, 10.123, '10', null, 1e12]) {
        await pay(
          inv.id,
          { date: daysAgo(1), amount, method: 'ESPECES' },
          accountant,
          400,
        );
      }
      await send({ date: daysAgo(1), amount: 10, method: 'CASH' });
      await send({
        date: daysAgo(1),
        amount: 10,
        method: 'ESPECES',
        kind: 'X',
      });
      await send({ date: daysAgo(1), amount: 10, method: 'ESPECES', foo: 1 });
      await send({ date: 'hier', amount: 10, method: 'ESPECES' });
      await send({
        date: daysAgo(1),
        amount: 10,
        method: 'ESPECES',
        reference: null,
        kind: null,
      });
      expect(await counter()).toBeNull();
      expect(await rows('CustomerPayment')).toHaveLength(0);
      expect(await audits()).toHaveLength(1); // the invoice only
      // the invoice date itself is fine
      await encash(inv.id, 10, { date: daysAgo(5) });
    });

    it('refuses a payment on a draft and on a cancelled invoice (409), and an unknown or foreign invoice (404)', async () => {
      const draft = (
        await http().post('/api/sales').set(seller).send(body()).expect(201)
      ).body as Detail;
      const noDraft = await pay(
        draft.id,
        { date: daysAgo(1), amount: 10, method: 'ESPECES' },
        accountant,
        409,
      );
      expect(msg(noDraft)).toBe(
        'Seule une facture émise et non soldée peut être payée',
      );
      const inv = await issued();
      await http()
        .post(`/api/sales/${inv.id}/cancel`)
        .set(accountant)
        .send({ reason: 'Erreur' })
        .expect(201);
      await pay(
        inv.id,
        { date: daysAgo(1), amount: 10, method: 'ESPECES' },
        accountant,
        409,
      );
      await pay(
        'unknown',
        { date: daysAgo(1), amount: 10, method: 'ESPECES' },
        accountant,
        404,
      );
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'COMPTABLE',
        farmIds: [farmB],
      });
      const onB = {
        Authorization: `Bearer ${await tokenFor(user.id)}`,
        'X-Farm-Id': farmB,
      };
      const other = await issued({ lines: [lotLine({ quantity: 5 })] });
      await pay(
        other.id,
        { date: daysAgo(1), amount: 10, method: 'ESPECES' },
        onB,
        404,
      );
      await unpay(other.id, 'x', onB, 404);
      expect(await counter()).toBeNull();
    });

    it('deleting: 404 for a payment of another invoice, 409 once cancelled invoices have none to delete', async () => {
      const a = await issued({ lines: [lotLine({ quantity: 10 })] });
      const b = await issued({ lines: [lotLine({ quantity: 10 })] });
      const pa = await encash(a.id, 100);
      await unpay(b.id, pa.payments[0].id, accountant, 404);
      await unpay(a.id, 'unknown', accountant, 404);
      await unpay(a.id, pa.payments[0].id);
      await unpay(a.id, pa.payments[0].id, accountant, 404);
    });

    it('permissions: update (COMMERCIAL, COMPTABLE) encashes and deletes; read-only roles, PROPRIETAIRE and others cannot', async () => {
      const inv = await issued();
      const payload = { date: daysAgo(1), amount: 100, method: 'ESPECES' };
      await pay(inv.id, payload, director, 403);
      await pay(inv.id, payload, keeper, 403);
      await pay(inv.id, payload, owner, 403);
      const bySeller = await encash(inv.id, 100, {}, seller);
      await encash(inv.id, 100, {}, accountant);
      await unpay(inv.id, bySeller.payments[0].id, director, 403);
      await unpay(inv.id, bySeller.payments[0].id, seller);
      await http().get(`/api/sales/${inv.id}`).set(keeper).expect(403);
    });

    it('is read-only under all farms', async () => {
      const inv = await issued();
      const user = await createUser({
        organizationId: world.orgId,
        role: 'SUPER_ADMIN',
        farmIds: [world.farmId],
      });
      const onAll = {
        Authorization: `Bearer ${await tokenFor(user.id)}`,
        'X-Farm-Id': 'all',
      };
      await pay(
        inv.id,
        { date: daysAgo(1), amount: 10, method: 'ESPECES' },
        onAll,
        403,
      );
      await unpay(inv.id, 'x', onAll, 403);
    });

    it('audits one row per payment and per deletion, in the ventes module', async () => {
      const inv = await issued();
      const paid = await encash(inv.id, 100, { reference: 'Reçu 1' });
      await unpay(inv.id, paid.payments[0].id);
      const rowsOf = (await audits()).filter((r) => r.recordId !== inv.id);
      expect(rowsOf.map((r) => r.action)).toEqual(['CREATE', 'DELETE']);
      expect(rowsOf[0].recordId).toBe(paid.payments[0].id);
      expect(JSON.stringify(rowsOf[0].after)).toContain('RC-0001');
      expect(JSON.stringify(rowsOf[1].before)).toContain('RC-0001');
    });

    it('stores what the database insists on: positive amounts and the RC number', async () => {
      const inv = await issued();
      const bad = (sql: string) =>
        expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
      const base = (amount: string, number: string) =>
        `INSERT INTO "CustomerPayment" ("id","organizationId","farmId","invoiceId","number","kind","date","amount","method","createdById")
         SELECT 'x${number}', i."organizationId", i."farmId", i."id", '${number}', 'ENCAISSEMENT', CURRENT_DATE, ${amount}, 'ESPECES', i."createdById"
         FROM "Invoice" i WHERE i."id" = '${inv.id}'`;
      await bad(base('0', 'RC-0001'));
      await bad(base('-1', 'RC-0002'));
      await bad(base('10', 'XX-0003'));
      await prisma.$executeRawUnsafe(base('10', 'RC-0004'));
      await bad(base('10', 'RC-0004'));
    });
  });

  describe('refunds', () => {
    it('refuses a refund when nothing is owed back (409) and beyond what is owed (400)', async () => {
      const inv = await issued();
      await encash(inv.id, 100);
      const none = await pay(
        inv.id,
        {
          date: daysAgo(1),
          amount: 10,
          method: 'ESPECES',
          kind: 'REMBOURSEMENT',
        },
        accountant,
        409,
      );
      expect(msg(none)).toBe('Rien à rembourser sur cette facture');
    });

    it('a refund is update like any payment: COMMERCIAL and COMPTABLE refund, PROPRIETAIRE (validate only) is refused at the route', async () => {
      const inv = await issued();
      await encash(inv.id, 1050000);
      await http()
        .post(`/api/sales/${inv.id}/credit-notes`)
        .set(accountant)
        .send({
          date: daysAgo(1),
          reason: 'Retour',
          withReturn: false,
          lines: [{ lineId: (await get(inv.id)).lines[0].id, quantity: 30 }],
        })
        .expect(201);
      const refund = (amount: number) => ({
        date: daysAgo(1),
        amount,
        method: 'MOBILE_MONEY',
        kind: 'REMBOURSEMENT',
      });
      await pay(inv.id, refund(5000), owner, 403);
      await pay(inv.id, refund(5000), director, 403);
      await pay(inv.id, refund(50000), seller, 201);
      const refunded = (await pay(inv.id, refund(55000), accountant, 201))
        .body as Detail;
      expect(refunded).toMatchObject({ refundDue: 0, refunded: 105000 });
      expect(refunded.payments.map((p) => p.kind)).toEqual([
        'ENCAISSEMENT',
        'REMBOURSEMENT',
        'REMBOURSEMENT',
      ]);
    });
  });

  describe('payment at issue', () => {
    it('collects a payment inside the issue transaction: /issue and /issued, RC number, status, one audit row each', async () => {
      const a = (
        await http().post('/api/sales').set(seller).send(body()).expect(201)
      ).body as Detail;
      const res = await http()
        .post(`/api/sales/${a.id}/issue`)
        .set(accountant)
        .send({
          payment: { amount: 500000, method: 'MOBILE_MONEY', reference: 'T1' },
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'PARTIELLE',
        paid: 500000,
        due: 550000,
        number: 'FA-0001',
      });
      const detail = res.body as Detail;
      expect(detail.payments).toHaveLength(1);
      expect(detail.payments[0]).toMatchObject({
        number: 'RC-0001',
        kind: 'ENCAISSEMENT',
        date: detail.date,
        amount: 500000,
        method: 'MOBILE_MONEY',
        reference: 'T1',
      });
      expect(detail.history.map((s) => s.step)).toEqual([
        'BROUILLON',
        'EMISE',
        'PAIEMENT',
      ]);
      const cash = await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send({
          ...body({ lines: [lotLine({ quantity: 10 })] }),
          payment: { amount: 35000, method: 'ESPECES' },
        })
        .expect(201);
      expect(cash.body).toMatchObject({
        status: 'SOLDEE',
        due: 0,
        paid: 35000,
        number: 'FA-0002',
      });
      expect((cash.body as Detail).payments[0].number).toBe('RC-0002');
      const forInvoice = (await audits()).filter((r) => r.recordId === a.id);
      expect(forInvoice.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    });

    it('refuses a payment above the total and writes nothing: no invoice number, no receipt number, no sale', async () => {
      const over = await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send({
          ...body(),
          payment: { amount: 1050001, method: 'ESPECES' },
        })
        .expect(400);
      expect(msg(over)).toBe('Le montant dépasse le reste dû');
      expect(await counter('FA')).toBeNull();
      expect(await counter('RC')).toBeNull();
      const d = (
        await http().post('/api/sales').set(seller).send(body()).expect(201)
      ).body as Detail;
      await http()
        .post(`/api/sales/${d.id}/issue`)
        .set(accountant)
        .send({ payment: { amount: 1050001, method: 'ESPECES' } })
        .expect(400);
      expect((await get(d.id)).status).toBe('BROUILLON');
      // the sale itself is refused: the payment is rolled back with it
      await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send({
          ...body({ lines: [lotLine({ quantity: 401 })] }),
          payment: { amount: 100, method: 'ESPECES' },
        })
        .expect(400);
      expect(await counter('RC')).toBeNull();
      expect(await rows('CustomerPayment')).toHaveLength(0);
    });

    it('validates the shape of the payment', async () => {
      const d = (
        await http().post('/api/sales').set(seller).send(body()).expect(201)
      ).body as Detail;
      for (const payment of [
        { amount: 0, method: 'ESPECES' },
        { amount: 10, method: 'X' },
        { amount: 10 },
        { amount: 10.123, method: 'ESPECES' },
      ]) {
        await http()
          .post(`/api/sales/${d.id}/issue`)
          .set(accountant)
          .send({ payment })
          .expect(400);
      }
      expect((await get(d.id)).status).toBe('BROUILLON');
    });
  });

  describe('receivables: customer balances and the Créance alert', () => {
    it('raises Créance FA-0309 with the reference text once the due date has passed, and not on the due date itself', async () => {
      const inv = await fa0309({ dueDate: daysAgo(0) });
      expect(await receivables(accountant)).toEqual([]);
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { dueDate: new Date(daysAgo(1)) },
      });
      await encash(inv.id, 600000);
      expect(await receivables(accountant)).toEqual([
        {
          key: `receivable:${inv.id}`,
          title: 'Créance FA-0001',
          detail: `${MARCHE} — ${FCFA('400\u00a0000')}`,
          level: 'A_VOIR',
          module: 'ventes',
          modules: ['ventes'],
        },
      ]);
    });

    it('the alert goes with the debt: settled, gone; deleting the payment, back; a cancelled or draft invoice raises nothing', async () => {
      const inv = await fa0309();
      const first = await encash(inv.id, 600000);
      expect(await receivables(accountant)).toHaveLength(1);
      const done = await encash(inv.id, 400000);
      expect(await receivables(accountant)).toEqual([]);
      await unpay(inv.id, done.payments[1].id);
      expect(await receivables(accountant)).toHaveLength(1);
      await unpay(inv.id, first.payments[0].id);
      await http()
        .post(`/api/sales/${inv.id}/cancel`)
        .set(accountant)
        .send({ reason: 'Erreur' })
        .expect(201);
      expect(await receivables(accountant)).toEqual([]);
    });

    it('is ordered by due date then number, level A_VOIR, after the stock alerts, and counts in the dashboard', async () => {
      const a = await issued({
        date: daysAgo(9),
        dueDate: daysAgo(2),
        lines: [lotLine({ quantity: 10 })],
      });
      const b = await issued({
        date: daysAgo(9),
        dueDate: daysAgo(5),
        lines: [lotLine({ quantity: 10 })],
      });
      const c = await issued({
        date: daysAgo(9),
        dueDate: daysAgo(5),
        lines: [lotLine({ quantity: 20 })],
      });
      const stockMgr = await world.actor('RESP_STOCK');
      const item = await world.post<Id>(stockMgr, '/stock-items', {
        name: 'Aliment ponte',
        category: 'ALIMENT',
        unit: 'kg',
      });
      await world.post(stockMgr, '/stock/movements', {
        itemId: item.id,
        type: 'ENTREE',
        date: daysAgo(40),
        quantity: 900,
        unitCost: 320,
        reason: 'ACHAT',
      });
      await http()
        .put(`/api/stock/${item.id}/thresholds`)
        .set(stockMgr)
        .send({ minQty: 1500 })
        .expect(200);
      const all = (await alerts(director)).items;
      expect(all.map((i) => i.title)).toEqual([
        'Stock faible : Aliment ponte',
        'Créance FA-0002',
        'Créance FA-0003',
        'Créance FA-0001',
      ]);
      const items = (await alerts(accountant)).items.filter((i) =>
        i.key.startsWith('receivable:'),
      );
      expect(items.map((i) => i.key)).toEqual([
        `receivable:${b.id}`,
        `receivable:${c.id}`,
        `receivable:${a.id}`,
      ]);
      expect(items.map((i) => i.title)).toEqual([
        'Créance FA-0002',
        'Créance FA-0003',
        'Créance FA-0001',
      ]);
      const dash = await http()
        .get('/api/dashboard')
        .set(accountant)
        .expect(200);
      expect((dash.body as { alerts: { total: number } }).alerts.total).toBe(3);
    });

    it('is shown only to roles that read ventes', async () => {
      await fa0309();
      expect(await receivables(accountant)).toHaveLength(1);
      expect(await receivables(seller)).toHaveLength(1);
      expect(await receivables(owner)).toHaveLength(1);
      for (const role of [
        'MAGASINIER',
        'AGENT_ELEVAGE',
        'RESP_STOCK',
      ] as const) {
        expect(await receivables(await world.actor(role))).toEqual([]);
      }
    });

    it('stays inside the farm of the request, adds the farm name under several farms, and is batched', async () => {
      const inv = await fa0309();
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'SUPER_ADMIN',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const onA = { Authorization: auth, 'X-Farm-Id': world.farmId };
      const onAll = { Authorization: auth, 'X-Farm-Id': 'all' };
      expect(await receivables(onB)).toEqual([]);
      expect((await receivables(onA))[0].detail).toBe(
        `${MARCHE} — ${FCFA('1\u202f000\u202f000').replaceAll('\u202f', '\u00a0')}`,
      );
      expect((await receivables(onAll))[0]).toMatchObject({
        key: `receivable:${inv.id}`,
        detail: `${MARCHE} — ${FCFA('1\u00a0000\u00a0000')} — Ferme A`,
      });
      // the number of queries does not depend on the number of invoices
      const count = async () => {
        const client: Record<string, unknown> = app.get<PrismaService>(
          PrismaService,
        ) as never;
        const spies: jest.SpyInstance[] = [];
        for (const key of Object.keys(client)) {
          if (key.startsWith('$') || key.startsWith('_')) continue;
          const delegate = client[key];
          if (!delegate || typeof delegate !== 'object') continue;
          for (const method of [
            'findMany',
            'findFirst',
            'findUnique',
            'groupBy',
            'count',
            'aggregate',
          ]) {
            if (
              typeof (delegate as Record<string, unknown>)[method] ===
              'function'
            ) {
              spies.push(
                jest.spyOn(delegate as Record<string, () => unknown>, method),
              );
            }
          }
        }
        try {
          await receivables(onAll);
          return spies.reduce((n, s) => n + s.mock.calls.length, 0);
        } finally {
          spies.forEach((s) => s.mockRestore());
        }
      };
      const before = await count();
      for (let n = 0; n < 4; n++) {
        await issued({
          date: daysAgo(9),
          dueDate: daysAgo(2),
          lines: [lotLine({ quantity: 1 })],
        });
      }
      expect(await count()).toBe(before);
      expect(await receivables(onAll)).toHaveLength(5);
    });

    it('customer balance: 400 000 for Marché Hédzranawoé after a 600 000 payment, in the list and the sheet, farm by farm', async () => {
      const inv = await fa0309();
      await encash(inv.id, 600000);
      expect(await customer()).toMatchObject({
        balance: 400000,
        invoiced: 1000000,
        paid: 600000,
        credited: 0,
        refunded: 0,
      });
      const list = (await http().get('/api/customers').set(seller).expect(200))
        .body as Page<CustomerSheet>;
      expect(list.items.find((c) => c.id === customerId)?.balance).toBe(400000);
      // another farm of the organisation does not see it, `all` does
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'SUPER_ADMIN',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const onAll = { Authorization: auth, 'X-Farm-Id': 'all' };
      expect((await customer(onB)).balance).toBe(0);
      expect((await customer(onAll)).balance).toBe(400000);
      // a draft and a cancelled invoice are not owed
      await http().post('/api/sales').set(seller).send(body()).expect(201);
      const dead = await issued({ lines: [lotLine({ quantity: 5 })] });
      await http()
        .post(`/api/sales/${dead.id}/cancel`)
        .set(accountant)
        .send({ reason: 'Erreur' })
        .expect(201);
      expect(await customer()).toMatchObject({
        balance: 400000,
        invoiced: 1000000,
      });
    });

    it('customer balances are batched: the list costs the same queries for 1 or 6 customers', async () => {
      await fa0309();
      const queries = async () => {
        const client: Record<string, unknown> = app.get<PrismaService>(
          PrismaService,
        ) as never;
        const spies: jest.SpyInstance[] = [];
        for (const key of Object.keys(client)) {
          if (key.startsWith('$') || key.startsWith('_')) continue;
          const delegate = client[key];
          if (!delegate || typeof delegate !== 'object') continue;
          for (const method of ['findMany', 'groupBy', 'count', 'aggregate']) {
            if (
              typeof (delegate as Record<string, unknown>)[method] ===
              'function'
            ) {
              spies.push(
                jest.spyOn(delegate as Record<string, () => unknown>, method),
              );
            }
          }
        }
        try {
          await http().get('/api/customers').set(seller).expect(200);
          return spies.reduce((n, s) => n + s.mock.calls.length, 0);
        } finally {
          spies.forEach((s) => s.mockRestore());
        }
      };
      const before = await queries();
      for (let n = 0; n < 5; n++) {
        await world.post(seller, '/customers', {
          name: `Client ${n}`,
          type: 'PARTICULIER',
        });
      }
      expect(await queries()).toBe(before);
    });

    it('sorts the invoice list by what is due, from the payments', async () => {
      const a = await issued({ lines: [lotLine({ quantity: 10 })] });
      const b = await issued({ lines: [lotLine({ quantity: 20 })] });
      await encash(b.id, 69000);
      const list = (
        await http()
          .get('/api/sales')
          .query({ sort: 'due:asc' })
          .set(seller)
          .expect(200)
      ).body as Page<Detail>;
      expect(list.items.map((i) => [i.id, i.due])).toEqual([
        [b.id, 1000],
        [a.id, 35000],
      ]);
    });
  });

  describe('receivables aggregate and payments journal', () => {
    interface JournalRow {
      id: string;
      number: string;
      date: string;
      kind: string;
      method: string;
      amount: number;
      reference: string | null;
      invoiceId: string;
      invoiceNumber: string;
      customerId: string;
      customerName: string;
    }
    interface Journal extends Page<JournalRow> {
      totals: { received: number; refunded: number; net: number };
    }
    const journal = async (q: Record<string, string> = {}, h = accountant) =>
      (await http().get('/api/sales/payments').query(q).set(h).expect(200))
        .body as Journal;

    /** FA-0309 (600 000 of 1 000 000 in cash) and FA-0310 (1 050 000 paid, 105 000 credited and refunded). */
    async function fixture() {
      const a = await fa0309();
      await encash(a.id, 600000, { method: 'ESPECES', reference: 'Caisse 1' });
      const b = await issued({ lines: [lotLine()] });
      await encash(b.id, 1050000, { method: 'VIREMENT' });
      await http()
        .post(`/api/sales/${b.id}/credit-notes`)
        .set(accountant)
        .send({
          date: daysAgo(1),
          reason: 'Retour',
          withReturn: false,
          lines: [{ lineId: (await get(b.id)).lines[0].id, quantity: 30 }],
        })
        .expect(201);
      await pay(
        b.id,
        {
          date: daysAgo(0),
          amount: 105000,
          method: 'MOBILE_MONEY',
          kind: 'REMBOURSEMENT',
        },
        accountant,
      );
      return { a, b };
    }

    it('receivablesTotal is ONE query and equals Σ of the per-invoice dues (400 000 on the fixture)', async () => {
      await fixture();
      await issued({ lines: [lotLine({ quantity: 1 })] });
      const draft = await world.post<Detail>(seller, '/sales', body());
      expect(draft.status).toBe('BROUILLON');
      const cancelled = await issued({ lines: [lotLine({ quantity: 2 })] });
      await http()
        .post(`/api/sales/${cancelled.id}/cancel`)
        .set(accountant)
        .send({ reason: 'Erreur' })
        .expect(201);
      const farmIds = [world.farmId];
      const per = await receivablesOf(prisma, farmIds);
      const sum = per.reduce((n, r) => n.add(r.due), new Decimal(0));
      expect(sum.toNumber()).toBe(400000 + 3500);
      expect((await receivablesTotal(prisma, farmIds)).toNumber()).toBe(403500);
      expect(
        (
          await receivablesTotal(prisma, farmIds, { statuses: ['PARTIELLE'] })
        ).toNumber(),
      ).toBe(400000);
      expect((await receivablesTotal(prisma, [])).toNumber()).toBe(0);
      expect(
        await countQueries(app, async () => {
          await receivablesTotal(app.get(PrismaService), farmIds);
        }),
      ).toBe(1);
    });

    it('the summary spends one query on receivables, whatever the invoices', async () => {
      await fixture();
      const summary = await http()
        .get('/api/finance/summary')
        .set(accountant)
        .expect(200);
      expect((summary.body as { receivables: number }).receivables).toBe(
        400000,
      );
      const queries = await countQueries(app, async () => {
        await http().get('/api/finance/summary').set(accountant).expect(200);
      });
      // the view's grouped read + the one receivables aggregate + the request's own 2 (user, farm scope)
      expect(queries).toBe(4);
    });

    it('lists the payments of the fixture with their invoice and customer, newest first, totals over the filter', async () => {
      const { a, b } = await fixture();
      const all = await journal();
      expect(all.total).toBe(3);
      expect(all.totals).toEqual({
        received: 1650000,
        refunded: 105000,
        net: 1545000,
      });
      const rc1 = all.items.find((r) => r.number === 'RC-0001');
      expect(rc1).toEqual({
        id: expect.any(String) as string,
        number: 'RC-0001',
        date: daysAgo(1),
        kind: 'ENCAISSEMENT',
        method: 'ESPECES',
        amount: 600000,
        reference: 'Caisse 1',
        invoiceId: a.id,
        invoiceNumber: a.number,
        customerId,
        customerName: MARCHE,
      });
      expect(all.items[0]).toMatchObject({
        kind: 'REMBOURSEMENT',
        invoiceId: b.id,
        date: daysAgo(0),
      });
      const refunds = await journal({ kind: 'REMBOURSEMENT' });
      expect(refunds.items.map((r) => r.amount)).toEqual([105000]);
      expect(refunds.totals).toEqual({
        received: 0,
        refunded: 105000,
        net: -105000,
      });
      expect((await journal({ method: 'VIREMENT' })).total).toBe(1);
      expect((await journal({ customerId: 'nobody' })).total).toBe(0);
      expect((await journal({ search: 'rc-0002' })).total).toBe(1);
      expect((await journal({ search: a.number as string })).total).toBe(1);
      expect((await journal({ search: 'marché' })).total).toBe(3);
      const today = await journal({ from: daysAgo(0), to: daysAgo(0) });
      expect(today.items.map((r) => r.kind)).toEqual(['REMBOURSEMENT']);
      expect(today.totals.net).toBe(-105000);
      const sorted = await journal({ sort: 'amount:asc' });
      expect(sorted.items.map((r) => r.amount)).toEqual([
        105000, 600000, 1050000,
      ]);
      expect(
        (await journal({ sort: 'number:desc' })).items.map((r) => r.number),
      ).toEqual(['RC-0003', 'RC-0002', 'RC-0001']);
      expect((await journal({ pageSize: '1' })).totals.received).toBe(1650000);
      for (const q of [{ sort: 'method:asc' }, { kind: 'X' }, { from: 'hier' }])
        await http()
          .get('/api/sales/payments')
          .query(q)
          .set(accountant)
          .expect(400);
    });

    it('exports the journal as CSV with its header', async () => {
      await fixture();
      const res = await http()
        .get('/api/sales/payments')
        .query({ format: 'csv', sort: 'number:asc' })
        .set(accountant)
        .expect(200);
      const lines = res.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
      expect(lines[0]).toBe('Date;N° reçu;Type;Mode;Facture;Client;Montant');
      expect(lines).toHaveLength(4);
      expect(lines[1]).toBe(
        `${daysAgo(1)};RC-0001;Encaissement;Espèces;FA-0001;${MARCHE};600000`,
      );
      expect(lines[3]).toContain(';Remboursement;Mobile money;');
    });

    it('is a ventes read: COMPTABLE, COMMERCIAL, DIRECTEUR read it, MAGASINIER is refused; another farm is never listed', async () => {
      await fixture();
      await journal({}, seller);
      await journal({}, director);
      await journal({}, owner);
      await http().get('/api/sales/payments').set(keeper).expect(403);
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'SUPER_ADMIN',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const onAll = { Authorization: auth, 'X-Farm-Id': 'all' };
      const other = await journal({}, onB);
      expect(other.total).toBe(0);
      expect(other.totals).toEqual({ received: 0, refunded: 0, net: 0 });
      expect((await journal({}, onAll)).total).toBe(3);
    });

    it('the invoice CSV carries Payé, Échéance and Statut', async () => {
      const a = await fa0309();
      await encash(a.id, 600000);
      const res = await http()
        .get('/api/sales')
        .query({ format: 'csv' })
        .set(seller)
        .expect(200);
      const lines = res.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
      expect(lines[0]).toBe(
        'Date;N° facture;Client;Produit;Quantité;Total;Payé;Reste dû;Échéance;Statut',
      );
      expect(lines[1]).toBe(
        `${daysAgo(2)};FA-0001;${MARCHE};Œufs (plateau);400;1000000;600000;400000;${daysAgo(1)};Partielle`,
      );
    });
  });
});
