import type { RequestContext } from '../../access/decorators';
import { signedDaysBetween, today } from '../../common/days';
import { stockLevel } from '../../stock/stock-level';
import { ratio } from '../indicators';
import { ALERT_LEVEL_ORDER } from './alert.types';
import type { AlertItem, AlertRule, AlertSettings } from './alert.types';

/** One article's quantity and minimum in one farm. */
export interface StockLevelRow {
  farmId: string;
  itemId: string;
  name: string;
  unit: string;
  quantity: number;
  /** The farm's minimum for the article; 0 or less means none. */
  minQty: number;
}

/** A product lot with an expiry date and something left in it. */
export interface ExpiringBatch {
  id: string;
  itemName: string;
  lotNumber: string | null;
  /** `YYYY-MM-DD`. */
  expiryDate: string;
  quantity: number;
}

/** What the rules read; the stock alerts service implements it over the database. */
export interface StockAlertData {
  levels(ctx: RequestContext): Promise<StockLevelRow[]>;
  batches(ctx: RequestContext): Promise<ExpiringBatch[]>;
}

const byLevel = (a: AlertItem, b: AlertItem): number =>
  ALERT_LEVEL_ORDER.indexOf(a.level) - ALERT_LEVEL_ORDER.indexOf(b.level);

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `Stock faible` (A_VOIR) / `Stock critique` (URGENT) from `stockLevel`, the
 * one place that decides the level; an article without minimum raises nothing.
 * URGENT first, then by article name.
 */
export function stockLevelAlerts(rows: StockLevelRow[]): AlertItem[] {
  const alerts: { alert: AlertItem; name: string }[] = [];
  for (const r of rows) {
    const level = stockLevel(r.quantity, r.minQty);
    if (level === 'ok') continue;
    alerts.push({
      name: r.name,
      alert: {
        key: `stock:${r.farmId}:${r.itemId}`,
        title: `${level === 'critique' ? 'Stock critique' : 'Stock faible'} : ${r.name}`,
        detail: `${ratio(r.quantity, 1)} ${r.unit} (seuil ${ratio(r.minQty, 1)})`,
        level: level === 'critique' ? 'URGENT' : 'A_VOIR',
        module: 'stocks',
        modules: ['stocks'],
      },
    });
  }
  return alerts
    .sort(
      (a, b) =>
        byLevel(a.alert, b.alert) ||
        compare(a.name, b.name) ||
        compare(a.alert.key, b.alert.key),
    )
    .map((a) => a.alert);
}

/**
 * A lot expiring from today up to and including `expiryWarningDays` days
 * ahead is A_VOIR; one whose expiry date is before today, URGENT; an empty
 * lot raises nothing. URGENT first, then by expiry date and article.
 */
export function expiryAlerts(
  batches: ExpiringBatch[],
  settings: AlertSettings,
  now: Date,
): AlertItem[] {
  const start = today(now);
  const alerts: { alert: AlertItem; batch: ExpiringBatch }[] = [];
  for (const b of batches) {
    if (b.quantity <= 0) continue;
    const days = signedDaysBetween(start, new Date(b.expiryDate));
    const lot = `Lot ${b.lotNumber ?? 'sans numéro'}`;
    const base = {
      key: `expiry:${b.id}`,
      module: 'stocks' as const,
      modules: ['stocks'] as AlertItem['modules'],
    };
    if (days < 0) {
      alerts.push({
        batch: b,
        alert: {
          ...base,
          title: `Produit périmé : ${b.itemName}`,
          detail: `${lot} — expiré le ${b.expiryDate}`,
          level: 'URGENT',
        },
      });
    } else if (days <= settings.expiryWarningDays) {
      alerts.push({
        batch: b,
        alert: {
          ...base,
          title: `Produit bientôt périmé : ${b.itemName}`,
          detail: `${lot} — expire le ${b.expiryDate}`,
          level: 'A_VOIR',
        },
      });
    }
  }
  return alerts
    .sort(
      (a, b) =>
        byLevel(a.alert, b.alert) ||
        compare(a.batch.expiryDate, b.batch.expiryDate) ||
        compare(a.batch.itemName, b.batch.itemName) ||
        compare(a.batch.id, b.batch.id),
    )
    .map((a) => a.alert);
}

/** The rules, in the order they rank: stock level, expiry. */
export function stockAlertRules(
  data: StockAlertData,
  now: () => Date = () => new Date(),
): AlertRule[] {
  return [
    async (ctx) => stockLevelAlerts(await data.levels(ctx)),
    async (ctx, settings) =>
      expiryAlerts(await data.batches(ctx), settings, now()),
  ];
}
