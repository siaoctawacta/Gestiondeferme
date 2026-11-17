import { addDays } from '../common/days';

/**
 * "A lot is open at the end of day D": not closed, or closed after D (a lot closed on D is not).
 * ONE rule, two forms that must agree: `lotOpenAt` judges a loaded lot, `openAtWhere` is the same
 * test as a Prisma filter on `AnimalBatch` (use it as `{ batch: openAtWhere(day) }` from a relation).
 * Used by `BatchesService.periodLots`, the health report (`openAt`) and `HerdListService.totalPigs`.
 */
export const lotOpenAt = (lot: { closedAt: Date | null }, day: Date): boolean =>
  lot.closedAt === null || lot.closedAt.getTime() >= addDays(day, 1).getTime();

/** The Prisma form of `lotOpenAt` (`status` is the closed marker; a closed lot carries its `closedAt`). */
export const openAtWhere = (day: Date) => ({
  OR: [{ status: 'EN_COURS' as const }, { closedAt: { gte: addDays(day, 1) } }],
});
