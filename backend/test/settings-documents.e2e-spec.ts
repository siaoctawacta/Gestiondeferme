import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/generated/prisma/enums';
import { Msg, World } from './fixtures';
import { createTestApp } from './setup';

describe('GET /settings/documents and the setting caps (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });
  beforeEach(async () => {
    await world.reset();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('answers 200 to every role with the legal identity, the due days and the eggs per tray, and nothing else', async () => {
    const owner = await world.actor('SUPER_ADMIN');
    await world
      .http()
      .put('/api/settings/legal')
      .set(owner)
      .send({
        value: {
          name: 'Ferme Agri',
          address: 'Lomé',
          nif: '123',
          rccm: 'TG-1',
        },
      })
      .expect(200);
    for (const role of Object.values(Role)) {
      const h = await world.actor(role);
      const res = await world
        .http()
        .get('/api/settings/documents')
        .set(h)
        .expect(200);
      expect(res.body).toEqual({
        legal: {
          name: 'Ferme Agri',
          address: 'Lomé',
          nif: '123',
          rccm: 'TG-1',
        },
        invoiceDueDays: 15,
        eggsPerTray: 30,
      });
    }
  });

  it('is refused to a caller who is not signed in, and the full settings stay behind parametres:read', async () => {
    await world.http().get('/api/settings/documents').expect(401);
    const keeper = await world.actor('MAGASINIER');
    await world.http().get('/api/settings').set(keeper).expect(403);
  });

  it('caps the due days at 365 and the eggs per tray at 1000', async () => {
    const owner = await world.actor('SUPER_ADMIN');
    const put = (key: string, value: number, status: number) =>
      world
        .http()
        .put(`/api/settings/${key}`)
        .set(owner)
        .send({ value })
        .expect(status);
    await put('invoiceDueDays', 365, 200);
    await put('eggsPerTray', 1000, 200);
    expect(((await put('invoiceDueDays', 366, 400)).body as Msg).message).toBe(
      "Le délai d'échéance des factures ne peut pas dépasser 365",
    );
    await put('eggsPerTray', 1001, 400);
  });
});
