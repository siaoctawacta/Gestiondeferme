import { BadRequestException } from '@nestjs/common';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export const FUTURE_DATE = 'La date ne peut pas être dans le futur';
export const BEFORE_ENTRY = "La date est antérieure à l'entrée du lot";

/** `YYYY-MM-DD` → that calendar day at 00:00 UTC (how Prisma stores a DATE), or null when it is not a real date. */
export function parseDay(value: string): Date | null {
  const m = DAY.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

/** Like `parseDay`, but a 400 when the text is not a calendar date. */
export function requireDay(value: string): Date {
  const day = parseDay(value);
  if (!day) throw new BadRequestException('Date invalide (AAAA-MM-JJ)');
  return day;
}

export const formatDay = (date: Date): string =>
  date.toISOString().slice(0, 10);

/** The server's current UTC calendar day. */
export function today(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function assertNotFuture(date: Date): void {
  if (date.getTime() > today().getTime()) {
    throw new BadRequestException(FUTURE_DATE);
  }
}

/** Whole days from `from` to `to` (both calendar days, `to` defaults to today). */
export function daysBetween(from: Date, to: Date = today()): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
}

export function assertNotBeforeEntry(entryDate: Date, date: Date): void {
  if (date.getTime() < entryDate.getTime()) {
    throw new BadRequestException(BEFORE_ENTRY);
  }
}
