import { Decimal } from '@prisma/client/runtime/client';
import {
  breakageRate,
  costPerAnimal,
  costPerKg,
  margin,
  marginRate,
  dailyGain,
  feedConversion,
  fertilityRate,
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
    expect(fertilityRate(285, 300)).toBe(95);
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

  it('returns null instead of NaN when the quotient overflows', () => {
    expect(ratio(1, 1e-320)).toBeNull();
    expect(ratio(1e308, 0.001)).toBeNull();
    expect(ratio(1e300, 1e-10)).toBeNull();
  });

  it('returns null for a negative count, but keeps a negative daily gain', () => {
    expect(mortalityRate(-1, 100)).toBeNull();
    expect(layingRate(-1, 100)).toBeNull();
    expect(breakageRate(-1, 100)).toBeNull();
    expect(hatchRate(-1, 100)).toBeNull();
    expect(occupationRate(-1, 100)).toBeNull();
    expect(feedConversion(-1, 100)).toBeNull();
    expect(dailyGain(1500, 1400, 10)).toBe(-10);
    expect(ratio(-1, 4)).toBe(-0.3);
  });

  describe('finance figures', () => {
    it('computes the reference margin and its rate', () => {
      const m = margin(new Decimal(3970000), new Decimal(2835000));
      expect(m).toBeInstanceOf(Decimal);
      expect(m.toNumber()).toBe(1135000);
      expect(marginRate(1135000, 3970000)).toBe(29);
      expect(marginRate(new Decimal(1135000), new Decimal(3970000))).toBe(29);
    });

    it('rounds the margin rate half away from zero and keeps its sign', () => {
      expect(marginRate(5, 200)).toBe(3);
      expect(marginRate(-5, 200)).toBe(-3);
      expect(marginRate(-827400, 945000)).toBe(-88);
      expect(Object.is(marginRate(0, 100), 0)).toBe(true);
    });

    it('has no margin rate without revenue', () => {
      expect(marginRate(100, 0)).toBeNull();
      expect(marginRate(100, -50)).toBeNull();
    });

    it('computes a cost per animal and per kg to 2 decimals, null without a denominator', () => {
      expect(costPerAnimal(1772400, 4820)).toBe(367.72);
      expect(costPerAnimal(new Decimal('1772400.00'), 4820)).toBe(367.72);
      expect(costPerAnimal(100, 0)).toBeNull();
      expect(costPerKg(1000000, 690)).toBe(1449.28);
      expect(costPerKg(1000000, 0)).toBeNull();
      expect(costPerKg(1000000, new Decimal('0.00'))).toBeNull();
      expect(costPerAnimal(1, 8)).toBe(0.13);
    });
  });
});
