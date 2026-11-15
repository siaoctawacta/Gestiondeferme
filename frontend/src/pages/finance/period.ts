import { todayIso } from '../../lib/format';

/** First day of the current month to today: the period every finance tab starts with (and shows in its inputs). */
export const monthToDate = (): Record<string, string> => ({ from: `${todayIso().slice(0, 8)}01`, to: todayIso() });

/** A start after the end is refused before any request; an empty bound is open. */
export const periodError = (v: Record<string, string>): string | null =>
  v.from && v.to && v.from > v.to ? 'La date de début est après la date de fin' : null;
