import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Msg, World } from './fixtures';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

interface Overview {
  building: { id: string; name: string; type: string; status: string };
  site: { id: string; name: string };
  occupation: number;
  capacity: number;
  lots: { id: string; code: string; species: string; alive: number }[] | null;
  animals: number | null;
  equipment:
    | {
        id: string;
        name: string;
        condition: string;
        nextMaintenance: string | null;
      }[]
    | null;
  openTasks: number | null;
  lastHealthActs:
    | {
        id: string;
        date: string;
        type: string;
        productName: string | null;
        status: string;
      }[]
    | null;
}

describe('Building overview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let admin: Headers;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    admin = await world.actor('SUPER_ADMIN');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const overview = (h: Headers, id: string) =>
    world.http().get(`/api/buildings/${id}/overview`).set(h);

  async function populate() {
    const lot = await world.lot(admin, { initialCount: 5000 });
    await world.post(admin, `/batches/${lot.id}/events`, {
      type: 'MORTALITE',
      date: daysAgo(2),
      quantity: 180,
      cause: 'Chaleur',
    });
    const user = await prisma.user.findFirstOrThrow();
    const equipment = await prisma.equipment.create({
      data: {
        farmId: world.farmId,
        name: 'Ventilateur 1',
        type: 'VENTILATEUR',
        buildingId: world.poultryBld,
        nextMaintenanceDate: new Date(daysAgo(-10)),
      },
    });
    await prisma.equipment.create({
      data: {
        farmId: world.farmId,
        name: 'Pompe réformée',
        type: 'POMPE',
        buildingId: world.poultryBld,
        retiredAt: new Date(daysAgo(30)),
      },
    });
    await prisma.equipment.create({
      data: {
        farmId: world.farmId,
        name: 'Balance ailleurs',
        type: 'BALANCE',
        buildingId: world.pigBld,
      },
    });
    for (const [title, status] of [
      ['Laver', 'A_FAIRE'],
      ['Contrôler', 'EN_COURS'],
      ['Fini', 'TERMINEE'],
    ] as const) {
      await prisma.task.create({
        data: {
          farmId: world.farmId,
          title,
          status,
          ...(status === 'TERMINEE'
            ? { completedDate: new Date(daysAgo(0)), completedById: user.id }
            : {}),
          buildingId: world.poultryBld,
          dueDate: new Date(daysAgo(-1)),
          createdById: user.id,
        },
      });
    }
    await prisma.task.create({
      data: {
        farmId: world.farmId,
        title: 'Ailleurs',
        buildingId: world.pigBld,
        dueDate: new Date(daysAgo(-1)),
        createdById: user.id,
      },
    });
    const acts = [];
    for (const [n, buildingId] of [
      [1, world.poultryBld],
      [2, world.poultryBld],
      [3, world.pigBld],
    ] as const) {
      acts.push(
        await world.post<{ id: string }>(admin, '/health-acts', {
          date: daysAgo(n),
          type: 'DESINFECTION',
          status: 'REALISE',
          buildingId,
          productName: `Produit ${n}`,
        }),
      );
    }
    return { lot, equipment, acts };
  }

  it('shows the building, its site, its occupation and everything in it', async () => {
    const { lot, equipment, acts } = await populate();
    const res = await overview(admin, world.poultryBld).expect(200);
    const o = res.body as Overview;
    expect(o.building).toEqual({
      id: world.poultryBld,
      name: 'Poulailler',
      type: 'AVICOLE',
      status: 'ACTIF',
    });
    expect(o.site).toEqual({ id: world.siteId, name: 'Site A' });
    expect(o.occupation).toBe(4820);
    expect(o.capacity).toBe(100000);
    expect(o.lots).toEqual([
      { id: lot.id, code: lot.code, species: 'AVICOLE', alive: 4820 },
    ]);
    expect(o.animals).toBe(0);
    expect(o.equipment).toEqual([
      {
        id: equipment.id,
        name: 'Ventilateur 1',
        condition: 'BON',
        nextMaintenance: daysAgo(-10),
      },
    ]);
    expect(o.openTasks).toBe(2);
    expect(o.lastHealthActs).toEqual([
      {
        id: acts[0].id,
        date: daysAgo(1),
        type: 'DESINFECTION',
        productName: 'Produit 1',
        status: 'REALISE',
      },
      {
        id: acts[1].id,
        date: daysAgo(2),
        type: 'DESINFECTION',
        productName: 'Produit 2',
        status: 'REALISE',
      },
    ]);
  });

  it('counts the individual animals of a pig building and lists its pig lot', async () => {
    const sow = await world.animal(admin);
    const lot = await world.pigLot(admin, { initialCount: 12 });
    const o = (await overview(admin, world.pigBld).expect(200))
      .body as Overview;
    expect(o.animals).toBe(1);
    expect(o.occupation).toBe(13);
    expect(o.lots).toEqual([
      { id: lot.id, code: lot.code, species: 'PORCIN', alive: 12 },
    ]);
    expect(sow.id).toBeTruthy();
  });

  it('leaves out a closed lot and caps the health acts at five', async () => {
    const lot = await world.lot(admin);
    await world.post(admin, `/batches/${lot.id}/events`, {
      type: 'REFORME',
      date: daysAgo(1),
      quantity: 100,
    });
    await world.post(admin, `/batches/${lot.id}/close`, {}, 200);
    for (let n = 1; n <= 7; n++) {
      await world.post(admin, '/health-acts', {
        date: daysAgo(n),
        type: 'DESINFECTION',
        status: 'REALISE',
        buildingId: world.poultryBld,
      });
    }
    const o = (await overview(admin, world.poultryBld).expect(200))
      .body as Overview;
    expect(o.lots).toEqual([]);
    expect(o.lastHealthActs).toHaveLength(5);
    expect(o.lastHealthActs![0].date).toBe(daysAgo(1));
  });

  it('gives null for each part the role cannot read', async () => {
    await populate();
    // Veterinarian: lots, porcs, batiments, taches and sante, but no equipment.
    const vet = (
      await overview(await world.actor('VETERINAIRE'), world.poultryBld).expect(
        200,
      )
    ).body as Overview;
    expect(vet.equipment).toBeNull();
    expect(vet.lots).toHaveLength(1);
    expect(vet.animals).toBe(0);
    expect(vet.openTasks).toBe(2);
    expect(vet.lastHealthActs).toHaveLength(2);
    // Poultry manager: no pig module, so no animals; only the poultry lots of a mixed building.
    const resp = (
      await overview(
        await world.actor('RESP_AVICOLE'),
        world.poultryBld,
      ).expect(200)
    ).body as Overview;
    expect(resp.animals).toBeNull();
    expect(resp.lots).toHaveLength(1);
    expect(resp.equipment).toHaveLength(1);
    // Agent d'élevage: no tasks read beyond... he reads them; no sante write needed.
    const pigLot = await world.pigLot(admin);
    const poultryOnly = (
      await overview(await world.actor('RESP_AVICOLE'), world.pigBld).expect(
        200,
      )
    ).body as Overview;
    expect(poultryOnly.lots).toEqual([]);
    expect(pigLot.id).toBeTruthy();
  });

  it('lists in the health acts only what the role reads: the species scope of the health list', async () => {
    const pigLot = await world.pigLot(admin);
    const sow = await prisma.animal.create({
      data: {
        farmId: world.farmId,
        tag: 'TR-OV',
        category: 'TRUIE',
        sex: 'F',
        buildingId: world.pigBld,
        birthDate: new Date('2025-01-01'),
      },
    });
    const user = await prisma.user.findFirstOrThrow();
    const act = (day: number, target: Record<string, string>) =>
      prisma.healthAct.create({
        data: {
          farmId: world.farmId,
          type: target.buildingId ? 'DESINFECTION' : 'TRAITEMENT',
          date: new Date(daysAgo(day)),
          status: 'REALISE',
          doneDate: new Date(daysAgo(day)),
          createdById: user.id,
          productName: `Acte ${day}`,
          ...target,
        },
      });
    await act(1, { buildingId: world.pigBld });
    await act(2, { batchId: pigLot.id });
    await act(3, { animalId: sow.id });
    const names = async (role: Parameters<World['actor']>[0]) =>
      (
        (await overview(await world.actor(role), world.pigBld).expect(200))
          .body as Overview
      ).lastHealthActs!.map((a) => a.productName);
    // The poultry manager reads neither the pig lot nor the pig animals: only the act on the building.
    expect(await names('RESP_AVICOLE')).toEqual(['Acte 1']);
    // The pig manager and the director see everything the health list shows.
    expect(await names('RESP_PORCIN')).toEqual(['Acte 1', 'Acte 2', 'Acte 3']);
    expect(await names('DIRECTEUR_FERME')).toEqual([
      'Acte 1',
      'Acte 2',
      'Acte 3',
    ]);
  });

  it('is refused to a role without batiments read, and hidden from other farms', async () => {
    await overview(await world.actor('RESP_STOCK'), world.poultryBld).expect(
      403,
    );
    await overview(await world.actor('COMMERCIAL'), world.poultryBld).expect(
      403,
    );
    const farmB = await createFarm(world.orgId, 'Ferme B');
    const userB = await createUser({
      organizationId: world.orgId,
      role: 'DIRECTEUR_FERME',
      farmIds: [farmB.id],
    });
    const other = {
      Authorization: `Bearer ${await tokenFor(userB.id)}`,
      'X-Farm-Id': farmB.id,
    };
    const res = await overview(other, world.poultryBld).expect(404);
    const missing = await overview(other, 'cmissing').expect(404);
    expect(res.body).toEqual(missing.body);
    expect((res.body as Msg).message).toBe('Bâtiment introuvable');
  });
});
