/** Pure KPI functions: no Nest, no Prisma. A missing input or a non-positive denominator gives `null`. */

type Num = number | null | undefined;

const isNum = (n: Num): n is number => typeof n === 'number' && isFinite(n);

/** Rounds half away from zero to `decimals`; never returns -0. */
function round(value: number, decimals: number): number | null {
  if (!isFinite(value)) return null;
  const f = 10 ** decimals;
  const abs = Math.abs(value);
  const text = String(abs);
  const scaled = text.includes('e') ? abs * f : Number(`${text}e${decimals}`);
  const out = (Math.sign(value) * Math.round(scaled)) / f;
  if (!isFinite(out)) return null;
  return out === 0 ? 0 : out;
}

/** n / d × 100 is `ratio(n * 100, d)`; this is the plain n / d, rounded. `d` must be positive. */
export function ratio(n: Num, d: Num, decimals = 1): number | null {
  if (!isNum(n) || !isNum(d) || d <= 0) return null;
  return round(n / d, decimals);
}

/** Count-based rate: a negative count is bad data, so the rate is null. */
const percent = (n: Num, d: Num, decimals = 1): number | null =>
  isNum(n) && n >= 0 ? ratio(n * 100, d, decimals) : null;

/** deaths / initial count × 100. */
export const mortalityRate = (deaths: Num, initialCount: Num) =>
  percent(deaths, initialCount);

/** Average daily gain in g/day. */
export function dailyGain(
  weightStartG: Num,
  weightEndG: Num,
  days: Num,
): number | null {
  if (!isNum(weightStartG) || !isNum(weightEndG)) return null;
  return ratio(weightEndG - weightStartG, days);
}

/** Feed consumed / weight gained (both in kg), two decimals. */
export const feedConversion = (feedKg: Num, gainKg: Num) =>
  isNum(feedKg) && feedKg >= 0 ? ratio(feedKg, gainKg, 2) : null;

export const layingRate = (eggs: Num, hens: Num) => percent(eggs, hens);
export const breakageRate = (broken: Num, collected: Num) =>
  percent(broken, collected);
export const hatchRate = (chicks: Num, eggsSet: Num) =>
  percent(chicks, eggsSet);

/** Integer percentage. */
export const occupationRate = (occupation: Num, capacity: Num) =>
  percent(occupation, capacity, 0);
