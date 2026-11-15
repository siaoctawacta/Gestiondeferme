import { expiryStatus, worstLevel, stockLevel } from './stock-level';

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

describe('expiryStatus', () => {
  it('is expired before today, soon from today to the warning limit inclusive, ok beyond or with no date', () => {
    expect(expiryStatus(-1, 30)).toBe('expired');
    expect(expiryStatus(0, 30)).toBe('soon');
    expect(expiryStatus(30, 30)).toBe('soon');
    expect(expiryStatus(31, 30)).toBe('ok');
    expect(expiryStatus(10, 10)).toBe('soon');
    expect(expiryStatus(11, 10)).toBe('ok');
    expect(expiryStatus(null, 30)).toBe('ok');
  });
});
