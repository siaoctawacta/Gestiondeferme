import { BadRequestException } from '@nestjs/common';
import { parseDay, requireDay, today } from '../common/days';

export const PERIOD_ORDER = 'La date de début est après la date de fin';

/** `from` / `to` as calendar days (both bounds inclusive, either may be open); a 400 when they are inverted. */
export function periodOf(
  from?: string,
  to?: string,
): { from?: Date; to?: Date } {
  const period = {
    from: from ? requireDay(from) : undefined,
    to: to ? requireDay(to) : undefined,
  };
  if (period.from && period.to && period.from.getTime() > period.to.getTime()) {
    throw new BadRequestException(PERIOD_ORDER);
  }
  return period;
}

/** The first day of the month of `day` to `day` itself (« Rentabilité du mois »: the calendar month to date). */
export function monthToDate(day: Date = today()): { from: Date; to: Date } {
  const from = parseDay(
    `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-01`,
  );
  return { from: from as Date, to: day };
}
