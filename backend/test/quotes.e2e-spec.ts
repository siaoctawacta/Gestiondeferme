import { INestApplication } from '@nestjs/common';
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
  activity: string;
  category: string;
}
interface Step {
  step: string;
  at: string;
  by: string | null;
}
interface Row extends Id {
  reference: string;
  date: string;
  validUntil: string | null;
  customerId: string;
  customerName: string;
  product: string;
  quantity: number;
  unit: string | null;
  total: number;
  status: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
}
interface Detail extends Row {
  customerPhone: string | null;
  customerAddress: string | null;
  note: string | null;
  lines: Line[];
  history: Step[];
}
interface Page<T> {
  items: T[];
  total: number;
  statusCounts?: Record<string, number>;
}

describe('Quotes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let seller: Headers;
  let accountant: Headers;
  let director: Headers;
  let keeper: Headers;
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
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
        phone: '+228 93 12 34 56',
        address: 'Rue 12, Lomé',
        city: 'Lomé',
      })
    ).id;
    lotId = (await world.lot(director)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const msg = (r: Msg) => r.message;
  const lotLine = (over: Record<string, unknown> = {}) => ({
    kind: 'LOT',
    batchId: lotId,
    quantity: 300,
    unitPrice: 3500,
    ...over,
  });
  const serviceLine = (over: Record<string, unknown> = {}) => ({
    kind: 'SERVICE',
    designation: 'Livraison',
    quantity: 10,
    unitPrice: 2500,
    ...over,
  });
  const body = (over: Record<string, unknown> = {}) => ({
    customerId,
    date: daysAgo(2),
    lines: [lotLine(), serviceLine()],
    ...over,
  });
  const quote = (over: Record<string, unknown> = {}, h = seller) =>
    world.post<Detail>(h, '/quotes', body(over));
  const refused = async (
    over: Record<string, unknown>,
    status = 400,
    h = seller,
  ) => {
    const { message } = (
      await http().post('/api/quotes').set(h).send(body(over)).expect(status)
    ).body as Msg;
    return Array.isArray(message) ? message.join(' | ') : message;
  };
  const act = (id: string, step: string, h = seller, status = 201) =>
    http().post(`/api/quotes/${id}/${step}`).set(h).send({}).expect(status);
  const get = async (id: string, h = seller) =>
    (await http().get(`/api/quotes/${id}`).set(h).expect(200)).body as Detail;
  const list = async (h: Headers, query: Record<string, string> = {}) =>
    (await http().get('/api/quotes').query(query).set(h).expect(200))
      .body as Page<Row>;
  const audit = (id: string) =>
    prisma.auditLog.findMany({
      where: { recordId: id },
      orderBy: { createdAt: 'asc' },
    });

  describe('creation', () => {
    it('creates DV-0001 with two lines and the sum of the rounded lines', async () => {
      const q = await quote();
      expect(q).toMatchObject({
        reference: 'DV-0001',
        date: daysAgo(2),
        validUntil: null,
        status: 'BROUILLON',
        customerId,
        customerName: 'Restaurant Le Palmier',
        customerPhone: '+228 93 12 34 56',
        customerAddress: 'Rue 12, Lomé',
        product: 'Poulets de chair +1',
        quantity: 300,
        unit: null,
        total: 1075000,
        invoiceId: null,
        invoiceNumber: null,
        note: null,
      });
      expect(q.lines).toEqual([
        {
          id: expect.any(String) as string,
          position: 0,
          kind: 'LOT',
          batchId: lotId,
          animalId: null,
          stockItemId: null,
          sourceLabel: expect.stringMatching(/^LC-/) as string,
          designation: 'Poulets de chair',
          unit: null,
          eggsPerUnit: null,
          quantity: 300,
          unitPrice: 3500,
          amount: 1050000,
          weightKg: null,
          activity: 'AVICOLE',
          category: 'VENTE_ANIMAUX',
        },
        {
          id: expect.any(String) as string,
          position: 1,
          kind: 'SERVICE',
          batchId: null,
          animalId: null,
          stockItemId: null,
          sourceLabel: null,
          designation: 'Livraison',
          unit: null,
          eggsPerUnit: null,
          quantity: 10,
          unitPrice: 2500,
          amount: 25000,
          weightKg: null,
          activity: 'GENERAL',
          category: 'PRESTATIONS',
        },
      ]);
      expect(q.history).toEqual([
        {
          step: 'BROUILLON',
          at: expect.any(String) as string,
          by: expect.any(String) as string,
        },
      ]);
      expect((await quote()).reference).toBe('DV-0002');
    });

    it('rounds each line then sums: 2.5 × 333.33 + 0.5 × 0.01 twice', async () => {
      const item = await world.post(director, '/stock-items', {
        name: 'Aliment ponte',
        category: 'ALIMENT',
        unit: 'kg',
      });
      const q = await quote({
        lines: [
          {
            kind: 'ARTICLE',
            stockItemId: item.id,
            quantity: 2.5,
            unitPrice: 333.33,
          },
          serviceLine({ quantity: 0.5, unitPrice: 0.01 }),
          serviceLine({ quantity: 0.5, unitPrice: 0.01 }),
        ],
      });
      expect(q.lines.map((l) => l.amount)).toEqual([833.33, 0.01, 0.01]);
      // 0.005 rounds up on each line: 0.02, where rounding the sum would give 0.01.
      expect(q.total).toBe(833.35);
      expect(q.lines[0]).toMatchObject({
        designation: 'Aliment ponte',
        unit: 'kg',
        activity: 'GENERAL',
        category: 'VENTE_ARTICLES',
        sourceLabel: 'Aliment ponte',
      });
    });

    it('names animals and egg lots after their source and snapshots the tray size', async () => {
      const sow = await world.animal(director, { tag: 'TR-027' });
      const q = await quote({
        lines: [
          {
            kind: 'ANIMAL',
            animalId: sow.id,
            quantity: 1,
            unitPrice: 250000,
            weightKg: 180,
          },
          { kind: 'OEUFS', batchId: lotId, quantity: 400, unitPrice: 2500 },
          {
            kind: 'OEUFS',
            batchId: lotId,
            unit: 'OEUF',
            quantity: 90,
            unitPrice: 85,
          },
        ],
      });
      expect(q.lines[0]).toMatchObject({
        designation: 'Truie TR-027',
        sourceLabel: 'TR-027',
        weightKg: 180,
        activity: 'PORCIN',
        category: 'VENTE_ANIMAUX',
      });
      expect(q.lines[1]).toMatchObject({
        designation: 'Œufs (plateau)',
        unit: 'PLATEAU',
        eggsPerUnit: 30,
        activity: 'AVICOLE',
        category: 'VENTE_OEUFS',
      });
      expect(q.lines[2]).toMatchObject({
        designation: 'Œufs',
        unit: 'OEUF',
        eggsPerUnit: 1,
      });
      // Changing the setting never rewrites a quote already written.
      const admin = await world.actor('SUPER_ADMIN');
      await http()
        .put('/api/settings/eggsPerTray')
        .set(admin)
        .send({ value: 24 })
        .expect(200);
      expect((await get(q.id)).lines[1].eggsPerUnit).toBe(30);
      const next = await quote({
        lines: [{ kind: 'OEUFS', batchId: lotId, quantity: 1, unitPrice: 1 }],
      });
      expect(next.lines[0].eggsPerUnit).toBe(24);
    });

    it('keeps a given designation and does not check availability (checked at issue)', async () => {
      const q = await quote({
        lines: [
          lotLine({ quantity: 5000, designation: 'Poulets prêts à cuire' }),
        ],
      });
      expect(q.lines[0].designation).toBe('Poulets prêts à cuire');
      expect(q.total).toBe(17500000);
    });

    it('validates the lines', async () => {
      expect(await refused({ lines: [] })).toBe(
        'Un devis comporte au moins une ligne',
      );
      expect(
        await refused({ lines: [serviceLine({ designation: ' ' })] }),
      ).toBe('Indiquez la désignation de la prestation');
      expect(await refused({ lines: [lotLine({ batchId: undefined })] })).toBe(
        'Choisissez un lot',
      );
      expect(await refused({ lines: [lotLine({ quantity: 2.5 })] })).toBe(
        'La quantité doit être un nombre entier',
      );
      const sow = await world.animal(director, { tag: 'TR-027' });
      expect(
        await refused({
          lines: [
            { kind: 'ANIMAL', animalId: sow.id, quantity: 2, unitPrice: 1 },
          ],
        }),
      ).toBe('Une ligne Animal vend un seul animal');
      expect(await refused({ lines: [serviceLine({ weightKg: 5 })] })).toBe(
        'Le poids ne concerne que les lots et les animaux',
      );
      expect(await refused({ lines: [lotLine({ unitPrice: -1 })] })).toContain(
        'prix unitaire',
      );
      expect(
        await refused({ lines: [lotLine({ kind: 'AUTRE' })] }),
      ).toBeTruthy();
      expect(
        await refused({
          lines: [
            {
              kind: 'OEUFS',
              batchId: lotId,
              unit: 'CAISSE',
              quantity: 1,
              unitPrice: 1,
            },
          ],
        }),
      ).toBe("L'unité des œufs est invalide");
      expect(
        await refused({
          lines: [serviceLine({ quantity: 1_000_000, unitPrice: 1_000_000 })],
        }),
      ).toBe('Le montant total est trop élevé');
    });

    it('validates the header', async () => {
      expect(await refused({ customerId: 'inconnu' })).toBe('Client invalide');
      await refused({ customerId: null });
      await refused({ date: daysAgo(-3) });
      await refused({ date: '2026-13-01' });
      expect(await refused({ validUntil: daysAgo(5) })).toBe(
        'La validité ne peut pas précéder la date du devis',
      );
      await refused({ note: 'x'.repeat(1001) });
      await refused({ status: 'ACCEPTE' });
      const q = await quote({
        validUntil: daysAgo(-10),
        note: ' Livraison jeudi ',
      });
      expect(q).toMatchObject({
        validUntil: daysAgo(-10),
        note: 'Livraison jeudi',
      });
    });

    it('refuses an inactive customer or article, and ids of another farm or organisation', async () => {
      const other = await prisma.customer.create({
        data: {
          organizationId: (await createOrganization('Autre')).id,
          name: 'Étranger',
          type: 'PARTICULIER',
        },
      });
      expect(await refused({ customerId: other.id })).toBe('Client invalide');
      const idle = await world.post(seller, '/customers', {
        name: 'Inactif',
        type: 'PARTICULIER',
        active: false,
      });
      expect(await refused({ customerId: idle.id })).toBe(
        'Ce client est inactif',
      );

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
      const animalB = await prisma.animal.create({
        data: {
          farmId: farmB,
          tag: 'TR-B1',
          category: 'TRUIE',
          sex: 'F',
          buildingId: building.id,
        },
      });
      expect(await refused({ lines: [lotLine({ batchId: lotB.id })] })).toBe(
        'Lot invalide pour cette ferme',
      );
      expect(
        await refused({
          lines: [
            { kind: 'OEUFS', batchId: lotB.id, quantity: 1, unitPrice: 1 },
          ],
        }),
      ).toBe('Lot invalide pour cette ferme');
      expect(
        await refused({
          lines: [
            { kind: 'ANIMAL', animalId: animalB.id, quantity: 1, unitPrice: 1 },
          ],
        }),
      ).toBe('Animal invalide pour cette ferme');

      const foreignItem = await prisma.stockItem.create({
        data: {
          organizationId: other.organizationId,
          name: 'Étranger',
          category: 'ALIMENT',
          unit: 'kg',
        },
      });
      expect(
        await refused({
          lines: [
            {
              kind: 'ARTICLE',
              stockItemId: foreignItem.id,
              quantity: 1,
              unitPrice: 1,
            },
          ],
        }),
      ).toBe('Article invalide');
      const idleItem = await world.post(director, '/stock-items', {
        name: 'Ancien',
        category: 'ALIMENT',
        unit: 'kg',
      });
      await http()
        .patch(`/api/stock-items/${idleItem.id}`)
        .set(director)
        .send({ active: false })
        .expect(200);
      expect(
        await refused({
          lines: [
            {
              kind: 'ARTICLE',
              stockItemId: idleItem.id,
              quantity: 1,
              unitPrice: 1,
            },
          ],
        }),
      ).toBe('Article inactif');
      expect(await prisma.quote.count()).toBe(0);
    });

    it('numbers concurrent creations without gaps or duplicates', async () => {
      const made = await Promise.all(Array.from({ length: 6 }, () => quote()));
      expect(made.map((q) => q.reference).sort()).toEqual([
        'DV-0001',
        'DV-0002',
        'DV-0003',
        'DV-0004',
        'DV-0005',
        'DV-0006',
      ]);
    });
  });

  describe('edit and delete', () => {
    it('answers a PATCH that changes nothing with 200 and no audit row', async () => {
      const q = await quote();
      const before = (await audit(q.id)).length;
      await http()
        .patch(`/api/quotes/${q.id}`)
        .set(seller)
        .send({
          customerId,
          date: q.date,
          lines: [lotLine(), serviceLine()],
          note: null,
        })
        .expect(200);
      await http()
        .patch(`/api/quotes/${q.id}`)
        .set(seller)
        .send({})
        .expect(200);
      expect((await audit(q.id)).length).toBe(before);
    });

    it('changes the header and replaces the lines, with the total', async () => {
      const q = await quote();
      const res = await http()
        .patch(`/api/quotes/${q.id}`)
        .set(seller)
        .send({
          validUntil: daysAgo(-15),
          note: 'Remise accordée',
          lines: [lotLine({ quantity: 100, unitPrice: 3000 })],
        })
        .expect(200);
      const next = res.body as Detail;
      expect(next).toMatchObject({
        validUntil: daysAgo(-15),
        note: 'Remise accordée',
        total: 300000,
        product: 'Poulets de chair',
      });
      expect(next.lines).toHaveLength(1);
      expect(await prisma.quoteLine.count({ where: { quoteId: q.id } })).toBe(
        1,
      );
      const rows = await audit(q.id);
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      expect(rows[1]).toMatchObject({ module: 'ventes', label: 'DV-0001' });
      const cleared = await http()
        .patch(`/api/quotes/${q.id}`)
        .set(seller)
        .send({ validUntil: null })
        .expect(200);
      expect((cleared.body as Detail).validUntil).toBeNull();
    });

    it('validates a PATCH (null is a 400)', async () => {
      const q = await quote();
      for (const patch of [
        { customerId: null },
        { date: null },
        { lines: null },
        { lines: [] },
        { customerId: 'inconnu' },
        { validUntil: daysAgo(10) },
      ]) {
        await http()
          .patch(`/api/quotes/${q.id}`)
          .set(seller)
          .send(patch)
          .expect(400);
      }
    });

    it('deletes a draft, audits it and never gives its number back', async () => {
      const q = await quote();
      await http().delete(`/api/quotes/${q.id}`).set(seller).expect(200);
      await http().get(`/api/quotes/${q.id}`).set(seller).expect(404);
      expect(await prisma.quoteLine.count()).toBe(0);
      expect((await audit(q.id)).map((r) => r.action)).toEqual([
        'CREATE',
        'DELETE',
      ]);
      expect((await quote()).reference).toBe('DV-0002');
    });
  });

  describe('workflow', () => {
    it('goes from draft to sent to accepted, and refuses what no longer applies', async () => {
      const q = await quote();
      const sent = (await act(q.id, 'send')).body as Detail;
      expect(sent.status).toBe('ENVOYE');
      const patch = await http()
        .patch(`/api/quotes/${q.id}`)
        .set(seller)
        .send({ note: 'x' })
        .expect(409);
      expect(msg(patch.body as Msg)).toBe(
        'Seul un devis en brouillon peut être modifié',
      );
      const del = await http()
        .delete(`/api/quotes/${q.id}`)
        .set(seller)
        .expect(409);
      expect(msg(del.body as Msg)).toBe(
        'Seul un devis en brouillon peut être supprimé',
      );
      expect(msg((await act(q.id, 'send', seller, 409)).body as Msg)).toBe(
        'Ce devis a déjà été envoyé',
      );
      expect(((await act(q.id, 'accept')).body as Detail).status).toBe(
        'ACCEPTE',
      );
      expect(msg((await act(q.id, 'refuse', seller, 409)).body as Msg)).toBe(
        'Seul un devis envoyé peut être accepté ou refusé',
      );
      expect(msg((await act(q.id, 'accept', seller, 409)).body as Msg)).toBe(
        'Seul un devis envoyé peut être accepté ou refusé',
      );
      const detail = await get(q.id);
      expect(detail.history.map((s) => s.step)).toEqual([
        'BROUILLON',
        'ENVOYE',
        'ACCEPTE',
      ]);
      expect(detail.history[2].by).toBeTruthy();
    });

    it('refuses a quote that is not sent, and records who decided', async () => {
      const q = await quote();
      expect(msg((await act(q.id, 'accept', seller, 409)).body as Msg)).toBe(
        'Seul un devis envoyé peut être accepté ou refusé',
      );
      expect(msg((await act(q.id, 'refuse', seller, 409)).body as Msg)).toBe(
        'Seul un devis envoyé peut être accepté ou refusé',
      );
      await act(q.id, 'send');
      expect(((await act(q.id, 'refuse')).body as Detail).status).toBe(
        'REFUSE',
      );
      const detail = await get(q.id);
      expect(detail.history.map((s) => s.step)).toEqual([
        'BROUILLON',
        'ENVOYE',
        'REFUSE',
      ]);
      const row = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
      expect(row.refusedAt).not.toBeNull();
      expect(row.acceptedAt).toBeNull();
      expect(row.decidedById).not.toBeNull();
      expect(row.sentById).not.toBeNull();
    });

    it('audits every step with one row', async () => {
      const q = await quote();
      await act(q.id, 'send');
      await act(q.id, 'accept');
      const rows = await audit(q.id);
      expect(rows.map((r) => `${r.module}:${r.action}`)).toEqual([
        'ventes:CREATE',
        'ventes:UPDATE',
        'ventes:UPDATE',
      ]);
      expect(rows[2]).toMatchObject({ farmId: world.farmId, label: 'DV-0001' });
      expect(rows[2].before).toMatchObject({ status: 'ENVOYE' });
      expect(rows[2].after).toMatchObject({ status: 'ACCEPTE' });
    });

    it('shows a sent quote past its validity as Expiré, and still lets it be decided', async () => {
      const expired = await quote({
        date: daysAgo(10),
        validUntil: daysAgo(3),
      });
      const today = await quote({ date: daysAgo(10), validUntil: daysAgo(0) });
      await act(expired.id, 'send');
      await act(today.id, 'send');
      const draft = await quote({ date: daysAgo(10), validUntil: daysAgo(3) });
      expect((await get(expired.id)).status).toBe('EXPIRE');
      expect((await get(today.id)).status).toBe('ENVOYE');
      expect((await get(draft.id)).status).toBe('BROUILLON');
      const page = await list(seller);
      expect(page.statusCounts).toEqual({
        BROUILLON: 1,
        ENVOYE: 1,
        ACCEPTE: 0,
        REFUSE: 0,
        FACTURE: 0,
        EXPIRE: 1,
      });
      expect(
        (await list(seller, { status: 'EXPIRE' })).items.map((r) => r.id),
      ).toEqual([expired.id]);
      expect(
        (await list(seller, { status: 'ENVOYE' })).items.map((r) => r.id),
      ).toEqual([today.id]);
      await http()
        .get('/api/quotes')
        .query({ status: 'FOO' })
        .set(seller)
        .expect(400);
      expect(((await act(expired.id, 'accept')).body as Detail).status).toBe(
        'ACCEPTE',
      );
      expect(msg((await act(today.id, 'send', seller, 409)).body as Msg)).toBe(
        'Ce devis a déjà été envoyé',
      );
    });

    it('refuses to convert a quote that is not sent or accepted', async () => {
      const q = await quote();
      expect(msg((await act(q.id, 'convert', seller, 409)).body as Msg)).toBe(
        'Seul un devis envoyé ou accepté peut être facturé',
      );
      await act(q.id, 'send');
      await act(q.id, 'refuse');
      expect(msg((await act(q.id, 'convert', seller, 409)).body as Msg)).toBe(
        'Seul un devis envoyé ou accepté peut être facturé',
      );
    });

    // Task 4 (invoices): converting a sent or accepted quote creates the invoice
    // draft with the quote's lines and sources, the quote becomes FACTURE with
    // its invoiceId and invoiceNumber (null until the draft is issued).
    it.todo('converts a sent quote into an invoice draft (lands with Task 4)');
  });

  describe('lists', () => {
    it('lists rows with the first line, pages, sorts, filters and searches', async () => {
      const afi = await world.post(seller, '/customers', {
        name: 'SuperMarché Ramco',
        type: 'GROSSISTE',
      });
      const a = await quote({ date: daysAgo(5) });
      const b = await quote({
        customerId: afi.id,
        date: daysAgo(1),
        lines: [
          serviceLine({
            designation: 'Transport',
            quantity: 2,
            unitPrice: 1000,
            unit: 'course',
          }),
        ],
      });
      await act(a.id, 'send');
      const page = await list(accountant);
      expect(page.total).toBe(2);
      expect(page.items.map((r) => r.reference)).toEqual([
        'DV-0002',
        'DV-0001',
      ]);
      expect(page.items[0]).toEqual({
        id: b.id,
        reference: 'DV-0002',
        date: daysAgo(1),
        validUntil: null,
        customerId: afi.id,
        customerName: 'SuperMarché Ramco',
        product: 'Transport',
        quantity: 2,
        unit: 'course',
        total: 2000,
        status: 'BROUILLON',
        invoiceId: null,
        invoiceNumber: null,
      });
      expect(page.statusCounts).toMatchObject({ BROUILLON: 1, ENVOYE: 1 });
      expect((await list(seller, { sort: 'date:asc' })).items[0].id).toBe(a.id);
      expect((await list(seller, { sort: 'total:desc' })).items[0].id).toBe(
        a.id,
      );
      expect((await list(seller, { sort: 'reference:desc' })).items[0].id).toBe(
        b.id,
      );
      expect((await list(seller, { customerId: afi.id })).total).toBe(1);
      expect((await list(seller, { search: 'ramco' })).total).toBe(1);
      expect((await list(seller, { search: 'dv-0001' })).total).toBe(1);
      expect((await list(seller, { search: 'Transport' })).total).toBe(1);
      expect((await list(seller, { status: 'ENVOYE' })).total).toBe(1);
      expect(
        (await list(seller, { pageSize: '1', page: '2' })).items,
      ).toHaveLength(1);
      await http()
        .get('/api/quotes')
        .query({ sort: 'customerName' })
        .set(seller)
        .expect(400);
    });

    it('exports the reference columns', async () => {
      const q = await quote();
      await act(q.id, 'send');
      const res = await http()
        .get('/api/quotes')
        .query({ format: 'csv' })
        .set(seller)
        .expect(200);
      const lines = res.text.slice(1).split('\r\n');
      expect(lines[0]).toBe(
        'Date;N° devis;Client;Produit;Quantité;Total;Statut',
      );
      expect(lines[1]).toBe(
        `${daysAgo(2)};DV-0001;Restaurant Le Palmier;Poulets de chair +1;300;1075000;Envoyé`,
      );
    });
  });

  describe('permissions and scope', () => {
    it('lets the seller write, the accountant and director read, the keeper see nothing', async () => {
      const q = await quote();
      for (const h of [accountant, director]) {
        await world.post(h, '/quotes', body(), 403);
        await http()
          .patch(`/api/quotes/${q.id}`)
          .set(h)
          .send({ note: 'x' })
          .expect(403);
        await http().delete(`/api/quotes/${q.id}`).set(h).expect(403);
        await act(q.id, 'send', h, 403);
        await act(q.id, 'accept', h, 403);
        await act(q.id, 'refuse', h, 403);
        await act(q.id, 'convert', h, 403);
        await http().get('/api/quotes').set(h).expect(200);
        await http().get(`/api/quotes/${q.id}`).set(h).expect(200);
      }
      await http().get('/api/quotes').set(keeper).expect(403);
      await http().get(`/api/quotes/${q.id}`).set(keeper).expect(403);
      await world.post(keeper, '/quotes', body(), 403);
    });

    it('reads under all farms but refuses every write there', async () => {
      const q = await quote();
      const all = { ...(await world.actor('SUPER_ADMIN')), 'X-Farm-Id': 'all' };
      expect((await list(all)).total).toBe(1);
      await http().get(`/api/quotes/${q.id}`).set(all).expect(200);
      await world.post(all, '/quotes', body(), 403);
      await http()
        .patch(`/api/quotes/${q.id}`)
        .set(all)
        .send({ note: 'x' })
        .expect(403);
      await http().delete(`/api/quotes/${q.id}`).set(all).expect(403);
      await act(q.id, 'send', all, 403);
    });

    it('hides the quotes of another farm (404) and of another organisation', async () => {
      const farmB = (await createFarm(world.orgId, 'Ferme B')).id;
      const user = await createUser({
        organizationId: world.orgId,
        role: 'COMMERCIAL',
        farmIds: [world.farmId, farmB],
      });
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const onB = { Authorization: auth, 'X-Farm-Id': farmB };
      const q = await quote();
      for (const [method, path, payload] of [
        ['get', '', undefined],
        ['patch', '', { note: 'x' }],
        ['delete', '', undefined],
        ['post', '/send', {}],
        ['post', '/accept', {}],
        ['post', '/refuse', {}],
        ['post', '/convert', {}],
      ] as const) {
        const res = await http()
          [method](`/api/quotes/${q.id}${path}`)
          .set(onB)
          .send(payload);
        expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
      }
      expect((await list(onB)).total).toBe(0);
      // a lot of farm A in a quote of farm B is a 400
      expect(
        (await http().post('/api/quotes').set(onB).send(body()).expect(400))
          .body,
      ).toMatchObject({ message: 'Lot invalide pour cette ferme' });
    });
  });

  describe('database constraints', () => {
    it('refuses a line that contradicts its kind or its amount', async () => {
      const q = await quote();
      const item = await prisma.stockItem.create({
        data: {
          organizationId: world.orgId,
          name: 'Sac',
          category: 'ALIMENT',
          unit: 'kg',
        },
      });
      const base = {
        quoteId: q.id,
        position: 9,
        designation: 'x',
        quantity: 2,
        unitPrice: 10,
        amount: 20,
      };
      const make = (data: Record<string, unknown>) =>
        prisma.quoteLine.create({
          data: { ...base, kind: 'SERVICE', ...data } as never,
        });
      await expect(make({ amount: 21 })).rejects.toThrow(
        /QuoteLine_amount_check/,
      );
      await expect(make({ kind: 'LOT' })).rejects.toThrow(
        /QuoteLine_kind_check/,
      );
      await expect(
        make({ kind: 'LOT', batchId: lotId, quantity: 1.5, amount: 15 }),
      ).rejects.toThrow(/QuoteLine_kind_check/);
      await expect(
        make({ kind: 'LOT', batchId: lotId, eggsPerUnit: 30 }),
      ).rejects.toThrow(/QuoteLine_kind_check/);
      await expect(make({ kind: 'OEUFS', batchId: lotId })).rejects.toThrow(
        /QuoteLine_kind_check/,
      );
      await expect(
        make({ kind: 'ARTICLE', stockItemId: item.id, batchId: lotId }),
      ).rejects.toThrow(/QuoteLine_kind_check/);
      await expect(
        make({ kind: 'ARTICLE', stockItemId: item.id, weightKg: 3 }),
      ).rejects.toThrow(/QuoteLine_weightKg_check/);
      await expect(make({ quantity: 0, amount: 0 })).rejects.toThrow(
        /QuoteLine_quantity_check/,
      );
      await expect(make({ position: 0 })).rejects.toThrow();
      await expect(
        prisma.quote.update({ where: { id: q.id }, data: { total: -1 } }),
      ).rejects.toThrow(/Quote_total_check/);
      await expect(
        prisma.quote.update({
          where: { id: q.id },
          data: { validUntil: new Date(daysAgo(30)) },
        }),
      ).rejects.toThrow(/Quote_validUntil_check/);
    });
  });
});
