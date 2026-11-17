import { todayIso } from '../../lib/format';

/** First day of the current month to today: the period `Synthèse` starts with when none is chosen (and shows in its inputs). */
export const monthToDate = (): Record<string, string> => ({ from: `${todayIso().slice(0, 8)}01`, to: todayIso() });

/**
 * A period is either both bounds or none (the entries list opens on all dates): half a period, or a start after the end,
 * is refused before any request.
 */
export const periodError = (v: Record<string, string>): string | null => {
  if (!v.from && !v.to) return null;
  if (!v.from || !v.to) return 'Indiquez les deux dates';
  return v.from > v.to ? 'La date de début est après la date de fin' : null;
};
