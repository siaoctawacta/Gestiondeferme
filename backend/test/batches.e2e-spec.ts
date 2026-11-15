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

interface BatchItem {
  id: string;
  code: string;
  species: string;
  type: string;
  breedId: string | null;
  breedName: string | null;
  buildingId: string;
  buildingName: string;
  entryDate: string;
  initialCount: number;
  deaths: number;
  alive: number;
  mortalityRate: number | null;
  averageWeightG: number | null;
  status: string;
  closedAt: string | null;
  ageDays: number;
}
interface BatchPage {
  items: BatchItem[];
  total: number;
  statusCounts: Record<string, number>;
}
interface Msg {
  message: string | string[];
}

const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

describe('Herd ledger and batches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let bldA: string; // capacity 5000, farm A
  let bldA2: string; // capacity 10000, farm A
  let bldB: string; // farm B

  const http = () => request(app.getHttpServer() as App);

  async function actor(role: Role, farmIds: string[] = [farmA], farm = farmA) {
    const user = await createUser({ organizationId: orgId, role, farmIds });
    const token = await tokenFor(user.id);
    return {
      user,
      headers: { Authorization: `Bearer ${token}`, 'X-Farm-Id': farm },
    };
  }

  const lot = (over: Record<string, unknown> = {}) => ({
    species: 'AVICOLE',
    type: 'CHAIR',
    buildingId: bldA,
    entryDate: daysAgo(30),
    initialCount: 5000,
    ...over,
  });

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
    bldA2 = await mk(farmA, siteA.id, 'Poulailler 2', 10000);
    bldB = await mk(farmB, siteB.id, 'Poulailler B', 5000);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createLot(
    headers: Record<string, string>,
    over: Record<string, unknown> = {},
  ): Promise<BatchItem> {
    const res = await http()
      .post('/api/batches')
      .set(headers)
      .send(lot(over))
      .expect(201);
    return res.body as BatchItem;
  }

  /** Closing needs an empty lot: sells whatever is still alive the day before. */
  async function sellAll(headers: Record<string, string>, id: string) {
    const { alive } = (
      await http().get(`/api/batches/${id}`).set(headers).expect(200)
    ).body as BatchItem;
    if (alive === 0) return;
    await http()
      .post(`/api/batches/${id}/events`)
      .set(headers)
      .send({ type: 'VENTE', date: daysAgo(1), quantity: alive })
      .expect(201);
  }

  describe('creation and codes', () => {
    it('generates LC-YYYY-NN per farm and year, with a prefix per type', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const year = new Date().getUTCFullYear();
      expect((await createLot(headers, { initialCount: 100 })).code).toBe(
        `LC-${year}-01`,
      );
      expect((await createLot(headers, { initialCount: 100 })).code).toBe(
        `LC-${year}-02`,
      );
      expect(
        (await createLot(headers, { type: 'PONDEUSE', initialCount: 100 }))
          .code,
      ).toBe(`LP-${year}-01`);
      expect(
        (await createLot(headers, { type: 'POUSSIN', initialCount: 100 })).code,
      ).toBe(`LS-${year}-01`);
      expect(
        (await createLot(headers, { type: 'REPRODUCTEUR', initialCount: 100 }))
          .code,
      ).toBe(`LR-${year}-01`);
      const lastYear = await createLot(headers, {
        initialCount: 100,
        entryDate: `${year - 1}-12-15`,
      });
      expect(lastYear.code).toBe(`LC-${year - 1}-01`);

      const other = await actor('DIRECTEUR_FERME', [farmB], farmB);
      expect(
        (
          await createLot(other.headers, {
            buildingId: bldB,
            initialCount: 100,
          })
        ).code,
      ).toBe(`LC-${year}-01`);
    });

    it('generates distinct codes for parallel creations', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          http()
            .post('/api/batches')
            .set(headers)
            .send(lot({ initialCount: 10 })),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      const codes = results.map((r) => (r.body as BatchItem).code);
      expect(new Set(codes).size).toBe(6);
    });

    it('accepts a custom code and refuses a duplicate with 409', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await createLot(headers, { code: 'MON-LOT', initialCount: 10 });
      const dup = await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ code: 'MON-LOT', initialCount: 10 }))
        .expect(409);
      expect((dup.body as Msg).message).toBe('Ce code de lot existe déjà');
    });

    it('refuses invalid bodies with French messages', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const post = (body: Record<string, unknown>) =>
        http().post('/api/batches').set(headers).send(body);
      const msg = async (body: Record<string, unknown>, status = 400) =>
        ((await post(body).expect(status)).body as Msg).message;
      expect(await msg(lot({ initialCount: 0 }))).toContain(
        "L'effectif doit être un nombre entier supérieur à 0",
      );
      expect(await msg(lot({ entryDate: '2026-02-30' }))).toContain(
        'Date invalide (AAAA-MM-JJ)',
      );
      expect(await msg(lot({ entryDate: daysAgo(-2) }))).toBe(
        'La date ne peut pas être dans le futur',
      );
      expect(await msg(lot({ type: 'PORCELET' }))).toBe(
        'Type de lot invalide pour cette espèce',
      );
      expect(await msg(lot({ responsibleId: 'nope' }))).toBe(
        'Responsable invalide',
      );
      expect(await msg(lot({ breedId: 'nope' }))).toBe('Souche invalide');
    });

    it('refuses a building, breed or responsible from elsewhere with 400', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const foreignBuilding = await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ buildingId: bldB }))
        .expect(400);
      expect((foreignBuilding.body as Msg).message).toBe(
        'Bâtiment invalide pour cette ferme',
      );

      const otherOrg = await createOrganization('Autre');
      const outsider = await createUser({
        organizationId: otherOrg.id,
        role: 'DIRECTEUR_FERME',
      });
      await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ responsibleId: outsider.id }))
        .expect(400);
      const foreignBreed = await prisma.breed.create({
        data: { organizationId: otherOrg.id, name: 'Ross', species: 'AVICOLE' },
      });
      await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ breedId: foreignBreed.id }))
        .expect(400);
      const pigBreed = await prisma.breed.create({
        data: { organizationId: orgId, name: 'Large White', species: 'PORCIN' },
      });
      await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ breedId: pigBreed.id }))
        .expect(400);
    });

    it('refuses to create under X-Farm-Id: all', async () => {
      const owner = await actor('SUPER_ADMIN', [], 'all');
      await http()
        .post('/api/batches')
        .set(owner.headers)
        .send(lot())
        .expect(403);
    });
  });

  describe('reference figures and list', () => {
    it('shows alive 4820 and mortality 3.6 for 5000 initial and 180 deaths', async () => {
      const { headers, user } = await actor('DIRECTEUR_FERME');
      const breed = await http()
        .post('/api/breeds')
        .set(headers)
        .send({ name: 'Cobb 500', species: 'AVICOLE' })
        .expect(201);
      const created = await createLot(headers, {
        breedId: (breed.body as { id: string }).id,
        responsibleId: user.id,
      });
      const id = created.id;
      for (const [date, quantity] of [
        [daysAgo(10), 100],
        [daysAgo(5), 80],
      ] as const) {
        await http()
          .post(`/api/batches/${id}/events`)
          .set(headers)
          .send({ type: 'MORTALITE', date, quantity, cause: 'Maladie' })
          .expect(201);
      }
      await http()
        .post(`/api/batches/${id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(20), sampleSize: 50, averageWeightG: 800 })
        .expect(201);
      await http()
        .post(`/api/batches/${id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(3), sampleSize: 50, averageWeightG: 1450 })
        .expect(201);

      const list = (
        await http()
          .get('/api/batches?species=AVICOLE')
          .set(headers)
          .expect(200)
      ).body as BatchPage;
      expect(list.total).toBe(1);
      expect(list.statusCounts).toEqual({ EN_COURS: 1, CLOTURE: 0 });
      expect(list.items[0]).toMatchObject({
        id,
        code: expect.stringMatching(/^LC-\d{4}-01$/) as string,
        type: 'CHAIR',
        breedName: 'Cobb 500',
        buildingName: 'Poulailler 1',
        entryDate: daysAgo(30),
        initialCount: 5000,
        deaths: 180,
        alive: 4820,
        mortalityRate: 3.6,
        averageWeightG: 1450,
        status: 'EN_COURS',
        ageDays: 30,
      });

      const detail = await http()
        .get(`/api/batches/${id}`)
        .set(headers)
        .expect(200);
      expect(detail.body).toMatchObject({ alive: 4820, deaths: 180 });
      const performance = (detail.body as { performance: object }).performance;
      expect(Object.keys(performance).sort()).toEqual(
        [
          'ageDays',
          'alive',
          'deaths',
          'dailyGainG',
          'feedConversion',
          'feedCost',
          'feedKg',
          'firstWeightG',
          'lastWeightG',
          'mortalityRate',
        ].sort(),
      );
      expect(performance).toEqual({
        ageDays: 30,
        alive: 4820,
        deaths: 180,
        mortalityRate: 3.6,
        firstWeightG: 800,
        lastWeightG: 1450,
        dailyGainG: 38.2, // (1450 - 800) / 17 days
        feedKg: 0,
        feedConversion: null,
        feedCost: 0,
      });
    });

    it('filters by status, type and search, validates the query, and reports statusCounts over the whole species', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const a = await createLot(headers, { initialCount: 100 });
      await createLot(headers, { type: 'PONDEUSE', initialCount: 100 });
      await sellAll(headers, a.id);
      await http().post(`/api/batches/${a.id}/close`).set(headers).expect(200);

      const get = (qs: string) =>
        http().get(`/api/batches?species=AVICOLE${qs}`).set(headers);
      const closed = (await get('&status=CLOTURE').expect(200))
        .body as BatchPage;
      expect(closed.items.map((i) => i.id)).toEqual([a.id]);
      expect(closed.statusCounts).toEqual({ EN_COURS: 1, CLOTURE: 1 });
      expect(
        ((await get('&type=PONDEUSE').expect(200)).body as BatchPage).total,
      ).toBe(1);
      expect(
        ((await get('&search=lp-').expect(200)).body as BatchPage).total,
      ).toBe(1);
      await get('&status=BIDON').expect(400);
      await get('&type=PORCELET').expect(400);
      await get('&sort=password:asc').expect(400);
      await http().get('/api/batches').set(headers).expect(400);
      expect(
        (
          (
            await http()
              .get('/api/batches?species=PORCIN')
              .set(headers)
              .expect(200)
          ).body as BatchPage
        ).total,
      ).toBe(0);
    });

    it('exports the lots as CSV with the reference header', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers);
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(2), quantity: 180 })
        .expect(201);
      const csv = await http()
        .get('/api/batches?species=AVICOLE&format=csv')
        .set(headers)
        .buffer(true)
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      const lines = csv.text.split('\r\n');
      expect(lines[0]).toBe(
        "﻿Code lot;Type;Souche;Bâtiment;Date d'entrée;Effectif initial;Mortalité cumulée;Poids moyen (g);Statut;Vivants;Mortalité",
      );
      expect(lines[1]).toMatch(
        new RegExp(
          `^LC-\\d{4}-01;Chair;;Poulailler 1;${daysAgo(30)};5000;180;;En cours;4820;3\\.6$`,
        ),
      );
    });
  });

  describe('events', () => {
    it('refuses a future-dated event and one dated before the entry', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers);
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/batches/${id}/events`).set(headers).send(body);
      const future = await post({
        type: 'MORTALITE',
        date: daysAgo(-1),
        quantity: 1,
      }).expect(400);
      expect((future.body as Msg).message).toBe(
        'La date ne peut pas être dans le futur',
      );
      const early = await post({
        type: 'MORTALITE',
        date: daysAgo(31),
        quantity: 1,
      }).expect(400);
      expect((early.body as Msg).message).toBe(
        "La date est antérieure à l'entrée du lot",
      );
      await post({
        type: 'TRANSFERT_SORTIE',
        date: daysAgo(1),
        quantity: 1,
      }).expect(400);
      await post({ type: 'MORTALITE', date: daysAgo(1), quantity: 0 }).expect(
        400,
      );
    });

    it('refuses more deaths than live animals', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const res = await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 101 })
        .expect(400);
      expect((res.body as Msg).message).toBe('Effectif insuffisant');
    });

    it('lists, edits and deletes events, replaying the history each time', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const post = async (body: Record<string, unknown>) =>
        (
          await http()
            .post(`/api/batches/${id}/events`)
            .set(headers)
            .send(body)
            .expect(201)
        ).body as { id: string };
      const death = await post({
        type: 'MORTALITE',
        date: daysAgo(5),
        quantity: 40,
      });
      await post({ type: 'VENTE', date: daysAgo(4), quantity: 50 });

      const page = (
        await http().get(`/api/batches/${id}/events`).set(headers).expect(200)
      ).body as { items: { type: string; date: string }[]; total: number };
      expect(page.total).toBe(2);
      expect(page.items.map((e) => e.type)).toEqual(['VENTE', 'MORTALITE']);

      await http()
        .patch(`/api/batches/${id}/events/${death.id}`)
        .set(headers)
        .send({ quantity: 60 })
        .expect(400);
      const ok = await http()
        .patch(`/api/batches/${id}/events/${death.id}`)
        .set(headers)
        .send({ quantity: 45, cause: 'Chaleur' })
        .expect(200);
      expect(ok.body).toMatchObject({ quantity: 45, cause: 'Chaleur' });
      await http()
        .delete(`/api/batches/${id}/events/${death.id}`)
        .set(headers)
        .expect(200);
      const batch = await http().get(`/api/batches/${id}`).set(headers);
      expect(batch.body).toMatchObject({ alive: 50, deaths: 0 });
      await http()
        .patch(`/api/batches/${id}/events/unknown`)
        .set(headers)
        .send({ quantity: 1 })
        .expect(404);
    });

    it("keeps another farm's batch invisible (404) on every route", async () => {
      const mine = await actor('DIRECTEUR_FERME');
      const theirs = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const foreign = await createLot(theirs.headers, {
        buildingId: bldB,
        initialCount: 100,
      });
      const id = foreign.id;
      const day = daysAgo(1);
      await http().get(`/api/batches/${id}`).set(mine.headers).expect(404);
      await http()
        .patch(`/api/batches/${id}`)
        .set(mine.headers)
        .send({ notes: 'x' })
        .expect(404);
      await http().delete(`/api/batches/${id}`).set(mine.headers).expect(404);
      await http()
        .post(`/api/batches/${id}/close`)
        .set(mine.headers)
        .expect(404);
      await http()
        .get(`/api/batches/${id}/events`)
        .set(mine.headers)
        .expect(404);
      await http()
        .post(`/api/batches/${id}/events`)
        .set(mine.headers)
        .send({ type: 'MORTALITE', date: day, quantity: 1 })
        .expect(404);
      await http()
        .post(`/api/batches/${id}/weighings`)
        .set(mine.headers)
        .send({ date: day, sampleSize: 1, averageWeightG: 1 })
        .expect(404);
      await http()
        .post(`/api/batches/${id}/transfer`)
        .set(mine.headers)
        .send({ toBuildingId: bldA, date: day, quantity: 100 })
        .expect(404);
      const list = (
        await http().get('/api/batches?species=AVICOLE').set(mine.headers)
      ).body as BatchPage;
      expect(list.total).toBe(0);
    });
  });

  describe('capacity and building occupation', () => {
    it('shows occupation 4820 and rate 96 on a 5000-capacity building', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers);
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(2), quantity: 180 })
        .expect(201);
      const building = await http()
        .get(`/api/buildings/${bldA}`)
        .set(headers)
        .expect(200);
      expect(building.body).toMatchObject({
        occupation: 4820,
        occupationRate: 96,
      });
      const list = (await http().get('/api/buildings').set(headers)).body as {
        items: { id: string; occupation: number }[];
      };
      expect(list.items.find((b) => b.id === bldA)?.occupation).toBe(4820);
      expect(list.items.find((b) => b.id === bldA2)?.occupation).toBe(0);
    });

    it('refuses a lot, an entry or a larger initial count that exceed the capacity', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const tooBig = await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ initialCount: 5001 }))
        .expect(400);
      expect((tooBig.body as Msg).message).toBe(
        'Capacité du bâtiment dépassée (5001 / 5000)',
      );
      const { id } = await createLot(headers, { initialCount: 4900 });
      const second = await http()
        .post('/api/batches')
        .set(headers)
        .send(lot({ initialCount: 200 }))
        .expect(400);
      expect((second.body as Msg).message).toBe(
        'Capacité du bâtiment dépassée (5100 / 5000)',
      );
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'ENTREE', date: daysAgo(1), quantity: 101 })
        .expect(400);
      await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ initialCount: 5001 })
        .expect(400);
      // nothing was written by the refused calls
      expect(await prisma.animalBatch.count()).toBe(1);
      expect(await prisma.batchEvent.count()).toBe(0);
    });

    it('a closed lot is empty, houses nobody, and reopens without exceeding the capacity', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const first = await createLot(headers, { initialCount: 4000 });
      await sellAll(headers, first.id);
      await http()
        .post(`/api/batches/${first.id}/close`)
        .set(headers)
        .expect(200);
      const building = await http().get(`/api/buildings/${bldA}`).set(headers);
      expect(building.body).toMatchObject({ occupation: 0 });
      await createLot(headers, { initialCount: 3000 });
      // Closing needs an empty lot, so reopening never adds animals back.
      await http()
        .post(`/api/batches/${first.id}/reopen`)
        .set(headers)
        .expect(200);
      expect(
        (await http().get(`/api/buildings/${bldA}`).set(headers)).body,
      ).toMatchObject({ occupation: 3000 });
    });

    it('refuses deleting a building that houses a lot or has lot history, with 409', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const res = await http()
        .delete(`/api/buildings/${bldA}`)
        .set(headers)
        .expect(409);
      expect((res.body as Msg).message).toBe(
        'Ce bâtiment est occupé ou a un historique',
      );
      await sellAll(headers, id);
      await http().post(`/api/batches/${id}/close`).set(headers).expect(200);
      await http().delete(`/api/buildings/${bldA}`).set(headers).expect(409);
      await http().delete(`/api/buildings/${bldA2}`).set(headers).expect(200);
    });

    it('moves a whole lot with the transfer route and refuses partial or overfilling transfers', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 1000 });
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(3), quantity: 100 })
        .expect(201);
      const transfer = (body: Record<string, unknown>) =>
        http().post(`/api/batches/${id}/transfer`).set(headers).send(body);
      const partial = await transfer({
        toBuildingId: bldA2,
        date: daysAgo(1),
        quantity: 500,
      }).expect(400);
      expect((partial.body as Msg).message).toBe(
        'Transfert partiel non pris en charge : créez un nouveau lot',
      );
      await transfer({
        toBuildingId: bldB,
        date: daysAgo(1),
        quantity: 900,
      }).expect(400);
      await transfer({
        toBuildingId: bldA,
        date: daysAgo(1),
        quantity: 900,
      }).expect(400);
      const moved = await transfer({
        toBuildingId: bldA2,
        date: daysAgo(1),
        quantity: 900,
      }).expect(200);
      expect(moved.body).toMatchObject({ buildingId: bldA2, alive: 900 });
      const occupations = (await http().get('/api/buildings').set(headers))
        .body as {
        items: { id: string; occupation: number }[];
      };
      expect(occupations.items.find((b) => b.id === bldA)?.occupation).toBe(0);
      expect(occupations.items.find((b) => b.id === bldA2)?.occupation).toBe(
        900,
      );

      const patch = await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ buildingId: bldA })
        .expect(400);
      expect((patch.body as Msg).message).toBe(
        'Utilisez le transfert pour changer de bâtiment',
      );
    });
  });

  describe('updating, closing and deleting', () => {
    it('re-checks the history when initialCount or entryDate change', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(10), quantity: 80 })
        .expect(201);
      const low = await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ initialCount: 70 })
        .expect(400);
      expect((low.body as Msg).message).toBe('Effectif insuffisant');
      const late = await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ entryDate: daysAgo(5) })
        .expect(400);
      expect((late.body as Msg).message).toBe(
        "La date est antérieure à l'entrée du lot",
      );
      const ok = await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({
          initialCount: 90,
          supplierName: 'Avipro',
          purchasePrice: 125000.5,
          notes: 'RAS',
        })
        .expect(200);
      expect(ok.body).toMatchObject({ initialCount: 90, alive: 10 });
      await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ code: 'AUTRE' })
        .expect(400);
    });

    it('refuses events, weighings and edits on a closed lot with 409, until it is reopened', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const weighing = (
        await http()
          .post(`/api/batches/${id}/weighings`)
          .set(headers)
          .send({ date: daysAgo(2), sampleSize: 10, averageWeightG: 900 })
          .expect(201)
      ).body as { id: string };
      await sellAll(headers, id);
      const closed = await http()
        .post(`/api/batches/${id}/close`)
        .set(headers)
        .expect(200);
      expect(closed.body).toMatchObject({
        status: 'CLOTURE',
        closedAt: daysAgo(0),
      });
      await http().post(`/api/batches/${id}/close`).set(headers).expect(409);

      const expectClosed = (res: request.Response) => {
        expect(res.status).toBe(409);
        expect((res.body as Msg).message).toBe('Ce lot est clôturé');
      };
      expectClosed(
        await http()
          .post(`/api/batches/${id}/events`)
          .set(headers)
          .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 1 }),
      );
      expectClosed(
        await http()
          .post(`/api/batches/${id}/weighings`)
          .set(headers)
          .send({ date: daysAgo(1), sampleSize: 1, averageWeightG: 1 }),
      );
      expectClosed(
        await http()
          .patch(`/api/batches/${id}/weighings/${weighing.id}`)
          .set(headers)
          .send({ averageWeightG: 1000 }),
      );
      expectClosed(
        await http()
          .delete(`/api/batches/${id}/weighings/${weighing.id}`)
          .set(headers),
      );
      expectClosed(
        await http()
          .patch(`/api/batches/${id}`)
          .set(headers)
          .send({ notes: 'x' }),
      );
      expectClosed(
        await http()
          .post(`/api/batches/${id}/transfer`)
          .set(headers)
          .send({ toBuildingId: bldA2, date: daysAgo(1), quantity: 100 }),
      );

      const reopened = await http()
        .post(`/api/batches/${id}/reopen`)
        .set(headers)
        .expect(200);
      expect(reopened.body).toMatchObject({
        status: 'EN_COURS',
        closedAt: null,
      });
      await http().post(`/api/batches/${id}/reopen`).set(headers).expect(409);
      // The lot was emptied before closing: a new delivery works again.
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'ENTREE', date: daysAgo(0), quantity: 1 })
        .expect(201);
    });

    it('closes a lot only once it is empty, and stops its age at the closing day', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, {
        initialCount: 100,
        entryDate: daysAgo(40),
      });
      const refused = await http()
        .post(`/api/batches/${id}/close`)
        .set(headers)
        .expect(409);
      expect((refused.body as Msg).message).toBe(
        'Ce lot compte encore 100 animaux ; enregistrez leur sortie (vente, réforme, mortalité) avant de le clôturer',
      );
      await sellAll(headers, id);
      const res = await http()
        .post(`/api/batches/${id}/close`)
        .set(headers)
        .expect(200);
      expect(res.body).toMatchObject({
        alive: 0,
        ageDays: 40,
        status: 'CLOTURE',
      });
    });

    it('deletes a lot without history and refuses one with events or weighings', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const clean = await createLot(headers, { initialCount: 100 });
      await http().delete(`/api/batches/${clean.id}`).set(headers).expect(200);
      await http().get(`/api/batches/${clean.id}`).set(headers).expect(404);

      const withEvent = await createLot(headers, { initialCount: 100 });
      await http()
        .post(`/api/batches/${withEvent.id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 1 })
        .expect(201);
      const res = await http()
        .delete(`/api/batches/${withEvent.id}`)
        .set(headers)
        .expect(409);
      expect((res.body as Msg).message).toBe(
        'Ce lot a un historique ; clôturez-le plutôt',
      );

      const withWeighing = await createLot(headers, { initialCount: 100 });
      await http()
        .post(`/api/batches/${withWeighing.id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(1), sampleSize: 5, averageWeightG: 100 })
        .expect(201);
      await http()
        .delete(`/api/batches/${withWeighing.id}`)
        .set(headers)
        .expect(409);
    });

    it('validates and edits weighings', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/batches/${id}/weighings`).set(headers).send(body);
      await post({
        date: daysAgo(1),
        sampleSize: 10,
        averageWeightG: 0,
      }).expect(400);
      await post({
        date: daysAgo(-1),
        sampleSize: 10,
        averageWeightG: 10,
      }).expect(400);
      await post({
        date: daysAgo(31),
        sampleSize: 10,
        averageWeightG: 10,
      }).expect(400);
      const w = (
        await post({
          date: daysAgo(1),
          sampleSize: 10,
          averageWeightG: 500,
        }).expect(201)
      ).body as { id: string };
      const patched = await http()
        .patch(`/api/batches/${id}/weighings/${w.id}`)
        .set(headers)
        .send({ averageWeightG: 520 })
        .expect(200);
      expect(patched.body).toMatchObject({
        averageWeightG: 520,
        sampleSize: 10,
      });
      const list = (
        await http()
          .get(`/api/batches/${id}/weighings`)
          .set(headers)
          .expect(200)
      ).body as {
        total: number;
      };
      expect(list.total).toBe(1);
      await http()
        .delete(`/api/batches/${id}/weighings/${w.id}`)
        .set(headers)
        .expect(200);
      await http()
        .delete(`/api/batches/${id}/weighings/${w.id}`)
        .set(headers)
        .expect(404);
    });
  });

  describe('sub-resources of another batch', () => {
    it('answers 404 for events and weighings reached through the wrong batch or farm', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const one = await createLot(headers, { initialCount: 100 });
      const two = await createLot(headers, {
        type: 'PONDEUSE',
        initialCount: 100,
      });
      const event = (
        await http()
          .post(`/api/batches/${one.id}/events`)
          .set(headers)
          .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 1 })
          .expect(201)
      ).body as { id: string };
      const weighing = (
        await http()
          .post(`/api/batches/${one.id}/weighings`)
          .set(headers)
          .send({ date: daysAgo(1), sampleSize: 5, averageWeightG: 100 })
          .expect(201)
      ).body as { id: string };
      const theirs = await actor('DIRECTEUR_FERME', [farmB], farmB);
      const foreign = await createLot(theirs.headers, {
        buildingId: bldB,
        initialCount: 100,
      });

      for (const other of [two.id, foreign.id]) {
        await http()
          .patch(`/api/batches/${other}/events/${event.id}`)
          .set(headers)
          .send({ quantity: 2 })
          .expect(404);
        await http()
          .delete(`/api/batches/${other}/events/${event.id}`)
          .set(headers)
          .expect(404);
        await http()
          .patch(`/api/batches/${other}/weighings/${weighing.id}`)
          .set(headers)
          .send({ sampleSize: 6 })
          .expect(404);
        await http()
          .delete(`/api/batches/${other}/weighings/${weighing.id}`)
          .set(headers)
          .expect(404);
      }
      // the foreign farm's own batch id with my event id, from the foreign farm
      await http()
        .patch(`/api/batches/${foreign.id}/events/${event.id}`)
        .set(theirs.headers)
        .send({ quantity: 2 })
        .expect(404);
      await http()
        .delete(`/api/batches/${foreign.id}/weighings/${weighing.id}`)
        .set(theirs.headers)
        .expect(404);
      expect(
        await prisma.batchEvent.count({ where: { batchId: one.id } }),
      ).toBe(1);
      expect(await prisma.weighing.count({ where: { batchId: one.id } })).toBe(
        1,
      );
    });

    it('refuses moving the entry date after an existing weighing', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      await http()
        .post(`/api/batches/${id}/weighings`)
        .set(headers)
        .send({ date: daysAgo(20), sampleSize: 5, averageWeightG: 100 })
        .expect(201);
      const res = await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ entryDate: daysAgo(10) })
        .expect(400);
      expect((res.body as Msg).message).toBe(
        "La date est antérieure à l'entrée du lot",
      );
    });

    it('audits a pig breed under porcs and a poultry breed under lots', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      await http()
        .post('/api/breeds')
        .set(headers)
        .send({ name: 'Duroc', species: 'PORCIN' })
        .expect(201);
      await http()
        .post('/api/breeds')
        .set(headers)
        .send({ name: 'Cobb', species: 'AVICOLE' })
        .expect(201);
      const logs = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => `${l.module} ${l.label}`)).toEqual([
        'porcs Duroc',
        'lots Cobb',
      ]);
    });
  });

  describe('permissions by species', () => {
    it('lets AGENT_ELEVAGE record a mortality but not delete the lot or edit it', async () => {
      const director = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(director.headers, { initialCount: 100 });
      const agent = await actor('AGENT_ELEVAGE');
      await http()
        .post(`/api/batches/${id}/events`)
        .set(agent.headers)
        .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 2 })
        .expect(201);
      await http().delete(`/api/batches/${id}`).set(agent.headers).expect(403);
      await http()
        .patch(`/api/batches/${id}`)
        .set(agent.headers)
        .send({ notes: 'x' })
        .expect(403);
      await http()
        .post(`/api/batches/${id}/close`)
        .set(agent.headers)
        .expect(403);
      await http().get(`/api/batches/${id}`).set(agent.headers).expect(200);
    });

    it('serves poultry under lots and pigs under porcs', async () => {
      const director = await actor('DIRECTEUR_FERME');
      const avicole = await actor('RESP_AVICOLE');
      const porcin = await actor('RESP_PORCIN');
      const pigBuilding = await prisma.building.create({
        data: {
          farmId: farmA,
          siteId: (
            await prisma.site.findFirstOrThrow({ where: { farmId: farmA } })
          ).id,
          name: 'Porcherie',
          type: 'PORCIN',
          capacity: 500,
        },
      });
      const pig = (
        await http()
          .post('/api/batches')
          .set(porcin.headers)
          .send({
            species: 'PORCIN',
            type: 'PORCELET',
            buildingId: pigBuilding.id,
            entryDate: daysAgo(10),
            initialCount: 12,
          })
          .expect(201)
      ).body as BatchItem;
      const year = new Date().getUTCFullYear();
      expect(pig.code).toBe(`PO-${year}-01`);
      const fattening = (
        await http()
          .post('/api/batches')
          .set(porcin.headers)
          .send({
            species: 'PORCIN',
            type: 'ENGRAISSEMENT',
            buildingId: pigBuilding.id,
            entryDate: daysAgo(10),
            initialCount: 20,
          })
          .expect(201)
      ).body as BatchItem;
      expect(fattening.code).toBe('LOT-ENG-01');

      // pig lots: porcs permissions
      await http()
        .get(`/api/batches/${pig.id}`)
        .set(avicole.headers)
        .expect(403);
      await http()
        .get('/api/batches?species=PORCIN')
        .set(avicole.headers)
        .expect(403);
      await http()
        .post(`/api/batches/${pig.id}/events`)
        .set(avicole.headers)
        .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 1 })
        .expect(403);
      await http()
        .get('/api/batches?species=PORCIN')
        .set(porcin.headers)
        .expect(200);
      await http()
        .post('/api/batches')
        .set(avicole.headers)
        .send({
          species: 'PORCIN',
          type: 'PORCELET',
          buildingId: pigBuilding.id,
          entryDate: daysAgo(1),
          initialCount: 1,
        })
        .expect(403);

      // poultry lots: lots permissions
      const chick = await createLot(avicole.headers, { initialCount: 10 });
      await http()
        .get(`/api/batches/${chick.id}`)
        .set(porcin.headers)
        .expect(403);
      await http()
        .get('/api/batches?species=AVICOLE')
        .set(porcin.headers)
        .expect(403);
      await http()
        .get('/api/batches?species=AVICOLE')
        .set(director.headers)
        .expect(200);

      // pig occupation reaches the building
      const bld = (
        await http()
          .get(`/api/buildings/${pigBuilding.id}`)
          .set(director.headers)
      ).body as {
        occupation: number;
      };
      expect(bld.occupation).toBe(32);
    });

    it('requires a role that reads lots or porcs to list breeds, and one that creates to write them', async () => {
      const director = await actor('DIRECTEUR_FERME');
      const accountant = await actor('COMPTABLE');
      const commercial = await actor('COMMERCIAL');
      const agent = await actor('AGENT_ELEVAGE');
      const created = await http()
        .post('/api/breeds')
        .set(director.headers)
        .send({ name: 'Ross 308', species: 'AVICOLE' })
        .expect(201);
      const breedId = (created.body as { id: string }).id;
      await http()
        .post('/api/breeds')
        .set(director.headers)
        .send({ name: 'Ross 308', species: 'AVICOLE' })
        .expect(409);
      await http()
        .post('/api/breeds')
        .set(director.headers)
        .send({ name: 'Ross 308', species: 'PORCIN' })
        .expect(201);

      await http().get('/api/breeds').set(accountant.headers).expect(403);
      expect(
        (
          (
            await http()
              .get('/api/breeds?species=AVICOLE')
              .set(commercial.headers)
              .expect(200)
          ).body as unknown[]
        ).length,
      ).toBe(1);
      expect(
        (
          (await http().get('/api/breeds').set(agent.headers).expect(200))
            .body as unknown[]
        ).length,
      ).toBe(2);
      await http()
        .post('/api/breeds')
        .set(commercial.headers)
        .send({ name: 'X', species: 'AVICOLE' })
        .expect(403);
      await http()
        .patch(`/api/breeds/${breedId}`)
        .set(commercial.headers)
        .send({ name: 'Y' })
        .expect(403);
      await http()
        .get('/api/breeds?species=OISEAU')
        .set(director.headers)
        .expect(400);

      await http()
        .patch(`/api/breeds/${breedId}`)
        .set(director.headers)
        .send({ name: 'Ross 708' })
        .expect(200);
      const lotWithBreed = await createLot(director.headers, {
        breedId,
        initialCount: 10,
      });
      expect(lotWithBreed.breedName).toBe('Ross 708');
      const inUse = await http()
        .delete(`/api/breeds/${breedId}`)
        .set(director.headers)
        .expect(409);
      expect((inUse.body as Msg).message).toBe(
        'Cet élément est utilisé ailleurs',
      );
      await http()
        .delete(`/api/batches/${lotWithBreed.id}`)
        .set(director.headers)
        .expect(200);
      await http()
        .delete(`/api/breeds/${breedId}`)
        .set(director.headers)
        .expect(200);
      await http()
        .delete(`/api/breeds/${breedId}`)
        .set(director.headers)
        .expect(404);
    });
  });

  describe('audit', () => {
    it('writes one audit row for every write, in the lot module', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const event = (
        await http()
          .post(`/api/batches/${id}/events`)
          .set(headers)
          .send({ type: 'MORTALITE', date: daysAgo(3), quantity: 5 })
          .expect(201)
      ).body as { id: string };
      await http()
        .patch(`/api/batches/${id}/events/${event.id}`)
        .set(headers)
        .send({ quantity: 6 })
        .expect(200);
      await http()
        .delete(`/api/batches/${id}/events/${event.id}`)
        .set(headers)
        .expect(200);
      const w = (
        await http()
          .post(`/api/batches/${id}/weighings`)
          .set(headers)
          .send({ date: daysAgo(2), sampleSize: 5, averageWeightG: 100 })
          .expect(201)
      ).body as { id: string };
      await http()
        .patch(`/api/batches/${id}/weighings/${w.id}`)
        .set(headers)
        .send({ sampleSize: 6 })
        .expect(200);
      await http()
        .delete(`/api/batches/${id}/weighings/${w.id}`)
        .set(headers)
        .expect(200);
      await http()
        .patch(`/api/batches/${id}`)
        .set(headers)
        .send({ notes: 'ok' })
        .expect(200);
      await http()
        .post(`/api/batches/${id}/transfer`)
        .set(headers)
        .send({ toBuildingId: bldA2, date: daysAgo(1), quantity: 100 })
        .expect(200);
      const sale = (
        await http()
          .post(`/api/batches/${id}/events`)
          .set(headers)
          .send({ type: 'VENTE', date: daysAgo(1), quantity: 100 })
          .expect(201)
      ).body as { id: string };
      await http().post(`/api/batches/${id}/close`).set(headers).expect(200);
      await http().post(`/api/batches/${id}/reopen`).set(headers).expect(200);
      await http()
        .delete(`/api/batches/${id}/events/${sale.id}`)
        .set(headers)
        .expect(200);
      await http().delete(`/api/batches/${id}`).set(headers).expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { module: 'lots' },
        orderBy: { createdAt: 'asc' },
      });
      expect(
        logs.map((l) => `${l.action} ${l.recordId === id ? 'lot' : 'sub'}`),
      ).toEqual([
        'CREATE lot',
        'CREATE sub',
        'UPDATE sub',
        'DELETE sub',
        'CREATE sub',
        'UPDATE sub',
        'DELETE sub',
        'UPDATE lot',
        'UPDATE lot',
        'CREATE sub',
        'UPDATE lot',
        'UPDATE lot',
        'DELETE sub',
        'DELETE lot',
      ]);
      expect(logs.every((l) => l.farmId === farmA)).toBe(true);
      expect(logs[0].label).toMatch(/^LC-\d{4}-01$/);
      expect(logs[13].before).toMatchObject({ initialCount: 100 });
    });

    it('rolls the audit row back together with a refused write', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 10 });
      await http()
        .post(`/api/batches/${id}/events`)
        .set(headers)
        .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 11 })
        .expect(400);
      expect(await prisma.auditLog.count({ where: { module: 'lots' } })).toBe(
        1,
      );
    });
  });

  describe('ledger under concurrency', () => {
    const post = (headers: Record<string, string>, body: unknown) =>
      http()
        .post('/api/batches')
        .set(headers)
        .send(body as object);

    it('lets two lots of different types into one building together when they fit', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const results = await Promise.all([
        post(headers, lot({ type: 'CHAIR', initialCount: 2500 })),
        post(headers, lot({ type: 'PONDEUSE', initialCount: 2500 })),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
    });

    it('refuses exactly the overflowing one of two parallel creations, never a 500', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const results = await Promise.all([
        post(headers, lot({ type: 'CHAIR', initialCount: 3000 })),
        post(headers, lot({ type: 'PONDEUSE', initialCount: 3000 })),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      const refused = results.find((r) => r.status === 400);
      expect((refused?.body as Msg).message).toBe(
        'Capacité du bâtiment dépassée (6000 / 5000)',
      );
    });

    it('serialises a creation racing a transfer into the same building', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const moving = await createLot(headers, {
        buildingId: bldA2,
        initialCount: 3000,
      });
      const race = (creating: number) =>
        Promise.all([
          post(headers, lot({ type: 'PONDEUSE', initialCount: creating })),
          http()
            .post(`/api/batches/${moving.id}/transfer`)
            .set(headers)
            .send({ toBuildingId: bldA, date: daysAgo(1), quantity: 3000 }),
        ]);
      const overflow = await race(3000);
      expect(overflow.some((r) => r.status >= 500)).toBe(false);
      expect(overflow.filter((r) => r.status === 400)).toHaveLength(1);
      const occupied = (await http().get(`/api/buildings/${bldA}`).set(headers))
        .body as {
        occupation: number;
      };
      expect(occupied.occupation).toBeLessThanOrEqual(5000);
    });

    it('serialises a creation racing a transfer when both fit', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const moving = await createLot(headers, {
        buildingId: bldA2,
        initialCount: 2000,
      });
      const results = await Promise.all([
        post(headers, lot({ type: 'PONDEUSE', initialCount: 2000 })),
        http()
          .post(`/api/batches/${moving.id}/transfer`)
          .set(headers)
          .send({ toBuildingId: bldA, date: daysAgo(1), quantity: 2000 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    });

    it('handles parallel creations with explicit codes', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const distinct = await Promise.all([
        post(headers, lot({ code: 'A-1', initialCount: 10 })),
        post(headers, lot({ type: 'PONDEUSE', code: 'A-2', initialCount: 10 })),
      ]);
      expect(distinct.map((r) => r.status)).toEqual([201, 201]);
      const same = await Promise.all([
        post(headers, lot({ code: 'B-1', initialCount: 10 })),
        post(headers, lot({ type: 'PONDEUSE', code: 'B-1', initialCount: 10 })),
      ]);
      expect(same.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('lets exactly one of two parallel mortalities through when together they exceed the live count', async () => {
      const { headers } = await actor('DIRECTEUR_FERME');
      const { id } = await createLot(headers, { initialCount: 100 });
      const results = await Promise.all(
        [1, 2].map(() =>
          http()
            .post(`/api/batches/${id}/events`)
            .set(headers)
            .send({ type: 'MORTALITE', date: daysAgo(1), quantity: 60 }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      const batch = await http().get(`/api/batches/${id}`).set(headers);
      expect(batch.body).toMatchObject({ alive: 40, deaths: 60 });
    });
  });
});
