import { INestApplication } from '@nestjs/common';
import { LotCostRegistry } from '../src/indicators/lot-cost';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { countQueries } from './query-counter';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface EntryRow {
  id: string;
  origin: string;
  sourceId: string | null;
  date: string;
  label: string;
  kind: string;
  activity: string;
  category: string;
  amount: number;
  batchId: string | null;
  batchCode: string | null;
  note: string | null;
  editable: boolean;
}
interface EntriesPage {
  items: EntryRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { revenue: number; expenses: number; balance: number };
}
interface ActivityRow {
  activity: string;
  revenue: number;
  expenses: number;
  margin: number;
}
interface Summary {
  from: string;
  to: string;
  revenue: number;
  expenses: number;
  margin: number;
  marginPct: number | null;
  receivables: number;
  byActivity: ActivityRow[];
  byCategory: {
    kind: string;
    category: string;
    label: string;
    amount: number;
  }[];
  byFarm?: {
    farmId: string;
    farmName: string;
    revenue: number;
    expenses: number;
    margin: number;
  }[];
}
interface LotRow {
  id: string;
  batchId: string;
  code: string;
  species: string;
  type: string;
  status: string;
  animals: number;
  sold: number;
  alive: number;
  costs: { animaux: number; aliment: number; sante: number; autres: number };
  totalCost: number;
  revenue: number;
  margin: number;
  costPerAnimal: number | null;
  costPerKg: number | null;
  lines?: { category: string; label: string; amount: number }[];
}
interface LotsPage {
  items: LotRow[];
  total: number;
}
interface InvoiceDetail extends Id {
  number: string;
  lines: { id: string }[];
}

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const MESSAGES = {
  derived:
    "Cette écriture provient d'un document ; corrigez le document d'origine",
  badLot: 'Lot invalide pour cette ferme',
  lotActivity: "Le lot ne correspond pas à l'activité",
};

describe('Finance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let accountant: Headers;
  let owner: Headers;
  let director: Headers;
  let seller: Headers;
  let keeper: Headers;
  let agent: Headers;
  let customerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    accountant = await world.actor('COMPTABLE');
    owner = await world.actor('PROPRIETAIRE');
    director = await world.actor('DIRECTEUR_FERME');
    seller = await world.actor('COMMERCIAL');
    keeper = await world.actor('MAGASINIER');
    agent = await world.actor('AGENT_ELEVAGE');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'REVENDEUR',
      })
    ).id;
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

  /* ------------------------------------------------------------------ helpers */

  const entryBody = (over: Record<string, unknown> = {}) => ({
    date: daysAgo(3),
    kind: 'DEPENSE',
    label: 'Électricité CEET',
    activity: 'GENERAL',
    category: 'ENERGIE',
    amount: 185000,
    ...over,
  });
  const postEntry = (
    over: Record<string, unknown> = {},
    h = accountant,
    status = 201,
  ) =>
    http()
      .post('/api/finance/entries')
      .set(h)
      .send(entryBody(over))
      .expect(status);
  const created = async (over: Record<string, unknown> = {}, h = accountant) =>
    (await postEntry(over, h)).body as EntryRow;
  const patchEntry = (
    id: string,
    body: Record<string, unknown>,
    h = accountant,
    status = 200,
  ) =>
    http().patch(`/api/finance/entries/${id}`).set(h).send(body).expect(status);
  const entries = async (
    q: Record<string, string | number> = {},
    h = accountant,
  ) =>
    (await http().get('/api/finance/entries').query(q).set(h).expect(200))
      .body as EntriesPage;
  const summary = async (
    q: Record<string, string> = {},
    h = accountant,
    status = 200,
  ) =>
    (await http().get('/api/finance/summary').query(q).set(h).expect(status))
      .body as Summary;
  const lots = async (q: Record<string, string> = {}, h = accountant) =>
    (await http().get('/api/finance/lots').query(q).set(h).expect(200))
      .body as LotsPage;
  const lotDetail = async (id: string, h = accountant) =>
    (await http().get(`/api/finance/lots/${id}`).set(h).expect(200))
      .body as LotRow;
  const audits = (module = 'finance') =>
    prisma.auditLog.findMany({
      where: { module },
      orderBy: { createdAt: 'asc' },
    });
  const setCounter = (kind: string, last: number) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentCounter" ("organizationId","kind","last") VALUES ('${world.orgId}','${kind}',${last})
       ON CONFLICT ("organizationId","kind") DO UPDATE SET "last" = ${last}`,
    );

  /** A lot with every date well before the reference documents. */
  const lot = (over: Record<string, unknown> = {}, h = director) =>
    world.lot(h, { entryDate: '2026-09-01', initialCount: 5000, ...over });
  const pigLot = (over: Record<string, unknown> = {}) =>
    world.pigLot(director, { entryDate: '2026-09-01', ...over });
  const invoice = (
    date: string,
    lines: Record<string, unknown>[],
    over: Record<string, unknown> = {},
  ) =>
    world.post<InvoiceDetail>(accountant, '/sales/issued', {
      customerId,
      date,
      lines,
      ...over,
    });

  /** The five manual entries of the Rapports screen (October). */
  async function referenceEntries() {
    const rows: [string, string, string, string, string, number][] = [
      ['2026-10-01', 'Salaires septembre', 'GENERAL', 'SALAIRES', '', 950000],
      ['2026-10-03', 'Aliment chair 6 t', 'AVICOLE', 'ALIMENT', '', 1020000],
      ['2026-10-08', 'Électricité CEET', 'GENERAL', 'ENERGIE', '', 185000],
      ['2026-10-10', 'Vaccins & médicaments', 'AVICOLE', 'SANTE', '', 120000],
      ['2026-10-14', 'Aliment porc 2 t', 'PORCIN', 'ALIMENT', '', 560000],
    ];
    for (const [date, label, activity, category, , amount] of rows) {
      await postEntry({ date, label, activity, category, amount });
    }
  }
  /** The four reference invoices of October: 2 050 000 avicole, 1 920 000 porcin, 400 000 still due. */
  async function referenceInvoices() {
    const chair = await lot({ code: 'LC-2026-12' });
    const layer = await lot({ type: 'PONDEUSE', initialCount: 3000 });
    await world.post(director, '/egg-production', {
      batchId: layer.id,
      date: '2026-10-05',
      collected: 12000,
    });
    const fattening = await pigLot({
      code: 'LOT-ENG-07',
      initialCount: 100,
    });
    const litter = await pigLot({
      type: 'PORCELET',
      code: 'PO-2026-01',
      initialCount: 12,
    });
    // the other three are settled: only FA-0309 is still owed (400 000)
    const settle = (inv: InvoiceDetail, date: string, amount: number) =>
      world.post(accountant, `/sales/${inv.id}/payments`, {
        date,
        amount,
        method: 'VIREMENT',
      });
    await settle(
      await invoice('2026-10-08', [
        { kind: 'LOT', batchId: litter.id, quantity: 10, unitPrice: 30000 },
      ]),
      '2026-10-09',
      300000,
    );
    await settle(
      await invoice('2026-10-12', [
        { kind: 'LOT', batchId: fattening.id, quantity: 12, unitPrice: 135000 },
      ]),
      '2026-10-13',
      1620000,
    );
    const fa0309 = await invoice('2026-10-18', [
      { kind: 'OEUFS', batchId: layer.id, quantity: 400, unitPrice: 2500 },
    ]);
    await world.post(accountant, `/sales/${fa0309.id}/payments`, {
      date: '2026-10-19',
      amount: 600000,
      method: 'ESPECES',
    });
    await settle(
      await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 300, unitPrice: 3500 },
      ]),
      '2026-10-21',
      1050000,
    );
    return { chair, layer, fattening, litter, fa0309 };
  }

  /** A stock article of feed (1 000 kg at 300, 500 at 360: average 320) and its feed product. */
  async function feedFixture() {
    const item = await world.post<Id>(director, '/stock-items', {
      name: 'Maïs',
      category: 'ALIMENT',
      unit: 'kg',
    });
    for (const [qty, cost, date] of [
      [1000, 300, '2026-09-01'],
      [500, 360, '2026-09-02'],
    ] as const) {
      await world.post(director, '/stock/movements', {
        itemId: item.id,
        type: 'ENTREE',
        date,
        quantity: qty,
        unitCost: cost,
        reason: 'ACHAT',
      });
    }
    const product = await world.post<Id>(director, '/feed-products', {
      name: 'Maïs',
      kind: 'ALIMENT_COMPLET',
      unitCost: 999,
      stockItemId: item.id,
    });
    return { item, product };
  }

  /* ------------------------------------------------------------ manual entries */

  describe('manual entries', () => {
    it('lets the accountant post an entry and reads it back in the list shape', async () => {
      const row = await created({ note: 'Facture de septembre' });
      expect(row).toMatchObject({
        origin: 'MANUEL',
        sourceId: null,
        date: daysAgo(3),
        label: 'Électricité CEET',
        kind: 'DEPENSE',
        activity: 'GENERAL',
        category: 'ENERGIE',
        amount: 185000,
        batchId: null,
        batchCode: null,
        note: 'Facture de septembre',
        editable: true,
      });
      const list = await entries();
      expect(list.items).toEqual([row]);
      expect(list.totals).toEqual({
        revenue: 0,
        expenses: 185000,
        balance: -185000,
      });
    });

    it('is a daily entry: COMPTABLE posts, PROPRIETAIRE and DIRECTEUR read, COMMERCIAL and AGENT are refused', async () => {
      await postEntry({}, owner, 403);
      await postEntry({}, director, 403);
      await postEntry({}, seller, 403);
      await created();
      for (const h of [owner, director]) {
        expect((await entries({}, h)).items).toHaveLength(1);
        await summary({}, h);
      }
      for (const h of [seller, agent, keeper]) {
        await http().get('/api/finance/entries').set(h).expect(403);
        await http().get('/api/finance/summary').set(h).expect(403);
        await http().get('/api/finance/lots').set(h).expect(403);
        await http().get('/api/finance/lot-options').set(h).expect(403);
      }
    });

    it('validates the body in French', async () => {
      const bad = async (over: Record<string, unknown>, text: string) =>
        expect(msg(await postEntry(over, accountant, 400))).toContain(text);
      await bad({ amount: 0 }, 'montant');
      await bad({ amount: -5 }, 'montant');
      await bad({ amount: 10.123 }, 'montant');
      await bad(
        { date: daysAgo(-2) },
        'La date ne peut pas être dans le futur',
      );
      await bad({ date: '2026-13-40' }, 'Date invalide');
      await bad({ kind: 'AUTRE' }, 'type');
      await bad({ label: '   ' }, 'libellé');
      await bad({ activity: 'AUTRE' }, 'activité');
      await bad({ category: 'INCONNUE' }, 'catégorie');
      // a category belongs to its kind
      await bad(
        { kind: 'DEPENSE', category: 'VENTE_OEUFS' },
        'La catégorie ne correspond pas au type',
      );
      await bad(
        { kind: 'RECETTE', category: 'ENERGIE' },
        'La catégorie ne correspond pas au type',
      );
      await http()
        .post('/api/finance/entries')
        .set(accountant)
        .send({ ...entryBody(), extra: 1 })
        .expect(400);
      await http()
        .post('/api/finance/entries')
        .set(accountant)
        .send({ ...entryBody(), date: null })
        .expect(400);
    });

    it('keeps categories open: any expense or revenue category may be entered manually, even one a document also produces', async () => {
      await created({ category: 'ALIMENT', activity: 'AVICOLE' });
      await created({ category: 'ANIMAUX', activity: 'PORCIN' });
      await created({
        kind: 'RECETTE',
        category: 'VENTE_ANIMAUX',
        activity: 'PORCIN',
        label: 'Vente hors facture',
      });
      expect((await entries()).total).toBe(3);
    });

    it('attributes an expense to a lot of the same activity on the active farm, only', async () => {
      const chair = await lot();
      const pigs = await pigLot();
      const ok = await created({
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        label: 'Transport poussins',
        batchId: chair.id,
      });
      expect(ok).toMatchObject({ batchId: chair.id, batchCode: chair.code });
      const refuse = async (over: Record<string, unknown>, text: string) =>
        expect(msg(await postEntry(over, accountant, 400))).toBe(text);
      await refuse(
        { activity: 'PORCIN', batchId: chair.id },
        MESSAGES.lotActivity,
      );
      await refuse(
        { activity: 'AVICOLE', batchId: pigs.id },
        MESSAGES.lotActivity,
      );
      await refuse(
        { activity: 'GENERAL', batchId: chair.id },
        MESSAGES.lotActivity,
      );
      await refuse(
        {
          kind: 'RECETTE',
          category: 'AUTRE_RECETTE',
          activity: 'AVICOLE',
          batchId: chair.id,
        },
        'Seule une dépense peut être rattachée à un lot',
      );
      await refuse(
        { activity: 'AVICOLE', batchId: 'inconnu' },
        MESSAGES.badLot,
      );
      // a lot of another farm is a body error, not a 404
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const siteB = await prisma.site.create({
        data: { farmId: farmB, name: 'Site B' },
      });
      const bldB = await prisma.building.create({
        data: {
          farmId: farmB,
          siteId: siteB.id,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 1000,
        },
      });
      const foreign = await prisma.animalBatch.create({
        data: {
          farmId: farmB,
          code: 'LC-B-01',
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: bldB.id,
          entryDate: new Date('2026-09-01'),
          initialCount: 10,
        },
      });
      await refuse(
        { activity: 'AVICOLE', batchId: foreign.id },
        MESSAGES.badLot,
      );
    });

    it('edits an entry, clears its lot with null, and writes no audit row for a no-op patch', async () => {
      const chair = await lot();
      const row = await created({
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        batchId: chair.id,
      });
      const afterCreate = (await audits()).length;
      expect(afterCreate).toBe(1);
      const edited = (
        await patchEntry(row.id, { amount: 200000, note: 'Corrigé' })
      ).body as EntryRow;
      expect(edited).toMatchObject({
        amount: 200000,
        note: 'Corrigé',
        batchId: chair.id,
      });
      expect(await audits()).toHaveLength(2);
      // the same values again: nothing written, nothing audited
      await patchEntry(row.id, { amount: 200000, note: 'Corrigé' });
      await patchEntry(row.id, {});
      expect(await audits()).toHaveLength(2);
      const cleared = (await patchEntry(row.id, { batchId: null }))
        .body as EntryRow;
      expect(cleared.batchId).toBeNull();
      expect(cleared.batchCode).toBeNull();
      expect(await audits()).toHaveLength(3);
      const rows = await audits();
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
      expect(rows.every((r) => r.recordId === row.id)).toBe(true);
    });

    it('refuses an edit that would leave a lot on a revenue or a general expense, with a 400 (never a 500)', async () => {
      const chair = await lot();
      const row = await created({
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        batchId: chair.id,
      });
      expect(
        msg(
          await patchEntry(
            row.id,
            { kind: 'RECETTE', category: 'AUTRE_RECETTE' },
            accountant,
            400,
          ),
        ),
      ).toBe('Seule une dépense peut être rattachée à un lot');
      expect(
        msg(await patchEntry(row.id, { activity: 'GENERAL' }, accountant, 400)),
      ).toBe(MESSAGES.lotActivity);
      expect(
        msg(await patchEntry(row.id, { activity: 'PORCIN' }, accountant, 400)),
      ).toBe(MESSAGES.lotActivity);
      expect(
        msg(
          await patchEntry(
            row.id,
            { category: 'VENTE_OEUFS' },
            accountant,
            400,
          ),
        ),
      ).toBe('La catégorie ne correspond pas au type');
      // switching everything at once is fine
      const ok = (
        await patchEntry(row.id, {
          kind: 'RECETTE',
          category: 'AUTRE_RECETTE',
          batchId: null,
        })
      ).body as EntryRow;
      expect(ok).toMatchObject({ kind: 'RECETTE', batchId: null });
      for (const body of [
        { amount: null },
        { date: null },
        { label: null },
        { kind: null },
        { activity: null },
        { category: null },
      ]) {
        await patchEntry(row.id, body, accountant, 400);
      }
      await patchEntry(row.id, { date: daysAgo(-3) }, accountant, 400);
    });

    it('deletes an entry with one audit row, and refuses roles without create', async () => {
      const row = await created();
      await http()
        .delete(`/api/finance/entries/${row.id}`)
        .set(owner)
        .expect(403);
      await http()
        .delete(`/api/finance/entries/${row.id}`)
        .set(accountant)
        .expect(200);
      expect((await entries()).total).toBe(0);
      const rows = await audits();
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'DELETE']);
      await http()
        .delete(`/api/finance/entries/${row.id}`)
        .set(accountant)
        .expect(404);
      await patchEntry(row.id, { amount: 1 }, accountant, 404);
      await patchEntry(row.id, { amount: 1 }, owner, 403);
    });

    it('keeps farms apart: another farm entry is a 404 and is not listed', async () => {
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
      const mine = await created();
      const theirs = await created({ label: 'Gasoil B' }, onB);
      expect((await entries({}, accountant)).items.map((r) => r.id)).toEqual([
        mine.id,
      ]);
      expect((await entries({}, onB)).items.map((r) => r.id)).toEqual([
        theirs.id,
      ]);
      await patchEntry(theirs.id, { amount: 5 }, accountant, 404);
      await http()
        .delete(`/api/finance/entries/${theirs.id}`)
        .set(accountant)
        .expect(404);
      // a user of farm B only cannot read farm A
      await http()
        .get('/api/finance/entries')
        .set({ ...onB, 'X-Farm-Id': world.farmId })
        .expect(403);
    });

    it('enforces its invariants in the database too', async () => {
      const chair = await lot();
      const user = await prisma.user.findFirstOrThrow();
      const insert = (over: Record<string, string | number | null>) => {
        const v = {
          kind: 'DEPENSE',
          activity: 'GENERAL',
          category: 'ENERGIE',
          amount: 10,
          batchId: null,
          label: 'x',
          ...over,
        };
        const batch = v.batchId ? `'${String(v.batchId)}'` : 'NULL';
        return prisma.$executeRawUnsafe(
          `INSERT INTO "FinanceEntry" ("id","farmId","date","kind","label","activity","category","amount","batchId","createdById","updatedAt")
           VALUES ('e' || floor(random()*1e9)::text, '${world.farmId}', '2026-10-01', '${v.kind}', '${v.label}', '${v.activity}', '${v.category}', ${v.amount}, ${batch}, '${user.id}', now())`,
        );
      };
      await insert({});
      await expect(insert({ amount: 0 })).rejects.toThrow();
      await expect(insert({ amount: -1 })).rejects.toThrow();
      await expect(insert({ category: 'VENTE_OEUFS' })).rejects.toThrow();
      await expect(
        insert({ kind: 'RECETTE', category: 'ENERGIE' }),
      ).rejects.toThrow();
      await expect(
        insert({ batchId: chair.id, activity: 'GENERAL' }),
      ).rejects.toThrow();
      await expect(
        insert({
          kind: 'RECETTE',
          category: 'AUTRE_RECETTE',
          activity: 'AVICOLE',
          batchId: chair.id,
        }),
      ).rejects.toThrow();
      await insert({ activity: 'AVICOLE', batchId: chair.id });
      await expect(insert({ label: '  ' })).rejects.toThrow();
    });
  });

  /* ------------------------------------------------------------- the summary */

  describe('summary', () => {
    it('reproduces the Rapports reference: 3 970 000 / 2 835 000 / 1 135 000, 29 %, 400 000 due', async () => {
      await referenceEntries();
      await referenceInvoices();
      const s = await summary(OCTOBER);
      expect(s).toMatchObject({
        from: '2026-10-01',
        to: '2026-10-31',
        revenue: 3970000,
        expenses: 2835000,
        margin: 1135000,
        marginPct: 29,
        receivables: 400000,
      });
      expect(s.byActivity).toEqual([
        {
          activity: 'AVICOLE',
          revenue: 2050000,
          expenses: 1140000,
          margin: 910000,
        },
        {
          activity: 'PORCIN',
          revenue: 1920000,
          expenses: 560000,
          margin: 1360000,
        },
        {
          activity: 'GENERAL',
          revenue: 0,
          expenses: 1135000,
          margin: -1135000,
        },
      ]);
      expect(s.byCategory).toEqual([
        {
          kind: 'DEPENSE',
          category: 'ALIMENT',
          label: 'Aliment',
          amount: 1580000,
        },
        { kind: 'DEPENSE', category: 'SANTE', label: 'Santé', amount: 120000 },
        {
          kind: 'DEPENSE',
          category: 'SALAIRES',
          label: 'Salaires',
          amount: 950000,
        },
        {
          kind: 'DEPENSE',
          category: 'ENERGIE',
          label: 'Énergie',
          amount: 185000,
        },
        {
          kind: 'RECETTE',
          category: 'VENTE_ANIMAUX',
          label: "Ventes d'animaux",
          amount: 2970000,
        },
        {
          kind: 'RECETTE',
          category: 'VENTE_OEUFS',
          label: "Ventes d'œufs",
          amount: 1000000,
        },
      ]);
      expect(s.byFarm).toBeUndefined();
    });

    it('has the same figures as the sum of the entries list of the period', async () => {
      await referenceEntries();
      await referenceInvoices();
      const list = await entries({ ...OCTOBER, pageSize: 100 });
      expect(list.totals).toEqual({
        revenue: 3970000,
        expenses: 2835000,
        balance: 1135000,
      });
      expect(list.total).toBe(5 + 4);
    });

    it('covers ALL time without dates (open bounds), and takes inclusive bounds', async () => {
      const s = await summary();
      expect(s.from).toBeNull();
      expect(s.to).toBeNull();
      await created({ date: '2026-10-01', amount: 100 });
      await created({ date: '2026-10-31', amount: 10 });
      await created({ date: '2026-11-01', amount: 1000 });
      await created({ date: '2026-09-30', amount: 10000 });
      expect(
        (await summary({ from: '2026-10-01', to: '2026-10-31' })).expenses,
      ).toBe(110);
      expect(
        (await summary({ from: '2026-10-31', to: '2026-10-31' })).expenses,
      ).toBe(10);
      expect((await summary({ from: '2026-10-31' })).expenses).toBe(1010);
      expect((await summary({ to: '2026-10-01' })).expenses).toBe(10100);
    });

    it('refuses an inverted or invalid period', async () => {
      const r = await http()
        .get('/api/finance/summary')
        .query({ from: '2026-10-31', to: '2026-10-01' })
        .set(accountant)
        .expect(400);
      expect(msg(r)).toBe('La date de début est après la date de fin');
      await summary({ from: 'hier' }, accountant, 400);
      await http()
        .get('/api/finance/entries')
        .query({ from: '2026-10-31', to: '2026-10-01' })
        .set(accountant)
        .expect(400);
    });

    it('counts an expense the day the purchase is received, in the category snapshotted then, under its activity', async () => {
      await referenceEntries();
      await referenceInvoices();
      await setCounter('BC', 141);
      const supplier = await world.post<Id>(director, '/suppliers', {
        name: 'Agro Provende SA',
      });
      const item = await world.post<Id>(director, '/stock-items', {
        name: 'Aliment ponte',
        category: 'ALIMENT',
        unit: 'kg',
      });
      const request = await world.post<Id>(director, '/purchases', {
        supplierId: supplier.id,
        date: '2026-10-22',
        activity: 'AVICOLE',
        lines: [{ itemId: item.id, quantity: 3000, unitPrice: 310 }],
      });
      await world.post(director, `/purchases/${request.id}/validate`);
      const ordered = await world.post<{ reference: string }>(
        director,
        `/purchases/${request.id}/order`,
      );
      expect(ordered.reference).toBe('BC-0142');
      // ordered, not received: no expense yet
      expect((await summary(OCTOBER)).expenses).toBe(2835000);
      await world.post(keeper, `/purchases/${request.id}/receive`, {
        date: '2026-10-25',
        lines: [{ itemId: item.id, receivedQuantity: 3000 }],
      });
      // the article is re-categorised afterwards: the row keeps the snapshot
      await prisma.stockItem.update({
        where: { id: item.id },
        data: { category: 'MATERIEL' },
      });
      const s = await summary(OCTOBER);
      expect(s.expenses).toBe(2835000 + 930000);
      expect(s.byActivity[0]).toMatchObject({
        activity: 'AVICOLE',
        expenses: 1140000 + 930000,
      });
      const rows = (await entries({ ...OCTOBER, origin: 'ACHAT' })).items;
      expect(rows).toEqual([
        {
          id: `achat:${request.id}:ALIMENT`,
          origin: 'ACHAT',
          sourceId: request.id,
          date: '2026-10-25',
          label: 'Achat BC-0142 — Agro Provende SA',
          kind: 'DEPENSE',
          activity: 'AVICOLE',
          category: 'ALIMENT',
          amount: 930000,
          batchId: null,
          batchCode: null,
          note: null,
          editable: false,
        },
      ]);
      // paying the supplier changes nothing here
      await world.post(director, `/purchases/${request.id}/payments`, {
        date: '2026-10-26',
        amount: 930000,
        method: 'VIREMENT',
      });
      expect((await summary(OCTOBER)).expenses).toBe(2835000 + 930000);
    });

    it('shows a credit note as a negative revenue at its own date, and a payment as nothing', async () => {
      const chair = await lot();
      const inv = await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 300, unitPrice: 3500 },
      ]);
      await world.post(accountant, `/sales/${inv.id}/payments`, {
        date: '2026-10-21',
        amount: 500000,
        method: 'ESPECES',
      });
      expect((await summary(OCTOBER)).revenue).toBe(1050000);
      await world.post(accountant, `/sales/${inv.id}/credit-notes`, {
        date: '2026-10-28',
        reason: 'Marchandise non conforme',
        withReturn: false,
        lines: [{ lineId: inv.lines[0].id, quantity: 30 }],
      });
      expect((await summary(OCTOBER)).revenue).toBe(945000);
      // invoiced in October, credited in November: the credit belongs to November
      expect(
        (await summary({ from: '2026-10-01', to: '2026-10-27' })).revenue,
      ).toBe(1050000);
      const credit = (await entries({ ...OCTOBER, origin: 'AVOIR' })).items;
      expect(credit).toHaveLength(1);
      expect(credit[0]).toMatchObject({
        origin: 'AVOIR',
        sourceId: null,
        date: '2026-10-28',
        label: `Avoir AV-0001 — Restaurant Le Palmier (${inv.number})`,
        kind: 'RECETTE',
        activity: 'AVICOLE',
        category: 'VENTE_ANIMAUX',
        amount: -105000,
        editable: false,
      });
      const fa = (await entries({ ...OCTOBER, origin: 'FACTURE' })).items;
      expect(fa).toEqual([
        {
          id: `facture:${inv.id}:AVICOLE:VENTE_ANIMAUX`,
          origin: 'FACTURE',
          sourceId: inv.id,
          date: '2026-10-20',
          label: `Facture ${inv.number} — Restaurant Le Palmier`,
          kind: 'RECETTE',
          activity: 'AVICOLE',
          category: 'VENTE_ANIMAUX',
          amount: 1050000,
          batchId: null,
          batchCode: null,
          note: null,
          editable: false,
        },
      ]);
    });

    it('counts as receivables what is still due only, never netting what a credit note leaves to refund', async () => {
      const chair = await lot();
      const paid = await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 100, unitPrice: 1000 },
      ]);
      await world.post(accountant, `/sales/${paid.id}/payments`, {
        date: '2026-10-21',
        amount: 100000,
        method: 'ESPECES',
      });
      // credited after full payment: nothing due, 10 000 to refund
      await world.post(accountant, `/sales/${paid.id}/credit-notes`, {
        date: '2026-10-25',
        reason: 'Retour',
        withReturn: false,
        lines: [{ lineId: paid.lines[0].id, quantity: 10 }],
      });
      const owed = await invoice('2026-10-22', [
        { kind: 'LOT', batchId: chair.id, quantity: 50, unitPrice: 1000 },
      ]);
      await world.post(accountant, `/sales/${owed.id}/payments`, {
        date: '2026-10-23',
        amount: 20000,
        method: 'ESPECES',
      });
      expect((await summary(OCTOBER)).receivables).toBe(30000);
      // the figure does not depend on the period
      expect(
        (await summary({ from: '2026-01-01', to: '2026-01-31' })).receivables,
      ).toBe(30000);
    });

    it('drops a cancelled invoice and a draft, and keeps the purchase price of a lot as an expense at its entry date', async () => {
      const chair = await lot({ purchasePrice: 1500000, code: 'LC-2026-14' });
      const draft = await world.post<InvoiceDetail>(seller, '/sales', {
        customerId,
        date: '2026-10-20',
        lines: [
          { kind: 'LOT', batchId: chair.id, quantity: 10, unitPrice: 3500 },
        ],
      });
      expect((await summary(OCTOBER)).revenue).toBe(0);
      const inv = await invoice('2026-10-21', [
        { kind: 'LOT', batchId: chair.id, quantity: 10, unitPrice: 3500 },
      ]);
      expect((await summary(OCTOBER)).revenue).toBe(35000);
      await world.post(accountant, `/sales/${inv.id}/cancel`, {
        reason: 'Erreur',
      });
      expect((await summary(OCTOBER)).revenue).toBe(0);
      expect(draft.id).not.toBe(inv.id);
      const september = await summary({ from: '2026-09-01', to: '2026-09-30' });
      expect(september.expenses).toBe(1500000);
      expect(september.byActivity[0]).toMatchObject({
        activity: 'AVICOLE',
        expenses: 1500000,
      });
      const rows = (await entries({ origin: 'LOT' })).items;
      expect(rows).toEqual([
        {
          id: `lot:${chair.id}`,
          origin: 'LOT',
          sourceId: chair.id,
          date: '2026-09-01',
          label: 'Achat du lot LC-2026-14',
          kind: 'DEPENSE',
          activity: 'AVICOLE',
          category: 'ANIMAUX',
          amount: 1500000,
          batchId: chair.id,
          batchCode: 'LC-2026-14',
          note: null,
          editable: false,
        },
      ]);
    });

    it('under all farms reads every visible farm with a byFarm table, and refuses writes', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'PROPRIETAIRE',
        farmIds: [world.farmId, farmB],
      });
      const bearer = `Bearer ${await tokenFor(user.id)}`;
      const onAll = { Authorization: bearer, 'X-Farm-Id': 'all' };
      const accountantB = await createUser({
        organizationId: world.orgId,
        role: 'COMPTABLE',
        farmIds: [farmB],
      });
      await created({ date: '2026-10-05', amount: 1000 });
      await created(
        { date: '2026-10-06', amount: 250, label: 'Gasoil B' },
        {
          Authorization: `Bearer ${await tokenFor(accountantB.id)}`,
          'X-Farm-Id': farmB,
        },
      );
      const s = await summary(OCTOBER, onAll);
      expect(s.expenses).toBe(1250);
      expect(s.byFarm).toEqual([
        {
          farmId: world.farmId,
          farmName: 'Ferme A',
          revenue: 0,
          expenses: 1000,
          margin: -1000,
        },
        {
          farmId: farmB,
          farmName: 'Ferme B',
          revenue: 0,
          expenses: 250,
          margin: -250,
        },
      ]);
      expect((await summary(OCTOBER, owner)).expenses).toBe(1000);
      expect((await entries(OCTOBER, onAll)).total).toBe(2);
      await postEntry({}, onAll, 403);
      await patchEntry('x', { amount: 1 }, onAll, 403);
    });
  });

  /* ------------------------------------------------------------ the entries list */

  describe('entries list', () => {
    it('is read-only for derived rows: patching or deleting one is a 409 with the exact message', async () => {
      const chair = await lot({ purchasePrice: 1500000 });
      const inv = await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 10, unitPrice: 3500 },
      ]);
      const derived = (await entries({ pageSize: 100 })).items.filter(
        (r) => r.origin !== 'MANUEL',
      );
      expect(derived.map((r) => r.origin).sort()).toEqual(['FACTURE', 'LOT']);
      for (const row of derived) {
        expect(
          msg(await patchEntry(row.id, { amount: 1 }, accountant, 409)),
        ).toBe(MESSAGES.derived);
        const del = await http()
          .delete(`/api/finance/entries/${row.id}`)
          .set(accountant)
          .expect(409);
        expect(msg(del)).toBe(MESSAGES.derived);
      }
      // nothing changed
      expect((await entries()).total).toBe(2);
      expect(inv.id).toBeTruthy();
    });

    it('filters on kind, activity, category, origin, period and text, sorts, and pages', async () => {
      await referenceEntries();
      await referenceInvoices();
      const base = { ...OCTOBER, pageSize: 100 };
      expect((await entries({ ...base, kind: 'RECETTE' })).total).toBe(4);
      expect((await entries({ ...base, kind: 'DEPENSE' })).total).toBe(5);
      expect((await entries({ ...base, activity: 'PORCIN' })).total).toBe(3);
      expect((await entries({ ...base, category: 'ALIMENT' })).total).toBe(2);
      expect((await entries({ ...base, origin: 'MANUEL' })).total).toBe(5);
      expect((await entries({ ...base, origin: 'FACTURE' })).total).toBe(4);
      expect((await entries({ ...base, search: 'ceet' })).items).toHaveLength(
        1,
      );
      expect((await entries({ ...base, search: '%' })).total).toBe(0);
      expect(
        (
          await entries({ from: '2026-10-10', to: '2026-10-14', pageSize: 100 })
        ).items.map((r) => r.label),
      ).toEqual(
        expect.arrayContaining(['Vaccins & médicaments', 'Aliment porc 2 t']),
      );
      // default order: most recent first
      const dates = (await entries(base)).items.map((r) => r.date);
      expect([...dates].sort().reverse()).toEqual(dates);
      const byAmount = (await entries({ ...base, sort: 'amount:desc' })).items;
      expect(byAmount[0].amount).toBe(1620000);
      expect(byAmount.map((r) => r.amount)).toEqual(
        [...byAmount.map((r) => r.amount)].sort((a, b) => b - a),
      );
      const asc = (await entries({ ...base, sort: 'date:asc' })).items;
      expect(asc[0].date).toBe('2026-10-01');
      const page2 = await entries({
        ...OCTOBER,
        pageSize: 4,
        page: 2,
        sort: 'date:asc',
      });
      expect(page2.items.map((r) => r.date)).toEqual(
        asc.slice(4, 8).map((r) => r.date),
      );
      expect(page2.total).toBe(9);
      // totals cover the filter, not the page
      expect(page2.totals.expenses).toBe(2835000);
      await http()
        .get('/api/finance/entries')
        .query({ sort: 'label:asc' })
        .set(accountant)
        .expect(400);
      for (const q of [
        { kind: 'AUTRE' },
        { activity: 'AUTRE' },
        { category: 'AUTRE' },
        { origin: 'AUTRE' },
      ]) {
        await http()
          .get('/api/finance/entries')
          .query(q)
          .set(accountant)
          .expect(400);
      }
    });

    it('exports CSV and XLSX gated by finance read', async () => {
      await created({ date: '2026-10-08', amount: 185000 });
      await created({
        date: '2026-10-09',
        kind: 'RECETTE',
        category: 'AUTRE_RECETTE',
        activity: 'AVICOLE',
        label: 'Vente de fumier',
        amount: 5000,
      });
      const csv = await http()
        .get('/api/finance/entries')
        .query({ format: 'csv', sort: 'date:asc' })
        .set(owner)
        .buffer(true)
        .expect(200);
      expect(csv.header['content-type']).toContain('text/csv');
      const lines = (csv.text || String(csv.body)).split('\r\n');
      expect(lines[0]).toBe('﻿Date;Libellé;Type;Activité;Catégorie;Montant');
      expect(lines[1]).toBe(
        '2026-10-08;Électricité CEET;Dépense;Général;Énergie;185000',
      );
      expect(lines[2]).toBe(
        '2026-10-09;Vente de fumier;Recette;Avicole;Autres recettes;5000',
      );
      await http()
        .get('/api/finance/entries')
        .query({ format: 'xlsx' })
        .set(accountant)
        .expect(200)
        .expect('content-type', /spreadsheetml/);
      await http()
        .get('/api/finance/entries')
        .query({ format: 'csv' })
        .set(seller)
        .expect(403);
    });
  });

  /* ------------------------------------------------ lots: no double counting */

  describe('no double counting', () => {
    it('a feed distribution leaves the farm summary alone and adds to the lot aliment; a purchase does the reverse', async () => {
      await referenceEntries();
      const chair = await lot({ code: 'LC-2026-14' });
      const { item, product } = await feedFixture();
      const before = await summary(OCTOBER);
      expect((await lotDetail(chair.id)).costs.aliment).toBe(0);

      await world.post(director, '/feed-distributions', {
        batchId: chair.id,
        date: '2026-10-10',
        quantityKg: 620,
        feedProductId: product.id,
      });
      expect(await summary(OCTOBER)).toEqual(before);
      expect((await lotDetail(chair.id)).costs.aliment).toBe(198400);

      // a purchase received afterwards adds to the expenses and not to the lot
      const supplier = await world.post<Id>(director, '/suppliers', {
        name: 'Agro Provende SA',
      });
      const request = await world.post<Id>(director, '/purchases', {
        supplierId: supplier.id,
        date: '2026-10-22',
        activity: 'AVICOLE',
        lines: [{ itemId: item.id, quantity: 3000, unitPrice: 310 }],
      });
      await world.post(director, `/purchases/${request.id}/validate`);
      await world.post(director, `/purchases/${request.id}/order`);
      await world.post(keeper, `/purchases/${request.id}/receive`, {
        date: '2026-10-25',
        lines: [{ itemId: item.id, receivedQuantity: 3000 }],
      });
      const after = await summary(OCTOBER);
      expect(after.expenses).toBe(before.expenses + 930000);
      expect((await lotDetail(chair.id)).costs.aliment).toBe(198400);
      expect((await lotDetail(chair.id)).totalCost).toBe(198400);
    });

    it('LC-2026-14: 1 500 000 + feed 198 400 + health 24 000 + transport 50 000 against 300 sold at 3 500 less 30 credited with return', async () => {
      const chair = await lot({
        code: 'LC-2026-14',
        initialCount: 4820,
        purchasePrice: 1500000,
      });
      const { product } = await feedFixture();
      await world.post(director, '/feed-distributions', {
        batchId: chair.id,
        date: '2026-10-10',
        quantityKg: 620,
        feedProductId: product.id,
      });
      const vaccine = await world.post<Id>(director, '/stock-items', {
        name: 'Vaccin Gumboro',
        category: 'VACCIN',
        unit: 'flacon',
      });
      await world.post(director, '/stock/movements', {
        itemId: vaccine.id,
        type: 'ENTREE',
        date: '2026-09-01',
        quantity: 12,
        unitCost: 12000,
        reason: 'ACHAT',
      });
      await world.post(director, '/health-acts', {
        type: 'VACCINATION',
        status: 'REALISE',
        batchId: chair.id,
        date: '2026-10-12',
        stockItemId: vaccine.id,
        quantity: 2,
      });
      await postEntry({
        date: '2026-10-14',
        label: 'Transport poussins',
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        amount: 50000,
        batchId: chair.id,
      });
      const inv = await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 300, unitPrice: 3500 },
      ]);
      await world.post(accountant, `/sales/${inv.id}/credit-notes`, {
        date: '2026-10-25',
        reason: 'Retour de 30 sujets',
        withReturn: true,
        lines: [{ lineId: inv.lines[0].id, quantity: 30 }],
      });

      const row = await lotDetail(chair.id);
      expect(row).toMatchObject({
        id: chair.id,
        batchId: chair.id,
        code: 'LC-2026-14',
        species: 'AVICOLE',
        type: 'CHAIR',
        status: 'EN_COURS',
        animals: 4820,
        sold: 270,
        alive: 4550,
        costs: {
          animaux: 1500000,
          aliment: 198400,
          sante: 24000,
          autres: 50000,
        },
        totalCost: 1772400,
        revenue: 945000,
        margin: -827400,
        costPerAnimal: 367.72,
        costPerKg: null,
      });
      expect(row.lines).toEqual([
        { category: 'ANIMAUX', label: 'Animaux', amount: 1500000 },
        { category: 'ALIMENT', label: 'Aliment', amount: 198400 },
        { category: 'SANTE', label: 'Santé', amount: 24000 },
        { category: 'TRANSPORT', label: 'Transport', amount: 50000 },
      ]);
      const listed = (await lots()).items.find((l) => l.id === chair.id);
      expect(listed).toEqual({ ...row, lines: undefined });
      // the farm view did not take the feed nor the health consumption
      const s = await summary({ from: '2026-10-01', to: '2026-10-31' });
      expect(s.expenses).toBe(50000);
      expect(s.revenue).toBe(945000);
    });

    it('limits the lot figures to the period: costs and revenues by their own dates', async () => {
      const chair = await lot({
        code: 'LC-2026-14',
        initialCount: 1000,
        purchasePrice: 100000,
      });
      await postEntry({
        date: '2026-10-14',
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        amount: 5000,
        batchId: chair.id,
      });
      await postEntry({
        date: '2026-11-02',
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        amount: 700,
        batchId: chair.id,
      });
      await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 100, unitPrice: 1000 },
      ]);
      const all = await lotDetail(chair.id);
      expect(all).toMatchObject({
        totalCost: 105700,
        revenue: 100000,
        sold: 100,
      });
      const october = (await lots(OCTOBER)).items[0];
      expect(october).toMatchObject({
        costs: { animaux: 0, autres: 5000 },
        totalCost: 5000,
        revenue: 100000,
        sold: 100,
      });
      const september = (await lots({ from: '2026-09-01', to: '2026-09-30' }))
        .items[0];
      expect(september).toMatchObject({
        costs: { animaux: 100000, autres: 0 },
        revenue: 0,
        sold: 0,
      });
    });

    it('computes cost per kg over the net invoiced weight, the credited share removed pro rata', async () => {
      const chair = await lot({ initialCount: 1000, purchasePrice: 1000000 });
      const inv = await invoice('2026-10-20', [
        {
          kind: 'LOT',
          batchId: chair.id,
          quantity: 100,
          unitPrice: 5000,
          weightKg: 690,
        },
      ]);
      expect((await lotDetail(chair.id)).costPerKg).toBe(1449.28);
      await world.post(accountant, `/sales/${inv.id}/credit-notes`, {
        date: '2026-10-25',
        reason: 'Retour',
        withReturn: true,
        lines: [{ lineId: inv.lines[0].id, quantity: 25 }],
      });
      // 25 % taken back WITH the goods: 517.5 kg remain; 1 000 000 / 517.5 = 1 932.37
      const row = await lotDetail(chair.id);
      expect(row.costPerKg).toBe(1932.37);
      expect(row.sold).toBe(75);
    });

    it('adds the egg lines of a laying lot to its revenue, and sells no animals for them', async () => {
      const layer = await lot({ type: 'PONDEUSE', initialCount: 3000 });
      await world.post(director, '/egg-production', {
        batchId: layer.id,
        date: '2026-10-05',
        collected: 12000,
      });
      await invoice('2026-10-18', [
        { kind: 'OEUFS', batchId: layer.id, quantity: 400, unitPrice: 2500 },
      ]);
      expect(await lotDetail(layer.id)).toMatchObject({
        revenue: 1000000,
        sold: 0,
        animals: 3000,
        totalCost: 0,
        margin: 1000000,
        costPerAnimal: 0,
        costPerKg: null,
      });
    });

    it('has no cost per animal for a lot with no animals counted', async () => {
      const chair = await lot({ initialCount: 10, purchasePrice: 100 });
      await world.post(director, `/batches/${chair.id}/events`, {
        type: 'MORTALITE',
        date: '2026-09-02',
        quantity: 10,
      });
      expect(await lotDetail(chair.id)).toMatchObject({
        animals: 0,
        alive: 0,
        costPerAnimal: null,
      });
    });

    it('registers the manual costs of a lot as a LotCostSource, by finance category', async () => {
      const chair = await lot();
      await postEntry({
        date: '2026-10-14',
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        amount: 50000,
        batchId: chair.id,
      });
      await postEntry({
        date: '2026-10-15',
        activity: 'AVICOLE',
        category: 'ALIMENT',
        amount: 20000,
        batchId: chair.id,
      });
      await postEntry({
        date: '2026-10-16',
        activity: 'AVICOLE',
        category: 'AUTRE_CHARGE',
        amount: 1000,
      });
      const costs = (await app.get(LotCostRegistry).costsFor([chair.id])).get(
        chair.id,
      );
      expect(
        Object.fromEntries(
          (costs ?? []).map((c) => [c.category, c.amount.toString()]),
        ),
      ).toEqual({ TRANSPORT: '50000', ALIMENT: '20000' });
      const row = await lotDetail(chair.id);
      // a manual entry always counts under autres, whatever its category
      expect(row.costs).toEqual({
        animaux: 0,
        aliment: 0,
        sante: 0,
        autres: 70000,
      });
    });
  });

  /* ------------------------------------------------------ lots: list and options */

  describe('lot profitability', () => {
    it('lists the lots of the farm with filters, needs finance read only, and keeps farms apart', async () => {
      const chair = await lot({ code: 'LC-2026-14' });
      const pigs = await pigLot({ code: 'LOT-ENG-07' });
      const closed = await lot({ code: 'LC-2026-01', initialCount: 10 });
      await prisma.animalBatch.update({
        where: { id: closed.id },
        data: { status: 'CLOTURE', closedAt: new Date() },
      });
      // COMPTABLE reads neither lots nor porcs
      await http()
        .get('/api/batches')
        .query({ species: 'AVICOLE' })
        .set(accountant)
        .expect(403);
      const all = await lots({ pageSize: '100' });
      expect(all.items.map((l) => l.code).sort()).toEqual([
        'LC-2026-01',
        'LC-2026-14',
        'LOT-ENG-07',
      ]);
      expect(
        (await lots({ species: 'PORCIN' })).items.map((l) => l.id),
      ).toEqual([pigs.id]);
      expect(
        (await lots({ status: 'CLOTURE' })).items.map((l) => l.id),
      ).toEqual([closed.id]);
      expect(
        (await lots({ status: 'EN_COURS', species: 'AVICOLE' })).items,
      ).toHaveLength(1);
      expect(chair.id).toBeTruthy();
      await http()
        .get('/api/finance/lots')
        .query({ species: 'X' })
        .set(accountant)
        .expect(400);
      await http()
        .get('/api/finance/lots')
        .query({ status: 'X' })
        .set(accountant)
        .expect(400);
      await http().get('/api/finance/lots/inconnu').set(accountant).expect(404);
      for (const h of [owner, director]) {
        expect((await lots({}, h)).total).toBe(3);
      }
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const other = await createUser({
        organizationId: world.orgId,
        role: 'COMPTABLE',
        farmIds: [farmB],
      });
      const onB = {
        Authorization: `Bearer ${await tokenFor(other.id)}`,
        'X-Farm-Id': farmB,
      };
      expect((await lots({}, onB)).total).toBe(0);
      await http().get(`/api/finance/lots/${chair.id}`).set(onB).expect(404);
    });

    it('exports the lots with the contract header', async () => {
      await lot({ code: 'LC-2026-14', initialCount: 100, purchasePrice: 1000 });
      const csv = await http()
        .get('/api/finance/lots')
        .query({ format: 'csv' })
        .set(accountant)
        .buffer(true)
        .expect(200);
      const lines = (csv.text || String(csv.body)).split('\r\n');
      expect(lines[0]).toBe(
        '﻿Lot;Type;Statut;Vendus;Coût total;Recettes;Marge;Coût par animal;Coût/kg',
      );
      expect(lines[1]).toBe('LC-2026-14;Chair;En cours;0;1000;0;-1000;10;');
    });

    it('offers the open lots of an activity to a role that only reads finance', async () => {
      const chair = await lot({ code: 'LC-2026-14' });
      await pigLot({ code: 'LOT-ENG-07' });
      const closed = await lot({ code: 'LC-2026-01', initialCount: 10 });
      await prisma.animalBatch.update({
        where: { id: closed.id },
        data: { status: 'CLOTURE', closedAt: new Date() },
      });
      const options = async (activity: string, h = accountant, status = 200) =>
        (
          await http()
            .get('/api/finance/lot-options')
            .query({ activity })
            .set(h)
            .expect(status)
        ).body as { items: { id: string; label: string }[] };
      expect((await options('AVICOLE')).items).toEqual([
        { id: chair.id, label: 'LC-2026-14' },
      ]);
      expect(
        (await options('PORCIN', owner)).items.map((o) => o.label),
      ).toEqual(['LOT-ENG-07']);
      await options('GENERAL', accountant, 400);
      await options('AUTRE', accountant, 400);
      await http().get('/api/finance/lot-options').set(accountant).expect(400);
      await options('AVICOLE', seller, 403);
    });
  });

  /* --------------------------------------------------------- fixed query counts */

  describe('query counts', () => {
    it('serves the summary in the same number of queries for 1 or many documents', async () => {
      await created({ date: '2026-10-05' });
      const first = await lot({ purchasePrice: 1000 });
      await invoice('2026-10-20', [
        { kind: 'LOT', batchId: first.id, quantity: 10, unitPrice: 1000 },
      ]);
      const queries = () =>
        countQueries(app, () => summary(OCTOBER).then(() => undefined));
      const one = await queries();
      for (let i = 0; i < 4; i++) {
        const chair = await lot({ purchasePrice: 1000 * (i + 1) });
        const inv = await invoice('2026-10-20', [
          { kind: 'LOT', batchId: chair.id, quantity: 10, unitPrice: 1000 },
        ]);
        await world.post(accountant, `/sales/${inv.id}/credit-notes`, {
          date: '2026-10-25',
          reason: 'x',
          withReturn: false,
          lines: [{ lineId: inv.lines[0].id, quantity: 1 }],
        });
        await created({ date: '2026-10-06', amount: 10 + i });
      }
      expect(await queries()).toBe(one);
      // one grouped read of the view + the 3 reads of the receivables + the request's own 2 (user, farm scope)
      expect(one).toBe(6);
    });

    it('serves the entries list and the lots profitability in a fixed number of queries', async () => {
      const chair = await lot({ purchasePrice: 1000 });
      await postEntry({
        activity: 'AVICOLE',
        category: 'TRANSPORT',
        batchId: chair.id,
      });
      // every source has something to read from the first measure on, so the count is the most it can be
      const { product } = await feedFixture();
      await world.post(director, '/feed-distributions', {
        batchId: chair.id,
        date: '2026-10-10',
        quantityKg: 10,
        feedProductId: product.id,
      });
      const vaccine = await world.post<Id>(director, '/stock-items', {
        name: 'Vaccin',
        category: 'VACCIN',
        unit: 'flacon',
      });
      await world.post(director, '/stock/movements', {
        itemId: vaccine.id,
        type: 'ENTREE',
        date: '2026-09-01',
        quantity: 5,
        unitCost: 100,
        reason: 'ACHAT',
      });
      await world.post(director, '/health-acts', {
        type: 'VACCINATION',
        status: 'REALISE',
        batchId: chair.id,
        date: '2026-10-12',
        stockItemId: vaccine.id,
        quantity: 1,
      });
      const sold = await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair.id, quantity: 5, unitPrice: 100 },
      ]);
      await world.post(accountant, `/sales/${sold.id}/credit-notes`, {
        date: '2026-10-25',
        reason: 'x',
        withReturn: false,
        lines: [{ lineId: sold.lines[0].id, quantity: 1 }],
      });
      const measure = async () => ({
        entries: await countQueries(app, () =>
          entries({ pageSize: 100 }).then(() => undefined),
        ),
        lots: await countQueries(app, () =>
          lots({ pageSize: '100' }).then(() => undefined),
        ),
        detail: await countQueries(app, () =>
          lotDetail(chair.id).then(() => undefined),
        ),
      });
      const one = await measure();
      for (let i = 0; i < 5; i++) {
        const l = await lot({ purchasePrice: 500 });
        await postEntry({
          activity: 'AVICOLE',
          category: 'TRANSPORT',
          batchId: l.id,
        });
        const inv = await invoice('2026-10-20', [
          {
            kind: 'LOT',
            batchId: l.id,
            quantity: 5,
            unitPrice: 100,
            weightKg: 10,
          },
        ]);
        await world.post(accountant, `/sales/${inv.id}/credit-notes`, {
          date: '2026-10-25',
          reason: 'x',
          withReturn: false,
          lines: [{ lineId: inv.lines[0].id, quantity: 1 }],
        });
      }
      const many = await measure();
      expect(many).toEqual(one);
      // 3 reads of the view (rows, count, totals) + the request's own 2
      expect(one.entries).toBe(5);
    });
  });
});
