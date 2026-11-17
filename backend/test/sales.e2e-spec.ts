import { INestApplication } from '@nestjs/common';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { exitCostsByItem } from '../src/stock/operation-costs';
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
  id: string;
  position: number;
  kind: string;
  batchId: string | null;
  animalId: string | null;
  stockItemId: string | null;
  sourceLabel: string | null;
  designation: string;
  unit: string | null;
  eggsPerUnit: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  weightKg: number | null;
  creditedQuantity: number;
  creditableQuantity: number;
  creditableAmount: number;
  activity: string;
  category: string;
}
interface Step {
  step: string;
  at: string;
  by: string | null;
  note?: string | null;
}
interface Row extends Id {
  date: string;
  number: string | null;
  customerId: string;
  customerName: string;
  product: string;
  quantity: number;
  unit: string | null;
  total: number;
  paid: number;
  credited: number;
  refunded: number;
  due: number;
  refundDue: number;
  status: string;
  dueDate: string | null;
  overdue: boolean;
}
interface Detail extends Row {
  customerPhone: string | null;
  customerAddress: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  note: string | null;
  cancelReason: string | null;
  lines: Line[];
  payments: unknown[];
  creditNotes: unknown[];
  history: Step[];
}
interface Page<T> {
  items: T[];
  total: number;
  statusCounts?: Record<string, number>;
}
interface Level {
  quantity: number;
  averageCost: number;
}
interface Mv {
  type: string;
  quantity: number;
  unitCost: number;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
}

describe('Invoices (e2e)', () => {
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
    date: daysAgo(2),
    lines: [lotLine()],
    ...over,
  });
  const draft = (over: Record<string, unknown> = {}, h = seller) =>
    world.post<Detail>(h, '/sales', body(over));
  const issued = (over: Record<string, unknown> = {}, h = accountant) =>
    world.post<Detail>(h, '/sales/issued', body(over));
  const refusedIssued = async (over: Record<string, unknown>, status = 400) =>
    msg(
      await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send(body(over))
        .expect(status),
    );
  const issue = (id: string, h = accountant, status = 201) =>
    http().post(`/api/sales/${id}/issue`).set(h).send({}).expect(status);
  const cancel = (
    id: string,
    h = accountant,
    status = 201,
    reason = 'Erreur',
  ) =>
    http()
      .post(`/api/sales/${id}/cancel`)
      .set(h)
      .send({ reason })
      .expect(status);
  const get = async (id: string, h = seller) =>
    (await http().get(`/api/sales/${id}`).set(h).expect(200)).body as Detail;
  const list = async (h = seller, q: Record<string, string> = {}) =>
    (await http().get('/api/sales').query(q).set(h).expect(200))
      .body as Page<Row>;
  const setCounter = (last: number) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentCounter" ("organizationId","kind","last") VALUES ('${world.orgId}','FA',${last})
       ON CONFLICT ("organizationId","kind") DO UPDATE SET "last" = ${last}`,
    );
  const counter = async () =>
    (
      await prisma.$queryRaw<{ last: number }[]>`
        SELECT "last" FROM "DocumentCounter" WHERE "kind" = 'FA'`
    )[0]?.last ?? null;
  const events = (batchId: string) =>
    prisma.batchEvent.findMany({ where: { batchId, type: 'VENTE' } });
  const audits = (recordId: string) =>
    prisma.auditLog.findMany({
      where: { recordId },
      orderBy: { createdAt: 'asc' },
    });

  async function article(quantity = 1000, name = 'Aliment ponte') {
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
  const level = async (itemId: string) =>
    (await http().get(`/api/stock/${itemId}`).set(director).expect(200))
      .body as Level;
  const stockMoves = async (itemId: string) =>
    (
      (
        await http()
          .get('/api/stock/movements')
          .query({ itemId })
          .set(director)
          .expect(200)
      ).body as Page<Mv>
    ).items;
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
      date: daysAgo(3),
      collected: eggs,
    });
    return layer;
  }

  describe('drafts', () => {
    it('creates a draft with no number that touches nothing, and snapshots its lines', async () => {
      const d = await draft({
        lines: [
          lotLine({ designation: 'Poulets prêts à cuire' }),
          {
            kind: 'SERVICE',
            designation: 'Livraison',
            quantity: 3,
            unitPrice: 333.33,
          },
        ],
      });
      expect(d).toMatchObject({
        number: null,
        status: 'BROUILLON',
        customerName: 'Restaurant Le Palmier',
        customerPhone: '+228 93 12 34 56',
        total: 1050000 + 999.99,
        due: 0,
        paid: 0,
        credited: 0,
        refunded: 0,
        refundDue: 0,
        dueDate: null,
        overdue: false,
        quoteId: null,
        quoteNumber: null,
        product: 'Poulets prêts à cuire +1',
        quantity: 300,
      });
      expect(d.lines[0]).toMatchObject({
        designation: 'Poulets prêts à cuire',
        sourceLabel: expect.stringMatching(/^LC-/) as string,
        activity: 'AVICOLE',
        category: 'VENTE_ANIMAUX',
        creditedQuantity: 0,
        creditableQuantity: 300,
        creditableAmount: 1050000,
      });
      expect(d.lines[1]).toMatchObject({
        activity: 'GENERAL',
        category: 'PRESTATIONS',
        amount: 999.99,
      });
      expect(d.history).toHaveLength(1);
      expect(d.history[0]).toMatchObject({ step: 'BROUILLON' });
      expect(await alive(lotId)).toBe(400);
      expect(await events(lotId)).toHaveLength(0);
      expect(await counter()).toBeNull();
      const rows = await audits(d.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ module: 'ventes', action: 'CREATE' });
    });

    it('snapshots eggs per unit, and a later setting never rewrites the line', async () => {
      const layer = await layerWithEggs(12000);
      const d = await draft({
        lines: [
          { kind: 'OEUFS', batchId: layer.id, quantity: 400, unitPrice: 2500 },
          {
            kind: 'OEUFS',
            batchId: layer.id,
            unit: 'OEUF',
            quantity: 90,
            unitPrice: 85,
          },
        ],
      });
      expect(d.lines[0]).toMatchObject({
        eggsPerUnit: 30,
        unit: 'PLATEAU',
        activity: 'AVICOLE',
        category: 'VENTE_OEUFS',
      });
      expect(d.lines[1]).toMatchObject({ eggsPerUnit: 1, unit: 'OEUF' });
      const admin = await world.actor('SUPER_ADMIN');
      await http()
        .put('/api/settings/eggsPerTray')
        .set(admin)
        .send({ value: 24 })
        .expect(200);
      expect((await get(d.id)).lines[0].eggsPerUnit).toBe(30);
    });

    it('validates customer, sources, dates and the lines', async () => {
      const post = async (over: Record<string, unknown>) =>
        msg(
          await http()
            .post('/api/sales')
            .set(seller)
            .send(body(over))
            .expect(400),
        );
      expect(await post({ customerId: 'nope' })).toBe('Client invalide');
      const idle = await world.post(seller, '/customers', {
        name: 'Inactif',
        type: 'PARTICULIER',
        active: false,
      });
      expect(await post({ customerId: idle.id })).toBe('Ce client est inactif');
      expect(await post({ date: '2999-01-01' })).toBe(
        'La date ne peut pas être dans le futur',
      );
      expect(await post({ dueDate: daysAgo(5) })).toBe(
        "L'échéance ne peut pas précéder la date de la facture",
      );
      expect(await post({ lines: [] })).toContain('au moins une ligne');
      expect(
        await post({
          lines: [
            { kind: 'SERVICE', designation: ' ', quantity: 1, unitPrice: 1 },
          ],
        }),
      ).toBe('Indiquez la désignation de la prestation');
      const sow = await world.animal(director, { tag: 'TR-027' });
      expect(
        await post({
          lines: [
            { kind: 'ANIMAL', animalId: sow.id, quantity: 2, unitPrice: 1 },
          ],
        }),
      ).toBe('Une ligne Animal vend un seul animal');
      expect(
        await post({
          lines: [
            lotLine({ quantity: 1_000_000, unitPrice: 1_000_000 }),
            lotLine(),
          ],
        }),
      ).toBe('Le montant total est trop élevé');
      expect(await post({ id: 'x' })).toContain('should not exist');
      expect(await post({ status: 'EMISE' })).toContain('should not exist');
      expect(await post({ number: 'FA-0001' })).toContain('should not exist');
    });

    it('refuses sources of another farm, another organisation, and a null where a value is needed', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const site = await prisma.site.create({
        data: { farmId: farmB, name: 'Site B' },
      });
      const building = await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: site.id,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 1000,
        },
      });
      const lotB = await prisma.animalBatch.create({
        data: {
          farmId: farmB,
          code: 'LC-B-1',
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: building.id,
          entryDate: new Date(daysAgo(10)),
          initialCount: 50,
        },
      });
      const post = async (lines: unknown[], h = seller) =>
        msg(
          await http()
            .post('/api/sales')
            .set(h)
            .send(body({ lines }))
            .expect(400),
        );
      expect(await post([lotLine({ batchId: lotB.id })])).toBe(
        'Lot invalide pour cette ferme',
      );
      expect(
        msg(
          await http()
            .post('/api/sales/issued')
            .set(accountant)
            .send(body({ lines: [lotLine({ batchId: lotB.id })] }))
            .expect(400),
        ),
      ).toBe('Lot invalide pour cette ferme');
      const other = await createOrganization('Autre');
      const foreign = await prisma.stockItem.create({
        data: {
          organizationId: other.id,
          name: 'Étranger',
          category: 'ALIMENT',
          unit: 'kg',
        },
      });
      expect(await post([itemLine(foreign.id)])).toBe('Article invalide');
      await http()
        .patch('/api/sales/x')
        .set(seller)
        .send({ customerId: null })
        .expect(400);
    });

    it('edits a draft, clears the due date, and writes nothing on a no-op', async () => {
      const d = await draft({ dueDate: daysAgo(1) });
      expect(d.dueDate).toBe(daysAgo(1));
      const same = await http()
        .patch(`/api/sales/${d.id}`)
        .set(seller)
        .send({ date: d.date, lines: [lotLine()] })
        .expect(200);
      expect((same.body as Detail).total).toBe(1050000);
      expect(await audits(d.id)).toHaveLength(1);
      const changed = (
        await http()
          .patch(`/api/sales/${d.id}`)
          .set(seller)
          .send({
            dueDate: null,
            lines: [lotLine({ quantity: 10 })],
            note: 'N',
          })
          .expect(200)
      ).body as Detail;
      expect(changed).toMatchObject({ dueDate: null, total: 35000, note: 'N' });
      expect(changed.lines).toHaveLength(1);
      const rows = await audits(d.id);
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      await http()
        .patch(`/api/sales/${d.id}`)
        .set(seller)
        .send({ date: daysAgo(0), dueDate: daysAgo(3) })
        .expect(400);
      await http()
        .patch(`/api/sales/${d.id}`)
        .set(seller)
        .send({ customerId: null })
        .expect(400);
    });

    it('deletes a draft (audited) and refuses to delete or edit an issued invoice', async () => {
      const d = await draft();
      await http().delete(`/api/sales/${d.id}`).set(seller).expect(200);
      await http().get(`/api/sales/${d.id}`).set(seller).expect(404);
      expect((await audits(d.id)).map((r) => r.action)).toEqual([
        'CREATE',
        'DELETE',
      ]);
      const i = await issued();
      const del = await http()
        .delete(`/api/sales/${i.id}`)
        .set(seller)
        .expect(409);
      expect(msg(del)).toBe('Seul un brouillon de facture peut être supprimé');
      const patch = await http()
        .patch(`/api/sales/${i.id}`)
        .set(seller)
        .send({ note: 'x' })
        .expect(409);
      expect(msg(patch)).toBe(
        'Une facture émise ne peut plus être modifiée : établissez un avoir',
      );
    });
  });

  describe('issue', () => {
    it('FA-0310: a lot sale takes 300 birds out, with one VENTE event of source SALE', async () => {
      await setCounter(309);
      const d = await draft();
      expect(await alive(lotId)).toBe(400);
      const res = await issue(d.id);
      const inv = res.body as Detail;
      expect(inv).toMatchObject({
        number: 'FA-0310',
        status: 'EMISE',
        total: 1050000,
        due: 1050000,
        paid: 0,
        dueDate: expect.any(String) as string,
      });
      expect(inv.history.map((s) => s.step)).toEqual(['BROUILLON', 'EMISE']);
      expect(await alive(lotId)).toBe(100);
      const ev = await events(lotId);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        quantity: 300,
        sourceType: 'SALE',
        sourceId: d.id,
      });
      const rows = await audits(d.id);
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      // the audit row carries the lines
      expect(JSON.stringify(rows[1].after)).toContain('FA-0310');
      expect(JSON.stringify(rows[1].after)).toContain('"lines"');
    });

    it('defaults the due date to the invoice date plus invoiceDueDays, and keeps a given one', async () => {
      const a = await issued({
        date: daysAgo(10),
        lines: [lotLine({ quantity: 10 })],
      });
      const day = new Date(daysAgo(10));
      day.setUTCDate(day.getUTCDate() + 15);
      expect(a.dueDate).toBe(day.toISOString().slice(0, 10));
      const b = await issued({
        dueDate: daysAgo(1),
        lines: [lotLine({ quantity: 10 })],
      });
      expect(b.dueDate).toBe(daysAgo(1));
    });

    it('FA-0309: 400 plateaux of eggs need 12 000 marketable eggs, then nothing is left', async () => {
      const layer = await layerWithEggs(12000);
      await setCounter(308);
      const inv = await issued({
        lines: [
          { kind: 'OEUFS', batchId: layer.id, quantity: 400, unitPrice: 2500 },
        ],
      });
      expect(inv).toMatchObject({ number: 'FA-0309', total: 1000000 });
      const next = await refusedIssued({
        lines: [
          { kind: 'OEUFS', batchId: layer.id, quantity: 1, unitPrice: 2500 },
        ],
      });
      expect(next).toBe(
        `Œufs disponibles insuffisants pour ${layer.code} (0 disponibles)`,
      );
      // the sold eggs weigh on the production
      const rec = (
        await http().get('/api/egg-production').set(director).expect(200)
      ).body as Page<Id>;
      const edit = await http()
        .patch(`/api/egg-production/${rec.items[0].id}`)
        .set(director)
        .send({ collected: 11999 })
        .expect(400);
      expect(msg(edit)).toContain('déjà vendus');
      // cancelling gives the eggs back
      await cancel(inv.id);
      await http()
        .patch(`/api/egg-production/${rec.items[0].id}`)
        .set(director)
        .send({ collected: 11999 })
        .expect(200);
    });

    it('FA-0305 and FA-0301: pig lots and litters', async () => {
      const fat = await world.pigLot(director, { initialCount: 40 });
      const litter = await world.pigLot(director, {
        type: 'PORCELET',
        initialCount: 30,
      });
      await setCounter(304);
      const a = await issued({
        lines: [
          { kind: 'LOT', batchId: fat.id, quantity: 12, unitPrice: 135000 },
        ],
      });
      expect(a).toMatchObject({ number: 'FA-0305', total: 1620000 });
      expect(a.lines[0]).toMatchObject({ activity: 'PORCIN' });
      await setCounter(300);
      const b = await issued({
        lines: [
          { kind: 'LOT', batchId: litter.id, quantity: 10, unitPrice: 30000 },
        ],
      });
      expect(b).toMatchObject({ number: 'FA-0301', total: 300000 });
      expect(await alive(fat.id)).toBe(28);
      expect(await alive(litter.id)).toBe(20);
    });

    it('refuses a second issue (409) and numbers the invoices without gaps', async () => {
      const d = await draft({ lines: [lotLine({ quantity: 10 })] });
      await issue(d.id);
      const again = await issue(d.id, accountant, 409);
      expect(msg(again)).toBe('Cette facture est déjà émise');
      expect(await counter()).toBe(1);
      expect(await alive(lotId)).toBe(390);
      const next = await issued({ lines: [lotLine({ quantity: 10 })] });
      expect(next.number).toBe('FA-0002');
    });

    it('41 on a lot of 40 is refused and nothing is written, no number consumed', async () => {
      const small = await world.lot(director, { initialCount: 40 });
      const d = await draft({
        lines: [lotLine({ batchId: small.id, quantity: 41 })],
      });
      const res = await issue(d.id, accountant, 400);
      expect(msg(res)).toBe('Effectif insuffisant');
      expect(await counter()).toBeNull();
      expect((await get(d.id)).status).toBe('BROUILLON');
      expect((await get(d.id)).number).toBeNull();
      expect(await events(small.id)).toHaveLength(0);
      expect(await alive(small.id)).toBe(40);
      const ok = await issued({
        lines: [lotLine({ batchId: small.id, quantity: 40 })],
      });
      expect(ok.number).toBe('FA-0001');
    });

    it('a lot treated 12 days ago (5 + 7) is under withdrawal, 13 days ago is clear', async () => {
      const treat = (lot: string, ago: number) =>
        world.post(director, '/health-acts', {
          type: 'TRAITEMENT',
          status: 'REALISE',
          date: daysAgo(ago),
          productName: 'Amox',
          durationDays: 5,
          withdrawalDays: 7,
          batchId: lot,
        });
      const a = await world.lot(director, { initialCount: 100 });
      await treat(a.id, 12);
      const until = daysAgo(0);
      const err = await refusedIssued({
        date: daysAgo(0),
        lines: [lotLine({ batchId: a.id, quantity: 5 })],
      });
      expect(err).toBe(
        `Le lot ${a.code} est en délai d'attente jusqu'au ${until} : vente impossible`,
      );
      expect(await alive(a.id)).toBe(100);
      const b = await world.lot(director, { initialCount: 100 });
      await treat(b.id, 13);
      await issued({
        date: daysAgo(0),
        lines: [lotLine({ batchId: b.id, quantity: 5 })],
      });
      // judged on the invoice date: an earlier one is still inside the period
      const c = await world.lot(director, { initialCount: 100 });
      await treat(c.id, 13);
      await refusedIssued({
        date: daysAgo(1),
        lines: [lotLine({ batchId: c.id, quantity: 5 })],
      });
    });

    it('guards the eggs of a treated lot and an animal under treatment', async () => {
      const layer = await layerWithEggs(3000);
      await world.post(director, '/health-acts', {
        type: 'TRAITEMENT',
        status: 'REALISE',
        date: daysAgo(0),
        productName: 'Amox',
        withdrawalDays: 2,
        batchId: layer.id,
      });
      expect(
        await refusedIssued({
          date: daysAgo(0),
          lines: [
            { kind: 'OEUFS', batchId: layer.id, quantity: 1, unitPrice: 1 },
          ],
        }),
      ).toContain("est en délai d'attente");
      const sow = await world.animal(director, { tag: 'TR-040' });
      await world.post(director, '/health-acts', {
        type: 'TRAITEMENT',
        status: 'REALISE',
        date: daysAgo(0),
        productName: 'Amox',
        withdrawalDays: 2,
        animalId: sow.id,
      });
      expect(
        await refusedIssued({
          date: daysAgo(0),
          lines: [
            { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 1 },
          ],
        }),
      ).toBe(
        `L'animal TR-040 est en délai d'attente jusqu'au ${daysAgo(-2)} : vente impossible`,
      );
    });

    it('sells TR-027 (VENDU) and refuses TR-014 (pregnant) with 409', async () => {
      const sow = await world.animal(director, { tag: 'TR-027' });
      const gest = await world.animal(director, { tag: 'TR-014' });
      await prisma.animal.update({
        where: { id: gest.id },
        data: { status: 'GESTANTE' },
      });
      const line = (id: string) => ({
        kind: 'ANIMAL',
        animalId: id,
        quantity: 1,
        unitPrice: 250000,
        weightKg: 180,
      });
      const bad = await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send(body({ lines: [lotLine({ quantity: 1 }), line(gest.id)] }))
        .expect(409);
      expect(msg(bad)).toContain('gestante');
      expect(await alive(lotId)).toBe(400);
      const inv = await issued({ lines: [line(sow.id)] });
      expect(inv.lines[0]).toMatchObject({
        designation: 'Truie TR-027',
        activity: 'PORCIN',
        weightKg: 180,
      });
      const a = await prisma.animal.findUniqueOrThrow({
        where: { id: sow.id },
      });
      expect(a).toMatchObject({
        status: 'VENDU',
        exitReason: 'VENDU',
        exitSourceType: 'SALE',
        exitSourceId: inv.id,
        exitSourceLabel: inv.number,
      });
      // the same animal cannot be sold twice
      const again = await draft({ lines: [line(sow.id)] });
      await issue(again.id, accountant, 409);
    });

    it('sells 100 kg of Aliment ponte at the average cost; the ledger is the only truth of the cost (no snapshot column)', async () => {
      const item = await article();
      const inv = await issued({ lines: [itemLine(item)] });
      expect(await level(item)).toMatchObject({
        quantity: 900,
        averageCost: 320,
      });
      const exits = (await stockMoves(item)).filter((m) => m.type === 'SORTIE');
      expect(exits).toHaveLength(1);
      expect(exits[0]).toMatchObject({
        quantity: -100,
        unitCost: 320,
        reason: 'VENTE',
        sourceType: 'SALE',
        sourceId: inv.id,
      });
      expect(inv.lines[0]).toMatchObject({
        designation: 'Aliment ponte',
        unit: 'kg',
        category: 'VENTE_ARTICLES',
        activity: 'GENERAL',
      });
      const cols = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'InvoiceLine' AND column_name = 'exitUnitCost'`;
      expect(cols).toHaveLength(0);
    });

    it('refuses an article line dated before a validated inventory (409)', async () => {
      const item = await article();
      const session = await world.post<Id>(stockMgr, '/inventories', {
        date: daysAgo(1),
      });
      await http()
        .put(`/api/inventories/${session.id}/lines`)
        .set(stockMgr)
        .send({ lines: [{ itemId: item, countedQty: 1000 }] })
        .expect(200);
      await http()
        .post(`/api/inventories/${session.id}/validate`)
        .set(stockMgr)
        .expect(201);
      const err = await refusedIssued(
        { date: daysAgo(5), lines: [itemLine(item)] },
        409,
      );
      expect(err).toBe(
        `Un inventaire validé le ${daysAgo(1)} verrouille les mouvements antérieurs de Aliment ponte`,
      );
      expect((await level(item)).quantity).toBe(1000);
    });

    it('one invoice with a lot, eggs, an animal and an article writes one effect of each, all of source SALE', async () => {
      const layer = await layerWithEggs(3000);
      const sow = await world.animal(director, { tag: 'TR-027' });
      const item = await article();
      const inv = await issued({
        lines: [
          lotLine({ quantity: 50 }),
          { kind: 'OEUFS', batchId: layer.id, quantity: 20, unitPrice: 2500 },
          { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 250000 },
          itemLine(item, { quantity: 60 }),
          itemLine(item, { quantity: 40, unitPrice: 500 }),
        ],
      });
      expect(inv.status).toBe('EMISE');
      expect(await events(lotId)).toHaveLength(1);
      expect(await alive(lotId)).toBe(350);
      expect((await level(item)).quantity).toBe(900);
      const exits = (await stockMoves(item)).filter((m) => m.type === 'SORTIE');
      expect(exits.every((m) => m.sourceId === inv.id)).toBe(true);
      expect(exits.reduce((s, m) => s + m.quantity, 0)).toBe(-100);
      const audit = (await audits(inv.id)).at(-1);
      expect(JSON.stringify(audit?.after)).toContain('TR-027');
      // 600 of the 3 000 eggs are gone
      const sellables = (
        await http()
          .get('/api/sales/sellables')
          .query({ kind: 'OEUFS', date: daysAgo(0) })
          .set(seller)
          .expect(200)
      ).body as { items: { id: string; available: number }[] };
      expect(sellables.items.find((s) => s.id === layer.id)?.available).toBe(
        2400,
      );
    });

    it('is atomic: an article shortage after a lot sale leaves the lot, the counter and the draft untouched', async () => {
      const item = await article(50);
      const d = await draft({
        lines: [lotLine({ quantity: 10 }), itemLine(item, { quantity: 51 })],
      });
      const res = await issue(d.id, accountant, 400);
      expect(msg(res)).toContain('Stock insuffisant pour Aliment ponte');
      expect(await alive(lotId)).toBe(400);
      expect(await events(lotId)).toHaveLength(0);
      expect((await level(item)).quantity).toBe(50);
      expect(await counter()).toBeNull();
      expect((await get(d.id)).status).toBe('BROUILLON');
    });

    it('a total of 0 is settled at issue', async () => {
      const inv = await issued({
        lines: [
          { kind: 'SERVICE', designation: 'Cadeau', quantity: 1, unitPrice: 0 },
        ],
      });
      expect(inv).toMatchObject({ status: 'SOLDEE', total: 0, due: 0 });
    });

    it('refuses an inactive customer at issue, then issues with the payment collected (RC-0001) once it is active again', async () => {
      const d = await draft();
      await http()
        .patch(`/api/customers/${customerId}`)
        .set(seller)
        .send({ active: false })
        .expect(200);
      expect(msg(await issue(d.id, accountant, 400))).toBe(
        'Ce client est inactif',
      );
      await http()
        .patch(`/api/customers/${customerId}`)
        .set(seller)
        .send({ active: true })
        .expect(200);
      const pay = await http()
        .post(`/api/sales/${d.id}/issue`)
        .set(accountant)
        .send({ payment: { amount: 1000, method: 'ESPECES' } })
        .expect(201);
      expect(pay.body).toMatchObject({
        status: 'PARTIELLE',
        paid: 1000,
        payments: [{ number: 'RC-0001', amount: 1000, method: 'ESPECES' }],
      });
      await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send({
          ...body({ lines: [lotLine({ quantity: 1 })] }),
          payment: { amount: 3500, method: 'ESPECES' },
        })
        .expect(201);
      const again = await draft({ lines: [lotLine({ quantity: 1 })] });
      await http()
        .post(`/api/sales/${again.id}/issue`)
        .set(accountant)
        .send({ payment: { amount: 0, method: 'X' } })
        .expect(400);
      expect((await get(again.id)).status).toBe('BROUILLON');
    });

    it('permissions: COMPTABLE and COMMERCIAL issue, read-only and unrelated roles do not', async () => {
      const a = await draft({ lines: [lotLine({ quantity: 1 })] });
      await issue(a.id, director, 403);
      await issue(a.id, keeper, 403);
      await issue(a.id, accountant);
      const b = await draft({ lines: [lotLine({ quantity: 1 })] });
      await issue(b.id, seller);
      await http().get('/api/sales').set(keeper).expect(403);
      await http()
        .post('/api/sales/issued')
        .set(director)
        .send(body())
        .expect(403);
      // COMPTABLE cannot make a draft (daily entry) but issues in one go
      await http().post('/api/sales').set(accountant).send(body()).expect(403);
      await http().post('/api/sales').set(owner).send(body()).expect(403);
      await http().delete(`/api/sales/${a.id}`).set(director).expect(403);
    });
  });

  describe('more rules of the issue', () => {
    const entry = (
      itemId: string,
      quantity: number,
      unitCost: number,
      date: string,
      over: Record<string, unknown> = {},
    ) =>
      world.post(stockMgr, '/stock/movements', {
        itemId,
        type: 'ENTREE',
        date,
        quantity,
        unitCost,
        reason: 'ACHAT',
        ...over,
      });
    const newItem = (name: string) =>
      world.post<Id>(stockMgr, '/stock-items', {
        name,
        category: 'ALIMENT',
        unit: 'kg',
      });

    it('refuses an article that was deactivated since the draft (Article inactif), like an inactive customer', async () => {
      const item = await article();
      const d = await draft({ lines: [itemLine(item)] });
      await http()
        .patch(`/api/stock-items/${item}`)
        .set(stockMgr)
        .send({ active: false })
        .expect(200);
      expect(msg(await issue(d.id, accountant, 400))).toBe('Article inactif');
      expect((await get(d.id)).status).toBe('BROUILLON');
      expect((await level(item)).quantity).toBe(1000);
    });

    it('refuses the same animal on two lines of one invoice, at draft time', async () => {
      const sow = await world.animal(director, { tag: 'TR-027' });
      const line = {
        kind: 'ANIMAL',
        animalId: sow.id,
        quantity: 1,
        unitPrice: 1,
      };
      const res = await http()
        .post('/api/sales')
        .set(seller)
        .send(body({ lines: [line, line] }))
        .expect(400);
      expect(msg(res)).toBe('Cet animal figure déjà sur la facture');
      const quoteRes = await http()
        .post('/api/quotes')
        .set(seller)
        .send(body({ lines: [line, line] }))
        .expect(400);
      expect(msg(quoteRes)).toBe('Cet animal figure déjà sur le devis');
    });

    it('takes two LOT lines of one lot as ONE VENTE event (the sum) and gives it back', async () => {
      const inv = await issued({
        lines: [lotLine({ quantity: 100 }), lotLine({ quantity: 50 })],
      });
      expect(await alive(lotId)).toBe(250);
      const ev = await events(lotId);
      expect(ev.map((e) => e.quantity)).toEqual([150]);
      await issue(inv.id, accountant, 409);
      await cancel(inv.id);
      expect(await alive(lotId)).toBe(400);
      expect(await events(lotId)).toHaveLength(0);
    });

    it('checks a LOT line and an OEUFS line of the same laying lot together', async () => {
      const layer = await layerWithEggs(3000);
      const inv = await issued({
        lines: [
          lotLine({ batchId: layer.id, quantity: 20, unitPrice: 2000 }),
          { kind: 'OEUFS', batchId: layer.id, quantity: 100, unitPrice: 2500 },
        ],
      });
      expect(await alive(layer.id)).toBe(2980);
      expect(await events(layer.id)).toHaveLength(1);
      // 100 plateaux = 3 000 eggs: nothing left
      expect(
        await refusedIssued({
          lines: [
            { kind: 'OEUFS', batchId: layer.id, quantity: 1, unitPrice: 1 },
          ],
        }),
      ).toContain('Œufs disponibles insuffisants');
      await cancel(inv.id);
      expect(await alive(layer.id)).toBe(3000);
    });

    it('refuses to sell from an expired stock lot (Lot périmé) and writes nothing', async () => {
      const item = (await newItem('Vaccin périmé')).id;
      await entry(item, 10, 100, daysAgo(40), {
        lotNumber: 'P1',
        expiryDate: daysAgo(5),
      });
      expect(
        await refusedIssued({
          lines: [lotLine({ quantity: 5 }), itemLine(item, { quantity: 5 })],
        }),
      ).toBe('Lot périmé');
      expect(await alive(lotId)).toBe(400);
      expect(await counter()).toBeNull();
    });

    it('writes no herd audit row for the VENTE event: the invoice audit row carries the lines', async () => {
      const others = () =>
        prisma.auditLog.count({ where: { NOT: { module: 'ventes' } } });
      const before = await others();
      const inv = await issued({ lines: [lotLine({ quantity: 10 })] });
      await cancel(inv.id);
      expect(await others()).toBe(before);
      const rows = await audits(inv.id);
      expect(rows.map((r) => r.module)).toEqual(['ventes', 'ventes']);
    });
  });

  describe('cancel', () => {
    it('restores the lot, the animal and the stock, keeps the number and shows Annulée', async () => {
      const sow = await world.animal(director, { tag: 'TR-027' });
      const item = await article();
      const inv = await issued({
        lines: [
          lotLine(),
          { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 250000 },
          itemLine(item),
        ],
      });
      expect(await alive(lotId)).toBe(100);
      const res = await cancel(inv.id, owner, 201, 'Client parti');
      const c = res.body as Detail;
      expect(c).toMatchObject({
        status: 'ANNULEE',
        number: inv.number,
        cancelReason: 'Client parti',
        due: 0,
      });
      expect(c.history.map((s) => s.step)).toEqual([
        'BROUILLON',
        'EMISE',
        'ANNULEE',
      ]);
      expect(c.history[2].note).toBe('Client parti');
      expect(await alive(lotId)).toBe(400);
      expect(await events(lotId)).toHaveLength(0);
      const a = await prisma.animal.findUniqueOrThrow({
        where: { id: sow.id },
      });
      expect(a).toMatchObject({
        status: 'ACTIF',
        exitSourceId: null,
        exitReason: null,
      });
      expect(await level(item)).toMatchObject({
        quantity: 1000,
        averageCost: 320,
      });
      expect((await audits(inv.id)).at(-1)).toMatchObject({ action: 'UPDATE' });
      expect(msg(await cancel(inv.id, accountant, 409))).toBe(
        'Seule une facture émise peut être annulée',
      );
      // the animal can be sold again, on a new invoice
      await issued({
        lines: [
          { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 1 },
        ],
      });
    });

    it('needs ventes:validate and a reason; a draft cannot be cancelled', async () => {
      const inv = await issued({ lines: [lotLine({ quantity: 1 })] });
      await cancel(inv.id, seller, 403);
      await cancel(inv.id, director, 403);
      await http()
        .post(`/api/sales/${inv.id}/cancel`)
        .set(accountant)
        .send({})
        .expect(400);
      await http()
        .post(`/api/sales/${inv.id}/cancel`)
        .set(accountant)
        .send({ reason: ' ' })
        .expect(400);
      expect((await get(inv.id)).status).toBe('EMISE');
      const d = await draft();
      expect(msg(await cancel(d.id, accountant, 409))).toBe(
        'Seule une facture émise peut être annulée',
      );
      await cancel(inv.id, accountant);
    });

    it('is refused whole when the lot was closed: nothing reversed', async () => {
      const item = await article();
      const small = await world.lot(director, { initialCount: 50 });
      const inv = await issued({
        lines: [lotLine({ batchId: small.id, quantity: 50 }), itemLine(item)],
      });
      expect(await alive(small.id)).toBe(0);
      await http()
        .post(`/api/batches/${small.id}/close`)
        .set(director)
        .send({})
        .expect(200);
      const res = await cancel(inv.id, accountant, 409);
      expect(msg(res)).toBe('Ce lot est clôturé');
      expect((await get(inv.id)).status).toBe('EMISE');
      expect((await level(item)).quantity).toBe(900);
      expect(await events(small.id)).toHaveLength(1);
    });

    it('is refused whole when a validated inventory closed the past of an article', async () => {
      const item = await article();
      const inv = await issued({
        date: daysAgo(5),
        lines: [lotLine({ quantity: 10 }), itemLine(item)],
      });
      const session = await world.post<Id>(stockMgr, '/inventories', {
        date: daysAgo(1),
      });
      await http()
        .put(`/api/inventories/${session.id}/lines`)
        .set(stockMgr)
        .send({ lines: [{ itemId: item, countedQty: 900 }] })
        .expect(200);
      await http()
        .post(`/api/inventories/${session.id}/validate`)
        .set(stockMgr)
        .expect(201);
      const res = await cancel(inv.id, accountant, 409);
      expect(msg(res)).toContain('verrouille les mouvements antérieurs');
      expect(await alive(lotId)).toBe(390);
      expect((await get(inv.id)).status).toBe('EMISE');
    });

    it('is refused whole when a sold animal is no longer as it was left', async () => {
      const sow = await world.animal(director, { tag: 'TR-027' });
      const inv = await issued({
        lines: [
          lotLine({ quantity: 10 }),
          { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 1 },
        ],
      });
      await prisma.animal.update({
        where: { id: sow.id },
        data: { status: 'MORT' },
      });
      await cancel(inv.id, accountant, 409);
      expect(await alive(lotId)).toBe(390);
      expect((await get(inv.id)).status).toBe('EMISE');
    });
    it('gives back the exact average cost: a sale in the past, an entry after it, then the cancellation', async () => {
      const item = (
        await world.post<Id>(stockMgr, '/stock-items', {
          name: 'Aliment chair',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
      const entry = (quantity: number, unitCost: number, date: string) =>
        world.post(stockMgr, '/stock/movements', {
          itemId: item,
          type: 'ENTREE',
          date,
          quantity,
          unitCost,
          reason: 'ACHAT',
        });
      await entry(1000, 320, daysAgo(10));
      const inv = await issued({
        date: daysAgo(5),
        lines: [itemLine(item, { quantity: 100 })],
      });
      await entry(500, 380, daysAgo(2));
      const during = await level(item);
      expect(during.quantity).toBe(1400);
      // (900 x 320 + 500 x 380) / 1 400
      expect(during.averageCost).toBe(341.43);
      await cancel(inv.id);
      const after = await level(item);
      expect(after.quantity).toBe(1500);
      // (1 000 x 320 + 500 x 380) / 1 500
      expect(after.averageCost).toBe(340);
      expect(after.averageCost).not.toBe(during.averageCost);
      expect(
        (await stockMoves(item)).filter((m) => m.sourceType === 'SALE'),
      ).toHaveLength(0);
    });

    it('restores both lots of an exit that FEFO split across lots received at different costs', async () => {
      const item = (
        await world.post<Id>(stockMgr, '/stock-items', {
          name: 'Vaccin',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
      const entry = (
        quantity: number,
        unitCost: number,
        lotNumber: string,
        expiryDate: string,
      ) =>
        world.post(stockMgr, '/stock/movements', {
          itemId: item,
          type: 'ENTREE',
          date: daysAgo(20),
          quantity,
          unitCost,
          reason: 'ACHAT',
          lotNumber,
          expiryDate,
        });
      await entry(40, 300, 'SOON', '2090-01-01');
      await entry(100, 400, 'LATE', '2099-01-01');
      const lots = async () =>
        Object.fromEntries(
          (
            (await http().get(`/api/stock/${item}`).set(director).expect(200))
              .body as { batches: { lotNumber: string; quantity: number }[] }
          ).batches.map((b) => [b.lotNumber, b.quantity]),
        );
      expect(await lots()).toEqual({ SOON: 40, LATE: 100 });
      const inv = await issued({
        lines: [itemLine(item, { quantity: 100 })],
      });
      const exits = (await stockMoves(item)).filter((m) => m.type === 'SORTIE');
      expect(exits).toHaveLength(2);
      const after = await lots();
      expect(after.SOON ?? 0).toBe(0);
      expect(after.LATE).toBe(40);
      await cancel(inv.id);
      expect(await lots()).toEqual({ SOON: 40, LATE: 100 });
      expect(await level(item)).toMatchObject({ quantity: 140 });
    });

    it('is refused whole when the egg lot of a sale was closed (409), nothing reversed', async () => {
      const layer = await layerWithEggs(3000, 10);
      const inv = await issued({
        lines: [
          { kind: 'OEUFS', batchId: layer.id, quantity: 10, unitPrice: 2500 },
          lotLine({ batchId: layer.id, quantity: 10 }),
          lotLine({ quantity: 5 }),
        ],
      });
      await http()
        .post(`/api/batches/${layer.id}/close`)
        .set(director)
        .send({})
        .expect(200);
      const res = await cancel(inv.id, accountant, 409);
      expect(msg(res)).toBe('Ce lot est clôturé');
      expect((await get(inv.id)).status).toBe('EMISE');
      expect(await alive(lotId)).toBe(395);
    });

    it('cancelling an egg-only sale of a closed laying lot is refused too (the egg seam)', async () => {
      const layer = await layerWithEggs(3000, 10);
      const inv = await issued({
        lines: [
          { kind: 'OEUFS', batchId: layer.id, quantity: 10, unitPrice: 2500 },
        ],
      });
      await issued({ lines: [lotLine({ batchId: layer.id, quantity: 10 })] });
      await http()
        .post(`/api/batches/${layer.id}/close`)
        .set(director)
        .send({})
        .expect(200);
      expect(msg(await cancel(inv.id, accountant, 409))).toBe(
        'Ce lot est clôturé',
      );
      expect((await get(inv.id)).status).toBe('EMISE');
    });

    it('refuses an egg sale on a closed laying lot, and cancelling a sale that would overfill the building (400) leaves everything in place', async () => {
      const closed = await layerWithEggs(3000, 10);
      await issued({ lines: [lotLine({ batchId: closed.id, quantity: 10 })] });
      await http()
        .post(`/api/batches/${closed.id}/close`)
        .set(director)
        .send({})
        .expect(200);
      expect(
        await refusedIssued(
          {
            lines: [
              { kind: 'OEUFS', batchId: closed.id, quantity: 1, unitPrice: 1 },
            ],
          },
          409,
        ),
      ).toBe('Ce lot est clôturé');
      const site = await prisma.site.findFirstOrThrow();
      const small = await prisma.building.create({
        data: {
          farmId: world.farmId,
          siteId: site.id,
          name: 'Petit poulailler',
          type: 'AVICOLE',
          capacity: 10,
        },
      });
      const lot = await world.lot(director, {
        initialCount: 10,
        buildingId: small.id,
      });
      const item = await article();
      const inv = await issued({
        lines: [lotLine({ batchId: lot.id, quantity: 10 }), itemLine(item)],
      });
      await world.lot(director, { initialCount: 10, buildingId: small.id });
      const res = await cancel(inv.id, accountant, 400);
      expect(msg(res)).toContain('Capacité du bâtiment dépassée');
      expect((await get(inv.id)).status).toBe('EMISE');
      expect(await alive(lot.id)).toBe(0);
      expect((await level(item)).quantity).toBe(900);
      expect(await events(lot.id)).toHaveLength(1);
    });
  });

  describe('reads', () => {
    it('lists rows with first line, pages, sorts, filters, search and status counts', async () => {
      const ramco = await world.post(seller, '/customers', {
        name: 'SuperMarché Ramco',
        type: 'GROSSISTE',
      });
      const item = await article();
      const a = await issued({
        date: daysAgo(4),
        lines: [lotLine({ quantity: 10 })],
      });
      const b = await issued({
        customerId: ramco.id,
        date: daysAgo(3),
        lines: [itemLine(item), lotLine({ quantity: 1 })],
      });
      const d = await draft({ date: daysAgo(1) });
      const c = await issued({
        date: daysAgo(2),
        lines: [lotLine({ quantity: 20 })],
      });
      await cancel(c.id);
      const all = await list();
      expect(all.total).toBe(4);
      expect(all.items.map((r) => r.id)).toEqual([d.id, c.id, b.id, a.id]);
      expect(all.statusCounts).toEqual({
        BROUILLON: 1,
        EMISE: 2,
        PARTIELLE: 0,
        SOLDEE: 0,
        ANNULEE: 1,
      });
      expect(all.items[2]).toMatchObject({
        product: 'Aliment ponte +1',
        quantity: 100,
        unit: 'kg',
        customerName: 'SuperMarché Ramco',
        total: 48500,
        due: 48500,
      });
      expect(all.items[1]).toMatchObject({ status: 'ANNULEE', due: 0 });
      const ids = async (q: Record<string, string>) =>
        (await list(seller, q)).items.map((r) => r.id);
      expect(await ids({ status: 'EMISE' })).toEqual([b.id, a.id]);
      expect(await ids({ customerId: ramco.id })).toEqual([b.id]);
      expect(await ids({ from: daysAgo(3), to: daysAgo(2) })).toEqual([
        c.id,
        b.id,
      ]);
      expect(await ids({ search: 'palmier' })).toHaveLength(3);
      expect(await ids({ search: a.number as string })).toEqual([a.id]);
      expect(await ids({ search: 'aliment' })).toEqual([b.id]);
      expect(await ids({ sort: 'total:asc', status: 'EMISE' })).toEqual([
        a.id,
        b.id,
      ]);
      expect(await ids({ sort: 'total:desc', status: 'EMISE' })).toEqual([
        b.id,
        a.id,
      ]);
      expect(await ids({ sort: 'due:desc', status: 'EMISE' })).toEqual([
        b.id,
        a.id,
      ]);
      expect(await ids({ sort: 'due:asc', status: 'EMISE' })).toEqual([
        a.id,
        b.id,
      ]);
      expect(await ids({ sort: 'number:asc', status: 'EMISE' })).toEqual([
        a.id,
        b.id,
      ]);
      expect(await ids({ sort: 'date:asc' })).toEqual([a.id, b.id, c.id, d.id]);
      const page = await list(seller, { page: '2', pageSize: '3' });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(4);
      await http()
        .get('/api/sales')
        .query({ sort: 'foo:asc' })
        .set(seller)
        .expect(400);
      await http()
        .get('/api/sales')
        .query({ status: 'FOO' })
        .set(seller)
        .expect(400);
      await http()
        .get('/api/sales')
        .query({ from: 'x' })
        .set(seller)
        .expect(400);
    });

    it('flags overdue invoices (issued, due, due date before today)', async () => {
      const past = await issued({
        date: daysAgo(10),
        dueDate: daysAgo(1),
        lines: [lotLine({ quantity: 1 })],
      });
      const today = await issued({
        date: daysAgo(10),
        dueDate: daysAgo(0),
        lines: [lotLine({ quantity: 1 })],
      });
      const zero = await issued({
        date: daysAgo(10),
        dueDate: daysAgo(1),
        lines: [
          { kind: 'SERVICE', designation: 'x', quantity: 1, unitPrice: 0 },
        ],
      });
      const cancelled = await issued({
        date: daysAgo(10),
        dueDate: daysAgo(1),
        lines: [lotLine({ quantity: 1 })],
      });
      await cancel(cancelled.id);
      const rows = new Map((await list()).items.map((r) => [r.id, r.overdue]));
      expect(rows.get(past.id)).toBe(true);
      expect(rows.get(today.id)).toBe(false);
      expect(rows.get(zero.id)).toBe(false);
      expect(rows.get(cancelled.id)).toBe(false);
    });

    it('exports the CSV with its header', async () => {
      await setCounter(309);
      await issued({ lines: [lotLine()] });
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
      expect(lines[1]).toContain(
        `${daysAgo(2)};FA-0310;Restaurant Le Palmier;Poulets de chair;300;1050000;0;1050000;`,
      );
    });

    it('does not let sellables be taken for an invoice id', async () => {
      await http()
        .get('/api/sales/sellables')
        .query({ kind: 'LOT', date: daysAgo(0) })
        .set(seller)
        .expect(200);
      await http().get('/api/sales/unknown').set(seller).expect(404);
    });

    it('hides the invoices of another farm (404 in a path) and is read-only under all', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'SUPER_ADMIN',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const onAll = { Authorization: auth, 'X-Farm-Id': 'all' };
      const inv = await issued();
      const dr = await draft();
      for (const [method, path, payload] of [
        ['get', '', undefined],
        ['patch', '', { note: 'x' }],
        ['delete', '', undefined],
        ['post', '/issue', {}],
        ['post', '/cancel', { reason: 'x' }],
      ] as const) {
        const res = await http()
          [method](`/api/sales/${inv.id}${path}`)
          .set(onB)
          .send(payload);
        expect(`${method}${path} ${res.status}`).toBe(`${method}${path} 404`);
      }
      expect((await list(onB)).total).toBe(0);
      expect((await list(onAll)).total).toBe(2);
      expect((await get(inv.id, onAll)).id).toBe(inv.id);
      await http()
        .post('/api/sales/issued')
        .set(onAll)
        .send(body())
        .expect(403);
      await issue(dr.id, onAll, 403);
      await cancel(inv.id, onAll, 403);
      // a lot of farm A on farm B is a 400
      await http().post('/api/sales/issued').set(onB).send(body()).expect(400);
    });

    it('lists the sales of one customer for the customer sheet, and customers with invoices cannot be deleted', async () => {
      await issued({ lines: [lotLine({ quantity: 1 })] });
      expect((await list(seller, { customerId })).total).toBe(1);
      await http()
        .delete(`/api/customers/${customerId}`)
        .set(seller)
        .expect(409);
    });
  });

  describe('quote conversion', () => {
    const quote = (over: Record<string, unknown> = {}) =>
      world.post<{ id: string; reference: string; lines: Line[] }>(
        seller,
        '/quotes',
        body({
          lines: [
            lotLine(),
            {
              kind: 'SERVICE',
              designation: 'Livraison',
              quantity: 3,
              unitPrice: 333.33,
            },
          ],
          ...over,
        }),
      );
    const step = (id: string, s: string, status = 201) =>
      http().post(`/api/quotes/${id}/${s}`).set(seller).send({}).expect(status);

    it('converts DV-0001 into a draft with the same lines, links both ways, and shows FA once issued', async () => {
      const q = await quote();
      expect(q.reference).toBe('DV-0001');
      await step(q.id, 'send');
      const res = await step(q.id, 'convert');
      const converted = res.body as {
        status: string;
        invoiceId: string;
        invoiceNumber: string | null;
      };
      expect(converted).toMatchObject({
        status: 'FACTURE',
        invoiceNumber: null,
      });
      const inv = await get(converted.invoiceId);
      expect(inv).toMatchObject({
        status: 'BROUILLON',
        number: null,
        quoteId: q.id,
        quoteNumber: 'DV-0001',
        total: 1050000 + 999.99,
        customerId,
      });
      expect(
        inv.lines.map((l) => [
          l.kind,
          l.designation,
          l.quantity,
          l.unitPrice,
          l.amount,
        ]),
      ).toEqual(
        q.lines.map((l) => [
          l.kind,
          l.designation,
          l.quantity,
          l.unitPrice,
          l.amount,
        ]),
      );
      expect(inv.lines[0].batchId).toBe(lotId);
      const quoteView = (
        await http().get(`/api/quotes/${q.id}`).set(seller).expect(200)
      ).body as {
        status: string;
        invoiceId: string;
        invoiceNumber: string | null;
        history: Step[];
      };
      expect(quoteView).toMatchObject({ status: 'FACTURE', invoiceId: inv.id });
      expect(quoteView.history.map((s) => s.step)).toContain('FACTURE');
      expect(msg(await step(q.id, 'convert', 409))).toBe(
        'Seul un devis envoyé ou accepté peut être facturé',
      );
      await issue(inv.id);
      const after = (
        await http().get(`/api/quotes/${q.id}`).set(seller).expect(200)
      ).body as { invoiceNumber: string };
      expect(after.invoiceNumber).toBe('FA-0001');
      const rows = (await http().get('/api/quotes').set(seller).expect(200))
        .body as Page<{ invoiceNumber: string | null }>;
      expect(rows.items[0].invoiceNumber).toBe('FA-0001');
      expect(await audits(inv.id)).toHaveLength(2);
      expect((await audits(q.id)).map((r) => r.action)).toContain('UPDATE');
    });

    it('needs a sent or accepted quote and an active customer; only the daily right converts', async () => {
      const q = await quote();
      await step(q.id, 'convert', 409);
      await step(q.id, 'send');
      await http()
        .post(`/api/quotes/${q.id}/convert`)
        .set(accountant)
        .send({})
        .expect(403);
      await http()
        .patch(`/api/customers/${customerId}`)
        .set(seller)
        .send({ active: false })
        .expect(200);
      expect(msg(await step(q.id, 'convert', 400))).toBe(
        'Ce client est inactif',
      );
      const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM "Invoice"`;
      expect(Number(n)).toBe(0);
    });

    it('deleting the converted draft frees the quote again', async () => {
      const q = await quote();
      await step(q.id, 'send');
      await step(q.id, 'accept');
      const inv = (await step(q.id, 'convert')).body as { invoiceId: string };
      await http()
        .delete(`/api/sales/${inv.invoiceId}`)
        .set(seller)
        .expect(200);
      const back = (
        await http().get(`/api/quotes/${q.id}`).set(seller).expect(200)
      ).body as { status: string; invoiceId: string | null };
      expect(back).toMatchObject({ status: 'ACCEPTE', invoiceId: null });
      await step(q.id, 'convert');
    });
  });

  describe('exitCostsByItem (what the exits of an invoice cost, from the ledger)', () => {
    const entry = (
      itemId: string,
      quantity: number,
      unitCost: number,
      date: string,
      over: Record<string, unknown> = {},
    ) =>
      world.post(stockMgr, '/stock/movements', {
        itemId,
        type: 'ENTREE',
        date,
        quantity,
        unitCost,
        reason: 'ACHAT',
        ...over,
      });
    const newItem = async (name: string) =>
      (
        await world.post<Id>(stockMgr, '/stock-items', {
          name,
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
    const costs = (invoiceId: string) =>
      exitCostsByItem(prisma, { sourceType: 'SALE', sourceId: invoiceId });

    it('sums quantity and cost per article, over a FEFO split and two lines of one article, and follows a re-costing', async () => {
      const a = await newItem('Aliment A');
      const b = await newItem('Aliment B');
      await entry(a, 40, 300, daysAgo(20), {
        lotNumber: 'SOON',
        expiryDate: '2090-01-01',
      });
      await entry(a, 100, 400, daysAgo(20), {
        lotNumber: 'LATE',
        expiryDate: '2099-01-01',
      });
      await entry(b, 50, 200, daysAgo(20));
      const inv = await issued({
        lines: [
          itemLine(a, { quantity: 50 }),
          itemLine(b, { quantity: 10 }),
          itemLine(a, { quantity: 10 }),
        ],
      });
      const first = await costs(inv.id);
      expect([...first.keys()].sort()).toEqual([a, b].sort());
      // A: average (40 x 300 + 100 x 400) / 140 = 371.43; 60 kg out
      expect(first.get(a)?.quantity.toNumber()).toBe(60);
      expect(first.get(a)?.cost.toNumber()).toBeCloseTo(
        Math.round(50 * 371.43 * 100) / 100 +
          Math.round(10 * 371.43 * 100) / 100,
        2,
      );
      expect(first.get(b)?.quantity.toNumber()).toBe(10);
      expect(first.get(b)?.cost.toNumber()).toBe(2000);
      // An entry dated before the sale re-costs the exit: the read follows the ledger.
      await entry(a, 100, 500, daysAgo(8));
      const second = await costs(inv.id);
      expect(second.get(a)?.cost.toNumber()).not.toBe(
        first.get(a)?.cost.toNumber(),
      );
      expect(second.get(a)?.quantity.toNumber()).toBe(60);
      // a source with nothing sold
      expect((await costs('unknown')).size).toBe(0);
    });
  });

  describe('database constraints', () => {
    it('keeps number and status together, the due date after the date, and the lines coherent', async () => {
      const inv = await issued();
      const sql = (text: string) => prisma.$executeRawUnsafe(text);
      await expect(
        sql(`UPDATE "Invoice" SET "number" = NULL WHERE id = '${inv.id}'`),
      ).rejects.toThrow(/Invoice_number_status_check/);
      await expect(
        sql(
          `UPDATE "Invoice" SET "status" = 'BROUILLON' WHERE id = '${inv.id}'`,
        ),
      ).rejects.toThrow(/Invoice_(number_status|issued)_check/);
      await expect(
        sql(
          `UPDATE "Invoice" SET "dueDate" = "date" - 1 WHERE id = '${inv.id}'`,
        ),
      ).rejects.toThrow(/Invoice_dueDate_check/);
      await expect(
        sql(`UPDATE "Invoice" SET "total" = -1 WHERE id = '${inv.id}'`),
      ).rejects.toThrow(/Invoice_total_check/);
      await expect(
        sql(
          `UPDATE "InvoiceLine" SET "amount" = 1 WHERE "invoiceId" = '${inv.id}'`,
        ),
      ).rejects.toThrow(/InvoiceLine_amount_check/);
      await expect(
        sql(
          `UPDATE "InvoiceLine" SET "batchId" = NULL WHERE "invoiceId" = '${inv.id}'`,
        ),
      ).rejects.toThrow(/InvoiceLine_kind_check/);
      await expect(
        sql(
          `UPDATE "InvoiceLine" SET "revenueCategory" = 'VENTE_OEUFS' WHERE "invoiceId" = '${inv.id}'`,
        ),
      ).rejects.toThrow(/InvoiceLine_category_check/);
      await expect(
        sql(
          `UPDATE "InvoiceLine" SET "activity" = 'GENERAL' WHERE "invoiceId" = '${inv.id}'`,
        ),
      ).rejects.toThrow(/InvoiceLine_activity_check/);
      await expect(
        sql(`UPDATE "Invoice" SET "issuedAt" = NULL WHERE id = '${inv.id}'`),
      ).rejects.toThrow(/Invoice_issued_check/);
      await expect(
        sql(
          `UPDATE "Invoice" SET "cancelledAt" = now() WHERE id = '${inv.id}'`,
        ),
      ).rejects.toThrow(/Invoice_cancelled_check/);
      const d = await draft();
      await expect(
        sql(
          `UPDATE "Invoice" SET "issuedById" = "createdById" WHERE id = '${d.id}'`,
        ),
      ).rejects.toThrow(/Invoice_issued_check/);
    });
  });
});
