import { assertEncryptionKey, decrypt, encrypt } from './crypto';

describe('TOTP_ENC_KEY', () => {
  const original = process.env.TOTP_ENC_KEY;
  afterEach(() => {
    process.env.TOTP_ENC_KEY = original;
  });

  it('accepts 32 bytes as base64 or hex', () => {
    process.env.TOTP_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
    expect(() => assertEncryptionKey()).not.toThrow();
    process.env.TOTP_ENC_KEY = Buffer.alloc(32, 7).toString('hex');
    expect(() => assertEncryptionKey()).not.toThrow();
    expect(decrypt(encrypt('secret'))).toBe('secret');
  });

  it('fails fast when missing or the wrong length', () => {
    delete process.env.TOTP_ENC_KEY;
    expect(() => assertEncryptionKey()).toThrow(/TOTP_ENC_KEY/);
    process.env.TOTP_ENC_KEY = Buffer.alloc(16).toString('base64');
    expect(() => assertEncryptionKey()).toThrow(/32 bytes/);
  });
});
