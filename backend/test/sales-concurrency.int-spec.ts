import { INestApplication } from '@nestjs/common';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface Res {
  status: number;
  body: { message?: string | string[]; number?: string; id?: string };
}

/** Real pool, real HTTP: invoices racing each other and the other writers of the same lots and articles. */
describe('Invoices under concurrency (real pool)', () => {
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
    method: 'post' | 'patch',
    path: string,
    h: Headers,
    payload: object = {},
  ): Promise<Res> =>
    http()
      [method](`/api${path}`)
      .set(h)
      .send(payload)
      .then((r) => ({ status: r.status, body: r.body as Res['body'] }));
  const draft = (lines: unknown[]) =>
    world.post<Id>(seller, '/sales', {
      customerId,
      date: daysAgo(1),
      lines,
    });
  const issue = (id: string, h = accountant) =>
    send('post', `/sales/${id}/issue`, h);
  const lotLine = (batchId: string, quantity: number) => ({
    kind: 'LOT',
    batchId,
    quantity,
    unitPrice: 3500,
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
  const itemLine = (stockItemId: string, quantity: number) => ({
    kind: 'ARTICLE',
    stockItemId,
    quantity,
    unitPrice: 450,
  });
  const noServerError = (rs: Res[]) =>
    expect(rs.filter((r) => r.status >= 500)).toEqual([]);
  const counter = async () =>
    (
      await prisma.$queryRaw<{ last: number }[]>`
        SELECT "last" FROM "DocumentCounter" WHERE "kind" = 'FA'`
    )[0]?.last;

  it('two issues of 30 on a lot of 40: exactly one 201, one 400 Effectif insuffisant, one number consumed', async () => {
    const lot = await world.lot(director, { initialCount: 40 });
    const [a, b] = await Promise.all([
      draft([lotLine(lot.id, 30)]),
      draft([lotLine(lot.id, 30)]),
    ]);
    const rs = await Promise.all([issue(a.id), issue(b.id)]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(message(rs.find((r) => r.status === 400) as Res)).toBe(
      'Effectif insuffisant',
    );
    expect(await alive(lot.id)).toBe(10);
    expect(await counter()).toBe(1);
  });

  it('two issues of 100 plateaux on 4 710 eggs: one is Œufs disponibles insuffisants', async () => {
    const layer = await world.lot(director, {
      type: 'PONDEUSE',
      initialCount: 3000,
    });
    await world.post(director, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(3),
      collected: 2500,
      broken: 40,
      downgraded: 250,
    });
    await world.post(director, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(2),
      collected: 2500,
    });
    const line = {
      kind: 'OEUFS',
      batchId: layer.id,
      quantity: 100,
      unitPrice: 2500,
    };
    const [a, b] = await Promise.all([draft([line]), draft([line])]);
    const rs = await Promise.all([issue(a.id), issue(b.id)]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(message(rs.find((r) => r.status === 400) as Res)).toBe(
      `Œufs disponibles insuffisants pour ${layer.code} (1710 disponibles)`,
    );
    expect(await counter()).toBe(1);
  });

  it('two issues of 600 kg on 1 000 kg: one is Stock insuffisant pour Aliment ponte', async () => {
    const item = await article(1000);
    const [a, b] = await Promise.all([
      draft([itemLine(item, 600)]),
      draft([itemLine(item, 600)]),
    ]);
    const rs = await Promise.all([issue(a.id), issue(b.id)]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(message(rs.find((r) => r.status === 400) as Res)).toContain(
      'Stock insuffisant pour Aliment ponte',
    );
    expect(await level(item)).toBe(400);
  });

  it('an invoice of a lot and an article racing a feed distribution on the same lot and article never deadlocks', async () => {
    for (let round = 0; round < 3; round++) {
      const lot = await world.lot(director, { initialCount: 100 });
      const item = await article(150, `Aliment ${round}`);
      const product = await world.post<Id>(director, '/feed-products', {
        name: `Produit ${round}`,
        kind: 'ALIMENT_COMPLET',
        unitCost: 300,
        stockItemId: item,
      });
      const d = await draft([lotLine(lot.id, 10), itemLine(item, 100)]);
      const rs = await Promise.all([
        issue(d.id),
        send('post', '/feed-distributions', director, {
          batchId: lot.id,
          date: daysAgo(1),
          feedProductId: product.id,
          quantityKg: 100,
        }),
      ]);
      noServerError(rs);
      // 150 kg cannot give 100 to the invoice and 100 to the lot: exactly one of the two wins.
      expect(rs.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await level(item)).toBe(50);
      expect(await alive(lot.id)).toBe(rs[0].status === 201 ? 90 : 100);
    }
  });

  it('10 concurrent issues get FA-0001 to FA-0010 without gaps or duplicates', async () => {
    const lot = await world.lot(director, { initialCount: 1000 });
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () => draft([lotLine(lot.id, 5)])),
    );
    const rs = await Promise.all(drafts.map((d) => issue(d.id)));
    noServerError(rs);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(rs.map((r) => r.body.number).sort()).toEqual(
      Array.from(
        { length: 10 },
        (_v, i) => `FA-${String(i + 1).padStart(4, '0')}`,
      ),
    );
    expect(await alive(lot.id)).toBe(950);
  });

  it('a treatment racing an issue on the same lot: the sale sees it or not, never half', async () => {
    for (let round = 0; round < 4; round++) {
      const lot = await world.lot(director, { initialCount: 100 });
      const d = await draft([lotLine(lot.id, 10)]);
      const [sale, treatment] = await Promise.all([
        issue(d.id),
        send('post', '/health-acts', director, {
          type: 'TRAITEMENT',
          status: 'REALISE',
          date: daysAgo(1),
          productName: 'Amox',
          withdrawalDays: 3,
          batchId: lot.id,
        }),
      ]);
      noServerError([sale, treatment]);
      expect(treatment.status).toBe(201);
      if (sale.status === 201) {
        expect(await alive(lot.id)).toBe(90);
      } else {
        expect(sale.status).toBe(400);
        expect(message(sale)).toContain("est en délai d'attente");
        expect(await alive(lot.id)).toBe(100);
      }
    }
  });

  it('invoices taking the same lots, animals and article in opposite orders do not deadlock', async () => {
    const lots = [
      await world.lot(director, { initialCount: 100 }),
      await world.lot(director, { initialCount: 100 }),
      await world.lot(director, { initialCount: 100 }),
    ];
    const sows = [
      await world.animal(director, { tag: 'TR-001' }),
      await world.animal(director, { tag: 'TR-002' }),
    ];
    const item = await article(1000);
    const animalLine = (id: string) => ({
      kind: 'ANIMAL',
      animalId: id,
      quantity: 1,
      unitPrice: 1,
    });
    const order = (ls: typeof lots, ss: typeof sows) => [
      ...ls.map((l) => lotLine(l.id, 5)),
      ...ss.map((s) => animalLine(s.id)),
      itemLine(item, 10),
    ];
    // Both invoices want the same animals: the loser is refused (409), nobody waits for ever.
    const a = await draft(order(lots, sows));
    const b = await draft(order([...lots].reverse(), [...sows].reverse()));
    const rs = await Promise.all([issue(a.id), issue(b.id)]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await level(item)).toBe(990);
    // Without the shared animals both go through.
    const c = await draft([...lots].reverse().map((l) => lotLine(l.id, 5)));
    const e = await draft(lots.map((l) => lotLine(l.id, 5)));
    const both = await Promise.all([issue(c.id), issue(e.id)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
  });

  it('two cancellations of one invoice: one 201, one 409, the lot restored once', async () => {
    const lot = await world.lot(director, { initialCount: 100 });
    const d = await draft([lotLine(lot.id, 30)]);
    await issue(d.id);
    expect(await alive(lot.id)).toBe(70);
    const rs = await Promise.all([
      send('post', `/sales/${d.id}/cancel`, accountant, { reason: 'x' }),
      send('post', `/sales/${d.id}/cancel`, accountant, { reason: 'y' }),
    ]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await alive(lot.id)).toBe(100);
  });

  it('an edit and an issue of the same draft: asserts coherence only (the winner depends on the interleaving)', async () => {
    const lot = await world.lot(director, { initialCount: 100 });
    const d = await draft([lotLine(lot.id, 30)]);
    const rs = await Promise.all([
      issue(d.id),
      send('patch', `/sales/${d.id}`, seller, {
        lines: [lotLine(lot.id, 5)],
      }),
    ]);
    noServerError(rs);
    const stored = (
      await http().get(`/api/sales/${d.id}`).set(seller).expect(200)
    ).body as { status: string; lines: { quantity: number }[] };
    const sold = 100 - (await alive(lot.id))!;
    // Whatever the order, the event matches the stored line.
    expect(sold).toBe(
      stored.status === 'BROUILLON' ? 0 : stored.lines[0].quantity,
    );
  });

  it('the same draft issued twice at once: one 201, one 409, one FA number', async () => {
    const lot = await world.lot(director, { initialCount: 100 });
    const d = await draft([lotLine(lot.id, 30)]);
    const rs = await Promise.all([issue(d.id), issue(d.id)]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(message(rs.find((r) => r.status === 409) as Res)).toBe(
      'Cette facture est déjà émise',
    );
    expect(await counter()).toBe(1);
    expect(await alive(lot.id)).toBe(70);
  });

  it('an issue racing the deletion of its draft: one wins, the state is coherent', async () => {
    for (let round = 0; round < 3; round++) {
      const lot = await world.lot(director, { initialCount: 100 });
      const d = await draft([lotLine(lot.id, 30)]);
      const rs = await Promise.all([
        issue(d.id),
        http()
          .delete(`/api/sales/${d.id}`)
          .set(seller)
          .then((r) => ({ status: r.status, body: r.body as Res['body'] })),
      ]);
      noServerError(rs);
      const [issued, deleted] = rs;
      if (issued.status === 201) {
        expect(deleted.status).toBe(409);
        expect(await alive(lot.id)).toBe(70);
        await http().get(`/api/sales/${d.id}`).set(seller).expect(200);
      } else {
        expect(issued.status).toBe(404);
        expect(deleted.status).toBe(200);
        expect(await alive(lot.id)).toBe(100);
        await http().get(`/api/sales/${d.id}`).set(seller).expect(404);
      }
    }
  });

  it('a quote converted twice at once gives one draft, the other call is a 409 (not a 500)', async () => {
    const lot = await world.lot(director, { initialCount: 100 });
    const q = await world.post<Id>(seller, '/quotes', {
      customerId,
      date: daysAgo(1),
      lines: [lotLine(lot.id, 5)],
    });
    await send('post', `/quotes/${q.id}/send`, seller);
    const rs = await Promise.all([
      send('post', `/quotes/${q.id}/convert`, seller),
      send('post', `/quotes/${q.id}/convert`, seller),
    ]);
    noServerError(rs);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Invoice" WHERE "quoteId" = ${q.id}`;
    expect(Number(n)).toBe(1);
  });
});
