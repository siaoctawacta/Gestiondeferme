import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_ISSUER = 'AgriPilot';

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out; // 20 bytes = 160 bits = exactly 32 base32 chars
}

function base32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const stepAt = (timeMs: number): number =>
  Math.floor(timeMs / 1000 / STEP_SECONDS);

/** RFC 6238 (HMAC-SHA1, 6 digits) code for the given step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 15;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The step whose code matches within ±1 step of now (latest first), or null. */
export function matchTotpStep(
  secret: string,
  code: string,
  nowMs: number = Date.now(),
): number | null {
  const current = stepAt(nowMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let step = current + WINDOW; step >= current - WINDOW; step -= 1) {
    const expected = Buffer.from(totpCode(secret, step));
    // No early exit: every candidate is compared.
    if (
      expected.length === given.length &&
      timingSafeEqual(expected, given) &&
      matched === null
    ) {
      matched = step;
    }
  }
  return matched;
}

export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${TOTP_ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
