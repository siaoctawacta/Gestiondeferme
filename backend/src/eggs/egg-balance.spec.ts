import { eggAvailable, eggShortfall } from './egg-balance';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const D1 = day('2026-11-10');
const D2 = day('2026-11-11');
const D3 = day('2026-11-12');

// A day of production: 2 500 collected - 40 broken - 250 downgraded = 2 210 marketable.
const PRODUCTION = [
  { date: D1, marketable: 2500 - 40 - 250 },
  { date: D2, marketable: 2500 },
];

describe('eggShortfall', () => {
  it('has none when the sales are exactly what was produced (2 210 + 2 500 = 4 710)', () => {
    expect(eggShortfall(PRODUCTION, [{ date: D2, eggs: 4710 }])).toBeNull();
  });

  it('is the day where the balance goes negative, with what was available before that day outflows', () => {
    expect(eggShortfall(PRODUCTION, [{ date: D2, eggs: 4740 }])).toEqual({
      date: D2,
      available: 4710,
    });
    expect(eggShortfall(PRODUCTION, [{ date: D1, eggs: 2220 }])).toEqual({
      date: D1,
      available: 2210,
    });
  });

  it('counts the production of a day before that day sales', () => {
    expect(
      eggShortfall([{ date: D1, marketable: 300 }], [{ date: D1, eggs: 300 }]),
    ).toBeNull();
    expect(
      eggShortfall([{ date: D1, marketable: 300 }], [{ date: D1, eggs: 301 }]),
    ).toEqual({ date: D1, available: 300 });
  });

  it('is found when the production is lowered under what was sold', () => {
    const lowered = [
      { date: D1, marketable: 2200 },
      { date: D2, marketable: 2500 },
    ];
    expect(eggShortfall(lowered, [{ date: D2, eggs: 4710 }])).toEqual({
      date: D2,
      available: 4700,
    });
  });

  it('reports the first day only, whatever the order of the inputs', () => {
    const sales = [
      { date: D3, eggs: 100000 },
      { date: D1, eggs: 2300 },
    ];
    expect(eggShortfall([...PRODUCTION].reverse(), sales)).toEqual({
      date: D1,
      available: 2210,
    });
  });

  it('nets a return (a negative outflow) against the sales of its day and raises the balance after it', () => {
    const sales = [
      { date: D1, eggs: 2000 },
      { date: D2, eggs: -500 },
      { date: D3, eggs: 2900 },
    ];
    // D1: 2210 - 2000 = 210; D2: 210 + 2500 + 500 = 3210; D3: 3210 - 2900 = 310.
    expect(eggShortfall(PRODUCTION, sales)).toBeNull();
    expect(
      eggShortfall(PRODUCTION, [...sales, { date: D3, eggs: 311 }]),
    ).toEqual({
      date: D3,
      available: 3210,
    });
  });

  it('has none for an empty history', () => {
    expect(eggShortfall([], [])).toBeNull();
    expect(eggShortfall(PRODUCTION, [])).toBeNull();
  });
});

describe('eggAvailable', () => {
  it('is the balance on the date when nothing happens later', () => {
    expect(eggAvailable(PRODUCTION, [], D1)).toBe(2210);
    expect(eggAvailable(PRODUCTION, [], D2)).toBe(4710);
    expect(eggAvailable(PRODUCTION, [], D3)).toBe(4710);
  });

  it('is what a sale on that date can still take without starving a later sale', () => {
    // 4 710 produced, 4 000 sold on D2: a sale on D1 may take at most 2 210 - 0, but D2 only has 710 spare.
    const sold = [{ date: D2, eggs: 4000 }];
    expect(eggAvailable(PRODUCTION, sold, D2)).toBe(710);
    expect(eggAvailable(PRODUCTION, sold, D1)).toBe(710);
    expect(eggAvailable(PRODUCTION, sold, D3)).toBe(710);
  });

  it('is 0 before the first production and never negative', () => {
    expect(eggAvailable(PRODUCTION, [], day('2026-11-01'))).toBe(0);
    expect(eggAvailable(PRODUCTION, [{ date: D1, eggs: 99999 }], D2)).toBe(0);
  });
});
