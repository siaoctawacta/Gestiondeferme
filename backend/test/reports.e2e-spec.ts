import { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { Role } from '../src/generated/prisma/enums';
import type { DashboardDto } from '../src/dashboard/dashboard.types';
import type { ReportDto, ReportSection } from '../src/reports/report.types';
import { PrismaService } from '../src/prisma/prisma.service';
import { HerdLedgerService } from '../src/herd/herd-ledger.service';
import type { RequestContext } from '../src/access/decorators';
import { HealthReport } from '../src/health/health-report';
import { Headers, Id, Msg, World } from './fixtures';
import { countQueries } from './query-counter';
import { createFarm, createTestApp, createUser, tokenFor } from './setup';

const NOT_ALLOWED = "Ce rapport n'est pas accessible à votre rôle";
const D = (day: string) => new Date(day);

interface LotRow {
  id: string;
  code: string;
  revenue: number;
  totalCost: number;
  margin: number;
  costPerAnimal: number | null;
}
interface BatchDetail {
  performance: {
    ageDays: number;
    alive: number;
    deaths: number;
    mortalityRate: number | null;
    lastWeightG: number | null;
    dailyGainG: number | null;
    feedConversion: number | null;
  };
}
interface Summary {
  revenue: number;
  expenses: number;
  margin: number;
  marginPct: number | null;
  receivables: number;
  byActivity: {
    activity: string;
    revenue: number;
    expenses: number;
    margin: number;
  }[];
  byCategory: { kind: string; label: string; amount: number }[];
}

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let world: World;
  let admin: Headers;
  let director: Headers;
  let accountant: Headers;
  let lot1: string;
  let lot2: string;
  let lot3: string;
  let chair: string;
  let userId: string;
  let productId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    world = new World(app, prisma);
    await world.reset();
    admin = await world.actor('SUPER_ADMIN');
    director = await world.actor('DIRECTEUR_FERME');
    accountant = await world.actor('COMPTABLE');
    userId = (
      await prisma.user.findFirstOrThrow({ where: { role: 'DIRECTEUR_FERME' } })
    ).id;
    await buildFixture();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => world.http();
  const msg = (r: { body: unknown }) => (r.body as Msg).message;

  const report = async (
    type: string,
    q: Record<string, string> = {},
    h: Headers = admin,
  ): Promise<ReportDto> =>
    (await http().get(`/api/reports/${type}`).query(q).set(h).expect(200))
      .body as ReportDto;
  const section = (r: ReportDto, key: string): ReportSection | undefined =>
    r.sections.find((s) => s.key === key);
  const figure = (r: ReportDto, key: string, row: string) => {
    const found = section(r, key)?.rows?.find((x) => x.key === row);
    if (!found) throw new Error(`no row ${key}.${row}`);
    return found.value;
  };
  const keys = (r: ReportDto) => r.sections.map((s) => s.key);
  const types = async (h: Headers) =>
    (
      (await http().get('/api/reports').set(h).expect(200)).body as {
        types: { type: string; label: string }[];
      }
    ).types.map((t) => t.type);
  const as = (role: Role) => world.actor(role);

  const batchCode = (id: string) =>
    prisma.animalBatch.findUniqueOrThrow({ where: { id } }).then((b) => b.code);

  /* ----------------------------------------------------------------- fixture */

  async function mkLot(
    code: string,
    count: number,
    entry: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    return (
      await prisma.animalBatch.create({
        data: {
          farmId: world.farmId,
          buildingId: world.poultryBld,
          code,
          species: 'AVICOLE',
          type: 'PONDEUSE',
          entryDate: D(entry),
          initialCount: count,
          ...over,
        },
      })
    ).id;
  }
  const event = (
    batchId: string,
    date: string,
    type: 'MORTALITE' | 'ENTREE',
    quantity: number,
  ) =>
    prisma.batchEvent.create({
      data: {
        farmId: world.farmId,
        batchId,
        date: D(date),
        type,
        quantity,
        createdById: userId,
      },
    });
  const eggs = (
    batchId: string,
    date: string,
    collected: number,
    broken = 0,
    farmId = world.farmId,
  ) =>
    prisma.eggProduction.create({
      data: { farmId, batchId, date: D(date), collected, broken },
    });

  /**
   * October 2026 on one farm: four poultry lots (11 570 alive, 443 deaths of
   * 12 313: 3.6 %), 245 pigs, the five manual entries and the four invoices of
   * the Rapports reference (3 970 000 / 2 835 000), eggs, feed, water, health,
   * tasks, equipment. Eggs, feed and water of the LAST recorded day are on 22/10.
   */
  async function buildFixture() {
    lot1 = await mkLot('LC-0001', 4500, '2026-09-01');
    lot2 = await mkLot('LC-0002', 3500, '2026-09-01');
    lot3 = await mkLot('LC-0003', 3000, '2026-09-01');
    chair = await mkLot('LC-2026-14', 1313, '2026-10-02', { type: 'CHAIR' });
    await event(lot1, '2026-09-15', 'MORTALITE', 100);
    await event(lot1, '2026-10-10', 'MORTALITE', 80);
    await event(lot2, '2026-09-20', 'MORTALITE', 100);
    await event(lot3, '2026-09-25', 'MORTALITE', 150);
    await event(chair, '2026-10-12', 'MORTALITE', 13);

    // eggs: 2 490 early in the month, 7 495 in the week of the 19th, 2 480 on the 22nd
    await eggs(lot1, '2026-10-05', 1500);
    await eggs(lot2, '2026-10-05', 990);
    for (const [day, a, b] of [
      ['2026-10-19', 1000, 900],
      ['2026-10-20', 1300, 1300],
      ['2026-10-21', 1500, 1495],
    ] as const) {
      await eggs(lot1, day, a);
      await eggs(lot2, day, b);
    }
    await eggs(lot3, '2026-10-22', 2480, 30);

    const product = await prisma.feedProduct.create({
      data: {
        organizationId: world.orgId,
        name: 'Aliment',
        kind: 'ALIMENT_COMPLET',
        unitCost: 300,
      },
    });
    productId = product.id;
    const feed = (batchId: string, date: string, kg: number) =>
      prisma.feedDistribution.create({
        data: {
          farmId: world.farmId,
          batchId,
          feedProductId: product.id,
          date: D(date),
          quantityKg: kg,
          unitCost: 300,
          cost: kg * 300,
        },
      });
    await feed(lot1, '2026-10-22', 800);
    await feed(lot2, '2026-10-22', 720);
    await feed(chair, '2026-10-10', 280);
    await prisma.waterConsumption.createMany({
      data: [
        {
          farmId: world.farmId,
          batchId: lot1,
          date: D('2026-10-22'),
          liters: 2000,
        },
        {
          farmId: world.farmId,
          batchId: lot2,
          date: D('2026-10-22'),
          liters: 1770,
        },
        {
          farmId: world.farmId,
          batchId: chair,
          date: D('2026-10-10'),
          liters: 600,
        },
      ],
    });
    await prisma.weighing.createMany({
      data: [
        {
          farmId: world.farmId,
          batchId: chair,
          date: D('2026-10-03'),
          sampleSize: 20,
          averageWeightG: 45,
        },
        {
          farmId: world.farmId,
          batchId: chair,
          date: D('2026-10-20'),
          sampleSize: 20,
          averageWeightG: 780,
        },
      ],
    });

    // pigs: 4 animals housed + one dead on the 15th + lots of 88, 2 and 151
    const sow = (
      tag: string,
      status: 'GESTANTE' | 'ACTIF' | 'ALLAITANTE' | 'MORT',
      over = {},
    ) =>
      prisma.animal.create({
        data: {
          farmId: world.farmId,
          tag,
          category: tag.startsWith('VR') ? 'VERRAT' : 'TRUIE',
          sex: tag.startsWith('VR') ? 'M' : 'F',
          buildingId: world.pigBld,
          status,
          birthDate: D('2025-01-01'),
          ...over,
        },
      });
    const tr1 = await sow('TR-001', 'GESTANTE');
    const tr2 = await sow('TR-002', 'ACTIF');
    const tr3 = await sow('TR-003', 'ALLAITANTE');
    await sow('VR-001', 'ACTIF');
    await sow('TR-004', 'MORT', {
      exitDate: D('2026-10-15'),
      exitReason: 'MORT',
    });
    const pigLot = (
      code: string,
      count: number,
      type: 'ENGRAISSEMENT' | 'PORCELET',
    ) =>
      mkLot(code, count, '2026-09-01', {
        species: 'PORCIN',
        type,
        buildingId: world.pigBld,
      });
    const fattening = await pigLot('LOT-ENG-07', 100, 'ENGRAISSEMENT');
    const litter = await pigLot('PO-2026-01', 12, 'PORCELET');
    const pe1 = await pigLot('PE-0001', 157, 'ENGRAISSEMENT');
    await prisma.batchEvent.create({
      data: {
        farmId: world.farmId,
        batchId: pe1,
        date: D('2026-10-14'),
        type: 'MORTALITE',
        quantity: 6,
        createdById: userId,
      },
    });
    const service = (sowId: string, day: string, over = {}) =>
      prisma.breedingRecord.create({
        data: {
          farmId: world.farmId,
          sowId,
          method: 'SAILLIE',
          serviceDate: D(day),
          expectedFarrowingDate: D('2027-01-01'),
          ...over,
        },
      });
    await service(tr1.id, '2026-10-03');
    await service(tr2.id, '2026-06-20', {
      status: 'MISE_BAS',
      farrowingDate: D('2026-10-10'),
      bornTotal: 12,
      bornAlive: 11,
      stillborn: 1,
    });
    await service(tr3.id, '2026-07-01', {
      status: 'SEVRAGE',
      farrowingDate: D('2026-07-25'),
      bornTotal: 10,
      bornAlive: 10,
      stillborn: 0,
      weaningDate: D('2026-10-18'),
      weanedAt: new Date('2026-10-18T10:00:00Z'),
      weanedCount: 9,
    });
    await service(tr3.id, '2026-10-20');

    // money: the five manual entries and the four invoices
    const entries: [string, string, string, string, number][] = [
      ['2026-10-01', 'Salaires septembre', 'GENERAL', 'SALAIRES', 950000],
      ['2026-10-03', 'Aliment chair 6 t', 'AVICOLE', 'ALIMENT', 1020000],
      ['2026-10-08', 'Électricité CEET', 'GENERAL', 'ENERGIE', 185000],
      ['2026-10-10', 'Vaccins & médicaments', 'AVICOLE', 'SANTE', 120000],
      ['2026-10-14', 'Aliment porc 2 t', 'PORCIN', 'ALIMENT', 560000],
    ];
    for (const [date, label, activity, category, amount] of entries) {
      await world.post(accountant, '/finance/entries', {
        date,
        label,
        activity,
        category,
        amount,
        kind: 'DEPENSE',
      });
    }
    const seller = await as('COMMERCIAL');
    const customer = await world.post<Id>(seller, '/customers', {
      name: 'Restaurant Le Palmier',
      type: 'REVENDEUR',
    });
    const invoice = async (date: string, lines: Record<string, unknown>[]) => {
      const res = await http()
        .post('/api/sales/issued')
        .set(accountant)
        .send({ customerId: customer.id, date, lines });
      if (res.status !== 201) throw new Error(JSON.stringify(res.body));
      return res.body as Id;
    };
    const pay = (inv: Id, date: string, amount: number, method = 'VIREMENT') =>
      world.post(accountant, `/sales/${inv.id}/payments`, {
        date,
        amount,
        method,
      });
    await pay(
      await invoice('2026-10-08', [
        { kind: 'LOT', batchId: litter, quantity: 10, unitPrice: 30000 },
      ]),
      '2026-10-09',
      300000,
    );
    await pay(
      await invoice('2026-10-12', [
        { kind: 'LOT', batchId: fattening, quantity: 12, unitPrice: 135000 },
      ]),
      '2026-10-13',
      1620000,
    );
    await pay(
      await invoice('2026-10-18', [
        { kind: 'OEUFS', batchId: lot1, quantity: 50, unitPrice: 20000 },
      ]),
      '2026-10-19',
      600000,
      'ESPECES',
    );
    await pay(
      await invoice('2026-10-20', [
        { kind: 'LOT', batchId: chair, quantity: 300, unitPrice: 3500 },
      ]),
      '2026-10-21',
      1050000,
    );

    // health
    const act = (
      type: 'VACCINATION' | 'TRAITEMENT' | 'DESINFECTION',
      date: string,
      target: { batchId?: string; buildingId?: string },
      over: Record<string, unknown> = {},
    ) =>
      prisma.healthAct.create({
        data: {
          farmId: world.farmId,
          type,
          date: D(date),
          createdById: userId,
          ...target,
          ...over,
        },
      });
    const done = (day: string) => ({
      status: 'REALISE' as const,
      doneDate: D(day),
    });
    await act(
      'VACCINATION',
      '2026-10-05',
      { batchId: lot1 },
      done('2026-10-05'),
    );
    await act(
      'VACCINATION',
      '2026-10-20',
      { batchId: lot2 },
      done('2026-10-20'),
    );
    await act(
      'TRAITEMENT',
      '2026-10-25',
      { batchId: lot1 },
      { ...done('2026-10-25'), durationDays: 3, withdrawalDays: 7 },
    );
    await act(
      'DESINFECTION',
      '2026-10-12',
      { buildingId: world.poultryBld },
      done('2026-10-12'),
    );
    await act(
      'TRAITEMENT',
      '2026-10-01',
      { batchId: lot2 },
      { ...done('2026-10-01'), durationDays: 0, withdrawalDays: 5 },
    );
    await act('VACCINATION', '2026-10-20', { batchId: lot1 });
    await act('VACCINATION', '2026-10-31', { batchId: lot2 });
    await act('VACCINATION', '2026-11-05', { batchId: lot1 });
    // planned for 28/10, completed from the plan on 05/11: late at the end of October, not of 05/11
    await act(
      'VACCINATION',
      '2026-10-28',
      { batchId: lot2 },
      { ...done('2026-11-05'), enteredDone: false },
    );
    await prisma.quarantine.createMany({
      data: [
        {
          farmId: world.farmId,
          batchId: lot1,
          startDate: D('2026-10-10'),
          reason: 'Toux',
        },
        {
          farmId: world.farmId,
          batchId: lot2,
          startDate: D('2026-10-01'),
          endDate: D('2026-10-20'),
          status: 'LEVEE',
          reason: 'Diarrhée',
        },
      ],
    });
    await prisma.healthIncident.createMany({
      data: ['2026-10-08', '2026-10-16', '2026-11-02'].map((date) => ({
        farmId: world.farmId,
        date: D(date),
        title: 'Incident',
        severity: 'FAIBLE' as const,
      })),
    });
    await prisma.biosecurityLog.createMany({
      data: [
        ['2026-10-03', 'NETTOYAGE'],
        ['2026-10-10', 'PEDILUVE'],
        ['2026-10-20', 'VISITEUR'],
        ['2026-11-03', 'NETTOYAGE'],
      ].map(([date, type]) => ({
        farmId: world.farmId,
        date: D(date),
        type: type as 'NETTOYAGE',
      })),
    });

    // stock: one critical, one low, one fine article
    const stockItem = async (name: string, qty: number, min: number) => {
      const item = await world.post<Id>(director, '/stock-items', {
        name,
        category: 'ALIMENT',
        unit: 'kg',
      });
      await world.post(director, '/stock/movements', {
        itemId: item.id,
        type: 'ENTREE',
        date: '2026-09-01',
        quantity: qty,
        unitCost: 100,
        reason: 'ACHAT',
      });
      await http()
        .put(`/api/stock/${item.id}/thresholds`)
        .set(director)
        .send({ minQty: min })
        .expect(200);
    };
    await stockItem('Maïs', 100, 400);
    await stockItem('Soja', 300, 400);
    await stockItem('Son', 500, 400);

    // tasks
    const task = (
      title: string,
      dueDate: string,
      createdAt: string,
      over: Record<string, unknown> = {},
    ) =>
      prisma.task.create({
        data: {
          farmId: world.farmId,
          title,
          dueDate: D(dueDate),
          createdAt: new Date(`${createdAt}T08:00:00Z`),
          createdById: userId,
          ...over,
        },
      });
    await task('Nettoyer', '2026-10-10', '2026-10-01', {
      status: 'TERMINEE',
      completedDate: D('2026-10-09'),
      completedById: userId,
    });
    await task('Peser', '2026-10-20', '2026-10-05');
    await task('Vacciner', '2026-10-31', '2026-10-28', { status: 'EN_COURS' });
    await task('Plus tard', '2026-12-01', '2026-11-10');

    // equipment
    const vent = await prisma.equipment.create({
      data: {
        farmId: world.farmId,
        name: 'Ventilateur A',
        type: 'VENTILATEUR',
        condition: 'EN_PANNE',
      },
    });
    await prisma.breakdown.create({
      data: {
        farmId: world.farmId,
        equipmentId: vent.id,
        date: D('2026-10-12'),
        description: 'Moteur',
        reportedById: userId,
      },
    });
    const groupe = await prisma.equipment.create({
      data: {
        farmId: world.farmId,
        name: 'Groupe',
        type: 'GROUPE_ELECTROGENE',
      },
    });
    for (const date of ['2026-10-05', '2026-10-25']) {
      await prisma.maintenance.create({
        data: {
          farmId: world.farmId,
          equipmentId: groupe.id,
          kind: 'PREVENTIVE',
          date: D(date),
          description: 'Vidange',
          createdById: userId,
        },
      });
    }
  }

  /* --------------------------------------------------------------- synthèse */

  describe('synthèse', () => {
    it('is the dashboard: the twelve reference rows, in order, equal to GET /dashboard field for field', async () => {
      const r = await report('synthese');
      const dash = (await http().get('/api/dashboard').set(admin).expect(200))
        .body as DashboardDto;
      expect(dash.kpis).toMatchObject({
        poultryAlive: 11570,
        pigs: 245,
        eggsLastDay: 2480,
        layingRate: 87,
        mortalityRate: 3.6,
      });
      expect(dash.feedDistributedKg).toBe(1520);
      expect(dash.waterConsumedL).toBe(3770);
      expect(keys(r)).toEqual(['indicateurs', 'activites']);
      expect(r.type).toBe('synthese');
      expect(r.farmName).toBe('Ferme A');
      expect(r.title).toMatch(/^Synthèse au \d{2}\/\d{2}\/\d{4}$/);
      expect(r.to).toBe(new Date().toISOString().slice(0, 10));
      expect(r.from).toBe(`${r.to.slice(0, 8)}01`);
      expect(new Date(r.generatedAt).getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
      expect(section(r, 'indicateurs')!.rows).toEqual([
        {
          key: 'poultry',
          label: 'Volailles vivantes',
          value: dash.kpis.poultryAlive,
          unit: '',
        },
        {
          key: 'pigs',
          label: 'Porcs (cheptel)',
          value: dash.kpis.pigs,
          unit: '',
        },
        {
          key: 'mortality',
          label: 'Taux de mortalité (lots en cours)',
          value: dash.kpis.mortalityRate,
          unit: '%',
        },
        {
          key: 'eggs',
          label: 'Œufs produits (dernier jour)',
          value: dash.kpis.eggsLastDay,
          unit: '',
        },
        {
          key: 'laying',
          label: 'Taux de ponte',
          value: dash.kpis.layingRate,
          unit: '%',
        },
        {
          key: 'feed',
          label: 'Aliment distribué',
          value: dash.feedDistributedKg,
          unit: 'kg',
        },
        {
          key: 'water',
          label: 'Eau consommée',
          value: dash.waterConsumedL,
          unit: 'L',
        },
        {
          key: 'revenue',
          label: "Chiffre d'affaires",
          value: dash.profitability!.revenue,
          unit: 'FCFA',
        },
        {
          key: 'expenses',
          label: 'Dépenses',
          value: dash.profitability!.expenses,
          unit: 'FCFA',
        },
        {
          key: 'margin',
          label: 'Marge indicative',
          value: dash.profitability!.margin,
          unit: 'FCFA',
        },
        {
          key: 'receivables',
          label: 'Créances clients',
          value: dash.profitability!.receivables,
          unit: 'FCFA',
        },
        {
          key: 'alerts',
          label: 'Alertes ouvertes',
          value: dash.alerts.total,
          unit: '',
        },
      ]);
      expect(section(r, 'activites')!.cards).toEqual(dash.revenueVsExpenses);
      expect(dash.profitability!.receivables).toBe(400000);
    });

    it('has no money row and no activity section for a role without finance:read, and its CSV neither', async () => {
      const h = await as('RESP_AVICOLE');
      const r = await report('synthese', {}, h);
      expect(keys(r)).toEqual(['indicateurs']);
      expect(section(r, 'indicateurs')!.rows!.map((x) => x.key)).toEqual([
        'poultry',
        'pigs',
        'mortality',
        'eggs',
        'laying',
        'feed',
        'water',
        'alerts',
      ]);
      const csv = await http()
        .get('/api/reports/synthese')
        .query({ format: 'csv' })
        .set(h)
        .expect(200);
      expect(csv.text).not.toContain("Chiffre d'affaires");
      expect(csv.text).not.toContain('FCFA');
      expect(csv.text).not.toContain('Activité');
      expect(csv.text).toContain('Volailles vivantes;11570;');
    });

    it('gives the accountant the indicators and the activities', async () => {
      const r = await report('synthese', {}, accountant);
      expect(keys(r)).toEqual(['indicateurs', 'activites']);
    });
  });

  /* ------------------------------------------------- daily to annual reports */

  describe('periodic reports', () => {
    it('quotidien 22/10: the eggs, feed and water of the day', async () => {
      const r = await report('quotidien', { date: '2026-10-22' });
      expect(r).toMatchObject({
        type: 'quotidien',
        title: 'Rapport quotidien du 22/10/2026',
        from: '2026-10-22',
        to: '2026-10-22',
        farmName: 'Ferme A',
      });
      expect(keys(r)).toEqual([
        'avicole',
        'porcine',
        'alimentation',
        'sante',
        'stocks',
        'taches',
        'equipements',
        'finance',
      ]);
      expect(section(r, 'avicole')!.title).toBe('Production avicole');
      expect(figure(r, 'avicole', 'collected')).toBe(2480);
      expect(figure(r, 'avicole', 'marketable')).toBe(2450);
      expect(figure(r, 'avicole', 'laying')).toBe(87);
      expect(figure(r, 'alimentation', 'feed')).toBe(1520);
      expect(figure(r, 'alimentation', 'water')).toBe(3770);
      expect(section(r, 'alimentation')!.title).toBe('Alimentation & eau');
    });

    it('quotidien of the last recorded day is the dashboard of the same farm: eggs, laying rate, feed and water', async () => {
      const dash = (await http().get('/api/dashboard').set(admin).expect(200))
        .body as DashboardDto;
      const r = await report('quotidien', { date: '2026-10-22' });
      expect(figure(r, 'avicole', 'collected')).toBe(dash.kpis.eggsLastDay);
      expect(figure(r, 'avicole', 'laying')).toBe(dash.kpis.layingRate);
      expect(figure(r, 'alimentation', 'feed')).toBe(dash.feedDistributedKg);
      expect(figure(r, 'alimentation', 'water')).toBe(dash.waterConsumedL);
      // and its pigs are the dashboard's pigs once the day is today's headcount
      const pigs = await report('quotidien', {}, admin);
      expect(figure(pigs, 'porcine', 'pigs')).toBe(dash.kpis.pigs);
    });

    it('hebdomadaire: the ISO week of the 22nd, Monday 19 to Sunday 25', async () => {
      const r = await report('hebdomadaire', { date: '2026-10-22' });
      expect(r).toMatchObject({
        title: 'Rapport hebdomadaire du 19/10/2026 au 25/10/2026',
        from: '2026-10-19',
        to: '2026-10-25',
      });
      expect(figure(r, 'avicole', 'collected')).toBe(9975);
      expect(figure(r, 'avicole', 'marketable')).toBe(9945);
      expect(figure(r, 'avicole', 'laying')).toBe(38.4);
      expect(figure(r, 'avicole', 'sales')).toBe(300);
      expect(figure(r, 'alimentation', 'feed')).toBe(1520);
      expect(figure(r, 'porcine', 'services')).toBe(1);
    });

    it('mensuel: the month of any day in it, with the flows of October', async () => {
      const r = await report('mensuel', { date: '2026-10-15' });
      expect(r).toMatchObject({
        title: 'Rapport mensuel — octobre 2026',
        from: '2026-10-01',
        to: '2026-10-31',
      });
      const rows = section(r, 'avicole')!.rows!;
      expect(rows.map((x) => [x.key, x.label])).toEqual([
        ['lots', 'Lots en cours (au 31/10/2026)'],
        ['alive', 'Volailles vivantes (au 31/10/2026)'],
        ['entries', 'Entrées'],
        ['deaths', 'Morts'],
        ['sales', 'Ventes'],
        ['culls', 'Réformes'],
        ['collected', 'Œufs collectés'],
        ['marketable', 'Œufs commercialisables'],
        ['laying', 'Taux de ponte moyen'],
      ]);
      expect(rows.map((x) => x.value)).toEqual([
        4, 11570, 1313, 93, 300, 0, 12465, 12435, 36.9,
      ]);
      expect(figure(r, 'alimentation', 'feed')).toBe(1800);
      expect(figure(r, 'alimentation', 'water')).toBe(4370);
    });

    it('annuel: the calendar year, clipped to today', async () => {
      const r = await report('annuel', { date: '2026-03-04' });
      expect(r).toMatchObject({
        title: 'Rapport annuel 2026',
        from: '2026-01-01',
      });
      expect(r.to).toBe(new Date().toISOString().slice(0, 10));
      expect(figure(r, 'avicole', 'collected')).toBe(12465);
    });

    it('porcs: headcount at the end day, deaths, sales and the reproduction rows', async () => {
      const month = await report('mensuel', { date: '2026-10-15' });
      expect(
        section(month, 'porcine')!.rows!.map((x) => [x.key, x.label, x.value]),
      ).toEqual([
        ['pigs', 'Porcs (au 31/10/2026)', 245],
        ['deaths', 'Morts', 7],
        ['sales', 'Ventes', 22],
        ['services', 'Saillies', 2],
        ['farrowings', 'Mises bas', 1],
        ['bornAlive', 'Nés vivants', 11],
        ['stillborn', 'Mort-nés', 1],
        ['weaned', 'Sevrés', 9],
      ]);
      // before the sow died (15/10) and before the sale of the 12th: the past headcount
      const before = await report('quotidien', { date: '2026-10-11' });
      expect(figure(before, 'porcine', 'pigs')).toBe(264); // 5 animals + 100 + 2 + 157
      const day14 = await report('quotidien', { date: '2026-10-14' });
      expect(figure(day14, 'porcine', 'pigs')).toBe(246); // 5 animals + 88 + 2 + 151
      expect(figure(day14, 'porcine', 'deaths')).toBe(6);
    });

    it('santé: the acts done, the late ones, the quarantines, incidents and logs', async () => {
      const r = await report('mensuel', { date: '2026-10-15' });
      expect(
        section(r, 'sante')!.rows!.map((x) => [x.key, x.label, x.value]),
      ).toEqual([
        ['vaccinations', 'Vaccinations réalisées', 2],
        ['treatments', 'Traitements réalisés', 2],
        ['disinfections', 'Désinfections réalisées', 1],
        ['overdue', 'Actes en retard (au 31/10/2026)', 3],
        ['quarantines', 'Quarantaines en cours (au 31/10/2026)', 1],
        ['incidents', 'Incidents', 2],
        ['biosecurity', 'Contrôles de biosécurité', 3],
      ]);
    });

    it('stocks, tâches and équipements', async () => {
      const r = await report('mensuel', { date: '2026-10-15' });
      const stock = (await http().get('/api/stock').set(admin).expect(200))
        .body as { levelCounts: Record<string, number> };
      expect(stock.levelCounts).toEqual({ ok: 1, faible: 1, critique: 1 });
      expect(
        section(r, 'stocks')!.rows!.map((x) => [x.key, x.label, x.value]),
      ).toEqual([
        [
          'low',
          "Articles en stock faible (aujourd'hui)",
          stock.levelCounts.faible,
        ],
        [
          'critical',
          "Articles en stock critique (aujourd'hui)",
          stock.levelCounts.critique,
        ],
      ]);
      expect(
        section(r, 'taches')!.rows!.map((x) => [x.key, x.label, x.value]),
      ).toEqual([
        ['completed', 'Tâches terminées', 1],
        ['created', 'Tâches créées', 3],
        ['overdue', 'Tâches en retard (au 31/10/2026)', 2],
      ]);
      expect(
        section(r, 'equipements')!.rows!.map((x) => [x.key, x.label, x.value]),
      ).toEqual([
        ['breakdowns', 'Pannes déclarées', 1],
        ['interventions', 'Interventions', 2],
        ['broken', "Équipements en panne (aujourd'hui)", 1],
      ]);
      // a task is late from the end of its due day (Q44): the 20th at the end of the 22nd
      const day = await report('quotidien', { date: '2026-10-22' });
      expect(figure(day, 'taches', 'overdue')).toBe(1);
      expect(figure(day, 'taches', 'created')).toBe(0);
    });
  });

  /* ----------------------------------------------------------------- finance */

  describe('finance section', () => {
    it('equals /finance/summary and the payments journal of the same days', async () => {
      const r = await report('mensuel', { date: '2026-10-15' });
      const summary = (
        await http()
          .get('/api/finance/summary')
          .query({ from: '2026-10-01', to: '2026-10-31' })
          .set(admin)
          .expect(200)
      ).body as Summary;
      const journal = (
        await http()
          .get('/api/sales/payments')
          .query({ from: '2026-10-01', to: '2026-10-31' })
          .set(admin)
          .expect(200)
      ).body as { totals: { received: number; refunded: number } };
      const rows = section(r, 'finance')!.rows!;
      expect(rows.map((x) => [x.key, x.label, x.value, x.unit])).toEqual([
        ['revenue', "Chiffre d'affaires", 3970000, 'FCFA'],
        ['expenses', 'Dépenses', 2835000, 'FCFA'],
        ['margin', 'Marge', 1135000, 'FCFA'],
        ['marginPct', 'Taux de marge', summary.marginPct, '%'],
        [
          'receivables',
          "Créances clients (aujourd'hui)",
          summary.receivables,
          'FCFA',
        ],
        ['received', 'Encaissements', journal.totals.received, 'FCFA'],
        ['refunded', 'Remboursements', journal.totals.refunded, 'FCFA'],
      ]);
      expect(summary).toMatchObject({
        revenue: 3970000,
        marginPct: 29,
        receivables: 400000,
      });
      expect(journal.totals.received).toBe(3570000);
      const cards = section(r, 'finance')!.cards!;
      expect(cards).toEqual(summary.byActivity);
      expect(cards.find((c) => c.activity === 'GENERAL')!.margin).toBe(
        -1135000,
      );
      expect(section(r, 'finance')!.table).toEqual({
        columns: [
          { key: 'category', header: 'CATÉGORIE' },
          { key: 'type', header: 'TYPE' },
          { key: 'amount', header: 'MONTANT', unit: 'FCFA' },
        ],
        rows: summary.byCategory.map((c) => ({
          category: c.label,
          type: c.kind === 'RECETTE' ? 'Recette' : 'Dépense',
          amount: c.amount,
        })),
      });
      expect(rows.find((x) => x.key === 'revenue')!.value).toBe(
        summary.revenue,
      );
    });

    it('is the only section the accountant gets in a monthly report', async () => {
      expect(
        keys(await report('mensuel', { date: '2026-10-15' }, accountant)),
      ).toEqual(['finance']);
    });

    it('shows no money to a role without finance:read, whatever the report', async () => {
      let served = 0;
      for (const role of [
        'RESP_AVICOLE',
        'RESP_PORCIN',
        'VETERINAIRE',
        'RESP_STOCK',
        'COMMERCIAL',
      ] as Role[]) {
        const h = await as(role);
        for (const type of [
          'synthese',
          'quotidien',
          'mensuel',
          'sanitaire',
          'zootechnique',
        ]) {
          const res = await http()
            .get(`/api/reports/${type}`)
            .query({ from: '2026-10-01', to: '2026-10-31', date: '2026-10-15' })
            .set(h);
          if (res.status !== 200) {
            expect(res.status).toBe(403);
            continue;
          }
          served++;
          const text = JSON.stringify(res.body);
          expect(text).not.toContain('FCFA');
          expect(text).not.toContain('"cards"');
        }
      }
      expect(served).toBeGreaterThan(15);
    });
  });

  /* -------------------------------------------------------------- roles */

  describe('who reads what', () => {
    it('lists the types with a visible section, per role', async () => {
      const all = [
        'synthese',
        'quotidien',
        'hebdomadaire',
        'mensuel',
        'annuel',
        'sanitaire',
        'zootechnique',
      ];
      expect(await types(admin)).toEqual(all);
      expect(await types(await as('VETERINAIRE'))).toEqual(all);
      expect(await types(await as('RESP_AVICOLE'))).toEqual(all);
      expect(await types(accountant)).toEqual(
        all.filter((t) => t !== 'sanitaire'),
      );
      expect(await types(await as('COMMERCIAL'))).toEqual(
        all.filter((t) => t !== 'sanitaire'),
      );
      expect(await types(await as('RESP_STOCK'))).toEqual([
        'synthese',
        'quotidien',
        'hebdomadaire',
        'mensuel',
        'annuel',
      ]);
      expect((await http().get('/api/reports').set(admin)).body).toEqual({
        types: [
          { type: 'synthese', label: 'Synthèse' },
          { type: 'quotidien', label: 'Quotidien' },
          { type: 'hebdomadaire', label: 'Hebdomadaire' },
          { type: 'mensuel', label: 'Mensuel' },
          { type: 'annuel', label: 'Annuel' },
          { type: 'sanitaire', label: 'Sanitaire' },
          { type: 'zootechnique', label: 'Zootechnique' },
        ],
      });
    });

    it('gates each section of a monthly report by its module', async () => {
      const q = { date: '2026-10-15' };
      expect(keys(await report('mensuel', q, await as('COMMERCIAL')))).toEqual([
        'avicole',
        'porcine',
        'stocks',
      ]);
      expect(
        keys(await report('mensuel', q, await as('RESP_AVICOLE'))),
      ).toEqual([
        'avicole',
        'alimentation',
        'sante',
        'stocks',
        'taches',
        'equipements',
      ]);
      expect(keys(await report('mensuel', q, await as('RESP_PORCIN')))).toEqual(
        ['porcine', 'alimentation', 'sante', 'stocks', 'taches', 'equipements'],
      );
      expect(keys(await report('mensuel', q, await as('RESP_STOCK')))).toEqual([
        'alimentation',
        'stocks',
        'taches',
      ]);
      expect(keys(await report('mensuel', q, await as('VETERINAIRE')))).toEqual(
        ['avicole', 'porcine', 'alimentation', 'sante', 'stocks', 'taches'],
      );
    });

    it('answers 403 with the access message when no section is visible, 403 without rapports', async () => {
      for (const type of ['sanitaire']) {
        for (const h of [
          accountant,
          await as('COMMERCIAL'),
          await as('RESP_STOCK'),
        ]) {
          const res = await http()
            .get(`/api/reports/${type}`)
            .set(h)
            .expect(403);
          expect(msg(res)).toBe(NOT_ALLOWED);
        }
      }
      expect(
        msg(
          await http()
            .get('/api/reports/zootechnique')
            .set(await as('RESP_STOCK'))
            .expect(403),
        ),
      ).toBe(NOT_ALLOWED);
      for (const role of ['AGENT_ELEVAGE', 'MAGASINIER'] as Role[]) {
        const h = await as(role);
        await http().get('/api/reports').set(h).expect(403);
        for (const type of [
          'synthese',
          'quotidien',
          'sanitaire',
          'zootechnique',
        ]) {
          await http().get(`/api/reports/${type}`).set(h).expect(403);
        }
      }
      await http().get('/api/reports').expect(401);
    });
  });

  /* --------------------------------------------------------- sanitaire */

  describe('sanitaire', () => {
    it('the health section, the withdrawal periods and the deaths per lot', async () => {
      const r = await report(
        'sanitaire',
        { from: '2026-10-01', to: '2026-10-31' },
        await as('VETERINAIRE'),
      );
      expect(r.title).toBe('Rapport sanitaire du 01/10/2026 au 31/10/2026');
      expect(keys(r)).toEqual(['sante', 'delais', 'mortalite']);
      expect(figure(r, 'sante', 'vaccinations')).toBe(2);
      expect(section(r, 'delais')).toMatchObject({
        title: "Délais d'attente en cours",
        table: {
          columns: [
            { key: 'target', header: 'CIBLE' },
            { key: 'until', header: "JUSQU'AU", date: true },
          ],
          rows: [{ target: 'LC-0001', until: '04/11/2026' }],
        },
      });
      const mortality = section(r, 'mortalite')!;
      expect(mortality.title).toBe('Mortalité par lot');
      expect(mortality.table!.columns).toEqual([
        { key: 'code', header: 'LOT' },
        { key: 'type', header: 'TYPE' },
        { key: 'deaths', header: 'MORTS (PÉRIODE)' },
        { key: 'rate', header: 'MORTALITÉ CUMULÉE', unit: '%' },
      ]);
      const byCode = Object.fromEntries(
        mortality.table!.rows.map((x) => [x.code as string, x]),
      );
      expect(byCode['LC-0001']).toEqual({
        code: 'LC-0001',
        type: 'Pondeuse',
        deaths: 80,
        rate: 4,
      });
      expect(byCode['LC-2026-14']).toEqual({
        code: 'LC-2026-14',
        type: 'Chair',
        deaths: 13,
        rate: 1,
      });
      expect(byCode['PE-0001']).toEqual({
        code: 'PE-0001',
        type: 'Engraissement',
        deaths: 6,
        rate: 3.8,
      });
      expect(Object.keys(byCode).sort()).toEqual([
        'LC-0001',
        'LC-0002',
        'LC-0003',
        'LC-2026-14',
        'LOT-ENG-07',
        'PE-0001',
        'PO-2026-01',
      ]);
    });

    it('is the state at the end day: quarantines still open then, nothing under withdrawal yet', async () => {
      const r = await report('sanitaire', {
        from: '2026-10-01',
        to: '2026-10-15',
      });
      expect(section(r, 'sante')!.rows!.map((x) => [x.key, x.value])).toEqual([
        ['vaccinations', 1],
        ['treatments', 1],
        ['disinfections', 1],
        ['overdue', 0],
        ['quarantines', 2],
        ['incidents', 1],
        ['biosecurity', 2],
      ]);
      expect(section(r, 'delais')!.table!.rows).toEqual([]);
    });

    it('counts the late acts as the health list does, up to today', async () => {
      const r = await report('sanitaire', { from: '2026-11-01' });
      const late = (
        await http()
          .get('/api/health-acts')
          .query({ status: 'EN_RETARD' })
          .set(admin)
          .expect(200)
      ).body as { total: number };
      expect(late.total).toBe(3);
      expect(figure(r, 'sante', 'overdue')).toBe(late.total);
    });

    it('shows the lots of the species the role reads', async () => {
      const r = await report(
        'sanitaire',
        { from: '2026-10-01', to: '2026-10-31' },
        await as('RESP_AVICOLE'),
      );
      const codes = section(r, 'mortalite')!.table!.rows.map((x) => x.code);
      expect(codes.sort()).toEqual([
        'LC-0001',
        'LC-0002',
        'LC-0003',
        'LC-2026-14',
      ]);
      const pigs = await report(
        'sanitaire',
        { from: '2026-10-01', to: '2026-10-31' },
        await as('RESP_PORCIN'),
      );
      expect(
        section(pigs, 'mortalite')!
          .table!.rows.map((x) => x.code)
          .sort(),
      ).toEqual(['LOT-ENG-07', 'PE-0001', 'PO-2026-01']);
    });
  });

  describe('species scope of the health and feed figures', () => {
    const health = async (h: Headers) => {
      const r = await report(
        'sanitaire',
        { from: '2026-10-01', to: '2026-10-31' },
        h,
      );
      return {
        vaccinations: figure(r, 'sante', 'vaccinations') as number,
        treatments: figure(r, 'sante', 'treatments') as number,
        overdue: figure(r, 'sante', 'overdue') as number,
        quarantines: figure(r, 'sante', 'quarantines') as number,
        incidents: figure(r, 'sante', 'incidents') as number,
        targets: section(r, 'delais')!.table!.rows.map((x) => x.target),
      };
    };
    const feed = async (h: Headers) => {
      const r = await report('quotidien', { date: '2026-10-22' }, h);
      return [
        figure(r, 'alimentation', 'feed'),
        figure(r, 'alimentation', 'water'),
      ];
    };

    it('shows a role in the reports what its screens show: no other species, no pig act without porcs', async () => {
      const [hAvicole, hPorcin, hVet, hStock] = await Promise.all([
        as('RESP_AVICOLE'),
        as('RESP_PORCIN'),
        as('VETERINAIRE'),
        as('RESP_STOCK'),
      ]);
      const before = {
        avicole: await health(hAvicole),
        porcin: await health(hPorcin),
        vet: await health(hVet),
        feedAvicole: await feed(hAvicole),
        feedPorcin: await feed(hPorcin),
        feedStock: await feed(hStock),
        feedVet: await feed(hVet),
      };
      const pigLot = await prisma.animalBatch.findFirstOrThrow({
        where: { code: 'LOT-ENG-07' },
      });
      const sow = await prisma.animal.findFirstOrThrow({
        where: { tag: 'TR-001' },
      });
      const cleanup = () =>
        Promise.all([
          prisma.healthAct.deleteMany({
            where: { OR: [{ batchId: pigLot.id }, { animalId: sow.id }] },
          }),
          prisma.quarantine.deleteMany({ where: { batchId: pigLot.id } }),
          prisma.healthIncident.deleteMany({ where: { batchId: pigLot.id } }),
          prisma.feedDistribution.deleteMany({
            where: {
              OR: [{ batchId: pigLot.id }, { buildingId: world.pigBld }],
            },
          }),
          prisma.waterConsumption.deleteMany({
            where: {
              OR: [{ batchId: pigLot.id }, { buildingId: world.pigBld }],
            },
          }),
        ]);
      try {
        const act = (
          type: 'VACCINATION' | 'TRAITEMENT',
          date: string,
          target: { batchId?: string; animalId?: string },
          over: Record<string, unknown> = {},
        ) =>
          prisma.healthAct.create({
            data: {
              farmId: world.farmId,
              type,
              date: D(date),
              createdById: userId,
              ...target,
              ...over,
            },
          });
        const done = (day: string) => ({
          status: 'REALISE' as const,
          doneDate: D(day),
        });
        await act(
          'VACCINATION',
          '2026-10-20',
          { batchId: pigLot.id },
          done('2026-10-20'),
        );
        await act(
          'TRAITEMENT',
          '2026-10-25',
          { batchId: pigLot.id },
          { ...done('2026-10-25'), durationDays: 3, withdrawalDays: 7 },
        );
        await act(
          'TRAITEMENT',
          '2026-10-22',
          { animalId: sow.id },
          done('2026-10-22'),
        );
        await act('VACCINATION', '2026-10-21', { batchId: pigLot.id });
        await prisma.quarantine.create({
          data: {
            farmId: world.farmId,
            batchId: pigLot.id,
            startDate: D('2026-10-12'),
            reason: 'Toux',
          },
        });
        await prisma.healthIncident.create({
          data: {
            farmId: world.farmId,
            batchId: pigLot.id,
            date: D('2026-10-15'),
            title: 'Porcs',
            severity: 'FAIBLE',
          },
        });
        const product = await prisma.feedProduct.findFirstOrThrow();
        await prisma.feedDistribution.createMany({
          data: [
            [pigLot.id, null, 100],
            [null, world.pigBld, 50],
          ].map(([batchId, buildingId, kg]) => ({
            farmId: world.farmId,
            batchId: batchId as string | null,
            buildingId: buildingId as string | null,
            feedProductId: product.id,
            date: D('2026-10-22'),
            quantityKg: kg as number,
            unitCost: 300,
            cost: (kg as number) * 300,
          })),
        });
        await prisma.waterConsumption.createMany({
          data: [
            { batchId: pigLot.id, buildingId: null, liters: 400 },
            { batchId: null, buildingId: world.pigBld, liters: 30 },
          ].map((w) => ({ farmId: world.farmId, date: D('2026-10-22'), ...w })),
        });

        // The poultry manager: not a pig lot code, not a pig act, not a pig feed or water litre.
        expect(await health(hAvicole)).toEqual(before.avicole);
        expect(await feed(hAvicole)).toEqual([
          (before.feedAvicole[0] as number) + 50,
          (before.feedAvicole[1] as number) + 30,
        ]);
        // The pig manager: the pig lot and its animal, and only that.
        const pig = await health(hPorcin);
        expect(pig).toMatchObject({
          vaccinations: before.porcin.vaccinations + 1,
          treatments: before.porcin.treatments + 2,
          quarantines: before.porcin.quarantines + 1,
          incidents: before.porcin.incidents + 1,
        });
        expect(pig.overdue).toBe(before.porcin.overdue + 1);
        expect(pig.targets).toContain('LOT-ENG-07');
        expect(pig.targets).not.toContain('LC-0001');
        expect(before.avicole.targets).toContain('LC-0001');
        expect(before.avicole.targets).not.toContain('LOT-ENG-07');
        // The stock manager reads the feed list but no lot: only the rows aimed at a building.
        expect(await feed(hStock)).toEqual([50, 30]);
        expect(before.feedStock).toEqual([0, 0]);
        expect(await feed(hPorcin)).toEqual([150, 430]);
        // The veterinarian reads both species.
        const v = await health(hVet);
        expect(v.vaccinations).toBe(before.vet.vaccinations + 1);
        expect(v.targets).toEqual(
          expect.arrayContaining(['LC-0001', 'LOT-ENG-07']),
        );
        expect((await feed(hVet))[0]).toBe((before.feedVet[0] as number) + 150);
      } finally {
        await cleanup();
      }
    });
  });

  /* ------------------------------------------------------ zootechnique */

  describe('zootechnique', () => {
    it("a lot's row is the performance block of GET /batches/:id", async () => {
      const r = await report('zootechnique', {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(r.title).toBe('Rapport zootechnique du 01/10/2026 au 31/10/2026');
      expect(keys(r)).toEqual(['performances', 'porcine', 'rentabilite']);
      const table = section(r, 'performances')!.table!;
      expect(table.columns.map((c) => [c.key, c.header, c.unit])).toEqual([
        ['code', 'LOT', undefined],
        ['type', 'TYPE', undefined],
        ['age', "ÂGE (J) DEPUIS L'ENTRÉE", undefined],
        ['alive', 'EFFECTIF (AU 31/10/2026)', undefined],
        ['deaths', "MORTS DEPUIS L'ENTRÉE", undefined],
        ['mortality', "MORTALITÉ DEPUIS L'ENTRÉE", '%'],
        ['lastWeight', 'DERNIER POIDS CONNU (G)', undefined],
        ['gmd', "GMD (G/J) DEPUIS L'ENTRÉE", undefined],
        ['ic', "IC DEPUIS L'ENTRÉE", undefined],
        ['laying', 'TAUX DE PONTE (PÉRIODE)', '%'],
      ]);
      const row = table.rows.find((x) => x.code === 'LC-2026-14')!;
      const detail = (
        await http().get(`/api/batches/${chair}`).set(admin).expect(200)
      ).body as BatchDetail;
      expect(detail.performance.dailyGainG).not.toBeNull();
      expect(detail.performance.feedConversion).not.toBeNull();
      expect(row).toMatchObject({
        type: 'Chair',
        age: detail.performance.ageDays,
        alive: 1000,
        deaths: detail.performance.deaths,
        mortality: detail.performance.mortalityRate,
        lastWeight: detail.performance.lastWeightG,
        gmd: detail.performance.dailyGainG,
        ic: detail.performance.feedConversion,
        laying: null,
      });
      // a laying lot: eggs / hen-days of the period
      const layer = table.rows.find((x) => x.code === 'LC-0003')!;
      expect(layer).toMatchObject({ alive: 2850, laying: 87 });
      expect(table.rows.map((x) => x.code)).toHaveLength(7);
    });

    it('reproduction rows and the profitability table, equal to /finance/lots', async () => {
      const q = { from: '2026-10-01', to: '2026-10-31' };
      const r = await report('zootechnique', q);
      expect(section(r, 'porcine')!.rows!.map((x) => x.key)).toEqual([
        'services',
        'farrowings',
        'bornAlive',
        'stillborn',
        'weaned',
      ]);
      const lots = (
        await http()
          .get('/api/finance/lots')
          .query({ ...q, pageSize: 100 })
          .set(admin)
          .expect(200)
      ).body as { items: LotRow[] };
      const table = section(r, 'rentabilite')!.table!;
      expect(table.columns).toEqual([
        { key: 'code', header: 'LOT' },
        { key: 'totalCost', header: 'COÛT TOTAL', unit: 'FCFA' },
        { key: 'revenue', header: 'RECETTES', unit: 'FCFA' },
        { key: 'margin', header: 'MARGE', unit: 'FCFA' },
        { key: 'costPerAnimal', header: 'COÛT / ANIMAL', unit: 'FCFA' },
      ]);
      expect(table.rows).toHaveLength(7);
      for (const row of table.rows) {
        const lot = lots.items.find((l) => l.code === row.code)!;
        expect(row).toEqual({
          code: lot.code,
          totalCost: lot.totalCost,
          revenue: lot.revenue,
          margin: lot.margin,
          costPerAnimal: lot.costPerAnimal,
        });
      }
      expect(table.rows.find((x) => x.code === 'LC-2026-14')!.revenue).toBe(
        1050000,
      );
      // the accountant reads the same table without being allowed to read the lots
      const acc = await report('zootechnique', q, accountant);
      expect(keys(acc)).toEqual(['rentabilite']);
      expect(section(acc, 'rentabilite')!.table).toEqual(table);
    });

    it('shows no profitability to a role without finance:read and splits the lots by species', async () => {
      const q = { from: '2026-10-01', to: '2026-10-31' };
      const poultry = await report('zootechnique', q, await as('RESP_AVICOLE'));
      expect(keys(poultry)).toEqual(['performances']);
      expect(
        section(poultry, 'performances')!
          .table!.rows.map((x) => x.code)
          .sort(),
      ).toEqual(['LC-0001', 'LC-0002', 'LC-0003', 'LC-2026-14']);
      const pigs = await report('zootechnique', q, await as('RESP_PORCIN'));
      expect(keys(pigs)).toEqual(['performances', 'porcine']);
      expect(
        section(pigs, 'performances')!
          .table!.rows.map((x) => x.code)
          .sort(),
      ).toEqual(['LOT-ENG-07', 'PE-0001', 'PO-2026-01']);
    });

    it('lists the lots open at some point of the period', async () => {
      const earlier = await report('zootechnique', {
        from: '2026-09-05',
        to: '2026-09-30',
      });
      expect(
        section(earlier, 'performances')!.table!.rows.map((x) => x.code),
      ).not.toContain('LC-2026-14');
      const later = await report('zootechnique', {
        from: '2026-10-01',
        to: '2026-10-01',
      });
      expect(
        section(later, 'performances')!.table!.rows.map((x) => x.code),
      ).not.toContain('LC-2026-14');
    });
  });

  describe('hen-days', () => {
    it('are the live counts of the ledger on each day, whichever way they are asked', async () => {
      const ledger = app.get(HerdLedgerService);
      const days = [
        '2026-08-31',
        '2026-09-01',
        '2026-09-15',
        '2026-10-09',
        '2026-10-10',
        '2026-10-31',
      ];
      const pairs = [lot1, lot2, chair].flatMap((batchId) =>
        days.map((d) => ({ batchId, date: D(d) })),
      );
      const many = await ledger.liveCountsOnDays(pairs);
      expect(many.size).toBe(pairs.length);
      for (const { batchId, date } of pairs) {
        expect(many.get(`${batchId}:${date.getTime()}`)).toBe(
          (await ledger.liveCounts([batchId], date)).get(batchId),
        );
      }
      expect(many.get(`${lot1}:${D('2026-10-09').getTime()}`)).toBe(4400);
      expect(many.get(`${lot1}:${D('2026-08-31').getTime()}`)).toBe(0);
    });
  });

  /* ------------------------------------------------------------- periods */

  describe('period rules', () => {
    it('refuses a future date, an inverted period, a bad day, an unknown type and format', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(
        msg(
          await http()
            .get('/api/reports/quotidien')
            .query({ date: tomorrow })
            .set(admin)
            .expect(400),
        ),
      ).toBe('La date ne peut pas être dans le futur');
      expect(
        msg(
          await http()
            .get('/api/reports/sanitaire')
            .query({ from: '2026-10-31', to: '2026-10-01' })
            .set(admin)
            .expect(400),
        ),
      ).toBe('La date de début est après la date de fin');
      expect(
        msg(
          await http()
            .get('/api/reports/zootechnique')
            .query({ from: '2025-01-01', to: '2026-10-01' })
            .set(admin)
            .expect(400),
        ),
      ).toBe('La période ne peut pas dépasser 366 jours');
      expect(
        msg(
          await http()
            .get('/api/reports/mensuel')
            .query({ date: 'hier' })
            .set(admin)
            .expect(400),
        ),
      ).toContain('Date invalide (AAAA-MM-JJ)');
      expect(
        msg(await http().get('/api/reports/hebdo').set(admin).expect(404)),
      ).toBe('Rapport inconnu');
      await http()
        .get('/api/reports/mensuel')
        .query({ format: 'pdf' })
        .set(admin)
        .expect(400);
      await http()
        .get('/api/reports/mensuel')
        .query({ foo: 'x' })
        .set(admin)
        .expect(400);
    });
  });

  /* ------------------------------------------------------------ exports */

  describe('files', () => {
    const binary = (
      res: { on: (e: string, f: (c?: Buffer) => void) => void },
      cb: (e: Error | null, b: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    it('answers the CSV with the filename of the period, the BOM and the decimal comma', async () => {
      const res = await http()
        .get('/api/reports/mensuel')
        .query({ date: '2026-10-15', format: 'csv' })
        .set(admin)
        .expect(200);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="rapport-mensuel-2026-10-01_2026-10-31.csv"',
      );
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.startsWith('﻿Section;Indicateur;Valeur;Unité\r\n')).toBe(
        true,
      );
      const lines = res.text.split('\r\n');
      expect(lines).toContain('Production avicole;Taux de ponte moyen;36,9;%');
      expect(lines).toContain("Finance;Chiffre d'affaires;3970000;FCFA");
      expect(lines).toContain('Activité Général;Marge;-1135000;FCFA');
      expect(lines).toContain('Finance');
      expect(lines).toContain('CATÉGORIE;TYPE;MONTANT (FCFA)');
      expect(lines.indexOf('')).toBeGreaterThan(0);
    });

    it('writes a decimal rate with a comma', async () => {
      const res = await http()
        .get('/api/reports/hebdomadaire')
        .query({ date: '2026-10-22', format: 'csv' })
        .set(admin)
        .expect(200);
      expect(res.text.split('\r\n')).toContain(
        'Production avicole;Taux de ponte moyen;38,4;%',
      );
    });

    it('answers the workbook with the Indicateurs sheet and one sheet per table', async () => {
      const res = await http()
        .get('/api/reports/mensuel')
        .query({ date: '2026-10-15', format: 'xlsx' })
        .set(admin)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="rapport-mensuel-2026-10-01_2026-10-31.xlsx"',
      );
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const wb = new Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual([
        'Indicateurs',
        'Finance',
      ]);
      const rows = wb.getWorksheet('Indicateurs')!;
      expect(rows.getRow(1).values).toEqual([
        undefined,
        'Section',
        'Indicateur',
        'Valeur',
        'Unité',
      ]);
      const revenue = rows
        .getRows(2, rows.rowCount)!
        .find((r) => r.getCell(2).value === "Chiffre d'affaires")!;
      expect(revenue.getCell(3).value).toBe(3970000);
      const zoo = await http()
        .get('/api/reports/zootechnique')
        .query({ from: '2026-10-01', to: '2026-10-31', format: 'xlsx' })
        .set(admin)
        .buffer(true)
        .parse(binary)
        .expect(200);
      const wb2 = new Workbook();
      await wb2.xlsx.load(zoo.body as ArrayBuffer);
      expect(wb2.worksheets.map((w) => w.name)).toEqual([
        'Indicateurs',
        'Performances des lots',
        'Rentabilité des lots',
      ]);
    });

    it('leaves a gated section out of both files', async () => {
      const h = await as('RESP_AVICOLE');
      const csv = await http()
        .get('/api/reports/mensuel')
        .query({ date: '2026-10-15', format: 'csv' })
        .set(h)
        .expect(200);
      expect(csv.text).not.toContain('Finance');
      expect(csv.text).not.toContain('Production porcine');
      const xlsx = await http()
        .get('/api/reports/mensuel')
        .query({ date: '2026-10-15', format: 'xlsx' })
        .set(h)
        .buffer(true)
        .parse(binary)
        .expect(200);
      const wb = new Workbook();
      await wb.xlsx.load(xlsx.body as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Indicateurs']);
      await http()
        .get('/api/reports/sanitaire')
        .query({ format: 'csv' })
        .set(accountant)
        .expect(403);
    });
  });

  /* ------------------------------------------------------- query counts */

  describe('query counts', () => {
    it('does not grow with the number of lots (3 then 30)', async () => {
      const q = { from: '2026-10-01', to: '2026-10-31' };
      const count = (type: string, query: Record<string, string>) =>
        countQueries(app, async () => {
          await http()
            .get(`/api/reports/${type}`)
            .query(query)
            .set(admin)
            .expect(200);
        });
      const before = {
        zoo: await count('zootechnique', q),
        san: await count('sanitaire', q),
        month: await count('mensuel', { date: '2026-10-15' }),
        synth: await count('synthese', {}),
      };
      const lots = await prisma.animalBatch.count({
        where: { farmId: world.farmId },
      });
      for (let i = 0; i < 27; i++) {
        const id = await mkLot(
          `LX-${i}`,
          100,
          '2026-10-03',
          i % 3 === 0
            ? {
                species: 'PORCIN',
                type: 'ENGRAISSEMENT',
                buildingId: world.pigBld,
              }
            : {},
        );
        await event(id, '2026-10-12', 'MORTALITE', 1);
        await eggs(id, '2026-10-21', 50);
        await prisma.feedDistribution.create({
          data: {
            farmId: world.farmId,
            batchId: id,
            feedProductId: productId,
            date: D('2026-10-15'),
            quantityKg: 10,
            unitCost: 300,
            cost: 3000,
          },
        });
        await prisma.healthAct.create({
          data: {
            farmId: world.farmId,
            type: 'VACCINATION',
            date: D('2026-10-14'),
            batchId: id,
            createdById: userId,
            status: 'REALISE',
            doneDate: D('2026-10-14'),
            withdrawalDays: 30,
          },
        });
        await prisma.weighing.createMany({
          data: [
            {
              farmId: world.farmId,
              batchId: id,
              date: D('2026-10-04'),
              sampleSize: 5,
              averageWeightG: 40,
            },
            {
              farmId: world.farmId,
              batchId: id,
              date: D('2026-10-21'),
              sampleSize: 5,
              averageWeightG: 700,
            },
          ],
        });
      }
      expect(
        await prisma.animalBatch.count({ where: { farmId: world.farmId } }),
      ).toBe(lots + 27);
      expect({
        zoo: await count('zootechnique', q),
        san: await count('sanitaire', q),
        month: await count('mensuel', { date: '2026-10-15' }),
        synth: await count('synthese', {}),
      }).toEqual(before);
      const r = await report('zootechnique', q);
      expect(section(r, 'performances')!.table!.rows).toHaveLength(7 + 27);
    });
  });

  /* ------------------------------------------------------------ farms */

  describe('farms', () => {
    it('is the farm in view, or every farm of the user under all', async () => {
      const other = (await createFarm(world.orgId, 'Ferme B')).id;
      const site = await prisma.site.create({
        data: { farmId: other, name: 'Site B' },
      });
      const bld = await prisma.building.create({
        data: {
          farmId: other,
          siteId: site.id,
          name: 'PB',
          type: 'AVICOLE',
          capacity: 5000,
        },
      });
      const b = await prisma.animalBatch.create({
        data: {
          farmId: other,
          buildingId: bld.id,
          code: 'LB-1',
          species: 'AVICOLE',
          type: 'PONDEUSE',
          entryDate: D('2026-09-01'),
          initialCount: 1000,
        },
      });
      await eggs(b.id, '2026-10-22', 700, 0, other);
      const user = await createUser({
        organizationId: world.orgId,
        role: 'SUPER_ADMIN',
        farmIds: [world.farmId, other],
      });
      const token = `Bearer ${await tokenFor(user.id)}`;
      const on = (farm: string): Headers => ({
        Authorization: token,
        'X-Farm-Id': farm,
      });
      const a = await report(
        'quotidien',
        { date: '2026-10-22' },
        on(world.farmId),
      );
      const bOnly = await report(
        'quotidien',
        { date: '2026-10-22' },
        on(other),
      );
      const all = await report('quotidien', { date: '2026-10-22' }, on('all'));
      expect(a.farmName).toBe('Ferme A');
      expect(bOnly.farmName).toBe('Ferme B');
      expect(all.farmName).toBe('Toutes les fermes');
      expect(figure(a, 'avicole', 'collected')).toBe(2480);
      expect(figure(bOnly, 'avicole', 'collected')).toBe(700);
      expect(figure(all, 'avicole', 'collected')).toBe(3180);
      expect(figure(all, 'avicole', 'laying')).toBe(
        Math.round(((2480 + 700) * 1000) / (2850 + 1000)) / 10,
      );
      // the consolidated finance section is the consolidated summary
      const month = await report('mensuel', { date: '2026-10-15' }, on('all'));
      const summary = (
        await http()
          .get('/api/finance/summary')
          .query({ from: '2026-10-01', to: '2026-10-31' })
          .set(on('all'))
          .expect(200)
      ).body as Summary;
      expect(figure(month, 'finance', 'revenue')).toBe(summary.revenue);
      // a farm the user cannot see
      const stranger = (await createFarm(world.orgId, 'Ferme C')).id;
      const director2 = await createUser({
        organizationId: world.orgId,
        role: 'DIRECTEUR_FERME',
        farmIds: [world.farmId],
      });
      await http()
        .get('/api/reports/synthese')
        .set({
          Authorization: `Bearer ${await tokenFor(director2.id)}`,
          'X-Farm-Id': stranger,
        })
        .expect(403);
      expect(await batchCode(b.id)).toBe('LB-1');
    });
  });

  /* ------------------------------------------------------ the state at the end day */

  describe('state at the end day', () => {
    it('counts an act planned for 28/10 and done on 05/11 late in October, not at 05/11', async () => {
      const late = async (to: string) =>
        figure(
          await report('sanitaire', { from: '2026-10-01', to }),
          'sante',
          'overdue',
        );
      expect(await late('2026-10-31')).toBe(3); // 20/10, 28/10 (done since) and 31/10
      expect(await late('2026-10-28')).toBe(2); // 20/10 and 28/10: late at the end of its day
      expect(await late('2026-11-05')).toBe(3); // 20/10, 31/10 and 05/11 still planned; 28/10 was done that day
    });

    it('does not look at the lot current status for a past period', async () => {
      const closed = await mkLot('LC-CLOSED', 10, '2026-09-01', {
        status: 'CLOTURE',
        closedAt: new Date('2026-11-10T10:00:00Z'),
      });
      const act = await prisma.healthAct.create({
        data: {
          farmId: world.farmId,
          type: 'VACCINATION',
          date: D('2026-10-27'),
          batchId: closed,
          createdById: userId,
        },
      });
      const late = async (to: string) =>
        figure(
          await report('sanitaire', { from: '2026-10-01', to }),
          'sante',
          'overdue',
        );
      expect(await late('2026-10-31')).toBe(4);
      // today the lot is closed: the health list does not call the act late
      const today = new Date().toISOString().slice(0, 10);
      expect(await late(today)).toBe(3);
      await prisma.healthAct.delete({ where: { id: act.id } });
      await prisma.animalBatch.delete({ where: { id: closed } });
    });

    it('does not count an act planned on a lot closed before the end day, in any period', async () => {
      const closed = await mkLot('LC-CLOSED2', 10, '2026-09-01', {
        status: 'CLOTURE',
        closedAt: new Date('2026-10-15T10:00:00Z'),
      });
      const act = await prisma.healthAct.create({
        data: {
          farmId: world.farmId,
          type: 'VACCINATION',
          date: D('2026-10-20'),
          batchId: closed,
          createdById: userId,
        },
      });
      const late = async (to: string) =>
        figure(
          await report('sanitaire', { from: '2026-10-01', to }),
          'sante',
          'overdue',
        );
      expect(await late('2026-10-31')).toBe(3);
      expect(await late('2026-11-05')).toBe(3);
      expect(await late(new Date().toISOString().slice(0, 10))).toBe(3);
      await prisma.healthAct.delete({ where: { id: act.id } });
      await prisma.animalBatch.delete({ where: { id: closed } });
    });

    it('answers an empty report, not a 500, when no farm is in view', async () => {
      const health = app.get(HealthReport);
      const day = D('2026-10-31');
      const none = {
        user: { id: userId, role: 'DIRECTEUR_FERME' },
        farmId: null,
        allFarms: false,
        farmIds: [],
      } as unknown as RequestContext;
      expect(await health.withdrawalsAt(none, day)).toEqual([]);
      expect(await health.periodFigures(none, day, day)).toMatchObject({
        overdueAtEnd: 0,
        openQuarantines: 0,
      });
    });

    it('does not count an animal registered after the day in a past headcount', async () => {
      const at = async (day: string) =>
        figure(await report('quotidien', { date: day }), 'porcine', 'pigs');
      const before = (await at('2026-10-31')) as number;
      const animal = await prisma.animal.create({
        data: {
          farmId: world.farmId,
          tag: 'TR-NEW',
          category: 'TRUIE',
          sex: 'F',
          buildingId: world.pigBld,
        },
      });
      expect(await at('2026-10-31')).toBe(before); // no birth date: counted from its registration day (today)
      const today = new Date().toISOString().slice(0, 10);
      expect(
        figure(await report('quotidien', { date: today }), 'porcine', 'pigs'),
      ).toBe(before + 1 + 0);
      await prisma.animal.delete({ where: { id: animal.id } });
    });
  });
});
