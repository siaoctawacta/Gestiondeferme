import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { daysAgo, Headers, Id, World } from './fixtures';
import { createTestApp } from './setup';

interface LotRow {
  id: string;
  sold: number;
  alive: number;
  animals: number;
  revenue: number;
  totalCost: number;
  costs: { animaux: number; aliment: number; sante: number; autres: number };
  costPerKg: number | null;
  lines: { category: string; amount: number }[];
}
interface Summary {
  revenue: number;
  expenses: number;
  margin: number;
}
interface Invoice extends Id {
  lines: Id[];
}

/** The rules the final review settled on finance: periods, kilos, manual costs in the lot view, credit notes. */
describe('Finance, final fixes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let accountant: Headers;
  let director: Headers;
  let customerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
  });
  beforeEach(async () => {
    await world.reset();
    accountant = await world.actor('COMPTABLE');
    director = await world.actor('DIRECTEUR_FERME');
    const seller = await world.actor('COMMERCIAL');
    customerId = (
      await world.post(seller, '/customers', {
        name: 'Restaurant Le Palmier',
        type: 'REVENDEUR',
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const lotRow = async (id: string) =>
    (await http().get(`/api/finance/lots/${id}`).set(accountant).expect(200))
      .body as LotRow;
  const summary = async (q: Record<string, string> = {}) =>
    (
      await http()
        .get('/api/finance/summary')
        .query(q)
        .set(accountant)
        .expect(200)
    ).body as Summary;
  const lot = (over: Record<string, unknown> = {}) =>
    world.lot(director, { entryDate: daysAgo(60), initialCount: 400, ...over });
  const invoice = (lines: Record<string, unknown>[]) =>
    world.post<Invoice>(accountant, '/sales/issued', {
      customerId,
      date: daysAgo(10),
      lines,
    });
  const credit = (inv: Invoice, quantity: number, withReturn: boolean) =>
    world.post(accountant, `/sales/${inv.id}/credit-notes`, {
      date: daysAgo(5),
      reason: 'Retour',
      withReturn,
      lines: [{ lineId: inv.lines[0].id, quantity }],
    });

  it('a summary without dates covers ALL time, like the entries list (the dashboard asks for the month itself)', async () => {
    await world.post(accountant, '/finance/entries', {
      date: '2026-01-15',
      kind: 'DEPENSE',
      label: 'Salaires janvier',
      activity: 'GENERAL',
      category: 'SALAIRES',
      amount: 100000,
    });
    expect((await summary()).expenses).toBe(100000);
    expect((await summary({ from: daysAgo(5) })).expenses).toBe(0);
    const entries = (
      await http().get('/api/finance/entries').set(accountant).expect(200)
    ).body as { total: number };
    expect(entries.total).toBe(1);
  });

  it('costPerKg is empty as soon as one sold LOT line of the period has no weight', async () => {
    const l = await lot({ purchasePrice: 400000 });
    await invoice([
      {
        kind: 'LOT',
        batchId: l.id,
        quantity: 100,
        unitPrice: 3000,
        weightKg: 200,
      },
    ]);
    expect((await lotRow(l.id)).costPerKg).toBe(2000);
    await invoice([
      { kind: 'LOT', batchId: l.id, quantity: 100, unitPrice: 3000 },
    ]);
    expect((await lotRow(l.id)).costPerKg).toBeNull();
  });

  it('a manual ALIMENT expense on a lot counts under autres, never as its feed: aliment and the lot performance feedCost are unchanged', async () => {
    const l = await lot({ purchasePrice: 400000 });
    const feedCost = async () =>
      (
        (await http().get(`/api/batches/${l.id}`).set(director).expect(200))
          .body as { performance: { feedCost: number } }
      ).performance.feedCost;
    const before = await lotRow(l.id);
    const feedBefore = await feedCost();
    await world.post(accountant, '/finance/entries', {
      date: daysAgo(3),
      kind: 'DEPENSE',
      label: 'Aliment hors stock',
      activity: 'AVICOLE',
      category: 'ALIMENT',
      amount: 50000,
      batchId: l.id,
    });
    const after = await lotRow(l.id);
    expect(after.costs.aliment).toBe(before.costs.aliment);
    expect(after.costs.autres).toBe(before.costs.autres + 50000);
    expect(after.costs.animaux).toBe(before.costs.animaux);
    expect(after.totalCost).toBe(before.totalCost + 50000);
    expect(await feedCost()).toBe(feedBefore);
  });

  it('a credit note WITHOUT return lowers the revenue only; one WITH return also takes the animals back', async () => {
    const l = await lot();
    const inv = await invoice([
      { kind: 'LOT', batchId: l.id, quantity: 300, unitPrice: 3500 },
    ]);
    expect(await lotRow(l.id)).toMatchObject({ sold: 300, revenue: 1050000 });
    await credit(inv, 50, false);
    expect(await lotRow(l.id)).toMatchObject({
      sold: 300,
      alive: 100,
      revenue: 1050000 - 175000,
    });
    await credit(inv, 20, true);
    expect(await lotRow(l.id)).toMatchObject({
      sold: 280,
      alive: 120,
      revenue: 1050000 - 175000 - 70000,
    });
  });
});
