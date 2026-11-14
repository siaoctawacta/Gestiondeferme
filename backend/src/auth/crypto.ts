import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Parses TOTP_ENC_KEY (64 hex chars, or base64) into a 32-byte key; throws when missing or wrong length. */
function loadKey(): Buffer {
  const raw = process.env.TOTP_ENC_KEY?.trim();
  if (!raw)
    throw new Error('TOTP_ENC_KEY must be set (32 bytes, base64 or hex)');
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('TOTP_ENC_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/** Fail-fast boot check. */
export function assertEncryptionKey(): void {
  loadKey();
}

/** AES-256-GCM with a random IV; returns base64(iv + tag + ciphertext). */
export function encrypt(text: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decrypt(blob: string): string {
  const data = Buffer.from(blob, 'base64');
  if (data.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Invalid encrypted blob');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    loadKey(),
    data.subarray(0, IV_BYTES),
  );
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

/** Keyed hash for backup codes: HMAC-SHA256 with the server key, so a DB leak alone cannot be brute-forced offline. */
export function hashBackupCode(code: string): string {
  return createHmac('sha256', loadKey())
    .update(`backup-code:${code}`)
    .digest('hex');
}
