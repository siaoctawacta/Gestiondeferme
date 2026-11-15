import { INestApplication } from '@nestjs/common';
import type { RequestContext } from '../src/access/decorators';
import type { Role } from '../src/generated/prisma/enums';
import { OperationTargets } from '../src/herd/operation-targets';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Id, World } from './fixtures';
import { createTestApp } from './setup';

describe('OperationTargets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let targets: OperationTargets;
  let director: Awaited<ReturnType<World['actor']>>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
    targets = app.get(OperationTargets);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const ctxFor = (role: Role = 'DIRECTEUR_FERME'): RequestContext => ({
    user: { id: 'u', name: 'U', role, organizationId: world.orgId },
    farmId: world.farmId,
    allFarms: false,
    farmIds: [world.farmId],
  });
  const resolve = (
    ids: { batchId?: string; animalId?: string; buildingId?: string },
    date = daysAgo(1),
    role?: Role,
    module: 'alimentation' | 'sante' = 'sante',
  ) =>
    prisma.$transaction((tx) =>
      targets.resolve(tx, ctxFor(role), ids, new Date(date), { module }),
    );
  const fails = async (p: Promise<unknown>, status: number, text: string) => {
    await expect(p).rejects.toMatchObject({ status, message: text });
  };

  it('resolves a lot with its species, label and building', async () => {
    const lot = await world.lot(director);
    expect(await resolve({ batchId: lot.id })).toMatchObject({
      kind: 'LOT',
      id: lot.id,
      farmId: world.farmId,
      label: lot.code,
      species: 'AVICOLE',
      buildingId: world.poultryBld,
    });
  });

  it('resolves an animal with its tag, species and building', async () => {
    const sow = await world.animal(director);
    expect(await resolve({ animalId: sow.id })).toMatchObject({
      kind: 'ANIMAL',
      id: sow.id,
      label: sow.tag,
      species: 'PORCIN',
      buildingId: world.pigBld,
    });
  });

  it('resolves a building, which carries no species', async () => {
    const target = await resolve({ buildingId: world.otherBld });
    expect(target).toMatchObject({
      kind: 'BATIMENT',
      id: world.otherBld,
      label: 'Magasin',
      buildingId: world.otherBld,
    });
    expect(target.species).toBeUndefined();
  });

  it('wants exactly one id', async () => {
    const lot = await world.lot(director);
    const text = 'Indiquez un lot, un animal ou un bâtiment';
    await fails(resolve({}), 400, text);
    await fails(
      resolve({ batchId: lot.id, buildingId: world.otherBld }),
      400,
      text,
    );
  });

  it('answers 400 for an id of another farm or an unknown id', async () => {
    const other = await prisma.farm.create({
      data: { organizationId: world.orgId, name: 'Ferme B' },
    });
    const site = await prisma.site.create({
      data: { farmId: other.id, name: 'Site B' },
    });
    const bld = await prisma.building.create({
      data: {
        farmId: other.id,
        siteId: site.id,
        name: 'Étable B',
        type: 'PORCIN',
        capacity: 10,
      },
    });
    const animal = await prisma.animal.create({
      data: {
        farmId: other.id,
        tag: 'X-1',
        category: 'TRUIE',
        sex: 'F',
        buildingId: bld.id,
      },
    });
    await fails(resolve({ buildingId: bld.id }), 400, 'Bâtiment invalide');
    await fails(resolve({ animalId: animal.id }), 400, 'Animal invalide');
    await fails(resolve({ batchId: 'nope' }), 400, 'Lot invalide');
  });

  it('refuses a closed lot (409) and an exited animal (409)', async () => {
    const lot = await world.lot(director, { initialCount: 10 });
    await world.post(director, `/batches/${lot.id}/events`, {
      type: 'MORTALITE',
      date: daysAgo(1),
      quantity: 10,
    });
    await world.post(director, `/batches/${lot.id}/close`, {}, 200);
    await fails(resolve({ batchId: lot.id }), 409, 'Ce lot est clôturé');
    const boar = await world.animal(director, { category: 'VERRAT' });
    await world.post(
      director,
      `/animals/${boar.id}/exit`,
      { date: daysAgo(3), reason: 'VENDU' },
      200,
    );
    await fails(
      resolve({ animalId: boar.id }),
      409,
      'Cet animal est sorti du cheptel',
    );
  });

  it('refuses a future date, a date before the lot entry and one before the animal birth', async () => {
    const lot = await world.lot(director, { entryDate: daysAgo(10) });
    const gilt = await world.animal(director, {
      category: 'TRUIE',
      birthDate: daysAgo(20),
    });
    await fails(
      resolve({ batchId: lot.id }, daysAgo(-1)),
      400,
      'La date ne peut pas être dans le futur',
    );
    await fails(
      resolve({ batchId: lot.id }, daysAgo(11)),
      400,
      "La date est antérieure à l'entrée du lot",
    );
    await resolve({ batchId: lot.id }, daysAgo(10));
    await fails(
      resolve({ animalId: gilt.id }, daysAgo(21)),
      400,
      "La date est antérieure à la naissance de l'animal",
    );
    await resolve({ animalId: gilt.id }, daysAgo(20));
    // A building has no entry date.
    await resolve({ buildingId: world.poultryBld }, daysAgo(400));
  });

  it('needs read permission on the species module of a lot or an animal, not of a building', async () => {
    const pigLot = await world.pigLot(director);
    const sow = await world.animal(director);
    await fails(
      resolve({ batchId: pigLot.id }, daysAgo(1), 'RESP_AVICOLE'),
      403,
      'Permission insuffisante',
    );
    await fails(
      resolve({ animalId: sow.id }, daysAgo(1), 'RESP_AVICOLE'),
      403,
      'Permission insuffisante',
    );
    await resolve({ batchId: pigLot.id }, daysAgo(1), 'RESP_PORCIN');
    await resolve({ buildingId: world.pigBld }, daysAgo(1), 'RESP_AVICOLE');
  });

  it('keeps the lot locked until the transaction ends', async () => {
    const lot = await world.lot(director);
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = prisma.$transaction(async (tx) => {
      await targets.resolve(
        tx,
        ctxFor(),
        { batchId: lot.id },
        new Date(daysAgo(1)),
        {
          module: 'sante',
        },
      );
      order.push('first locked');
      await held;
      order.push('first done');
    });
    await new Promise((r) => setTimeout(r, 150));
    const second = prisma.$transaction(async (tx) => {
      await targets.resolve(
        tx,
        ctxFor(),
        { batchId: lot.id },
        new Date(daysAgo(1)),
        {
          module: 'sante',
        },
      );
      order.push('second locked');
    });
    await new Promise((r) => setTimeout(r, 300));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first locked', 'first done', 'second locked']);
  });

  it('is what the feed endpoints use, with only lots and buildings allowed', async () => {
    const sow = await world.animal(director);
    const product = await world.post<Id>(director, '/feed-products', {
      name: 'Aliment',
      kind: 'ALIMENT_COMPLET',
      unitCost: 300,
    });
    const res = await world
      .http()
      .post('/api/feed-distributions')
      .set(director)
      .send({
        animalId: sow.id,
        date: daysAgo(1),
        feedProductId: product.id,
        quantityKg: 5,
      });
    expect(res.status).toBe(400);
  });
});
