import { ALERT_LEVEL_ORDER, type AlertLevel } from './alert.types';

const DAY_MS = 86_400_000;

/**
 * An acknowledgement hides an alert from the user who made it while it is younger than `days` days
 * AND the alert is not worse than it was when hidden (A_VOIR hidden, now URGENT: shown again).
 */
export function hides(
  ack: { level: AlertLevel; acknowledgedAt: Date },
  current: AlertLevel,
  now: Date,
  days: number,
): boolean {
  const age = now.getTime() - ack.acknowledgedAt.getTime();
  if (age >= days * DAY_MS) return false;
  // ALERT_LEVEL_ORDER is URGENT first: a lower index is worse.
  return (
    ALERT_LEVEL_ORDER.indexOf(current) >= ALERT_LEVEL_ORDER.indexOf(ack.level)
  );
}
