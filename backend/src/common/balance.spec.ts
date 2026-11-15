import { lowestBalance } from './balance';

describe('lowestBalance', () => {
  it('is the start when nothing follows', () => {
    expect(lowestBalance(40, []).toString()).toBe('40');
  });

  it('is the lowest running balance: a lot of 40 with 30 sold later has 10', () => {
    expect(lowestBalance(40, [-30]).toString()).toBe('10');
  });

  it('is not fooled by an entry that comes back up after the dip', () => {
    expect(lowestBalance(100, [-60, -30, 200]).toString()).toBe('10');
  });

  it('does not count a later entry before the dip, and keeps decimals', () => {
    expect(lowestBalance(10, [5, -12.5]).toString()).toBe('2.5');
    expect(lowestBalance(10, [5]).toString()).toBe('10');
  });
});
