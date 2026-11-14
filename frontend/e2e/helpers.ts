import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ADMINS, API_URL, PASSWORD, WEB_URL } from './config.ts';

// ESM imports ignore NODE_PATH; require() honours it. Look in the project first, then in the global root.
function loadPlaywright(): typeof import('playwright') {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    /* not installed in the project */
  }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  } catch {
    /* not installed globally either */
  }
  throw new Error(
    "Playwright introuvable / Playwright not found. Install it from frontend/ (without touching package.json):\n" +
      '  npm install --no-save playwright && npx playwright install chromium',
  );
}
const { chromium } = loadPlaywright();

export { PASSWORD, WEB_URL };
export type AdminKey = keyof typeof ADMINS;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 code (HMAC-SHA1, 30 s step, 6 digits) for a base32 secret. */
export function totp(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function launch(): Promise<Browser> {
  // Chromium is found through PLAYWRIGHT_BROWSERS_PATH; E2E_CHROMIUM_PATH overrides it.
  return chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || undefined });
}

export async function newPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  return { context, page: await context.newPage() };
}

interface ApiOptions {
  method?: string;
  token?: string;
  farmId?: string;
  body?: unknown;
}

export async function api<T = any>(path: string, { method = 'GET', token, farmId, body }: ApiOptions = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(farmId ? { 'x-farm-id': farmId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface EnrolledAdmin {
  email: string;
  secret: string;
  backupCodes: string[];
  token: string;
  farmId: string;
}

export interface EnrolledUser {
  email: string;
  secret: string;
  backupCodes: string[];
  token: string;
}

/** Enrols a user whose role makes 2FA mandatory (it has only a stage token before enrolment) through the API (no UI). */
export async function enrollUser(email: string): Promise<EnrolledUser> {
  const login = await api<{ setupToken?: string }>('/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  const stage = login.setupToken;
  if (!stage) throw new Error(`Unexpected login response: ${JSON.stringify(login)}`);
  const setup = await api<{ secret: string }>('/auth/2fa/setup', { method: 'POST', token: stage });
  const enabled = await api<{ backupCodes: string[]; accessToken: string }>('/auth/2fa/enable', {
    method: 'POST',
    token: stage,
    body: { code: totp(setup.secret) },
  });
  return { email, secret: setup.secret, backupCodes: enabled.backupCodes, token: enabled.accessToken };
}

export interface EnrolledAdmin extends EnrolledUser {
  /** The seeded farm (`Ferme Kpalimé`), even once a spec has created other farms. */
  farmId: string;
}

/** Enrols a freshly seeded SUPER_ADMIN in 2FA through the API (no UI) and returns a session. */
export async function enrollAdmin(key: AdminKey): Promise<EnrolledAdmin> {
  const enrolled = await enrollUser(ADMINS[key]);
  const me = await api<{ farms: { id: string; name: string }[] }>('/auth/me', { token: enrolled.token });
  const farm = me.farms.find((f) => f.name === 'Ferme Kpalimé') ?? me.farms[0];
  return { ...enrolled, farmId: farm.id };
}

/** Logs in through the UI with the credentials form and a backup code (TOTP codes cannot be replayed). */
export async function uiLoginWithBackupCode(page: Page, email: string, backupCode: string): Promise<void> {
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByLabel('Code de vérification').fill(backupCode);
  await page.getByRole('button', { name: 'Vérifier' }).click();
}
