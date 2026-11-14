import {
  breakageRate,
  dailyGain,
  feedConversion,
  hatchRate,
  layingRate,
  mortalityRate,
  occupationRate,
  ratio,
} from './indicators';

describe('indicators', () => {
  it('computes the reference values', () => {
    expect(mortalityRate(180, 5000)).toBe(3.6);
    expect(layingRate(2480, 2850)).toBe(87);
    expect(breakageRate(42, 2480)).toBe(1.7);
    expect(hatchRate(260, 300)).toBe(86.7);
    expect(dailyGain(620, 1450, 15)).toBe(55.3);
    expect(feedConversion(6200, 3500)).toBe(1.77);
    expect(occupationRate(4820, 5000)).toBe(96);
    expect(ratio(1, 3)).toBe(0.3);
    expect(ratio(1, 3, 2)).toBe(0.33);
  });

  it('rounds half away from zero on the decimal shown', () => {
    expect(ratio(1.005, 1, 2)).toBe(1.01);
    expect(ratio(0.25, 1, 1)).toBe(0.3);
    expect(dailyGain(100, 0, 8)).toBe(-12.5);
    expect(dailyGain(100, 99, 8)).toBe(-0.1);
    expect(occupationRate(1, 8)).toBe(13);
  });

  it('returns null on a zero or negative denominator, never NaN or Infinity', () => {
    const results = [
      mortalityRate(1, 0),
      mortalityRate(0, 0),
      layingRate(1, -5),
      breakageRate(1, 0),
      hatchRate(1, 0),
      dailyGain(1, 2, 0),
      dailyGain(1, 2, -3),
      feedConversion(1, 0),
      feedConversion(1, -1),
      occupationRate(1, 0),
      ratio(1, 0),
    ];
    for (const r of results) expect(r).toBeNull();
  });

  it('returns null when an input is missing or not finite', () => {
    expect(mortalityRate(null, 10)).toBeNull();
    expect(mortalityRate(1, undefined)).toBeNull();
    expect(dailyGain(null, 10, 5)).toBeNull();
    expect(dailyGain(10, undefined, 5)).toBeNull();
    expect(dailyGain(10, 20, null)).toBeNull();
    expect(ratio(NaN, 1)).toBeNull();
    expect(ratio(1, Infinity)).toBeNull();
  });

  it('never returns -0', () => {
    expect(Object.is(dailyGain(100, 100, 5), 0)).toBe(true);
    expect(Object.is(dailyGain(100, 99.99, 5), 0)).toBe(true);
    expect(Object.is(mortalityRate(0, 100), 0)).toBe(true);
  });
});
