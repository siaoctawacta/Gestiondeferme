import type { Prisma } from '../generated/prisma/client';
import type { BreedingStatus } from '../generated/prisma/enums';
import {
  formatDay,
  formatDayOrNull,
  signedDaysBetween,
  today,
} from '../common/days';

export const breedingInclude = {
  sow: { select: { tag: true } },
  boar: { select: { tag: true } },
} satisfies Prisma.BreedingRecordInclude;
export type BreedingRow = Prisma.BreedingRecordGetPayload<{
  include: typeof breedingInclude;
}>;

export interface BreedingItem {
  id: string;
  sowId: string;
  sowTag: string;
  /** Boar tag, or `IA {semence}`. */
  sire: string;
  method: BreedingRow['method'];
  boarId: string | null;
  semenLabel: string | null;
  serviceDate: string;
  expectedFarrowingDate: string;
  farrowingDate: string | null;
  bornTotal: number | null;
  bornAlive: number | null;
  stillborn: number | null;
  litterBatchId: string | null;
  weaningDate: string | null;
  weanedCount: number | null;
  failureDate: string | null;
  note: string | null;
  status: BreedingStatus;
  /** Expected farrowing − today while in gestation (negative when overdue), else null. */
  daysToFarrowing: number | null;
}

export function toBreedingItem(r: BreedingRow): BreedingItem {
  return {
    id: r.id,
    sowId: r.sowId,
    sowTag: r.sow.tag,
    sire: r.boar ? r.boar.tag : `IA ${r.semenLabel ?? ''}`.trim(),
    method: r.method,
    boarId: r.boarId,
    semenLabel: r.semenLabel,
    serviceDate: formatDay(r.serviceDate),
    expectedFarrowingDate: formatDay(r.expectedFarrowingDate),
    farrowingDate: formatDayOrNull(r.farrowingDate),
    bornTotal: r.bornTotal,
    bornAlive: r.bornAlive,
    stillborn: r.stillborn,
    litterBatchId: r.litterBatchId,
    weaningDate: formatDayOrNull(r.weaningDate),
    weanedCount: r.weanedCount,
    failureDate: formatDayOrNull(r.failureDate),
    note: r.note,
    status: r.status,
    daysToFarrowing:
      r.status === 'GESTATION'
        ? signedDaysBetween(today(), r.expectedFarrowingDate)
        : null,
  };
}
