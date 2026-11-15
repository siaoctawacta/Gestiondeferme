import type { RequestContext } from '../../access/decorators';
import type { Species } from '../../generated/prisma/enums';
import { speciesModule } from '../../herd/species';
import { signedDaysBetween, today } from '../../common/days';
import { mortalityRate, ratio } from '../indicators';
import type {
  AlertItem,
  AlertModules,
  AlertRule,
  AlertSettings,
} from './alert.types';

/** Consumption needs this many earlier days with records before it can be judged. */
export const MIN_PRIOR_DAYS = 3;

/** A day of deaths in an open lot, with the live count at the start of that day. */
export interface DeathDay {
  date: string;
  deaths: number;
  liveAtStart: number;
}

export interface MortalityLot {
  id: string;
  code: string;
  species: Species;
  initialCount: number;
  /** Every death since the lot entered. */
  deaths: number;
  /** Days with deaths among today and yesterday. */
  recentDays: DeathDay[];
  /**
   * Set on a lot a farrowing created. Until it is weaned its pre-weaning loss
   * (about one piglet in ten is normal) is followed through the breeding
   * figures (nés vivants / sevrés), not through mortality alerts.
   */
  litter?: { weaned: boolean };
}

export interface Gestation {
  id: string;
  sowTag: string;
  /** `YYYY-MM-DD`. */
  expectedFarrowingDate: string;
}

export interface ConsumptionSeries {
  kind: 'feed' | 'water';
  /** What the series belongs to: a lot (of `species`) or a building (no species). */
  target: 'LOT' | 'BATIMENT';
  species?: Species;
  targetId: string;
  /** Lot code or building name. */
  label: string;
  /** Latest recorded day, `YYYY-MM-DD`. */
  date: string;
  /** The target's total that day. */
  value: number;
  /** Totals of the target's earlier days (within the previous 7) that have records. */
  previous: number[];
}

/** What the rules read; the indicators service implements it over the database. */
export interface AlertData {
  mortalityLots(ctx: RequestContext, now: Date): Promise<MortalityLot[]>;
  gestations(ctx: RequestContext): Promise<Gestation[]>;
  consumption(ctx: RequestContext, now: Date): Promise<ConsumptionSeries[]>;
}

/**
 * `part / whole × 100 ≥ pct` on the raw values, so a rate that only reaches the
 * threshold once rounded for display does not count.
 */
const reaches = (part: number, whole: number, pct: number): boolean =>
  whole > 0 && part * 100 >= pct * whole;

/**
 * Cumulative rate ≥ `mortalityCumulPct` is A_VOIR; a day within the last two
 * with deaths ≥ `mortalityDailyPct` of the live count is URGENT. A lot raises
 * one alert, the URGENT one when both fire. Thresholds are compared on the
 * raw rate; the rounded one (one decimal) only appears in the text.
 * A litter lot that is not weaned yet is skipped (see `MortalityLot.litter`).
 */
export function mortalityAlerts(
  lots: MortalityLot[],
  settings: AlertSettings,
): AlertItem[] {
  const alerts: AlertItem[] = [];
  for (const lot of lots) {
    if (lot.litter && !lot.litter.weaned) continue;
    const module = speciesModule(lot.species);
    const base: Pick<AlertItem, 'key' | 'title' | 'module' | 'modules'> = {
      key: `mortality:${lot.id}`,
      title: `Mortalité élevée ${lot.code}`,
      module,
      modules: [module],
    };
    const bad = lot.recentDays
      .filter((d) =>
        reaches(d.deaths, d.liveAtStart, settings.mortalityDailyPct),
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (bad) {
      alerts.push({
        ...base,
        detail: `${bad.deaths} morts le ${bad.date} (${mortalityRate(bad.deaths, bad.liveAtStart)}% de l'effectif)`,
        level: 'URGENT',
      });
      continue;
    }
    if (reaches(lot.deaths, lot.initialCount, settings.mortalityCumulPct)) {
      alerts.push({
        ...base,
        detail: `${mortalityRate(lot.deaths, lot.initialCount)}% sur ${lot.initialCount} sujets`,
        level: 'A_VOIR',
      });
    }
  }
  return alerts;
}

/** Gestations due within `farrowingWarningDays` are A_VOIR (the due day included); overdue ones, from the next day, URGENT. */
export function farrowingAlerts(
  records: Gestation[],
  settings: AlertSettings,
  now: Date,
): AlertItem[] {
  const alerts: AlertItem[] = [];
  const start = today(now);
  for (const r of records) {
    const due = new Date(r.expectedFarrowingDate);
    const days = signedDaysBetween(start, due);
    const base: Pick<AlertItem, 'key' | 'title' | 'module' | 'modules'> = {
      key: `farrowing:${r.id}`,
      title: `Mise bas ${r.sowTag}`,
      module: 'reproduction',
      modules: ['reproduction'],
    };
    if (days < 0) {
      alerts.push({
        ...base,
        detail: `Dépassée depuis ${-days} j (${r.expectedFarrowingDate})`,
        level: 'URGENT',
      });
    } else if (days <= settings.farrowingWarningDays) {
      alerts.push({
        ...base,
        detail: `Prévue dans ${days} j (${r.expectedFarrowingDate})`,
        level: 'A_VOIR',
      });
    }
  }
  return alerts;
}

/** A day's total deviating from the average of the earlier days by at least `consumptionDeviationPct`, either way. */
export function consumptionAlerts(
  series: ConsumptionSeries[],
  settings: AlertSettings,
): AlertItem[] {
  const alerts: AlertItem[] = [];
  for (const s of series) {
    if (s.previous.length < MIN_PRIOR_DAYS) continue;
    const average = s.previous.reduce((a, b) => a + b, 0) / s.previous.length;
    // A zero average gives no reference to deviate from: no alert (thresholds
    // are validated > 0 by the settings service, so there is no zero case to guard).
    if (average <= 0) continue;
    if (
      !reaches(
        Math.abs(s.value - average),
        average,
        settings.consumptionDeviationPct,
      )
    ) {
      continue;
    }
    const [x, y] = [ratio(s.value, 1), ratio(average, 1)];
    // A lot's consumption is only visible to roles that also read its species.
    const modules: AlertModules =
      s.target === 'LOT' && s.species
        ? ['alimentation', speciesModule(s.species)]
        : ['alimentation'];
    alerts.push({
      key: `consumption:${s.targetId}:${s.date}:${s.kind}`,
      title: `Consommation anormale ${s.label}`,
      detail:
        s.kind === 'feed'
          ? `Aliment : ${x} kg (moyenne ${y} kg)`
          : `Eau : ${x} L (moyenne ${y} L)`,
      level: 'A_VOIR',
      module: 'alimentation',
      modules,
    });
  }
  return alerts;
}

const byKey = (items: AlertItem[]): AlertItem[] =>
  items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** The rules, in the order they rank: mortality, farrowing, consumption; each returns its alerts by key. */
export function productionAlertRules(
  data: AlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx, settings) =>
      byKey(mortalityAlerts(await data.mortalityLots(ctx, now()), settings)),
    async (ctx, settings) =>
      byKey(farrowingAlerts(await data.gestations(ctx), settings, now())),
    async (ctx, settings) =>
      byKey(consumptionAlerts(await data.consumption(ctx, now()), settings)),
  ];
}
