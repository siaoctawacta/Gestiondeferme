// Entry point of `npm run e2e`: prepares the e2e database, starts the API (3100) and
// Vite (5273), runs the node:test specs with Playwright, then stops both servers.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMINS, API_PORT, API_URL, BACKEND_ENV, PASSWORD, WEB_PORT, WEB_URL } from './config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, '..');
const backend = join(frontend, '..', 'backend');
const children: ChildProcess[] = [];

function sh(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...BACKEND_ENV, ...env }, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

function start(cmd: string, args: string[], cwd: string, env: Record<string, string>): void {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  children.push(child);
}

function stopAll(): void {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(url: string, what: string): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not become ready at ${url}`);
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

let code = 1;
try {
  // The reset below drops the whole schema: never let it near any other database.
  if (new URL(BACKEND_ENV.DATABASE_URL).pathname !== '/agripilot_e2e') {
    throw new Error('Refusing to reset: the e2e database must be named exactly agripilot_e2e');
  }
  // Fresh database: migrate, wipe, seed one SUPER_ADMIN per spec.
  sh(
    'node',
    [
      '-e',
      `const { Client } = require('pg');
       (async () => {
         const c = new Client({ connectionString: process.env.DATABASE_URL });
         await c.connect();
         await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
         await c.end();
       })().catch((e) => { console.error(e.message); process.exit(1); });`,
    ],
    backend,
  );
  sh('npx', ['prisma', 'migrate', 'deploy'], backend);
  for (const email of Object.values(ADMINS)) {
    sh('npx', ['prisma', 'db', 'seed'], backend, { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: PASSWORD });
  }
  sh('npm', ['run', 'build'], backend);
  start('node', ['dist/main'], backend, BACKEND_ENV);
  start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], frontend, {
    VITE_API_TARGET: API_URL,
  });
  await waitFor(`${API_URL}/api/health`, 'API');
  await waitFor(WEB_URL, 'Vite');

  if (process.argv.includes('--serve')) {
    console.log(`E2E servers up: ${WEB_URL} (Ctrl-C to stop)`);
    await new Promise(() => {});
  }
  const specs = readdirSync(here).filter((f) => f.endsWith('.spec.ts')).sort().map((f) => join('e2e', f));
  const r = spawnSync(
    'node',
    ['--disable-warning=ExperimentalWarning', '--test', '--test-concurrency=1', '--test-timeout=120000', ...specs],
    { cwd: frontend, env: { ...process.env, E2E_API_PORT: String(API_PORT) }, stdio: 'inherit' },
  );
  code = r.status ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  stopAll();
}
process.exit(code);
