import { matchTotpStep, stepAt, totpCode } from './totp';

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890" in base32.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the RFC 6238 vector at T=%d', (seconds, expected) => {
    expect(totpCode(SECRET, stepAt(seconds * 1000))).toBe(expected);
  });

  it('accepts steps -1, 0, +1 and returns the matched step; rejects +-2', () => {
    const now = 1111111109 * 1000;
    const step = stepAt(now);
    for (const d of [-1, 0, 1]) {
      expect(matchTotpStep(SECRET, totpCode(SECRET, step + d), now)).toBe(
        step + d,
      );
    }
    for (const d of [-2, 2]) {
      expect(matchTotpStep(SECRET, totpCode(SECRET, step + d), now)).toBeNull();
    }
  });
});
