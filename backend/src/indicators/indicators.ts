/** Pure KPI functions: no Nest, no database (money uses Decimal). A missing input or a non-positive denominator gives `null`. */
import { Decimal } from '@prisma/client/runtime/client';

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
/** fertile eggs / eggs set × 100. */
export const fertilityRate = (fertile: Num, eggsSet: Num) =>
  percent(fertile, eggsSet);
export const hatchRate = (chicks: Num, eggsSet: Num) =>
  percent(chicks, eggsSet);

/** Integer percentage. */
export const occupationRate = (occupation: Num, capacity: Num) =>
  percent(occupation, capacity, 0);

/** A stock quantity as text: up to 2 decimals (the stock precision), no float noise, no trailing zeros. */
export const quantityText = (n: number): string => String(Number(n.toFixed(2)));

/* Money figures (finance): exact in Decimal; a plain number is accepted for convenience (tests, counts). */

type Money = Decimal | number | string;

const money = (value: Money): Decimal => new Decimal(value);

/** revenue − costs, exact. */
export const margin = (revenue: Money, costs: Money): Decimal =>
  money(revenue).sub(money(costs));

/** margin / revenue as an integer percent (half away from zero); null when the revenue is not positive. */
export const marginRate = (m: Money, revenue: Money): number | null => {
  const r = money(revenue);
  if (!r.isFinite() || r.lte(0)) return null;
  return money(m)
    .mul(100)
    .div(r)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
};

/** `total / count` to 2 decimals (half away from zero); null when the denominator is not positive. */
function perUnit(total: Money, count: Money): number | null {
  const d = money(count);
  if (!d.isFinite() || d.lte(0)) return null;
  return money(total)
    .div(d)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Total cost of a lot / animals counted (alive + net sold); null when there is none. */
export const costPerAnimal = (totalCost: Money, animals: Money) =>
  perUnit(totalCost, animals);

/** Total cost of a lot / net kilograms invoiced; null when no weight is known. */
export const costPerKg = (totalCost: Money, kg: Money) =>
  perUnit(totalCost, kg);
