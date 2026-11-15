import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Headers, Id, Msg, World } from './fixtures';
import { createOrganization, createTestApp } from './setup';

interface Customer extends Id {
  name: string;
  type: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  active: boolean;
  balance: number;
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const PALMIER = {
  name: 'Restaurant Le Palmier',
  type: 'RESTAURANT',
  phone: '+228 93 12 34 56',
  city: 'Lomé',
};
const AFI = {
  name: 'Marché Hédzranawoé — Mme Afi',
  type: 'REVENDEUR',
  phone: '+228 98 65 43 21',
  city: 'Lomé',
};
const RAMCO = {
  name: 'SuperMarché Ramco',
  type: 'GROSSISTE',
  phone: '+228 22 21 00 00',
  city: 'Lomé',
};

describe('Customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let seller: Headers;
  let accountant: Headers;
  let director: Headers;
  let keeper: Headers;

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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const create = (over: Record<string, unknown> = PALMIER, status = 201) =>
    world.post<Customer>(seller, '/customers', over, status);
  const msg = (r: Msg) => (Array.isArray(r.message) ? r.message : r.message);
  const list = async (h: Headers, query: Record<string, string> = {}) =>
    (await http().get('/api/customers').query(query).set(h).expect(200))
      .body as Page<Customer>;

  it('lets the seller register the reference customers', async () => {
    const palmier = await create(PALMIER);
    expect(palmier).toMatchObject({
      name: 'Restaurant Le Palmier',
      type: 'RESTAURANT',
      phone: '+228 93 12 34 56',
      email: null,
      city: 'Lomé',
      address: null,
      active: true,
      balance: 0,
    });
    await create(AFI);
    await create(RAMCO);
    const page = await list(accountant);
    expect(page.total).toBe(3);
    expect(page.items.map((c) => c.name)).toEqual([
      'Marché Hédzranawoé — Mme Afi',
      'Restaurant Le Palmier',
      'SuperMarché Ramco',
    ]);
    expect(page.items[0]).toEqual({
      id: expect.any(String) as string,
      name: 'Marché Hédzranawoé — Mme Afi',
      type: 'REVENDEUR',
      phone: '+228 98 65 43 21',
      email: null,
      city: 'Lomé',
      address: null,
      active: true,
      balance: 0,
    });
  });

  it('shows one customer with the totals of its documents', async () => {
    const c = await create();
    const res = await http()
      .get(`/api/customers/${c.id}`)
      .set(director)
      .expect(200);
    expect(res.body).toEqual({
      ...c,
      invoiced: 0,
      paid: 0,
      credited: 0,
    });
    await http().get('/api/customers/nope').set(director).expect(404);
  });

  it('filters by type, activity and search', async () => {
    await create(PALMIER);
    const afi = await create(AFI);
    await create(RAMCO);
    await http()
      .patch(`/api/customers/${afi.id}`)
      .set(seller)
      .send({ active: false })
      .expect(200);
    expect((await list(seller, { type: 'GROSSISTE' })).items).toHaveLength(1);
    expect((await list(seller, { active: 'true' })).total).toBe(2);
    expect((await list(seller, { active: 'false' })).items[0].name).toBe(
      afi.name,
    );
    expect((await list(seller, { search: 'palm' })).total).toBe(1);
    await http()
      .get('/api/customers')
      .query({ type: 'INCONNU' })
      .set(seller)
      .expect(400);
    const sorted = await list(seller, { sort: 'name:desc', pageSize: '2' });
    expect(sorted.items.map((c) => c.name)).toEqual([
      'SuperMarché Ramco',
      'Restaurant Le Palmier',
    ]);
    expect(sorted.total).toBe(3);
    await http()
      .get('/api/customers')
      .query({ sort: 'phone:asc' })
      .set(seller)
      .expect(400);
  });

  it('exports the reference columns', async () => {
    await create(PALMIER);
    const res = await http()
      .get('/api/customers')
      .query({ format: 'csv' })
      .set(accountant)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.slice(1).split('\r\n');
    expect(lines[0]).toBe('Nom;Type;Téléphone;Ville');
    expect(lines[1]).toBe(
      // The export neutralises a cell that starts with + (spreadsheet formulas).
      "Restaurant Le Palmier;Restaurant;'+228 93 12 34 56;Lomé",
    );
  });

  describe('permissions', () => {
    it('creates, edits and deletes as a master record (clients:update)', async () => {
      const c = await create();
      for (const h of [accountant, director, keeper]) {
        await world.post(h, '/customers', AFI, 403);
        await http()
          .patch(`/api/customers/${c.id}`)
          .set(h)
          .send({ city: 'Kpalimé' })
          .expect(403);
        await http().delete(`/api/customers/${c.id}`).set(h).expect(403);
      }
      await http().get('/api/customers').set(keeper).expect(403);
      await http().get(`/api/customers/${c.id}`).set(keeper).expect(403);
      for (const h of [accountant, director]) {
        await http().get('/api/customers').set(h).expect(200);
      }
    });

    it('is organisation data: written under any farm header, never another organisation’s', async () => {
      const all = { ...seller, 'X-Farm-Id': 'all' };
      const c = await world.post<Customer>(all, '/customers', PALMIER);
      await http()
        .patch(`/api/customers/${c.id}`)
        .set(all)
        .send({ city: 'Aného' })
        .expect(200);
      const other = await createOrganization('Autre');
      const foreign = await prisma.customer.create({
        data: {
          organizationId: other.id,
          name: 'Étranger',
          type: 'PARTICULIER',
        },
      });
      expect((await list(seller)).items.map((x) => x.name)).toEqual([
        PALMIER.name,
      ]);
      await http().get(`/api/customers/${foreign.id}`).set(seller).expect(404);
      await http()
        .patch(`/api/customers/${foreign.id}`)
        .set(seller)
        .send({ city: 'x' })
        .expect(404);
      await http()
        .delete(`/api/customers/${foreign.id}`)
        .set(seller)
        .expect(404);
      // the same name in another organisation is not a duplicate
      await prisma.customer.create({
        data: {
          organizationId: other.id,
          name: PALMIER.name,
          type: 'PARTICULIER',
        },
      });
      await create(AFI);
    });
  });

  describe('rules', () => {
    it('refuses a duplicate name, on create and on rename', async () => {
      await create(PALMIER);
      const afi = await create(AFI);
      expect(
        msg(await world.post<Msg>(seller, '/customers', PALMIER, 409)),
      ).toBe('Un client porte déjà ce nom');
      const res = await http()
        .patch(`/api/customers/${afi.id}`)
        .set(seller)
        .send({ name: PALMIER.name })
        .expect(409);
      expect(msg(res.body as Msg)).toBe('Un client porte déjà ce nom');
    });

    it('validates the body (null is a 400, never a 500)', async () => {
      await create({ name: '', type: 'RESTAURANT' }, 400);
      await create({ name: 'X' }, 400);
      await create({ name: 'X', type: 'INCONNU' }, 400);
      await create(
        { name: 'X', type: 'PARTICULIER', email: 'pas-un-email' },
        400,
      );
      await create({ name: 'X', type: 'PARTICULIER', active: null }, 400);
      await create(
        { name: 'X', type: 'PARTICULIER', organizationId: 'x' },
        400,
      );
      const c = await create();
      for (const body of [
        { name: null },
        { type: null },
        { active: null },
        { name: '  ' },
      ]) {
        await http()
          .patch(`/api/customers/${c.id}`)
          .set(seller)
          .send(body)
          .expect(400);
      }
      const cleared = await http()
        .patch(`/api/customers/${c.id}`)
        .set(seller)
        .send({ phone: null, city: '  ' })
        .expect(200);
      expect(cleared.body).toMatchObject({ phone: null, city: null });
    });

    it('refuses to delete a customer that has documents, and deletes one that has none', async () => {
      const used = await create(PALMIER);
      const free = await create(AFI);
      const lot = await world.lot(director);
      await world.post(seller, '/quotes', {
        customerId: used.id,
        date: new Date().toISOString().slice(0, 10),
        lines: [{ kind: 'LOT', batchId: lot.id, quantity: 3, unitPrice: 3500 }],
      });
      const res = await http()
        .delete(`/api/customers/${used.id}`)
        .set(seller)
        .expect(409);
      expect(msg(res.body as Msg)).toBe(
        'Ce client a des documents : désactivez-le',
      );
      await http().delete(`/api/customers/${free.id}`).set(seller).expect(200);
      await http().get(`/api/customers/${free.id}`).set(seller).expect(404);
    });
  });

  describe('audit', () => {
    it('writes one row per change and none for a no-op', async () => {
      const c = await create();
      await http()
        .patch(`/api/customers/${c.id}`)
        .set(seller)
        .send({ name: PALMIER.name, city: 'Lomé' })
        .expect(200);
      await http()
        .patch(`/api/customers/${c.id}`)
        .set(seller)
        .send({})
        .expect(200);
      await http()
        .patch(`/api/customers/${c.id}`)
        .set(seller)
        .send({ phone: '+228 90 00 00 00' })
        .expect(200);
      await http().delete(`/api/customers/${c.id}`).set(seller).expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { recordId: c.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => `${r.module}:${r.action}`)).toEqual([
        'clients:CREATE',
        'clients:UPDATE',
        'clients:DELETE',
      ]);
      expect(rows[0].label).toBe(PALMIER.name);
      expect(rows[1].after).toMatchObject({ phone: '+228 90 00 00 00' });
      expect(rows[1].before).toMatchObject({ phone: '+228 93 12 34 56' });
    });
  });
});
