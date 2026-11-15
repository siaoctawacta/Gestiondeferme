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

interface EggItem {
  id: string;
  date: string;
  batchId: string;
  batchCode: string;
  collected: number;
  broken: number;
  downgraded: number;
  toIncubation: number;
  marketable: number;
  breakageRate: number | null;
  layingRate: number | null;
  note: string | null;
}
interface IncItem {
  id: string;
  code: string;
  sourceBatchId: string | null;
  incubator: string | null;
  startDate: string;
  eggsSet: number;
  candlingDate: string | null;
  fertileEggs: number | null;
  expectedHatchDate: string;
  status: string;
  hatchDate: string | null;
  chicksHatched: number | null;
  chickBatchId: string | null;
  fertilityRate: number | null;
  hatchRate: number | null;
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

describe('Egg production and incubation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let bldA: string; // capacity 5000
  let bldSmall: string; // capacity 100
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
        .create({ data: { farmId, siteId, name, type: 'AVICOLE', capacity } })
        .then((b) => b.id);
    bldA = await mk(farmA, siteA.id, 'Poulailler 1', 5000);
    bldSmall = await mk(farmA, siteA.id, 'Couveuse', 100);
    bldB = await mk(farmB, siteB.id, 'Poulailler B', 5000);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function lot(
    headers: Record<string, string>,
    over: Record<string, unknown> = {},
    building = bldA,
  ): Promise<{ id: string; code: string }> {
    const res = await http()
      .post('/api/batches')
      .set(headers)
      .send({
        species: 'AVICOLE',
        type: 'PONDEUSE',
        buildingId: building,
        entryDate: daysAgo(30),
        initialCount: 2850,
        ...over,
      })
      .expect(201);
    return res.body as { id: string; code: string };
  }

  const record = (batchId: string, over: Record<string, unknown> = {}) => ({
    batchId,
    date: daysAgo(1),
    collected: 2480,
    broken: 42,
    ...over,
  });

  describe('egg production', () => {
    it('computes marketable, breakage and laying rates from the live count', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      const res = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id))
        .expect(201);
      const body = res.body as EggItem;
      expect(body).toMatchObject({
        batchCode: l.code,
        collected: 2480,
        broken: 42,
        downgraded: 0,
        toIncubation: 0,
        marketable: 2438,
        breakageRate: 1.7,
        layingRate: 87,
      });
      const list = await http()
        .get('/api/egg-production')
        .set(headers)
        .expect(200);
      expect((list.body as Page<EggItem>).items[0]).toMatchObject({
        id: body.id,
        marketable: 2438,
      });
    });

    it('uses the hens alive on the record date', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      await http()
        .post(`/api/batches/${l.id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(3), quantity: 150 })
        .expect(201);
      const old = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { date: daysAgo(5), collected: 2700, broken: 0 }))
        .expect(201);
      const recent = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { collected: 2700, broken: 0 }))
        .expect(201);
      expect((old.body as EggItem).layingRate).toBe(94.7); // 2700 / 2850
      expect((recent.body as EggItem).layingRate).toBe(100); // 2700 / 2700
    });

    it('rejects a second record for the same lot and date', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id))
        .expect(201);
      const res = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id))
        .expect(409);
      expect((res.body as Msg).message).toBe(
        'Un enregistrement existe déjà pour cette date',
      );
    });

    it('rejects inconsistent figures, dates and lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { collected: 100, broken: 101 }))
        .expect(400);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(
          record(l.id, {
            collected: 100,
            broken: 40,
            downgraded: 30,
            toIncubation: 31,
          }),
        )
        .expect(400);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { collected: -1 }))
        .expect(400);
      const future = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { date: daysAhead(2) }))
        .expect(400);
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      const early = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { date: daysAgo(40) }))
        .expect(400);
      expect((early.body as Msg).message).toBe(
        "La date est antérieure à l'entrée du lot",
      );
    });

    it('refuses lots that do not lay, foreign lots and closed lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const chair = await lot(headers, { type: 'CHAIR', initialCount: 100 });
      const res = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(chair.id))
        .expect(400);
      expect((res.body as Msg).message).toBe("Ce lot ne produit pas d'œufs");

      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const foreign = await lot(other.headers, {}, bldB);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(foreign.id))
        .expect(400);

      const closed = await lot(headers, { initialCount: 100 });
      await http()
        .post(`/api/batches/${closed.id}/events`)
        .set(headers)
        .send({ type: 'VENTE', date: daysAgo(1), quantity: 100 })
        .expect(201);
      await http()
        .post(`/api/batches/${closed.id}/close`)
        .set(headers)
        .expect(200);
      const c = await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(closed.id))
        .expect(409);
      expect((c.body as Msg).message).toBe('Ce lot est clôturé');
    });

    it('accepts breeder lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers, { type: 'REPRODUCTEUR' });
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { toIncubation: 100 }))
        .expect(201);
    });

    it('updates a record and changes the list figures; a move onto an existing date is a 409', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      const a = (
        await http()
          .post('/api/egg-production')
          .set(headers)
          .send(record(l.id))
          .expect(201)
      ).body as EggItem;
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l.id, { date: daysAgo(2) }))
        .expect(201);
      const upd = await http()
        .patch(`/api/egg-production/${a.id}`)
        .set(headers)
        .send({ broken: 100, toIncubation: 80 })
        .expect(200);
      expect(upd.body).toMatchObject({
        broken: 100,
        marketable: 2300,
        breakageRate: 4,
      });
      const list = await http()
        .get(`/api/egg-production?batchId=${l.id}`)
        .set(headers)
        .expect(200);
      const items = (list.body as Page<EggItem>).items;
      expect(items.map((i) => i.date)).toEqual([daysAgo(1), daysAgo(2)]);
      expect(items[0].marketable).toBe(2300);
      const clash = await http()
        .patch(`/api/egg-production/${a.id}`)
        .set(headers)
        .send({ date: daysAgo(2) })
        .expect(409);
      expect((clash.body as Msg).message).toBe(
        'Un enregistrement existe déjà pour cette date',
      );
      await http()
        .patch(`/api/egg-production/${a.id}`)
        .set(headers)
        .send({ broken: 5000 })
        .expect(400);
    });

    it('filters, sorts and exports', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l1 = await lot(headers);
      const l2 = await lot(headers, { initialCount: 100 });
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l1.id, { date: daysAgo(3), collected: 10, broken: 0 }))
        .expect(201);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l1.id, { date: daysAgo(1), collected: 30, broken: 0 }))
        .expect(201);
      await http()
        .post('/api/egg-production')
        .set(headers)
        .send(record(l2.id, { date: daysAgo(1), collected: 20, broken: 1 }))
        .expect(201);
      const get = async (qs: string) =>
        (await http().get(`/api/egg-production?${qs}`).set(headers).expect(200))
          .body as Page<EggItem>;
      expect((await get('')).total).toBe(3);
      expect((await get(`batchId=${l2.id}`)).total).toBe(1);
      expect((await get(`from=${daysAgo(2)}`)).total).toBe(2);
      expect((await get(`to=${daysAgo(2)}`)).total).toBe(1);
      expect((await get(`search=${l2.code}`)).items[0].batchCode).toBe(l2.code);
      expect((await get('')).items.map((i) => [i.date, i.batchCode])).toEqual([
        [daysAgo(1), l1.code],
        [daysAgo(1), l2.code],
        [daysAgo(3), l1.code],
      ]);
      expect((await get('sort=collected:asc')).items[0].collected).toBe(10);
      await http()
        .get('/api/egg-production?sort=bogus:asc')
        .set(headers)
        .expect(400);
      const csv = await http()
        .get('/api/egg-production?format=csv')
        .set(headers)
        .expect(200);
      expect(csv.text.split('\r\n')[0]).toBe(
        '﻿Date;Lot;Œufs collectés;Œufs cassés;Mis en incubation;Taux de casse',
      );
    });

    it('scopes by farm and enforces permissions', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      const rec = (
        await http()
          .post('/api/egg-production')
          .set(headers)
          .send(record(l.id))
          .expect(201)
      ).body as EggItem;
      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      expect(
        (
          (
            await http()
              .get('/api/egg-production')
              .set(other.headers)
              .expect(200)
          ).body as Page<EggItem>
        ).total,
      ).toBe(0);
      await http()
        .patch(`/api/egg-production/${rec.id}`)
        .set(other.headers)
        .send({ broken: 1 })
        .expect(404);
      await http()
        .delete(`/api/egg-production/${rec.id}`)
        .set(other.headers)
        .expect(404);
      const vet = await actor('VETERINAIRE');
      await http().get('/api/egg-production').set(vet.headers).expect(200);
      await http()
        .post('/api/egg-production')
        .set(vet.headers)
        .send(record(l.id, { date: daysAgo(2) }))
        .expect(403);
      await http()
        .delete(`/api/egg-production/${rec.id}`)
        .set(vet.headers)
        .expect(403);
      await http().get('/api/egg-production').expect(401);
    });

    it('audits every write once and deletes', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const l = await lot(headers);
      const rec = (
        await http()
          .post('/api/egg-production')
          .set(headers)
          .send(record(l.id))
          .expect(201)
      ).body as EggItem;
      await http()
        .patch(`/api/egg-production/${rec.id}`)
        .set(headers)
        .send({ broken: 50 })
        .expect(200);
      await http()
        .delete(`/api/egg-production/${rec.id}`)
        .set(headers)
        .expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'ponte', recordId: rec.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
      expect(await prisma.eggProduction.count()).toBe(0);
    });
  });

  describe('incubation', () => {
    const incubation = (over: Record<string, unknown> = {}) => ({
      startDate: daysAgo(25),
      eggsSet: 300,
      incubator: 'Couveuse 1',
      ...over,
    });
    const create = async (
      headers: Record<string, string>,
      over: Record<string, unknown> = {},
    ) =>
      (
        await http()
          .post('/api/incubations')
          .set(headers)
          .send(incubation(over))
          .expect(201)
      ).body as IncItem;

    it('refuses moving the source lot entry date after an incubation start', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const source = await lot(headers, { type: 'REPRODUCTEUR' });
      await create(headers, {
        sourceBatchId: source.id,
        startDate: daysAgo(10),
      });
      const res = await http()
        .patch(`/api/batches/${source.id}`)
        .set(headers)
        .send({ entryDate: daysAgo(5) })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        "La date est antérieure à l'entrée du lot",
      );
      await http()
        .patch(`/api/batches/${source.id}`)
        .set(headers)
        .send({ entryDate: daysAgo(10) })
        .expect(200);
    });

    it('generates INC-YYYY-NN and computes the expected hatch date', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const start = daysAgo(10);
      const a = await create(headers, { startDate: start });
      const year = start.slice(0, 4);
      expect(a.code).toBe(`INC-${year}-01`);
      expect((await create(headers, { startDate: start })).code).toBe(
        `INC-${year}-02`,
      );
      const expected = new Date(Date.parse(start) + 21 * DAY_MS)
        .toISOString()
        .slice(0, 10);
      expect(a).toMatchObject({
        expectedHatchDate: expected,
        status: 'EN_COURS',
        fertilityRate: null,
        hatchRate: null,
      });
      const dup = await http()
        .post('/api/incubations')
        .set(headers)
        .send(incubation({ code: a.code }))
        .expect(409);
      expect(dup.body).toHaveProperty('message');
    });

    it('validates the source lot and the figures', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const chair = await lot(headers, { type: 'CHAIR', initialCount: 100 });
      const layer = await lot(headers);
      await http()
        .post('/api/incubations')
        .set(headers)
        .send(incubation({ sourceBatchId: chair.id }))
        .expect(400);
      await http()
        .post('/api/incubations')
        .set(headers)
        .send(incubation({ eggsSet: 0 }))
        .expect(400);
      await http()
        .post('/api/incubations')
        .set(headers)
        .send(incubation({ startDate: daysAhead(1) }))
        .expect(400);
      const ok = await create(headers, { sourceBatchId: layer.id });
      expect(ok.sourceBatchId).toBe(layer.id);
    });

    it('records candling, then hatches into a POUSSIN batch', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      await http()
        .post(`/api/incubations/${inc.id}/candling`)
        .set(headers)
        .send({ date: daysAgo(8), fertileEggs: 301 })
        .expect(400);
      const c = await http()
        .post(`/api/incubations/${inc.id}/candling`)
        .set(headers)
        .send({ date: daysAgo(8), fertileEggs: 280 })
        .expect(200);
      expect((c.body as IncItem).fertilityRate).toBe(93.3);
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 290, buildingId: bldA })
        .expect(400);
      expect(
        await prisma.animalBatch.count({ where: { type: 'POUSSIN' } }),
      ).toBe(0);
      const h = await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 260, buildingId: bldA })
        .expect(200);
      const hatched = h.body as IncItem;
      expect(hatched).toMatchObject({
        status: 'ECLOSE',
        chicksHatched: 260,
        hatchRate: 86.7,
        hatchDate: daysAgo(1),
      });
      const batch = await prisma.animalBatch.findUniqueOrThrow({
        where: { id: hatched.chickBatchId as string },
      });
      expect(batch).toMatchObject({
        type: 'POUSSIN',
        species: 'AVICOLE',
        initialCount: 260,
        buildingId: bldA,
        farmId: farmA,
      });
      expect(batch.code).toMatch(/^LS-\d{4}-01$/);
      expect(batch.entryDate.toISOString().slice(0, 10)).toBe(daysAgo(1));
      const bld = await http()
        .get('/api/batches?species=AVICOLE&type=POUSSIN')
        .set(headers)
        .expect(200);
      expect((bld.body as Page<{ alive: number }>).items[0].alive).toBe(260);

      const again = await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 100, buildingId: bldA })
        .expect(409);
      expect((again.body as Msg).message).toBe('Cette incubation est terminée');
      await http()
        .post(`/api/incubations/${inc.id}/fail`)
        .set(headers)
        .send({ note: 'x' })
        .expect(409);
      await http()
        .patch(`/api/incubations/${inc.id}`)
        .set(headers)
        .send({ incubator: 'Autre' })
        .expect(409);
      await http()
        .delete(`/api/incubations/${inc.id}`)
        .set(headers)
        .expect(409);
      expect(await prisma.incubation.count()).toBe(1);
    });

    it('bounds chicks by the fertile eggs, or the eggs set when not candled', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 301, buildingId: bldA })
        .expect(400);
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(30), chicksHatched: 10, buildingId: bldA })
        .expect(400);
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAhead(1), chicksHatched: 10, buildingId: bldA })
        .expect(400);
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 300, buildingId: bldA })
        .expect(200);
    });

    it('rolls back the whole hatch when the building is too small', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 260, buildingId: bldSmall })
        .expect(400);
      const row = await prisma.incubation.findUniqueOrThrow({
        where: { id: inc.id },
      });
      expect(row.status).toBe('EN_COURS');
      expect(row.chickBatchId).toBeNull();
      expect(await prisma.animalBatch.count()).toBe(0);
      expect(await prisma.auditLog.count({ where: { module: 'ponte' } })).toBe(
        1, // the creation only
      );
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 10, buildingId: bldB })
        .expect(400);
    });

    it('hatching zero chicks creates no batch', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      const h = await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 0, buildingId: bldA })
        .expect(200);
      expect(h.body).toMatchObject({
        status: 'ECLOSE',
        chicksHatched: 0,
        hatchRate: 0,
        chickBatchId: null,
      });
      expect(await prisma.animalBatch.count()).toBe(0);
    });

    it('fails an incubation, which is then terminal but deletable', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      const f = await http()
        .post(`/api/incubations/${inc.id}/fail`)
        .set(headers)
        .send({ note: 'Panne de courant' })
        .expect(200);
      expect(f.body).toMatchObject({
        status: 'ECHEC',
        note: 'Panne de courant',
      });
      const res = await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 10, buildingId: bldA })
        .expect(409);
      expect((res.body as Msg).message).toBe('Cette incubation est terminée');
      await http()
        .delete(`/api/incubations/${inc.id}`)
        .set(headers)
        .expect(200);
      expect(await prisma.incubation.count()).toBe(0);
    });

    it('edits an ongoing incubation and recomputes the hatch date', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      const start = daysAgo(20);
      const upd = await http()
        .patch(`/api/incubations/${inc.id}`)
        .set(headers)
        .send({ startDate: start, eggsSet: 320 })
        .expect(200);
      const expected = new Date(Date.parse(start) + 21 * DAY_MS)
        .toISOString()
        .slice(0, 10);
      expect(upd.body).toMatchObject({
        eggsSet: 320,
        expectedHatchDate: expected,
      });
      await http()
        .post(`/api/incubations/${inc.id}/candling`)
        .set(headers)
        .send({ date: daysAgo(10), fertileEggs: 300 })
        .expect(200);
      await http()
        .patch(`/api/incubations/${inc.id}`)
        .set(headers)
        .send({ eggsSet: 250 })
        .expect(400);
      await http()
        .post(`/api/incubations/${inc.id}/candling`)
        .set(headers)
        .send({ date: daysAgo(30), fertileEggs: 100 })
        .expect(400);
    });

    it('lists with filters, scopes by farm and enforces permissions', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const a = await create(headers);
      await create(headers);
      await http()
        .post(`/api/incubations/${a.id}/fail`)
        .set(headers)
        .send({})
        .expect(200);
      const list = await http()
        .get('/api/incubations')
        .set(headers)
        .expect(200);
      expect((list.body as Page<IncItem>).total).toBe(2);
      const failed = await http()
        .get('/api/incubations?status=ECHEC')
        .set(headers)
        .expect(200);
      expect((failed.body as Page<IncItem>).items.map((i) => i.id)).toEqual([
        a.id,
      ]);
      await http()
        .get(`/api/incubations?search=${a.code}`)
        .set(headers)
        .expect(200);
      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      await http()
        .get(`/api/incubations/${a.id}`)
        .set(other.headers)
        .expect(404);
      await http()
        .post(`/api/incubations/${a.id}/fail`)
        .set(other.headers)
        .send({})
        .expect(404);
      const vet = await actor('VETERINAIRE');
      await http().get(`/api/incubations/${a.id}`).set(vet.headers).expect(200);
      await http()
        .post('/api/incubations')
        .set(vet.headers)
        .send(incubation())
        .expect(403);
      await http()
        .post(`/api/incubations/${a.id}/hatch`)
        .set(vet.headers)
        .send({ date: daysAgo(1), chicksHatched: 1, buildingId: bldA })
        .expect(403);
    });

    it('audits every write once; the hatch audits ponte and lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const inc = await create(headers);
      await http()
        .patch(`/api/incubations/${inc.id}`)
        .set(headers)
        .send({ incubator: 'Couveuse 2' })
        .expect(200);
      await http()
        .post(`/api/incubations/${inc.id}/candling`)
        .set(headers)
        .send({ date: daysAgo(8), fertileEggs: 280 })
        .expect(200);
      const h = await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(headers)
        .send({ date: daysAgo(1), chicksHatched: 260, buildingId: bldA })
        .expect(200);
      const ponte = await prisma.auditLog.findMany({
        where: { module: 'ponte', recordId: inc.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(ponte.map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'UPDATE',
        'UPDATE',
      ]);
      const lots = await prisma.auditLog.findMany({
        where: { module: 'lots', recordId: (h.body as IncItem).chickBatchId! },
      });
      expect(lots.map((r) => r.action)).toEqual(['CREATE']);
      const other = await create(headers);
      await http()
        .delete(`/api/incubations/${other.id}`)
        .set(headers)
        .expect(200);
      expect(
        await prisma.auditLog.count({
          where: { module: 'ponte', recordId: other.id, action: 'DELETE' },
        }),
      ).toBe(1);
    });
  });
});
