import type { RequestContext } from '../../access/decorators';
import type { Species } from '../../generated/prisma/enums';
import { speciesModule } from '../../herd/species';
import { mortalityRate, ratio } from '../indicators';
import type { AlertItem, AlertRule, AlertSettings } from './alert.types';

const DAY_MS = 86_400_000;
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
}

export interface Gestation {
  id: string;
  sowTag: string;
  /** `YYYY-MM-DD`. */
  expectedFarrowingDate: string;
}

export interface ConsumptionSeries {
  kind: 'feed' | 'water';
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
 * Cumulative rate ≥ `mortalityCumulPct` is A_VOIR; a day within the last two
 * with deaths ≥ `mortalityDailyPct` of the live count is URGENT. A lot raises
 * one alert, the URGENT one when both fire. Rates are compared as displayed
 * (one decimal).
 */
export function mortalityAlerts(
  lots: MortalityLot[],
  settings: AlertSettings,
): AlertItem[] {
  const alerts: AlertItem[] = [];
  for (const lot of lots) {
    const base = {
      key: `mortality:${lot.id}`,
      title: `Mortalité élevée ${lot.code}`,
      module: speciesModule(lot.species),
    };
    const bad = lot.recentDays
      .map((d) => ({ ...d, rate: mortalityRate(d.deaths, d.liveAtStart) }))
      .filter((d) => d.rate !== null && d.rate >= settings.mortalityDailyPct)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (bad) {
      alerts.push({
        ...base,
        detail: `${bad.deaths} morts le ${bad.date} (${bad.rate}% de l'effectif)`,
        level: 'URGENT',
      });
      continue;
    }
    const rate = mortalityRate(lot.deaths, lot.initialCount);
    if (rate !== null && rate >= settings.mortalityCumulPct) {
      alerts.push({
        ...base,
        detail: `${rate}% sur ${lot.initialCount} sujets`,
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
  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (const r of records) {
    const days = Math.round(
      (new Date(r.expectedFarrowingDate).getTime() - todayMs) / DAY_MS,
    );
    const base = {
      key: `farrowing:${r.id}`,
      title: `Mise bas ${r.sowTag}`,
      module: 'reproduction',
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
    if (average <= 0) continue;
    const deviation = (Math.abs(s.value - average) / average) * 100;
    if (deviation < settings.consumptionDeviationPct) continue;
    const [x, y] = [ratio(s.value, 1), ratio(average, 1)];
    alerts.push({
      key: `consumption:${s.targetId}:${s.date}:${s.kind}`,
      title: `Consommation anormale ${s.label}`,
      detail:
        s.kind === 'feed'
          ? `Aliment : ${x} kg (moyenne ${y} kg)`
          : `Eau : ${x} L (moyenne ${y} L)`,
      level: 'A_VOIR',
      module: 'alimentation',
    });
  }
  return alerts;
}

/** The rules, in the order they rank: mortality, farrowing, consumption. */
export function productionAlertRules(
  data: AlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx, settings) =>
      mortalityAlerts(await data.mortalityLots(ctx, now()), settings),
    async (ctx, settings) =>
      farrowingAlerts(await data.gestations(ctx), settings, now()),
    async (ctx, settings) =>
      consumptionAlerts(await data.consumption(ctx, now()), settings),
  ];
}
