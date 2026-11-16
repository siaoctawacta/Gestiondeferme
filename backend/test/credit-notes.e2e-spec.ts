import { INestApplication } from '@nestjs/common';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { lockRow } from '../src/common/lock-row';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockLedgerService } from '../src/stock/stock-ledger.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface Line {
  id: string;
  kind: string;
  quantity: number;
  amount: number;
  creditedQuantity: number;
  creditableQuantity: number;
  creditableAmount: number;
}
interface Payment {
  id: string;
  number: string;
  kind: string;
  amount: number;
}
interface Step {
  step: string;
  note?: string | null;
}
interface CreditSummary {
  id: string;
  number: string;
  date: string;
  reason: string;
  withReturn: boolean;
  total: number;
}
interface Detail extends Id {
  number: string | null;
  date: string;
  status: string;
  total: number;
  paid: number;
  credited: number;
  refunded: number;
  due: number;
  refundDue: number;
  lines: Line[];
  payments: Payment[];
  creditNotes: CreditSummary[];
  history: Step[];
}
interface CreditRow extends CreditSummary {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
}
interface CreditDetail extends CreditRow {
  customerPhone: string | null;
  customerAddress: string | null;
  lines: {
    id: string;
    invoiceLineId: string;
    kind: string;
    designation: string;
    unit: string | null;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
}
interface Page<T> {
  items: T[];
  total: number;
}
interface Level {
  quantity: number;
  averageCost: number;
  batches: { lotNumber: string | null; quantity: number }[];
}

describe('Credit notes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let seller: Headers;
  let accountant: Headers;
  let director: Headers;
  let keeper: Headers;
  let owner: Headers;
  let stockMgr: Headers;
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
    stockMgr = await world.actor('RESP_STOCK');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
        phone: '+228 93 12 34 56',
        address: 'Rue 12, Lomé',
      })
    ).id;
    lotId = (await world.lot(director, { initialCount: 400 })).id;
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
  const alive = async (id: string) =>
    (await app.get(HerdLedgerService).liveCounts([id])).get(id);
  const lotLine = (over: Record<string, unknown> = {}) => ({
    kind: 'LOT',
    batchId: lotId,
    quantity: 300,
    unitPrice: 3500,
    ...over,
  });
  const body = (over: Record<string, unknown> = {}) => ({
    customerId,
    date: daysAgo(5),
    lines: [lotLine()],
    ...over,
  });
  const issued = (over: Record<string, unknown> = {}, h = accountant) =>
    world.post<Detail>(h, '/sales/issued', body(over));
  const get = async (id: string, h = seller) =>
    (await http().get(`/api/sales/${id}`).set(h).expect(200)).body as Detail;
  const creditReq = (
    id: string,
    payload: Record<string, unknown>,
    h = accountant,
    status = 201,
  ) =>
    http()
      .post(`/api/sales/${id}/credit-notes`)
      .set(h)
      .send(payload)
      .expect(status);
  /** A credit note of `[lineIndex, quantity]` pairs on the invoice's lines. */
  const credit = async (
    inv: Detail,
    picks: [number, number][],
    over: Record<string, unknown> = {},
    h = accountant,
    status = 201,
  ) =>
    creditReq(
      inv.id,
      {
        date: daysAgo(1),
        reason: 'Marchandise non conforme',
        withReturn: false,
        lines: picks.map(([i, quantity]) => ({
          lineId: inv.lines[i].id,
          quantity,
        })),
        ...over,
      },
      h,
      status,
    );
  const pay = (
    id: string,
    amount: number,
    over: Record<string, unknown> = {},
    h = accountant,
    status = 201,
  ) =>
    http()
      .post(`/api/sales/${id}/payments`)
      .set(h)
      .send({ date: daysAgo(1), amount, method: 'ESPECES', ...over })
      .expect(status);
  const counter = async (kind = 'AV') =>
    (
      await prisma.$queryRawUnsafe<{ last: number }[]>(
        `SELECT "last" FROM "DocumentCounter" WHERE "kind" = '${kind}'`,
      )
    )[0]?.last ?? null;
  const dbCount = async (table: string) =>
    Number(
      (
        await prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*) AS n FROM "${table}"`,
        )
      )[0].n,
    );
  const creditEvents = (batchId: string) =>
    prisma.batchEvent.findMany({
      where: { batchId, sourceType: 'CREDIT_NOTE' },
    });
  async function article(
    quantity = 1000,
    name = 'Aliment ponte',
    extra: Record<string, unknown> = {},
  ) {
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
      ...extra,
    });
    return item.id;
  }
  const level = async (itemId: string) =>
    (await http().get(`/api/stock/${itemId}`).set(director).expect(200))
      .body as Level;
  const itemLine = (itemId: string, over: Record<string, unknown> = {}) => ({
    kind: 'ARTICLE',
    stockItemId: itemId,
    quantity: 100,
    unitPrice: 450,
    ...over,
  });
  async function layerWithEggs(eggs: number, initialCount = 3000) {
    const layer = await world.lot(director, {
      type: 'PONDEUSE',
      initialCount,
    });
    await world.post(director, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(10),
      collected: eggs,
    });
    return layer;
  }
  const eggLine = (batchId: string, quantity = 400) => ({
    kind: 'OEUFS',
    batchId,
    quantity,
    unitPrice: 2500,
  });
  const audits = (recordId: string) =>
    prisma.auditLog.findMany({
      where: { recordId },
      orderBy: { createdAt: 'asc' },
    });

  describe('FA-0310: 30 of 300 birds credited with their return', () => {
    it('AV-0001 105 000, the birds are back in the lot, refundDue 105 000, Soldée; then the refund; then the encashment is protected', async () => {
      const inv = await issued();
      expect(inv).toMatchObject({ number: 'FA-0001', total: 1050000 });
      await pay(inv.id, 1050000);
      expect(await alive(lotId)).toBe(100);
      const res = await credit(inv, [[0, 30]], { withReturn: true });
      const after = res.body as Detail;
      expect(after).toMatchObject({
        status: 'SOLDEE',
        credited: 105000,
        paid: 1050000,
        due: 0,
        refundDue: 105000,
        refunded: 0,
      });
      expect(after.creditNotes).toEqual([
        {
          id: expect.any(String) as string,
          number: 'AV-0001',
          date: daysAgo(1),
          reason: 'Marchandise non conforme',
          withReturn: true,
          total: 105000,
        },
      ]);
      expect(after.lines[0]).toMatchObject({
        creditedQuantity: 30,
        creditableQuantity: 270,
        creditableAmount: 945000,
      });
      expect(after.history.map((s) => s.step)).toEqual([
        'BROUILLON',
        'EMISE',
        'PAIEMENT',
        'AVOIR',
      ]);
      expect(after.history[3].note).toBe('AV-0001');
      // the birds re-enter the lot at the credit note's date, through the herd ledger
      expect(await alive(lotId)).toBe(130);
      const events = await creditEvents(lotId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'ENTREE',
        quantity: 30,
        cause: 'Retour client',
        sourceType: 'CREDIT_NOTE',
        sourceId: after.creditNotes[0].id,
        date: new Date(daysAgo(1)),
      });
      // refund what is owed back
      const refund = await pay(
        inv.id,
        105000,
        { method: 'MOBILE_MONEY', kind: 'REMBOURSEMENT' },
        accountant,
      );
      const refunded = refund.body as Detail;
      expect(refunded).toMatchObject({
        status: 'SOLDEE',
        refundDue: 0,
        refunded: 105000,
        due: 0,
      });
      expect(refunded.payments.map((p) => [p.number, p.kind])).toEqual([
        ['RC-0001', 'ENCAISSEMENT'],
        ['RC-0002', 'REMBOURSEMENT'],
      ]);
      expect(refunded.history.map((s) => s.step).slice(-1)).toEqual([
        'REMBOURSEMENT',
      ]);
      // too much, and nothing left to give back
      const more = await pay(
        inv.id,
        1,
        { kind: 'REMBOURSEMENT' },
        accountant,
        409,
      );
      expect(msg(more)).toBe('Rien à rembourser sur cette facture');
      // the encashment cannot go while the refund stands
      const del = await http()
        .delete(`/api/sales/${inv.id}/payments/${refunded.payments[0].id}`)
        .set(accountant)
        .expect(409);
      expect(msg(del)).toBe("Supprimez d'abord le remboursement");
      // deleting the refund first lets the encashment be deleted
      await http()
        .delete(`/api/sales/${inv.id}/payments/${refunded.payments[1].id}`)
        .set(accountant)
        .expect(200);
      const back = await get(inv.id);
      expect(back).toMatchObject({ refundDue: 105000, refunded: 0 });
    });

    it('a refund above what is owed back is a 400', async () => {
      const inv = await issued();
      await pay(inv.id, 1050000);
      await credit(inv, [[0, 30]]);
      const over = await pay(
        inv.id,
        105001,
        { kind: 'REMBOURSEMENT' },
        accountant,
        400,
      );
      expect(msg(over)).toBe('Le montant dépasse le montant à rembourser');
    });

    it('credits beyond what is due: part of it lowers the debt, the rest is owed back', async () => {
      const inv = await issued();
      await pay(inv.id, 1000000);
      expect(await get(inv.id)).toMatchObject({
        status: 'PARTIELLE',
        due: 50000,
      });
      const res = (await credit(inv, [[0, 30]])).body as Detail;
      expect(res).toMatchObject({
        status: 'SOLDEE',
        due: 0,
        refundDue: 55000,
        credited: 105000,
      });
      // credit without payment: the due drops, nothing is owed back
      const other = await issued({ lines: [lotLine({ quantity: 10 })] });
      const unpaid = (await credit(other, [[0, 4]])).body as Detail;
      expect(unpaid).toMatchObject({
        status: 'EMISE',
        due: 21000,
        refundDue: 0,
        credited: 14000,
      });
      // credited in full: settled
      const rest = (await credit(other, [[0, 6]])).body as Detail;
      expect(rest).toMatchObject({ status: 'SOLDEE', due: 0, credited: 35000 });
    });
  });

  describe('quantities and amounts', () => {
    it('271 more on a line of 300 already credited 30 is a 400 naming what is left (270), never a RangeError', async () => {
      const inv = await issued();
      await credit(inv, [[0, 30]]);
      const over = await credit(inv, [[0, 271]], {}, accountant, 400);
      expect(msg(over)).toBe(
        'La quantité dépasse la quantité restant à créditer (270)',
      );
      await credit(inv, [[0, 270]]);
      expect(await get(inv.id)).toMatchObject({
        credited: 1050000,
        status: 'SOLDEE',
      });
      const none = await credit(inv, [[0, 1]], {}, accountant, 400);
      expect(msg(none)).toBe(
        'La quantité dépasse la quantité restant à créditer (0)',
      );
      expect(await counter()).toBe(2);
      expect(await dbCount('CreditNote')).toBe(2);
    });

    it('rounding: a 2.5 kg line at 333.33 credited 1.25 then 1.25 gives 416.66 + 416.67 = 833.33', async () => {
      const item = await article(100);
      const inv = await issued({
        lines: [itemLine(item, { quantity: 2.5, unitPrice: 333.33 })],
      });
      expect(inv.total).toBe(833.33);
      const a = (await credit(inv, [[0, 1.25]])).body as Detail;
      expect(a.credited).toBe(416.66);
      expect(a.lines[0]).toMatchObject({
        creditedQuantity: 1.25,
        creditableQuantity: 1.25,
        creditableAmount: 416.67,
      });
      const b = (await credit(inv, [[0, 1.25]])).body as Detail;
      expect(b.credited).toBe(833.33);
      expect(b.creditNotes.map((c) => c.total)).toEqual([416.66, 416.67]);
      expect(b.status).toBe('SOLDEE');
      expect(b.lines[0]).toMatchObject({
        creditableQuantity: 0,
        creditableAmount: 0,
      });
    });

    it('a line worth nothing any more is accepted beside a line that is worth something, and a credit worth nothing is refused', async () => {
      const item = await article(100);
      const inv = await issued({
        lines: [
          itemLine(item, { quantity: 0.04, unitPrice: 0.55 }),
          {
            kind: 'SERVICE',
            designation: 'Livraison',
            quantity: 1,
            unitPrice: 100,
          },
        ],
      });
      expect(inv.lines[0].amount).toBe(0.02);
      expect(((await credit(inv, [[0, 0.01]])).body as Detail).credited).toBe(
        0.01,
      );
      expect(((await credit(inv, [[0, 0.01]])).body as Detail).credited).toBe(
        0.02,
      );
      const alone = await credit(inv, [[0, 0.01]], {}, accountant, 400);
      expect(msg(alone)).toBe("L'avoir doit porter sur un montant positif");
      expect(await counter()).toBe(2);
      const both = (
        await credit(inv, [
          [0, 0.01],
          [1, 1],
        ])
      ).body as Detail;
      expect(both.creditNotes[2].total).toBe(100);
      const stored = await prisma.$queryRawUnsafe<
        { amount: string; quantity: string }[]
      >(
        `SELECT cl."amount"::text, cl."quantity"::text FROM "CreditNoteLine" cl
         JOIN "CreditNote" c ON c."id" = cl."creditNoteId" WHERE c."number" = 'AV-0003' ORDER BY cl."amount"`,
      );
      expect(stored.map((s) => [s.amount, s.quantity])).toEqual([
        ['0.00', '0.01'],
        ['100.00', '1.00'],
      ]);
    });

    it('validates the body: lines, ids, quantities, reason, date, unknown fields', async () => {
      const inv = await issued();
      const other = await issued({ lines: [lotLine({ quantity: 5 })] });
      const send = async (
        over: Record<string, unknown>,
        status = 400,
      ): Promise<string> =>
        msg(
          await creditReq(
            inv.id,
            {
              date: daysAgo(1),
              reason: 'Erreur de commande',
              withReturn: false,
              lines: [{ lineId: inv.lines[0].id, quantity: 1 }],
              ...over,
            },
            accountant,
            status,
          ),
        );
      expect(await send({ lines: [] })).toContain('au moins une ligne');
      expect(
        await send({ lines: [{ lineId: other.lines[0].id, quantity: 1 }] }),
      ).toBe('Ligne de facture invalide');
      expect(await send({ lines: [{ lineId: 'zzz', quantity: 1 }] })).toBe(
        'Ligne de facture invalide',
      );
      expect(
        await send({
          lines: [
            { lineId: inv.lines[0].id, quantity: 1 },
            { lineId: inv.lines[0].id, quantity: 2 },
          ],
        }),
      ).toBe('Une ligne ne peut figurer qu’une fois dans un avoir');
      for (const quantity of [0, -1, 1.234, '1', null]) {
        await send({ lines: [{ lineId: inv.lines[0].id, quantity }] });
      }
      expect(
        await send({ lines: [{ lineId: inv.lines[0].id, quantity: 1.5 }] }),
      ).toBe('La quantité doit être un nombre entier');
      await send({ reason: '' });
      await send({ reason: '   ' });
      await send({ reason: undefined });
      await send({ reason: 'x'.repeat(501) });
      await send({ withReturn: 'oui' });
      await send({ withReturn: null });
      await send({ foo: 1 });
      expect(await send({ date: daysAgo(6) })).toBe(
        'La date de l’avoir ne peut pas précéder la facture',
      );
      expect(await send({ date: daysAgo(-1) })).toBe(
        'La date ne peut pas être dans le futur',
      );
      await send({ date: 'hier' });
      expect(await counter()).toBeNull();
      expect(await dbCount('CreditNote')).toBe(0);
      // an omitted withReturn means no return
      const ok = await creditReq(inv.id, {
        date: daysAgo(5),
        reason: 'Erreur',
        lines: [{ lineId: inv.lines[0].id, quantity: 1 }],
      });
      expect((ok.body as Detail).creditNotes[0]).toMatchObject({
        withReturn: false,
        date: daysAgo(5),
      });
    });
  });

  describe('workflow and permissions', () => {
    it('refuses a credit note on a draft and on a cancelled invoice (409), an unknown or foreign invoice (404)', async () => {
      const draft = (
        await http().post('/api/sales').set(seller).send(body()).expect(201)
      ).body as Detail;
      const onDraft = await credit(draft, [[0, 1]], {}, accountant, 409);
      expect(msg(onDraft)).toBe(
        'Seule une facture émise peut recevoir un avoir',
      );
      const inv = await issued();
      await http()
        .post(`/api/sales/${inv.id}/cancel`)
        .set(accountant)
        .send({ reason: 'Erreur' })
        .expect(201);
      await credit(inv, [[0, 1]], {}, accountant, 409);
      await creditReq(
        'unknown',
        {
          date: daysAgo(1),
          reason: 'x',
          withReturn: false,
          lines: [{ lineId: 'a', quantity: 1 }],
        },
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
      const live = await issued({ lines: [lotLine({ quantity: 5 })] });
      await credit(live, [[0, 1]], {}, onB, 404);
      expect(await counter()).toBeNull();
    });

    it('an invoice with a credit note can no longer be cancelled; credit notes are final', async () => {
      const inv = await issued();
      const res = (await credit(inv, [[0, 10]])).body as Detail;
      const cancel = await http()
        .post(`/api/sales/${inv.id}/cancel`)
        .set(accountant)
        .send({ reason: 'Erreur' })
        .expect(409);
      expect(msg(cancel)).toBe(
        'Cette facture a des avoirs : elle ne peut plus être annulée',
      );
      const id = res.creditNotes[0].id;
      await http()
        .patch(`/api/credit-notes/${id}`)
        .set(accountant)
        .send({})
        .expect(404);
      await http()
        .delete(`/api/credit-notes/${id}`)
        .set(accountant)
        .expect(404);
      expect(await alive(lotId)).toBe(100);
    });

    it('COMMERCIAL cannot credit (403), COMPTABLE can (201); read-only roles, PROPRIETAIRE read but only validate writes', async () => {
      const inv = await issued();
      await credit(inv, [[0, 1]], {}, seller, 403);
      await credit(inv, [[0, 1]], {}, director, 403);
      await credit(inv, [[0, 1]], {}, keeper, 403);
      await credit(inv, [[0, 1]], {}, accountant, 201);
      await credit(inv, [[0, 1]], {}, owner, 201);
      const list = (
        await http().get('/api/credit-notes').set(seller).expect(200)
      ).body as Page<CreditRow>;
      expect(list.total).toBe(2);
      await http().get('/api/credit-notes').set(director).expect(200);
      await http().get('/api/credit-notes').set(keeper).expect(403);
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
      await credit(inv, [[0, 1]], {}, onAll, 403);
      expect(
        (
          (await http().get('/api/credit-notes').set(onAll).expect(200))
            .body as Page<CreditRow>
        ).total,
      ).toBe(0);
    });

    it('audits one CREATE row per credit note in the ventes module, with its lines, and none when refused', async () => {
      const inv = await issued();
      const outside = await prisma.auditLog.count({
        where: { module: { not: 'ventes' } },
      });
      await credit(inv, [[0, 1000]], {}, accountant, 400);
      expect(await prisma.auditLog.count({ where: { module: 'ventes' } })).toBe(
        1,
      );
      const res = (await credit(inv, [[0, 10]], { withReturn: true }))
        .body as Detail;
      const rows = await audits(res.creditNotes[0].id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'CREATE', module: 'ventes' });
      expect(JSON.stringify(rows[0].after)).toContain('AV-0001');
      expect(JSON.stringify(rows[0].after)).toContain('"lines"');
      // the ledgers write no audit row of their own for the return
      expect(
        await prisma.auditLog.count({ where: { module: { not: 'ventes' } } }),
      ).toBe(outside);
    });

    it('stores what the database insists on: positive totals and quantities, non-negative line amounts, one row per line', async () => {
      const inv = await issued();
      const res = (await credit(inv, [[0, 1]])).body as Detail;
      const cnId = res.creditNotes[0].id;
      const bad = (sql: string) =>
        expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();
      await bad(`UPDATE "CreditNote" SET "total" = 0 WHERE "id" = '${cnId}'`);
      await bad(
        `UPDATE "CreditNote" SET "number" = 'FA-1' WHERE "id" = '${cnId}'`,
      );
      await bad(
        `UPDATE "CreditNoteLine" SET "quantity" = 0 WHERE "creditNoteId" = '${cnId}'`,
      );
      await bad(
        `UPDATE "CreditNoteLine" SET "amount" = -1 WHERE "creditNoteId" = '${cnId}'`,
      );
      await bad(
        `INSERT INTO "CreditNoteLine" ("id","creditNoteId","invoiceLineId","quantity","amount") VALUES ('dup','${cnId}','${inv.lines[0].id}',1,1)`,
      );
    });
  });

  describe('returns of goods', () => {
    it('without return nothing touches a ledger', async () => {
      const item = await article(1000);
      const sow = await world.animal(director, { tag: 'TR-027' });
      const layer = await layerWithEggs(12000);
      const inv = await issued({
        lines: [
          lotLine({ quantity: 50 }),
          itemLine(item, { quantity: 10 }),
          eggLine(layer.id, 100),
          {
            kind: 'ANIMAL',
            animalId: sow.id,
            quantity: 1,
            unitPrice: 250000,
            weightKg: 180,
          },
          {
            kind: 'SERVICE',
            designation: 'Livraison',
            quantity: 1,
            unitPrice: 5000,
          },
        ],
      });
      const herd = jest.spyOn(app.get(HerdLedgerService), 'record');
      const stock = jest.spyOn(app.get(StockLedgerService), 'recordMany');
      try {
        const res = (
          await credit(inv, [
            [0, 5],
            [1, 2],
            [2, 10],
            [3, 1],
            [4, 1],
          ])
        ).body as Detail;
        expect(res.credited).toBe(
          5 * 3500 + 2 * 450 + 10 * 2500 + 250000 + 5000,
        );
        expect(herd).not.toHaveBeenCalled();
        expect(stock).not.toHaveBeenCalled();
      } finally {
        herd.mockRestore();
        stock.mockRestore();
      }
      expect(await alive(lotId)).toBe(350);
      expect((await level(item)).quantity).toBe(990);
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: sow.id } }))
          .status,
      ).toBe('VENDU');
      expect(await creditEvents(lotId)).toHaveLength(0);
    });

    it('an ANIMAL line with return is refused with the exact message, nothing is written; without return the animal stays VENDU', async () => {
      const sow = await world.animal(director, { tag: 'TR-027' });
      const inv = await issued({
        lines: [
          lotLine({ quantity: 10 }),
          {
            kind: 'ANIMAL',
            animalId: sow.id,
            quantity: 1,
            unitPrice: 250000,
            weightKg: 180,
          },
        ],
      });
      const refused = await credit(
        inv,
        [
          [0, 5],
          [1, 1],
        ],
        { withReturn: true },
        accountant,
        400,
      );
      expect(msg(refused)).toBe(
        "Le retour d'un animal vendu n'est pas pris en charge : annulez la facture ou faites un avoir sans retour",
      );
      expect(await counter()).toBeNull();
      expect(await alive(lotId)).toBe(390);
      const res = (await credit(inv, [[1, 1]])).body as Detail;
      expect(res.credited).toBe(250000);
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: sow.id } }))
          .status,
      ).toBe('VENDU');
      // a return of the lot beside it is fine
      await credit(inv, [[0, 5]], { withReturn: true });
      expect(await alive(lotId)).toBe(395);
    });

    it('a SERVICE line never returns anything, even with the return ticked', async () => {
      const inv = await issued({
        lines: [
          {
            kind: 'SERVICE',
            designation: 'Livraison',
            quantity: 2,
            unitPrice: 5000,
          },
        ],
      });
      const res = (await credit(inv, [[0, 1]], { withReturn: true }))
        .body as Detail;
      expect(res.credited).toBe(5000);
    });

    it('a closed lot refuses the return (409 Ce lot est clôturé) and the whole credit note: no number, no row, nothing returned', async () => {
      const second = (await world.lot(director, { initialCount: 10 })).id;
      const inv = await issued({
        lines: [
          lotLine({ quantity: 10 }),
          lotLine({ batchId: second, quantity: 10 }),
        ],
      });
      await http()
        .post(`/api/batches/${second}/close`)
        .set(director)
        .expect(200);
      const refused = await credit(
        inv,
        [
          [0, 5],
          [1, 5],
        ],
        { withReturn: true },
        accountant,
        409,
      );
      expect(msg(refused)).toBe('Ce lot est clôturé');
      expect(await counter()).toBeNull();
      expect(await dbCount('CreditNote')).toBe(0);
      expect(await alive(lotId)).toBe(390);
      expect((await get(inv.id)).credited).toBe(0);
      // without the return the amount alone is credited
      await credit(inv, [[1, 5]]);
    });

    it('eggs: the return gives the eggs back to the balance from its date on (more can be sold), a credit without return does not', async () => {
      const layer = await layerWithEggs(12000);
      const inv = await issued({ lines: [eggLine(layer.id, 400)] });
      const empty = await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send(body({ lines: [eggLine(layer.id, 100)] }))
        .expect(400);
      expect(msg(empty)).toContain('(0 disponibles)');
      await credit(inv, [[0, 100]]);
      await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send(body({ date: daysAgo(1), lines: [eggLine(layer.id, 1)] }))
        .expect(400);
      const more = (await credit(inv, [[0, 100]], { withReturn: true }))
        .body as Detail;
      expect(more.credited).toBe(500000);
      // the returned eggs exist from the credit note's day, not before
      await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send(body({ date: daysAgo(4), lines: [eggLine(layer.id, 1)] }))
        .expect(400);
      const resale = await issued({
        date: daysAgo(1),
        lines: [eggLine(layer.id, 100)],
      });
      expect(resale.total).toBe(250000);
      const refused = await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send(body({ date: daysAgo(1), lines: [eggLine(layer.id, 1)] }))
        .expect(400);
      expect(msg(refused)).toContain('Œufs disponibles insuffisants');
    });

    it('eggs: a return nets against the sale on the day it is made, never before it; the production is judged day by day', async () => {
      const layer = await layerWithEggs(12000);
      const inv = await issued({ lines: [eggLine(layer.id, 400)] });
      await credit(inv, [[0, 400]], { withReturn: true });
      const rec = (
        await http().get('/api/egg-production').set(director).expect(200)
      ).body as Page<Id>;
      // all the eggs came back on day -1, but they left on day -5: the production cannot drop under that day's sale
      const cut = await http()
        .patch(`/api/egg-production/${rec.items[0].id}`)
        .set(director)
        .send({ collected: 11999 })
        .expect(400);
      expect(msg(cut)).toContain('déjà vendus');
      // a credit note cannot be dated before its invoice (the sold figure cannot go negative on any date)
      const day = await issued({
        lines: [eggLine(layer.id, 2)],
        date: daysAgo(1),
      });
      const early = await credit(
        day,
        [[0, 2]],
        { withReturn: true, date: daysAgo(2) },
        accountant,
        400,
      );
      expect(msg(early)).toBe(
        'La date de l’avoir ne peut pas précéder la facture',
      );
      // sale and return of the same day net to nothing
      await credit(day, [[0, 2]], { withReturn: true, date: daysAgo(1) });
      expect(
        (await issued({ lines: [eggLine(layer.id, 400)], date: daysAgo(1) }))
          .total,
      ).toBe(1000000);
    });

    it('eggs: a closed laying lot refuses the return (409) and the credit note whole', async () => {
      const layer = await layerWithEggs(12000, 10);
      const inv = await issued({
        lines: [
          eggLine(layer.id, 100),
          lotLine({ batchId: layer.id, quantity: 10 }),
        ],
      });
      await http()
        .post(`/api/batches/${layer.id}/close`)
        .set(director)
        .expect(200);
      const refused = await credit(
        inv,
        [[0, 10]],
        { withReturn: true },
        accountant,
        409,
      );
      expect(msg(refused)).toBe('Ce lot est clôturé');
      expect(await counter()).toBeNull();
      await credit(inv, [[0, 10]]);
    });

    it('articles: ONE entry RETOUR at the sale cost (368) into a NEW batch with the lot number and expiry of the first piece sold', async () => {
      const item = await article(100, 'Vaccin', {
        unitCost: 300,
        lotNumber: 'SOON',
        expiryDate: '2090-01-01',
      });
      await world.post(stockMgr, '/stock/movements', {
        itemId: item,
        type: 'ENTREE',
        date: daysAgo(30),
        quantity: 100,
        unitCost: 436,
        reason: 'ACHAT',
        lotNumber: 'LATE',
        expiryDate: '2099-01-01',
      });
      // (100 x 300 + 100 x 436) / 200 = 368: 100 from SOON and 50 from LATE
      const inv = await issued({ lines: [itemLine(item, { quantity: 150 })] });
      expect(await level(item)).toMatchObject({
        quantity: 50,
        averageCost: 368,
      });
      const batchesBefore = await prisma.stockBatch.count();
      const spy = jest.spyOn(app.get(StockLedgerService), 'recordMany');
      try {
        await credit(inv, [[0, 25]], { withReturn: true });
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
      expect(await level(item)).toMatchObject({
        quantity: 75,
        averageCost: 368,
      });
      expect(await prisma.stockBatch.count()).toBe(batchesBefore + 1);
      const moves = await prisma.stockMovement.findMany({
        where: { sourceType: 'CREDIT_NOTE' },
        include: { stockBatch: true },
      });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ type: 'ENTREE', reason: 'RETOUR' });
      expect(moves[0].quantity.toNumber()).toBe(25);
      expect(moves[0].unitCost.toNumber()).toBe(368);
      expect(moves[0].date).toEqual(new Date(daysAgo(1)));
      expect(moves[0].stockBatch).toMatchObject({
        lotNumber: 'SOON',
        expiryDate: new Date('2090-01-01'),
      });
      expect(moves[0].stockBatch?.receivedDate).toEqual(new Date(daysAgo(1)));
    });

    it('articles: the lot the goods re-enter is the first of the sale in FEFO order, whatever the order the entries were made in', async () => {
      const item = await article(50, 'Vaccin', {
        lotNumber: 'LATE',
        expiryDate: '2099-01-01',
      });
      await world.post(stockMgr, '/stock/movements', {
        itemId: item,
        type: 'ENTREE',
        date: daysAgo(30),
        quantity: 50,
        unitCost: 320,
        reason: 'ACHAT',
        lotNumber: 'SOON',
        expiryDate: '2090-01-01',
      });
      const inv = await issued({ lines: [itemLine(item, { quantity: 80 })] });
      await credit(inv, [[0, 10]], { withReturn: true });
      const batch = await prisma.stockBatch.findFirstOrThrow({
        where: { movements: { some: { sourceType: 'CREDIT_NOTE' } } },
      });
      expect(batch.lotNumber).toBe('SOON');
    });

    it('articles: a lot expired on the credit note date, or an inactive article, refuses the return (400 Retour impossible) and writes nothing; without return it is credited', async () => {
      const item = await article(100, 'Vaccin', {
        lotNumber: 'P1',
        expiryDate: daysAgo(3),
      });
      const inv = await issued({
        date: daysAgo(5),
        lines: [itemLine(item, { quantity: 10 })],
      });
      const refused = await credit(
        inv,
        [[0, 5]],
        { withReturn: true },
        accountant,
        400,
      );
      expect(msg(refused)).toBe(
        'Retour impossible pour Vaccin : faites un avoir sans retour des marchandises',
      );
      expect(await counter()).toBeNull();
      expect(await dbCount('CreditNote')).toBe(0);
      expect((await level(item)).quantity).toBe(90);
      // dated while the lot was still good, the return is accepted
      await credit(inv, [[0, 5]], { withReturn: true, date: daysAgo(4) });
      expect((await level(item)).quantity).toBe(95);
      // a deactivated article
      const other = await article(100, 'Aliment B');
      const inv2 = await issued({ lines: [itemLine(other, { quantity: 10 })] });
      await prisma.stockItem.update({
        where: { id: other },
        data: { active: false },
      });
      const off = await credit(
        inv2,
        [[0, 5]],
        { withReturn: true },
        accountant,
        400,
      );
      expect(msg(off)).toBe(
        'Retour impossible pour Aliment B : faites un avoir sans retour des marchandises',
      );
      await credit(inv2, [[0, 5]]);
    });

    it('articles: the cost of a return is read under the stock lock: an entry committed while the credit note waits for it is counted', async () => {
      const item = await article(1000);
      const inv = await issued({
        date: daysAgo(3),
        lines: [itemLine(item, { quantity: 100 })],
      });
      const pair = await prisma.farmStockItem.findFirstOrThrow({
        where: { farmId: world.farmId, stockItemId: item },
      });
      const user = await prisma.user.findFirstOrThrow();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      let held: (pid: number) => void = () => undefined;
      const hasLock = new Promise<number>((r) => (held = r));
      const holder = prisma.$transaction(
        async (tx) => {
          await lockRow(tx, 'FarmStockItem', pair.id);
          const rows = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          held(rows[0].pid);
          await gate;
          // committed under the lock the credit note is waiting for: re-costs the sale's exits to 340
          await app.get(StockLedgerService).record(tx, {
            farmId: world.farmId,
            stockItemId: item,
            date: new Date(daysAgo(10)),
            type: 'ENTREE',
            quantity: 500,
            unitCost: 380,
            reason: 'ACHAT',
            userId: user.id,
          });
        },
        { timeout: 60000 },
      );
      const pid = await hasLock;
      try {
        const request = credit(inv, [[0, 40]], {
          withReturn: true,
          date: daysAgo(2),
        });
        let blocked = 0;
        const deadline = Date.now() + 15000;
        while (blocked === 0 && Date.now() < deadline) {
          const rows = await prisma.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM pg_stat_activity
            WHERE datname = current_database() AND ${pid}::int = ANY (pg_blocking_pids(pid))`;
          blocked = Number(rows[0].n);
          if (blocked === 0) await new Promise((r) => setTimeout(r, 20));
        }
        expect(blocked).toBeGreaterThan(0);
        release();
        await holder;
        await request;
      } finally {
        release();
        await holder.catch(() => undefined);
      }
      const ret = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceType: 'CREDIT_NOTE' },
      });
      expect(ret.unitCost.toNumber()).toBe(340);
    });

    it('articles: a return is valued at what the ledger says the sale cost NOW (a back-dated entry re-costs the exits)', async () => {
      const item = await article(1000);
      const inv = await issued({
        date: daysAgo(3),
        lines: [itemLine(item, { quantity: 100 })],
      });
      await world.post(stockMgr, '/stock/movements', {
        itemId: item,
        type: 'ENTREE',
        date: daysAgo(10),
        quantity: 500,
        unitCost: 380,
        reason: 'ACHAT',
      });
      // (1000 x 320 + 500 x 380) / 1500 = 340
      await credit(inv, [[0, 40]], { withReturn: true, date: daysAgo(2) });
      const ret = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceType: 'CREDIT_NOTE' },
      });
      expect(ret.unitCost.toNumber()).toBe(340);
      // 1 500 at 340, 100 out, 40 back at 340: the average holds
      expect(await level(item)).toMatchObject({
        quantity: 1000 + 500 - 100 + 40,
        averageCost: 340,
      });
    });

    it('articles: two lines of one article and a second article in one credit note are ONE ledger call, one batch per article', async () => {
      const a = await article(500, 'Aliment A');
      const b = await article(500, 'Aliment B');
      const inv = await issued({
        lines: [
          itemLine(a, { quantity: 50 }),
          itemLine(b, { quantity: 20, unitPrice: 500 }),
          itemLine(a, { quantity: 30 }),
        ],
      });
      const spy = jest.spyOn(app.get(StockLedgerService), 'recordMany');
      try {
        await credit(
          inv,
          [
            [0, 10],
            [1, 5],
            [2, 7],
          ],
          { withReturn: true },
        );
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toHaveLength(2);
      } finally {
        spy.mockRestore();
      }
      expect((await level(a)).quantity).toBe(500 - 80 + 17);
      expect((await level(b)).quantity).toBe(500 - 20 + 5);
      const moves = await prisma.stockMovement.findMany({
        where: { sourceType: 'CREDIT_NOTE' },
      });
      expect(moves).toHaveLength(2);
    });

    it('articles: a validated inventory later than the credit note refuses the whole credit note (409)', async () => {
      const item = await article(1000);
      const inv = await issued({
        date: daysAgo(5),
        lines: [lotLine({ quantity: 10 }), itemLine(item, { quantity: 10 })],
      });
      const session = await world.post<Id>(stockMgr, '/inventories', {
        date: daysAgo(1),
      });
      await http()
        .put(`/api/inventories/${session.id}/lines`)
        .set(stockMgr)
        .send({ lines: [{ itemId: item, countedQty: 990 }] })
        .expect(200);
      await http()
        .post(`/api/inventories/${session.id}/validate`)
        .set(stockMgr)
        .expect(201);
      const refused = await credit(
        inv,
        [
          [0, 5],
          [1, 5],
        ],
        { withReturn: true, date: daysAgo(3) },
        accountant,
        409,
      );
      expect(msg(refused)).toBe(
        `Un inventaire validé le ${daysAgo(1)} verrouille les mouvements antérieurs de Aliment ponte`,
      );
      expect(await counter()).toBeNull();
      expect(await dbCount('CreditNote')).toBe(0);
      expect(await alive(lotId)).toBe(390);
      expect((await level(item)).quantity).toBe(990);
      // dated after the inventory it goes through
      await credit(
        inv,
        [
          [0, 5],
          [1, 5],
        ],
        { withReturn: true },
      );
      expect(await alive(lotId)).toBe(395);
      expect((await level(item)).quantity).toBe(995);
    });

    it('a full lot refuses the return of birds (400, building capacity) and the credit note whole', async () => {
      const inv = await issued();
      await prisma.building.update({
        where: { id: world.poultryBld },
        data: { capacity: 120 },
      });
      const refused = await credit(
        inv,
        [[0, 30]],
        { withReturn: true },
        accountant,
        400,
      );
      expect(msg(refused)).toContain('Capacité du bâtiment dépassée');
      expect(await counter()).toBeNull();
      expect(await alive(lotId)).toBe(100);
    });
  });

  describe('partial returns and refunds', () => {
    it('a partial return of one LOT line across two credit notes (10 then 20 birds) puts 30 birds back, one event each', async () => {
      const inv = await issued();
      await credit(inv, [[0, 10]], { withReturn: true });
      const res = (await credit(inv, [[0, 20]], { withReturn: true }))
        .body as Detail;
      expect(res.lines[0]).toMatchObject({
        creditedQuantity: 30,
        creditableQuantity: 270,
        creditableAmount: 945000,
      });
      expect(await alive(lotId)).toBe(130);
      const events = await creditEvents(lotId);
      expect(events.map((e) => e.quantity).sort((a, b) => a - b)).toEqual([
        10, 20,
      ]);
    });

    it('a 1.25 kg partial return of an article, twice, puts 2.5 kg back at the sale cost', async () => {
      const item = await article(100);
      const inv = await issued({
        lines: [itemLine(item, { quantity: 2.5, unitPrice: 333.33 })],
      });
      await credit(inv, [[0, 1.25]], { withReturn: true });
      await credit(inv, [[0, 1.25]], { withReturn: true });
      expect(await level(item)).toMatchObject({
        quantity: 100,
        averageCost: 320,
      });
      const moves = await prisma.stockMovement.findMany({
        where: { sourceType: 'CREDIT_NOTE' },
        orderBy: { createdAt: 'asc' },
      });
      expect(
        moves.map((m) => [m.quantity.toNumber(), m.unitCost.toNumber()]),
      ).toEqual([
        [1.25, 320],
        [1.25, 320],
      ]);
    });

    it('a refund cannot be dated before the credit note it stems from (400), and a credit note on a settled invoice raises the refund due again', async () => {
      const inv = await issued();
      await pay(inv.id, 1050000);
      await credit(inv, [[0, 30]]); // dated yesterday
      const early = await pay(
        inv.id,
        5000,
        { kind: 'REMBOURSEMENT', date: daysAgo(2) },
        accountant,
        400,
      );
      expect(msg(early)).toBe(
        'La date du remboursement ne peut pas précéder le dernier avoir',
      );
      const done = (await pay(inv.id, 105000, { kind: 'REMBOURSEMENT' }))
        .body as Detail;
      expect(done).toMatchObject({ status: 'SOLDEE', refundDue: 0 });
      const again = (await credit(inv, [[0, 10]])).body as Detail;
      expect(again).toMatchObject({
        status: 'SOLDEE',
        due: 0,
        refundDue: 35000,
      });
      const row = (
        await http().get(`/api/sales/${inv.id}`).set(accountant).expect(200)
      ).body as Detail;
      expect(row.refundDue).toBe(35000);
    });
  });

  describe('reads', () => {
    it('lists credit notes with the row shape, filters and the CSV export; the sheet has the customer and the lines', async () => {
      const a = await issued();
      const other = (
        await world.post<Id>(seller, '/customers', {
          name: 'Marché Hédzranawoé',
          type: 'REVENDEUR',
        })
      ).id;
      const b = await issued({
        customerId: other,
        lines: [lotLine({ quantity: 10 })],
      });
      await credit(a, [[0, 30]], {
        reason: 'Poulets maigres',
        withReturn: true,
      });
      await credit(b, [[0, 2]], { reason: 'Erreur de prix' });
      const list = async (q: Record<string, string> = {}, h = seller) =>
        (await http().get('/api/credit-notes').query(q).set(h).expect(200))
          .body as Page<CreditRow>;
      const all = await list();
      expect(all.total).toBe(2);
      expect(all.items[0]).toEqual({
        id: expect.any(String) as string,
        number: expect.stringMatching(/^AV-000[12]$/) as string,
        date: daysAgo(1),
        invoiceId: expect.any(String) as string,
        invoiceNumber: expect.stringMatching(/^FA-000[12]$/) as string,
        customerName: expect.any(String) as string,
        reason: expect.any(String) as string,
        withReturn: expect.any(Boolean) as boolean,
        total: expect.any(Number) as number,
      });
      expect(
        (await list({ customerId: other })).items.map((i) => i.number),
      ).toEqual(['AV-0002']);
      expect(
        (await list({ search: 'maigres' })).items.map((i) => i.number),
      ).toEqual(['AV-0001']);
      expect(
        (await list({ search: 'FA-0002' })).items.map((i) => i.number),
      ).toEqual(['AV-0002']);
      expect((await list({ search: 'av-0001' })).total).toBe(1);
      expect((await list({ search: 'Restaurant' })).total).toBe(1);
      expect(
        (await list({ sort: 'total:desc' })).items.map((i) => i.total),
      ).toEqual([105000, 7000]);
      const csv = await http()
        .get('/api/credit-notes')
        .query({ format: 'csv' })
        .set(seller)
        .expect(200);
      const lines = csv.text
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/);
      expect(lines[0]).toBe(
        'Date;N° avoir;Facture;Client;Motif;Retour;Montant',
      );
      expect(lines).toHaveLength(3);
      const sheet = (
        await http()
          .get(
            `/api/credit-notes/${all.items.find((i) => i.number === 'AV-0001')?.id}`,
          )
          .set(seller)
          .expect(200)
      ).body as CreditDetail;
      expect(sheet).toMatchObject({
        customerPhone: '+228 93 12 34 56',
        customerAddress: 'Rue 12, Lomé',
        number: 'AV-0001',
        lines: [
          {
            id: expect.any(String) as string,
            invoiceLineId: expect.any(String) as string,
            kind: 'LOT',
            designation: 'Poulets de chair',
            unit: null,
            unitPrice: 3500,
          },
        ],
      });
      await http().get('/api/credit-notes/unknown').set(seller).expect(404);
    });

    it('hides the credit notes of another farm (404 in a path, absent from the list)', async () => {
      const inv = await issued();
      const res = (await credit(inv, [[0, 1]])).body as Detail;
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
      await http()
        .get(`/api/credit-notes/${res.creditNotes[0].id}`)
        .set(onB)
        .expect(404);
      expect(
        (
          (await http().get('/api/credit-notes').set(onB).expect(200))
            .body as Page<CreditRow>
        ).total,
      ).toBe(0);
    });

    it('customer standings count the credit notes: invoiced, credited, balance', async () => {
      const inv = await issued();
      await pay(inv.id, 500000);
      await credit(inv, [[0, 30]]);
      const sheet = (
        await http()
          .get(`/api/customers/${customerId}`)
          .set(accountant)
          .expect(200)
      ).body as {
        balance: number;
        invoiced: number;
        paid: number;
        credited: number;
        refunded: number;
      };
      expect(sheet).toMatchObject({
        invoiced: 1050000,
        paid: 500000,
        credited: 105000,
        refunded: 0,
        balance: 445000,
      });
      // what is owed back is a figure of its own: the balance stays what is due
      await pay(inv.id, 445000);
      await credit(inv, [[0, 10]]);
      const owed = (
        await http()
          .get(`/api/customers/${customerId}`)
          .set(accountant)
          .expect(200)
      ).body as { balance: number; refundDue: number };
      expect(owed).toMatchObject({ balance: 0, refundDue: 35000 });
      const row = (
        (await http().get('/api/customers').set(accountant).expect(200))
          .body as Page<{ id: string; balance: number; refundDue: number }>
      ).items.find((c) => c.id === customerId);
      expect(row).toMatchObject({ balance: 0, refundDue: 35000 });
    });
  });
});
