import { INestApplication } from '@nestjs/common';
import type { Role } from '../src/generated/prisma/enums';
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
  supplierId: string;
  supplierPhone: string | null;
  supplierAddress: string | null;
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
      expect(detail.history[0].by).toBeTruthy();
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
      expect(await m({ lines: [] })).toBeDefined();
      expect(
        await m({ lines: [{ itemId, receivedQuantity: -1 }] }),
      ).toBeDefined();
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
    const CHECK = /check constraint/i;
    const userOf = async () => (await prisma.user.findFirstOrThrow()).id;
    const base = async () => ({
      organizationId: world.orgId,
      farmId: world.farmId,
      supplierId,
      date: new Date('2026-10-01'),
      requestedById: await userOf(),
    });

    it('refuses a status that disagrees with its timestamps, a bad reference, and orphan authors', async () => {
      const cases: Record<string, object> = {
        'validated without status': {
          reference: 'DA-0001',
          validatedAt: new Date(),
          validatedById: await userOf(),
        },
        'received without being ordered': {
          reference: 'DA-0002',
          status: 'RECUE',
          receivedAt: new Date(),
          receivedById: await userOf(),
          receivedDate: new Date('2026-10-02'),
        },
        'ordered without number': {
          reference: 'DA-0003',
          status: 'COMMANDEE',
          validatedAt: new Date(),
          validatedById: await userOf(),
          orderedAt: new Date(),
          orderedById: await userOf(),
        },
        'author without timestamp': {
          reference: 'DA-0004',
          validatedById: await userOf(),
        },
        'cancelled without reason': {
          reference: 'DA-0005',
          status: 'ANNULEE',
          cancelledAt: new Date(),
          cancelledById: await userOf(),
        },
        'bad reference': { reference: 'XX-1' },
      };
      for (const [name, data] of Object.entries(cases)) {
        await expect(
          prisma.purchase.create({
            data: { ...(await base()), ...data } as never,
          }),
        ).rejects.toThrow(CHECK);
        expect(name).toBeTruthy();
      }
      expect(await prisma.purchase.count()).toBe(0);
    });

    it('refuses non-positive quantities, negative prices and payments, and a lot on a line not received', async () => {
      const p = await prisma.purchase.create({
        data: { ...(await base()), reference: 'DA-0001' },
      });
      const line = (over: object) =>
        prisma.purchaseItem.create({
          data: {
            purchaseId: p.id,
            stockItemId: itemId,
            position: 0,
            quantity: 1,
            unitPrice: 1,
            ...over,
          },
        });
      await expect(line({ quantity: 0 })).rejects.toThrow(CHECK);
      await expect(line({ unitPrice: -1 })).rejects.toThrow(CHECK);
      await expect(line({ receivedQuantity: -1 })).rejects.toThrow(CHECK);
      await expect(line({ lotNumber: 'L1' })).rejects.toThrow(CHECK);
      await expect(
        line({ receivedQuantity: 0, expiryDate: new Date('2027-01-01') }),
      ).rejects.toThrow(CHECK);
      await line({ receivedQuantity: 5, lotNumber: 'L1' });
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
      ).rejects.toThrow(CHECK);
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
