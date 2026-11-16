import { INestApplication } from '@nestjs/common';
import { formatCount } from '../src/common/format-number';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createTestApp } from './setup';

interface Line {
  id: string;
  kind: string;
  unit: string | null;
  quantity: number;
}
interface Detail extends Id {
  number: string | null;
  status: string;
  quoteId: string | null;
  lines: Line[];
}
interface QuoteDetail extends Id {
  status: string;
  reference: string;
  invoiceId: string | null;
}

/** The small rules of the sales documents settled by the final review (one behaviour each). */
describe('Sales rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let seller: Headers;
  let accountant: Headers;
  let director: Headers;
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
    stockMgr = await world.actor('RESP_STOCK');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
      })
    ).id;
    lotId = (await world.lot(director, { initialCount: 4000 })).id;
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
    date: daysAgo(5),
    lines: [lotLine()],
    ...over,
  });
  const issued = (over: Record<string, unknown> = {}) =>
    world.post<Detail>(accountant, '/sales/issued', body(over));
  const cancel = (id: string, status = 201) =>
    http()
      .post(`/api/sales/${id}/cancel`)
      .set(accountant)
      .send({ reason: 'Erreur' })
      .expect(status);
  const events = (batchId: string, sourceType = 'SALE') =>
    prisma.batchEvent.findMany({ where: { batchId, sourceType } });
  const alive = async (id: string) =>
    (await app.get(HerdLedgerService).liveCounts([id])).get(id);

  describe('lines', () => {
    it('two LOT lines on one lot write ONE herd event (the sum), and the cancellation takes it back exactly', async () => {
      const inv = await issued({
        lines: [lotLine({ quantity: 100 }), lotLine({ quantity: 250 })],
      });
      const sold = await events(lotId);
      expect(sold).toHaveLength(1);
      expect(sold[0]).toMatchObject({ type: 'VENTE', quantity: 350 });
      expect(await alive(lotId)).toBe(3650);
      await cancel(inv.id);
      expect(await events(lotId)).toHaveLength(0);
      expect(await alive(lotId)).toBe(4000);
    });

    it('two LOT lines credited with return give back ONE herd event per lot', async () => {
      const inv = await issued({
        lines: [lotLine({ quantity: 100 }), lotLine({ quantity: 250 })],
      });
      await http()
        .post(`/api/sales/${inv.id}/credit-notes`)
        .set(accountant)
        .send({
          date: daysAgo(1),
          reason: 'Retour',
          withReturn: true,
          lines: inv.lines.map((l) => ({ lineId: l.id, quantity: 40 })),
        })
        .expect(201);
      const back = await events(lotId, 'CREDIT_NOTE');
      expect(back).toHaveLength(1);
      expect(back[0]).toMatchObject({ type: 'ENTREE', quantity: 80 });
      expect(await alive(lotId)).toBe(3650 + 80);
    });

    it("pins an ARTICLE line to the article's unit and refuses a unit on LOT, ANIMAL and SERVICE lines", async () => {
      const item = (
        await world.post<Id>(stockMgr, '/stock-items', {
          name: 'Aliment ponte',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
      await world.post(stockMgr, '/stock/movements', {
        itemId: item,
        type: 'ENTREE',
        date: daysAgo(40),
        quantity: 500,
        unitCost: 320,
        reason: 'ACHAT',
      });
      const pinned = await issued({
        lines: [
          {
            kind: 'ARTICLE',
            stockItemId: item,
            quantity: 10,
            unitPrice: 450,
            unit: 'sac',
          },
        ],
      });
      expect(pinned.lines[0].unit).toBe('kg');
      const sow = await world.animal(director);
      const refused = async (line: Record<string, unknown>) =>
        msg(
          await http()
            .post('/api/sales')
            .set(seller)
            .send(body({ lines: [line] }))
            .expect(400),
        );
      for (const line of [
        lotLine({ unit: 'tête' }),
        {
          kind: 'ANIMAL',
          animalId: sow.id,
          quantity: 1,
          unitPrice: 90000,
          unit: 'tête',
        },
        {
          kind: 'SERVICE',
          designation: 'Livraison',
          quantity: 1,
          unitPrice: 2500,
          unit: 'forfait',
        },
      ]) {
        expect(await refused(line)).toBe(
          "L'unité ne concerne que les œufs et les articles",
        );
      }
    });
  });

  describe('invoices', () => {
    it('says a cancelled invoice cannot be issued again (not that it is already issued)', async () => {
      const inv = await issued();
      await cancel(inv.id);
      const res = await http()
        .post(`/api/sales/${inv.id}/issue`)
        .set(accountant)
        .send({})
        .expect(409);
      expect(msg(res)).toBe(
        'Cette facture est annulée : elle ne peut plus être émise',
      );
    });

    it('cancelling an invoice made from a quote gives the quote back, to be invoiced again', async () => {
      const quote = await world.post<QuoteDetail>(seller, '/quotes', body());
      await http().post(`/api/quotes/${quote.id}/send`).set(seller).expect(201);
      const converted = (
        await http()
          .post(`/api/quotes/${quote.id}/convert`)
          .set(seller)
          .expect(201)
      ).body as QuoteDetail;
      expect(converted.status).toBe('FACTURE');
      const invoiceId = converted.invoiceId as string;
      await http()
        .post(`/api/sales/${invoiceId}/issue`)
        .set(accountant)
        .send({})
        .expect(201);
      await cancel(invoiceId);
      const back = (
        await http().get(`/api/quotes/${quote.id}`).set(seller).expect(200)
      ).body as QuoteDetail;
      expect(back).toMatchObject({ status: 'ENVOYE', invoiceId: null });
      const audits = await prisma.auditLog.findMany({
        where: { recordId: quote.id, action: 'UPDATE' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.at(-1)).toMatchObject({
        before: { status: 'FACTURE' },
        after: { status: 'ENVOYE' },
      });
      // and it can be invoiced again
      const again = (
        await http()
          .post(`/api/quotes/${quote.id}/convert`)
          .set(seller)
          .expect(201)
      ).body as QuoteDetail;
      expect(again.status).toBe('FACTURE');
      expect(again.invoiceId).not.toBe(invoiceId);
    });

    it('gives an ACCEPTE quote back as ACCEPTE', async () => {
      const quote = await world.post<QuoteDetail>(seller, '/quotes', body());
      await http().post(`/api/quotes/${quote.id}/send`).set(seller).expect(201);
      await http()
        .post(`/api/quotes/${quote.id}/accept`)
        .set(seller)
        .expect(201);
      const converted = (
        await http()
          .post(`/api/quotes/${quote.id}/convert`)
          .set(seller)
          .expect(201)
      ).body as QuoteDetail;
      await http()
        .post(`/api/sales/${converted.invoiceId}/issue`)
        .set(accountant)
        .send({})
        .expect(201);
      await cancel(converted.invoiceId as string);
      expect(
        (
          (await http().get(`/api/quotes/${quote.id}`).set(seller).expect(200))
            .body as QuoteDetail
        ).status,
      ).toBe('ACCEPTE');
    });
  });

  describe('quotes', () => {
    it('refuses to send a draft whose validity has passed, and sends one valid today', async () => {
      const stale = await world.post<QuoteDetail>(
        seller,
        '/quotes',
        body({ date: daysAgo(10), validUntil: daysAgo(3) }),
      );
      const res = await http()
        .post(`/api/quotes/${stale.id}/send`)
        .set(seller)
        .expect(400);
      expect(msg(res)).toBe('La date de validité est dépassée');
      expect(
        (
          (await http().get(`/api/quotes/${stale.id}`).set(seller).expect(200))
            .body as QuoteDetail
        ).status,
      ).toBe('BROUILLON');
      const today = await world.post<QuoteDetail>(
        seller,
        '/quotes',
        body({ date: daysAgo(10), validUntil: daysAgo(0) }),
      );
      await http().post(`/api/quotes/${today.id}/send`).set(seller).expect(201);
    });
  });

  describe('payments and credit notes', () => {
    it('a refund cannot be dated before the latest encashment (nor the latest credit note)', async () => {
      const inv = await issued();
      await http()
        .post(`/api/sales/${inv.id}/payments`)
        .set(accountant)
        .send({ date: daysAgo(3), amount: 1050000, method: 'ESPECES' })
        .expect(201);
      await http()
        .post(`/api/sales/${inv.id}/credit-notes`)
        .set(accountant)
        .send({
          date: daysAgo(4),
          reason: 'Marchandise non conforme',
          withReturn: false,
          lines: [{ lineId: inv.lines[0].id, quantity: 100 }],
        })
        .expect(201);
      const refund = (date: string, status: number) =>
        http()
          .post(`/api/sales/${inv.id}/payments`)
          .set(accountant)
          .send({
            kind: 'REMBOURSEMENT',
            date,
            amount: 350000,
            method: 'ESPECES',
          })
          .expect(status);
      expect(msg(await refund(daysAgo(4), 400))).toBe(
        'La date du remboursement ne peut pas précéder le dernier encaissement',
      );
      await refund(daysAgo(3), 201);
    });

    it('writes the credit limit of a line with grouped thousands', async () => {
      const inv = await issued({ lines: [lotLine({ quantity: 1500 })] });
      const res = await http()
        .post(`/api/sales/${inv.id}/credit-notes`)
        .set(accountant)
        .send({
          date: daysAgo(1),
          reason: 'Trop',
          withReturn: false,
          lines: [{ lineId: inv.lines[0].id, quantity: 1600 }],
        })
        .expect(400);
      expect(msg(res)).toBe(
        `La quantité dépasse la quantité restant à créditer (${formatCount(1500)})`,
      );
    });
  });
});
