import { INestApplication } from '@nestjs/common';
import { lockRow } from '../src/common/lock-row';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

type Table = 'AnimalBatch' | 'Animal' | 'Building';

/**
 * The binding lock order of the herd and sales paths, proved with held locks
 * (no timing): a holder keeps ONE row; the request under test is seen waiting
 * on it (`pg_blocking_pids`); at that moment the rows it must NOT hold yet are
 * probed with `FOR NO KEY UPDATE NOWAIT` (a held row fails with 55P03).
 *
 * Order: document row -> counter -> lots ascending -> animals ascending ->
 * buildings ascending -> ONE stock call last; breeding takes the litter lot
 * before the sow.
 */
describe('Lock order (held locks, real pool)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let director: Headers;
  let accountant: Headers;
  let pigs: Headers;
  let customerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });

  beforeEach(async () => {
    await world.reset();
    director = await world.actor('DIRECTEUR_FERME');
    accountant = await world.actor('COMPTABLE');
    pigs = await world.actor('RESP_PORCIN');
    const seller = await world.actor('COMMERCIAL');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /** Holds the row lock of `table`/`id` until `release()` (always call it in a `finally`). */
  function hold(table: Table, id: string) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let held: (pid: number) => void = () => undefined;
    const pid = new Promise<number>((r) => (held = r));
    const done = prisma.$transaction(
      async (tx) => {
        await lockRow(tx, table, id);
        const rows = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        held(rows[0].pid);
        await gate;
      },
      { timeout: 60000 },
    );
    return { pid, release, done };
  }

  /** Waits (bounded) until a session waits on a lock held by `pid`. */
  async function waitBlockedBy(pid: number): Promise<void> {
    const deadline = Date.now() + 15000;
    for (;;) {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND ${pid}::int = ANY (pg_blocking_pids(pid))`;
      if (Number(rows[0].n) > 0) return;
      if (Date.now() > deadline) throw new Error('nobody waits on the holder');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** True when the row is free (nobody holds it); a held row makes NOWAIT fail. */
  async function isFree(table: Table, id: string): Promise<boolean> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT id FROM "${table}" WHERE id = $1 FOR NO KEY UPDATE NOWAIT`,
          id,
        );
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Runs `request` while `holder` holds a row; calls `probe` once the request waits on it. */
  async function whileWaiting<T>(
    holder: ReturnType<typeof hold>,
    request: () => PromiseLike<T>,
    probe: () => Promise<void>,
  ): Promise<T> {
    const pid = await holder.pid;
    let pending: PromiseLike<T> | undefined;
    try {
      pending = request();
      await waitBlockedBy(pid);
      await probe();
    } finally {
      holder.release();
      await holder.done.catch(() => undefined);
    }
    return pending;
  }

  const poultryBuilding = (name: string) =>
    prisma.building
      .create({
        data: {
          farmId: world.farmId,
          siteId: world.siteId,
          name,
          type: 'AVICOLE',
          capacity: 100_000,
        },
      })
      .then((b) => b.id);

  /**
   * Two lots whose ids and whose buildings' ids run in OPPOSITE orders (the
   * lot with the lower id sits in the building with the higher id), so a path
   * that locks buildings in lot-id order is told from one that sorts them.
   * Ids are time-ordered, so the lot made first gets the lower id.
   */
  async function crossedLots() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [lowBuilding, highBuilding] = [
        await poultryBuilding(`Poulailler A${attempt}`),
        await poultryBuilding(`Poulailler B${attempt}`),
      ].sort();
      const firstLot = await world.lot(director, { buildingId: highBuilding });
      const lastLot = await world.lot(director, { buildingId: lowBuilding });
      if (firstLot.id < lastLot.id) {
        return {
          firstLot,
          firstBuilding: highBuilding,
          lastLot,
          lastBuilding: lowBuilding,
        };
      }
    }
    throw new Error('could not cross the ids');
  }

  const issue = (lines: object[]) =>
    world.post<Id & { lines: Id[] }>(accountant, '/sales/issued', {
      customerId,
      date: daysAgo(5),
      lines,
    });

  describe('breeding: the litter lot is taken before the sow', () => {
    it('weaning waits for the litter lot WITHOUT holding the sow', async () => {
      const sow = await world.animal(pigs);
      const boar = await world.animal(pigs, { category: 'VERRAT' });
      const rec = await world.post<{ id: string; litterBatchId: string }>(
        pigs,
        '/breeding',
        {
          sowId: sow.id,
          method: 'SAILLIE',
          boarId: boar.id,
          serviceDate: daysAgo(120),
        },
      );
      const farrowed = (
        await world
          .http()
          .post(`/api/breeding/${rec.id}/farrowing`)
          .set(pigs)
          .send({
            date: daysAgo(5),
            bornTotal: 12,
            bornAlive: 12,
            stillborn: 0,
            buildingId: world.pigBld,
          })
          .expect(200)
      ).body as { litterBatchId: string };
      const holder = hold('AnimalBatch', farrowed.litterBatchId);
      const res = await whileWaiting(
        holder,
        () =>
          world
            .http()
            .post(`/api/breeding/${rec.id}/weaning`)
            .set(pigs)
            .send({ date: daysAgo(1), weanedCount: 10 })
            .then((r) => r),
        async () => {
          // a sale holding the litter lot and wanting the sow must not meet a weaning holding her
          expect(await isFree('Animal', sow.id)).toBe(true);
        },
      );
      expect(res.status).toBe(200);
    }, 60000);
  });

  describe('breeding: creating a record takes the sow and the boar in ascending id order', () => {
    /** A sow and a boar whose ids run in the wanted order (ids are time-ordered: the animal made first has the lower id). */
    async function pair(sowFirst: boolean) {
      const make = (boar: boolean) =>
        boar ? world.animal(pigs, { category: 'VERRAT' }) : world.animal(pigs);
      const first = await make(!sowFirst);
      const second = await make(sowFirst);
      return sowFirst
        ? { sow: first, boar: second }
        : { sow: second, boar: first };
    }
    const create = (sowId: string, boarId: string) =>
      world
        .http()
        .post('/api/breeding')
        .set(pigs)
        .send({
          sowId,
          method: 'SAILLIE',
          boarId,
          serviceDate: daysAgo(10),
        })
        .then((r) => r);

    it.each([
      ['the sow has the lower id', true],
      ['the boar has the lower id', false],
    ])(
      'waits on the lower-id animal WITHOUT holding the higher one (%s)',
      async (_name, sowFirst) => {
        const { sow, boar } = await pair(sowFirst);
        const [low, high] = sowFirst ? [sow.id, boar.id] : [boar.id, sow.id];
        expect(low < high).toBe(true);
        const res = await whileWaiting(
          hold('Animal', low),
          () => create(sow.id, boar.id),
          async () => {
            expect(await isFree('Animal', high)).toBe(true);
          },
        );
        expect(res.status).toBe(201);
      },
      60000,
    );

    it('a sale issuing the sow and the boar races 20 creations of the same pair: no deadlock, no 500', async () => {
      for (const sowFirst of [true, false]) {
        for (let i = 0; i < 10; i++) {
          const { sow, boar } = await pair(sowFirst);
          const sale = world
            .http()
            .post('/api/sales/issued')
            .set(accountant)
            .send({
              customerId,
              date: daysAgo(5),
              lines: [
                {
                  kind: 'ANIMAL',
                  animalId: sow.id,
                  quantity: 1,
                  unitPrice: 90000,
                },
                {
                  kind: 'ANIMAL',
                  animalId: boar.id,
                  quantity: 1,
                  unitPrice: 120000,
                },
              ],
            });
          const [made, sold] = await Promise.all([
            create(sow.id, boar.id),
            sale,
          ]);
          // whichever wins, the other is refused cleanly (never a deadlock or a 500)
          expect([201, 400, 409]).toContain(made.status);
          expect([201, 400, 409]).toContain(sold.status);
        }
      }
    }, 120000);
  });

  describe('sales: buildings come after every lot and animal lock, ascending', () => {
    it('cancelling an invoice does not hold the lot building while it waits for an animal', async () => {
      const lot = await world.lot(director, { initialCount: 100 });
      const sow = await world.animal(director);
      const inv = await issue([
        { kind: 'LOT', batchId: lot.id, quantity: 10, unitPrice: 3500 },
        { kind: 'ANIMAL', animalId: sow.id, quantity: 1, unitPrice: 90000 },
      ]);
      const holder = hold('Animal', sow.id);
      const res = await whileWaiting(
        holder,
        () =>
          world
            .http()
            .post(`/api/sales/${inv.id}/cancel`)
            .set(accountant)
            .send({ reason: 'Erreur de saisie' })
            .then((r) => r),
        async () => {
          expect(await isFree('Building', world.poultryBld)).toBe(true);
        },
      );
      expect(res.status).toBe(201);
    }, 60000);

    it('cancelling an invoice of two lots locks their buildings in ascending id order, not in lot order', async () => {
      // the lot taken first (lower id) sits in the HIGHER building
      const c = await crossedLots();
      const inv = await issue([
        { kind: 'LOT', batchId: c.firstLot.id, quantity: 10, unitPrice: 3500 },
        { kind: 'LOT', batchId: c.lastLot.id, quantity: 10, unitPrice: 3500 },
      ]);
      const holder = hold('Building', c.lastBuilding);
      const res = await whileWaiting(
        holder,
        () =>
          world
            .http()
            .post(`/api/sales/${inv.id}/cancel`)
            .set(accountant)
            .send({ reason: 'Erreur de saisie' })
            .then((r) => r),
        async () => {
          expect(await isFree('Building', c.firstBuilding)).toBe(true);
        },
      );
      expect(res.status).toBe(201);
    }, 60000);

    it('a credit note with return locks the buildings of its lots ascending, whatever the line order', async () => {
      const [x, y] = [
        await poultryBuilding('Poulailler X'),
        await poultryBuilding('Poulailler Y'),
      ];
      const [low, high] = [x, y].sort();
      const inLow = await world.lot(director, { buildingId: low });
      const inHigh = await world.lot(director, { buildingId: high });
      const inv = await issue([
        { kind: 'LOT', batchId: inHigh.id, quantity: 10, unitPrice: 3500 },
        { kind: 'LOT', batchId: inLow.id, quantity: 10, unitPrice: 3500 },
      ]);
      const detail = (
        await world
          .http()
          .get(`/api/sales/${inv.id}`)
          .set(accountant)
          .expect(200)
      ).body as { lines: { id: string }[] };
      const holder = hold('Building', low);
      const res = await whileWaiting(
        holder,
        () =>
          world
            .http()
            .post(`/api/sales/${inv.id}/credit-notes`)
            .set(accountant)
            .send({
              date: daysAgo(1),
              reason: 'Retour de lots',
              withReturn: true,
              lines: detail.lines.map((l) => ({ lineId: l.id, quantity: 4 })),
            })
            .then((r) => r),
        async () => {
          expect(await isFree('Building', high)).toBe(true);
        },
      );
      expect(res.status).toBe(201);
    }, 60000);
  });
});
