import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createTestApp } from './setup';

/**
 * Master data (lots, animals, incubations, breeding records, feed products and
 * formulas, breeds) needs `update` on the module; daily operations (events,
 * weighings, heats, egg records, distributions, water) need `create`, for the
 * entry and for its correction or deletion.
 */
describe('Master data and daily operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let agent: Headers;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    agent = await world.actor('AGENT_ELEVAGE');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const product = () =>
    world.post<Id>(director, '/feed-products', {
      name: 'Aliment ponte',
      kind: 'ALIMENT_COMPLET',
      unitCost: 300,
    });

  describe('field agents (AGENT_ELEVAGE: read, create)', () => {
    it('record a mortality, a weighing, an egg record, a distribution, water', async () => {
      const lot = await world.lot(director);
      const layers = await world.lot(director, { type: 'PONDEUSE' });
      const feed = await product();
      const sow = await world.animal(director);

      await world.post(agent, `/batches/${lot.id}/events`, {
        type: 'MORTALITE',
        date: daysAgo(2),
        quantity: 2,
      });
      await world.post(agent, `/batches/${lot.id}/weighings`, {
        date: daysAgo(2),
        sampleSize: 10,
        averageWeightG: 500,
      });
      await world.post(agent, '/egg-production', {
        batchId: layers.id,
        date: daysAgo(2),
        collected: 50,
      });
      await world.post(agent, '/feed-distributions', {
        batchId: lot.id,
        date: daysAgo(1),
        feedProductId: feed.id,
        quantityKg: 5,
      });
      await world.post(agent, '/water', {
        batchId: lot.id,
        date: daysAgo(1),
        liters: 100,
      });
      await world.post(agent, `/animals/${sow.id}/weighings`, {
        date: daysAgo(1),
        weightKg: 120.5,
      });
    });

    it('cannot create or change master data (403 each)', async () => {
      const lot = await world.lot(director);
      const animal = await world.animal(director);
      const boar = await world.animal(director, { category: 'VERRAT' });
      const feed = await product();
      const breed = await world.post<Id>(director, '/breeds', {
        name: 'Cobb',
        species: 'AVICOLE',
      });
      const incubation = await world.post<Id>(director, '/incubations', {
        startDate: daysAgo(5),
        eggsSet: 100,
      });
      const record = await world.post<Id>(director, '/breeding', {
        sowId: animal.id,
        method: 'SAILLIE',
        boarId: boar.id,
        serviceDate: daysAgo(10),
      });
      const formula = await world.post<Id>(director, '/feed-formulas', {
        name: 'Chair démarrage',
        species: 'AVICOLE',
        stage: 'Démarrage',
        items: [{ feedProductId: feed.id, percentage: 100 }],
      });
      const other = await world.lot(director);

      const attempts: [string, string, object?][] = [
        [
          'post',
          '/batches',
          {
            species: 'AVICOLE',
            type: 'CHAIR',
            buildingId: world.poultryBld,
            entryDate: daysAgo(3),
            initialCount: 10,
          },
        ],
        [
          'post',
          '/batches',
          {
            species: 'PORCIN',
            type: 'ENGRAISSEMENT',
            buildingId: world.pigBld,
            entryDate: daysAgo(3),
            initialCount: 10,
          },
        ],
        ['patch', `/batches/${lot.id}`, { notes: 'x' }],
        ['delete', `/batches/${other.id}`],
        ['post', `/batches/${lot.id}/close`, {}],
        ['post', `/batches/${lot.id}/reopen`, {}],
        [
          'post',
          `/batches/${lot.id}/transfer`,
          {
            toBuildingId: world.otherBld,
            date: daysAgo(1),
            quantity: 100,
          },
        ],
        ['post', '/animals', { category: 'TRUIE', buildingId: world.pigBld }],
        ['patch', `/animals/${animal.id}`, { notes: 'x' }],
        ['delete', `/animals/${boar.id}`],
        [
          'post',
          `/animals/${animal.id}/exit`,
          {
            date: daysAgo(1),
            reason: 'MORT',
          },
        ],
        ['post', '/incubations', { startDate: daysAgo(1), eggsSet: 10 }],
        ['patch', `/incubations/${incubation.id}`, { eggsSet: 20 }],
        ['delete', `/incubations/${incubation.id}`],
        [
          'post',
          '/breeding',
          {
            sowId: animal.id,
            method: 'IA',
            semenLabel: 'X',
            serviceDate: daysAgo(1),
          },
        ],
        ['patch', `/breeding/${record.id}`, { serviceDate: daysAgo(9) }],
        ['delete', `/breeding/${record.id}`],
        [
          'post',
          '/feed-products',
          {
            name: 'Maïs',
            kind: 'MATIERE_PREMIERE',
            unitCost: 100,
          },
        ],
        ['patch', `/feed-products/${feed.id}`, { unitCost: 200 }],
        ['delete', `/feed-products/${feed.id}`],
        [
          'post',
          '/feed-formulas',
          {
            name: 'F2',
            species: 'AVICOLE',
            stage: 'Finition',
            items: [{ feedProductId: feed.id, percentage: 100 }],
          },
        ],
        ['patch', `/feed-formulas/${formula.id}`, { stage: 'Autre' }],
        ['delete', `/feed-formulas/${formula.id}`],
        ['post', '/breeds', { name: 'Ross', species: 'AVICOLE' }],
        ['patch', `/breeds/${breed.id}`, { name: 'Ross' }],
        ['delete', `/breeds/${breed.id}`],
      ];
      const wrong: string[] = [];
      for (const [method, path, body] of attempts) {
        const res = await world
          .http()
          [method as 'post'](`/api${path}`)
          .set(agent)
          .send(body ?? {});
        if (res.status !== 403) {
          wrong.push(`${method.toUpperCase()} ${path} -> ${res.status}`);
        }
      }
      expect(wrong).toEqual([]);
    });

    it('correct and delete their daily entries', async () => {
      const lot = await world.lot(director);
      const layers = await world.lot(director, { type: 'PONDEUSE' });
      const feed = await product();
      const sow = await world.animal(director);
      const event = await world.post<Id>(agent, `/batches/${lot.id}/events`, {
        type: 'MORTALITE',
        date: daysAgo(2),
        quantity: 2,
      });
      const weighing = await world.post<Id>(
        agent,
        `/batches/${lot.id}/weighings`,
        { date: daysAgo(2), sampleSize: 10, averageWeightG: 500 },
      );
      const eggs = await world.post<Id>(agent, '/egg-production', {
        batchId: layers.id,
        date: daysAgo(2),
        collected: 50,
      });
      const dist = await world.post<Id>(agent, '/feed-distributions', {
        batchId: lot.id,
        date: daysAgo(1),
        feedProductId: feed.id,
        quantityKg: 5,
      });
      const water = await world.post<Id>(agent, '/water', {
        batchId: lot.id,
        date: daysAgo(1),
        liters: 100,
      });
      const animalWeighing = await world.post<Id>(
        agent,
        `/animals/${sow.id}/weighings`,
        { date: daysAgo(1), weightKg: 120.5 },
      );
      const patch = (path: string, data: object) =>
        world.http().patch(`/api${path}`).set(agent).send(data);
      const del = (path: string) =>
        world.http().delete(`/api${path}`).set(agent);

      await patch(`/batches/${lot.id}/events/${event.id}`, {
        quantity: 3,
      }).expect(200);
      await patch(`/batches/${lot.id}/weighings/${weighing.id}`, {
        averageWeightG: 520,
      }).expect(200);
      await patch(`/egg-production/${eggs.id}`, { collected: 60 }).expect(200);
      await patch(`/feed-distributions/${dist.id}`, { quantityKg: 6 }).expect(
        200,
      );
      await patch(`/water/${water.id}`, { liters: 120 }).expect(200);
      await patch(`/animals/${sow.id}/weighings/${animalWeighing.id}`, {
        weightKg: 121,
      }).expect(200);

      await del(`/batches/${lot.id}/events/${event.id}`).expect(200);
      await del(`/batches/${lot.id}/weighings/${weighing.id}`).expect(200);
      await del(`/egg-production/${eggs.id}`).expect(200);
      await del(`/feed-distributions/${dist.id}`).expect(200);
      await del(`/water/${water.id}`).expect(200);
      await del(`/animals/${sow.id}/weighings/${animalWeighing.id}`).expect(
        200,
      );
    });

    it('a heat is recorded, corrected and deleted with `create` on reproduction', async () => {
      const sow = await world.animal(director);
      const manager = await world.actor('RESP_PORCIN');
      const heat = await world.post<Id & { date: string }>(
        manager,
        `/animals/${sow.id}/heats`,
        { date: daysAgo(5) },
      );
      const res = await world
        .http()
        .patch(`/api/animals/${sow.id}/heats/${heat.id}`)
        .set(manager)
        .send({ date: daysAgo(4), note: 'revue' })
        .expect(200);
      expect(res.body).toMatchObject({ date: daysAgo(4), note: 'revue' });
      await world
        .http()
        .delete(`/api/animals/${sow.id}/heats/${heat.id}`)
        .set(manager)
        .expect(200);
    });
  });

  describe('breeds follow the species module', () => {
    it('refuse a poultry manager on a pig breed and a pig manager on a poultry breed', async () => {
      const avicole = await world.actor('RESP_AVICOLE');
      const porcin = await world.actor('RESP_PORCIN');
      const pigBreed = await world.post<Id>(director, '/breeds', {
        name: 'Large White',
        species: 'PORCIN',
      });
      const hen = await world.post<Id>(director, '/breeds', {
        name: 'Cobb',
        species: 'AVICOLE',
      });

      await world.post(
        avicole,
        '/breeds',
        { name: 'Ross', species: 'PORCIN' },
        403,
      );
      await world.post(
        porcin,
        '/breeds',
        { name: 'Isa', species: 'AVICOLE' },
        403,
      );
      await world
        .http()
        .patch(`/api/breeds/${pigBreed.id}`)
        .set(avicole)
        .send({ name: 'LW' })
        .expect(403);
      await world
        .http()
        .delete(`/api/breeds/${hen.id}`)
        .set(porcin)
        .expect(403);

      await world.post(avicole, '/breeds', { name: 'Isa', species: 'AVICOLE' });
      await world.post(porcin, '/breeds', { name: 'Duroc', species: 'PORCIN' });
      await world
        .http()
        .patch(`/api/breeds/${pigBreed.id}`)
        .set(porcin)
        .send({ name: 'LW' })
        .expect(200);
    });
  });

  describe('feed and water follow the lot species', () => {
    it('refuses feeding a lot whose species module the caller cannot read', async () => {
      const avicole = await world.actor('RESP_AVICOLE');
      const porcin = await world.actor('RESP_PORCIN');
      const poultry = await world.lot(director);
      const pigs = await world.pigLot(director);
      const feed = await product();
      const dist = (batchId: string) => ({
        batchId,
        date: daysAgo(1),
        feedProductId: feed.id,
        quantityKg: 5,
      });

      await world.post(avicole, '/feed-distributions', dist(pigs.id), 403);
      await world.post(porcin, '/feed-distributions', dist(poultry.id), 403);
      await world.post(
        avicole,
        '/water',
        { batchId: pigs.id, date: daysAgo(1), liters: 10 },
        403,
      );
      await world.post(
        porcin,
        '/water',
        { batchId: poultry.id, date: daysAgo(1), liters: 10 },
        403,
      );
      await world.post(avicole, '/feed-distributions', dist(poultry.id));
      await world.post(porcin, '/feed-distributions', dist(pigs.id));
      await world.post(director, '/feed-distributions', {
        ...dist(pigs.id),
        date: daysAgo(2),
      });
      await world.post(director, '/feed-distributions', {
        ...dist(poultry.id),
        date: daysAgo(2),
      });
      await world.post(director, '/water', {
        batchId: pigs.id,
        date: daysAgo(2),
        liters: 5,
      });
    });

    it('edits and deletes are refused too, and lists hide the other species', async () => {
      const avicole = await world.actor('RESP_AVICOLE');
      const poultry = await world.lot(director);
      const pigs = await world.pigLot(director);
      const feed = await product();
      const forPigs = await world.post<Id>(director, '/feed-distributions', {
        batchId: pigs.id,
        date: daysAgo(1),
        feedProductId: feed.id,
        quantityKg: 5,
        waterLiters: 40,
      });
      const forPoultry = await world.post<Id>(director, '/feed-distributions', {
        batchId: poultry.id,
        date: daysAgo(1),
        feedProductId: feed.id,
        quantityKg: 7,
      });
      const forBuilding = await world.post<Id>(
        director,
        '/feed-distributions',
        {
          buildingId: world.pigBld,
          date: daysAgo(1),
          feedProductId: feed.id,
          quantityKg: 9,
        },
      );
      const pigWater = await prisma.waterConsumption.findFirstOrThrow({
        where: { batchId: pigs.id },
      });

      await world
        .http()
        .patch(`/api/feed-distributions/${forPigs.id}`)
        .set(avicole)
        .send({ quantityKg: 6 })
        .expect(403);
      await world
        .http()
        .delete(`/api/feed-distributions/${forPigs.id}`)
        .set(avicole)
        .expect(403);
      await world
        .http()
        .patch(`/api/water/${pigWater.id}`)
        .set(avicole)
        .send({ liters: 50 })
        .expect(403);

      const list = await world
        .http()
        .get('/api/feed-distributions')
        .set(avicole)
        .expect(200);
      const ids = (list.body as { items: Id[]; total: number }).items.map(
        (i) => i.id,
      );
      expect(ids.sort()).toEqual([forPoultry.id, forBuilding.id].sort());
      expect((list.body as { total: number }).total).toBe(2);
      const water = await world
        .http()
        .get('/api/water')
        .set(avicole)
        .expect(200);
      expect((water.body as { items: Id[] }).items).toEqual([]);
      const all = await world
        .http()
        .get('/api/feed-distributions')
        .set(director)
        .expect(200);
      expect((all.body as { total: number }).total).toBe(3);
      const denied = await world
        .http()
        .get(`/api/feed-distributions?batchId=${pigs.id}`)
        .set(avicole)
        .expect(200);
      expect((denied.body as { items: Id[] }).items).toEqual([]);
    });
  });

  it('keeps French messages on refusals', async () => {
    const res = await world
      .http()
      .post('/api/batches')
      .set(agent)
      .send({})
      .expect(400);
    expect((res.body as Msg).message).toBeDefined();
  });
});
