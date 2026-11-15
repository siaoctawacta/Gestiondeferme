import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Role } from '../src/generated/prisma/enums';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

interface AnimalItem {
  id: string;
  tag: string;
  category: string;
  sex: string;
  breedId: string | null;
  breedName: string | null;
  buildingId: string;
  buildingName: string;
  birthDate: string | null;
  sireId: string | null;
  sireTag: string | null;
  damId: string | null;
  damTag: string | null;
  status: string;
  weightKg: number | null;
  exitDate: string | null;
  exitReason: string | null;
  notes: string | null;
}
interface HerdRow {
  kind: 'ANIMAL' | 'LOT';
  id: string;
  identifier: string;
  category: string;
  breedName: string | null;
  buildingName: string;
  birthDate?: string | null;
  entryDate?: string | null;
  weightKg: number | null;
  headcount: number;
  status: string;
}
interface Page<T> {
  items: T[];
  total: number;
}
interface Msg {
  message: string | string[];
}

const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);

describe('Pig herd (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let bldA: string; // capacity 500
  let bldSmall: string; // capacity 3
  let bldB: string;
  let bldPoultry: string; // a poultry house: pigs may not live there

  const http = () => request(app.getHttpServer() as App);

  async function actor(role: Role, farmIds: string[] = [farmA], farm = farmA) {
    const user = await createUser({ organizationId: orgId, role, farmIds });
    const token = await tokenFor(user.id);
    return {
      user,
      headers: { Authorization: `Bearer ${token}`, 'X-Farm-Id': farm },
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await createOrganization()).id;
    farmA = (await createFarm(orgId, 'Ferme A')).id;
    farmB = (await createFarm(orgId, 'Ferme B')).id;
    const siteA = await prisma.site.create({
      data: { farmId: farmA, name: 'Site A' },
    });
    const siteB = await prisma.site.create({
      data: { farmId: farmB, name: 'Site B' },
    });
    const mk = (
      farmId: string,
      siteId: string,
      name: string,
      capacity: number,
      type: 'PORCIN' | 'AVICOLE' = 'PORCIN',
    ) =>
      prisma.building
        .create({ data: { farmId, siteId, name, type, capacity } })
        .then((b) => b.id);
    bldA = await mk(farmA, siteA.id, 'Porcherie 1', 500);
    bldSmall = await mk(farmA, siteA.id, 'Quarantaine', 3);
    bldB = await mk(farmB, siteB.id, 'Porcherie B', 500);
    bldPoultry = await mk(farmA, siteA.id, 'Poulailler', 500, 'AVICOLE');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function animal(
    headers: Record<string, string>,
    over: Record<string, unknown> = {},
  ): Promise<AnimalItem> {
    const res = await http()
      .post('/api/animals')
      .set(headers)
      .send({ category: 'TRUIE', buildingId: bldA, ...over })
      .expect(201);
    return res.body as AnimalItem;
  }

  async function lot(
    headers: Record<string, string>,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; code: string }> {
    const res = await http()
      .post('/api/batches')
      .set(headers)
      .send({
        species: 'PORCIN',
        type: 'ENGRAISSEMENT',
        buildingId: bldA,
        entryDate: daysAgo(20),
        initialCount: 240,
        ...over,
      })
      .expect(201);
    return res.body as { id: string; code: string };
  }

  const occupation = async (headers: Record<string, string>, id: string) =>
    (
      (await http().get(`/api/buildings/${id}`).set(headers).expect(200))
        .body as { occupation: number }
    ).occupation;

  describe('animals', () => {
    it('creates an animal with the given tag and returns the full shape', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const breed = await prisma.breed.create({
        data: { organizationId: orgId, species: 'PORCIN', name: 'Large White' },
      });
      const a = await animal(headers, {
        tag: 'TR-014',
        breedId: breed.id,
        birthDate: '2025-01-10',
        notes: 'Bonne mère',
      });
      expect(a).toMatchObject({
        tag: 'TR-014',
        category: 'TRUIE',
        sex: 'F',
        breedId: breed.id,
        breedName: 'Large White',
        buildingId: bldA,
        buildingName: 'Porcherie 1',
        birthDate: '2025-01-10',
        sireId: null,
        sireTag: null,
        damId: null,
        damTag: null,
        status: 'ACTIF',
        weightKg: null,
        exitDate: null,
        exitReason: null,
        notes: 'Bonne mère',
      });
      const got = await http()
        .get(`/api/animals/${a.id}`)
        .set(headers)
        .expect(200);
      expect(got.body).toEqual(a);
    });

    it('generates TR-, VR- and CO- tags per farm when the tag is omitted', async () => {
      const { headers } = await actor('RESP_PORCIN');
      expect((await animal(headers)).tag).toBe('TR-001');
      expect((await animal(headers)).tag).toBe('TR-002');
      expect((await animal(headers, { category: 'VERRAT' })).tag).toBe(
        'VR-001',
      );
      expect((await animal(headers, { category: 'COCHETTE' })).tag).toBe(
        'CO-001',
      );
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      expect((await animal(other.headers, { buildingId: bldB })).tag).toBe(
        'TR-001',
      );
    });

    it('generates distinct tags for simultaneous creations', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          http()
            .post('/api/animals')
            .set(headers)
            .send({ category: 'TRUIE', buildingId: bldA }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      const tags = results.map((r) => (r.body as AnimalItem).tag);
      expect(new Set(tags).size).toBe(6);
      expect([...tags].sort()).toEqual([
        'TR-001',
        'TR-002',
        'TR-003',
        'TR-004',
        'TR-005',
        'TR-006',
      ]);
    });

    it('rejects a duplicate tag with 409', async () => {
      const { headers } = await actor('RESP_PORCIN');
      await animal(headers, { tag: 'TR-014' });
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, tag: 'TR-014' })
        .expect(409);
    });

    it('derives the sex from the category and rejects a mismatch', async () => {
      const { headers } = await actor('RESP_PORCIN');
      expect((await animal(headers, { category: 'VERRAT' })).sex).toBe('M');
      expect((await animal(headers, { category: 'COCHETTE' })).sex).toBe('F');
      expect((await animal(headers, { category: 'TRUIE', sex: 'F' })).sex).toBe(
        'F',
      );
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'VERRAT', sex: 'F', buildingId: bldA })
        .expect(400);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', sex: 'M', buildingId: bldA })
        .expect(400);
    });

    it('validates building, breed, dates, sire and dam', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sire = await animal(headers, { category: 'VERRAT' });
      const dam = await animal(headers);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldB })
        .expect(400);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, breedId: 'nope' })
        .expect(400);
      const avicole = await prisma.breed.create({
        data: { organizationId: orgId, species: 'AVICOLE', name: 'Cobb' },
      });
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, breedId: avicole.id })
        .expect(400);
      const future = await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, birthDate: daysAhead(3) })
        .expect(400);
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      const ok = await animal(headers, {
        category: 'COCHETTE',
        sireId: sire.id,
        damId: dam.id,
      });
      expect(ok).toMatchObject({
        sireId: sire.id,
        sireTag: sire.tag,
        damId: dam.id,
        damTag: dam.tag,
      });
      // sire must be a male, dam a female
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, sireId: dam.id })
        .expect(400);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, damId: sire.id })
        .expect(400);
      // parents of another farm
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const foreign = await animal(other.headers, {
        category: 'VERRAT',
        buildingId: bldB,
      });
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, sireId: foreign.id })
        .expect(400);
    });

    it('refuses unknown fields and an invalid category', async () => {
      const { headers } = await actor('RESP_PORCIN');
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'PORCELET', buildingId: bldA })
        .expect(400);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA, status: 'MORT' })
        .expect(400);
    });

    it('updates the editable fields, nulls the nullable ones and refuses category and sex', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sire = await animal(headers, { category: 'VERRAT' });
      const dam = await animal(headers);
      const a = await animal(headers, {
        category: 'COCHETTE',
        birthDate: '2025-06-01',
        sireId: sire.id,
      });
      const upd = await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ tag: 'CO-100', damId: dam.id, sireId: null, notes: 'x' })
        .expect(200);
      expect(upd.body).toMatchObject({
        tag: 'CO-100',
        damId: dam.id,
        sireId: null,
        notes: 'x',
        category: 'COCHETTE',
      });
      const cleared = await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ birthDate: null, notes: null, damId: null })
        .expect(200);
      expect(cleared.body).toMatchObject({
        birthDate: null,
        notes: null,
        damId: null,
      });
      for (const body of [
        { category: 'TRUIE' },
        { sex: 'M' },
        { status: 'MORT' },
        { tag: null },
        { buildingId: null },
        { sireId: dam.id },
        { damId: sire.id },
        { sireId: a.id },
        { damId: a.id },
        { birthDate: daysAhead(1) },
      ]) {
        await http()
          .patch(`/api/animals/${a.id}`)
          .set(headers)
          .send(body)
          .expect(400);
      }
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ tag: dam.tag })
        .expect(409);
    });

    it('checks the destination capacity when the building changes', async () => {
      const { headers } = await actor('RESP_PORCIN');
      await lot(headers, { buildingId: bldSmall, initialCount: 2 });
      const a = await animal(headers);
      const b = await animal(headers, { buildingId: bldSmall });
      const over = await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ buildingId: bldSmall })
        .expect(400);
      expect((over.body as Msg).message).toBe(
        'Capacité du bâtiment dépassée (4 / 3)',
      );
      expect(await occupation(headers, bldSmall)).toBe(3);
      await http()
        .patch(`/api/animals/${b.id}`)
        .set(headers)
        .send({ buildingId: bldA })
        .expect(200);
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ buildingId: bldSmall })
        .expect(200);
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ buildingId: bldB })
        .expect(400);
    });

    it('lists with filters and refuses bad ones', async () => {
      const { headers } = await actor('RESP_PORCIN');
      await animal(headers, { tag: 'TR-014' });
      await animal(headers, { category: 'VERRAT', tag: 'VR-007' });
      const sold = await animal(headers, { category: 'COCHETTE' });
      await http()
        .post(`/api/animals/${sold.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(200);
      const get = async (qs: string) =>
        (
          (await http().get(`/api/animals${qs}`).set(headers).expect(200))
            .body as Page<AnimalItem>
        ).items.map((i) => i.tag);
      expect(await get('')).toEqual(['CO-001', 'TR-014', 'VR-007']);
      expect(await get('?sex=F&status=ACTIF')).toEqual(['TR-014']);
      expect(await get('?sex=M')).toEqual(['VR-007']);
      expect(await get('?category=COCHETTE')).toEqual(['CO-001']);
      expect(await get('?status=VENDU')).toEqual(['CO-001']);
      expect(await get('?search=vr-0')).toEqual(['VR-007']);
      const item = (
        (await http().get('/api/animals').set(headers).expect(200))
          .body as Page<AnimalItem>
      ).items[0];
      expect(item).toMatchObject({
        tag: 'CO-001',
        category: 'COCHETTE',
        sex: 'F',
        status: 'VENDU',
        buildingName: 'Porcherie 1',
        breedName: null,
      });
      await http().get('/api/animals?sex=X').set(headers).expect(400);
      await http().get('/api/animals?status=NOPE').set(headers).expect(400);
      await http().get('/api/animals?category=NOPE').set(headers).expect(400);
    });

    it('deletes an animal without history and refuses one with history', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const clean = await animal(headers);
      await http().delete(`/api/animals/${clean.id}`).set(headers).expect(200);
      await http().get(`/api/animals/${clean.id}`).set(headers).expect(404);

      const weighed = await animal(headers);
      await http()
        .post(`/api/animals/${weighed.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(1), weightKg: 150 })
        .expect(201);
      await http()
        .delete(`/api/animals/${weighed.id}`)
        .set(headers)
        .expect(409);

      const parent = await animal(headers);
      await animal(headers, { damId: parent.id });
      await http().delete(`/api/animals/${parent.id}`).set(headers).expect(409);
    });
  });

  describe('weighings', () => {
    it('sets the latest weight as a number with one decimal', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const a = await animal(headers, { birthDate: '2025-01-01' });
      const w1 = await http()
        .post(`/api/animals/${a.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(10), weightKg: 142.5 })
        .expect(201);
      expect(w1.body).toMatchObject({
        animalId: a.id,
        date: daysAgo(10),
        weightKg: 142.5,
      });
      await http()
        .post(`/api/animals/${a.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(2), weightKg: 150 })
        .expect(201);
      await http()
        .post(`/api/animals/${a.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(5), weightKg: 147.3 })
        .expect(201);
      const got = await http()
        .get(`/api/animals/${a.id}`)
        .set(headers)
        .expect(200);
      expect((got.body as AnimalItem).weightKg).toBe(150);
      const list = await http()
        .get(`/api/animals/${a.id}/weighings`)
        .set(headers)
        .expect(200);
      const items = (list.body as Page<{ date: string; weightKg: number }>)
        .items;
      expect(items.map((i) => i.weightKg)).toEqual([150, 147.3, 142.5]);
    });

    it('rejects bad weights and dates', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const a = await animal(headers, { birthDate: daysAgo(100) });
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/animals/${a.id}/weighings`).set(headers).send(body);
      await post({ date: daysAgo(1), weightKg: 0 }).expect(400);
      await post({ date: daysAgo(1), weightKg: -3 }).expect(400);
      await post({ date: daysAgo(1), weightKg: 10.55 }).expect(400);
      await post({ date: daysAgo(1), weightKg: 10000 }).expect(400);
      await post({ date: 'nope', weightKg: 10 }).expect(400);
      const future = await post({ date: daysAhead(1), weightKg: 10 }).expect(
        400,
      );
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      await post({ date: daysAgo(101), weightKg: 10 }).expect(400);
    });

    it('404 for an animal of another farm', async () => {
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const foreign = await animal(other.headers, { buildingId: bldB });
      const { headers } = await actor('RESP_PORCIN');
      await http()
        .get(`/api/animals/${foreign.id}/weighings`)
        .set(headers)
        .expect(404);
      await http()
        .post(`/api/animals/${foreign.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(1), weightKg: 10 })
        .expect(404);
    });
  });

  describe('exit', () => {
    it('removes the animal from the building occupation and makes it read-only', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const a = await animal(headers);
      await animal(headers);
      expect(await occupation(headers, bldA)).toBe(2);
      const res = await http()
        .post(`/api/animals/${a.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'VENDU',
        exitDate: daysAgo(1),
        exitReason: 'VENDU',
      });
      expect(await occupation(headers, bldA)).toBe(1);
      const again = await http()
        .post(`/api/animals/${a.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'MORT' })
        .expect(409);
      expect((again.body as Msg).message).toBe(
        'Cet animal est sorti du cheptel',
      );
      for (const req of [
        http().patch(`/api/animals/${a.id}`).send({ notes: 'x' }),
        http()
          .post(`/api/animals/${a.id}/weighings`)
          .send({ date: daysAgo(1), weightKg: 10 }),
      ]) {
        const r = await req.set(headers).expect(409);
        expect((r.body as Msg).message).toBe('Cet animal est sorti du cheptel');
      }
    });

    it('validates the reason and the date', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const a = await animal(headers, { birthDate: daysAgo(50) });
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/animals/${a.id}/exit`).set(headers).send(body);
      await post({ date: daysAgo(1), reason: 'ACTIF' }).expect(400);
      await post({ date: daysAgo(1) }).expect(400);
      await post({ date: daysAhead(1), reason: 'MORT' }).expect(400);
      await post({ date: daysAgo(60), reason: 'MORT' }).expect(400);
      await post({ date: daysAgo(1), reason: 'REFORME' }).expect(200);
    });

    it('frees the capacity for a new animal', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const full = [
        await animal(headers, { buildingId: bldSmall }),
        await animal(headers, { buildingId: bldSmall }),
        await animal(headers, { buildingId: bldSmall }),
      ];
      const over = await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldSmall })
        .expect(400);
      expect((over.body as Msg).message).toBe(
        'Capacité du bâtiment dépassée (4 / 3)',
      );
      await http()
        .post(`/api/animals/${full[0].id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'MORT' })
        .expect(200);
      await animal(headers, { buildingId: bldSmall });
    });
  });

  describe('pig herd list', () => {
    it('mixes animals and pig lots with headcounts and status counts', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const breed = await prisma.breed.create({
        data: { organizationId: orgId, species: 'PORCIN', name: 'Large White' },
      });
      const sow = await animal(headers, {
        tag: 'TR-014',
        breedId: breed.id,
        birthDate: '2025-01-10',
      });
      await animal(headers, { category: 'VERRAT', tag: 'VR-002' });
      const l = await lot(headers);
      await http()
        .post(`/api/animals/${sow.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(1), weightKg: 201.5 })
        .expect(201);
      const res = await http().get('/api/pig-herd').set(headers).expect(200);
      const body = res.body as Page<HerdRow> & {
        statusCounts: Record<string, number>;
      };
      expect(body.total).toBe(3);
      const rows = body.items;
      expect(rows.map((r) => r.identifier)).toEqual([
        'LOT-ENG-01',
        'TR-014',
        'VR-002',
      ]);
      expect(rows.map((r) => r.headcount)).toEqual([240, 1, 1]);
      expect(rows.reduce((s, r) => s + r.headcount, 0)).toBe(242);
      expect(rows[0]).toMatchObject({
        kind: 'LOT',
        id: l.id,
        category: 'Engraissement',
        buildingName: 'Porcherie 1',
        entryDate: daysAgo(20),
        status: 'EN_COURS',
      });
      expect(rows[1]).toMatchObject({
        kind: 'ANIMAL',
        id: sow.id,
        category: 'Truie',
        breedName: 'Large White',
        birthDate: '2025-01-10',
        weightKg: 201.5,
        status: 'ACTIF',
      });
      expect(rows[2].category).toBe('Verrat');
      expect(new Set(rows.map((r) => r.id)).size).toBe(3);
      expect(body.statusCounts).toEqual({
        ACTIF: 3,
        GESTANTE: 0,
        ALLAITANTE: 0,
        VENDU: 0,
        MORT: 0,
        REFORME: 0,
        CLOTURE: 0,
      });
    });

    it('filters by status, category and search; counts ignore the filters', async () => {
      const { headers } = await actor('RESP_PORCIN');
      await animal(headers, { tag: 'TR-014' });
      const boar = await animal(headers, { category: 'VERRAT' });
      await animal(headers, { category: 'COCHETTE' });
      const fat = await lot(headers);
      await lot(headers, { type: 'PORCELET', initialCount: 30 });
      // A lot is closed once its animals have left.
      await http()
        .post(`/api/batches/${fat.id}/events`)
        .set(headers)
        .send({ type: 'VENTE', date: daysAgo(1), quantity: 240 })
        .expect(201);
      await http()
        .post(`/api/batches/${fat.id}/close`)
        .set(headers)
        .expect(200);
      await http()
        .post(`/api/animals/${boar.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'MORT' })
        .expect(200);
      const get = async (qs: string) =>
        (await http().get(`/api/pig-herd${qs}`).set(headers).expect(200))
          .body as Page<HerdRow> & { statusCounts: Record<string, number> };
      expect(
        (await get('?status=ACTIF')).items.map((i) => i.identifier),
      ).toEqual([
        'CO-001',
        'PO-' + new Date().getUTCFullYear() + '-01',
        'TR-014',
      ]);
      expect(
        (await get('?status=CLOTURE')).items.map((i) => i.identifier),
      ).toEqual(['LOT-ENG-01']);
      expect(
        (await get('?status=MORT')).items.map((i) => i.identifier),
      ).toEqual(['VR-001']);
      expect(
        (await get('?category=Verrat')).items.map((i) => i.identifier),
      ).toEqual(['VR-001']);
      expect(
        (await get('?category=TRUIE')).items.map((i) => i.identifier),
      ).toEqual(['TR-014']);
      expect(
        (await get('?category=Porcelets')).items.map((i) => i.category),
      ).toEqual(['Porcelets']);
      expect(
        (await get('?search=lot-eng')).items.map((i) => i.identifier),
      ).toEqual(['LOT-ENG-01']);
      const filtered = await get('?search=tr-0');
      expect(filtered.total).toBe(1);
      expect(filtered.statusCounts).toEqual({
        ACTIF: 3,
        GESTANTE: 0,
        ALLAITANTE: 0,
        VENDU: 0,
        MORT: 1,
        REFORME: 0,
        CLOTURE: 1,
      });
      await http().get('/api/pig-herd?status=NOPE').set(headers).expect(400);
      const bad = await http()
        .get('/api/pig-herd?category=NOPE')
        .set(headers)
        .expect(400);
      expect((bad.body as Msg).message).toBe('Catégorie invalide');
    });

    it('does not list avian lots or other farms and exports CSV', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await animal(headers, { tag: 'TR-014' });
      await http()
        .post('/api/batches')
        .set(headers)
        .send({
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: bldPoultry,
          entryDate: daysAgo(5),
          initialCount: 10,
        })
        .expect(201);
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      await animal(other.headers, { buildingId: bldB, tag: 'TR-099' });
      const res = await http().get('/api/pig-herd').set(headers).expect(200);
      expect(
        (res.body as Page<HerdRow>).items.map((i) => i.identifier),
      ).toEqual(['TR-014']);
      const csv = await http()
        .get('/api/pig-herd?format=csv')
        .set(headers)
        .expect(200);
      const lines = csv.text.split('\r\n');
      expect(lines[0]).toBe(
        '\uFEFFIdentifiant;Catégorie;Race;Bâtiment;Date de naissance;Poids (kg);Statut',
      );
      expect(lines[1]).toBe('TR-014;Truie;;Porcherie 1;;;Actif');
    });
  });

  describe('occupation and buildings', () => {
    it('counts animals and lots in the building occupation and capacity check', async () => {
      const { headers } = await actor('RESP_PORCIN');
      await lot(headers, { buildingId: bldSmall, initialCount: 2 });
      await animal(headers, { buildingId: bldSmall });
      expect(await occupation(headers, bldSmall)).toBe(3);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'VERRAT', buildingId: bldSmall })
        .expect(400);
      await http()
        .post('/api/batches')
        .set(headers)
        .send({
          species: 'PORCIN',
          type: 'PORCELET',
          buildingId: bldSmall,
          entryDate: daysAgo(1),
          initialCount: 1,
        })
        .expect(400);
    });

    it('keeps a building housing animals from being deleted or shrunk', async () => {
      const dir = await actor('DIRECTEUR_FERME');
      const admin = await actor('SUPER_ADMIN');
      await animal(dir.headers, { buildingId: bldSmall });
      await animal(dir.headers, { buildingId: bldSmall });
      await http()
        .delete(`/api/buildings/${bldSmall}`)
        .set(admin.headers)
        .expect(409);
      await http()
        .patch(`/api/buildings/${bldSmall}`)
        .set(admin.headers)
        .send({ capacity: 1 })
        .expect(400);
    });
  });

  describe('permissions and scoping', () => {
    it('404 for an animal of another farm on every route', async () => {
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const foreign = await animal(other.headers, { buildingId: bldB });
      const { headers } = await actor('RESP_PORCIN');
      await http().get(`/api/animals/${foreign.id}`).set(headers).expect(404);
      await http()
        .patch(`/api/animals/${foreign.id}`)
        .set(headers)
        .send({ notes: 'x' })
        .expect(404);
      await http()
        .delete(`/api/animals/${foreign.id}`)
        .set(headers)
        .expect(404);
      await http()
        .post(`/api/animals/${foreign.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'MORT' })
        .expect(404);
      const list = await http().get('/api/animals').set(headers).expect(200);
      expect((list.body as Page<AnimalItem>).total).toBe(0);
    });

    it('refuses RESP_AVICOLE on animals and the pig herd, and lets read-only roles read', async () => {
      const { headers } = await actor('RESP_AVICOLE');
      await http().get('/api/animals').set(headers).expect(403);
      await http().get('/api/pig-herd').set(headers).expect(403);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldA })
        .expect(403);
      const porcin = await actor('RESP_PORCIN');
      const a = await animal(porcin.headers);
      const vet = await actor('VETERINAIRE');
      await http().get('/api/animals').set(vet.headers).expect(200);
      await http().get('/api/pig-herd').set(vet.headers).expect(200);
      await http().get(`/api/animals/${a.id}`).set(vet.headers).expect(200);
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(vet.headers)
        .send({ notes: 'x' })
        .expect(403);
      await http().delete(`/api/animals/${a.id}`).set(vet.headers).expect(403);
      // Master data needs `update`: a field agent (read, create) cannot create an animal.
      const agent = await actor('AGENT_ELEVAGE');
      await http()
        .post('/api/animals')
        .set(agent.headers)
        .send({ category: 'TRUIE', buildingId: bldA })
        .expect(403);
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(agent.headers)
        .send({ notes: 'x' })
        .expect(403);
    });

    it('uses the porcs module for pig batches: RESP_AVICOLE is refused, RESP_PORCIN allowed', async () => {
      const avicole = await actor('RESP_AVICOLE');
      await http()
        .post('/api/batches')
        .set(avicole.headers)
        .send({
          species: 'PORCIN',
          type: 'ENGRAISSEMENT',
          buildingId: bldA,
          entryDate: daysAgo(1),
          initialCount: 10,
        })
        .expect(403);
      const porcin = await actor('RESP_PORCIN');
      const l = await lot(porcin.headers, { initialCount: 10 });
      const got = await http()
        .get(`/api/batches/${l.id}`)
        .set(porcin.headers)
        .expect(200);
      expect(got.body).toMatchObject({ species: 'PORCIN', alive: 10 });
      await http().get(`/api/batches/${l.id}`).set(avicole.headers).expect(403);
      const poultry = await http()
        .post('/api/batches')
        .set(avicole.headers)
        .send({
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: bldPoultry,
          entryDate: daysAgo(1),
          initialCount: 10,
        })
        .expect(201);
      await http()
        .get(`/api/batches/${(poultry.body as { id: string }).id}`)
        .set(porcin.headers)
        .expect(403);
      // pig batch codes
      expect(l.code).toBe('LOT-ENG-01');
      const piglets = await lot(porcin.headers, {
        type: 'PORCELET',
        initialCount: 5,
      });
      expect(piglets.code).toBe(`PO-${new Date().getUTCFullYear()}-01`);
    });
  });

  describe('audit', () => {
    it('writes exactly one row per write, in the porcs module', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const a = await animal(headers);
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ notes: 'x' })
        .expect(200);
      await http()
        .post(`/api/animals/${a.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(1), weightKg: 100 })
        .expect(201);
      await http()
        .post(`/api/animals/${a.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(200);
      const b = await animal(headers);
      await http().delete(`/api/animals/${b.id}`).set(headers).expect(200);
      // failed writes leave nothing behind
      await http()
        .patch(`/api/animals/${a.id}`)
        .set(headers)
        .send({ notes: 'y' })
        .expect(409);
      await http()
        .post('/api/animals')
        .set(headers)
        .send({ category: 'TRUIE', buildingId: bldB })
        .expect(400);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'porcs' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'CREATE',
        'UPDATE',
        'CREATE',
        'DELETE',
      ]);
      expect(rows[0]).toMatchObject({
        recordId: a.id,
        label: a.tag,
        farmId: farmA,
      });
      expect(rows[3]).toMatchObject({ recordId: a.id });
    });
  });
});
