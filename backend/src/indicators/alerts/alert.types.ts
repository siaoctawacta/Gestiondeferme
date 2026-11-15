import type { RequestContext } from '../../access/decorators';
import type { ModuleKey } from '../../access/permissions';

export const ALERT_LEVEL_ORDER = ['URGENT', 'A_VOIR'] as const;
export type AlertLevel = (typeof ALERT_LEVEL_ORDER)[number];

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
  modules: ModuleKey[];
}

/**
 * Thresholds read once per request from the organisation's settings: every
 * numeric setting, by key, with its default. A rule reads the keys it needs,
 * so a new rule adds a setting without touching this type.
 */
export type AlertSettings = Record<string, number>;

export type AlertRule = (
  ctx: RequestContext,
  settings: AlertSettings,
) => Promise<AlertItem[]>;
