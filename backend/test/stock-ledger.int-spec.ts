import { BadRequestException, ConflictException } from '@nestjs/common';
import { migrateTestDb, resetDb } from './setup';
import { AuditService } from '../src/audit/audit.service';
import type { RequestContext } from '../src/access/decorators';
import type { StockMovementType } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ensureFarmStockItem,
  levelKey,
  StockLedgerService,
  type RecordInput,
} from '../src/stock/stock-ledger.service';
import { replay } from '../src/stock/valuation';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
  new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

describe('StockLedgerService (test database)', () => {
  let prisma: PrismaService;
  let ledger: StockLedgerService;
  let orgId: string;
  let farmId: string;
  let otherFarmId: string;
  let userId: string;
  let item: string;
  let item2: string;

  beforeAll(() => {
    migrateTestDb();
    prisma = new PrismaService();
    ledger = new StockLedgerService(prisma, new AuditService(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Property over every scenario of this file: whatever the history went
   * through, the (farm, article) cache equals a full replay of its movements.
   */
  afterEach(async () => {
    const pairs = await prisma.farmStockItem.findMany();
    for (const pair of pairs) {
      const rows = await prisma.stockMovement.findMany({
        where: { farmId: pair.farmId, stockItemId: pair.stockItemId },
      });
      const full = replay(rows, { strict: false });
      expect(pair.quantity.toString()).toBe(full.quantity.toString());
      expect(
        pair.averageCost === null ? null : pair.averageCost.toString(),
      ).toBe(full.averageCost.toString());
    }
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await prisma.organization.create({ data: { name: 'Org' } })).id;
    farmId = (
      await prisma.farm.create({ data: { organizationId: orgId, name: 'F1' } })
    ).id;
    otherFarmId = (
      await prisma.farm.create({ data: { organizationId: orgId, name: 'F2' } })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          organizationId: orgId,
          email: 'u@test.local',
          name: 'U',
          passwordHash: 'x',
          role: 'DIRECTEUR_FERME',
        },
      })
    ).id;
    item = await makeItem('Aliment ponte', 'ALIMENT', 'kg');
    item2 = await makeItem('Vaccin Gumboro', 'VACCIN', 'flacon');
  });

  async function makeItem(
    name: string,
    category: 'ALIMENT' | 'VACCIN' | 'MATERIEL',
    unit: string,
    org = orgId,
  ): Promise<string> {
    return (
      await prisma.stockItem.create({
        data: { organizationId: org, name, category, unit },
      })
    ).id;
  }

  const input = (
    over: Partial<RecordInput> & {
      type: StockMovementType;
      quantity: number;
    },
  ): RecordInput => ({
    farmId,
    stockItemId: item,
    date: day('2026-01-10'),
    reason: over.type === 'ENTREE' ? 'ACHAT' : 'CONSOMMATION',
    userId,
    ...(over.type === 'ENTREE' ? { unitCost: 300 } : {}),
    ...over,
  });

  const record = (over: Parameters<typeof input>[0]) =>
    prisma.$transaction((tx) => ledger.record(tx, input(over)));

  const entry = (date: string, quantity: number, unitCost: number) =>
    record({ type: 'ENTREE', date: day(date), quantity, unitCost });
  const exit = (date: string, quantity: number, over = {}) =>
    record({ type: 'SORTIE', date: day(date), quantity: -quantity, ...over });

  async function level(id = item, farm = farmId) {
    const l = (await ledger.levels([farm], [id])).get(levelKey(farm, id));
    return {
      quantity: l?.quantity.toNumber() ?? 0,
      averageCost: l?.averageCost.toNumber() ?? 0,
      value: l?.value.toNumber() ?? 0,
    };
  }

  const stored = async (id = item) =>
    (
      await prisma.stockMovement.findMany({
        where: { stockItemId: id },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })
    ).map((m) => ({
      type: m.type,
      quantity: m.quantity.toNumber(),
      unitCost: m.unitCost.toNumber(),
    }));

  describe('valuation', () => {
    it('averages two entries and values an exit at the average: 1000 @ 300 + 500 @ 360, exit 600', async () => {
      await entry('2026-01-02', 1000, 300);
      await entry('2026-01-03', 500, 360);
      expect(await level()).toEqual({
        quantity: 1500,
        averageCost: 320,
        value: 480000,
      });
      const out = await exit('2026-01-04', 600);
      expect(out.unitCost.toNumber()).toBe(320);
      expect(out.cost.toNumber()).toBe(192000);
      expect(out.movements).toHaveLength(1);
      expect(await level()).toEqual({
        quantity: 900,
        averageCost: 320,
        value: 288000,
      });
    });

    it('values a positive adjustment without a cost at the average, and a first one at 0', async () => {
      await record({
        type: 'AJUSTEMENT',
        reason: 'INVENTAIRE',
        quantity: 10,
        date: day('2026-01-01'),
      });
      await entry('2026-01-02', 10, 100);
      await record({
        type: 'AJUSTEMENT',
        reason: 'INVENTAIRE',
        quantity: 20,
        date: day('2026-01-03'),
      });
      expect((await stored()).map((m) => m.unitCost)).toEqual([0, 100, 50]);
    });

    it('values a negative adjustment at the running average', async () => {
      await entry('2026-01-02', 100, 200);
      await record({
        type: 'AJUSTEMENT',
        reason: 'INVENTAIRE',
        quantity: -30,
        date: day('2026-01-03'),
      });
      expect((await stored())[1]).toMatchObject({
        quantity: -30,
        unitCost: 200,
      });
    });

    it('refuses an exit above the quantity, with the item and what is available, and writes nothing', async () => {
      await entry('2026-01-02', 1000, 300);
      await expect(exit('2026-01-03', 1600)).rejects.toThrow(
        new BadRequestException(
          'Stock insuffisant pour Aliment ponte (disponible 1000 kg)',
        ),
      );
      expect(await stored()).toHaveLength(1);
    });

    it('refuses a back-dated exit that would starve a later one', async () => {
      await entry('2026-01-01', 100, 10);
      await exit('2026-01-10', 80);
      await expect(exit('2026-01-05', 50)).rejects.toThrow('Stock insuffisant');
      expect(await stored()).toHaveLength(2);
    });

    it('keeps one stock per farm', async () => {
      await entry('2026-01-02', 100, 300);
      await expect(
        exit('2026-01-03', 10, { farmId: otherFarmId }),
      ).rejects.toThrow('Stock insuffisant');
      expect(await level(item, otherFarmId)).toEqual({
        quantity: 0,
        averageCost: 0,
        value: 0,
      });
    });
  });

  describe('history edits rewrite the cost of later exits', () => {
    it('a back-dated entry changes the average of exits after it', async () => {
      await entry('2026-01-02', 100, 100);
      await exit('2026-01-05', 50);
      expect((await stored())[1].unitCost).toBe(100);
      await entry('2026-01-03', 100, 200);
      expect((await stored()).map((m) => m.unitCost)).toEqual([100, 200, 150]);
    });

    it('updating the cost of an entry recosts the exits, leaving unchanged rows untouched', async () => {
      const first = await entry('2026-01-02', 100, 100);
      await entry('2026-01-03', 100, 200);
      await exit('2026-01-04', 50);
      const before = await prisma.stockMovement.findMany({
        where: { stockItemId: item },
        orderBy: { createdAt: 'asc' },
      });
      await prisma.$transaction((tx) =>
        ledger.update(tx, first.movements[0].id, { unitCost: 300 }),
      );
      const after = await prisma.stockMovement.findMany({
        where: { stockItemId: item },
        orderBy: { createdAt: 'asc' },
      });
      expect(after.map((m) => m.unitCost.toNumber())).toEqual([300, 200, 250]);
      expect(after[1].updatedAt).toEqual(before[1].updatedAt);
    });

    it('deleting an entry the later exits depend on is refused and changes nothing', async () => {
      const first = await entry('2026-01-02', 100, 100);
      await entry('2026-01-03', 50, 200);
      await exit('2026-01-04', 120);
      await expect(
        prisma.$transaction((tx) => ledger.remove(tx, first.movements[0].id)),
      ).rejects.toThrow(
        new BadRequestException('Stock insuffisant pour Aliment ponte'),
      );
      expect(await stored()).toHaveLength(3);
    });

    it('deleting an entry recosts the exits that stay valid', async () => {
      await entry('2026-01-02', 100, 100);
      const second = await entry('2026-01-03', 100, 200);
      await exit('2026-01-04', 50);
      await prisma.$transaction((tx) =>
        ledger.remove(tx, second.movements[0].id),
      );
      expect((await stored()).map((m) => m.unitCost)).toEqual([100, 100]);
    });

    it('a quantity update that leaves the history valid is accepted, one that breaks it is not', async () => {
      const e = await entry('2026-01-02', 100, 100);
      await exit('2026-01-04', 80);
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, e.movements[0].id, { quantity: 50 }),
        ),
      ).rejects.toThrow('Stock insuffisant');
      await prisma.$transaction((tx) =>
        ledger.update(tx, e.movements[0].id, { quantity: 90 }),
      );
      expect((await level()).quantity).toBe(10);
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two parallel exits of 600 through on a stock of 1000', async () => {
      await entry('2026-01-02', 1000, 300);
      const results = await Promise.allSettled([
        exit('2026-01-03', 600),
        exit('2026-01-03', 600),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
        BadRequestException,
      );
      expect((await level()).quantity).toBe(400);
    });

    it('creates the lock row once when the first movements of a new article run in parallel', async () => {
      const results = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((n) => entry('2026-01-02', n, 100)),
      );
      expect(
        results
          .filter((r) => r.status === 'rejected')
          .map((r) => String(r.reason)),
      ).toEqual([]);
      expect(await prisma.farmStockItem.count()).toBe(1);
      expect((await level()).quantity).toBe(15);
    });
  });

  describe('batches and FEFO', () => {
    async function batch(
      lot: string,
      expiry: string | null,
      quantity: number,
      received = '2026-01-02',
      over: { stockItemId?: string } = {},
    ) {
      return prisma.$transaction(async (tx) => {
        const b = await ledger.createBatch(tx, {
          farmId,
          stockItemId: over.stockItemId ?? item,
          lotNumber: lot,
          expiryDate: expiry ? day(expiry) : null,
          receivedDate: day(received),
        });
        await ledger.record(
          tx,
          input({
            type: 'ENTREE',
            stockItemId: over.stockItemId ?? item,
            date: day(received),
            quantity,
            stockBatchId: b.id,
          }),
        );
        return b;
      });
    }

    const takeable = (date: string, qty: number, over = {}) =>
      exit(date, qty, { reason: 'CONSOMMATION', ...over });

    const batchQty = async () =>
      Object.fromEntries(
        (await ledger.batchLevels([farmId], [item])).map((b) => [
          String(b.batch.lotNumber),
          b.quantity.toNumber(),
        ]),
      );

    it('consumes the earliest-expiring batch first, then the next, batches without expiry last', async () => {
      await batch('NOEXP', null, 100);
      await batch('LATE', '2026-12-01', 100);
      await batch('SOON', '2026-06-01', 100);
      const out = await takeable('2026-01-10', 150);
      expect(out.movements).toHaveLength(2);
      expect(await batchQty()).toEqual({ SOON: 0, LATE: 50, NOEXP: 100 });
      expect((await level()).quantity).toBe(150);
    });

    it('splits one operation into movements sharing its source, all costed at the same average', async () => {
      await batch('A', '2026-06-01', 100);
      await batch('B', '2026-07-01', 100);
      const out = await takeable('2026-01-10', 150, {
        sourceType: 'FEED_DISTRIBUTION' as const,
        sourceId: 'd1',
      });
      expect(out.movements.map((m) => m.sourceId)).toEqual(['d1', 'd1']);
      expect(out.movements.map((m) => m.quantity.toNumber())).toEqual([
        -100, -50,
      ]);
      expect(out.cost.toNumber()).toBe(45000);
    });

    it('consumes stock held in no batch after the batches', async () => {
      await entry('2026-01-01', 100, 300);
      await batch('A', '2026-06-01', 50);
      await takeable('2026-01-10', 120);
      expect(await batchQty()).toEqual({ A: 0 });
      expect((await level()).quantity).toBe(30);
    });

    it('skips an expired batch: expired stock still counts in the level but cannot be consumed', async () => {
      await batch('OLD', '2026-01-05', 100, '2026-01-01');
      await batch('OK', '2026-12-01', 100, '2026-01-01');
      await takeable('2026-01-10', 60);
      expect(await batchQty()).toEqual({ OLD: 100, OK: 40 });
      expect((await level()).quantity).toBe(140);
    });

    it('refuses with "Lot périmé" when only expired stock remains', async () => {
      await batch('OLD', '2026-01-05', 100, '2026-01-01');
      await expect(takeable('2026-01-10', 10)).rejects.toThrow(
        new BadRequestException('Lot périmé'),
      );
    });

    it('refuses when the non-expired stock is short although the total is enough', async () => {
      await batch('OLD', '2026-01-05', 100, '2026-01-01');
      await batch('OK', '2026-12-01', 20, '2026-01-01');
      await expect(takeable('2026-01-10', 50)).rejects.toThrow(
        new BadRequestException(
          'Stock insuffisant (une partie du stock est périmée)',
        ),
      );
    });

    it('a lot is not expired on its expiry day', async () => {
      await batch('DAY', '2026-01-10', 100, '2026-01-01');
      await expect(takeable('2026-01-10', 10)).resolves.toBeDefined();
      await expect(takeable('2026-01-11', 10)).rejects.toThrow('Lot périmé');
    });

    it('takes from the named batch, refuses more than it holds or an expired one', async () => {
      const a = await batch('A', '2026-06-01', 100);
      const old = await batch('OLD', '2026-01-05', 100, '2026-01-01');
      await batch('B', '2026-03-01', 100);
      await takeable('2026-01-10', 30, { stockBatchId: a.id });
      expect(await batchQty()).toMatchObject({ A: 70, B: 100 });
      await expect(
        takeable('2026-01-10', 80, { stockBatchId: a.id }),
      ).rejects.toThrow(/^Stock insuffisant/);
      await expect(
        takeable('2026-01-10', 10, { stockBatchId: old.id }),
      ).rejects.toThrow(new BadRequestException('Lot périmé'));
    });

    it('lets a loss or an inventory adjustment write expired stock off', async () => {
      const old = await batch('OLD', '2026-01-05', 100, '2026-01-01');
      await exit('2026-01-10', 40, { reason: 'PERTE', stockBatchId: old.id });
      await record({
        type: 'AJUSTEMENT',
        reason: 'INVENTAIRE',
        quantity: -10,
        date: day('2026-01-10'),
      });
      expect(await batchQty()).toEqual({ OLD: 50 });
    });

    it("refuses another article's or another farm's batch", async () => {
      const other = await batch('X', null, 10, '2026-01-02', {
        stockItemId: item2,
      });
      await expect(
        takeable('2026-01-10', 1, { stockBatchId: other.id }),
      ).rejects.toThrow('Lot invalide');
    });

    it('refuses a change that would take a batch below zero while other stock covers the total', async () => {
      const a = await batch('A', '2026-06-01', 50);
      await entry('2026-01-01', 100, 300);
      await takeable('2026-01-10', 30, { stockBatchId: a.id });
      const received = await prisma.stockMovement.findFirstOrThrow({
        where: { stockBatchId: a.id, quantity: { gt: 0 } },
      });
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, received.id, { quantity: 20 }),
        ),
      ).rejects.toThrow(
        new BadRequestException('Stock insuffisant pour Aliment ponte'),
      );
      expect(await batchQty()).toEqual({ A: 20 });
    });

    it('allocates a back-dated exit on the lots with room: a lot emptied by a later exit is not picked', async () => {
      await batch('A', '2027-06-01', 100);
      await batch('B', '2027-12-01', 100);
      await takeable('2026-01-11', 100); // FEFO empties A
      await takeable('2026-01-10', 20);
      expect(await batchQty()).toEqual({ A: 0, B: 80 });
    });

    it('writes expired lots off first when an exit is not a consumption, then follows FEFO', async () => {
      await batch('OK', '2027-01-01', 10, '2026-01-01');
      await batch('OLD', '2026-01-05', 10, '2026-01-01');
      const out = await exit('2026-01-10', 15, { reason: 'PERTE' });
      expect(out.movements.map((m) => m.quantity.toNumber())).toEqual([
        -10, -5,
      ]);
      expect(await batchQty()).toEqual({ OLD: 0, OK: 5 });
    });

    it('does not let a consumption that is already expired in the history block unrelated writes', async () => {
      const a = await batch('A', '2026-01-05', 100, '2026-01-01');
      // Written before expiry rules were enforced (or by a lot edit): consumption dated after the expiry.
      await prisma.stockMovement.create({
        data: {
          farmId,
          stockItemId: item,
          stockBatchId: a.id,
          date: day('2026-01-10'),
          type: 'SORTIE',
          quantity: -10,
          unitCost: 300,
          reason: 'CONSOMMATION',
          operationId: 'legacy',
          createdById: userId,
        },
      });
      await expect(entry('2026-01-20', 5, 300)).resolves.toBeDefined();
      await expect(
        exit('2026-01-21', 1, { reason: 'PERTE', stockBatchId: a.id }),
      ).resolves.toBeDefined();
      // Touching that lot's expiry does re-check it.
      const received = await prisma.stockMovement.findFirstOrThrow({
        where: { stockBatchId: a.id, quantity: { gt: 0 } },
      });
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, received.id, { expiryDate: day('2026-01-06') }),
        ),
      ).rejects.toThrow('Lot périmé');
    });

    it('refuses an expiry before the reception, when creating or editing a lot', async () => {
      await expect(
        prisma.$transaction((tx) =>
          ledger.createBatch(tx, {
            farmId,
            stockItemId: item,
            expiryDate: day('2025-12-31'),
            receivedDate: day('2026-01-02'),
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      const a = await batch('A', '2027-06-01', 10);
      const received = await prisma.stockMovement.findFirstOrThrow({
        where: { stockBatchId: a.id },
      });
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, received.id, { expiryDate: day('2026-01-01') }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-checks a consumption already drawn from a lot when its expiry moves earlier, and writes nothing', async () => {
      const a = await batch('A', '2027-06-01', 10);
      await takeable('2026-01-10', 5, { stockBatchId: a.id });
      const received = await prisma.stockMovement.findFirstOrThrow({
        where: { stockBatchId: a.id, quantity: { gt: 0 } },
      });
      // The caller keeps its transaction after the refusal: nothing may have been written.
      const expiry = await prisma.$transaction(async (tx) => {
        await expect(
          ledger.update(tx, received.id, {
            expiryDate: day('2026-01-05'),
            note: 'x',
          }),
        ).rejects.toThrow(new BadRequestException('Lot périmé'));
        return tx.stockBatch.findUniqueOrThrow({ where: { id: a.id } });
      });
      expect(expiry.expiryDate).toEqual(day('2027-06-01'));
      await prisma.$transaction((tx) =>
        ledger.update(tx, received.id, { expiryDate: day('2026-01-10') }),
      );
    });
  });

  describe('operations', () => {
    async function twoLots() {
      const mk = (lot: string, expiry: string) =>
        prisma.$transaction(async (tx) => {
          const b = await ledger.createBatch(tx, {
            farmId,
            stockItemId: item,
            lotNumber: lot,
            expiryDate: day(expiry),
            receivedDate: day('2026-01-02'),
          });
          await ledger.record(
            tx,
            input({
              type: 'ENTREE',
              date: day('2026-01-02'),
              quantity: 100,
              stockBatchId: b.id,
            }),
          );
          return b;
        });
      return { a: await mk('A', '2027-06-01'), b: await mk('B', '2027-12-01') };
    }
    const pieces = () =>
      prisma.stockMovement.findMany({
        where: { quantity: { lt: 0 } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

    it('shares one operation id between the pieces of a split exit, and gives a lone movement its own', async () => {
      await twoLots();
      const out = await exit('2026-01-10', 150, { reason: 'CONSOMMATION' });
      expect(out.movements).toHaveLength(2);
      expect(new Set(out.movements.map((m) => m.operationId)).size).toBe(1);
      const all = await prisma.stockMovement.findMany();
      expect(new Set(all.map((m) => m.operationId)).size).toBe(3);
    });

    it('removes the whole operation when one piece is removed', async () => {
      await twoLots();
      const out = await exit('2026-01-10', 150);
      const removed = await prisma.$transaction((tx) =>
        ledger.remove(tx, out.movements[1].id),
      );
      expect(removed).toHaveLength(2);
      expect(await pieces()).toHaveLength(0);
      expect((await level()).quantity).toBe(200);
    });

    it('re-plans the whole operation on update, so a bigger quantity draws on other lots, keeping its operation id', async () => {
      const { a } = await twoLots();
      const out = await exit('2026-01-10', 60);
      expect(out.movements).toHaveLength(1);
      const { after } = await prisma.$transaction((tx) =>
        ledger.update(tx, out.movements[0].id, { quantity: -130 }),
      );
      expect(
        after.map((m) => m.quantity.toNumber()).sort((x, y) => x - y),
      ).toEqual([-100, -30]);
      expect(new Set(after.map((m) => m.operationId))).toEqual(
        new Set([out.movements[0].operationId]),
      );
      expect(
        (await ledger.batchLevels([farmId], [item])).map((l) =>
          l.quantity.toNumber(),
        ),
      ).toEqual([0, 70]);
      // A smaller one gives stock back, and a date change is allocated as of the new date.
      await prisma.$transaction((tx) =>
        ledger.update(tx, after[0].id, {
          quantity: -20,
          date: day('2026-01-05'),
        }),
      );
      expect(
        (await pieces()).map((m) => [m.stockBatchId, m.quantity.toNumber()]),
      ).toEqual([[a.id, -20]]);
    });

    it('keeps an edited exit at its place in the day and keeps its ids: a quantity change does not reorder the day', async () => {
      await entry('2026-01-01', 100, 100);
      const e1 = await exit('2026-01-05', 10);
      await entry('2026-01-05', 100, 200);
      const e2 = await exit('2026-01-05', 10);
      expect(e2.unitCost.toNumber()).toBe(
        Number(((90 * 100 + 100 * 200) / 190).toFixed(2)),
      );
      const id = e1.movements[0].id;
      const created = e1.movements[0].createdAt;
      await prisma.$transaction((tx) =>
        ledger.update(tx, id, { quantity: -20 }),
      );
      const rows = await prisma.stockMovement.findMany({
        where: { type: 'SORTIE' },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(rows.map((r) => r.id)).toEqual([id, e2.movements[0].id]);
      expect(rows[0].createdAt).toEqual(created);
      expect(rows[0].unitCost.toNumber()).toBe(100);
      // 80 @ 100 then 100 @ 200 before the second exit.
      expect(rows[1].unitCost.toNumber()).toBe(
        Number(((80 * 100 + 100 * 200) / 180).toFixed(2)),
      );
      // The id the client edited is still there to be edited again.
      await prisma.$transaction((tx) =>
        ledger.update(tx, id, { quantity: -15 }),
      );
      expect((await level()).quantity).toBe(100 + 100 - 15 - 10);
    });

    it('rewrites only the pieces that change, and keeps the id of a piece whose lot survives', async () => {
      await twoLots();
      const out = await exit('2026-01-10', 150);
      const [pa, pb] = out.movements;
      const before = await prisma.stockMovement.findMany({
        orderBy: { createdAt: 'asc' },
      });
      await prisma.$transaction((tx) =>
        ledger.update(tx, pa.id, { quantity: -170 }),
      );
      const after = await prisma.stockMovement.findMany({
        orderBy: { createdAt: 'asc' },
      });
      const same = (id: string) => ({
        b: before.find((r) => r.id === id)!,
        a: after.find((r) => r.id === id)!,
      });
      expect(same(pa.id).a.updatedAt).toEqual(same(pa.id).b.updatedAt); // lot A piece unchanged (-100)
      expect(same(pb.id).a.quantity.toNumber()).toBe(-70);
      expect(after).toHaveLength(before.length);
    });

    it('puts an operation whose date changes at the end of the new day', async () => {
      await entry('2026-01-01', 100, 100);
      const e1 = await exit('2026-01-05', 10);
      await exit('2026-01-06', 10);
      await prisma.$transaction((tx) =>
        ledger.update(tx, e1.movements[0].id, { date: day('2026-01-06') }),
      );
      const rows = await prisma.stockMovement.findMany({
        where: { type: 'SORTIE' },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(rows[1].id).toBe(e1.movements[0].id);
      expect(rows[1].createdAt.getTime()).toBeGreaterThan(
        rows[0].createdAt.getTime(),
      );
    });

    it('re-plans an explicit-lot exit strictly on its lot, and a FEFO exit on FEFO', async () => {
      const { a, b } = await twoLots();
      const named = await exit('2026-01-10', 10, { stockBatchId: b.id });
      expect(named.movements[0].lotExplicit).toBe(true);
      await prisma.$transaction((tx) =>
        ledger.update(tx, named.movements[0].id, { quantity: -100 }),
      );
      expect(
        (await pieces()).map((m) => [m.stockBatchId, m.quantity.toNumber()]),
      ).toEqual([[b.id, -100]]);
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, named.movements[0].id, { quantity: -101 }),
        ),
      ).rejects.toThrow(
        /^Stock insuffisant pour Aliment ponte, lot B \(disponible 100 kg\)$/,
      );
      await prisma.stockMovement.deleteMany({ where: { quantity: { lt: 0 } } });
      const fefo = await exit('2026-01-10', 60);
      expect(fefo.movements[0].lotExplicit).toBe(false);
      await prisma.$transaction((tx) =>
        ledger.update(tx, fefo.movements[0].id, { quantity: -130 }),
      );
      // The pieces of one operation share a place in the day: compare them as a set.
      expect(
        (await pieces())
          .map((m) => [m.stockBatchId, m.quantity.toNumber()])
          .sort((x, y) => Number(x[1]) - Number(y[1])),
      ).toEqual([
        [a.id, -100],
        [b.id, -30],
      ]);
    });

    const lotLater = (date: string, quantity: number, lot = 'B') =>
      prisma.$transaction(async (tx) => {
        const b = await ledger.createBatch(tx, {
          farmId,
          stockItemId: item,
          lotNumber: lot,
          expiryDate: day('2027-01-01'),
          receivedDate: day(date),
        });
        await ledger.record(
          tx,
          input({
            type: 'ENTREE',
            date: day(date),
            quantity,
            stockBatchId: b.id,
          }),
        );
        return b;
      });

    it('re-plans an edited exit at its own position: a lot received later the same day is not drawn on, up or down', async () => {
      await entry('2026-01-01', 100, 10); // stock held in no lot
      const e = await exit('2026-01-05', 10); // morning: no lot exists yet
      const lot = await lotLater('2026-01-05', 50);
      for (const quantity of [-5, -20, -10]) {
        await expect(
          prisma.$transaction((tx) =>
            ledger.update(tx, e.movements[0].id, { quantity }),
          ),
        ).resolves.toBeDefined();
      }
      expect(
        (await pieces()).map((m) => [m.stockBatchId, m.quantity.toNumber()]),
      ).toEqual([[null, -10]]);
      expect(
        (await ledger.batchLevels([farmId], [item]))[0].quantity.toNumber(),
      ).toBe(50);
      expect(lot.id).toBeDefined();
    });

    it('keeps naming the lot when an explicit-lot exit is edited beyond what the lot held at its position', async () => {
      const a = await prisma.$transaction(async (tx) => {
        const b = await ledger.createBatch(tx, {
          farmId,
          stockItemId: item,
          lotNumber: 'A',
          expiryDate: null,
          receivedDate: day('2026-01-01'),
        });
        await ledger.record(
          tx,
          input({
            type: 'ENTREE',
            date: day('2026-01-01'),
            quantity: 50,
            stockBatchId: b.id,
          }),
        );
        return b;
      });
      const e = await exit('2026-01-05', 10, { stockBatchId: a.id });
      await lotLater('2026-01-05', 500);
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, e.movements[0].id, { quantity: -60 }),
        ),
      ).rejects.toThrow(/lot A \(disponible 50 kg\)/);
    });

    it('audits an operation once, keyed by its operation id, with the pieces in the payload', async () => {
      await twoLots();
      const ctx: RequestContext = {
        user: {
          id: userId,
          name: 'Dir',
          role: 'DIRECTEUR_FERME',
          organizationId: orgId,
        },
        farmId,
        allFarms: false,
        farmIds: [farmId],
      };
      const out = await prisma.$transaction((tx) =>
        ledger.record(tx, {
          ...input({ type: 'SORTIE', quantity: -150, date: day('2026-01-10') }),
          audit: { ctx },
        }),
      );
      const op = out.movements[0].operationId;
      await prisma.$transaction((tx) =>
        ledger.update(tx, out.movements[0].id, { note: 'n' }, [farmId], {
          ctx,
        }),
      );
      await prisma.$transaction((tx) =>
        ledger.remove(tx, out.movements[0].id, [farmId], { ctx }),
      );
      const rows = await prisma.auditLog.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => [r.action, r.recordId])).toEqual([
        ['CREATE', op],
        ['UPDATE', op],
        ['DELETE', op],
      ]);
      expect((rows[0].after as unknown[]).length).toBe(2);
    });
  });

  describe('replaceBySource', () => {
    const src = { sourceType: 'FEED_DISTRIBUTION', sourceId: 's1' } as const;
    const base = (stockItemId: string, n: number) => ({
      farmId,
      stockItemId,
      date: day('2026-01-05'),
      type: 'SORTIE' as const,
      quantity: -n,
      reason: 'CONSOMMATION' as const,
      userId,
    });

    it('replaces what a source wrote, on other articles too, in one transaction', async () => {
      await entry('2026-01-01', 100, 10);
      await record({
        type: 'ENTREE',
        stockItemId: item2,
        date: day('2026-01-01'),
        quantity: 100,
        unitCost: 20,
      });
      await exit('2026-01-05', 10, src);
      const results = await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's1', [
          base(item2, 30),
          base(item, 5),
        ]),
      );
      expect(results.map((r) => r.cost.toNumber())).toEqual([600, 50]);
      expect((await level(item)).quantity).toBe(95);
      expect((await level(item2)).quantity).toBe(70);
      expect(
        await prisma.stockMovement.count({ where: { sourceId: 's1' } }),
      ).toBe(2);
    });

    it('writes nothing when the new movements are refused, even if the caller keeps its transaction', async () => {
      await entry('2026-01-01', 100, 10);
      await exit('2026-01-05', 10, src);
      const count = await prisma.$transaction(async (tx) => {
        await expect(
          ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's1', [
            base(item, 500),
          ]),
        ).rejects.toThrow('Stock insuffisant');
        return tx.stockMovement.count({ where: { sourceId: 's1' } });
      });
      expect(count).toBe(1);
      expect((await level()).quantity).toBe(90);
    });

    it('replaces with nothing (a plain reversal) and with something when the source had nothing', async () => {
      await entry('2026-01-01', 100, 10);
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 'new', [base(item, 5)]),
      );
      expect((await level()).quantity).toBe(95);
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 'new', []),
      );
      expect((await level()).quantity).toBe(100);
    });

    it('keeps ids and place in the day for an input whose date is unchanged, and re-plans an explicit lot strictly', async () => {
      await entry('2026-01-01', 100, 10);
      await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          {
            ...base(item, 10),
            sourceType: 'FEED_DISTRIBUTION',
            sourceId: 's1',
          },
        ]),
      );
      const first = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceId: 's1' },
      });
      await entry('2026-01-05', 50, 40); // later in the same day
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's1', [base(item, 25)]),
      );
      const again = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceId: 's1' },
      });
      expect(again.id).toBe(first.id);
      expect(again.createdAt).toEqual(first.createdAt);
      expect(again.operationId).toBe(first.operationId);
      expect(again.quantity.toNumber()).toBe(-25);
      expect(again.unitCost.toNumber()).toBe(10);

      const lot = await prisma.$transaction(async (tx) => {
        const b = await ledger.createBatch(tx, {
          farmId,
          stockItemId: item,
          lotNumber: 'L9',
          expiryDate: null,
          receivedDate: day('2026-01-02'),
        });
        await ledger.record(
          tx,
          input({
            type: 'ENTREE',
            date: day('2026-01-02'),
            quantity: 20,
            stockBatchId: b.id,
          }),
        );
        return b;
      });
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'HEALTH_ACT', 'h1', [
          { ...base(item, 5), stockBatchId: lot.id },
        ]),
      );
      await expect(
        prisma.$transaction((tx) =>
          ledger.replaceBySource(tx, 'HEALTH_ACT', 'h1', [
            { ...base(item, 21), stockBatchId: lot.id },
          ]),
        ),
      ).rejects.toThrow(/lot L9/);
      expect((await level()).quantity).toBe(100 - 25 + 50 + 20 - 5);
    });

    it('re-plans a replaced exit at its own position, so a lot received later the same day is not drawn on', async () => {
      await entry('2026-01-01', 100, 10);
      await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          {
            ...base(item, 10),
            sourceType: 'FEED_DISTRIBUTION',
            sourceId: 'm1',
          },
        ]),
      );
      await prisma.$transaction(async (tx) => {
        const b = await ledger.createBatch(tx, {
          farmId,
          stockItemId: item,
          lotNumber: 'B',
          expiryDate: day('2027-01-01'),
          receivedDate: day('2026-01-05'),
        });
        await ledger.record(
          tx,
          input({
            type: 'ENTREE',
            date: day('2026-01-05'),
            quantity: 50,
            stockBatchId: b.id,
          }),
        );
      });
      for (const n of [5, 20, 10]) {
        await expect(
          prisma.$transaction((tx) =>
            ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 'm1', [
              base(item, n),
            ]),
          ),
        ).resolves.toBeDefined();
      }
      const rows = await prisma.stockMovement.findMany({
        where: { sourceId: 'm1' },
      });
      expect(rows.map((r) => [r.stockBatchId, r.quantity.toNumber()])).toEqual([
        [null, -10],
      ]);
    });

    it('keeps each input its own operation, piece ids and order across repeated edits of a source with two same-article lines', async () => {
      await entry('2026-01-01', 500, 10);
      await prisma.$transaction((tx) =>
        ledger.recordMany(
          tx,
          [10, 20].map((n) => ({
            ...base(item, n),
            sourceType: 'FEED_DISTRIBUTION' as const,
            sourceId: 's2',
          })),
        ),
      );
      const snap = async () =>
        (
          await prisma.stockMovement.findMany({
            where: { sourceId: 's2' },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          })
        ).map((m) => [m.id, m.operationId, m.createdAt.getTime()]);
      const first = await snap();
      for (const [a, b] of [
        [11, 21],
        [12, 22],
        [13, 23],
      ]) {
        await prisma.$transaction((tx) =>
          ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's2', [
            base(item, a),
            base(item, b),
          ]),
        );
        expect(await snap()).toEqual(first);
        const q = await prisma.stockMovement.findMany({
          where: { sourceId: 's2' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        expect(q.map((m) => m.quantity.toNumber())).toEqual([-a, -b]);
      }
    });

    it('lets an input clear the note and change the reason of a reused row, and never reuses a row of another type', async () => {
      await entry('2026-01-01', 100, 10);
      await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          {
            ...base(item, 10),
            note: 'à corriger',
            sourceType: 'FEED_DISTRIBUTION',
            sourceId: 's3',
          },
        ]),
      );
      const first = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceId: 's3' },
      });
      expect(first.note).toBe('à corriger');
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's3', [
          { ...base(item, 12), reason: 'TRAITEMENT' },
        ]),
      );
      const second = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceId: 's3' },
      });
      expect(second).toMatchObject({
        id: first.id,
        note: null,
        reason: 'TRAITEMENT',
      });
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's3', [
          { ...base(item, 12), type: 'AJUSTEMENT', reason: 'INVENTAIRE' },
        ]),
      );
      const third = await prisma.stockMovement.findFirstOrThrow({
        where: { sourceId: 's3' },
      });
      expect(third.type).toBe('AJUSTEMENT');
      expect(third.id).not.toBe(first.id);
      expect(
        await prisma.stockMovement.count({ where: { sourceId: 's3' } }),
      ).toBe(1);
    });

    it('does not deadlock when two concurrent edits swap the articles of their operations', async () => {
      await entry('2026-01-01', 1000, 10);
      await record({
        type: 'ENTREE',
        stockItemId: item2,
        date: day('2026-01-01'),
        quantity: 1000,
        unitCost: 10,
      });
      for (let round = 0; round < 4; round += 1) {
        const [first, second] = round % 2 === 0 ? [item, item2] : [item2, item];
        await prisma.stockMovement.deleteMany({
          where: { sourceType: { not: null } },
        });
        await prisma.$transaction(async (tx) => {
          await ledger.recordMany(tx, [
            {
              ...base(first, 10),
              sourceType: 'FEED_DISTRIBUTION',
              sourceId: 'x',
            },
            { ...base(second, 10), sourceType: 'HEALTH_ACT', sourceId: 'y' },
          ]);
        });
        const swap = (
          type: 'FEED_DISTRIBUTION' | 'HEALTH_ACT',
          id: string,
          to: string,
        ) =>
          prisma.$transaction((tx) =>
            ledger.replaceBySource(tx, type, id, [base(to, 20)]),
          );
        const results = await Promise.allSettled([
          swap('FEED_DISTRIBUTION', 'x', second),
          swap('HEALTH_ACT', 'y', first),
        ]);
        expect(results.map((r) => r.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
      }
    });
  });

  describe('reverseBySource', () => {
    const src = { sourceType: 'FEED_DISTRIBUTION', sourceId: 's1' } as const;

    it('removes every movement of the source across articles and recosts later exits', async () => {
      await entry('2026-01-01', 100, 100);
      await record({
        type: 'ENTREE',
        stockItemId: item2,
        date: day('2026-01-01'),
        quantity: 100,
        unitCost: 10,
      });
      await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          input({
            type: 'SORTIE',
            quantity: -40,
            date: day('2026-01-05'),
            ...src,
          }),
          input({
            type: 'SORTIE',
            stockItemId: item2,
            quantity: -10,
            date: day('2026-01-05'),
            ...src,
          }),
        ]),
      );
      const removed = await prisma.$transaction((tx) =>
        ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 's1'),
      );
      expect(removed).toHaveLength(2);
      expect((await level(item)).quantity).toBe(100);
      expect((await level(item2)).quantity).toBe(100);
    });

    it('recosts the exits after the removed one', async () => {
      await entry('2026-01-01', 100, 100);
      await exit('2026-01-02', 30, src);
      await entry('2026-01-03', 100, 200);
      await exit('2026-01-04', 10);
      await prisma.$transaction((tx) =>
        ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 's1'),
      );
      // 100 @ 100 + 100 @ 200 → average 150 for the exit left.
      expect((await stored()).map((m) => m.unitCost)).toEqual([100, 200, 150]);
    });

    it('refuses, leaving everything unchanged, when a later exit would go negative', async () => {
      await entry('2026-01-01', 100, 100);
      const e2 = { ...src, sourceId: 'entry-source' } as const;
      await prisma.$transaction((tx) =>
        ledger.record(
          tx,
          input({
            type: 'ENTREE',
            date: day('2026-01-02'),
            quantity: 50,
            unitCost: 100,
            ...e2,
          }),
        ),
      );
      await exit('2026-01-03', 140);
      await expect(
        prisma.$transaction((tx) =>
          ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 'entry-source'),
        ),
      ).rejects.toThrow(
        new BadRequestException('Stock insuffisant pour Aliment ponte'),
      );
      expect(await stored()).toHaveLength(3);
    });

    it('is a no-op for an unknown source', async () => {
      expect(
        await prisma.$transaction((tx) =>
          ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 'nope'),
        ),
      ).toEqual([]);
    });

    it('keeps the lot of a reversed entry, empty and unlisted (no orphan deletion, no race with a reader naming it)', async () => {
      await prisma.$transaction(async (tx) => {
        const b = await ledger.createBatch(tx, {
          farmId,
          stockItemId: item,
          lotNumber: 'L1',
          expiryDate: null,
          receivedDate: day('2026-01-02'),
        });
        await ledger.record(
          tx,
          input({
            type: 'ENTREE',
            date: day('2026-01-02'),
            quantity: 10,
            stockBatchId: b.id,
            sourceType: 'PURCHASE',
            sourceId: 'p1',
          }),
        );
      });
      await prisma.$transaction((tx) =>
        ledger.reverseBySource(tx, 'PURCHASE', 'p1'),
      );
      expect(await prisma.stockBatch.count()).toBe(1);
      expect(await ledger.batchLevels([farmId], [item])).toEqual([]);
    });
  });

  describe('recordMany', () => {
    it('writes every input or none', async () => {
      await entry('2026-01-01', 10, 100);
      await expect(
        prisma.$transaction((tx) =>
          ledger.recordMany(tx, [
            input({ type: 'SORTIE', quantity: -5, date: day('2026-01-02') }),
            input({
              type: 'SORTIE',
              stockItemId: item2,
              quantity: -1,
              date: day('2026-01-02'),
            }),
          ]),
        ),
      ).rejects.toThrow('Stock insuffisant');
      expect(await stored()).toHaveLength(1);
    });

    it('lets two inputs on the same article see each other', async () => {
      const results = await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          input({ type: 'ENTREE', quantity: 10, date: day('2026-01-02') }),
          input({ type: 'SORTIE', quantity: -10, date: day('2026-01-02') }),
        ]),
      );
      expect(results[1].unitCost.toNumber()).toBe(300);
      expect((await level()).quantity).toBe(0);
    });
  });

  describe('validation', () => {
    it.each([
      ['an entry with a negative quantity', { type: 'ENTREE', quantity: -1 }],
      ['an exit with a positive quantity', { type: 'SORTIE', quantity: 1 }],
      ['a zero quantity', { type: 'AJUSTEMENT', quantity: 0 }],
      ['a reserved transfer type', { type: 'TRANSFERT_ENTREE', quantity: 1 }],
      [
        'an entry with no cost',
        { type: 'ENTREE', quantity: 1, unitCost: null },
      ],
      [
        'an entry with a negative cost',
        { type: 'ENTREE', quantity: 1, unitCost: -1 },
      ],
    ] as const)('refuses %s', async (_name, over) => {
      await expect(
        prisma.$transaction((tx) =>
          ledger.record(tx, {
            ...input({ type: 'ENTREE', quantity: 1 }),
            ...over,
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await stored()).toHaveLength(0);
    });

    it('refuses a future date', async () => {
      await expect(
        record({
          type: 'ENTREE',
          quantity: 1,
          date: day(daysAgo(-2)),
        }),
      ).rejects.toThrow('La date ne peut pas être dans le futur');
    });

    it('refuses an article of another organisation', async () => {
      const org2 = await prisma.organization.create({ data: { name: 'O2' } });
      const foreign = await makeItem('Autre', 'MATERIEL', 'u', org2.id);
      await expect(
        record({ type: 'ENTREE', quantity: 1, stockItemId: foreign }),
      ).rejects.toThrow('Article invalide');
    });

    it('rejects a movement whose type and sign disagree at the database level', async () => {
      await expect(
        prisma.stockMovement.create({
          data: {
            farmId,
            stockItemId: item,
            date: day('2026-01-01'),
            type: 'SORTIE',
            quantity: 5,
            unitCost: 0,
            reason: 'AUTRE',
            operationId: 'op-1',
            createdById: userId,
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.stockMovement.create({
          data: {
            farmId,
            stockItemId: item,
            date: day('2026-01-01'),
            type: 'AJUSTEMENT',
            quantity: 0,
            unitCost: 0,
            reason: 'INVENTAIRE',
            operationId: 'op-2',
            createdById: userId,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('audit', () => {
    const ctx: RequestContext = {
      user: {
        id: '',
        name: 'Dir',
        role: 'DIRECTEUR_FERME',
        organizationId: '',
      },
      farmId: null,
      allFarms: false,
      farmIds: [],
    };
    const withCtx = (): RequestContext => ({
      ...ctx,
      user: { ...ctx.user, id: userId, organizationId: orgId },
      farmId,
      farmIds: [farmId],
    });

    it('writes one audit row per recorded operation when given a context, none otherwise', async () => {
      await entry('2026-01-01', 100, 100);
      expect(await prisma.auditLog.count()).toBe(0);
      await prisma.$transaction((tx) =>
        ledger.record(tx, {
          ...input({ type: 'SORTIE', quantity: -10, date: day('2026-01-02') }),
          audit: { ctx: withCtx() },
        }),
      );
      const rows = await prisma.auditLog.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        module: 'stocks',
        action: 'CREATE',
        farmId,
      });
    });

    it('audits update and remove once each; reverseBySource leaves the audit to the owning module', async () => {
      const e = await entry('2026-01-01', 100, 100);
      const a = { ctx: withCtx() };
      await prisma.$transaction((tx) =>
        ledger.update(tx, e.movements[0].id, { note: 'x' }, [farmId], a),
      );
      await prisma.$transaction((tx) =>
        ledger.remove(tx, e.movements[0].id, [farmId], a),
      );
      await prisma.$transaction((tx) =>
        ledger.record(
          tx,
          input({
            type: 'ENTREE',
            quantity: 5,
            sourceType: 'PURCHASE',
            sourceId: 'p9',
          }),
        ),
      );
      await prisma.$transaction((tx) =>
        ledger.reverseBySource(tx, 'PURCHASE', 'p9'),
      );
      expect(
        (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
          (r) => r.action,
        ),
      ).toEqual(['UPDATE', 'DELETE']);
    });
  });

  describe('reads', () => {
    it('reports quantity, average and value per (farm, article), and only for the asked farms', async () => {
      await entry('2026-01-01', 10, 100);
      await record({
        type: 'ENTREE',
        farmId: otherFarmId,
        date: day('2026-01-01'),
        quantity: 5,
        unitCost: 200,
      });
      const all = await ledger.levels([farmId, otherFarmId]);
      expect(all.get(levelKey(farmId, item))?.value.toNumber()).toBe(1000);
      expect(all.get(levelKey(otherFarmId, item))?.value.toNumber()).toBe(1000);
      expect(
        (await ledger.levels([farmId])).has(levelKey(otherFarmId, item)),
      ).toBe(false);
    });

    it('rounds the value to two decimals from the full-precision average', async () => {
      await entry('2026-01-01', 3, 100);
      await entry('2026-01-02', 4, 100.01);
      const l = (await ledger.levels([farmId], [item])).get(
        levelKey(farmId, item),
      )!;
      expect(l.value.toNumber()).toBe(700.04);
    });

    it('computes the quantity held at a date', async () => {
      await entry('2026-01-01', 100, 10);
      await exit('2026-01-10', 30);
      expect(
        (await ledger.quantitiesAt(farmId, [item], day('2026-01-09')))
          .get(item)
          ?.toNumber(),
      ).toBe(100);
      expect(
        (await ledger.quantitiesAt(farmId, [item], day('2026-01-10')))
          .get(item)
          ?.toNumber(),
      ).toBe(70);
    });

    it('averages the consumption of the 30 days ending on the given day, over CONSOMMATION and TRAITEMENT only', async () => {
      const now = new Date('2026-06-30T23:59:00.000Z');
      await record({
        type: 'ENTREE',
        date: day('2026-01-01'),
        quantity: 100000,
        unitCost: 1,
      });
      await exit('2026-06-30', 3000); // today: in
      await exit('2026-06-01', 6000, { reason: 'TRAITEMENT' }); // 29 days before: in
      await exit('2026-05-31', 9000); // 30 days before: out
      await exit('2026-06-15', 9000, { reason: 'PERTE' }); // not a consumption
      const per = await ledger.dailyConsumption(
        [farmId],
        [item],
        30,
        prisma,
        now,
      );
      expect(per.get(levelKey(farmId, item))?.toNumber()).toBe(300);
    });
  });

  describe('a validated inventory closes the past', () => {
    const LOCKED =
      'Un inventaire validé le 2026-01-10 verrouille les mouvements antérieurs de Aliment ponte';
    const feed = (n: number, date = '2026-01-05') =>
      ({
        farmId,
        stockItemId: item,
        date: day(date),
        type: 'SORTIE' as const,
        quantity: -n,
        reason: 'CONSOMMATION' as const,
        userId,
      }) satisfies RecordInput;

    /** What the inventories service does: adjust by counted − theoretical, then flip the session. */
    async function validatedCount(
      date: string,
      counted: number,
      id = item,
      farm = farmId,
    ) {
      const theoretical =
        (await ledger.quantitiesAt(farm, [id], day(date))).get(id) ?? 0;
      const session = await prisma.inventorySession.create({
        data: {
          farmId: farm,
          date: day(date),
          createdById: userId,
          lines: {
            create: [
              {
                stockItemId: id,
                theoreticalQty: theoretical,
                countedQty: counted,
              },
            ],
          },
        },
      });
      const difference = counted - Number(theoretical);
      if (difference !== 0) {
        await record({
          type: 'AJUSTEMENT',
          reason: 'INVENTAIRE',
          quantity: difference,
          date: day(date),
          stockItemId: id,
          farmId: farm,
          sourceType: 'INVENTORY',
          sourceId: session.id,
        });
      }
      await prisma.inventorySession.update({
        where: { id: session.id },
        data: {
          status: 'VALIDEE',
          validatedById: userId,
          validatedAt: new Date(),
        },
      });
    }

    async function counted() {
      await entry('2026-01-01', 100, 10);
      await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          {
            ...feed(10),
            sourceType: 'FEED_DISTRIBUTION',
            sourceId: 'd5',
          },
        ]),
      );
      await validatedCount('2026-01-10', 80); // theoretical 90: −10
      expect((await level()).quantity).toBe(80);
    }

    it('refuses to edit or delete a movement dated before the count, and changes nothing', async () => {
      await counted();
      const before = await prisma.stockMovement.findMany({
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      await expect(
        prisma.$transaction((tx) =>
          ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 'd5', [feed(20)]),
        ),
      ).rejects.toThrow(new ConflictException(LOCKED));
      await expect(
        prisma.$transaction((tx) =>
          ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 'd5'),
        ),
      ).rejects.toThrow(new ConflictException(LOCKED));
      const entryId = before[0].id;
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, entryId, { quantity: 120 }),
        ),
      ).rejects.toThrow(LOCKED);
      await expect(
        prisma.$transaction((tx) => ledger.remove(tx, entryId)),
      ).rejects.toThrow(LOCKED);
      expect(
        await prisma.stockMovement.findMany({
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
      ).toEqual(before);
      expect((await level()).quantity).toBe(80);
    });

    it('allows a cost-only correction of an entry before the count (a count fixes quantities, not values); quantity, date or both stay refused', async () => {
      await counted();
      const entryId = (
        await prisma.stockMovement.findFirstOrThrow({
          where: { type: 'ENTREE' },
        })
      ).id;
      await prisma.$transaction((tx) =>
        ledger.update(tx, entryId, { unitCost: 12 }),
      );
      const stored = await prisma.stockMovement.findUniqueOrThrow({
        where: { id: entryId },
      });
      expect(Number(stored.unitCost)).toBe(12);
      expect(Number(stored.quantity)).toBe(100);
      expect((await level()).quantity).toBe(80);
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, entryId, { unitCost: 11, quantity: 120 }),
        ),
      ).rejects.toThrow(LOCKED);
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, entryId, { unitCost: 11, date: day('2026-01-02') }),
        ),
      ).rejects.toThrow(LOCKED);
      expect(
        Number(
          (
            await prisma.stockMovement.findUniqueOrThrow({
              where: { id: entryId },
            })
          ).unitCost,
        ),
      ).toBe(12);
    });

    it('answers 400, not a foreign-key 500, when the article is deleted between the ledger reading it and locking it', async () => {
      for (let round = 0; round < 3; round++) {
        const doomed = (
          await prisma.stockItem.create({
            data: {
              organizationId: orgId,
              name: `Éphémère ${round}`,
              category: 'MATERIEL',
              unit: 'kg',
            },
          })
        ).id;
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        let locked!: () => void;
        const lockTaken = new Promise<void>((r) => (locked = r));
        const deleter = prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "StockItem" WHERE id = ${doomed} FOR UPDATE`;
          locked();
          await held;
          await tx.farmStockItem.deleteMany({ where: { stockItemId: doomed } });
          await tx.stockItem.delete({ where: { id: doomed } });
        });
        await lockTaken;
        // Reads the article (not blocked), then waits on the FOR KEY SHARE.
        const writer = record({
          type: 'ENTREE',
          date: day('2026-01-01'),
          quantity: 5,
          unitCost: 1,
          stockItemId: doomed,
        });
        const outcome = writer.then(
          () => 'ok',
          (e: unknown) => e,
        );
        await new Promise((r) => setTimeout(r, 300));
        release();
        await deleter;
        const result = await outcome;
        expect(result).toBeInstanceOf(BadRequestException);
        expect((result as BadRequestException).message).toBe(
          'Article invalide pour cette ferme',
        );
      }
    });

    it('refuses a new movement dated before the count (a back-dated reception, a late distribution)', async () => {
      await counted();
      await expect(entry('2026-01-03', 50, 10)).rejects.toThrow(LOCKED);
      await expect(exit('2026-01-09', 5)).rejects.toThrow(LOCKED);
      await expect(
        prisma.$transaction((tx) =>
          ledger.recordMany(tx, [
            {
              ...feed(5, '2026-01-04'),
              sourceType: 'HEALTH_ACT',
              sourceId: 'a',
            },
          ]),
        ),
      ).rejects.toThrow(LOCKED);
      expect(await prisma.stockMovement.count()).toBe(3);
      expect((await level()).quantity).toBe(80);
    });

    it('allows a movement on the count day after the count: the level is counted − quantity', async () => {
      await counted();
      await exit('2026-01-10', 7);
      await entry('2026-01-12', 5, 10);
      expect((await level()).quantity).toBe(78);
      // An operation after the count is re-planned in place, date and position kept.
      await prisma.$transaction((tx) =>
        ledger.recordMany(tx, [
          {
            ...feed(3, '2026-01-11'),
            sourceType: 'FEED_DISTRIBUTION',
            sourceId: 'd11',
          },
        ]),
      );
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 'd11', [
          feed(4, '2026-01-11'),
        ]),
      );
      await prisma.$transaction((tx) =>
        ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 'd11'),
      );
      expect((await level()).quantity).toBe(78);
    });

    it('locks a movement entered the day of the count before the count was validated', async () => {
      await entry('2026-01-01', 100, 10);
      const same = await entry('2026-01-10', 10, 10);
      await validatedCount('2026-01-10', 100);
      await expect(
        prisma.$transaction((tx) =>
          ledger.update(tx, same.movements[0].id, { quantity: 20 }),
        ),
      ).rejects.toThrow(LOCKED);
    });

    it('locks too when the count had no difference (no adjustment was written)', async () => {
      await entry('2026-01-01', 100, 10);
      await validatedCount('2026-01-10', 100);
      expect(await prisma.stockMovement.count()).toBe(1);
      await expect(entry('2026-01-05', 5, 10)).rejects.toThrow(LOCKED);
      await entry('2026-01-10', 5, 10);
    });

    it('does not lock another article or another farm', async () => {
      await entry('2026-01-01', 100, 10);
      await record({
        type: 'ENTREE',
        stockItemId: item2,
        date: day('2026-01-01'),
        quantity: 10,
        unitCost: 5,
      });
      await record({
        type: 'ENTREE',
        farmId: otherFarmId,
        date: day('2026-01-01'),
        quantity: 10,
        unitCost: 5,
      });
      await validatedCount('2026-01-10', 100);
      await exit('2026-01-05', 3, { stockItemId: item2 });
      await exit('2026-01-05', 3, { farmId: otherFarmId });
      await expect(exit('2026-01-05', 3)).rejects.toThrow(LOCKED);
    });

    it('uses the latest count when there are several', async () => {
      await entry('2026-01-01', 100, 10);
      await validatedCount('2026-01-10', 100);
      await validatedCount('2026-01-20', 100);
      await expect(entry('2026-01-15', 1, 10)).rejects.toThrow(
        'Un inventaire validé le 2026-01-20',
      );
    });
  });

  describe('the quantity and average cost cache', () => {
    it('is written by every kind of write, to the replay of the history', async () => {
      await entry('2026-01-01', 100, 10);
      await entry('2026-01-02', 100, 20);
      const out = await exit('2026-01-03', 50);
      await prisma.$transaction((tx) =>
        ledger.update(tx, out.movements[0].id, { quantity: -70 }),
      );
      await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 'c1', [
          {
            farmId,
            stockItemId: item,
            date: day('2026-01-04'),
            type: 'SORTIE',
            quantity: -5,
            reason: 'CONSOMMATION',
            userId,
          },
        ]),
      );
      await prisma.$transaction((tx) => ledger.remove(tx, out.movements[0].id));
      const pair = await prisma.farmStockItem.findFirstOrThrow({
        where: { farmId, stockItemId: item },
      });
      expect(pair.quantity.toNumber()).toBe(195);
      expect(pair.averageCost?.toNumber()).toBe(15);
      expect((await level()).quantity).toBe(195);
    });

    it('answers levels() from the cache: no replay, whatever the history', async () => {
      await entry('2026-01-01', 100, 10);
      for (let i = 0; i < 5; i++) await exit(`2026-01-0${i + 2}`, 1);
      // Tamper with the cache: levels() shows what the cache says.
      await prisma.farmStockItem.updateMany({
        data: { quantity: 7, averageCost: 3 },
      });
      expect(await level()).toEqual({ quantity: 7, averageCost: 3, value: 21 });
      await prisma.farmStockItem.updateMany({
        data: { quantity: 95, averageCost: 10 },
      });
    });

    it('replays a pair whose average is not cached (rows from before the cache), and the next write persists it', async () => {
      await entry('2026-01-01', 100, 10);
      await entry('2026-01-02', 100, 20);
      await prisma.farmStockItem.updateMany({
        data: { quantity: 0, averageCost: null },
      });
      expect(await level()).toEqual({
        quantity: 200,
        averageCost: 15,
        value: 3000,
      });
      await exit('2026-01-03', 10);
      const pair = await prisma.farmStockItem.findFirstOrThrow({
        where: { farmId, stockItemId: item },
      });
      expect(pair.quantity.toNumber()).toBe(190);
      expect(pair.averageCost?.toNumber()).toBe(15);
    });

    it('a pair with no movement reads as 0 at 0', async () => {
      await prisma.$transaction(async (tx) => {
        await ensureFarmStockItem(tx, farmId, item);
      });
      expect(await level()).toEqual({ quantity: 0, averageCost: 0, value: 0 });
    });
  });
});
