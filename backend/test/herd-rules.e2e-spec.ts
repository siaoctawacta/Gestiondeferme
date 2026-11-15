import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Msg, World } from './fixtures';
import { createTestApp } from './setup';

describe('Closing a lot (e2e)', () => {
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

  it('refuses to close a lot that still has live animals, naming how many', async () => {
    const lot = await world.lot(h, { initialCount: 100 });
    await world.post(h, `/batches/${lot.id}/events`, {
      type: 'MORTALITE',
      date: daysAgo(3),
      quantity: 5,
    });
    const res = await http()
      .post(`/api/batches/${lot.id}/close`)
      .set(h)
      .expect(409);
    expect((res.body as Msg).message).toBe(
      'Ce lot compte encore 95 animaux ; enregistrez leur sortie (vente, réforme, mortalité) avant de le clôturer',
    );
    expect(
      (await prisma.animalBatch.findUniqueOrThrow({ where: { id: lot.id } }))
        .status,
    ).toBe('EN_COURS');
  });

  it('closes once every animal has left, and reopens as before', async () => {
    const lot = await world.lot(h, { initialCount: 100 });
    await world.post(h, `/batches/${lot.id}/events`, {
      type: 'VENTE',
      date: daysAgo(2),
      quantity: 60,
    });
    await world.post(h, `/batches/${lot.id}/events`, {
      type: 'REFORME',
      date: daysAgo(2),
      quantity: 40,
    });
    const closed = await http()
      .post(`/api/batches/${lot.id}/close`)
      .set(h)
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOTURE', alive: 0 });
    const reopened = await http()
      .post(`/api/batches/${lot.id}/reopen`)
      .set(h)
      .expect(200);
    expect(reopened.body).toMatchObject({ status: 'EN_COURS' });
  });
});
