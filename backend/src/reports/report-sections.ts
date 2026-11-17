import type { RequestContext } from '../access/decorators';
import { can, type ModuleKey } from '../access/permissions';
import type { Role } from '../access/roles';
import { addDays, formatDay } from '../common/days';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { FarmKpisService } from '../dashboard/farm-kpis.service';
import type { EggProductionService } from '../eggs/egg-production.service';
import type { EquipmentReads } from '../equipment/equipment-reads.service';
import type { FinanceSummaryService } from '../finance/finance-summary.service';
import type { LotProfitabilityService } from '../finance/lot-profitability.service';
import type { FeedService } from '../feed/feed.service';
import type { Species } from '../generated/prisma/enums';
import type { BreedingService } from '../breeding/breeding.service';
import type { HealthReport } from '../health/health-report';
import { TYPE_LABEL, type BatchesService } from '../herd/batches.service';
import type { HerdLedgerService } from '../herd/herd-ledger.service';
import { layingRate } from '../indicators/indicators';
import type { IndicatorsService } from '../indicators/indicators.service';
import type { HerdListService } from '../pigs/herd-list.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PaymentsJournal } from '../sales/payments-journal';
import type { StockOverviewService } from '../stock/stock-overview.service';
import type { TaskReads } from '../tasks/task-reads.service';
import { frenchDay, type Period, type ReportType } from './report-periods';
import type { ReportRow, ReportSection, ReportUnit } from './report.types';

/** Every reader a section may use: each is the function that already serves a screen or the dashboard. */
export interface ReportReaders {
  prisma: PrismaService;
  kpis: FarmKpisService;
  dashboard: DashboardService;
  eggs: EggProductionService;
  feed: FeedService;
  ledger: HerdLedgerService;
  herd: HerdListService;
  breeding: BreedingService;
  batches: BatchesService;
  indicators: IndicatorsService;
  stock: StockOverviewService;
  health: HealthReport;
  tasks: TaskReads;
  equipment: EquipmentReads;
  finance: FinanceSummaryService;
  lotProfit: LotProfitabilityService;
  payments: PaymentsJournal;
}

export interface SectionEnv {
  ctx: RequestContext;
  period: Period;
  readers: ReportReaders;
  /** Loads once per request however many sections ask for it. */
  once<T>(key: string, load: () => Promise<T>): Promise<T>;
}

export interface SectionDef {
  key: string;
  /** What the role must be able to read to see the section; a section it cannot see is left out of the report and of its files. */
  allowed(role: Role): boolean;
  build(env: SectionEnv): Promise<ReportSection>;
}

const row = (
  key: string,
  label: string,
  value: number | null,
  unit: ReportUnit = '',
): ReportRow => ({ key, label, value, unit });

const reads = (module: ModuleKey) => (role: Role) => can(role, module, 'read');
const readsAny =
  (...modules: ModuleKey[]) =>
  (role: Role) =>
    modules.some((m) => can(role, m, 'read'));

/* ------------------------------------------------------------------ shared */

interface PeriodLot {
  id: string;
  code: string;
  species: Species;
  type: keyof typeof TYPE_LABEL;
  entryDate: Date;
  closedAt: Date | null;
  initialCount: number;
}

/** The lots open at some point of the period (entered by its end, still open or closed after its start). One query. */
const periodLots = (env: SectionEnv): Promise<PeriodLot[]> =>
  env.once('lots', () =>
    env.readers.prisma.animalBatch.findMany({
      where: {
        farmId: { in: env.ctx.farmIds },
        entryDate: { lte: env.period.to },
        OR: [{ status: 'EN_COURS' }, { closedAt: { gte: env.period.from } }],
      },
      select: {
        id: true,
        code: true,
        species: true,
        type: true,
        entryDate: true,
        closedAt: true,
        initialCount: true,
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    }),
  );

/** Still open at the end of `day`. */
const openAt = (lot: PeriodLot, day: Date): boolean =>
  lot.closedAt === null || lot.closedAt.getTime() >= addDays(day, 1).getTime();

/** The species of lots the role may read. */
const speciesRead = (role: Role): Species[] => [
  ...(can(role, 'lots', 'read') ? (['AVICOLE'] as const) : []),
  ...(can(role, 'porcs', 'read') ? (['PORCIN'] as const) : []),
];

const money = (env: SectionEnv) =>
  env.once('summary', () =>
    env.readers.finance.summary(
      env.ctx,
      { from: formatDay(env.period.from), to: formatDay(env.period.to) },
      { byFarm: false },
    ),
  );

/* ---------------------------------------------------------- the sections */

const avicole: SectionDef = {
  key: 'avicole',
  allowed: reads('lots'),
  async build(env) {
    const { readers: r, ctx, period } = env;
    const { from, to } = period;
    const lots = (await periodLots(env)).filter((l) => l.species === 'AVICOLE');
    const open = lots.filter((l) => openAt(l, to));
    const [alive, totals, eggs] = await Promise.all([
      r.ledger.liveCounts(
        open.map((l) => l.id),
        to,
      ),
      r.ledger.eventTotals(
        lots.map((l) => l.id),
        from,
        to,
      ),
      r.eggs.periodFigures(ctx.farmIds, from, to),
    ]);
    const sum = (pick: (t: Record<string, number>) => number) =>
      [...totals.values()].reduce((n, t) => n + pick(t), 0);
    const entered = lots
      .filter(
        (l) =>
          l.entryDate.getTime() >= from.getTime() &&
          l.entryDate.getTime() <= to.getTime(),
      )
      .reduce((n, l) => n + l.initialCount, 0);
    const at = `(au ${frenchDay(to)})`;
    return {
      key: 'avicole',
      title: 'Production avicole',
      rows: [
        row('lots', `Lots en cours ${at}`, open.length),
        row(
          'alive',
          `Volailles vivantes ${at}`,
          [...alive.values()].reduce((a, b) => a + b, 0),
        ),
        row('entries', 'Entrées', entered + sum((t) => t.ENTREE)),
        row(
          'deaths',
          'Morts',
          sum((t) => t.MORTALITE),
        ),
        row(
          'sales',
          'Ventes',
          sum((t) => t.VENTE),
        ),
        row(
          'culls',
          'Réformes',
          sum((t) => t.REFORME),
        ),
        row('collected', 'Œufs collectés', eggs.collected),
        row('marketable', 'Œufs commercialisables', eggs.marketable),
        row(
          'laying',
          'Taux de ponte moyen',
          layingRate(eggs.collected, eggs.henDays),
          '%',
        ),
      ],
    };
  },
};

/** The sow and boar figures: services, farrowings, piglets born and weaned. */
async function reproductionRows(env: SectionEnv): Promise<ReportRow[]> {
  const f = await env.readers.breeding.periodFigures(
    env.ctx.farmIds,
    env.period.from,
    env.period.to,
  );
  return [
    row('services', 'Saillies', f.services),
    row('farrowings', 'Mises bas', f.farrowings),
    row('bornAlive', 'Nés vivants', f.bornAlive),
    row('stillborn', 'Mort-nés', f.stillborn),
    row('weaned', 'Sevrés', f.weaned),
  ];
}

const porcine: SectionDef = {
  key: 'porcine',
  allowed: reads('porcs'),
  async build(env) {
    const { readers: r, ctx, period } = env;
    const { from, to } = period;
    const lots = (await periodLots(env)).filter((l) => l.species === 'PORCIN');
    const [pigs, totals, exits, reproduction] = await Promise.all([
      r.herd.totalPigs(ctx.farmIds, to),
      r.ledger.eventTotals(
        lots.map((l) => l.id),
        from,
        to,
      ),
      r.herd.animalExits(ctx.farmIds, from, to),
      reproductionRows(env),
    ]);
    const sum = (pick: (t: Record<string, number>) => number) =>
      [...totals.values()].reduce((n, t) => n + pick(t), 0);
    return {
      key: 'porcine',
      title: 'Production porcine',
      rows: [
        row('pigs', `Porcs (au ${frenchDay(to)})`, pigs),
        row('deaths', 'Morts', sum((t) => t.MORTALITE) + exits.dead),
        row('sales', 'Ventes', sum((t) => t.VENTE) + exits.sold),
        ...reproduction,
      ],
    };
  },
};

/** The reproduction rows alone, as the zootechnical report shows them. */
const reproduction: SectionDef = {
  key: 'porcine',
  allowed: reads('porcs'),
  async build(env) {
    return {
      key: 'porcine',
      title: 'Production porcine',
      rows: await reproductionRows(env),
    };
  },
};

const alimentation: SectionDef = {
  key: 'alimentation',
  allowed: reads('alimentation'),
  async build(env) {
    const f = await env.readers.feed.periodFigures(
      env.ctx.farmIds,
      env.period.from,
      env.period.to,
    );
    return {
      key: 'alimentation',
      title: 'Alimentation & eau',
      rows: [
        row('feed', 'Aliment distribué', f.feedKg, 'kg'),
        row('water', 'Eau consommée', f.waterL, 'L'),
      ],
    };
  },
};

const sante: SectionDef = {
  key: 'sante',
  allowed: reads('sante'),
  async build(env) {
    const { from, to } = env.period;
    const h = await env.readers.health.periodFigures(env.ctx.farmIds, from, to);
    return {
      key: 'sante',
      title: 'Santé',
      rows: [
        row('vaccinations', 'Vaccinations réalisées', h.done.VACCINATION),
        row('treatments', 'Traitements réalisés', h.done.TRAITEMENT),
        row('disinfections', 'Désinfections réalisées', h.done.DESINFECTION),
        row('overdue', `Actes en retard (au ${frenchDay(to)})`, h.overdueAtEnd),
        row('quarantines', 'Quarantaines en cours', h.openQuarantines),
        row('incidents', 'Incidents', h.incidents),
        row('biosecurity', 'Contrôles de biosécurité', h.biosecurityLogs),
      ],
    };
  },
};

const stocks: SectionDef = {
  key: 'stocks',
  allowed: reads('stocks'),
  async build(env) {
    const levels = await env.readers.stock.levelCounts(env.ctx);
    return {
      key: 'stocks',
      title: 'Stocks',
      rows: [
        row('low', "Articles en stock faible (aujourd'hui)", levels.faible),
        row(
          'critical',
          "Articles en stock critique (aujourd'hui)",
          levels.critique,
        ),
      ],
    };
  },
};

const taches: SectionDef = {
  key: 'taches',
  allowed: reads('taches'),
  async build(env) {
    const { from, to } = env.period;
    const t = await env.readers.tasks.periodFigures(env.ctx.farmIds, from, to);
    return {
      key: 'taches',
      title: 'Tâches',
      rows: [
        row('completed', 'Tâches terminées', t.completed),
        row('created', 'Tâches créées', t.created),
        row(
          'overdue',
          `Tâches en retard (au ${frenchDay(to)})`,
          t.overdueAtEnd,
        ),
      ],
    };
  },
};

const equipements: SectionDef = {
  key: 'equipements',
  allowed: reads('equipements'),
  async build(env) {
    const { from, to } = env.period;
    const e = await env.readers.equipment.periodFigures(
      env.ctx.farmIds,
      from,
      to,
    );
    return {
      key: 'equipements',
      title: 'Équipements',
      rows: [
        row('breakdowns', 'Pannes déclarées', e.breakdowns),
        row('interventions', 'Interventions', e.interventions),
        row('broken', "Équipements en panne (aujourd'hui)", e.broken),
      ],
    };
  },
};

const finance: SectionDef = {
  key: 'finance',
  allowed: reads('finance'),
  async build(env) {
    const { from, to } = env.period;
    const [summary, journal] = await Promise.all([
      money(env),
      env.readers.payments.periodTotals(env.ctx, from, to),
    ]);
    return {
      key: 'finance',
      title: 'Finance',
      rows: [
        row('revenue', "Chiffre d'affaires", summary.revenue, 'FCFA'),
        row('expenses', 'Dépenses', summary.expenses, 'FCFA'),
        row('margin', 'Marge', summary.margin, 'FCFA'),
        row('marginPct', 'Taux de marge', summary.marginPct, '%'),
        row('receivables', 'Créances clients', summary.receivables, 'FCFA'),
        row('received', 'Encaissements', journal.received, 'FCFA'),
        row('refunded', 'Remboursements', journal.refunded, 'FCFA'),
      ],
      cards: summary.byActivity,
      table: {
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
      },
    };
  },
};

/* ------------------------------------------------------------- synthèse */

const indicateurs: SectionDef = {
  key: 'indicateurs',
  allowed: () => true,
  async build(env) {
    const { readers: r, ctx } = env;
    const withMoney = can(ctx.user.role, 'finance', 'read');
    const [kpis, feedKg, waterL, alerts, summary] = await Promise.all([
      r.kpis.kpis(ctx.farmIds),
      r.kpis.feedDistributedKg(ctx.farmIds),
      r.kpis.waterConsumedL(ctx.farmIds),
      r.dashboard.alerts(ctx),
      withMoney ? money(env) : Promise.resolve(null),
    ]);
    return {
      key: 'indicateurs',
      title: 'Indicateurs',
      rows: [
        row('poultry', 'Volailles vivantes', kpis.poultryAlive),
        row('pigs', 'Porcs (cheptel)', kpis.pigs),
        row(
          'mortality',
          'Taux de mortalité (lots en cours)',
          kpis.mortalityRate,
          '%',
        ),
        row('eggs', 'Œufs produits (dernier jour)', kpis.eggsLastDay),
        row('laying', 'Taux de ponte', kpis.layingRate, '%'),
        row('feed', 'Aliment distribué', feedKg, 'kg'),
        row('water', 'Eau consommée', waterL, 'L'),
        ...(summary
          ? [
              row('revenue', "Chiffre d'affaires", summary.revenue, 'FCFA'),
              row('expenses', 'Dépenses', summary.expenses, 'FCFA'),
              row('margin', 'Marge indicative', summary.margin, 'FCFA'),
              row(
                'receivables',
                'Créances clients',
                summary.receivables,
                'FCFA',
              ),
            ]
          : []),
        row('alerts', 'Alertes ouvertes', alerts.total),
      ],
    };
  },
};

const activites: SectionDef = {
  key: 'activites',
  allowed: reads('finance'),
  async build(env) {
    return {
      key: 'activites',
      title: 'Activités',
      cards: (await money(env)).byActivity,
    };
  },
};

/* ------------------------------------------------------------- sanitaire */

const delais: SectionDef = {
  key: 'delais',
  allowed: reads('sante'),
  async build(env) {
    const withdrawals = await env.readers.health.withdrawalsAt(
      env.ctx.farmIds,
      env.period.to,
    );
    return {
      key: 'delais',
      title: "Délais d'attente en cours",
      table: {
        columns: [
          { key: 'target', header: 'LOT / ANIMAL' },
          { key: 'until', header: "JUSQU'AU" },
        ],
        rows: withdrawals.map((w) => ({
          target: w.target,
          until: frenchDay(w.until),
        })),
      },
    };
  },
};

const mortalite: SectionDef = {
  key: 'mortalite',
  allowed: (role) => can(role, 'sante', 'read') && speciesRead(role).length > 0,
  async build(env) {
    const { readers: r, ctx, period } = env;
    const species = speciesRead(ctx.user.role);
    const lots = (await periodLots(env)).filter((l) =>
      species.includes(l.species),
    );
    const ids = lots.map((l) => l.id);
    const [items, totals] = await Promise.all([
      r.batches.getMany(ctx, ids),
      r.ledger.eventTotals(ids, period.from, period.to),
    ]);
    const byId = new Map(items.map((i) => [i.id, i]));
    return {
      key: 'mortalite',
      title: 'Mortalité par lot',
      table: {
        columns: [
          { key: 'code', header: 'LOT' },
          { key: 'type', header: 'TYPE' },
          { key: 'deaths', header: 'MORTS (PÉRIODE)' },
          { key: 'rate', header: 'TAUX DE MORTALITÉ', unit: '%' },
        ],
        rows: lots.map((l) => ({
          code: l.code,
          type: TYPE_LABEL[l.type],
          deaths: totals.get(l.id)?.MORTALITE ?? 0,
          rate: byId.get(l.id)?.mortalityRate ?? null,
        })),
      },
    };
  },
};

/* ---------------------------------------------------------- zootechnique */

const performances: SectionDef = {
  key: 'performances',
  allowed: readsAny('lots', 'porcs'),
  async build(env) {
    const { readers: r, ctx, period } = env;
    const species = speciesRead(ctx.user.role);
    const lots = (await periodLots(env)).filter((l) =>
      species.includes(l.species),
    );
    const ids = lots.map((l) => l.id);
    const [performance, alive, eggs] = await Promise.all([
      r.indicators.batchPerformanceMany(ctx, ids),
      r.ledger.liveCounts(ids, period.to),
      r.eggs.periodFiguresByBatch(ctx.farmIds, period.from, period.to),
    ]);
    return {
      key: 'performances',
      title: 'Performances des lots',
      table: {
        columns: [
          { key: 'code', header: 'LOT' },
          { key: 'type', header: 'TYPE' },
          { key: 'age', header: 'ÂGE (J)' },
          { key: 'alive', header: 'EFFECTIF' },
          { key: 'deaths', header: 'MORTS' },
          { key: 'mortality', header: 'MORTALITÉ', unit: '%' },
          { key: 'lastWeight', header: 'DERNIER POIDS (G)' },
          { key: 'gmd', header: 'GMD (G/J)' },
          { key: 'ic', header: 'IC' },
          { key: 'laying', header: 'TAUX DE PONTE', unit: '%' },
        ],
        rows: lots.map((l) => {
          const p = performance.get(l.id);
          const e = eggs.get(l.id);
          return {
            code: l.code,
            type: TYPE_LABEL[l.type],
            age: p?.ageDays ?? null,
            alive: alive.get(l.id) ?? 0,
            deaths: p?.deaths ?? null,
            mortality: p?.mortalityRate ?? null,
            lastWeight: p?.lastWeightG ?? null,
            gmd: p?.dailyGainG ?? null,
            ic: p?.feedConversion ?? null,
            laying: e ? layingRate(e.collected, e.henDays) : null,
          };
        }),
      },
    };
  },
};

const rentabilite: SectionDef = {
  key: 'rentabilite',
  allowed: reads('finance'),
  async build(env) {
    const { readers: r, ctx, period } = env;
    const lots = await periodLots(env);
    const figures = await r.lotProfit.forLots(
      ctx,
      lots.map((l) => l.id),
      period,
    );
    return {
      key: 'rentabilite',
      title: 'Rentabilité des lots',
      table: {
        columns: [
          { key: 'code', header: 'LOT' },
          { key: 'totalCost', header: 'COÛT TOTAL', unit: 'FCFA' },
          { key: 'revenue', header: 'RECETTES', unit: 'FCFA' },
          { key: 'margin', header: 'MARGE', unit: 'FCFA' },
          { key: 'costPerAnimal', header: 'COÛT / ANIMAL', unit: 'FCFA' },
        ],
        rows: figures.map((l) => ({
          code: l.code,
          totalCost: l.totalCost,
          revenue: l.revenue,
          margin: l.margin,
          costPerAnimal: l.costPerAnimal,
        })),
      },
    };
  },
};

const PERIODIC = [
  avicole,
  porcine,
  alimentation,
  sante,
  stocks,
  taches,
  equipements,
  finance,
];

/** The sections of each type, in the order of the report; each states who may see it. */
export const REPORT_SECTIONS: Record<ReportType, SectionDef[]> = {
  synthese: [indicateurs, activites],
  quotidien: PERIODIC,
  hebdomadaire: PERIODIC,
  mensuel: PERIODIC,
  annuel: PERIODIC,
  sanitaire: [sante, delais, mortalite],
  zootechnique: [performances, reproduction, rentabilite],
};
