import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createTestApp } from './setup';

interface Record_ extends Id {
  status: string;
  litterBatchId: string | null;
  failureDate: string | null;
}
interface Animal extends Id {
  tag: string;
  status: string;
  exitDate: string | null;
  exitReason: string | null;
  birthDate: string | null;
}

const msg = (body: unknown) => (body as Msg).message;

describe('Pig and breeding integrity rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    h = await world.actor('DIRECTEUR_FERME');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const getAnimal = async (id: string) =>
    (await http().get(`/api/animals/${id}`).set(h).expect(200)).body as Animal;

  async function gestating(serviceAgo = 120) {
    const sow = await world.animal(h);
    const boar = await world.animal(h, { category: 'VERRAT' });
    const record = await world.post<Record_>(h, '/breeding', {
      sowId: sow.id,
      method: 'SAILLIE',
      boarId: boar.id,
      serviceDate: daysAgo(serviceAgo),
    });
    return { sow, boar, record };
  }

  async function farrowed(over: Record<string, unknown> = {}) {
    const { sow, boar, record } = await gestating();
    const done = (
      await http()
        .post(`/api/breeding/${record.id}/farrowing`)
        .set(h)
        .send({
          date: daysAgo(30),
          bornTotal: 13,
          bornAlive: 12,
          stillborn: 1,
          buildingId: world.pigBld,
          ...over,
        })
        .expect(200)
    ).body as Record_;
    return { sow, boar, record: done };
  }

  const wean = (id: string, count = 10, date = daysAgo(5)) =>
    http()
      .post(`/api/breeding/${id}/weaning`)
      .set(h)
      .send({ date, weanedCount: count });

  describe('system-generated events (D1)', () => {
    it('refuses to edit or delete the weaning write-off through the batch events routes', async () => {
      const { record } = await farrowed();
      await wean(record.id).expect(200);
      const event = await prisma.batchEvent.findFirstOrThrow({
        where: { batchId: record.litterBatchId! },
      });
      expect(event.sourceType).toBe('BREEDING');
      const message =
        "Cet événement provient d'une autre opération ; corrigez l'opération d'origine";
      const patch = await http()
        .patch(`/api/batches/${record.litterBatchId}/events/${event.id}`)
        .set(h)
        .send({ quantity: 1 })
        .expect(409);
      expect(msg(patch.body)).toBe(message);
      const del = await http()
        .delete(`/api/batches/${record.litterBatchId}/events/${event.id}`)
        .set(h)
        .expect(409);
      expect(msg(del.body)).toBe(message);
      expect(await prisma.batchEvent.count()).toBe(1);
    });
  });

  describe('linked batches (D2)', () => {
    const message =
      "Ce lot provient d'une mise bas ou d'une éclosion ; son effectif et sa date d'entrée ne sont pas modifiables";

    it('fixes the count and entry date of a litter batch, not its notes', async () => {
      const { record } = await farrowed();
      const id = record.litterBatchId;
      const batch = await prisma.animalBatch.findUniqueOrThrow({
        where: { id: id! },
      });
      expect(batch).toMatchObject({
        sourceType: 'FARROWING',
        sourceId: record.id,
      });
      for (const body of [{ initialCount: 11 }, { entryDate: daysAgo(31) }]) {
        const res = await http()
          .patch(`/api/batches/${id}`)
          .set(h)
          .send(body)
          .expect(400);
        expect(msg(res.body)).toBe(message);
      }
      await http()
        .patch(`/api/batches/${id}`)
        .set(h)
        .send({ notes: 'Portée A' })
        .expect(200);
    });

    it('fixes the count and entry date of a chick batch', async () => {
      const layers = await world.lot(h, { type: 'PONDEUSE' });
      const inc = await world.post<Id>(h, '/incubations', {
        startDate: daysAgo(25),
        eggsSet: 100,
        sourceBatchId: layers.id,
      });
      const hatched = (
        await http()
          .post(`/api/incubations/${inc.id}/hatch`)
          .set(h)
          .send({
            date: daysAgo(4),
            chicksHatched: 80,
            buildingId: world.poultryBld,
          })
          .expect(200)
      ).body as { chickBatchId: string };
      const batch = await prisma.animalBatch.findUniqueOrThrow({
        where: { id: hatched.chickBatchId },
      });
      expect(batch).toMatchObject({ sourceType: 'HATCH', sourceId: inc.id });
      for (const body of [{ initialCount: 79 }, { entryDate: daysAgo(5) }]) {
        const res = await http()
          .patch(`/api/batches/${hatched.chickBatchId}`)
          .set(h)
          .send(body)
          .expect(400);
        expect(msg(res.body)).toBe(message);
      }
      await http()
        .patch(`/api/batches/${hatched.chickBatchId}`)
        .set(h)
        .send({ supplierName: 'Couvoir' })
        .expect(200);
    });

    it('leaves a purchased lot free to change', async () => {
      const lot = await world.pigLot(h);
      await http()
        .patch(`/api/batches/${lot.id}`)
        .set(h)
        .send({ initialCount: 90 })
        .expect(200);
    });
  });

  describe('dependent dates (D3)', () => {
    it('refuses moving a lot entry date past egg records, feed and water', async () => {
      const feed = await world.post<Id>(h, '/feed-products', {
        name: 'Aliment',
        kind: 'ALIMENT_COMPLET',
        unitCost: 300,
      });
      const layers = await world.lot(h, { type: 'PONDEUSE' });
      await world.post(h, '/egg-production', {
        batchId: layers.id,
        date: daysAgo(20),
        collected: 10,
      });
      const fed = await world.lot(h);
      await world.post(h, '/feed-distributions', {
        batchId: fed.id,
        date: daysAgo(20),
        feedProductId: feed.id,
        quantityKg: 5,
      });
      const watered = await world.lot(h);
      await world.post(h, '/water', {
        batchId: watered.id,
        date: daysAgo(20),
        liters: 50,
      });
      for (const lot of [layers, fed, watered]) {
        const res = await http()
          .patch(`/api/batches/${lot.id}`)
          .set(h)
          .send({ entryDate: daysAgo(10) })
          .expect(400);
        expect(msg(res.body)).toBe("La date est antérieure à l'entrée du lot");
        await http()
          .patch(`/api/batches/${lot.id}`)
          .set(h)
          .send({ entryDate: daysAgo(25) })
          .expect(200);
      }
    });

    it('refuses a birth date after heats, services, farrowings and weanings', async () => {
      const sow = await world.animal(h, { birthDate: daysAgo(400) });
      await world.post(h, `/animals/${sow.id}/heats`, { date: daysAgo(100) });
      const res = await http()
        .patch(`/api/animals/${sow.id}`)
        .set(h)
        .send({ birthDate: daysAgo(50) })
        .expect(400);
      expect(msg(res.body)).toMatch(/postérieure/);

      const other = await world.animal(h, { birthDate: daysAgo(500) });
      const boar = await world.animal(h, { category: 'VERRAT' });
      await world.post(h, '/breeding', {
        sowId: other.id,
        method: 'SAILLIE',
        boarId: boar.id,
        serviceDate: daysAgo(60),
      });
      await http()
        .patch(`/api/animals/${other.id}`)
        .set(h)
        .send({ birthDate: daysAgo(30) })
        .expect(400);
      await http()
        .patch(`/api/animals/${other.id}`)
        .set(h)
        .send({ birthDate: daysAgo(80) })
        .expect(200);
    });
  });

  describe('audit of side effects (D6)', () => {
    it('audits each breeding record failed by the death of its sow', async () => {
      const { sow, record } = await gestating();
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ date: daysAgo(2), reason: 'MORT' })
        .expect(200);
      const rows = await prisma.auditLog.findMany({
        where: { module: 'reproduction', recordId: record.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      expect(rows[1].before).toMatchObject({ status: 'GESTATION' });
      expect(rows[1].after).toMatchObject({
        status: 'ECHEC',
        failureDate: daysAgo(2),
      });
    });

    it('audits the mortality event that weaning writes', async () => {
      const { record } = await farrowed();
      await wean(record.id, 10).expect(200);
      const event = await prisma.batchEvent.findFirstOrThrow({
        where: { batchId: record.litterBatchId! },
      });
      const rows = await prisma.auditLog.findMany({
        where: { module: 'porcs', recordId: event.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'CREATE' });
      expect(rows[0].after).toMatchObject({
        type: 'MORTALITE',
        quantity: 2,
      });
    });
  });

  describe('reinstating a mistaken exit (D8)', () => {
    it('refuses an animal that is still on the farm', async () => {
      const sow = await world.animal(h);
      const res = await http()
        .post(`/api/animals/${sow.id}/reinstate`)
        .set(h)
        .expect(409);
      expect(msg(res.body)).toBe("Cet animal n'est pas sorti du cheptel");
    });

    it('puts a sold animal back, clears the exit and audits it', async () => {
      const boar = await world.animal(h, { category: 'VERRAT' });
      await http()
        .post(`/api/animals/${boar.id}/exit`)
        .set(h)
        .send({ date: daysAgo(3), reason: 'VENDU' })
        .expect(200);
      const res = await http()
        .post(`/api/animals/${boar.id}/reinstate`)
        .set(h)
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'ACTIF',
        exitDate: null,
        exitReason: null,
      });
      const audit = await prisma.auditLog.findMany({
        where: { module: 'porcs', recordId: boar.id, action: 'UPDATE' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit).toHaveLength(2);
      expect(audit[1].before).toMatchObject({ status: 'VENDU' });
      expect(audit[1].after).toMatchObject({ status: 'ACTIF' });
    });

    it('brings back the gestation a death had failed, and the sow status', async () => {
      const { sow, record } = await gestating();
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ date: daysAgo(2), reason: 'MORT' })
        .expect(200);
      expect(
        (
          await prisma.breedingRecord.findUniqueOrThrow({
            where: { id: record.id },
          })
        ).status,
      ).toBe('ECHEC');
      const res = await http()
        .post(`/api/animals/${sow.id}/reinstate`)
        .set(h)
        .expect(200);
      expect((res.body as Animal).status).toBe('GESTANTE');
      const row = await prisma.breedingRecord.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(row).toMatchObject({ status: 'GESTATION', failureDate: null });
      const rows = await prisma.auditLog.findMany({
        where: { module: 'reproduction', recordId: record.id },
      });
      expect(rows.map((r) => r.action).sort()).toEqual([
        'CREATE',
        'UPDATE',
        'UPDATE',
      ]);
    });

    it('puts a nursing sow that died back as ALLAITANTE while her litter is not weaned', async () => {
      const { sow } = await farrowed();
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ date: daysAgo(2), reason: 'MORT' })
        .expect(200);
      const res = await http()
        .post(`/api/animals/${sow.id}/reinstate`)
        .set(h)
        .expect(200);
      expect((res.body as Animal).status).toBe('ALLAITANTE');
    });

    it('refuses when something was recorded after the exit date', async () => {
      const sow = await world.animal(h);
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ date: daysAgo(5), reason: 'REFORME' })
        .expect(200);
      await prisma.animalWeighing.create({
        data: {
          farmId: world.farmId,
          animalId: sow.id,
          date: new Date(daysAgo(1)),
          weightKg: 150,
        },
      });
      const res = await http()
        .post(`/api/animals/${sow.id}/reinstate`)
        .set(h)
        .expect(409);
      expect(msg(res.body)).toBe(
        'Des données ont été enregistrées après la sortie de cet animal',
      );
      expect((await getAnimal(sow.id)).status).toBe('REFORME');
    });

    it('checks the building capacity again', async () => {
      const small = await prisma.building.create({
        data: {
          farmId: world.farmId,
          siteId: world.siteId,
          name: 'Loge',
          type: 'PORCIN',
          capacity: 1,
        },
      });
      const first = await world.animal(h, { buildingId: small.id });
      await http()
        .post(`/api/animals/${first.id}/exit`)
        .set(h)
        .send({ date: daysAgo(3), reason: 'VENDU' })
        .expect(200);
      await world.animal(h, { buildingId: small.id });
      const res = await http()
        .post(`/api/animals/${first.id}/reinstate`)
        .set(h)
        .expect(400);
      expect(msg(res.body)).toMatch(/Capacité du bâtiment dépassée/);
      expect((await getAnimal(first.id)).status).toBe('VENDU');
    });
  });

  describe('related dates (D9)', () => {
    it('refuses an exit before the last weighing or heat', async () => {
      const weighed = await world.animal(h);
      await world.post(h, `/animals/${weighed.id}/weighings`, {
        date: daysAgo(5),
        weightKg: 100,
      });
      const res = await http()
        .post(`/api/animals/${weighed.id}/exit`)
        .set(h)
        .send({ date: daysAgo(10), reason: 'VENDU' })
        .expect(400);
      expect(msg(res.body)).toBe(
        'La date de sortie est antérieure à la dernière pesée',
      );
      const heated = await world.animal(h);
      await world.post(h, `/animals/${heated.id}/heats`, { date: daysAgo(5) });
      const heat = await http()
        .post(`/api/animals/${heated.id}/exit`)
        .set(h)
        .send({ date: daysAgo(10), reason: 'VENDU' })
        .expect(400);
      expect(msg(heat.body)).toBe(
        'La date de sortie est antérieure à la dernière chaleur',
      );
      await http()
        .post(`/api/animals/${heated.id}/exit`)
        .set(h)
        .send({ date: daysAgo(5), reason: 'VENDU' })
        .expect(200);
    });

    it('refuses weaning on a closed litter even when no death is implied', async () => {
      const { record } = await farrowed();
      await http()
        .post(`/api/batches/${record.litterBatchId}/events`)
        .set(h)
        .send({ type: 'VENTE', date: daysAgo(10), quantity: 12 })
        .expect(201);
      await http()
        .post(`/api/batches/${record.litterBatchId}/close`)
        .set(h)
        .expect(200);
      const res = await wean(record.id, 0).expect(409);
      expect(msg(res.body)).toBe('Ce lot est clôturé');
    });

    it('refuses a hatch before the candling', async () => {
      const inc = await world.post<Id>(h, '/incubations', {
        startDate: daysAgo(25),
        eggsSet: 100,
      });
      await http()
        .post(`/api/incubations/${inc.id}/candling`)
        .set(h)
        .send({ date: daysAgo(10), fertileEggs: 80 })
        .expect(200);
      const res = await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(h)
        .send({
          date: daysAgo(12),
          chicksHatched: 60,
          buildingId: world.poultryBld,
        })
        .expect(400);
      expect(msg(res.body)).toBe('La date est antérieure au mirage');
      await http()
        .post(`/api/incubations/${inc.id}/hatch`)
        .set(h)
        .send({
          date: daysAgo(10),
          chicksHatched: 60,
          buildingId: world.poultryBld,
        })
        .expect(200);
    });

    it('refuses an incubation that starts before its source lot entered', async () => {
      const layers = await world.lot(h, {
        type: 'PONDEUSE',
        entryDate: daysAgo(10),
      });
      const res = await http()
        .post('/api/incubations')
        .set(h)
        .send({ startDate: daysAgo(15), eggsSet: 50, sourceBatchId: layers.id })
        .expect(400);
      expect(msg(res.body)).toBe("La date est antérieure à l'entrée du lot");
      const ok = await world.post<Id>(h, '/incubations', {
        startDate: daysAgo(8),
        eggsSet: 50,
        sourceBatchId: layers.id,
      });
      await http()
        .patch(`/api/incubations/${ok.id}`)
        .set(h)
        .send({ startDate: daysAgo(15) })
        .expect(400);
      const free = await world.post<Id>(h, '/incubations', {
        startDate: daysAgo(15),
        eggsSet: 50,
      });
      await http()
        .patch(`/api/incubations/${free.id}`)
        .set(h)
        .send({ sourceBatchId: layers.id })
        .expect(400);
    });

    it('keeps each species in its own buildings, AUTRE takes both', async () => {
      const wrong = 'Ce bâtiment est réservé à une autre espèce';
      const bad = async (res: Promise<{ body: unknown }>) =>
        expect(msg((await res).body)).toBe(wrong);
      const post = (path: string, body: object, status = 400) =>
        http().post(`/api${path}`).set(h).send(body).expect(status);

      await bad(
        post('/batches', {
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: world.pigBld,
          entryDate: daysAgo(3),
          initialCount: 10,
        }),
      );
      await bad(
        post('/batches', {
          species: 'PORCIN',
          type: 'ENGRAISSEMENT',
          buildingId: world.poultryBld,
          entryDate: daysAgo(3),
          initialCount: 10,
        }),
      );
      await bad(
        post('/animals', { category: 'TRUIE', buildingId: world.poultryBld }),
      );
      const sow = await world.animal(h);
      await bad(
        http()
          .patch(`/api/animals/${sow.id}`)
          .set(h)
          .send({ buildingId: world.poultryBld })
          .expect(400),
      );
      const lot = await world.lot(h);
      await bad(
        post(`/batches/${lot.id}/transfer`, {
          toBuildingId: world.pigBld,
          date: daysAgo(1),
          quantity: 100,
        }),
      );
      await bad(
        post('/incubations', { startDate: daysAgo(5), eggsSet: 10 }, 201).then(
          async (r) => {
            const hatch = await http()
              .post(`/api/incubations/${(r.body as Id).id}/hatch`)
              .set(h)
              .send({
                date: daysAgo(1),
                chicksHatched: 5,
                buildingId: world.pigBld,
              })
              .expect(400);
            return hatch;
          },
        ),
      );
      const { record } = await gestating();
      await bad(
        post(`/breeding/${record.id}/farrowing`, {
          date: daysAgo(30),
          bornTotal: 10,
          bornAlive: 10,
          stillborn: 0,
          buildingId: world.poultryBld,
        }),
      );

      await post(
        '/batches',
        {
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: world.otherBld,
          entryDate: daysAgo(3),
          initialCount: 10,
        },
        201,
      );
      await post(
        '/batches',
        {
          species: 'PORCIN',
          type: 'ENGRAISSEMENT',
          buildingId: world.otherBld,
          entryDate: daysAgo(3),
          initialCount: 10,
        },
        201,
      );
      await post(
        '/animals',
        { category: 'VERRAT', buildingId: world.otherBld },
        201,
      );
    });
  });

  describe('animal weighings and heats (D10)', () => {
    it('corrects and deletes a weighing with the same date rules as the creation', async () => {
      const sow = await world.animal(h, { birthDate: daysAgo(100) });
      const w = await world.post<Id>(h, `/animals/${sow.id}/weighings`, {
        date: daysAgo(5),
        weightKg: 100,
      });
      const path = `/api/animals/${sow.id}/weighings/${w.id}`;
      const ok = await http()
        .patch(path)
        .set(h)
        .send({ weightKg: 104.5, date: daysAgo(4) })
        .expect(200);
      expect(ok.body).toMatchObject({
        id: w.id,
        animalId: sow.id,
        weightKg: 104.5,
        date: daysAgo(4),
      });
      await http()
        .patch(path)
        .set(h)
        .send({ date: daysAgo(-1) })
        .expect(400);
      await http()
        .patch(path)
        .set(h)
        .send({ date: daysAgo(200) })
        .expect(400);
      await http()
        .patch(`/api/animals/${sow.id}/weighings/unknown`)
        .set(h)
        .send({ weightKg: 1 })
        .expect(404);
      const audit = await prisma.auditLog.findMany({
        where: { module: 'porcs', recordId: w.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['CREATE', 'UPDATE']);
      await http().delete(path).set(h).expect(200);
      expect(await prisma.animalWeighing.count()).toBe(0);
      expect(
        (
          await prisma.auditLog.findMany({
            where: { module: 'porcs', recordId: w.id },
          })
        ).map((a) => a.action),
      ).toContain('DELETE');
      await http().delete(path).set(h).expect(404);
    });

    it('refuses weighing changes on an animal that left the herd', async () => {
      const sow = await world.animal(h);
      const w = await world.post<Id>(h, `/animals/${sow.id}/weighings`, {
        date: daysAgo(5),
        weightKg: 100,
      });
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ date: daysAgo(2), reason: 'VENDU' })
        .expect(200);
      const path = `/api/animals/${sow.id}/weighings/${w.id}`;
      await http().patch(path).set(h).send({ weightKg: 1 }).expect(409);
      await http().delete(path).set(h).expect(409);
    });

    it('corrects a heat within the date rules', async () => {
      const sow = await world.animal(h, { birthDate: daysAgo(100) });
      const heat = await world.post<Id>(h, `/animals/${sow.id}/heats`, {
        date: daysAgo(5),
      });
      const path = `/api/animals/${sow.id}/heats/${heat.id}`;
      await http()
        .patch(path)
        .set(h)
        .send({ date: daysAgo(-1) })
        .expect(400);
      await http()
        .patch(path)
        .set(h)
        .send({ date: daysAgo(200) })
        .expect(400);
      await http()
        .patch(`/api/animals/${sow.id}/heats/unknown`)
        .set(h)
        .send({ note: 'x' })
        .expect(404);
      const ok = await http()
        .patch(path)
        .set(h)
        .send({ date: daysAgo(3), note: 'forte' })
        .expect(200);
      expect(ok.body).toMatchObject({ date: daysAgo(3), note: 'forte' });
      expect(
        (
          await prisma.auditLog.findMany({
            where: { module: 'reproduction', recordId: heat.id },
            orderBy: { createdAt: 'asc' },
          })
        ).map((a) => a.action),
      ).toEqual(['CREATE', 'UPDATE']);
    });
  });

  describe('database checks (D11)', () => {
    it('rejects negative counts and litters larger than the born total', async () => {
      const { record } = await farrowed();
      const bad = (data: object) =>
        prisma.breedingRecord.update({ where: { id: record.id }, data });
      await expect(bad({ bornTotal: -1 })).rejects.toThrow();
      await expect(bad({ bornAlive: -1 })).rejects.toThrow();
      await expect(bad({ stillborn: -1 })).rejects.toThrow();
      await expect(bad({ weanedCount: -1 })).rejects.toThrow();
      await expect(bad({ bornAlive: 12, stillborn: 2 })).rejects.toThrow();
      await expect(
        bad({ bornTotal: 20, bornAlive: 12 }),
      ).resolves.toBeDefined();
    });

    it('rejects a sex that does not match the category', async () => {
      const sow = await world.animal(h);
      const boar = await world.animal(h, { category: 'VERRAT' });
      await expect(
        prisma.animal.update({ where: { id: sow.id }, data: { sex: 'M' } }),
      ).rejects.toThrow();
      await expect(
        prisma.animal.update({ where: { id: boar.id }, data: { sex: 'F' } }),
      ).rejects.toThrow();
    });
  });

  describe('pig herd list (D13)', () => {
    it('keeps the French label and adds the category code', async () => {
      await world.animal(h);
      await world.animal(h, { category: 'VERRAT' });
      await world.animal(h, { category: 'COCHETTE' });
      await world.pigLot(h);
      await world.pigLot(h, { type: 'PORCELET' });
      const res = await http().get('/api/pig-herd').set(h).expect(200);
      const rows = (
        res.body as { items: { category: string; categoryCode: string }[] }
      ).items;
      expect(rows.map((r) => [r.category, r.categoryCode]).sort()).toEqual(
        [
          ['Truie', 'TRUIE'],
          ['Verrat', 'VERRAT'],
          ['Cochette', 'COCHETTE'],
          ['Engraissement', 'ENGRAISSEMENT'],
          ['Porcelets', 'PORCELET'],
        ].sort(),
      );
    });
  });
});
