import { INestApplication } from '@nestjs/common';
import { addDays, formatDay, today } from '../src/common/days';
import {
  EggOutflowRegistry,
  EggStockService,
  type EggOutflowSource,
} from '../src/eggs/egg-stock';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import { WithdrawalRegistry } from '../src/herd/withdrawal';
import { AnimalSales } from '../src/pigs/animal-sales';
import { PrismaService } from '../src/prisma/prisma.service';
import { operationCosts } from '../src/stock/operation-costs';
import { StockLedgerService } from '../src/stock/stock-ledger.service';
import { daysAgo, Headers, Id, Msg, World } from './fixtures';
import { createTestApp } from './setup';

const NNBSP = ' ';
const SOURCE = { type: 'SALE' as const, id: 'inv-1', label: 'FA-TEST-0001' };

interface Sellable {
  id: string;
  kind: string;
  label: string;
  designation: string;
  unit: string | null;
  available: number;
  eggsPerTray?: number;
  availableTrays?: number;
  withdrawalUntil: string | null;
  sellable: boolean;
  reason: string | null;
}

/** What a sales module would register: the eggs it sold, held here for the test. */
class TestOutflows implements EggOutflowSource {
  rows: { batchId: string; date: Date; eggs: number; sourceId: string }[] = [];
  outflows(
    _tx: unknown,
    batchIds: string[],
    opts?: { excludeSourceId?: string },
  ) {
    return Promise.resolve(
      this.rows.filter(
        (r) =>
          batchIds.includes(r.batchId) && r.sourceId !== opts?.excludeSourceId,
      ),
    );
  }
}

describe('Ledger seams of a sale (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let h: Headers;
  const sold = new TestOutflows();

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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const message = (res: { body: unknown }) => (res.body as Msg).message;
  const inTx = <T>(
    fn: (
      tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ) => Promise<T>,
  ) => prisma.$transaction(fn);

  /** A done treatment: under withdrawal until `daysAgo(ago)` + duration + withdrawal days. */
  const treat = (target: Record<string, string>, ago: number) =>
    world.post(h, '/health-acts', {
      type: 'TRAITEMENT',
      status: 'REALISE',
      date: daysAgo(ago),
      productName: 'Amox',
      durationDays: 5,
      withdrawalDays: 7,
      ...target,
    });

  describe('withdrawal guard (WithdrawalRegistry.assertClear)', () => {
    it('refuses a lot whose treatment ended today (done 12 days ago: 5 + 7), with the exact message', async () => {
      const lot = await world.lot(h);
      await treat({ batchId: lot.id }, 12);
      const until = formatDay(today());
      const err = await inTx((tx) =>
        app
          .get(WithdrawalRegistry)
          .assertClear({ batchId: lot.id, code: lot.code }, today(), tx),
      ).catch((e: { status: number; message: string }) => e);
      expect(err).toMatchObject({
        status: 400,
        message: `Le lot ${lot.code} est en délai d'attente jusqu'au ${until} : vente impossible`,
      });
    });

    it('lets the lot through the day after the last day (done 13 days ago), and judges on the sale date', async () => {
      const lot = await world.lot(h);
      await treat({ batchId: lot.id }, 13);
      const guard = (date: Date) =>
        inTx((tx) =>
          app
            .get(WithdrawalRegistry)
            .assertClear({ batchId: lot.id, code: lot.code }, date, tx),
        );
      await expect(guard(today())).resolves.toBeUndefined();
      // Judged on the date of the sale, not on today: an earlier date is still inside the period.
      await expect(guard(addDays(today(), -1))).rejects.toMatchObject({
        status: 400,
      });
      await expect(guard(addDays(today(), -2))).rejects.toMatchObject({
        status: 400,
      });
    });

    it('lets a lot with no treatment through, and ignores a planned act', async () => {
      const lot = await world.lot(h);
      await world.post(h, '/health-acts', {
        type: 'TRAITEMENT',
        status: 'PLANIFIE',
        date: daysAgo(0),
        productName: 'Amox',
        withdrawalDays: 30,
        batchId: lot.id,
      });
      await expect(
        inTx((tx) =>
          app
            .get(WithdrawalRegistry)
            .assertClear({ batchId: lot.id, code: lot.code }, today(), tx),
        ),
      ).resolves.toBeUndefined();
    });

    it('does the same for an animal, with the animal message', async () => {
      const sow = await world.animal(h, { tag: 'TR-021' });
      await treat({ animalId: sow.id }, 12);
      const until = formatDay(today());
      await expect(
        inTx((tx) =>
          app
            .get(WithdrawalRegistry)
            .assertClear({ animalId: sow.id, tag: 'TR-021' }, today(), tx),
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: `L'animal TR-021 est en délai d'attente jusqu'au ${until} : vente impossible`,
      });
      const other = await world.animal(h, { tag: 'TR-022' });
      await treat({ animalId: other.id }, 13);
      await expect(
        inTx((tx) =>
          app
            .get(WithdrawalRegistry)
            .assertClear({ animalId: other.id, tag: 'TR-022' }, today(), tx),
        ),
      ).resolves.toBeUndefined();
    });

    it('sees a treatment recorded in the same transaction', async () => {
      const lot = await world.lot(h);
      await expect(
        inTx(async (tx) => {
          await tx.healthAct.create({
            data: {
              farmId: world.farmId,
              type: 'TRAITEMENT',
              status: 'REALISE',
              date: today(),
              doneDate: today(),
              withdrawalDays: 3,
              batchId: lot.id,
              createdById: (await tx.user.findFirstOrThrow()).id,
            },
          });
          await app
            .get(WithdrawalRegistry)
            .assertClear({ batchId: lot.id, code: lot.code }, today(), tx);
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('egg balance (eggs)', () => {
    let layer: Id & { code: string };
    const produce = (
      date: string,
      collected: number,
      over: Record<string, unknown> = {},
      status = 201,
    ) =>
      world.post<Id>(
        h,
        '/egg-production',
        { batchId: layer.id, date, collected, ...over },
        status,
      );
    const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
    const sell = (eggs: number, date: string, sourceId = 'inv-1') =>
      sold.rows.push({ batchId: layer.id, date: day(date), eggs, sourceId });

    beforeEach(async () => {
      layer = await world.lot(h, { type: 'PONDEUSE', initialCount: 3000 });
    });

    it('a record edit that would go below what was sold is refused, exact message, nothing written', async () => {
      const d1 = await produce(daysAgo(3), 2500, {
        broken: 40,
        downgraded: 250,
      });
      await produce(daysAgo(2), 2500);
      sell(4710, daysAgo(2));
      const res = await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ collected: 2499 })
        .expect(400);
      expect(message(res)).toBe(
        'Ces œufs sont déjà vendus : la production commercialisable ne peut pas descendre sous les ventes',
      );
      const row = await prisma.eggProduction.findUniqueOrThrow({
        where: { id: d1.id },
      });
      expect(row.collected).toBe(2500);
      expect(await prisma.auditLog.count({ where: { recordId: d1.id } })).toBe(
        1,
      );
      // Raising it, or moving nothing under the sales, is fine.
      await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ collected: 2600 })
        .expect(200);
      await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ broken: 41 })
        .expect(200);
    });

    it('refuses to delete a record the sales stand on, and to move it after the sale', async () => {
      const d1 = await produce(daysAgo(3), 2500);
      sell(2000, daysAgo(3));
      await http().delete(`/api/egg-production/${d1.id}`).set(h).expect(400);
      expect(await prisma.eggProduction.count({ where: { id: d1.id } })).toBe(
        1,
      );
      const moved = await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ date: daysAgo(2) })
        .expect(400);
      expect(message(moved)).toContain('déjà vendus');
      // Eggs put in incubation are no longer marketable either.
      const toIncubation = await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ toIncubation: 501 })
        .expect(400);
      expect(message(toIncubation)).toContain('déjà vendus');
      await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ toIncubation: 500 })
        .expect(200);
    });

    it('lets an unsold lot be edited and deleted as before', async () => {
      const d1 = await produce(daysAgo(3), 2500);
      await http()
        .patch(`/api/egg-production/${d1.id}`)
        .set(h)
        .send({ collected: 10 })
        .expect(200);
      await http().delete(`/api/egg-production/${d1.id}`).set(h).expect(200);
    });

    it('assertSale: refuses over the balance, with the available count in the message', async () => {
      await produce(daysAgo(3), 2500, { broken: 40, downgraded: 250 });
      await produce(daysAgo(2), 2500);
      const eggs = app.get(EggStockService);
      const batch = { id: layer.id, code: layer.code };
      const check = (
        n: number,
        date: string,
        opts?: { excludeSourceId?: string },
      ) =>
        inTx((tx) =>
          eggs.assertSale(tx, batch, [{ date: day(date), eggs: n }], opts),
        );
      await expect(check(4710, daysAgo(2))).resolves.toBeUndefined();
      await expect(check(4711, daysAgo(2))).rejects.toMatchObject({
        status: 400,
        message: `Œufs disponibles insuffisants pour ${layer.code} (4710 disponibles)`,
      });
      // A sale dated before the first production has nothing.
      await expect(check(1, daysAgo(4))).rejects.toMatchObject({
        message: `Œufs disponibles insuffisants pour ${layer.code} (0 disponibles)`,
      });
      sell(3000, daysAgo(2), 'inv-1');
      await expect(check(1710, daysAgo(2))).resolves.toBeUndefined();
      await expect(check(1711, daysAgo(2))).rejects.toMatchObject({
        message: `Œufs disponibles insuffisants pour ${layer.code} (1710 disponibles)`,
      });
      // Re-checking the document that already sold them leaves it out.
      await expect(
        check(3000, daysAgo(2), { excludeSourceId: 'inv-1' }),
      ).resolves.toBeUndefined();
      // Several lines of one document are checked together.
      await expect(
        inTx((tx) =>
          eggs.assertSale(tx, batch, [
            { date: day(daysAgo(2)), eggs: 1000 },
            { date: day(daysAgo(2)), eggs: 711 },
          ]),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await inTx((tx) => eggs.available(tx, layer.id, day(daysAgo(2)))),
      ).toBe(1710);
      // A later sale cannot be starved by an earlier-dated one.
      sold.rows = [];
      sell(4000, daysAgo(2));
      await expect(check(710, daysAgo(3))).resolves.toBeUndefined();
      await expect(check(711, daysAgo(3))).rejects.toMatchObject({
        message: `Œufs disponibles insuffisants pour ${layer.code} (710 disponibles)`,
      });
    });

    it('a return (negative outflow) raises the balance', async () => {
      await produce(daysAgo(2), 1000);
      sell(1000, daysAgo(2), 'inv-1');
      sell(-200, daysAgo(1), 'cn-1');
      const eggs = app.get(EggStockService);
      expect(
        await inTx((tx) => eggs.available(tx, layer.id, day(daysAgo(1)))),
      ).toBe(200);
    });
  });

  describe('animal sales (AnimalSales)', () => {
    it('sells a live animal: VENDU, exit date and reason, source; returns tag, category and breed', async () => {
      const breed = await world.post<Id>(h, '/breeds', {
        name: 'Large White',
        species: 'PORCIN',
      });
      const sow = await world.animal(h, {
        tag: 'TR-027',
        breedId: breed.id,
        birthDate: daysAgo(400),
      });
      const result = await inTx((tx) =>
        app.get(AnimalSales).sell(tx, sow.id, day(daysAgo(1)), SOURCE),
      );
      expect(result).toEqual({
        tag: 'TR-027',
        category: 'TRUIE',
        breed: 'Large White',
      });
      const row = await prisma.animal.findUniqueOrThrow({
        where: { id: sow.id },
      });
      expect(row).toMatchObject({
        status: 'VENDU',
        exitReason: 'VENDU',
        exitSourceType: 'SALE',
        exitSourceId: 'inv-1',
        exitSourceLabel: 'FA-TEST-0001',
      });
      expect(formatDay(row.exitDate!)).toBe(daysAgo(1));
    });

    it('refuses a pregnant or nursing sow (409), an exited animal (409) and the usual dates (400)', async () => {
      const pregnant = await world.animal(h, { tag: 'TR-014' });
      await prisma.animal.update({
        where: { id: pregnant.id },
        data: { status: 'GESTANTE' },
      });
      const sales = app.get(AnimalSales);
      await expect(
        inTx((tx) => sales.sell(tx, pregnant.id, today(), SOURCE)),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Cette truie est gestante ou allaitante',
      });
      await prisma.animal.update({
        where: { id: pregnant.id },
        data: { status: 'ALLAITANTE' },
      });
      await expect(
        inTx((tx) => sales.sell(tx, pregnant.id, today(), SOURCE)),
      ).rejects.toMatchObject({ status: 409 });

      const sow = await world.animal(h, {
        tag: 'TR-030',
        birthDate: daysAgo(100),
      });
      await expect(
        inTx((tx) => sales.sell(tx, sow.id, day(daysAgo(200)), SOURCE)),
      ).rejects.toMatchObject({
        status: 400,
        message: "La date est antérieure à la naissance de l'animal",
      });
      await expect(
        inTx((tx) => sales.sell(tx, sow.id, addDays(today(), 1), SOURCE)),
      ).rejects.toMatchObject({
        status: 400,
        message: 'La date ne peut pas être dans le futur',
      });
      await world.post(h, `/animals/${sow.id}/weighings`, {
        date: daysAgo(5),
        weightKg: 150,
      });
      await expect(
        inTx((tx) => sales.sell(tx, sow.id, day(daysAgo(6)), SOURCE)),
      ).rejects.toMatchObject({
        status: 400,
        message: 'La date de sortie est antérieure à la dernière pesée',
      });
      await inTx((tx) => sales.sell(tx, sow.id, today(), SOURCE));
      await expect(
        inTx((tx) => sales.sell(tx, sow.id, today(), SOURCE)),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('a sold animal cannot be reinstated, nor deleted, by hand', async () => {
      const sow = await world.animal(h, { tag: 'TR-027' });
      await inTx((tx) =>
        app.get(AnimalSales).sell(tx, sow.id, today(), SOURCE),
      );
      const reinstate = await http()
        .post(`/api/animals/${sow.id}/reinstate`)
        .set(h)
        .expect(409);
      expect(message(reinstate)).toBe(
        'Cet animal a été vendu par la facture FA-TEST-0001 : annulez la facture ou établissez un avoir',
      );
      const del = await http()
        .delete(`/api/animals/${sow.id}`)
        .set(h)
        .expect(409);
      expect(message(del)).toContain('FA-TEST-0001');
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: sow.id } }))
          .status,
      ).toBe('VENDU');
    });

    it('a manual sale keeps working and carries no source', async () => {
      const sow = await world.animal(h, { tag: 'TR-040' });
      await http()
        .post(`/api/animals/${sow.id}/exit`)
        .set(h)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(200);
      await http().post(`/api/animals/${sow.id}/reinstate`).set(h).expect(200);
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: sow.id } }))
          .exitSourceType,
      ).toBeNull();
    });

    it('unsell puts every animal of the source back to ACTIF and clears the exit', async () => {
      const a = await world.animal(h, { tag: 'TR-027' });
      const b = await world.animal(h, { tag: 'TR-028' });
      const other = await world.animal(h, { tag: 'TR-029' });
      const sales = app.get(AnimalSales);
      await inTx(async (tx) => {
        await sales.sell(tx, a.id, today(), SOURCE);
        await sales.sell(tx, b.id, today(), SOURCE);
        await sales.sell(tx, other.id, today(), { ...SOURCE, id: 'inv-2' });
      });
      await inTx((tx) => sales.unsell(tx, SOURCE));
      for (const id of [a.id, b.id]) {
        expect(
          await prisma.animal.findUniqueOrThrow({ where: { id } }),
        ).toMatchObject({
          status: 'ACTIF',
          exitDate: null,
          exitReason: null,
          exitSourceType: null,
          exitSourceId: null,
          exitSourceLabel: null,
        });
      }
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: other.id } }))
          .status,
      ).toBe('VENDU');
      // Nothing left for that source: a no-op.
      await expect(
        inTx((tx) => sales.unsell(tx, SOURCE)),
      ).resolves.toBeUndefined();
    });

    it('unsell is refused (409, nothing reinstated) when the animal changed since', async () => {
      const a = await world.animal(h, { tag: 'TR-027' });
      const b = await world.animal(h, { tag: 'TR-028' });
      const sales = app.get(AnimalSales);
      await inTx(async (tx) => {
        await sales.sell(tx, a.id, day(daysAgo(3)), SOURCE);
        await sales.sell(tx, b.id, day(daysAgo(3)), SOURCE);
      });
      await prisma.heat.create({
        data: { farmId: world.farmId, animalId: b.id, date: day(daysAgo(1)) },
      });
      await expect(
        inTx((tx) => sales.unsell(tx, SOURCE)),
      ).rejects.toMatchObject({
        status: 409,
        message:
          'Des données ont été enregistrées après la sortie de cet animal',
      });
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: a.id } })).status,
      ).toBe('VENDU');
    });

    it('unsell says so (409) when an animal is no longer sold by that document', async () => {
      const a = await world.animal(h, { tag: 'TR-027' });
      const sales = app.get(AnimalSales);
      await inTx((tx) => sales.sell(tx, a.id, today(), SOURCE));
      await prisma.animal.update({
        where: { id: a.id },
        data: { status: 'REFORME' },
      });
      await expect(
        inTx((tx) => sales.unsell(tx, SOURCE)),
      ).rejects.toMatchObject({
        status: 409,
        message: "Cet animal n'est plus vendu par ce document",
      });
    });

    it('unsell checks the building again (it may have changed type)', async () => {
      const a = await world.animal(h, { tag: 'TR-027' });
      const sales = app.get(AnimalSales);
      await inTx((tx) => sales.sell(tx, a.id, today(), SOURCE));
      await prisma.building.update({
        where: { id: world.pigBld },
        data: { type: 'AVICOLE' },
      });
      await expect(
        inTx((tx) => sales.unsell(tx, SOURCE)),
      ).rejects.toMatchObject({
        status: 400,
      });
      await prisma.building.update({
        where: { id: world.pigBld },
        data: { type: 'PORCIN', capacity: 0 },
      });
      await expect(
        inTx((tx) => sales.unsell(tx, SOURCE)),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining(
          'Capacité du bâtiment dépassée',
        ) as string,
      });
    });

    it('the exit source is all or nothing, and only on a sale (DB check)', async () => {
      const a = await world.animal(h, { tag: 'TR-027' });
      const set = (data: Record<string, unknown>) =>
        prisma.animal.update({ where: { id: a.id }, data });
      await expect(set({ exitSourceType: 'SALE' })).rejects.toThrow();
      await expect(
        set({
          exitSourceType: 'SALE',
          exitSourceId: 'x',
          exitSourceLabel: 'FA-1',
        }),
      ).rejects.toThrow();
      await expect(
        set({
          status: 'MORT',
          exitReason: 'MORT',
          exitSourceType: 'SALE',
          exitSourceId: 'x',
          exitSourceLabel: 'FA-1',
        }),
      ).rejects.toThrow();
      await expect(
        set({
          status: 'VENDU',
          exitReason: 'VENDU',
          exitSourceType: 'SALE',
          exitSourceId: 'x',
          exitSourceLabel: 'FA-1',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('lot sales through the herd ledger', () => {
    it('a VENTE event with source SALE is a plain ledger event: refused over the headcount, reversible by source, closed lot refused', async () => {
      const lot = await world.lot(h, { initialCount: 40 });
      const user = await prisma.user.findFirstOrThrow();
      const ledger = app.get(HerdLedgerService);
      const sell = (quantity: number, id = 'inv-1') =>
        inTx((tx) =>
          ledger.record(tx, {
            farmId: world.farmId,
            batchId: lot.id,
            date: today(),
            type: 'VENTE',
            quantity,
            sourceType: 'SALE',
            sourceId: id,
            userId: user.id,
          }),
        );
      await sell(30);
      await expect(sell(11, 'inv-2')).rejects.toMatchObject({
        status: 400,
        message: 'Effectif insuffisant',
      });
      const events = await prisma.batchEvent.findMany({
        where: { batchId: lot.id },
      });
      expect(events).toHaveLength(1);
      // The manual routes leave a sale event alone.
      await http()
        .delete(`/api/batches/${lot.id}/events/${events[0].id}`)
        .set(h)
        .expect(409);
      await inTx((tx) =>
        ledger.removeBySource(tx, 'SALE', 'inv-1', [world.farmId]),
      );
      expect(
        await prisma.batchEvent.count({ where: { batchId: lot.id } }),
      ).toBe(0);
      await sell(40);
      await http().post(`/api/batches/${lot.id}/close`).set(h).expect(200);
      await expect(sell(1, 'inv-3')).rejects.toMatchObject({
        status: 409,
        message: 'Ce lot est clôturé',
      });
    });
  });

  describe('stock exits for a sale', () => {
    let itemId: string;
    const entry = (qty: number, over: Record<string, unknown> = {}) =>
      world.post(h, '/stock/movements', {
        itemId,
        type: 'ENTREE',
        date: daysAgo(40),
        quantity: qty,
        unitCost: 320,
        reason: 'ACHAT',
        ...over,
      });
    const exit = async (qty: number, reason: 'VENTE' | 'CONSOMMATION') => {
      const user = await prisma.user.findFirstOrThrow();
      return inTx((tx) =>
        app.get(StockLedgerService).record(tx, {
          farmId: world.farmId,
          stockItemId: itemId,
          date: today(),
          type: 'SORTIE',
          quantity: -qty,
          reason,
          sourceType: 'SALE',
          sourceId: 'inv-1',
          userId: user.id,
        }),
      );
    };

    beforeEach(async () => {
      itemId = (
        await world.post<Id>(h, '/stock-items', {
          name: 'Aliment ponte',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
    });

    it('refuses a sale from an expired-only lot: Lot périmé; the same rule as a consumption', async () => {
      await entry(10, { lotNumber: 'L1', expiryDate: daysAgo(5) });
      await expect(exit(5, 'VENTE')).rejects.toMatchObject({
        status: 400,
        message: 'Lot périmé',
      });
      await expect(exit(5, 'CONSOMMATION')).rejects.toMatchObject({
        status: 400,
        message: 'Lot périmé',
      });
    });

    it('refuses to start on an expired lot and finish on a valid one beyond what is valid', async () => {
      await entry(10, { lotNumber: 'L1', expiryDate: daysAgo(5) });
      await entry(5, {
        lotNumber: 'L2',
        expiryDate: '2099-01-01',
        date: daysAgo(30),
      });
      await expect(exit(8, 'VENTE')).rejects.toMatchObject({
        status: 400,
        message: 'Stock insuffisant (une partie du stock est périmée)',
      });
      const ok = await exit(5, 'VENTE');
      expect(ok.unitCost.toString()).toBe('320');
      const rows = await prisma.stockMovement.findMany({
        where: { sourceType: 'SALE', sourceId: 'inv-1' },
      });
      expect(rows.map((r) => r.reason)).toEqual(['VENTE']);
    });

    it('a sale is not a consumption: it stays out of the daily consumption', async () => {
      await entry(100, { lotNumber: 'L1' });
      await exit(10, 'VENTE');
      const ledger = app.get(StockLedgerService);
      expect(
        (await ledger.dailyConsumption([world.farmId], [itemId])).size,
      ).toBe(0);
    });

    it('VENTE and RETOUR cannot be entered by hand', async () => {
      await entry(100);
      await http()
        .post('/api/stock/movements')
        .set(h)
        .send({
          itemId,
          type: 'SORTIE',
          date: daysAgo(1),
          quantity: 5,
          reason: 'VENTE',
        })
        .expect(400);
      await http()
        .post('/api/stock/movements')
        .set(h)
        .send({
          itemId,
          type: 'ENTREE',
          date: daysAgo(1),
          quantity: 5,
          unitCost: 1,
          reason: 'RETOUR',
        })
        .expect(400);
    });

    it('what a source cost counts its exits only, even when the same source also wrote an entry', async () => {
      await entry(100, { lotNumber: 'L1' });
      const user = await prisma.user.findFirstOrThrow();
      await exit(10, 'VENTE');
      await inTx((tx) =>
        app.get(StockLedgerService).record(tx, {
          farmId: world.farmId,
          stockItemId: itemId,
          date: today(),
          type: 'ENTREE',
          quantity: 4,
          unitCost: 320,
          reason: 'RETOUR',
          sourceType: 'SALE',
          sourceId: 'inv-1',
          userId: user.id,
        }),
      );
      const costs = await operationCosts(prisma, {
        sourceType: 'SALE',
        sourceIds: ['inv-1'],
      });
      expect(costs.get('inv-1')?.toString()).toBe('3200');
    });

    it('records a return at the sale cost with source CREDIT_NOTE', async () => {
      await entry(100, { lotNumber: 'L1' });
      const user = await prisma.user.findFirstOrThrow();
      const result = await inTx(async (tx) => {
        const ledger = app.get(StockLedgerService);
        const batch = await ledger.createBatch(tx, {
          farmId: world.farmId,
          stockItemId: itemId,
          lotNumber: 'L1',
          receivedDate: today(),
        });
        return ledger.record(tx, {
          farmId: world.farmId,
          stockItemId: itemId,
          date: today(),
          type: 'ENTREE',
          quantity: 2,
          unitCost: 320,
          reason: 'RETOUR',
          stockBatchId: batch.id,
          sourceType: 'CREDIT_NOTE',
          sourceId: 'cn-1',
          userId: user.id,
        });
      });
      expect(result.movements[0]).toMatchObject({
        reason: 'RETOUR',
        sourceType: 'CREDIT_NOTE',
      });
    });
  });

  describe('GET /sales/sellables', () => {
    let lot: Id & { code: string };
    let layer: Id & { code: string };
    let treated: Id & { code: string };
    let pigLot: Id & { code: string };
    let tr027: Id;
    let tr014: Id;
    let tr021: Id;
    let itemId: string;

    const list = async (
      kind: string,
      date = daysAgo(0),
      who: Headers = h,
    ): Promise<Sellable[]> =>
      (
        (
          await http()
            .get('/api/sales/sellables')
            .query({ kind, date })
            .set(who)
            .expect(200)
        ).body as { items: Sellable[] }
      ).items;

    beforeEach(async () => {
      lot = await world.lot(h, { initialCount: 4820 });
      treated = await world.lot(h, { initialCount: 50 });
      await treat({ batchId: treated.id }, 12);
      pigLot = await world.pigLot(h, { initialCount: 12 });
      // A closed lot and an emptied one are not offered.
      const closed = await world.lot(h, { initialCount: 5 });
      await world.post(h, `/batches/${closed.id}/events`, {
        type: 'VENTE',
        date: daysAgo(1),
        quantity: 5,
      });
      await http().post(`/api/batches/${closed.id}/close`).set(h).expect(200);
      layer = await world.lot(h, { type: 'PONDEUSE', initialCount: 3000 });
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
      const breed = await world.post<Id>(h, '/breeds', {
        name: 'Large White',
        species: 'PORCIN',
      });
      tr027 = await world.animal(h, { tag: 'TR-027', breedId: breed.id });
      tr014 = await world.animal(h, { tag: 'TR-014' });
      await prisma.animal.update({
        where: { id: tr014.id },
        data: { status: 'GESTANTE' },
      });
      tr021 = await world.animal(h, { tag: 'TR-021' });
      await treat({ animalId: tr021.id }, 12);
      const sold = await world.animal(h, { tag: 'TR-099' });
      await http()
        .post(`/api/animals/${sold.id}/exit`)
        .set(h)
        .send({ date: daysAgo(1), reason: 'VENDU' })
        .expect(200);
      itemId = (
        await world.post<Id>(h, '/stock-items', {
          name: 'Aliment ponte',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
      await world.post(h, '/stock/movements', {
        itemId,
        type: 'ENTREE',
        date: daysAgo(40),
        quantity: 1000,
        unitCost: 320,
        reason: 'ACHAT',
      });
      await world.post(h, '/stock/movements', {
        itemId,
        type: 'SORTIE',
        date: daysAgo(1),
        quantity: 100,
        reason: 'CONSOMMATION',
      });
    });

    it('lists the open lots with live animals, labelled with their headcount', async () => {
      const items = await list('LOT');
      expect(items.map((i) => i.id).sort()).toEqual(
        [lot.id, treated.id, pigLot.id, layer.id].sort(),
      );
      expect(items.find((i) => i.id === lot.id)).toEqual({
        id: lot.id,
        kind: 'LOT',
        label: `${lot.code} — Poulets de chair (4${NNBSP}820 vivants)`,
        designation: 'Poulets de chair',
        unit: null,
        available: 4820,
        withdrawalUntil: null,
        sellable: true,
        reason: null,
      });
      expect(items.find((i) => i.id === pigLot.id)).toMatchObject({
        label: `${pigLot.code} — Porcs (12 vivants)`,
        available: 12,
      });
    });

    it('lists a lot under withdrawal as not sellable, with the date, and judges on the date asked', async () => {
      const until = formatDay(today());
      const items = await list('LOT');
      expect(items.find((i) => i.id === treated.id)).toMatchObject({
        sellable: false,
        withdrawalUntil: until,
        reason: `Délai d'attente jusqu'au ${until}`,
        available: 50,
      });
      expect(
        (await list('LOT', daysAgo(1))).find((i) => i.id === treated.id),
      ).toMatchObject({ sellable: false });
      // Done 13 days ago, the period ended yesterday: sellable today.
      const clear = await world.lot(h, { initialCount: 8 });
      await treat({ batchId: clear.id }, 13);
      expect((await list('LOT')).find((i) => i.id === clear.id)).toMatchObject({
        sellable: true,
        reason: null,
        withdrawalUntil: formatDay(addDays(today(), -1)),
      });
    });

    it('lists lots alive on the date: none before the entry', async () => {
      const items = await list('LOT', daysAgo(60));
      expect(items).toEqual([]);
    });

    it('lists live animals; a pregnant or nursing sow and a treated animal are not sellable', async () => {
      const items = await list('ANIMAL');
      expect(items.map((i) => i.id).sort()).toEqual(
        [tr027.id, tr014.id, tr021.id].sort(),
      );
      expect(items.find((i) => i.id === tr027.id)).toEqual({
        id: tr027.id,
        kind: 'ANIMAL',
        label: 'TR-027 — Truie Large White',
        designation: 'Truie TR-027',
        unit: null,
        available: 1,
        withdrawalUntil: null,
        sellable: true,
        reason: null,
      });
      expect(items.find((i) => i.id === tr014.id)).toMatchObject({
        sellable: false,
        reason: 'Gestante',
      });
      const until = formatDay(today());
      expect(items.find((i) => i.id === tr021.id)).toMatchObject({
        sellable: false,
        withdrawalUntil: until,
        reason: `Délai d'attente jusqu'au ${until}`,
      });
      await prisma.animal.update({
        where: { id: tr014.id },
        data: { status: 'ALLAITANTE' },
      });
      expect(
        (await list('ANIMAL')).find((i) => i.id === tr014.id),
      ).toMatchObject({ sellable: false, reason: 'Allaitante' });
    });

    it('lists the laying lots with their egg balance, in eggs and in plateaux of the current setting', async () => {
      const items = await list('OEUFS');
      expect(items).toEqual([
        {
          id: layer.id,
          kind: 'OEUFS',
          label: `${layer.code} — 4${NNBSP}710 œufs disponibles`,
          designation: 'Œufs (plateau)',
          unit: 'PLATEAU',
          available: 4710,
          eggsPerTray: 30,
          availableTrays: 157,
          withdrawalUntil: null,
          sellable: true,
          reason: null,
        },
      ]);
      await http()
        .put('/api/settings/eggsPerTray')
        .set(await world.actor('SUPER_ADMIN'))
        .send({ value: 12 })
        .expect(200);
      expect((await list('OEUFS'))[0]).toMatchObject({
        eggsPerTray: 12,
        availableTrays: 392,
        available: 4710,
      });
    });

    it('takes what the sales registered out of the egg balance, and a lot under withdrawal is not sellable', async () => {
      sold.rows.push({
        batchId: layer.id,
        date: new Date(`${daysAgo(2)}T00:00:00.000Z`),
        eggs: 4710,
        sourceId: 'inv-1',
      });
      expect(await list('OEUFS')).toEqual([]);
      sold.rows = [];
      await treat({ batchId: layer.id }, 12);
      expect((await list('OEUFS'))[0]).toMatchObject({
        sellable: false,
        reason: `Délai d'attente jusqu'au ${formatDay(today())}`,
      });
    });

    it('lists the active articles holding stock, with the level as availability', async () => {
      const empty = await world.post<Id>(h, '/stock-items', {
        name: 'Sel',
        category: 'ALIMENT',
        unit: 'kg',
      });
      const inactive = await world.post<Id>(h, '/stock-items', {
        name: 'Ancien',
        category: 'ALIMENT',
        unit: 'kg',
      });
      await world.post(h, '/stock/movements', {
        itemId: inactive.id,
        type: 'ENTREE',
        date: daysAgo(10),
        quantity: 5,
        unitCost: 1,
        reason: 'ACHAT',
      });
      await http()
        .patch(`/api/stock-items/${inactive.id}`)
        .set(h)
        .send({ active: false })
        .expect(200);
      const items = await list('ARTICLE');
      expect(items.map((i) => i.id)).toEqual([itemId]);
      expect(items[0]).toEqual({
        id: itemId,
        kind: 'ARTICLE',
        label: `Aliment ponte — 900 kg`,
        designation: 'Aliment ponte',
        unit: 'kg',
        available: 900,
        withdrawalUntil: null,
        sellable: true,
        reason: null,
      });
      expect(items.some((i) => i.id === empty.id)).toBe(false);
    });

    it('offers only the stock that is not expired on the date, and says Aucun stock when it all is', async () => {
      const dated = await world.post<Id>(h, '/stock-items', {
        name: 'Vaccin',
        category: 'VACCIN',
        unit: 'flacon',
      });
      await world.post(h, '/stock/movements', {
        itemId: dated.id,
        type: 'ENTREE',
        date: daysAgo(40),
        quantity: 10,
        unitCost: 100,
        reason: 'ACHAT',
        lotNumber: 'V1',
        expiryDate: daysAgo(5),
      });
      await world.post(h, '/stock/movements', {
        itemId: dated.id,
        type: 'ENTREE',
        date: daysAgo(30),
        quantity: 4,
        unitCost: 100,
        reason: 'ACHAT',
        lotNumber: 'V2',
        expiryDate: '2099-01-01',
      });
      let found = (await list('ARTICLE')).find((i) => i.id === dated.id);
      expect(found).toMatchObject({ available: 4, sellable: true });
      // On a date before the first lot expired, all 14 are offered.
      found = (await list('ARTICLE', daysAgo(10))).find(
        (i) => i.id === dated.id,
      );
      expect(found).toMatchObject({ available: 14, sellable: true });
      await world.post(h, '/stock/movements', {
        itemId: dated.id,
        type: 'SORTIE',
        date: daysAgo(1),
        quantity: 4,
        reason: 'CONSOMMATION',
      });
      found = (await list('ARTICLE')).find((i) => i.id === dated.id);
      expect(found).toMatchObject({
        available: 0,
        sellable: false,
        reason: 'Aucun stock',
      });
    });

    it('is scoped to the active farm', async () => {
      const farmB = await prisma.farm.create({
        data: { organizationId: world.orgId, name: 'Ferme B' },
      });
      const bld = await prisma.building.create({
        data: {
          farmId: farmB.id,
          siteId: (
            await prisma.site.create({
              data: { farmId: farmB.id, name: 'Site B' },
            })
          ).id,
          name: 'Poulailler B',
          type: 'AVICOLE',
          capacity: 1000,
        },
      });
      await prisma.animalBatch.create({
        data: {
          farmId: farmB.id,
          code: 'LC-2026-99',
          species: 'AVICOLE',
          type: 'CHAIR',
          buildingId: bld.id,
          entryDate: new Date(`${daysAgo(30)}T00:00:00.000Z`),
          initialCount: 10,
        },
      });
      const items = await list('LOT');
      expect(items.some((i) => i.label.startsWith('LC-2026-99'))).toBe(false);
    });

    /** Every Prisma delegate call made by the application while `fn` runs. */
    async function queriesOf(fn: () => Promise<unknown>): Promise<number> {
      const client: Record<string, unknown> = app.get<PrismaService>(
        PrismaService,
      ) as never;
      const spies: jest.SpyInstance[] = [];
      for (const key of Object.keys(client)) {
        if (key.startsWith('$') || key.startsWith('_')) continue;
        const delegate = client[key];
        if (!delegate || typeof delegate !== 'object') continue;
        for (const method of [
          'findMany',
          'findFirst',
          'findUnique',
          'groupBy',
          'count',
          'aggregate',
        ]) {
          if (
            typeof (delegate as Record<string, unknown>)[method] === 'function'
          ) {
            spies.push(
              jest.spyOn(delegate as Record<string, () => unknown>, method),
            );
          }
        }
      }
      try {
        await fn();
        return spies.reduce((n, spy) => n + spy.mock.calls.length, 0);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    }

    it('is batched: the queries of a kind do not grow with the number of lots, animals, laying lots or articles', async () => {
      const before: Record<string, number> = {};
      for (const kind of ['LOT', 'ANIMAL', 'OEUFS', 'ARTICLE']) {
        before[kind] = await queriesOf(() => list(kind));
        expect(before[kind]).toBeGreaterThan(0);
      }
      for (let n = 0; n < 4; n++) {
        await world.lot(h, { initialCount: 10 });
        const extra = await world.lot(h, {
          type: 'PONDEUSE',
          initialCount: 10,
        });
        await world.post(h, '/egg-production', {
          batchId: extra.id,
          date: daysAgo(2),
          collected: 100,
        });
        await world.animal(h, { tag: `TR-1${n}0` });
        const item = await world.post<Id>(h, '/stock-items', {
          name: `Article ${n}`,
          category: 'ALIMENT',
          unit: 'kg',
        });
        await world.post(h, '/stock/movements', {
          itemId: item.id,
          type: 'ENTREE',
          date: daysAgo(10),
          quantity: 10,
          unitCost: 1,
          reason: 'ACHAT',
        });
      }
      for (const kind of ['LOT', 'ANIMAL', 'OEUFS', 'ARTICLE']) {
        expect((await list(kind)).length).toBeGreaterThan(4);
        expect(await queriesOf(() => list(kind))).toBe(before[kind]);
      }
    });

    it('answers a role that reads ventes but not lots, pigs or stock (the Comptable), with codes, labels and counts only', async () => {
      const accountant = await world.actor('COMPTABLE');
      for (const kind of ['LOT', 'ANIMAL', 'OEUFS', 'ARTICLE']) {
        const items = await list(kind, daysAgo(0), accountant);
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) {
          expect(Object.keys(item).sort()).toEqual(
            [
              'id',
              'kind',
              'label',
              'designation',
              'unit',
              'available',
              'withdrawalUntil',
              'sellable',
              'reason',
              ...(kind === 'OEUFS' ? ['eggsPerTray', 'availableTrays'] : []),
            ].sort(),
          );
        }
      }
      // ...while that role cannot read the modules themselves.
      await http()
        .get('/api/batches')
        .query({ species: 'AVICOLE' })
        .set(accountant)
        .expect(403);
      await http().get('/api/animals').set(accountant).expect(403);
      await http().get('/api/stock').set(accountant).expect(403);
    });

    it('answers the Commercial', async () => {
      const seller = await world.actor('COMMERCIAL');
      expect((await list('LOT', daysAgo(0), seller)).length).toBeGreaterThan(0);
    });

    it('answers 403 to a role without ventes, and the roles that read ventes', async () => {
      const store = await world.actor('MAGASINIER');
      await http()
        .get('/api/sales/sellables')
        .query({ kind: 'LOT', date: daysAgo(0) })
        .set(store)
        .expect(403);
      for (const role of ['COMPTABLE', 'AUDITEUR'] as const) {
        const who = await world.actor(role);
        await http()
          .get('/api/sales/sellables')
          .query({ kind: 'LOT', date: daysAgo(0) })
          .set(who)
          .expect(200);
      }
    });

    it('needs one farm, a known kind and a valid date that is not in the future', async () => {
      const all = { ...(await world.actor('AUDITEUR')), 'X-Farm-Id': 'all' };
      const res = await http()
        .get('/api/sales/sellables')
        .query({ kind: 'LOT', date: daysAgo(0) })
        .set(all)
        .expect(400);
      expect(message(res)).toBe('Sélectionnez une ferme');
      const get = (query: Record<string, string>) =>
        http().get('/api/sales/sellables').query(query).set(h);
      await get({ kind: 'SERVICE', date: daysAgo(0) }).expect(400);
      await get({ kind: 'AUTRE', date: daysAgo(0) }).expect(400);
      await get({ date: daysAgo(0) }).expect(400);
      await get({ kind: 'LOT' }).expect(400);
      await get({ kind: 'LOT', date: '2026-13-45' }).expect(400);
      const future = await get({
        kind: 'LOT',
        date: formatDay(addDays(today(), 1)),
      }).expect(400);
      expect(message(future)).toBe('La date ne peut pas être dans le futur');
    });
  });

  describe('availability on the date asked (later history counts)', () => {
    let itemId: string;
    const move = (over: Record<string, unknown>) =>
      world.post(h, '/stock/movements', {
        itemId,
        type: 'ENTREE',
        date: daysAgo(40),
        quantity: 1000,
        unitCost: 320,
        reason: 'ACHAT',
        ...over,
      });
    const list = async (kind: string, date: string) =>
      (
        (
          await http()
            .get('/api/sales/sellables')
            .query({ kind, date })
            .set(h)
            .expect(200)
        ).body as { items: Sellable[] }
      ).items;

    beforeEach(async () => {
      itemId = (
        await world.post<Id>(h, '/stock-items', {
          name: 'Aliment ponte',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
    });

    it('a lot of 40 with 30 sold since has 10 available on an earlier date', async () => {
      const lot = await world.lot(h, { initialCount: 40 });
      await world.post(h, `/batches/${lot.id}/events`, {
        type: 'VENTE',
        date: daysAgo(1),
        quantity: 30,
      });
      const earlier = (await list('LOT', daysAgo(5))).find(
        (i) => i.id === lot.id,
      );
      expect(earlier).toMatchObject({ available: 10 });
      expect(earlier?.label).toContain('(10 vivants)');
      expect(
        (await list('LOT', daysAgo(0))).find((i) => i.id === lot.id),
      ).toMatchObject({ available: 10 });
      // A later entry does not lend what a dip in between needs.
      await world.post(h, `/batches/${lot.id}/events`, {
        type: 'ENTREE',
        date: daysAgo(0),
        quantity: 100,
      });
      expect(
        (await list('LOT', daysAgo(5))).find((i) => i.id === lot.id),
      ).toMatchObject({ available: 10 });
      expect(
        (await list('LOT', daysAgo(0))).find((i) => i.id === lot.id),
      ).toMatchObject({ available: 110 });
    });

    it('stock that arrives after the date is not counted, and an article with only later stock says Aucun stock', async () => {
      await move({ date: daysAgo(40), quantity: 1000 });
      await move({ date: daysAgo(1), quantity: 500 });
      const early = (await list('ARTICLE', daysAgo(5))).find(
        (i) => i.id === itemId,
      );
      expect(early).toMatchObject({ available: 1000, sellable: true });
      expect(
        (await list('ARTICLE', daysAgo(0))).find((i) => i.id === itemId),
      ).toMatchObject({ available: 1500 });
      const later = (
        await world.post<Id>(h, '/stock-items', {
          name: 'Sel',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
      await world.post(h, '/stock/movements', {
        itemId: later,
        type: 'ENTREE',
        date: daysAgo(1),
        quantity: 20,
        unitCost: 1,
        reason: 'ACHAT',
      });
      expect(
        (await list('ARTICLE', daysAgo(5))).find((i) => i.id === later),
      ).toMatchObject({
        available: 0,
        sellable: false,
        reason: 'Aucun stock',
      });
    });

    it('a later exit lowers what an earlier date can sell, and a later entry does not lend what the dip needs', async () => {
      await move({ date: daysAgo(40), quantity: 1000 });
      await world.post(h, '/stock/movements', {
        itemId,
        type: 'SORTIE',
        date: daysAgo(2),
        quantity: 300,
        reason: 'CONSOMMATION',
      });
      await move({ date: daysAgo(1), quantity: 800 });
      const at = async (date: string) =>
        (await list('ARTICLE', date)).find((i) => i.id === itemId)?.available;
      expect(await at(daysAgo(5))).toBe(700);
      expect(await at(daysAgo(2))).toBe(700);
      expect(await at(daysAgo(0))).toBe(1500);
    });

    it('does not offer what was already expired on the date, counted at that date', async () => {
      await move({
        date: daysAgo(40),
        quantity: 10,
        lotNumber: 'L1',
        expiryDate: daysAgo(5),
      });
      await move({
        date: daysAgo(30),
        quantity: 4,
        lotNumber: 'L2',
        expiryDate: '2099-01-01',
      });
      const at = async (date: string) =>
        (await list('ARTICLE', date)).find((i) => i.id === itemId)?.available;
      expect(await at(daysAgo(0))).toBe(4);
      expect(await at(daysAgo(10))).toBe(14);
    });
  });

  describe('closed lots and returns (eggs)', () => {
    it('assertSale and assertReturn refuse a closed lot, 409 Ce lot est clôturé', async () => {
      const layer = await world.lot(h, { type: 'PONDEUSE', initialCount: 10 });
      await world.post(h, '/egg-production', {
        batchId: layer.id,
        date: daysAgo(3),
        collected: 100,
      });
      await world.post(h, `/batches/${layer.id}/events`, {
        type: 'VENTE',
        date: daysAgo(1),
        quantity: 10,
      });
      await http().post(`/api/batches/${layer.id}/close`).set(h).expect(200);
      const eggs = app.get(EggStockService);
      await expect(
        inTx((tx) =>
          eggs.assertSale(tx, { id: layer.id, code: layer.code }, [
            { date: day(daysAgo(1)), eggs: 10 },
          ]),
        ),
      ).rejects.toMatchObject({ status: 409, message: 'Ce lot est clôturé' });
      await expect(
        inTx((tx) => eggs.assertReturn(tx, layer.id)),
      ).rejects.toMatchObject({ status: 409, message: 'Ce lot est clôturé' });
    });
  });

  describe('isolation between farms', () => {
    let farmB: string;
    let otherAnimal: string;
    let otherLayer: string;
    let otherItem: string;

    beforeEach(async () => {
      const farm = await prisma.farm.create({
        data: { organizationId: world.orgId, name: 'Ferme B' },
      });
      farmB = farm.id;
      const site = await prisma.site.create({
        data: { farmId: farmB, name: 'Site B' },
      });
      const building = (name: string, type: 'AVICOLE' | 'PORCIN') =>
        prisma.building.create({
          data: { farmId: farmB, siteId: site.id, name, type, capacity: 1000 },
        });
      const pigs = await building('Porcherie B', 'PORCIN');
      const poultry = await building('Poulailler B', 'AVICOLE');
      otherAnimal = (
        await prisma.animal.create({
          data: {
            farmId: farmB,
            tag: 'TR-B01',
            category: 'TRUIE',
            sex: 'F',
            buildingId: pigs.id,
          },
        })
      ).id;
      otherLayer = (
        await prisma.animalBatch.create({
          data: {
            farmId: farmB,
            code: 'LP-B-01',
            species: 'AVICOLE',
            type: 'PONDEUSE',
            buildingId: poultry.id,
            entryDate: day(daysAgo(30)),
            initialCount: 50,
          },
        })
      ).id;
      await prisma.eggProduction.create({
        data: {
          farmId: farmB,
          batchId: otherLayer,
          date: day(daysAgo(2)),
          collected: 500,
        },
      });
      otherItem = (
        await world.post<Id>(h, '/stock-items', {
          name: 'Article B',
          category: 'ALIMENT',
          unit: 'kg',
        })
      ).id;
      const user = await prisma.user.findFirstOrThrow();
      await inTx((tx) =>
        app.get(StockLedgerService).record(tx, {
          farmId: farmB,
          stockItemId: otherItem,
          date: day(daysAgo(10)),
          type: 'ENTREE',
          quantity: 50,
          unitCost: 10,
          reason: 'ACHAT',
          userId: user.id,
        }),
      );
    });

    it("sell refuses another farm's animal when given the caller's farms: 400 Animal invalide, nothing written", async () => {
      await expect(
        inTx((tx) =>
          app.get(AnimalSales).sell(tx, otherAnimal, today(), SOURCE, {
            farmIds: [world.farmId],
          }),
        ),
      ).rejects.toMatchObject({ status: 400, message: 'Animal invalide' });
      expect(
        (await prisma.animal.findUniqueOrThrow({ where: { id: otherAnimal } }))
          .status,
      ).toBe('ACTIF');
    });

    it("sellables of the active farm never list another farm's animals, laying lots or articles", async () => {
      const get = async (kind: string) =>
        (
          (
            await http()
              .get('/api/sales/sellables')
              .query({ kind, date: daysAgo(0) })
              .set(h)
              .expect(200)
          ).body as { items: Sellable[] }
        ).items;
      await world.animal(h, { tag: 'TR-A01' });
      const layerA = await world.lot(h, { type: 'PONDEUSE', initialCount: 10 });
      await world.post(h, '/egg-production', {
        batchId: layerA.id,
        date: daysAgo(2),
        collected: 100,
      });
      const itemA = await world.post<Id>(h, '/stock-items', {
        name: 'Article A',
        category: 'ALIMENT',
        unit: 'kg',
      });
      await world.post(h, '/stock/movements', {
        itemId: itemA.id,
        type: 'ENTREE',
        date: daysAgo(10),
        quantity: 5,
        unitCost: 1,
        reason: 'ACHAT',
      });
      expect((await get('ANIMAL')).map((i) => i.label)).toEqual([
        expect.stringContaining('TR-A01') as string,
      ]);
      expect((await get('OEUFS')).map((i) => i.id)).toEqual([layerA.id]);
      const articles = await get('ARTICLE');
      expect(articles.map((i) => i.id)).toEqual([itemA.id]);
      expect(articles.some((i) => i.id === otherItem)).toBe(false);
    });
  });

  describe('an issued invoice goes through the guard (real route)', () => {
    it('POST /sales/issued on a lot under withdrawal is refused with the exact message and writes nothing', async () => {
      const admin = await world.actor('SUPER_ADMIN');
      const lot = await world.lot(h, { initialCount: 50 });
      await treat({ batchId: lot.id }, 12);
      const customer = await world.post<Id>(admin, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'RESTAURANT',
      });
      const res = await http()
        .post('/api/sales/issued')
        .set(admin)
        .send({
          customerId: customer.id,
          date: daysAgo(0),
          lines: [
            { kind: 'LOT', batchId: lot.id, quantity: 5, unitPrice: 3500 },
          ],
        })
        .expect(400);
      expect(message(res)).toBe(
        `Le lot ${lot.code} est en délai d'attente jusqu'au ${formatDay(today())} : vente impossible`,
      );
      expect(
        await prisma.batchEvent.count({ where: { batchId: lot.id } }),
      ).toBe(0);
    });
  });
});

function day(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
