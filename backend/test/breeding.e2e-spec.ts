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

interface BreedingItem {
  id: string;
  sowId: string;
  sowTag: string;
  sire: string;
  method: string;
  serviceDate: string;
  expectedFarrowingDate: string;
  farrowingDate: string | null;
  bornTotal: number | null;
  bornAlive: number | null;
  stillborn: number | null;
  litterBatchId: string | null;
  weaningDate: string | null;
  weanedCount: number | null;
  status: string;
  daysToFarrowing: number | null;
}
interface AnimalItem {
  id: string;
  tag: string;
  category: string;
  status: string;
}
interface BatchItem {
  id: string;
  code: string;
  type: string;
  species: string;
  initialCount: number;
  alive: number;
  entryDate: string;
  motherAnimalId: string | null;
  buildingId: string;
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
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(a) - Date.parse(b)) / DAY_MS);

describe('Breeding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let bldA: string; // capacity 500
  let bldSmall: string; // capacity 5
  let bldB: string;

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
    ) =>
      prisma.building
        .create({ data: { farmId, siteId, name, type: 'PORCIN', capacity } })
        .then((b) => b.id);
    bldA = await mk(farmA, siteA.id, 'Maternité', 500);
    bldSmall = await mk(farmA, siteA.id, 'Petite loge', 5);
    bldB = await mk(farmB, siteB.id, 'Maternité B', 500);
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
  const getAnimal = async (headers: Record<string, string>, id: string) =>
    (await http().get(`/api/animals/${id}`).set(headers).expect(200))
      .body as AnimalItem;

  async function serve(
    headers: Record<string, string>,
    sowId: string,
    boarId: string,
    over: Record<string, unknown> = {},
  ): Promise<BreedingItem> {
    const res = await http()
      .post('/api/breeding')
      .set(headers)
      .send({
        sowId,
        method: 'SAILLIE',
        boarId,
        serviceDate: daysAgo(120),
        ...over,
      })
      .expect(201);
    return res.body as BreedingItem;
  }

  const farrow = (
    headers: Record<string, string>,
    id: string,
    over: Record<string, unknown> = {},
  ) =>
    http()
      .post(`/api/breeding/${id}/farrowing`)
      .set(headers)
      .send({
        date: daysAgo(5),
        bornTotal: 13,
        bornAlive: 12,
        stillborn: 1,
        buildingId: bldA,
        ...over,
      });

  async function pair(headers: Record<string, string>) {
    const sow = await animal(headers);
    const boar = await animal(headers, { category: 'VERRAT' });
    return { sow, boar };
  }

  describe('saillie', () => {
    it('computes the expected farrowing date from gestationDays and puts the sow in GESTANTE', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id, {
        serviceDate: '2026-07-05',
      });
      expect(rec).toMatchObject({
        sowId: sow.id,
        sowTag: sow.tag,
        sire: boar.tag,
        method: 'SAILLIE',
        serviceDate: '2026-07-05',
        expectedFarrowingDate: '2026-10-27',
        farrowingDate: null,
        bornTotal: null,
        bornAlive: null,
        weanedCount: null,
        litterBatchId: null,
        status: 'GESTATION',
      });
      expect(rec.daysToFarrowing).toBe(
        dayDiff('2026-10-27', new Date().toISOString().slice(0, 10)),
      );
      expect(rec.daysToFarrowing).toBeLessThan(0);
      expect((await getAnimal(headers, sow.id)).status).toBe('GESTANTE');
    });

    it('uses the gestationDays setting at creation only, and again on a serviceDate change', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const s1 = await animal(headers);
      const s2 = await animal(headers);
      const boar = await animal(headers, { category: 'VERRAT' });
      const first = await serve(headers, s1.id, boar.id, {
        serviceDate: '2026-07-05',
      });
      await prisma.setting.upsert({
        where: {
          organizationId_key: { organizationId: orgId, key: 'gestationDays' },
        },
        update: { value: 115 },
        create: { organizationId: orgId, key: 'gestationDays', value: 115 },
      });
      const second = await serve(headers, s2.id, boar.id, {
        serviceDate: '2026-07-05',
      });
      expect(second.expectedFarrowingDate).toBe('2026-10-28');
      const list = await http().get('/api/breeding').set(headers).expect(200);
      const byId = new Map(
        (list.body as Page<BreedingItem>).items.map((i) => [i.id, i]),
      );
      expect(byId.get(first.id)?.expectedFarrowingDate).toBe('2026-10-27');
      const moved = await http()
        .patch(`/api/breeding/${first.id}`)
        .set(headers)
        .send({ serviceDate: '2026-07-10' })
        .expect(200);
      expect(moved.body).toMatchObject({
        serviceDate: '2026-07-10',
        expectedFarrowingDate: '2026-11-02',
      });
    });

    it('records an insemination with the semen label', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sow = await animal(headers);
      const rec = await http()
        .post('/api/breeding')
        .set(headers)
        .send({
          sowId: sow.id,
          method: 'IA',
          semenLabel: 'PIC 408',
          serviceDate: daysAgo(3),
        })
        .expect(201);
      expect(rec.body).toMatchObject({
        method: 'IA',
        sire: 'IA PIC 408',
        status: 'GESTATION',
      });
      expect((rec.body as BreedingItem).daysToFarrowing).toBeGreaterThan(100);
    });

    it('validates the body', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const post = (body: Record<string, unknown>) =>
        http().post('/api/breeding').set(headers).send(body);
      const base = {
        sowId: sow.id,
        method: 'SAILLIE',
        boarId: boar.id,
        serviceDate: daysAgo(2),
      };
      await post({ ...base, boarId: undefined }).expect(400);
      await post({ ...base, method: 'IA', boarId: undefined }).expect(400);
      await post({ ...base, method: 'XX' }).expect(400);
      await post({ ...base, serviceDate: 'nope' }).expect(400);
      await post({ ...base, status: 'GESTATION' }).expect(400);
      const future = await post({ ...base, serviceDate: daysAhead(2) }).expect(
        400,
      );
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      const young = await animal(headers, { birthDate: daysAgo(30) });
      await post({ ...base, sowId: young.id, serviceDate: daysAgo(60) }).expect(
        400,
      );
    });

    it('refuses a male sow, a foreign sow, a bad boar, and a sow that is already pregnant or nursing', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const post = (body: Record<string, unknown>) =>
        http().post('/api/breeding').set(headers).send(body);
      const base = { method: 'SAILLIE', serviceDate: daysAgo(2) };
      await post({ ...base, sowId: boar.id, boarId: boar.id }).expect(400);
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const foreignSow = await animal(other.headers, { buildingId: bldB });
      const foreignBoar = await animal(other.headers, {
        category: 'VERRAT',
        buildingId: bldB,
      });
      await post({ ...base, sowId: foreignSow.id, boarId: boar.id }).expect(
        400,
      );
      await post({ ...base, sowId: sow.id, boarId: foreignBoar.id }).expect(
        400,
      );
      await post({ ...base, sowId: sow.id, boarId: 'nope' }).expect(400);
      const female = await animal(headers);
      await post({ ...base, sowId: sow.id, boarId: female.id }).expect(400);
      const gone = await animal(headers, { category: 'VERRAT' });
      await http()
        .post(`/api/animals/${gone.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'REFORME' })
        .expect(200);
      await post({ ...base, sowId: sow.id, boarId: gone.id }).expect(400);

      await post({ ...base, sowId: sow.id, boarId: boar.id }).expect(201);
      const dup = await post({
        ...base,
        sowId: sow.id,
        boarId: boar.id,
      }).expect(409);
      expect((dup.body as Msg).message).toBe(
        'Cette truie est déjà gestante ou allaitante',
      );
      const sold = await animal(headers);
      await http()
        .post(`/api/animals/${sold.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(200);
      await post({ ...base, sowId: sold.id, boarId: boar.id }).expect(409);
    });

    it('lets only one of two simultaneous services on the same sow through', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const results = await Promise.all(
        [0, 1].map(() =>
          http()
            .post('/api/breeding')
            .set(headers)
            .send({
              sowId: sow.id,
              method: 'SAILLIE',
              boarId: boar.id,
              serviceDate: daysAgo(2),
            }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  describe('update and delete', () => {
    it('changes the service date only while in gestation', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({ serviceDate: daysAhead(1) })
        .expect(400);
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({ boarId: boar.id })
        .expect(400);
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({})
        .expect(400);
      await farrow(headers, rec.id).expect(200);
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({ serviceDate: daysAgo(119) })
        .expect(409);
    });

    it('deletes a gestation record and frees the sow; refuses once farrowed', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await http().delete(`/api/breeding/${rec.id}`).set(headers).expect(200);
      expect((await getAnimal(headers, sow.id)).status).toBe('ACTIF');
      expect(
        (
          (await http().get('/api/breeding').set(headers).expect(200))
            .body as Page<BreedingItem>
        ).total,
      ).toBe(0);
      const again = await serve(headers, sow.id, boar.id);
      await farrow(headers, again.id).expect(200);
      await http().delete(`/api/breeding/${again.id}`).set(headers).expect(409);
    });

    it('404 for another farm record', async () => {
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const sow = await animal(other.headers, { buildingId: bldB });
      const boar = await animal(other.headers, {
        category: 'VERRAT',
        buildingId: bldB,
      });
      const rec = await serve(other.headers, sow.id, boar.id);
      const { headers } = await actor('RESP_PORCIN');
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({ serviceDate: daysAgo(1) })
        .expect(404);
      await http().delete(`/api/breeding/${rec.id}`).set(headers).expect(404);
      await farrow(headers, rec.id).expect(404);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 0 })
        .expect(404);
      await http()
        .post(`/api/breeding/${rec.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(1) })
        .expect(404);
    });
  });

  describe('farrowing', () => {
    it('validates dates and counts', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(110),
      });
      await farrow(headers, rec.id, { date: daysAgo(111) }).expect(400);
      const future = await farrow(headers, rec.id, {
        date: daysAhead(1),
      }).expect(400);
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      await farrow(headers, rec.id, {
        bornAlive: 12,
        stillborn: 2,
        bornTotal: 13,
      }).expect(400);
      await farrow(headers, rec.id, { bornAlive: -1 }).expect(400);
      await farrow(headers, rec.id, { bornTotal: 1.5 }).expect(400);
      await farrow(headers, rec.id, { buildingId: bldB }).expect(400);
      await farrow(headers, rec.id, { buildingId: undefined }).expect(400);
      expect((await getAnimal(headers, sow.id)).status).toBe('GESTANTE');
    });

    it('creates the piglet batch linked to the sow and sets the sow ALLAITANTE', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const res = await farrow(headers, rec.id).expect(200);
      const item = res.body as BreedingItem;
      expect(item).toMatchObject({
        id: rec.id,
        status: 'MISE_BAS',
        farrowingDate: daysAgo(5),
        bornTotal: 13,
        bornAlive: 12,
        stillborn: 1,
        daysToFarrowing: null,
      });
      expect(item.litterBatchId).toEqual(expect.any(String));
      const batch = (
        await http()
          .get(`/api/batches/${item.litterBatchId}`)
          .set(headers)
          .expect(200)
      ).body as BatchItem;
      expect(batch).toMatchObject({
        species: 'PORCIN',
        type: 'PORCELET',
        code: `PO-${new Date().getUTCFullYear()}-01`,
        entryDate: daysAgo(5),
        initialCount: 12,
        alive: 12,
        motherAnimalId: sow.id,
        buildingId: bldA,
      });
      expect((await getAnimal(headers, sow.id)).status).toBe('ALLAITANTE');
      const again = await farrow(headers, rec.id).expect(409);
      expect((again.body as Msg).message).toBe(
        'Cette étape a déjà été enregistrée',
      );
    });

    it('turns a cochette into a truie at her first farrowing', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const gilt = await animal(headers, { category: 'COCHETTE' });
      const boar = await animal(headers, { category: 'VERRAT' });
      const rec = await serve(headers, gilt.id, boar.id);
      expect((await getAnimal(headers, gilt.id)).category).toBe('COCHETTE');
      await farrow(headers, rec.id).expect(200);
      expect(await getAnimal(headers, gilt.id)).toMatchObject({
        category: 'TRUIE',
        tag: gilt.tag,
        status: 'ALLAITANTE',
      });
    });

    it('creates no batch when no piglet is born alive', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const res = await farrow(headers, rec.id, {
        bornTotal: 4,
        bornAlive: 0,
        stillborn: 4,
        buildingId: undefined,
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'MISE_BAS',
        bornAlive: 0,
        litterBatchId: null,
      });
      expect(await prisma.animalBatch.count()).toBe(0);
      expect((await getAnimal(headers, sow.id)).status).toBe('ALLAITANTE');
      const bad = await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 1 })
        .expect(400);
      expect(typeof (bad.body as Msg).message).toBe('string');
      const ok = await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 0 })
        .expect(200);
      expect(ok.body).toMatchObject({ status: 'SEVRAGE', weanedCount: 0 });
      expect((await getAnimal(headers, sow.id)).status).toBe('ACTIF');
    });

    it('writes nothing when the building lacks capacity', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const res = await farrow(headers, rec.id, {
        buildingId: bldSmall,
      }).expect(400);
      expect((res.body as Msg).message).toBe(
        'Capacité du bâtiment dépassée (12 / 5)',
      );
      expect(await prisma.animalBatch.count()).toBe(0);
      expect((await getAnimal(headers, sow.id)).status).toBe('GESTANTE');
      const list = await http().get('/api/breeding').set(headers).expect(200);
      expect((list.body as Page<BreedingItem>).items[0]).toMatchObject({
        status: 'GESTATION',
        bornAlive: null,
      });
      expect(await prisma.auditLog.count({ where: { action: 'UPDATE' } })).toBe(
        0,
      );
    });

    it('lets only one of two simultaneous farrowings through', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const results = await Promise.all([
        farrow(headers, rec.id),
        farrow(headers, rec.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 409);
      expect((loser?.body as Msg).message).toBe(
        'Cette étape a déjà été enregistrée',
      );
      expect(await prisma.animalBatch.count()).toBe(1);
      expect(
        await prisma.auditLog.count({ where: { module: 'reproduction' } }),
      ).toBe(2);
    });
  });

  describe('weaning', () => {
    async function farrowed(headers: Record<string, string>) {
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const farrowed = (await farrow(headers, rec.id).expect(200))
        .body as BreedingItem;
      return { sow, boar, rec: farrowed };
    }

    it('weans 11 of 12: SEVRAGE, sow ACTIF, the difference recorded as a death', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, rec } = await farrowed(headers);
      const res = await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 11 })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'SEVRAGE',
        weaningDate: daysAgo(1),
        weanedCount: 11,
      });
      expect((await getAnimal(headers, sow.id)).status).toBe('ACTIF');
      const batch = (
        await http()
          .get(`/api/batches/${rec.litterBatchId}`)
          .set(headers)
          .expect(200)
      ).body as BatchItem;
      expect(batch.alive).toBe(11);
      const events = await prisma.batchEvent.findMany({
        where: { batchId: rec.litterBatchId! },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'MORTALITE',
        quantity: 1,
        cause: 'Écart au sevrage',
        date: new Date(daysAgo(1)),
      });
      const again = await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 11 })
        .expect(409);
      expect((again.body as Msg).message).toBe(
        'Cette étape a déjà été enregistrée',
      );
    });

    it('records no death when every piglet is weaned', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { rec } = await farrowed(headers);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 12 })
        .expect(200);
      expect(await prisma.batchEvent.count()).toBe(0);
    });

    it('takes earlier deaths of the litter into account', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { rec } = await farrowed(headers);
      await http()
        .post(`/api/batches/${rec.litterBatchId}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(3), quantity: 2 })
        .expect(201);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 11 })
        .expect(400);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 10 })
        .expect(200);
      expect(await prisma.batchEvent.count()).toBe(1);
    });

    it('rejects too many weaned, an early or future date and a record that is not nursing', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { rec } = await farrowed(headers);
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/breeding/${rec.id}/weaning`).set(headers).send(body);
      await post({ date: daysAgo(1), weanedCount: 13 }).expect(400);
      await post({ date: daysAgo(1), weanedCount: -1 }).expect(400);
      await post({ date: daysAgo(6), weanedCount: 10 }).expect(400);
      await post({ date: daysAhead(1), weanedCount: 10 }).expect(400);
      expect(await prisma.batchEvent.count()).toBe(0);

      const { sow, boar } = await pair(headers);
      const pending = await serve(headers, sow.id, boar.id);
      await http()
        .post(`/api/breeding/${pending.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 1 })
        .expect(409);
    });
  });

  describe('fail', () => {
    it('marks the record ECHEC and frees the sow', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/breeding/${rec.id}/fail`).set(headers).send(body);
      await post({ date: daysAhead(1) }).expect(400);
      await post({ date: daysAgo(121) }).expect(400);
      const res = await post({
        date: daysAgo(2),
        note: 'Retour en chaleur',
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'ECHEC' });
      expect((await getAnimal(headers, sow.id)).status).toBe('ACTIF');
      await post({ date: daysAgo(2) }).expect(409);
      await serve(headers, sow.id, boar.id, { serviceDate: daysAgo(1) });
    });

    it('is refused once the sow has farrowed', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await farrow(headers, rec.id).expect(200);
      await http()
        .post(`/api/breeding/${rec.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(1) })
        .expect(409);
      expect((await getAnimal(headers, sow.id)).status).toBe('ALLAITANTE');
    });
  });

  describe('animal exit', () => {
    it('refuses a sale or culling while pregnant or nursing, allows death', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      for (const reason of ['VENDU', 'REFORME']) {
        const res = await http()
          .post(`/api/animals/${sow.id}/exit`)
          .set(headers)
          .send({ date: daysAgo(1), reason })
          .expect(409);
        expect((res.body as Msg).message).toBe(
          'Cette truie est gestante ou allaitante',
        );
      }
      await farrow(headers, rec.id).expect(200);
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(409);
    });

    it('marks an open gestation ECHEC when the sow dies', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      await serve(headers, sow.id, boar.id);
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'MORT' })
        .expect(200);
      const list = await http().get('/api/breeding').set(headers).expect(200);
      expect((list.body as Page<BreedingItem>).items[0]).toMatchObject({
        status: 'ECHEC',
        daysToFarrowing: null,
      });
      expect((await getAnimal(headers, sow.id)).status).toBe('MORT');
    });

    it('keeps a nursing litter weanable when the sow dies, and the sow stays dead', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await farrow(headers, rec.id).expect(200);
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(1), reason: 'MORT' })
        .expect(200);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 12 })
        .expect(200);
      expect((await getAnimal(headers, sow.id)).status).toBe('MORT');
    });

    it('refuses to delete an animal with breeding records', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await http().delete(`/api/breeding/${rec.id}`).set(headers).expect(200);
      const again = await serve(headers, sow.id, boar.id);
      await http()
        .post(`/api/breeding/${again.id}/fail`)
        .set(headers)
        .send({
          date: daysAgo(1),
        })
        .expect(200);
      await http().delete(`/api/animals/${sow.id}`).set(headers).expect(409);
      await http().delete(`/api/animals/${boar.id}`).set(headers).expect(409);
    });
  });

  describe('heats', () => {
    it('records, lists and deletes heats of a female', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sow = await animal(headers, { birthDate: daysAgo(400) });
      const h1 = await http()
        .post(`/api/animals/${sow.id}/heats`)
        .set(headers)
        .send({ date: daysAgo(21), note: 'Chaleur nette' })
        .expect(201);
      expect(h1.body).toMatchObject({
        date: daysAgo(21),
        note: 'Chaleur nette',
      });
      await http()
        .post(`/api/animals/${sow.id}/heats`)
        .set(headers)
        .send({ date: daysAgo(2) })
        .expect(201);
      const list = await http()
        .get(`/api/animals/${sow.id}/heats`)
        .set(headers)
        .expect(200);
      const items = (
        list.body as Page<{ id: string; date: string; note: string | null }>
      ).items;
      expect(items.map((i) => i.date)).toEqual([daysAgo(2), daysAgo(21)]);
      expect(items[0].note).toBeNull();
      await http()
        .delete(`/api/animals/${sow.id}/heats/${items[1].id}`)
        .set(headers)
        .expect(200);
      await http()
        .delete(`/api/animals/${sow.id}/heats/${items[1].id}`)
        .set(headers)
        .expect(404);
      expect(
        (
          (
            await http()
              .get(`/api/animals/${sow.id}/heats`)
              .set(headers)
              .expect(200)
          ).body as Page<unknown>
        ).total,
      ).toBe(1);
    });

    it('validates the animal and the date', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sow = await animal(headers, { birthDate: daysAgo(100) });
      const boar = await animal(headers, { category: 'VERRAT' });
      const post = (id: string, body: Record<string, unknown>) =>
        http().post(`/api/animals/${id}/heats`).set(headers).send(body);
      await post(boar.id, { date: daysAgo(1) }).expect(400);
      await post(sow.id, { date: daysAhead(1) }).expect(400);
      await post(sow.id, { date: daysAgo(101) }).expect(400);
      await post(sow.id, { date: 'nope' }).expect(400);
      await post(sow.id, { date: daysAgo(1), note: 5 }).expect(400);
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const foreign = await animal(other.headers, { buildingId: bldB });
      await post(foreign.id, { date: daysAgo(1) }).expect(404);
      await http()
        .get(`/api/animals/${foreign.id}/heats`)
        .set(headers)
        .expect(404);
    });

    it('uses the reproduction permission', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sow = await animal(headers);
      const vet = await actor('VETERINAIRE');
      await http()
        .get(`/api/animals/${sow.id}/heats`)
        .set(vet.headers)
        .expect(200);
      await http()
        .post(`/api/animals/${sow.id}/heats`)
        .set(vet.headers)
        .send({ date: daysAgo(1) })
        .expect(403);
      const agent = await actor('AGENT_ELEVAGE');
      await http()
        .get(`/api/animals/${sow.id}/heats`)
        .set(agent.headers)
        .expect(403);
    });
  });

  describe('breeding history', () => {
    it('lists the sow records with litter figures and the averages', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sow = await animal(headers);
      const boar = await animal(headers, { category: 'VERRAT' });
      const empty = await http()
        .get(`/api/animals/${sow.id}/breeding-history`)
        .set(headers)
        .expect(200);
      expect(empty.body).toMatchObject({
        records: [],
        totals: { litters: 0, averageBornAlive: null, averageWeaned: null },
      });

      const r1 = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(400),
      });
      await farrow(headers, r1.id, {
        date: daysAgo(290),
        bornTotal: 12,
        bornAlive: 11,
        stillborn: 1,
      }).expect(200);
      await http()
        .post(`/api/breeding/${r1.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(262), weanedCount: 10 })
        .expect(200);
      const r2 = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(250),
      });
      await farrow(headers, r2.id, {
        date: daysAgo(136),
        bornTotal: 13,
        bornAlive: 12,
        stillborn: 1,
      }).expect(200);
      await http()
        .post(`/api/breeding/${r2.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(108), weanedCount: 9 })
        .expect(200);
      const r3 = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(100),
      });
      await http()
        .post(`/api/breeding/${r3.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(80) })
        .expect(200);
      await serve(headers, sow.id, boar.id, { serviceDate: daysAgo(30) });

      const res = await http()
        .get(`/api/animals/${sow.id}/breeding-history`)
        .set(headers)
        .expect(200);
      const body = res.body as {
        records: BreedingItem[];
        totals: Record<string, number | null>;
      };
      expect(body.records.map((r) => r.status)).toEqual([
        'GESTATION',
        'ECHEC',
        'SEVRAGE',
        'SEVRAGE',
      ]);
      expect(body.records[2]).toMatchObject({
        id: r2.id,
        sire: boar.tag,
        farrowingDate: daysAgo(136),
        bornTotal: 13,
        bornAlive: 12,
        weanedCount: 9,
      });
      expect(body.totals).toEqual({
        litters: 2,
        averageBornAlive: 11.5,
        averageWeaned: 9.5,
      });
      expect(body).not.toHaveProperty('items');
    });

    it('averages with one decimal and ignores litters still nursing for the weaned figure', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const sow = await animal(headers);
      const boar = await animal(headers, { category: 'VERRAT' });
      const r1 = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(300),
      });
      await farrow(headers, r1.id, {
        date: daysAgo(186),
        bornTotal: 10,
        bornAlive: 10,
        stillborn: 0,
      }).expect(200);
      await http()
        .post(`/api/breeding/${r1.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(160), weanedCount: 9 })
        .expect(200);
      const r2 = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(140),
      });
      await farrow(headers, r2.id, {
        date: daysAgo(26),
        bornTotal: 11,
        bornAlive: 11,
        stillborn: 0,
      }).expect(200);
      const res = await http()
        .get(`/api/animals/${sow.id}/breeding-history`)
        .set(headers)
        .expect(200);
      expect((res.body as { totals: unknown }).totals).toEqual({
        litters: 2,
        averageBornAlive: 10.5,
        averageWeaned: 9,
      });
    });

    it('404 for an animal of another farm', async () => {
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const foreign = await animal(other.headers, { buildingId: bldB });
      const { headers } = await actor('RESP_PORCIN');
      await http()
        .get(`/api/animals/${foreign.id}/breeding-history`)
        .set(headers)
        .expect(404);
    });
  });

  describe('list', () => {
    it('filters by status, searches the sow tag, and counts every status', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const boar = await animal(headers, { category: 'VERRAT' });
      const s1 = await animal(headers, { tag: 'TR-014' });
      const s2 = await animal(headers, { tag: 'TR-020' });
      const s3 = await animal(headers, { tag: 'TR-030' });
      const r1 = await serve(headers, s1.id, boar.id, {
        serviceDate: daysAgo(10),
      });
      const r2 = await serve(headers, s2.id, boar.id, {
        serviceDate: daysAgo(130),
      });
      await farrow(headers, r2.id, { date: daysAgo(16) }).expect(200);
      const r3 = await serve(headers, s3.id, boar.id, {
        serviceDate: daysAgo(20),
      });
      await http()
        .post(`/api/breeding/${r3.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(1) })
        .expect(200);
      const get = async (qs = '') =>
        (await http().get(`/api/breeding${qs}`).set(headers).expect(200))
          .body as Page<BreedingItem> & {
          statusCounts: Record<string, number>;
        };
      const all = await get();
      expect(all.total).toBe(3);
      expect(all.statusCounts).toEqual({
        GESTATION: 1,
        MISE_BAS: 1,
        SEVRAGE: 0,
        ECHEC: 1,
      });
      expect(all.items.map((i) => i.id)).toEqual([r1.id, r3.id, r2.id]);
      const gest = await get('?status=GESTATION');
      expect(gest.items.map((i) => i.id)).toEqual([r1.id]);
      expect(gest.items[0].daysToFarrowing).toBeGreaterThan(90);
      expect(gest.statusCounts.ECHEC).toBe(1);
      expect((await get('?search=tr-02')).items.map((i) => i.id)).toEqual([
        r2.id,
      ]);
      expect((await get('?sort=serviceDate:asc')).items[0].id).toBe(r2.id);
      await http().get('/api/breeding?status=NOPE').set(headers).expect(400);
      await http().get('/api/breeding?sort=nope:asc').set(headers).expect(400);
    });

    it('exports CSV with the brief columns and scopes to the farm', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      await serve(headers, sow.id, boar.id, { serviceDate: '2026-07-05' });
      const other = await actor('RESP_PORCIN', [farmB], farmB);
      const s = await animal(other.headers, { buildingId: bldB });
      const b = await animal(other.headers, {
        category: 'VERRAT',
        buildingId: bldB,
      });
      await serve(other.headers, s.id, b.id);
      const csv = await http()
        .get('/api/breeding?format=csv')
        .set(headers)
        .expect(200);
      const lines = csv.text.split('\r\n');
      expect(lines[0]).toBe(
        '\uFEFFTruie;Verrat / IA;Date saillie;Nés totaux;Nés vivants;Sevrés;Statut;Mise bas prévue',
      );
      expect(lines[1]).toBe(
        `${sow.tag};${boar.tag};2026-07-05;;;;Gestation;2026-10-27`,
      );
      expect(lines).toHaveLength(3);
    });
  });

  describe('permissions', () => {
    it('refuses roles without the reproduction permission', async () => {
      const avicole = await actor('RESP_AVICOLE');
      await http().get('/api/breeding').set(avicole.headers).expect(403);
      await http()
        .post('/api/breeding')
        .set(avicole.headers)
        .send({})
        .expect(403);
      const porcin = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(porcin.headers);
      const rec = await serve(porcin.headers, sow.id, boar.id);
      const vet = await actor('VETERINAIRE');
      await http().get('/api/breeding').set(vet.headers).expect(200);
      await http()
        .post(`/api/breeding/${rec.id}/fail`)
        .set(vet.headers)
        .send({ date: daysAgo(1) })
        .expect(403);
      await http()
        .delete(`/api/breeding/${rec.id}`)
        .set(vet.headers)
        .expect(403);
      await http()
        .get(`/api/animals/${sow.id}/breeding-history`)
        .set(vet.headers)
        .expect(200);
    });
  });

  describe('date order and races', () => {
    async function farrowedLitter(headers: Record<string, string>) {
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      const f = (await farrow(headers, rec.id).expect(200))
        .body as BreedingItem;
      return { sow, boar, rec: f };
    }

    async function freshLitter() {
      await resetDb();
      orgId = (await createOrganization()).id;
      farmA = (await createFarm(orgId, 'Ferme A')).id;
      const site = await prisma.site.create({
        data: { farmId: farmA, name: 'Site' },
      });
      bldA = (
        await prisma.building.create({
          data: {
            farmId: farmA,
            siteId: site.id,
            name: 'Maternité',
            type: 'PORCIN',
            capacity: 500,
          },
        })
      ).id;
      const { headers } = await actor('RESP_PORCIN');
      return { headers, ...(await farrowedLitter(headers)) };
    }

    const wean = (headers: Record<string, string>, id: string, count: number) =>
      http()
        .post(`/api/breeding/${id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: count });

    const death = (
      headers: Record<string, string>,
      batchId: string | null,
      date: string,
      quantity = 1,
    ) =>
      http()
        .post(`/api/batches/${batchId}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date, quantity });

    const WEANED = (n: number) =>
      `Cette portée a été sevrée : ${n} porcelets sevrés le ${daysAgo(1)}`;

    it('a death dated before the weaning, recorded first, makes the weaning of all 12 impossible', async () => {
      const { headers, rec } = await freshLitter();
      await death(headers, rec.litterBatchId, daysAgo(2)).expect(201);
      await wean(headers, rec.id, 12).expect(400);
      await wean(headers, rec.id, 11).expect(200);
    });

    it('a death dated on or before the weaning is refused once the litter is weaned, a later one is not', async () => {
      const { headers, rec } = await freshLitter();
      await wean(headers, rec.id, 12).expect(200);
      for (const date of [daysAgo(2), daysAgo(1)]) {
        const refused = await death(headers, rec.litterBatchId, date).expect(
          400,
        );
        expect((refused.body as { message: string }).message).toBe(WEANED(12));
      }
      await death(headers, rec.litterBatchId, daysAgo(0)).expect(201);
      const batch = (
        await http()
          .get(`/api/batches/${rec.litterBatchId}`)
          .set(headers)
          .expect(200)
      ).body as BatchItem;
      expect(batch.alive).toBe(11);
    });

    it('a weaning that wrote off 2 piglets keeps its 10: an earlier death is refused', async () => {
      const { headers, rec } = await freshLitter();
      await wean(headers, rec.id, 10).expect(200);
      await death(headers, rec.litterBatchId, daysAgo(3)).expect(400);
    });

    it('an edit or a removal on the litter cannot cut into the weaned animals either', async () => {
      const { headers, rec } = await freshLitter();
      const early = (await death(headers, rec.litterBatchId, daysAgo(4)).expect(
        201,
      )) as { body: { id: string } };
      await wean(headers, rec.id, 11).expect(200);
      const url = `/api/batches/${rec.litterBatchId}/events/${early.body.id}`;
      await http()
        .patch(url)
        .set(headers)
        .send({ quantity: 2 })
        .expect(400)
        .expect((r) => {
          expect((r.body as { message: string }).message).toBe(WEANED(11));
        });
      // Moving the death after the weaning date would put it back: allowed.
      await http()
        .patch(url)
        .set(headers)
        .send({ date: daysAgo(0) })
        .expect(200);
      // Removing it is an increase of the count: allowed too.
      await http().delete(url).set(headers).expect(200);
      // A lower opening count is refused the same way.
      await http()
        .patch(`/api/batches/${rec.litterBatchId}`)
        .set(headers)
        .send({ initialCount: 10 })
        .expect(400);
    });

    it('weaning racing a death on the litter: one wins, whatever the order, never out of step', async () => {
      for (let i = 0; i < 3; i++) {
        const { headers, rec } = await freshLitter();
        const [w, d] = await Promise.all([
          wean(headers, rec.id, 12),
          death(headers, rec.litterBatchId, daysAgo(2)),
        ]);
        expect([200, 400]).toContain(w.status);
        expect([201, 400]).toContain(d.status);
        // Exactly one of them lands: both together would leave 12 weaned out of 11.
        expect(w.status === 200 && d.status === 201).toBe(false);
        expect(w.status === 400 && d.status === 400).toBe(false);
        const record = await prisma.breedingRecord.findUniqueOrThrow({
          where: { id: rec.id },
        });
        const alive = (
          await http()
            .get(`/api/batches/${rec.litterBatchId}`)
            .set(headers)
            .expect(200)
        ).body as BatchItem;
        if (w.status === 200) {
          expect(record.weanedCount).toBe(12);
          expect(alive.alive).toBe(12);
        } else {
          expect(record.status).toBe('MISE_BAS');
          expect(alive.alive).toBe(11);
        }
      }
    });

    it('requires a service after the sow previous cycle', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const r1 = await serve(headers, sow.id, boar.id, {
        serviceDate: daysAgo(200),
      });
      await farrow(headers, r1.id, { date: daysAgo(86) }).expect(200);
      await http()
        .post(`/api/breeding/${r1.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(60), weanedCount: 12 })
        .expect(200);
      const post = (serviceDate: string) =>
        http().post('/api/breeding').set(headers).send({
          sowId: sow.id,
          method: 'SAILLIE',
          boarId: boar.id,
          serviceDate,
        });
      const early = await post(daysAgo(61)).expect(400);
      expect((early.body as Msg).message).toBe(
        'La date de saillie est antérieure au cycle précédent',
      );
      await post(daysAgo(250)).expect(400);
      const r2 = (await post(daysAgo(60)).expect(201)).body as BreedingItem;
      const moved = await http()
        .patch(`/api/breeding/${r2.id}`)
        .set(headers)
        .send({ serviceDate: daysAgo(70) })
        .expect(400);
      expect((moved.body as Msg).message).toBe(
        'La date de saillie est antérieure au cycle précédent',
      );
      await http()
        .patch(`/api/breeding/${r2.id}`)
        .set(headers)
        .send({ serviceDate: daysAgo(55) })
        .expect(200);
      // a failed record counts too
      const s2 = await animal(headers);
      const f1 = await serve(headers, s2.id, boar.id, {
        serviceDate: daysAgo(30),
      });
      await http()
        .post(`/api/breeding/${f1.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(10) })
        .expect(200);
      await http()
        .post('/api/breeding')
        .set(headers)
        .send({
          sowId: s2.id,
          method: 'IA',
          semenLabel: 'X',
          serviceDate: daysAgo(15),
        })
        .expect(400);
    });

    it('refuses an exit dated before the last breeding event', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      await serve(headers, sow.id, boar.id, { serviceDate: daysAgo(10) });
      const res = await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(11), reason: 'MORT' })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        'La date de sortie est antérieure au dernier événement de reproduction',
      );
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(10), reason: 'MORT' })
        .expect(200);
      const list = await http().get('/api/breeding').set(headers).expect(200);
      expect((list.body as Page<BreedingItem>).items[0]).toMatchObject({
        status: 'ECHEC',
      });
      // after a weaning, a sale before it is refused too
      const { sow: s2, rec } = await farrowedLitter(headers);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(2), weanedCount: 12 })
        .expect(200);
      await http()
        .post(`/api/animals/${s2.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(3), reason: 'VENDU' })
        .expect(400);
      await http()
        .post(`/api/animals/${s2.id}/exit`)
        .set(headers)
        .send({ date: daysAgo(2), reason: 'VENDU' })
        .expect(200);
    });

    it('the litter inherits the sow breed', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const breed = await prisma.breed.create({
        data: { organizationId: orgId, species: 'PORCIN', name: 'Landrace' },
      });
      const sow = await animal(headers, { breedId: breed.id });
      const boar = await animal(headers, { category: 'VERRAT' });
      const rec = await serve(headers, sow.id, boar.id);
      const f = (await farrow(headers, rec.id).expect(200))
        .body as BreedingItem;
      const batch = (
        await http()
          .get(`/api/batches/${f.litterBatchId}`)
          .set(headers)
          .expect(200)
      ).body as BatchItem & { breedId: string | null };
      expect(batch.breedId).toBe(breed.id);
    });

    it('the database allows one open record per sow', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await expect(
        prisma.breedingRecord.create({
          data: {
            farmId: farmA,
            sowId: sow.id,
            method: 'IA',
            semenLabel: 'X',
            serviceDate: new Date(daysAgo(1)),
            expectedFarrowingDate: new Date(daysAhead(100)),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await http()
        .post(`/api/breeding/${rec.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(1) })
        .expect(200);
    });
  });

  describe('audit', () => {
    it('writes one reproduction row per write', async () => {
      const { headers } = await actor('RESP_PORCIN');
      const { sow, boar } = await pair(headers);
      const rec = await serve(headers, sow.id, boar.id);
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({ serviceDate: daysAgo(119) })
        .expect(200);
      await farrow(headers, rec.id).expect(200);
      await http()
        .post(`/api/breeding/${rec.id}/weaning`)
        .set(headers)
        .send({ date: daysAgo(1), weanedCount: 12 })
        .expect(200);
      const gilt = await animal(headers);
      const r2 = await serve(headers, gilt.id, boar.id);
      await http().delete(`/api/breeding/${r2.id}`).set(headers).expect(200);
      const r3 = await serve(headers, gilt.id, boar.id);
      await http()
        .post(`/api/breeding/${r3.id}/fail`)
        .set(headers)
        .send({ date: daysAgo(1) })
        .expect(200);
      const heat = await http()
        .post(`/api/animals/${gilt.id}/heats`)
        .set(headers)
        .send({ date: daysAgo(1) })
        .expect(201);
      await http()
        .delete(
          `/api/animals/${gilt.id}/heats/${(heat.body as { id: string }).id}`,
        )
        .set(headers)
        .expect(200);
      // refused writes leave no row
      await http()
        .patch(`/api/breeding/${rec.id}`)
        .set(headers)
        .send({ serviceDate: daysAgo(100) })
        .expect(409);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'reproduction' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'UPDATE',
        'UPDATE',
        'CREATE',
        'DELETE',
        'CREATE',
        'UPDATE',
        'CREATE',
        'DELETE',
      ]);
      expect(rows[0]).toMatchObject({ recordId: rec.id, farmId: farmA });
      // the farrowing's batch carries its own row in the porcs module
      const batchRows = await prisma.auditLog.count({
        where: {
          module: 'porcs',
          action: 'CREATE',
          label: { startsWith: 'PO-' },
        },
      });
      expect(batchRows).toBe(1);
    });
  });
});
