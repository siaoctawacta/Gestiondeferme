import type { RequestContext } from '../../access/decorators';

export const ALERT_LEVEL_ORDER = ['URGENT', 'A_VOIR'] as const;
export type AlertLevel = (typeof ALERT_LEVEL_ORDER)[number];

export interface AlertItem {
  /** Stable across requests for the same condition. */
  key: string;
  title: string;
  detail: string;
  level: AlertLevel;
  /** Permission module the alert belongs to. */
  module: string;
}

/** Thresholds read once per request from the organisation's settings. */
export interface AlertSettings {
  mortalityDailyPct: number;
  mortalityCumulPct: number;
  consumptionDeviationPct: number;
  farrowingWarningDays: number;
}

export const ALERT_SETTING_KEYS: (keyof AlertSettings)[] = [
  'mortalityDailyPct',
  'mortalityCumulPct',
  'consumptionDeviationPct',
  'farrowingWarningDays',
];

export type AlertRule = (
  ctx: RequestContext,
  settings: AlertSettings,
) => Promise<AlertItem[]>;
