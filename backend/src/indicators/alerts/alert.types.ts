import type { RequestContext } from '../../access/decorators';
import type { ModuleKey } from '../../access/permissions';

export const ALERT_LEVEL_ORDER = ['URGENT', 'A_VOIR'] as const;
export type AlertLevel = (typeof ALERT_LEVEL_ORDER)[number];

/**
 * The place of a module's rules among the others, whatever the order the
 * modules were initialised in (the reference alerts screen lists the stock
 * alerts before the mortality ones).
 */
export const ALERT_RANK = {
  STOCK: 10,
  PRODUCTION: 20,
  HEALTH: 30,
  TASKS: 40,
  EQUIPMENT: 50,
  SALES: 60,
} as const;
export type AlertRank = (typeof ALERT_RANK)[keyof typeof ALERT_RANK];

/** At least one module: an alert nobody can be said to read is shown to no one. */
export type AlertModules = [ModuleKey, ...ModuleKey[]];

export interface AlertItem {
  /** Stable across requests for the same condition. */
  key: string;
  title: string;
  detail: string;
  level: AlertLevel;
  /** The primary module of the alert, the one the screens file it under. */
  module: ModuleKey;
  /**
   * Every module the role must be able to read to see the alert: the primary
   * one, plus the species module when the alert names a lot of that species.
   */
  modules: AlertModules;
}

/**
 * Thresholds read once per request from the organisation's settings: every
 * numeric setting, by key, with its default. A rule reads the keys it needs,
 * so a new rule adds a setting without touching this type.
 */
export type AlertSettings = Record<string, number>;

/**
 * A rule returns its alerts in a total, deterministic order (level, then its
 * own sort keys ending on the key or id): the registry keeps that order, so
 * the response never depends on the order the database returned rows in.
 */
export type AlertRule = (
  ctx: RequestContext,
  settings: AlertSettings,
) => Promise<AlertItem[]>;

/** An alert detail with the farm's name appended, for requests that span several farms. */
export const withFarm = (detail: string, farmName?: string): string =>
  farmName ? `${detail} — ${farmName}` : detail;
