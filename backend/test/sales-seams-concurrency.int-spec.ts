import { INestApplication } from '@nestjs/common';
import { today } from '../src/common/days';
import {
  EggOutflowRegistry,
  EggStockService,
  type EggOutflowSource,
} from '../src/eggs/egg-stock';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { WithdrawalRegistry } from '../src/herd/withdrawal';
import { AnimalSales } from '../src/pigs/animal-sales';
import { AnimalTargetRegistry } from '../src/herd/animal-target';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockLedgerService } from '../src/stock/stock-ledger.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The eggs sold, kept in memory: a transaction adds to it only after it has checked, and under the lot lock. */
class Sold implements EggOutflowSource {
  rows: { batchId: string; date: Date; eggs: number; sourceId: string }[] = [];
  outflows(_tx: Tx, batchIds: string[]) {
    return Promise.resolve(
      this.rows.filter((r) => batchIds.includes(r.batchId)),
    );
  }
}

interface Bundle {
  id: string;
  lots?: { id: string; quantity: number }[];
  animals?: string[];
  eggs?: { lot: { id: string; code: string }; eggs: number };
  article?: { id: string; quantity: number };
}

/**
 * What the sales module's issue will do, in the order it must: lots (ascending id) -> animals (ascending id) ->
 * ONE stock-ledger call last. Written with the seams only, as Task 4 will write it.
 */
describe('Sale seams under concurrency (real pool)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  let userId: string;
  const sold = new Sold();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
    app.get(EggOutflowRegistry).register(sold);
  });

  beforeEach(async () => {
    await world.reset();
    sold.rows = [];
    h = await world.actor('DIRECTEUR_FERME');
    userId = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function issue(b: Bundle, pause = 0): Promise<void> {
    const herd = app.get(HerdLedgerService);
    await prisma.$transaction(async (tx) => {
      const lotIds = [...(b.lots ?? []).map((l) => l.id)];
      if (b.eggs) lotIds.push(b.eggs.lot.id);
      await herd.lockBatches(tx, lotIds, [world.farmId]);
      const animals = [...(b.animals ?? [])].sort();
      const targets = app.get(AnimalTargetRegistry).single();
      for (const id of animals) {
        await targets.lockAnimal(tx, id, [world.farmId]);
      }
      for (const l of b.lots ?? []) {
        await herd.record(tx, {
          farmId: world.farmId,
          batchId: l.id,
          date: today(),
          type: 'VENTE',
          quantity: l.quantity,
          sourceType: 'SALE',
          sourceId: b.id,
          userId,
        });
      }
      if (b.eggs) {
        await app
          .get(EggStockService)
          .assertSale(tx, b.eggs.lot, [{ date: today(), eggs: b.eggs.eggs }]);
        await sleep(pause);
        sold.rows.push({
          batchId: b.eggs.lot.id,
          date: today(),
          eggs: b.eggs.eggs,
          sourceId: b.id,
        });
      }
      for (const id of animals) {
        await app.get(AnimalSales).sell(tx, id, today(), {
          type: 'SALE',
          id: b.id,
          label: b.id,
        });
      }
      if (b.article) {
        await app.get(StockLedgerService).recordMany(tx, [
          {
            farmId: world.farmId,
            stockItemId: b.article.id,
            date: today(),
            type: 'SORTIE',
            quantity: -b.article.quantity,
            reason: 'VENTE',
            sourceType: 'SALE',
            sourceId: b.id,
            userId,
          },
        ]);
      }
    });
  }

  const outcome = (results: PromiseSettledResult<void>[]) => ({
    ok: results.filter((r) => r.status === 'fulfilled').length,
    failures: results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as { status?: number; message: string }),
  });

  async function article(quantity: number): Promise<string> {
    const item = await world.post<Id>(h, '/stock-items', {
      name: 'Aliment ponte',
      category: 'ALIMENT',
      unit: 'kg',
    });
    await world.post(h, '/stock/movements', {
      itemId: item.id,
      type: 'ENTREE',
      date: daysAgo(40),
      quantity,
      unitCost: 320,
      reason: 'ACHAT',
    });
    return item.id;
  }

  it('two sales of 30 on a lot of 40: exactly one succeeds, the other is Effectif insuffisant', async () => {
    const lot = await world.lot(h, { initialCount: 40 });
    const results = await Promise.allSettled(
      ['a', 'b'].map((id) =>
        issue({ id, lots: [{ id: lot.id, quantity: 30 }] }),
      ),
    );
    const { ok, failures } = outcome(results);
    expect(ok).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      status: 400,
      message: 'Effectif insuffisant',
    });
    const alive = await app.get(HerdLedgerService).liveCounts([lot.id]);
    expect(alive.get(lot.id)).toBe(10);
  });

  it('two sales of 3 000 eggs on 4 710: exactly one succeeds, the other is Œufs disponibles insuffisants', async () => {
    const layer = await world.lot(h, { type: 'PONDEUSE', initialCount: 3000 });
    await world.post(h, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(3),
      collected: 2500,
      broken: 40,
      downgraded: 250,
    });
    await world.post(h, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(2),
      collected: 2500,
    });
    const results = await Promise.allSettled(
      ['a', 'b'].map((id) =>
        issue({ id, eggs: { lot: layer, eggs: 3000 } }, 150),
      ),
    );
    const { ok, failures } = outcome(results);
    expect(ok).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      status: 400,
      message: `Œufs disponibles insuffisants pour ${layer.code} (1710 disponibles)`,
    });
    expect(sold.rows).toHaveLength(1);
  });

  it('two sales of 600 kg on 1 000 kg: exactly one succeeds, the other is Stock insuffisant', async () => {
    const itemId = await article(1000);
    const results = await Promise.allSettled(
      ['a', 'b'].map((id) =>
        issue({ id, article: { id: itemId, quantity: 600 } }),
      ),
    );
    const { ok, failures } = outcome(results);
    expect(ok).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].status).toBe(400);
    expect(failures[0].message).toContain('Stock insuffisant');
    expect(
      (await app.get(StockLedgerService).levels([world.farmId], [itemId]))
        .get(`${world.farmId}:${itemId}`)
        ?.quantity.toString(),
    ).toBe('400');
  });

  it('a sale of an egg lot racing an edit of its production: one wins, never both, no 500', async () => {
    const layer = await world.lot(h, { type: 'PONDEUSE', initialCount: 3000 });
    const record = await world.post<Id>(h, '/egg-production', {
      batchId: layer.id,
      date: daysAgo(2),
      collected: 1000,
    });
    const [sale, edit] = await Promise.all([
      issue({ id: 'a', eggs: { lot: layer, eggs: 1000 } }, 150).then(
        () => 'sold',
        (e: { status?: number }) => e.status,
      ),
      world
        .http()
        .patch(`/api/egg-production/${record.id}`)
        .set(h)
        .send({ collected: 900 }),
    ]);
    const edited = edit.status === 200;
    // Exactly one of them found the other's effect: the sale went through and the edit was refused, or the opposite.
    expect([sale === 'sold', edited]).not.toEqual([true, true]);
    expect([sale === 'sold', edited]).not.toEqual([false, false]);
    expect([200, 400]).toContain(edit.status);
    const row = await prisma.eggProduction.findUniqueOrThrow({
      where: { id: record.id },
    });
    const soldEggs = sold.rows.reduce((n, r) => n + r.eggs, 0);
    expect(row.collected).toBeGreaterThanOrEqual(soldEggs);
  });

  it('two sales of the same animal: one succeeds, the other is refused (409), never a 500', async () => {
    const pig = await world.animal(h, { tag: 'TR-027' });
    const results = await Promise.allSettled(
      ['a', 'b'].map((id) => issue({ id, animals: [pig.id] })),
    );
    const { ok, failures } = outcome(results);
    expect(ok).toBe(1);
    expect(failures[0].status).toBe(409);
  });

  it('bundles that list the same lots, animals and article in opposite orders never deadlock', async () => {
    const lots = await Promise.all(
      [1, 2, 3].map(() => world.lot(h, { initialCount: 100 })),
    );
    const pigs = await Promise.all(
      ['TR-001', 'TR-002', 'TR-003'].map((tag) => world.animal(h, { tag })),
    );
    const itemId = await article(1000);
    const bundle = (id: string, reversed: boolean): Bundle => {
      const l = lots.map((x) => ({ id: x.id, quantity: 10 }));
      const a = pigs.map((x) => x.id);
      return {
        id,
        lots: reversed ? l.reverse() : l,
        animals: reversed ? a.reverse() : a,
        article: { id: itemId, quantity: 10 },
      };
    };
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4, 5].map((n) => issue(bundle(`inv-${n}`, n % 2 === 1))),
    );
    const { ok, failures } = outcome(results);
    // The three animals can be sold once: one bundle wins, the others are refused (409) and leave no trace.
    expect(ok).toBe(1);
    expect(failures).toHaveLength(5);
    expect(failures.every((f) => f.status === 409)).toBe(true);
    const counts = await app
      .get(HerdLedgerService)
      .liveCounts(lots.map((l) => l.id));
    expect([...counts.values()]).toEqual([90, 90, 90]);
    expect(
      (await app.get(StockLedgerService).levels([world.farmId], [itemId]))
        .get(`${world.farmId}:${itemId}`)
        ?.quantity.toString(),
    ).toBe('990');
  });

  it('bundles on shared lots and article but their own animals all succeed without deadlock', async () => {
    const lots = await Promise.all(
      [1, 2].map(() => world.lot(h, { initialCount: 100 })),
    );
    const pigs = await Promise.all(
      ['TR-001', 'TR-002', 'TR-003', 'TR-004'].map((tag) =>
        world.animal(h, { tag }),
      ),
    );
    const itemId = await article(1000);
    const results = await Promise.allSettled(
      pigs.map((p, n) =>
        issue({
          id: `inv-${n}`,
          lots: (n % 2 ? [...lots].reverse() : lots).map((l) => ({
            id: l.id,
            quantity: 5,
          })),
          animals: [p.id],
          article: { id: itemId, quantity: 5 },
        }),
      ),
    );
    expect(outcome(results)).toEqual({ ok: 4, failures: [] });
    expect(
      await prisma.stockMovement.count({ where: { reason: 'VENTE' } }),
    ).toBe(4);
  });

  it('a treatment racing a sale of the same lot waits for the lot lock: the guard sees none, the treatment comes after', async () => {
    const lot = await world.lot(h, { initialCount: 100 });
    let locked!: (pid: number) => void;
    let release!: () => void;
    const hasLock = new Promise<number>((r) => (locked = r));
    const gate = new Promise<void>((r) => (release = r));
    const sale = prisma.$transaction(
      async (tx) => {
        await app
          .get(HerdLedgerService)
          .lockBatches(tx, [lot.id], [world.farmId]);
        const [{ pid }] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        locked(pid);
        await gate;
        await app
          .get(WithdrawalRegistry)
          .assertClear({ batchId: lot.id, code: lot.code }, today(), tx);
        return 'clear';
      },
      { timeout: 30000 },
    );
    const holder = await hasLock;
    let treatment: Promise<{ status: number }> | undefined;
    try {
      treatment = world
        .http()
        .post('/api/health-acts')
        .set(h)
        .send({
          type: 'TRAITEMENT',
          status: 'REALISE',
          date: daysAgo(0),
          productName: 'Amox',
          withdrawalDays: 5,
          batchId: lot.id,
        })
        .then((r) => r);
      // The request must be seen waiting on a lock held by OUR transaction, within the timeout.
      let blocked = 0;
      const deadline = Date.now() + 15000;
      while (blocked === 0 && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND ${holder}::int = ANY (pg_blocking_pids(pid))`;
        blocked = Number(rows[0].n);
        if (blocked === 0) await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked).toBeGreaterThan(0);
    } finally {
      release();
    }
    const [guarded, done] = await Promise.all([sale, treatment]);
    expect(guarded).toBe('clear');
    expect(done.status).toBe(201);
    await expect(
      prisma.$transaction(async (tx) => {
        await app
          .get(WithdrawalRegistry)
          .assertClear({ batchId: lot.id, code: lot.code }, today(), tx);
      }),
    ).rejects.toMatchObject({ status: 400 });
  }, 60000);
});
