import { INestApplication } from '@nestjs/common';
import { WithdrawalRegistry } from '../src/herd/withdrawal';
import { LotCost, LotCostRegistry } from '../src/indicators/lot-cost';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

const plusDays = (n: number) => daysAgo(-n);

describe('Health as a lot cost source (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  let lotId: string;
  let vaccineId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    h = await world.actor('DIRECTEUR_FERME');
    lotId = (await world.lot(h)).id;
    vaccineId = (
      await world.post<Id>(h, '/stock-items', {
        name: 'Gumboro',
        category: 'VACCIN',
        unit: 'flacon',
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();

  const entry = (
    itemId: string,
    quantity: number,
    unitCost: number,
    date = daysAgo(40),
  ) =>
    world.post(h, '/stock/movements', {
      itemId,
      type: 'ENTREE',
      date,
      quantity,
      unitCost,
      reason: 'ACHAT',
    });

  /** A done act consuming `quantity` of the vaccine. */
  const act = (over: Record<string, unknown> = {}) =>
    world.post<Id>(h, '/health-acts', {
      type: 'VACCINATION',
      status: 'REALISE',
      batchId: lotId,
      date: daysAgo(1),
      stockItemId: vaccineId,
      quantity: 2,
      ...over,
    });

  const costs = async (
    ids: string[] = [lotId],
    range?: { from?: Date; to?: Date },
  ) => app.get(LotCostRegistry).costsFor(ids, range);
  const amountOf = (list: LotCost[] | undefined, category: string) =>
    list?.find((c) => c.category === category)?.amount.toString();

  /** Feed fixture of the feed suite: 620 kg at the average of 1000 @ 300 and 500 @ 360 = 198 400. */
  async function feed() {
    const item = await world.post<Id>(h, '/stock-items', {
      name: 'Maïs',
      category: 'ALIMENT',
      unit: 'kg',
    });
    await entry(item.id, 1000, 300);
    await entry(item.id, 500, 360);
    const product = await world.post<Id>(h, '/feed-products', {
      name: 'Maïs',
      kind: 'ALIMENT_COMPLET',
      unitCost: 999,
      stockItemId: item.id,
    });
    await world.post(h, '/feed-distributions', {
      batchId: lotId,
      date: daysAgo(1),
      quantityKg: 620,
      feedProductId: product.id,
    });
  }

  it('reports the vaccine consumed by an act of the lot next to the feed, at the ledger cost', async () => {
    await entry(vaccineId, 12, 12000);
    await feed();
    await act();
    const list = (await costs()).get(lotId);
    expect(amountOf(list, 'aliment')).toBe('198400');
    expect(amountOf(list, 'sante')).toBe('24000');
    expect(list?.find((c) => c.category === 'sante')?.quantity).toBeUndefined();
  });

  // The ledger stores the exit at the average rounded to the cent (294 000 / 22 = 13 363.64), so
  // 2 × 13 363.64 = 26 727.28; the exact 26 727.27 is not held anywhere.
  it('follows the ledger when an entry is back-dated before the act', async () => {
    await entry(vaccineId, 12, 12000);
    await act();
    await entry(vaccineId, 10, 15000, daysAgo(41));
    expect(amountOf((await costs()).get(lotId), 'sante')).toBe('26727.28');
  });

  it('drops a cancelled act', async () => {
    await entry(vaccineId, 12, 12000);
    const a = await act();
    expect(amountOf((await costs()).get(lotId), 'sante')).toBe('24000');
    await http().post(`/api/health-acts/${a.id}/cancel`).set(h).expect(200);
    expect((await costs()).get(lotId)).toEqual([]);
  });

  it('counts a planned act for nothing', async () => {
    await entry(vaccineId, 12, 12000);
    await act({ status: 'PLANIFIE', date: plusDays(2), quantity: undefined });
    expect((await costs()).get(lotId)).toEqual([]);
  });

  it('attributes an act on an animal or a building to no lot', async () => {
    await entry(vaccineId, 12, 12000);
    const sow = await world.animal(h);
    await act({ batchId: undefined, animalId: sow.id });
    await act({
      type: 'DESINFECTION',
      batchId: undefined,
      buildingId: world.pigBld,
      stockItemId: undefined,
      quantity: undefined,
    });
    expect((await costs()).get(lotId)).toEqual([]);
  });

  it('costs each lot of one call separately, and a lot nothing happened to has no entry', async () => {
    await entry(vaccineId, 12, 12000);
    const other = (await world.lot(h)).id;
    const quiet = (await world.lot(h)).id;
    await act({ quantity: 2 });
    await act({ batchId: other, quantity: 3 });
    const all = await costs([lotId, other, quiet]);
    expect(amountOf(all.get(lotId), 'sante')).toBe('24000');
    expect(amountOf(all.get(other), 'sante')).toBe('36000');
    expect(all.get(quiet)).toEqual([]);
  });

  it('rounds per act (one ledger operation) then sums, like feed: two acts of 0.5 flacon at 13 363.63 cost 13 363.64', async () => {
    await entry(vaccineId, 10, 13363.63);
    await act({ quantity: 0.5 });
    await act({ quantity: 0.5 });
    // 0.5 × 13 363.63 = 6 681.815 → 6 681.82 each; rounding the lot's sum once would give 13 363.63.
    expect(amountOf((await costs()).get(lotId), 'sante')).toBe('13363.64');
  });

  it('filters on the day the act was done, not on its planned date', async () => {
    await entry(vaccineId, 12, 12000);
    const planned = await act({
      status: 'PLANIFIE',
      date: daysAgo(10),
      quantity: undefined,
    });
    await http()
      .post(`/api/health-acts/${planned.id}/complete`)
      .set(h)
      .send({ doneDate: daysAgo(2), quantity: 2 })
      .expect(200);
    const day = (n: number) => new Date(`${daysAgo(n)}T00:00:00.000Z`);
    const sante = async (range: { from?: Date; to?: Date }) =>
      amountOf((await costs([lotId], range)).get(lotId), 'sante');
    // Planned 10 days ago, done 2 days ago: only the done date counts.
    expect(await sante({ to: day(5) })).toBeUndefined();
    expect(await sante({ from: day(3), to: day(2) })).toBe('24000');
    expect(await sante({ from: day(11), to: day(9) })).toBeUndefined();
  });

  it('limits the cost to the acts done within the range, both bounds inclusive', async () => {
    await entry(vaccineId, 12, 12000);
    await act({ date: daysAgo(10), doneDate: daysAgo(10), quantity: 1 });
    await act({ date: daysAgo(2), doneDate: daysAgo(2), quantity: 2 });
    const day = (n: number) => new Date(`${daysAgo(n)}T00:00:00.000Z`);
    const sante = async (range?: { from?: Date; to?: Date }) =>
      amountOf((await costs([lotId], range)).get(lotId), 'sante');
    expect(await sante()).toBe('36000');
    expect(await sante({ from: day(10), to: day(10) })).toBe('12000');
    expect(await sante({ from: day(9) })).toBe('24000');
    expect(await sante({ to: day(3) })).toBe('12000');
    expect(await sante({ from: day(1) })).toBeUndefined();
  });

  describe('withdrawal read inside a transaction', () => {
    it('sees an act created earlier in that transaction, which the pool does not see yet', async () => {
      const registry = app.get(WithdrawalRegistry);
      const farmId = world.farmId;
      const userId = (await prisma.user.findFirstOrThrow()).id;
      const done = new Date(`${daysAgo(1)}T00:00:00.000Z`);
      await prisma.$transaction(async (tx) => {
        await tx.healthAct.create({
          data: {
            farmId,
            batchId: lotId,
            type: 'TRAITEMENT',
            status: 'REALISE',
            date: done,
            doneDate: done,
            productName: 'Amoxicilline',
            withdrawalDays: 7,
            createdById: userId,
          },
        });
        expect(await registry.until({ batchId: lotId })).toBeNull();
        expect(await registry.until({ batchId: lotId }, tx)).toEqual(
          new Date(`${plusDays(6)}T00:00:00.000Z`),
        );
      });
    });
  });
});
