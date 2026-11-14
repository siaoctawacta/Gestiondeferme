import { apiDocsEnabled, assertJwtSecret } from './configure-app';
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
      // Assigning undefined would store the string "undefined".
      if (saved === undefined) delete process.env.TOTP_ENC_KEY;
      else process.env.TOTP_ENC_KEY = saved;
    }
  });
});

describe('apiDocsEnabled', () => {
  it('is on outside production', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(apiDocsEnabled({})).toBe(true);
  });

  it('is off in production unless ENABLE_API_DOCS=true', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: 'false' }),
    ).toBe(false);
    expect(
      apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: '1' }),
    ).toBe(false);
    expect(
      apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: 'true' }),
    ).toBe(true);
  });
});
