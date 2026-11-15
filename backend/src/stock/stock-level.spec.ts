import { worstLevel, stockLevel } from './stock-level';

describe('stockLevel', () => {
  it.each([
    [900, 1500, 'faible'],
    [600, 1500, 'critique'],
    [4200, 2000, 'ok'],
    [1500, 1500, 'ok'],
    [750, 1500, 'faible'],
    [749.99, 1500, 'critique'],
    [0, 1500, 'critique'],
    [0, 0, 'ok'],
    [12, 0, 'ok'],
  ] as const)('quantity %s against minimum %s is %s', (qty, min, level) => {
    expect(stockLevel(qty, min)).toBe(level);
  });
});

describe('worstLevel', () => {
  it('shows critique over faible over ok', () => {
    expect(worstLevel(['ok', 'faible'])).toBe('faible');
    expect(worstLevel(['faible', 'critique', 'ok'])).toBe('critique');
    expect(worstLevel(['ok'])).toBe('ok');
    expect(worstLevel([])).toBe('ok');
  });
});
