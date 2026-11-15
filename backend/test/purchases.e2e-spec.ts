import { INestApplication } from '@nestjs/common';
import type { Role } from '../src/generated/prisma/enums';
import { lineAmount } from '../src/common/money';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  tokenFor,
} from './setup';

interface Line {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  receivedQuantity: number | null;
  amount: number;
  orderedAmount: number;
  lotNumber: string | null;
  expiryDate: string | null;
}
interface Payment {
  id: string;
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
interface Row extends Id {
  date: string;
  reference: string;
  supplierName: string;
  article: string;
  quantity: number;
  status: string;
  amount: number;
  paid: number;
  remaining: number;
}
interface Detail extends Row {
  activity: string;
  supplierId: string;
  supplierPhone: string | null;
  supplierAddress: string | null;
  requestNumber: string;
  orderNumber: string | null;
  orderedAt: string | null;
  lines: Line[];
  payments: Payment[];
  history: Step[];
}
interface Page<T> {
  items: T[];
  total: number;
  statusCounts?: Record<string, number>;
}
interface Supplier extends Id {
  name: string;
  products: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  balance: number;
}
interface StockDetail {
  quantity: number;
  averageCost: number;
  batches: {
    lotNumber: string | null;
    expiryDate: string | null;
    quantity: number;
  }[];
}

describe('Suppliers and purchases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let stockMgr: Headers;
  let keeper: Headers;
  let owner: Headers;
  let supplierId: string;
  let itemId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    stockMgr = await world.actor('RESP_STOCK');
    keeper = await world.actor('MAGASINIER');
    owner = await world.actor('PROPRIETAIRE');
    supplierId = (await supplier('Agro Provende SA')).id;
    itemId = (await stockItem('Aliment ponte')).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();

  const supplier = (name: string, over: Record<string, unknown> = {}) =>
    world.post<Supplier>(director, '/suppliers', { name, ...over });
  const stockItem = (name: string, over: Record<string, unknown> = {}) =>
    world.post<Id>(director, '/stock-items', {
      name,
      category: 'ALIMENT',
      unit: 'kg',
      ...over,
    });

  const body = (over: Record<string, unknown> = {}) => ({
    supplierId,
    date: daysAgo(10),
    lines: [{ itemId, quantity: 3000, unitPrice: 310 }],
    ...over,
  });
  const request = (
    h: Headers = stockMgr,
    over: Record<string, unknown> = {},
    status = 201,
  ) => world.post<Detail>(h, '/purchases', body(over), status);
  const act = (
    h: Headers,
    id: string,
    action: string,
    payload: object = {},
    status = 201,
  ) => world.post<Detail>(h, `/purchases/${id}/${action}`, payload, status);
  const get = async (id: string, h: Headers = director) =>
    (await http().get(`/api/purchases/${id}`).set(h).expect(200))
      .body as Detail;
  const msg = (b: unknown) => (b as Msg).message;

  async function ordered(over: Record<string, unknown> = {}) {
    const p = await request(stockMgr, over);
    await act(director, p.id, 'validate');
    return act(director, p.id, 'order');
  }
  const receiveBody = (over: Record<string, unknown> = {}) => ({
    date: daysAgo(2),
    lines: [
      {
        itemId,
        receivedQuantity: 3000,
        lotNumber: 'L-2026-11',
        expiryDate: '2027-06-30',
      },
    ],
    ...over,
  });
  async function received(over: Record<string, unknown> = {}) {
    const p = await ordered(over);
    return act(keeper, p.id, 'receive', receiveBody());
  }
  const pay = (
    h: Headers,
    id: string,
    amount: number,
    status = 201,
    over: Record<string, unknown> = {},
  ) =>
    world.post<Detail>(
      h,
      `/purchases/${id}/payments`,
      { date: daysAgo(1), amount, method: 'VIREMENT', ...over },
      status,
    );
  const level = async (id = itemId) =>
    (await http().get(`/api/stock/${id}`).set(director).expect(200))
      .body as StockDetail;
  const supplierBalance = async (id = supplierId, h = director) =>
    (
      (await http().get(`/api/suppliers/${id}`).set(h).expect(200))
        .body as Supplier
    ).balance;

  describe('workflow', () => {
    it('runs a purchase from request to payment, feeding the stock and the supplier balance', async () => {
      const p = await request(stockMgr);
      expect(p.reference).toBe('DA-0001');
      expect(p.status).toBe('DEMANDE');
      expect(p.amount).toBe(930000);
      await act(stockMgr, p.id, 'validate', {}, 403);
      const validated = await act(director, p.id, 'validate');
      expect(validated.status).toBe('VALIDEE');
      const placed = await act(director, p.id, 'order');
      expect(placed.status).toBe('COMMANDEE');
      expect(placed.reference).toBe('BC-0001');
      expect(placed.orderedAt).not.toBeNull();
      const listed = (
        await http().get('/api/purchases').set(director).expect(200)
      ).body as Page<Row>;
      expect(listed.items[0].reference).toBe('BC-0001');
      expect(await supplierBalance()).toBe(0);

      const recv = await act(keeper, p.id, 'receive', receiveBody());
      expect(recv.status).toBe('RECUE');
      expect(recv.lines[0]).toMatchObject({
        itemId,
        itemName: 'Aliment ponte',
        unit: 'kg',
        quantity: 3000,
        unitPrice: 310,
        receivedQuantity: 3000,
        lotNumber: 'L-2026-11',
        expiryDate: '2027-06-30',
      });
      const stock = await level();
      expect(stock.quantity).toBe(3000);
      expect(stock.averageCost).toBe(310);
      expect(stock.batches).toEqual([
        expect.objectContaining({
          lotNumber: 'L-2026-11',
          expiryDate: '2027-06-30',
          quantity: 3000,
        }),
      ]);
      const mv = await prisma.stockMovement.findMany();
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({
        type: 'ENTREE',
        reason: 'ACHAT',
        sourceType: 'PURCHASE',
        sourceId: p.id,
      });
      expect(mv[0].unitCost.toNumber()).toBe(310);
      expect(await supplierBalance()).toBe(930000);

      const first = await pay(director, p.id, 500000);
      expect(first).toMatchObject({
        status: 'RECUE',
        paid: 500000,
        remaining: 430000,
      });
      expect(first.payments).toHaveLength(1);
      expect(await supplierBalance()).toBe(430000);
      const last = await pay(director, p.id, 430000);
      expect(last).toMatchObject({ status: 'PAYEE', remaining: 0 });
      expect(await supplierBalance()).toBe(0);

      const detail = await get(p.id);
      expect(detail.history.map((h) => h.step)).toEqual([
        'DEMANDE',
        'VALIDEE',
        'COMMANDEE',
        'RECUE',
        'PAYEE',
      ]);
      expect(detail.history[0].by).toBe(
        (await prisma.user.findFirstOrThrow({ where: { role: 'RESP_STOCK' } }))
          .name,
      );
      expect(detail.history.every((h) => !Number.isNaN(Date.parse(h.at)))).toBe(
        true,
      );
    });

    it('refuses a step that does not follow the status (409)', async () => {
      const p = await request();
      await act(keeper, p.id, 'receive', receiveBody(), 409);
      await act(director, p.id, 'order', {}, 409);
      await pay(director, p.id, 100, 409);
      const o = await ordered();
      await act(director, o.id, 'validate', {}, 409);
      await act(director, o.id, 'order', {}, 409);
    });

    it('receives once: a second reception is refused (409) and the stock counts it once', async () => {
      const o = await ordered();
      await act(keeper, o.id, 'receive', receiveBody());
      await act(keeper, o.id, 'receive', receiveBody(), 409);
      expect((await level()).quantity).toBe(3000);
    });

    it('serialises two parallel receptions: exactly one succeeds', async () => {
      const o = await ordered();
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          http()
            .post(`/api/purchases/${o.id}/receive`)
            .set(keeper)
            .send(receiveBody()),
        ),
      );
      const codes = results.map((r) => r.status).sort();
      expect(codes.filter((c) => c >= 200 && c < 300)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(2);
      expect(await prisma.stockMovement.count()).toBe(1);
      expect((await level()).quantity).toBe(3000);
    });

    it('cannot cancel after reception; cancels before it with a reason', async () => {
      const r = await received();
      await act(director, r.id, 'cancel', { reason: 'Trop tard' }, 409);
      const p = await ordered();
      await act(director, p.id, 'cancel', {}, 400);
      const c = await act(director, p.id, 'cancel', { reason: 'Prix revu' });
      expect(c.status).toBe('ANNULEE');
      const d = await get(p.id);
      expect(d.history.at(-1)).toMatchObject({
        step: 'ANNULEE',
        note: 'Prix revu',
      });
      await act(keeper, p.id, 'receive', receiveBody(), 409);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(stockMgr)
        .send({ note: 'x' })
        .expect(409);
      await http().delete(`/api/purchases/${p.id}`).set(stockMgr).expect(409);
    });

    it('edits and deletes a request only while it is a DEMANDE', async () => {
      const other = await stockItem('Maïs');
      const p = await request();
      const edited = (
        await http()
          .patch(`/api/purchases/${p.id}`)
          .set(stockMgr)
          .send({
            lines: [
              { itemId, quantity: 100, unitPrice: 300 },
              { itemId: other.id, quantity: 50, unitPrice: 200 },
            ],
            note: 'urgent',
          })
          .expect(200)
      ).body as Detail;
      expect(edited.lines.map((l) => l.itemId)).toEqual([itemId, other.id]);
      expect(edited.amount).toBe(40000);
      expect(edited.article).toBe('Aliment ponte +1');
      await act(director, p.id, 'validate');
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(stockMgr)
        .send({ lines: [{ itemId, quantity: 1, unitPrice: 1 }] })
        .expect(409);
      await http().delete(`/api/purchases/${p.id}`).set(stockMgr).expect(409);
      const q = await request();
      await http().delete(`/api/purchases/${q.id}`).set(stockMgr).expect(200);
      await http().get(`/api/purchases/${q.id}`).set(director).expect(404);
    });

    it('refuses to edit or delete a received purchase', async () => {
      const r = await received();
      await http()
        .patch(`/api/purchases/${r.id}`)
        .set(stockMgr)
        .send({ note: 'x' })
        .expect(409);
      await http().delete(`/api/purchases/${r.id}`).set(stockMgr).expect(409);
    });
  });

  describe('reception', () => {
    it('values a partial reception at the received quantity', async () => {
      const o = await ordered();
      const r = await act(
        keeper,
        o.id,
        'receive',
        receiveBody({
          lines: [{ itemId, receivedQuantity: 2800, lotNumber: 'A' }],
        }),
      );
      expect(r.amount).toBe(868000);
      expect(r.remaining).toBe(868000);
      expect(r.quantity).toBe(2800);
      expect((await level()).quantity).toBe(2800);
      expect(await supplierBalance()).toBe(868000);
    });

    it('creates neither lot nor movement for a line received at 0, and one per line for the same article', async () => {
      const maize = await stockItem('Maïs');
      const o = await ordered({
        lines: [
          { itemId, quantity: 100, unitPrice: 300 },
          { itemId, quantity: 50, unitPrice: 320 },
          { itemId: maize.id, quantity: 10, unitPrice: 200 },
        ],
      });
      const r = await act(keeper, o.id, 'receive', {
        date: daysAgo(1),
        lines: [
          { itemId, receivedQuantity: 100, lotNumber: 'A' },
          { itemId, receivedQuantity: 40, lotNumber: 'B' },
          { itemId: maize.id, receivedQuantity: 0, lotNumber: 'ignored' },
        ],
      });
      expect(r.lines.map((l) => l.receivedQuantity)).toEqual([100, 40, 0]);
      expect(r.lines[2].lotNumber).toBeNull();
      const moves = await prisma.stockMovement.findMany({
        orderBy: { quantity: 'desc' },
      });
      expect(moves.map((m) => m.quantity.toNumber())).toEqual([100, 40]);
      expect(await prisma.stockBatch.count()).toBe(2);
      expect((await level(maize.id)).quantity).toBe(0);
      // 100 x 300 + 40 x 320 + 0 x 200
      expect(r.amount).toBe(42800);
      const stock = await level();
      expect(stock.quantity).toBe(140);
      expect(stock.batches.map((b) => b.lotNumber).sort()).toEqual(['A', 'B']);
    });

    it('rounds each line, then sums', async () => {
      const o = await ordered({
        lines: [
          { itemId, quantity: 3, unitPrice: 1.1 },
          { itemId, quantity: 2800.5, unitPrice: 310.1 },
        ],
      });
      expect(o.amount).toBe(868438.35);
    });

    it('validates the date, the lines and the expiry', async () => {
      const o = await ordered();
      const base = receiveBody();
      const m = async (over: object, status = 400) =>
        msg(await act(keeper, o.id, 'receive', { ...base, ...over }, status));
      expect(await m({ date: daysAgo(-3) })).toBe(
        'La date ne peut pas être dans le futur',
      );
      expect(await m({ date: daysAgo(12) })).toBe(
        "La date de réception ne peut pas précéder celle de l'achat",
      );
      expect(
        await m({
          lines: [{ itemId, receivedQuantity: 10, expiryDate: daysAgo(5) }],
        }),
      ).toBe('La péremption ne peut pas précéder la réception du lot');
      expect(await m({ lines: [] })).toEqual([
        'Une demande comporte au moins une ligne',
      ]);
      expect(await m({ lines: [{ itemId, receivedQuantity: -1 }] })).toEqual([
        'lines.0.La quantité reçue doit être un nombre positif ou nul (2 décimales au plus)',
      ]);
      expect(
        await m({ lines: [{ itemId: 'inconnu', receivedQuantity: 1 }] }),
      ).toBe('Les lignes reçues ne correspondent pas à la commande');
      expect(
        await m({
          lines: [
            { itemId, receivedQuantity: 1 },
            { itemId, receivedQuantity: 1 },
          ],
        }),
      ).toBe('Les lignes reçues ne correspondent pas à la commande');
      expect(await m({ lines: [{ itemId, receivedQuantity: 0 }] })).toBe(
        'Aucune quantité reçue : annulez la commande',
      );
      expect((await get(o.id)).status).toBe('COMMANDEE');
      expect(await prisma.stockMovement.count()).toBe(0);
      expect(await prisma.stockBatch.count()).toBe(0);
    });
  });

  describe('payments', () => {
    it('refuses a payment above the remaining amount (400) and is exact to the cent', async () => {
      const o = await ordered({
        lines: [{ itemId, quantity: 3, unitPrice: 0.1 }],
      });
      const r = await act(keeper, o.id, 'receive', {
        date: daysAgo(1),
        lines: [{ itemId, receivedQuantity: 3 }],
      });
      expect(r.amount).toBe(0.3);
      await pay(director, r.id, 0.31, 400);
      await pay(director, r.id, 0.1);
      await pay(director, r.id, 0.2).then((p) =>
        expect(p.status).toBe('PAYEE'),
      );
    });

    it('validates the payment body', async () => {
      const r = await received();
      await pay(director, r.id, 0, 400);
      await pay(director, r.id, -5, 400);
      await pay(director, r.id, 10.123, 400);
      await pay(director, r.id, 10, 400, { method: 'BITCOIN' });
      await pay(director, r.id, 10, 400, { date: daysAgo(-2) });
      await pay(director, r.id, 10, 400, { date: 'hier' });
      const ok = await pay(director, r.id, 10, 201, {
        method: 'MOBILE_MONEY',
        reference: 'TX-1',
      });
      expect(ok.payments[0]).toMatchObject({
        amount: 10,
        method: 'MOBILE_MONEY',
        reference: 'TX-1',
      });
    });

    it('cannot overpay with parallel payments', async () => {
      const r = await received();
      const results = await Promise.all(
        [0, 1, 2, 3].map(() =>
          http()
            .post(`/api/purchases/${r.id}/payments`)
            .set(director)
            .send({ date: daysAgo(1), amount: 400000, method: 'ESPECES' }),
        ),
      );
      const ok = results.filter((x) => x.status === 201);
      expect(ok).toHaveLength(2);
      expect(results.filter((x) => x.status === 400)).toHaveLength(2);
      const d = await get(r.id);
      expect(d.paid).toBe(800000);
      expect(d.remaining).toBe(130000);
      expect(d.status).toBe('RECUE');
    });

    it('reopens the purchase when a payment is deleted', async () => {
      const r = await received();
      await pay(director, r.id, 500000);
      const full = await pay(director, r.id, 430000);
      expect(full.status).toBe('PAYEE');
      await pay(director, r.id, 1, 409);
      const last = full.payments.find((p) => p.amount === 430000)!;
      await http()
        .delete(`/api/purchases/${r.id}/payments/${last.id}`)
        .set(director)
        .expect(200);
      const d = await get(r.id);
      expect(d).toMatchObject({
        status: 'RECUE',
        paid: 500000,
        remaining: 430000,
      });
      expect(d.history.map((h) => h.step)).not.toContain('PAYEE');
      expect(await supplierBalance()).toBe(430000);
      await http()
        .delete(`/api/purchases/${r.id}/payments/inconnu`)
        .set(director)
        .expect(404);
    });
  });

  describe('permissions', () => {
    async function as(role: Role): Promise<Headers> {
      return world.actor(role);
    }

    it('lets each role take exactly its steps (achats: create / validate / update)', async () => {
      const comptable = await as('COMPTABLE');
      const auditeur = await as('AUDITEUR');
      const agent = await as('AGENT_ELEVAGE');
      // create / edit / delete a request = create
      for (const [h, ok] of [
        [stockMgr, true],
        [director, true],
        [keeper, false],
        [owner, false],
        [comptable, false],
        [auditeur, false],
        [agent, false],
      ] as [Headers, boolean][]) {
        const res = await http().post('/api/purchases').set(h).send(body());
        expect(res.status).toBe(ok ? 201 : 403);
      }
      const p = await request(stockMgr);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(keeper)
        .send({ note: 'x' })
        .expect(403);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(stockMgr)
        .send({ note: 'x' })
        .expect(200);
      await http().delete(`/api/purchases/${p.id}`).set(keeper).expect(403);
      // validate = validate: RESP_STOCK, MAGASINIER, COMPTABLE refused; PROPRIETAIRE allowed
      for (const h of [stockMgr, keeper, comptable]) {
        await act(h, p.id, 'validate', {}, 403);
      }
      await act(owner, p.id, 'validate');
      // order = validate
      for (const h of [stockMgr, keeper, comptable]) {
        await act(h, p.id, 'order', {}, 403);
      }
      await act(owner, p.id, 'order');
      // receive = update: PROPRIETAIRE and COMPTABLE refused
      for (const h of [owner, comptable, auditeur]) {
        await act(h, p.id, 'receive', receiveBody(), 403);
      }
      await act(stockMgr, p.id, 'receive', receiveBody());
      // payments = validate
      for (const h of [stockMgr, keeper, comptable]) {
        await pay(h, p.id, 10, 403);
      }
      const paid = await pay(owner, p.id, 10);
      for (const h of [stockMgr, keeper, comptable]) {
        await http()
          .delete(`/api/purchases/${p.id}/payments/${paid.payments[0].id}`)
          .set(h)
          .expect(403);
      }
      await http()
        .delete(`/api/purchases/${p.id}/payments/${paid.payments[0].id}`)
        .set(owner)
        .expect(200);
      // cancel = validate
      const q = await request(stockMgr);
      for (const h of [stockMgr, keeper, comptable]) {
        await act(h, q.id, 'cancel', { reason: 'x' }, 403);
      }
      await act(owner, q.id, 'cancel', { reason: 'x' });
      // read
      for (const h of [keeper, comptable, auditeur, owner, stockMgr]) {
        await http().get('/api/purchases').set(h).expect(200);
      }
      await http().get('/api/purchases').set(agent).expect(403);
    });

    it('reads under all farms but refuses every write there', async () => {
      const all = { ...(await world.actor('SUPER_ADMIN')), 'X-Farm-Id': 'all' };
      const p = await ordered();
      expect(
        (
          (await http().get('/api/purchases').set(all).expect(200))
            .body as Page<Row>
        ).total,
      ).toBe(1);
      await http().get(`/api/purchases/${p.id}`).set(all).expect(200);
      await http().post('/api/purchases').set(all).send(body()).expect(403);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(all)
        .send({ note: 'x' })
        .expect(403);
      await act(all, p.id, 'receive', receiveBody(), 403);
      await act(all, p.id, 'cancel', { reason: 'x' }, 403);
      await pay(all, p.id, 10, 403);
      await http().delete(`/api/purchases/${p.id}`).set(all).expect(403);
    });
  });

  describe('scope', () => {
    it('hides another farm and refuses another organisation in a body', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onA = { Authorization: auth, 'X-Farm-Id': world.farmId };
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const p = await request(onA);
      for (const [method, path, payload] of [
        ['get', '', undefined],
        ['patch', '', { note: 'x' }],
        ['delete', '', undefined],
        ['post', '/validate', {}],
        ['post', '/order', {}],
        ['post', '/receive', receiveBody()],
        ['post', '/cancel', { reason: 'x' }],
        [
          'post',
          '/payments',
          { date: daysAgo(1), amount: 1, method: 'ESPECES' },
        ],
        ['delete', '/payments/x', undefined],
      ] as const) {
        const res = await http()
          [method](`/api/purchases/${p.id}${path}`)
          .set(onB)
          .send(payload);
        expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
      }
      expect(
        ((await http().get('/api/purchases').set(onB)).body as Page<Row>).total,
      ).toBe(0);
      // a payment of farm A is not reachable through farm B either
      const r = await received();
      const paid = await pay(director, r.id, 5);
      await http()
        .delete(`/api/purchases/${r.id}/payments/${paid.payments[0].id}`)
        .set(onB)
        .expect(404);

      const otherOrg = await createOrganization();
      const foreignSupplier = await prisma.supplier.create({
        data: { organizationId: otherOrg.id, name: 'Étranger' },
      });
      const foreignItem = await prisma.stockItem.create({
        data: {
          organizationId: otherOrg.id,
          name: 'Étranger',
          category: 'ALIMENT',
          unit: 'kg',
        },
      });
      expect(
        msg(await request(director, { supplierId: foreignSupplier.id }, 400)),
      ).toBe('Fournisseur invalide');
      expect(
        msg(
          await request(
            director,
            { lines: [{ itemId: foreignItem.id, quantity: 1, unitPrice: 1 }] },
            400,
          ),
        ),
      ).toBe('Article invalide');
      const mine = await request();
      await http()
        .patch(`/api/purchases/${mine.id}`)
        .set(director)
        .send({ supplierId: foreignSupplier.id })
        .expect(400);
      // the supplier of another organisation is not visible either
      await http()
        .get(`/api/suppliers/${foreignSupplier.id}`)
        .set(director)
        .expect(404);
    });

    it('refuses an inactive supplier or article for a request, but keeps existing purchases working', async () => {
      const p = await ordered();
      await http()
        .patch(`/api/suppliers/${supplierId}`)
        .set(director)
        .send({ active: false })
        .expect(200);
      expect(msg(await request(director, {}, 400))).toBe(
        'Ce fournisseur est inactif',
      );
      await act(keeper, p.id, 'receive', receiveBody());
      await pay(director, p.id, 100);
      const s2 = (await supplier('Autre')).id;
      await http()
        .patch(`/api/stock-items/${itemId}`)
        .set(director)
        .send({ active: false })
        .expect(200);
      expect(msg(await request(director, { supplierId: s2 }, 400))).toBe(
        'Article inactif',
      );
    });

    it('validates the request body', async () => {
      const bad = async (over: Record<string, unknown>) =>
        request(director, over, 400);
      await bad({ lines: [] });
      await bad({ lines: [{ itemId, quantity: 0, unitPrice: 1 }] });
      await bad({ lines: [{ itemId, quantity: 1, unitPrice: -1 }] });
      await bad({ lines: [{ itemId, quantity: 1.234, unitPrice: 1 }] });
      await bad({ date: 'x' });
      await bad({ date: daysAgo(-1) });
      await bad({ supplierId: '' });
      await bad({ extra: 1 });
      const free = await request(director, {
        lines: [{ itemId, quantity: 1, unitPrice: 0 }],
      });
      expect(free.amount).toBe(0);
    });
  });

  describe('lists', () => {
    it('reproduces the reference rows and the status counts', async () => {
      const mk = (
        reference: string,
        orderNumber: string | null,
        status: 'DEMANDE' | 'COMMANDEE',
        qty: number,
        price: number,
        date: string,
      ) =>
        prisma.purchase.create({
          data: {
            organizationId: world.orgId,
            farmId: world.farmId,
            supplierId,
            reference,
            orderNumber,
            date: new Date(date),
            status,
            amount: lineAmount(qty, price),
            requestedById: userId,
            ...(status === 'COMMANDEE'
              ? {
                  validatedById: userId,
                  validatedAt: new Date(),
                  orderedById: userId,
                  orderedAt: new Date(),
                }
              : {}),
            items: {
              create: [
                {
                  stockItemId: itemId,
                  position: 0,
                  quantity: qty,
                  unitPrice: price,
                  amount: lineAmount(qty, price),
                },
              ],
            },
          },
        });
      const userId = (await prisma.user.findFirstOrThrow()).id;
      await mk('DA-0142', 'BC-0142', 'COMMANDEE', 3000, 310, '2026-10-20');
      await mk('DA-0089', null, 'DEMANDE', 3200, 350, '2026-10-22');
      const list = (
        await http()
          .get('/api/purchases')
          .query({ sort: 'date:asc' })
          .set(director)
          .expect(200)
      ).body as Page<Row>;
      expect(list.items.map((r) => r.reference)).toEqual([
        'BC-0142',
        'DA-0089',
      ]);
      expect(list.items[0]).toMatchObject({
        date: '2026-10-20',
        supplierName: 'Agro Provende SA',
        article: 'Aliment ponte',
        quantity: 3000,
        status: 'COMMANDEE',
        amount: 930000,
        paid: 0,
        remaining: 930000,
      });
      expect(list.items[1]).toMatchObject({
        status: 'DEMANDE',
        amount: 1120000,
      });
      expect(list.statusCounts).toEqual({
        DEMANDE: 1,
        VALIDEE: 0,
        COMMANDEE: 1,
        RECUE: 0,
        PAYEE: 0,
        ANNULEE: 0,
      });
      // numbering continues after the highest number of the organisation
      expect((await request()).reference).toBe('DA-0143');
      const o = await ordered();
      expect(o.reference).toBe('BC-0143');
    });

    it('filters by status, supplier and search, and sorts', async () => {
      const other = await supplier('Veto Plus');
      const a = await request();
      const b = await request(stockMgr, { supplierId: other.id });
      await act(director, b.id, 'validate');
      const query = async (q: Record<string, string>) =>
        (
          (
            await http()
              .get('/api/purchases')
              .query(q)
              .set(director)
              .expect(200)
          ).body as Page<Row>
        ).items.map((r) => r.id);
      expect(await query({ status: 'VALIDEE' })).toEqual([b.id]);
      expect(await query({ supplierId: other.id })).toEqual([b.id]);
      expect(await query({ search: 'agro' })).toEqual([a.id]);
      expect(await query({ search: 'DA-0002' })).toEqual([b.id]);
      expect(await query({ search: 'aliment' })).toHaveLength(2);
      expect(await query({ search: 'zzz' })).toEqual([]);
      await http()
        .get('/api/purchases')
        .query({ status: 'NOPE' })
        .set(director)
        .expect(400);
      await http()
        .get('/api/purchases')
        .query({ sort: 'secret:asc' })
        .set(director)
        .expect(400);
    });

    it('exports CSV with the brief columns', async () => {
      await ordered();
      const res = await http()
        .get('/api/purchases')
        .query({ format: 'csv' })
        .set(director)
        .expect(200);
      const lines = res.text.replace('﻿', '').split('\r\n');
      expect(lines[0]).toBe(
        'Date;Référence;Fournisseur;Article;Quantité;Statut;Montant',
      );
      expect(lines[1]).toBe(
        `${daysAgo(10)};BC-0001;Agro Provende SA;Aliment ponte;3000;Commandée;930000`,
      );
      const sup = await http()
        .get('/api/suppliers')
        .query({ format: 'csv' })
        .set(director)
        .expect(200);
      expect(sup.text.replace('﻿', '').split('\r\n')[0]).toBe(
        'Nom;Produits fournis;Téléphone;Email;Solde',
      );
    });
  });

  describe('suppliers', () => {
    it('creates, lists, reads, edits and deletes a supplier, auditing each write', async () => {
      const s = await supplier('Veto Plus', {
        products: 'Vaccins',
        phone: '+229 01',
        email: 'v@x.bj',
        address: 'Cotonou',
      });
      expect(s).toMatchObject({
        name: 'Veto Plus',
        products: 'Vaccins',
        address: 'Cotonou',
        active: true,
        balance: 0,
      });
      const patched = (
        await http()
          .patch(`/api/suppliers/${s.id}`)
          .set(stockMgr)
          .send({ address: null, active: false, phone: '+229 02' })
          .expect(200)
      ).body as Supplier;
      expect(patched).toMatchObject({
        address: null,
        active: false,
        phone: '+229 02',
      });
      const all = (await http().get('/api/suppliers').set(keeper).expect(200))
        .body as Page<Supplier>;
      expect(all.items.map((x) => x.name)).toEqual([
        'Agro Provende SA',
        'Veto Plus',
      ]);
      const active = (
        await http()
          .get('/api/suppliers')
          .query({ active: 'true' })
          .set(keeper)
          .expect(200)
      ).body as Page<Supplier>;
      expect(active.items.map((x) => x.name)).toEqual(['Agro Provende SA']);
      await http()
        .get('/api/suppliers')
        .query({ search: 'veto' })
        .set(keeper)
        .expect(200)
        .then((r) => expect((r.body as Page<Supplier>).total).toBe(1));
      await http().delete(`/api/suppliers/${s.id}`).set(stockMgr).expect(200);
      await http().get(`/api/suppliers/${s.id}`).set(keeper).expect(404);
      const rows = await prisma.auditLog.findMany({
        where: { recordId: s.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => `${r.module}:${r.action}`)).toEqual([
        'fournisseurs:CREATE',
        'fournisseurs:UPDATE',
        'fournisseurs:DELETE',
      ]);
    });

    it('refuses a duplicate name, a bad body and a delete of a supplier with purchases (409)', async () => {
      await world.post(
        director,
        '/suppliers',
        { name: 'Agro Provende SA' },
        409,
      );
      await world.post(director, '/suppliers', { name: '' }, 400);
      await world.post(
        director,
        '/suppliers',
        { name: 'X', email: 'nope' },
        400,
      );
      await world.post(director, '/suppliers', { name: 'Y', extra: 1 }, 400);
      await request();
      await http()
        .delete(`/api/suppliers/${supplierId}`)
        .set(director)
        .expect(409);
      await http()
        .patch(`/api/suppliers/${supplierId}`)
        .set(director)
        .send({ name: '' })
        .expect(400);
    });

    it('needs update on fournisseurs to write; any reader lists', async () => {
      for (const role of ['MAGASINIER', 'COMPTABLE', 'AUDITEUR'] as Role[]) {
        const h = await world.actor(role);
        await http().get('/api/suppliers').set(h).expect(200);
        await world.post(h, '/suppliers', { name: `N-${role}` }, 403);
        await http()
          .patch(`/api/suppliers/${supplierId}`)
          .set(h)
          .send({ phone: '1' })
          .expect(403);
        await http().delete(`/api/suppliers/${supplierId}`).set(h).expect(403);
      }
      const agent = await world.actor('AGENT_ELEVAGE');
      await http().get('/api/suppliers').set(agent).expect(403);
      await world.post(stockMgr, '/suppliers', { name: 'Par RESP_STOCK' });
    });

    it('writes under all farms (organisation master data) and derives the balance per farm', async () => {
      const all = { ...director, 'X-Farm-Id': 'all' };
      const s = await world.post<Supplier>(all, '/suppliers', {
        name: 'Global',
      });
      await http()
        .patch(`/api/suppliers/${s.id}`)
        .set(all)
        .send({ phone: '1' })
        .expect(200);

      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const onA = { Authorization: auth, 'X-Farm-Id': world.farmId };
      const allUser = { Authorization: auth, 'X-Farm-Id': 'all' };
      const r = await received();
      await pay(director, r.id, 30000);
      // a purchase of farm B
      const itemB = await stockItem('Maïs B');
      const pb = await world.post<Detail>(onB, '/purchases', {
        supplierId,
        date: daysAgo(5),
        lines: [{ itemId: itemB.id, quantity: 10, unitPrice: 1000 }],
      });
      await act(onB, pb.id, 'validate');
      await act(onB, pb.id, 'order');
      await act(onB, pb.id, 'receive', {
        date: daysAgo(1),
        lines: [{ itemId: itemB.id, receivedQuantity: 10 }],
      });
      expect(await supplierBalance(supplierId, onA)).toBe(900000);
      expect(await supplierBalance(supplierId, onB)).toBe(10000);
      expect(await supplierBalance(supplierId, allUser)).toBe(910000);
      expect(await supplierBalance(supplierId, director)).toBe(900000);
    });
  });

  describe('database constraints', () => {
    const userOf = async () => (await prisma.user.findFirstOrThrow()).id;
    const base = async () => ({
      organizationId: world.orgId,
      farmId: world.farmId,
      supplierId,
      date: new Date('2026-10-01'),
      requestedById: await userOf(),
    });

    it('refuses a status that disagrees with its timestamps, a bad reference, and orphan authors', async () => {
      const cases: Record<string, [string, object]> = {
        'validated without status': [
          'Purchase_status_check',
          {
            reference: 'DA-0001',
            validatedAt: new Date(),
            validatedById: await userOf(),
          },
        ],
        'received without being ordered': [
          'Purchase_status_check',
          {
            reference: 'DA-0002',
            status: 'RECUE',
            receivedAt: new Date(),
            receivedById: await userOf(),
            receivedDate: new Date('2026-10-02'),
          },
        ],
        'ordered without number': [
          'Purchase_ordered_check',
          {
            reference: 'DA-0003',
            status: 'COMMANDEE',
            validatedAt: new Date(),
            validatedById: await userOf(),
            orderedAt: new Date(),
            orderedById: await userOf(),
          },
        ],
        'author without timestamp': [
          'Purchase_validated_check',
          {
            reference: 'DA-0004',
            validatedById: await userOf(),
          },
        ],
        'cancelled without reason': [
          'Purchase_cancelled_check',
          {
            reference: 'DA-0005',
            status: 'ANNULEE',
            cancelledAt: new Date(),
            cancelledById: await userOf(),
          },
        ],
        'bad reference': ['Purchase_reference_check', { reference: 'XX-1' }],
      };
      for (const [, [constraint, data]] of Object.entries(cases)) {
        await expect(
          prisma.purchase.create({
            data: { ...(await base()), ...data } as never,
          }),
        ).rejects.toThrow(constraint);
      }
      expect(await prisma.purchase.count()).toBe(0);
    });

    it('refuses non-positive quantities, negative prices and payments, and a lot on a line not received', async () => {
      const p = await prisma.purchase.create({
        data: { ...(await base()), reference: 'DA-0001' },
      });
      // The stored amount and category follow the line, so each case reaches the constraint it is about.
      const line = (over: {
        quantity?: number;
        unitPrice?: number;
        receivedQuantity?: number;
        [key: string]: unknown;
      }) => {
        const { quantity = 1, unitPrice = 1, receivedQuantity } = over;
        return prisma.purchaseItem.create({
          data: {
            purchaseId: p.id,
            stockItemId: itemId,
            position: 0,
            quantity,
            unitPrice,
            amount: lineAmount(receivedQuantity ?? quantity, unitPrice),
            ...(receivedQuantity
              ? { expenseCategory: 'ALIMENT' as const }
              : {}),
            ...over,
          },
        });
      };
      await expect(line({ quantity: 0 })).rejects.toThrow(
        'PurchaseItem_quantity_check',
      );
      await expect(line({ unitPrice: -1 })).rejects.toThrow(
        'PurchaseItem_unitPrice_check',
      );
      await expect(line({ receivedQuantity: -1 })).rejects.toThrow(
        'PurchaseItem_receivedQuantity_check',
      );
      await expect(
        line({ quantity: 5, receivedQuantity: 5.01 }),
      ).rejects.toThrow('PurchaseItem_received_le_quantity_check');
      await expect(line({ lotNumber: 'L1' })).rejects.toThrow(
        'PurchaseItem_lot_check',
      );
      await expect(
        line({ receivedQuantity: 0, expiryDate: new Date('2027-01-01') }),
      ).rejects.toThrow('PurchaseItem_lot_check');
      await line({ quantity: 5, receivedQuantity: 5, lotNumber: 'L1' });
      await expect(
        prisma.supplierPayment.create({
          data: {
            farmId: world.farmId,
            purchaseId: p.id,
            date: new Date('2026-10-02'),
            amount: 0,
            method: 'ESPECES',
            createdById: await userOf(),
          },
        }),
      ).rejects.toThrow('SupplierPayment_amount_check');
    });

    it('refuses stored amounts and categories that contradict their line', async () => {
      const p = await prisma.purchase.create({
        data: { ...(await base()), reference: 'DA-0001' },
      });
      const line = (over: object) =>
        prisma.purchaseItem.create({
          data: {
            purchaseId: p.id,
            stockItemId: itemId,
            position: 0,
            quantity: 3,
            unitPrice: 1.1,
            amount: 3.3,
            ...over,
          },
        });
      await expect(line({ amount: 3.31 })).rejects.toThrow(
        'PurchaseItem_amount_check',
      );
      // the amount follows the received quantity once there is one
      await expect(
        line({
          receivedQuantity: 2,
          expenseCategory: 'ALIMENT',
          lotNumber: 'L1',
        }),
      ).rejects.toThrow('PurchaseItem_amount_check');
      await expect(
        line({ receivedQuantity: 2, amount: 2.2, lotNumber: 'L1' }),
      ).rejects.toThrow('PurchaseItem_expenseCategory_check');
      await expect(line({ expenseCategory: 'SANTE' })).rejects.toThrow(
        'PurchaseItem_expenseCategory_check',
      );
      await expect(
        line({
          receivedQuantity: 0,
          amount: 0,
          expenseCategory: 'SANTE',
        }),
      ).rejects.toThrow('PurchaseItem_expenseCategory_check');
      await line({ receivedQuantity: 0, amount: 0 });
      await expect(
        prisma.purchase.update({ where: { id: p.id }, data: { amount: -1 } }),
      ).rejects.toThrow('Purchase_amount_check');
    });

    it('keeps references and order numbers unique per organisation and refuses deleting what is referenced', async () => {
      const first = await prisma.purchase.create({
        data: { ...(await base()), reference: 'DA-0001' },
      });
      await expect(
        prisma.purchase.create({
          data: { ...(await base()), reference: 'DA-0001' },
        }),
      ).rejects.toThrow(/Unique constraint failed/);
      const other = await createOrganization();
      const farm = await createFarm(other.id, 'Autre ferme');
      const user = await createUser({
        organizationId: other.id,
        role: 'DIRECTEUR_FERME',
      });
      const sup = await prisma.supplier.create({
        data: { organizationId: other.id, name: 'Autre' },
      });
      await prisma.purchase.create({
        data: {
          organizationId: other.id,
          farmId: farm.id,
          supplierId: sup.id,
          reference: 'DA-0001',
          date: new Date('2026-10-01'),
          requestedById: user.id,
        },
      });
      await expect(
        prisma.supplier.delete({ where: { id: supplierId } }),
      ).rejects.toThrow(/Foreign key constraint/);
      await expect(
        prisma.user.delete({ where: { id: first.requestedById } }),
      ).rejects.toThrow(/Foreign key constraint/);
    });
  });

  describe('fix round 1', () => {
    const stockState = async () => ({
      level: (await level()).quantity,
      movements: await prisma.stockMovement.count(),
      batches: await prisma.stockBatch.count(),
    });
    const items = (id: string) =>
      prisma.purchaseItem.findMany({
        where: { purchaseId: id },
        orderBy: { position: 'asc' },
      });

    it('refuses to receive a paid, received or cancelled purchase (409), changing nothing', async () => {
      const paid = await received();
      await pay(director, paid.id, 930000);
      const recv = await received();
      const cancelled = await ordered();
      await act(director, cancelled.id, 'cancel', { reason: 'x' });
      const before = await stockState();
      const amounts = async () =>
        (await http().get('/api/purchases').set(director).expect(200))
          .body as Page<Row>;
      const snapshot = (await amounts()).items.map((r) => [
        r.id,
        r.amount,
        r.status,
      ]);
      for (const p of [paid, recv, cancelled]) {
        await act(
          keeper,
          p.id,
          'receive',
          receiveBody({
            lines: [{ itemId, receivedQuantity: 1000, lotNumber: 'Z' }],
          }),
          409,
        );
      }
      expect(await stockState()).toEqual(before);
      expect(
        (await amounts()).items.map((r) => [r.id, r.amount, r.status]),
      ).toEqual(snapshot);
      expect((await get(paid.id)).status).toBe('PAYEE');
      expect((await items(paid.id))[0].receivedQuantity?.toNumber()).toBe(3000);
    });

    it('refuses to receive more than ordered (400) and accepts exactly the ordered quantity', async () => {
      const o = await ordered();
      const over = await act(
        keeper,
        o.id,
        'receive',
        receiveBody({ lines: [{ itemId, receivedQuantity: 3000.01 }] }),
        400,
      );
      expect(msg(over)).toBe('La quantité reçue dépasse la quantité commandée');
      expect(await prisma.stockMovement.count()).toBe(0);
      const ok = await act(
        keeper,
        o.id,
        'receive',
        receiveBody({ lines: [{ itemId, receivedQuantity: 3000 }] }),
      );
      expect(ok.lines[0].receivedQuantity).toBe(3000);
    });

    it('settles at reception a purchase worth 0', async () => {
      const free = await ordered({
        lines: [{ itemId, quantity: 10, unitPrice: 0 }],
      });
      const r = await act(
        keeper,
        free.id,
        'receive',
        receiveBody({
          lines: [{ itemId, receivedQuantity: 10 }],
        }),
      );
      expect(r).toMatchObject({ status: 'PAYEE', amount: 0, remaining: 0 });
      // The history tells it: settled by the reception itself.
      expect(r.history.map((h) => h.step)).toEqual([
        'DEMANDE',
        'VALIDEE',
        'COMMANDEE',
        'RECUE',
        'PAYEE',
      ]);
      const [recue, payee] = r.history.slice(-2);
      expect(payee).toMatchObject({ at: recue.at, by: recue.by });
      expect(payee.by).not.toBeNull();
      const mixed = await ordered({
        lines: [
          { itemId, quantity: 10, unitPrice: 5 },
          { itemId, quantity: 4, unitPrice: 0 },
        ],
      });
      const m = await act(
        keeper,
        mixed.id,
        'receive',
        receiveBody({
          lines: [
            { itemId, receivedQuantity: 0 },
            { itemId, receivedQuantity: 4 },
          ],
        }),
      );
      expect(m).toMatchObject({ status: 'PAYEE', amount: 0 });
      const priced = await received();
      expect(priced.status).toBe('RECUE');
    });

    it('refuses a payment dated before the reception and a payment on a cancelled purchase', async () => {
      const r = await received();
      expect(
        msg(await pay(director, r.id, 10, 400, { date: daysAgo(3) })),
      ).toBe('La date du paiement ne peut pas précéder la réception');
      await pay(director, r.id, 10, 201, { date: daysAgo(2) });
      const c = await ordered();
      await act(director, c.id, 'cancel', { reason: 'x' });
      await pay(director, c.id, 10, 409);
    });

    it('refuses null for required supplier and purchase fields (400, not 500)', async () => {
      await world.post(director, '/suppliers', { name: null }, 400);
      await world.post(
        director,
        '/suppliers',
        { name: 'Z', active: null },
        400,
      );
      for (const bodyOf of [{ name: null }, { active: null }]) {
        await http()
          .patch(`/api/suppliers/${supplierId}`)
          .set(director)
          .send(bodyOf)
          .expect(400);
      }
      const p = await request();
      for (const bodyOf of [
        { supplierId: null },
        { date: null },
        { lines: null },
      ]) {
        await http()
          .patch(`/api/purchases/${p.id}`)
          .set(stockMgr)
          .send(bodyOf)
          .expect(400);
      }
    });

    it('answers 403 before writing when a supplier PATCH names a farm the user cannot see', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const res = await http()
        .patch(`/api/suppliers/${supplierId}`)
        .set({ ...director, 'X-Farm-Id': farmB })
        .send({ phone: '777' });
      expect(res.status).toBe(403);
      expect(
        (await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } }))
          .phone,
      ).toBeNull();
    });

    it('never reuses a DA or BC number after a delete, and numbers parallel creates and orders distinctly', async () => {
      const a = await request();
      const b = await request();
      expect([a.reference, b.reference]).toEqual(['DA-0001', 'DA-0002']);
      await http().delete(`/api/purchases/${b.id}`).set(stockMgr).expect(200);
      expect((await request()).reference).toBe('DA-0003');
      const made = await Promise.all(
        [0, 1, 2, 3, 4].map(() =>
          http().post('/api/purchases').set(stockMgr).send(body()),
        ),
      );
      expect(made.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const refs = made.map((r) => (r.body as Detail).requestNumber);
      expect(new Set(refs).size).toBe(5);
      const ids = made.map((r) => (r.body as Detail).id);
      for (const id of ids) await act(director, id, 'validate');
      const orders = await Promise.all(
        ids.map((id) =>
          http().post(`/api/purchases/${id}/order`).set(director).send({}),
        ),
      );
      expect(orders.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const bcs = orders.map((r) => (r.body as Detail).orderNumber);
      expect(new Set(bcs).size).toBe(5);
      // a deleted ordered number cannot come back either: orders are never deleted,
      // but the counter is the highest number ever handed out
      const next = await ordered();
      expect(next.orderNumber).toBe('BC-0006');
    });

    it('sorts by the displayed reference and defaults to the newest date', async () => {
      const a = await request(stockMgr, { date: daysAgo(5) });
      const b = await request(stockMgr, { date: daysAgo(4) });
      const c = await request(stockMgr, { date: daysAgo(3) });
      await act(director, b.id, 'validate');
      await act(director, b.id, 'order');
      const list = async (sort?: string) =>
        (
          (
            await http()
              .get('/api/purchases')
              .query(sort ? { sort } : {})
              .set(director)
              .expect(200)
          ).body as Page<Row>
        ).items.map((r) => r.reference);
      expect(await list()).toEqual([c.reference, 'BC-0001', a.reference]);
      expect(await list('reference:asc')).toEqual([
        'BC-0001',
        a.reference,
        c.reference,
      ]);
      expect(await list('reference:desc')).toEqual([
        c.reference,
        a.reference,
        'BC-0001',
      ]);
    });

    it('caps the total of a purchase (400)', async () => {
      const big = { itemId, quantity: 999999, unitPrice: 1000000 };
      const res = await request(director, { lines: [big, big] }, 400);
      expect(msg(res)).toBe('Le montant total est trop élevé');
      const p = await request(director, { lines: [big] });
      expect(p.amount).toBe(999999000000);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(director)
        .send({ lines: [big, big] })
        .expect(400);
    });

    it('writes no audit row for an empty or no-op PATCH', async () => {
      const p = await request();
      const count = () => prisma.auditLog.count();
      const before = await count();
      for (const payload of [
        {},
        { note: null },
        {
          supplierId,
          date: p.date,
          lines: [{ itemId, quantity: 3000, unitPrice: 310 }],
        },
      ]) {
        await http()
          .patch(`/api/purchases/${p.id}`)
          .set(stockMgr)
          .send(payload)
          .expect(200);
      }
      expect(await count()).toBe(before);
      await http()
        .patch(`/api/suppliers/${supplierId}`)
        .set(director)
        .send({})
        .expect(200);
      await http()
        .patch(`/api/suppliers/${supplierId}`)
        .set(director)
        .send({ name: 'Agro Provende SA' })
        .expect(200);
      expect(await count()).toBe(before);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(stockMgr)
        .send({ note: 'vraiment' })
        .expect(200);
      expect(await count()).toBe(before + 1);
    });

    it('serialises a cancellation against a reception: one wins, the stock agrees', async () => {
      for (let round = 0; round < 3; round++) {
        const o = await ordered();
        const [r, c] = await Promise.all([
          http()
            .post(`/api/purchases/${o.id}/receive`)
            .set(keeper)
            .send(receiveBody()),
          http()
            .post(`/api/purchases/${o.id}/cancel`)
            .set(director)
            .send({ reason: 'course' }),
        ]);
        expect([r.status, c.status].sort()).toEqual([201, 409]);
        const d = await get(o.id);
        const moves = await prisma.stockMovement.count({
          where: { sourceId: o.id },
        });
        expect(d.status).toBe(r.status === 201 ? 'RECUE' : 'ANNULEE');
        expect(moves).toBe(r.status === 201 ? 1 : 0);
      }
    });

    it('serialises an edit against a validation', async () => {
      for (let round = 0; round < 3; round++) {
        const p = await request();
        const [edit, validate] = await Promise.all([
          http()
            .patch(`/api/purchases/${p.id}`)
            .set(stockMgr)
            .send({ lines: [{ itemId, quantity: 1, unitPrice: 1 }] }),
          http().post(`/api/purchases/${p.id}/validate`).set(director).send({}),
        ]);
        expect(validate.status).toBe(201);
        expect([200, 409]).toContain(edit.status);
        const d = await get(p.id);
        expect(d.status).toBe('VALIDEE');
        expect(d.lines[0].quantity).toBe(edit.status === 200 ? 1 : 3000);
      }
    });

    it('keeps purchase stock entries out of reach of the manual movement routes (409)', async () => {
      await received();
      const mv = await prisma.stockMovement.findFirstOrThrow();
      await http()
        .patch(`/api/stock/movements/${mv.id}`)
        .set(director)
        .send({ quantity: 1 })
        .expect(409);
      await http()
        .delete(`/api/stock/movements/${mv.id}`)
        .set(director)
        .expect(409);
      expect((await level()).quantity).toBe(3000);
    });

    it('refuses validate, order and payment deletion under all farms', async () => {
      const all = {
        ...(await world.actor('SUPER_ADMIN')),
        'X-Farm-Id': 'all',
      };
      const p = await request();
      await act(all, p.id, 'validate', {}, 403);
      await act(director, p.id, 'validate');
      await act(all, p.id, 'order', {}, 403);
      const r = await received();
      const paid = await pay(director, r.id, 5);
      await http()
        .delete(`/api/purchases/${r.id}/payments/${paid.payments[0].id}`)
        .set(all)
        .expect(403);
      expect((await get(r.id)).payments).toHaveLength(1);
    });
  });

  describe('stored amounts, expense category, activity and counters', () => {
    interface Stored {
      amount: string;
      lines: { amount: string; expenseCategory: string | null }[];
    }
    /** What the database holds for one purchase, read raw (the column is the truth finance reads). */
    const stored = async (id: string): Promise<Stored> => {
      const [p] = await prisma.$queryRaw<{ amount: string }[]>`
        SELECT "amount"::text AS amount FROM "Purchase" WHERE id = ${id}`;
      const lines = await prisma.$queryRaw<
        { amount: string; expenseCategory: string | null }[]
      >`SELECT "amount"::text AS amount, "expenseCategory"::text AS "expenseCategory"
        FROM "PurchaseItem" WHERE "purchaseId" = ${id} ORDER BY "position"`;
      return { amount: p.amount, lines };
    };
    /** Purchases whose stored amount is not the sum of their stored line amounts. */
    const drifting = () =>
      prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "Purchase" p
        WHERE p."amount" <> COALESCE(
          (SELECT SUM(i."amount") FROM "PurchaseItem" i WHERE i."purchaseId" = p.id), 0)`;

    it('stores 930 000 on create, 868 000 and ALIMENT on reception, and keeps the category when the article changes', async () => {
      const p = await request();
      expect(await stored(p.id)).toEqual({
        amount: '930000.00',
        lines: [{ amount: '930000.00', expenseCategory: null }],
      });
      await act(director, p.id, 'validate');
      await act(director, p.id, 'order');
      const recv = await act(
        keeper,
        p.id,
        'receive',
        receiveBody({
          lines: [{ itemId, receivedQuantity: 2800, lotNumber: 'L1' }],
        }),
      );
      expect(recv.amount).toBe(868000);
      expect(await stored(p.id)).toEqual({
        amount: '868000.00',
        lines: [{ amount: '868000.00', expenseCategory: 'ALIMENT' }],
      });
      await prisma.stockItem.update({
        where: { id: itemId },
        data: { category: 'CONSOMMABLE' },
      });
      expect((await stored(p.id)).lines[0].expenseCategory).toBe('ALIMENT');
      expect(await supplierBalance()).toBe(868000);
      expect(await drifting()).toEqual([]);
    });

    it('reads the supplier balance from the stored column', async () => {
      const p = await received();
      expect(await supplierBalance()).toBe(930000);
      await prisma.$executeRaw`UPDATE "Purchase" SET "amount" = 1234 WHERE id = ${p.id}`;
      expect(await supplierBalance()).toBe(1234);
    });

    it('keeps Purchase.amount equal to the sum of its line amounts after create, edit, reception and for a zero amount', async () => {
      const second = (await stockItem('Maïs')).id;
      // rounding per line, then sum: 2.5 × 333.33 = 833.33 and 0.5 × 0.05 = 0.03 (0.025 rounds up)
      const p = await request(stockMgr, {
        lines: [
          { itemId, quantity: 2.5, unitPrice: 333.33 },
          { itemId: second, quantity: 0.5, unitPrice: 0.05 },
          { itemId: second, quantity: 0.5, unitPrice: 0.05 },
        ],
      });
      expect(p.amount).toBe(833.39);
      expect(await stored(p.id)).toEqual({
        amount: '833.39',
        lines: [
          { amount: '833.33', expenseCategory: null },
          { amount: '0.03', expenseCategory: null },
          { amount: '0.03', expenseCategory: null },
        ],
      });
      const edited = (
        await http()
          .patch(`/api/purchases/${p.id}`)
          .set(stockMgr)
          .send({ lines: [{ itemId, quantity: 4, unitPrice: 12.5 }] })
          .expect(200)
      ).body as Detail;
      expect(edited.amount).toBe(50);
      expect(await stored(p.id)).toEqual({
        amount: '50.00',
        lines: [{ amount: '50.00', expenseCategory: null }],
      });
      await act(director, p.id, 'validate');
      await act(director, p.id, 'order');
      await act(keeper, p.id, 'receive', {
        date: daysAgo(2),
        lines: [{ itemId, receivedQuantity: 3.3 }],
      });
      expect(await stored(p.id)).toEqual({
        amount: '41.25',
        lines: [{ amount: '41.25', expenseCategory: 'ALIMENT' }],
      });
      // a purchase worth 0: stored 0, settled at reception
      const free = await request(stockMgr, {
        lines: [{ itemId, quantity: 5, unitPrice: 0 }],
      });
      await act(director, free.id, 'validate');
      await act(director, free.id, 'order');
      const got = await act(keeper, free.id, 'receive', {
        date: daysAgo(2),
        lines: [{ itemId, receivedQuantity: 5 }],
      });
      expect(got).toMatchObject({ status: 'PAYEE', amount: 0 });
      expect((await stored(free.id)).amount).toBe('0.00');
      expect(await drifting()).toEqual([]);
    });

    it('returns on every line the stored amount and the ordered amount', async () => {
      const second = (await stockItem('Maïs')).id;
      const p = await ordered({
        lines: [
          { itemId, quantity: 10, unitPrice: 5 },
          { itemId: second, quantity: 0.7, unitPrice: 12.25 },
        ],
      });
      const open = await get(p.id);
      expect(open.lines.map((l) => [l.amount, l.orderedAmount])).toEqual([
        [50, 50],
        [8.58, 8.58],
      ]);
      await act(keeper, p.id, 'receive', {
        date: daysAgo(2),
        lines: [
          { itemId, receivedQuantity: 8 },
          { itemId: second, receivedQuantity: 0.7 },
        ],
      });
      const got = await get(p.id);
      expect(got.lines.map((l) => [l.amount, l.orderedAmount])).toEqual([
        [40, 50],
        [8.58, 8.58],
      ]);
      expect(got.amount).toBe(48.58);
    });

    it('gives a line received at 0 neither a category nor an amount', async () => {
      const second = (await stockItem('Maïs')).id;
      const p = await ordered({
        lines: [
          { itemId, quantity: 10, unitPrice: 100 },
          { itemId: second, quantity: 10, unitPrice: 50 },
        ],
      });
      await act(keeper, p.id, 'receive', {
        date: daysAgo(2),
        lines: [
          { itemId, receivedQuantity: 10 },
          { itemId: second, receivedQuantity: 0 },
        ],
      });
      expect(await stored(p.id)).toEqual({
        amount: '1000.00',
        lines: [
          { amount: '1000.00', expenseCategory: 'ALIMENT' },
          { amount: '0.00', expenseCategory: null },
        ],
      });
    });

    it('snapshots the category of each article at reception', async () => {
      const med = (
        await stockItem('Amoxicilline', {
          category: 'MEDICAMENT',
          unit: 'flacon',
        })
      ).id;
      const vac = (
        await stockItem('Gumboro', { category: 'VACCIN', unit: 'flacon' })
      ).id;
      const mat = (
        await stockItem('Abreuvoir', { category: 'MATERIEL', unit: 'pièce' })
      ).id;
      const con = (
        await stockItem('Gants', { category: 'CONSOMMABLE', unit: 'boîte' })
      ).id;
      const ids = [itemId, med, vac, mat, con];
      const p = await ordered({
        lines: ids.map((id) => ({ itemId: id, quantity: 1, unitPrice: 10 })),
      });
      await act(keeper, p.id, 'receive', {
        date: daysAgo(2),
        lines: ids.map((id) => ({ itemId: id, receivedQuantity: 1 })),
      });
      expect((await stored(p.id)).lines.map((l) => l.expenseCategory)).toEqual([
        'ALIMENT',
        'SANTE',
        'SANTE',
        'MATERIEL',
        'CONSOMMABLES',
      ]);
    });

    it('carries an activity, Général by default, editable only in DEMANDE', async () => {
      expect((await request()).activity).toBe('GENERAL');
      const p = await request(stockMgr, { activity: 'AVICOLE' });
      expect(p.activity).toBe('AVICOLE');
      expect((await get(p.id)).activity).toBe('AVICOLE');
      const listed = (
        await http().get('/api/purchases').set(director).expect(200)
      ).body as Page<Row & { activity: string }>;
      expect(listed.items.map((r) => r.activity).sort()).toEqual([
        'AVICOLE',
        'GENERAL',
      ]);
      const patched = (
        await http()
          .patch(`/api/purchases/${p.id}`)
          .set(stockMgr)
          .send({ activity: 'PORCIN' })
          .expect(200)
      ).body as Detail;
      expect(patched.activity).toBe('PORCIN');
      await act(director, p.id, 'validate');
      const res = await http()
        .patch(`/api/purchases/${p.id}`)
        .set(stockMgr)
        .send({ activity: 'AVICOLE' })
        .expect(409);
      expect(msg(res.body)).toBe('Seule une demande peut être modifiée');
      expect((await get(p.id)).activity).toBe('PORCIN');
    });

    it('refuses an unknown or null activity (400)', async () => {
      await request(stockMgr, { activity: 'MARIN' }, 400);
      await request(stockMgr, { activity: null }, 400);
      const p = await request();
      for (const activity of ['MARIN', null]) {
        await http()
          .patch(`/api/purchases/${p.id}`)
          .set(stockMgr)
          .send({ activity })
          .expect(400);
      }
    });

    it('numbers on the DocumentCounter table, per organisation and kind', async () => {
      const p = await request();
      await act(director, p.id, 'validate');
      await act(director, p.id, 'order');
      await request();
      const rows = await prisma.$queryRaw<
        { organizationId: string; kind: string; last: number }[]
      >`SELECT "organizationId", "kind", "last" FROM "DocumentCounter" ORDER BY "kind"`;
      expect(rows).toEqual([
        { organizationId: world.orgId, kind: 'BC', last: 1 },
        { organizationId: world.orgId, kind: 'DA', last: 2 },
      ]);
    });
  });

  describe('audit', () => {
    it('writes exactly one audit row per write, in the same transaction', async () => {
      const stockRows = await prisma.auditLog.count({
        where: { module: 'stocks' },
      });
      const p = await request(stockMgr);
      await http()
        .patch(`/api/purchases/${p.id}`)
        .set(stockMgr)
        .send({ note: 'n' })
        .expect(200);
      await act(director, p.id, 'validate');
      await act(director, p.id, 'order');
      await act(keeper, p.id, 'receive', receiveBody());
      const paid = await pay(director, p.id, 100);
      await http()
        .delete(`/api/purchases/${p.id}/payments/${paid.payments[0].id}`)
        .set(director)
        .expect(200);
      const q = await request(stockMgr);
      await act(director, q.id, 'cancel', { reason: 'x' });
      const r = await request(stockMgr);
      await http().delete(`/api/purchases/${r.id}`).set(stockMgr).expect(200);

      const rows = await prisma.auditLog.findMany({
        where: { module: 'achats' },
        orderBy: { createdAt: 'asc' },
      });
      const summary = rows.map((x) =>
        `${x.action}:${x.label ?? ''}`.replace(/ ·.*/, ''),
      );
      expect(rows).toHaveLength(11);
      expect(summary.filter((s) => s.startsWith('CREATE'))).toHaveLength(4);
      expect(rows.filter((x) => x.action === 'DELETE')).toHaveLength(2);
      expect(rows.filter((x) => x.recordId === p.id)).toHaveLength(5);
      // the ledger does not add its own row: the purchase audits the reception
      expect(await prisma.auditLog.count({ where: { module: 'stocks' } })).toBe(
        stockRows,
      );
      expect(rows.every((x) => x.farmId === world.farmId)).toBe(true);
    });

    it('writes no audit row when the write is refused', async () => {
      const p = await request(stockMgr);
      const before = await prisma.auditLog.count();
      await act(keeper, p.id, 'receive', receiveBody(), 409);
      await pay(director, p.id, 1, 409);
      expect(await prisma.auditLog.count()).toBe(before);
    });
  });
});
