import { INestApplication } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma/client';
import { FeedService } from '../src/feed/feed.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface Dist extends Id {
  date: string;
  quantityKg: number;
  waterLiters: number | null;
  waterEditable: boolean;
  unitCost: number;
  cost: number;
}

describe('Feed distribution seam (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  let productId: string;
  let lotId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    h = await world.actor('DIRECTEUR_FERME');
    productId = (
      await world.post<Id>(h, '/feed-products', {
        name: 'Aliment',
        kind: 'ALIMENT_COMPLET',
        unitCost: 300,
      })
    ).id;
    lotId = (await world.lot(h)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const distribute = (over: Record<string, unknown> = {}, status = 201) =>
    world.post<Dist>(
      h,
      '/feed-distributions',
      {
        batchId: lotId,
        date: daysAgo(1),
        feedProductId: productId,
        quantityKg: 10,
        ...over,
      },
      status,
    );
  describe('afterDistributionChange hook (D7)', () => {
    it('runs inside the transaction, before the audit row, on create, update and delete', async () => {
      const feed = app.get(FeedService);
      const seen: { auditRows: number; tx: unknown; hasCtx: boolean }[] = [];
      const spy = jest
        .spyOn(feed, 'afterDistributionChange')
        .mockImplementation(async (tx, ctx, before, after) => {
          seen.push({
            auditRows: await tx.auditLog.count({
              where: { recordId: (after ?? before)?.id },
            }),
            tx,
            hasCtx: ctx.user.role === 'DIRECTEUR_FERME',
          });
        });
      try {
        const d = await distribute();
        await http()
          .patch(`/api/feed-distributions/${d.id}`)
          .set(h)
          .send({ quantityKg: 12 })
          .expect(200);
        await http()
          .delete(`/api/feed-distributions/${d.id}`)
          .set(h)
          .expect(200);
        expect(spy).toHaveBeenCalledTimes(3);
        const [create, update, remove] = spy.mock.calls;
        expect([create[2], create[3]?.quantityKg.toString()]).toEqual([
          null,
          '10',
        ]);
        expect([
          update[2]?.quantityKg.toString(),
          update[3]?.quantityKg.toString(),
        ]).toEqual(['10', '12']);
        expect([remove[2]?.quantityKg.toString(), remove[3]]).toEqual([
          '12',
          null,
        ]);
        // Create: no audit row of the distribution yet when the hook runs; update and delete: only the earlier ones.
        expect(seen.map((s) => s.auditRows)).toEqual([0, 1, 2]);
        expect(seen.every((s) => s.hasCtx)).toBe(true);
        expect(seen.every((s) => s.tx !== prisma)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('lets the hook reprice the row: response, database and audit agree', async () => {
      const feed = app.get(FeedService);
      const spy = jest
        .spyOn(feed, 'afterDistributionChange')
        .mockImplementation(async (tx, _ctx, _before, after) => {
          if (after) {
            await tx.feedDistribution.update({
              where: { id: after.id },
              data: { unitCost: 450, cost: after.quantityKg.mul(450) },
            });
            return { unitCost: new Prisma.Decimal(450) };
          }
        });
      try {
        const d = await distribute();
        expect(d).toMatchObject({ unitCost: 450, cost: 4500 });
        const row = await prisma.feedDistribution.findUniqueOrThrow({
          where: { id: d.id },
        });
        expect(Number(row.cost)).toBe(4500);
        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { recordId: d.id, action: 'CREATE' },
        });
        expect(audit.after).toMatchObject({ unitCost: 450, cost: 4500 });
      } finally {
        spy.mockRestore();
      }
    });
  });
});
