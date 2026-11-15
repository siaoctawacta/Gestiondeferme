// The pure rules of the egg balance (no database): `egg-stock.ts` reads the history and applies them.

/** Eggs a lot can sell on one day: collected - broken - downgraded - put in incubation. */
export interface EggProductionDay {
  date: Date;
  marketable: number;
}

/** Eggs leaving a lot on one day (a sale); negative when they come back (a credit-note return). */
export interface EggOutflowDay {
  date: Date;
  eggs: number;
}

/** One calendar day of a lot's egg history. */
interface Day {
  time: number;
  produced: number;
  out: number;
}

function days(
  production: EggProductionDay[],
  outflows: EggOutflowDay[],
): Day[] {
  const byTime = new Map<number, Day>();
  const at = (date: Date): Day => {
    const time = date.getTime();
    let day = byTime.get(time);
    if (!day) {
      day = { time, produced: 0, out: 0 };
      byTime.set(time, day);
    }
    return day;
  };
  for (const p of production) at(p.date).produced += p.marketable;
  for (const o of outflows) at(o.date).out += o.eggs;
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * The first day on which the balance (Σ marketable up to the day, minus Σ
 * outflows up to the day) is negative, or null. The production of a day counts
 * before that day's outflows; a return on the same day as a sale nets against
 * it. `available` is the balance on that day before its outflows. The one
 * rule behind every egg check (a sale, an edited or deleted production).
 */
export function eggShortfall(
  production: EggProductionDay[],
  outflows: EggOutflowDay[],
): { date: Date; available: number } | null {
  let balance = 0;
  for (const day of days(production, outflows)) {
    balance += day.produced;
    const available = balance;
    balance -= day.out;
    if (balance < 0) return { date: new Date(day.time), available };
  }
  return null;
}

/**
 * The eggs a new sale dated `date` may take: the balance on that day, and no
 * more than any later day can spare (a sale on `date` also lowers every later
 * balance). Never negative.
 */
export function eggAvailable(
  production: EggProductionDay[],
  outflows: EggOutflowDay[],
  date: Date,
): number {
  let balance = 0;
  let spare: number | null = null;
  let seenDate = false;
  for (const day of days(production, outflows)) {
    if (day.time > date.getTime() && !seenDate) {
      spare = balance;
      seenDate = true;
    }
    balance += day.produced - day.out;
    if (seenDate) spare = Math.min(spare ?? balance, balance);
  }
  if (!seenDate) spare = balance;
  return Math.max(0, spare ?? 0);
}
