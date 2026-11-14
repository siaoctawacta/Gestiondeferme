import { assertJwtSecret } from './configure-app';
import { assertEncryptionKey } from './auth/crypto';

describe('boot secret validation', () => {
  it('rejects a missing, short or placeholder JWT_SECRET and accepts a real one', () => {
    expect(() => assertJwtSecret(undefined)).toThrow(/at least 32/);
    expect(() => assertJwtSecret('short')).toThrow(/at least 32/);
    expect(() => assertJwtSecret('change-me-to-a-long-random-string')).toThrow(
      /placeholder/,
    );
    expect(() => assertJwtSecret('x'.repeat(40))).not.toThrow();
  });

  it('rejects the TOTP_ENC_KEY placeholder', () => {
    const saved = process.env.TOTP_ENC_KEY;
    try {
      process.env.TOTP_ENC_KEY = 'change-me-32-bytes-base64';
      expect(() => assertEncryptionKey()).toThrow(/placeholder/);
      process.env.TOTP_ENC_KEY = Buffer.alloc(32, 1).toString('base64');
      expect(() => assertEncryptionKey()).not.toThrow();
    } finally {
      process.env.TOTP_ENC_KEY = saved;
    }
  });
});
