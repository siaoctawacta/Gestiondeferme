import { INestApplication } from '@nestjs/common';
import { addDays, formatDay, parseDay } from '../src/common/days';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createTestApp } from './setup';

/**
 * The withdrawal guard blocks a sale only when its date falls INSIDE a period:
 * `doneDate <= saleDate <= doneDate + duration + withdrawal days`. A sale dated
 * before the treatment is not blocked; with several acts, inside ANY period.
 */
describe('Withdrawal periods (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let accountant: Headers;
  let customerId: string;
  let lot: Id & { code: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    accountant = await world.actor('COMPTABLE');
    const seller = await world.actor('COMMERCIAL');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
      })
    ).id;
    lot = await world.lot(director, {
      initialCount: 1000,
      entryDate: daysAgo(60),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const treat = (ago: number, withdrawalDays: number, durationDays = 0) =>
    world.post(director, '/health-acts', {
      type: 'TRAITEMENT',
      status: 'REALISE',
      date: daysAgo(ago),
      productName: 'Amox',
      durationDays,
      withdrawalDays,
      batchId: lot.id,
    });
  const sellOn = (ago: number, status: number) =>
    world
      .http()
      .post('/api/sales/issued')
      .set(accountant)
      .send({
        customerId,
        date: daysAgo(ago),
        lines: [{ kind: 'LOT', batchId: lot.id, quantity: 5, unitPrice: 3500 }],
      })
      .expect(status);
  const blocked = (until: number) =>
    `Le lot ${lot.code} est en délai d'attente jusqu'au ${daysAgo(until)} : vente impossible`;
  const message = (r: { body: unknown }) => (r.body as Msg).message;

  it('lets a sale dated BEFORE the treatment through, blocks the days of the period (both ends), and lets the next day through', async () => {
    // treated on D12 (18 days ago) with 10 days of withdrawal: D12..D22 (8 days ago)
    await treat(18, 10);
    await sellOn(20, 201); // D10: before the treatment
    expect(message(await sellOn(18, 400))).toBe(blocked(8)); // D12
    expect(message(await sellOn(13, 400))).toBe(blocked(8)); // inside
    expect(message(await sellOn(8, 400))).toBe(blocked(8)); // D22: the last day
    await sellOn(7, 201); // D23
  });

  it('blocks a date inside ANY of several periods, and lets the gaps between them through', async () => {
    await treat(18, 10); // D12..D22: 18 -> 8 days ago
    await treat(5, 2, 1); // done 5 days ago, 1 + 2 days: 5 -> 2 days ago
    await sellOn(7, 201); // between the periods
    expect(message(await sellOn(4, 400))).toBe(blocked(2));
    expect(message(await sellOn(10, 400))).toBe(blocked(8));
    await sellOn(1, 201);
  });

  it('keeps withdrawalUntil of the lot as the latest end, and lists a lot as not sellable only on a date inside a period', async () => {
    await treat(18, 10);
    const detail = (
      await world.http().get(`/api/batches/${lot.id}`).set(director).expect(200)
    ).body as { withdrawalUntil: string | null };
    expect(detail.withdrawalUntil).toBe(daysAgo(8));
    const listed = async (ago: number) =>
      (
        (
          await world
            .http()
            .get('/api/sales/sellables')
            .query({ kind: 'LOT', date: daysAgo(ago) })
            .set(accountant)
            .expect(200)
        ).body as {
          items: {
            id: string;
            sellable: boolean;
            withdrawalUntil: string | null;
            reason: string | null;
          }[];
        }
      ).items.find((i) => i.id === lot.id);
    // before the treatment: sellable, the period still ahead is shown
    expect(await listed(20)).toMatchObject({
      sellable: true,
      reason: null,
      withdrawalUntil: daysAgo(8),
    });
    expect(await listed(15)).toMatchObject({
      sellable: false,
      withdrawalUntil: daysAgo(8),
      reason: `Délai d'attente jusqu'au ${daysAgo(8)}`,
    });
    expect(await listed(7)).toMatchObject({
      sellable: true,
      withdrawalUntil: daysAgo(8),
    });
  });

  it('judges an animal the same way', async () => {
    const sow = await world.animal(director, { tag: 'TR-099' });
    await world.post(director, '/health-acts', {
      type: 'TRAITEMENT',
      status: 'REALISE',
      date: daysAgo(18),
      productName: 'Amox',
      withdrawalDays: 10,
      animalId: sow.id,
    });
    const sell = (ago: number, status: number) =>
      world
        .http()
        .post('/api/sales/issued')
        .set(accountant)
        .send({
          customerId,
          date: daysAgo(ago),
          lines: [
            { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 90000 },
          ],
        })
        .expect(status);
    expect(message(await sell(18, 400))).toBe(
      `L'animal TR-099 est en délai d'attente jusqu'au ${daysAgo(8)} : vente impossible`,
    );
    await sell(20, 201);
  });

  it('formats the end of a period as a calendar day', () => {
    expect(formatDay(addDays(parseDay(daysAgo(18)) as Date, 10))).toBe(
      daysAgo(8),
    );
  });
});
