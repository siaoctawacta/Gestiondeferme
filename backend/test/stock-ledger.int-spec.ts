import { BadRequestException } from '@nestjs/common';
import { migrateTestDb, resetDb } from './setup';
import { AuditService } from '../src/audit/audit.service';
import type { RequestContext } from '../src/access/decorators';
import type { StockMovementType } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  levelKey,
  StockLedgerService,
  type RecordInput,
} from '../src/stock/stock-ledger.service';

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
      ).rejects.toThrow(new BadRequestException('Stock insuffisant'));
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
      ).rejects.toThrow(new BadRequestException('Stock insuffisant'));
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
      expect(after.map((m) => m.quantity.toNumber())).toEqual([-100, -30]);
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
      const { removed, results } = await prisma.$transaction((tx) =>
        ledger.replaceBySource(tx, 'FEED_DISTRIBUTION', 's1', [
          base(item2, 30),
          base(item, 5),
        ]),
      );
      expect(removed).toHaveLength(1);
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
      ).rejects.toThrow(new BadRequestException('Stock insuffisant'));
      expect(await stored()).toHaveLength(3);
    });

    it('is a no-op for an unknown source', async () => {
      expect(
        await prisma.$transaction((tx) =>
          ledger.reverseBySource(tx, 'FEED_DISTRIBUTION', 'nope'),
        ),
      ).toEqual([]);
    });

    it('drops the batch of a reversed entry that nothing else uses', async () => {
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
      expect(await prisma.stockBatch.count()).toBe(0);
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

    it('audits update, remove and reverseBySource once each', async () => {
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
        ledger.reverseBySource(tx, 'PURCHASE', 'p9', a),
      );
      expect(
        (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
          (r) => r.action,
        ),
      ).toEqual(['UPDATE', 'DELETE', 'DELETE']);
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

    it('averages the consumption of the last 30 days over reasons CONSOMMATION and TRAITEMENT only', async () => {
      const startDay = daysAgo(0);
      await record({
        type: 'ENTREE',
        date: day(daysAgo(60)),
        quantity: 100000,
        unitCost: 1,
      });
      await exit(daysAgo(0), 3000);
      await exit(daysAgo(29), 6000, { reason: 'TRAITEMENT' });
      await exit(daysAgo(30), 9000); // outside the 30-day window
      await exit(daysAgo(5), 9000, { reason: 'PERTE' });
      const per = await ledger.dailyConsumption([farmId], [item]);
      // The window is anchored on the server's day: skip the check if midnight passed while the data was written.
      if (daysAgo(0) !== startDay) return;
      expect(per.get(levelKey(farmId, item))?.toNumber()).toBe(300);
    });
  });
});
