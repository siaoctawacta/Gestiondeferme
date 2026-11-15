import { INestApplication } from '@nestjs/common';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface Res {
  status: number;
  body: {
    message?: string | string[];
    number?: string;
    id?: string;
    status?: string;
    due?: number;
    paid?: number;
    credited?: number;
    refundDue?: number;
    lines?: { id: string }[];
    payments?: { number: string }[];
  };
}

/** Real pool, real HTTP: payments, refunds and credit notes racing each other and the sales on the same lots and articles. */
describe('Client payments and credit notes under concurrency (real pool)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let accountant: Headers;
  let seller: Headers;
  let stockMgr: Headers;
  let customerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    accountant = await world.actor('COMPTABLE');
    seller = await world.actor('COMMERCIAL');
    stockMgr = await world.actor('RESP_STOCK');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const message = (r: Res) =>
    Array.isArray(r.body.message) ? r.body.message.join(' | ') : r.body.message;
  const send = (
    method: 'post' | 'get',
    path: string,
    h: Headers,
    payload: object = {},
  ): Promise<Res> =>
    http()
      [method](`/api${path}`)
      .set(h)
      .send(payload)
      .then((r) => ({ status: r.status, body: r.body as Res['body'] }));
  const issued = async (lines: unknown[], date = daysAgo(3)) =>
    (
      await send('post', '/sales/issued', accountant, {
        customerId,
        date,
        lines,
      })
    ).body;
  const pay = (id: string, amount: number, over: object = {}) =>
    send('post', `/sales/${id}/payments`, accountant, {
      date: daysAgo(1),
      amount,
      method: 'ESPECES',
      ...over,
    });
  const credit = (
    invoice: Res['body'],
    quantity: number,
    withReturn = false,
    lineIndex = 0,
  ) =>
    send('post', `/sales/${invoice.id}/credit-notes`, accountant, {
      date: daysAgo(1),
      reason: 'Retour',
      withReturn,
      lines: [{ lineId: invoice.lines?.[lineIndex].id, quantity }],
    });
  const lotLine = (batchId: string, quantity: number) => ({
    kind: 'LOT',
    batchId,
    quantity,
    unitPrice: 3500,
  });
  const itemLine = (stockItemId: string, quantity: number) => ({
    kind: 'ARTICLE',
    stockItemId,
    quantity,
    unitPrice: 450,
  });
  const alive = async (id: string) =>
    (await app.get(HerdLedgerService).liveCounts([id])).get(id);
  async function article(quantity: number, name = 'Aliment ponte') {
    const item = await world.post<Id>(stockMgr, '/stock-items', {
      name,
      category: 'ALIMENT',
      unit: 'kg',
    });
    await world.post(stockMgr, '/stock/movements', {
      itemId: item.id,
      type: 'ENTREE',
      date: daysAgo(40),
      quantity,
      unitCost: 320,
      reason: 'ACHAT',
    });
    return item.id;
  }
  const level = async (id: string) =>
    (
      (await http().get(`/api/stock/${id}`).set(director).expect(200)).body as {
        quantity: number;
      }
    ).quantity;
  const noServerError = (rs: Res[]) =>
    expect(rs.filter((r) => r.status >= 500)).toEqual([]);
  const get = async (id: string) =>
    (await send('get', `/sales/${id}`, accountant)).body;
  const counter = async (kind: string) =>
    (
      await prisma.$queryRawUnsafe<{ last: number }[]>(
        `SELECT "last" FROM "DocumentCounter" WHERE "kind" = '${kind}'`,
      )
    )[0]?.last ?? null;

  it('four payments of 400 000 on 930 000 at once: exactly two go through, never overpaid, two receipt numbers', async () => {
    const lot = await world.lot(director, { initialCount: 400 });
    const inv = await issued([{ ...lotLine(lot.id, 310), unitPrice: 3000 }]);
    expect(inv.due).toBe(930000);
    const rs = await Promise.all(
      Array.from({ length: 4 }, () => pay(inv.id as string, 400000)),
    );
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 201, 400, 400]);
    for (const r of rs.filter((x) => x.status === 400)) {
      expect(message(r)).toBe('Le montant dépasse le reste dû');
    }
    const after = await get(inv.id as string);
    expect(after).toMatchObject({
      paid: 800000,
      due: 130000,
      status: 'PARTIELLE',
    });
    expect(after.payments?.map((p) => p.number).sort()).toEqual([
      'RC-0001',
      'RC-0002',
    ]);
    expect(await counter('RC')).toBe(2);
  });

  it('a payment and the deletion of another payment of the same invoice serialise: the status always matches the rows', async () => {
    for (let round = 0; round < 3; round++) {
      const lot = await world.lot(director, { initialCount: 100 });
      const inv = await issued([lotLine(lot.id, 10)]); // 35 000
      const first = await pay(inv.id as string, 20000);
      const paymentId = (
        first.body as unknown as { payments: { id: string }[] }
      ).payments[0].id;
      const [add, del] = await Promise.all([
        pay(inv.id as string, 15000),
        http()
          .delete(`/api/sales/${inv.id}/payments/${paymentId}`)
          .set(accountant)
          .then((r) => ({ status: r.status, body: r.body as Res['body'] })),
      ]);
      noServerError([add, del]);
      expect(add.status).toBe(201);
      expect(del.status).toBe(200);
      const after = await get(inv.id as string);
      expect(after).toMatchObject({ paid: 15000, due: 20000 });
      expect(after.status).toBe('PARTIELLE');
    }
  });

  it('a payment racing a credit note: whichever commits first, the invoice ends coherent (due and refund due never negative, status from the rows)', async () => {
    for (let round = 0; round < 4; round++) {
      const lot = await world.lot(director, { initialCount: 400 });
      const inv = await issued([lotLine(lot.id, 300)]); // 1 050 000
      const [p, c] = await Promise.all([
        pay(inv.id as string, 1050000),
        credit(inv, 30),
      ]);
      noServerError([p, c]);
      expect(c.status).toBe(201);
      const after = await get(inv.id as string);
      if (p.status === 201) {
        // the credit note came second: 105 000 are owed back
        expect(after).toMatchObject({
          paid: 1050000,
          credited: 105000,
          due: 0,
          refundDue: 105000,
          status: 'SOLDEE',
        });
      } else {
        // the credit note came first: the payment no longer fitted in what was due
        expect(p.status).toBe(400);
        expect(message(p)).toBe('Le montant dépasse le reste dû');
        expect(after).toMatchObject({
          paid: 0,
          credited: 105000,
          due: 945000,
          refundDue: 0,
          status: 'EMISE',
        });
      }
    }
  });

  it('two credit notes of 200 on a line of 300 at once: one 201, one 400 naming what is left, never over-credited', async () => {
    for (let round = 0; round < 3; round++) {
      const lot = await world.lot(director, { initialCount: 400 });
      const inv = await issued([lotLine(lot.id, 300)]);
      const rs = await Promise.all([
        credit(inv, 200, true),
        credit(inv, 200, true),
      ]);
      noServerError(rs);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(message(rs.find((r) => r.status === 400) as Res)).toBe(
        'La quantité dépasse la quantité restant à créditer (100)',
      );
      const after = await get(inv.id as string);
      expect(after.credited).toBe(700000);
      expect(await alive(lot.id)).toBe(100 + 200);
    }
    expect(await counter('AV')).toBe(3);
  });

  it('a credit note with return racing a sale on the same lot: the lot ends where the order of the two says, no 500, no deadlock', async () => {
    for (let round = 0; round < 4; round++) {
      const lot = await world.lot(director, { initialCount: 400 });
      const inv = await issued([lotLine(lot.id, 300)]); // 100 left
      const sale = (): Promise<Res> =>
        send('post', '/sales/issued', accountant, {
          customerId,
          date: daysAgo(2),
          lines: [lotLine(lot.id, 120)],
        });
      const [c, s] = await Promise.all([credit(inv, 30, true), sale()]);
      noServerError([c, s]);
      expect(c.status).toBe(201);
      if (s.status === 201) {
        // the return came first: 130 birds were there for 120
        expect(await alive(lot.id)).toBe(10);
      } else {
        expect(s.status).toBe(400);
        expect(message(s)).toBe('Effectif insuffisant');
        expect(await alive(lot.id)).toBe(130);
      }
    }
  });

  it('a credit note with return racing a sale of the same article: the level ends where the order of the two says', async () => {
    for (let round = 0; round < 4; round++) {
      const item = await article(100, `Aliment ${round}`);
      const inv = await issued([itemLine(item, 100)]); // level 0
      const sale = (): Promise<Res> =>
        send('post', '/sales/issued', accountant, {
          customerId,
          date: daysAgo(2),
          lines: [itemLine(item, 40)],
        });
      const [c, s] = await Promise.all([credit(inv, 40, true), sale()]);
      noServerError([c, s]);
      expect(c.status).toBe(201);
      if (s.status === 201) {
        expect(await level(item)).toBe(0);
      } else {
        expect(s.status).toBe(400);
        expect(message(s)).toContain('Stock insuffisant pour');
        expect(await level(item)).toBe(40);
      }
    }
  });

  it('credit notes with return and invoices taking the same lots and articles in opposite orders do not deadlock', async () => {
    const lots = [
      await world.lot(director, { initialCount: 1000 }),
      await world.lot(director, { initialCount: 1000 }),
    ];
    const items = [await article(5000, 'A'), await article(5000, 'B')];
    const bases = await Promise.all(
      [0, 1, 2, 3].map(() =>
        issued([
          lotLine(lots[0].id, 20),
          lotLine(lots[1].id, 20),
          itemLine(items[0], 20),
          itemLine(items[1], 20),
        ]),
      ),
    );
    const work: Promise<Res>[] = [];
    bases.forEach((inv, i) => {
      const reverse = i % 2 === 1;
      const order = reverse ? [3, 2, 1, 0] : [0, 1, 2, 3];
      work.push(
        send('post', `/sales/${inv.id}/credit-notes`, accountant, {
          date: daysAgo(1),
          reason: 'Retour',
          withReturn: true,
          lines: order.map((idx) => ({
            lineId: inv.lines?.[idx].id,
            quantity: 5,
          })),
        }),
      );
      work.push(
        send('post', '/sales/issued', accountant, {
          customerId,
          date: daysAgo(2),
          lines: reverse
            ? [
                itemLine(items[1], 10),
                lotLine(lots[1].id, 10),
                itemLine(items[0], 10),
                lotLine(lots[0].id, 10),
              ]
            : [
                lotLine(lots[0].id, 10),
                itemLine(items[0], 10),
                lotLine(lots[1].id, 10),
                itemLine(items[1], 10),
              ],
        }),
      );
    });
    const rs = await Promise.all(work);
    noServerError(rs);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(await alive(lots[0].id)).toBe(1000 - 4 * 20 + 4 * 5 - 4 * 10);
    expect(await level(items[0])).toBe(5000 - 4 * 20 + 4 * 5 - 4 * 10);
  });

  it('six invoices issued with a payment at once get six distinct FA and RC numbers without gaps', async () => {
    const lot = await world.lot(director, { initialCount: 1000 });
    const rs = await Promise.all(
      Array.from({ length: 6 }, () =>
        send('post', '/sales/issued', accountant, {
          customerId,
          date: daysAgo(2),
          lines: [lotLine(lot.id, 5)],
          payment: { amount: 1000, method: 'ESPECES' },
        }),
      ),
    );
    noServerError(rs);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(rs.map((r) => r.body.number).sort()).toEqual(
      Array.from({ length: 6 }, (_v, i) => `FA-000${i + 1}`),
    );
    expect(rs.map((r) => r.body.payments?.[0].number).sort()).toEqual(
      Array.from({ length: 6 }, (_v, i) => `RC-000${i + 1}`),
    );
  });
});
