// The refusals of the demo, as pure functions of the environment (unit-tested).
import { existsSync } from 'fs';

export const MESSAGES = {
  production:
    'La démo ne se charge pas en production (ALLOW_DEMO_SEED=1 pour forcer)',
  alreadyLoaded: 'Données de démonstration déjà chargées',
  notEmpty:
    'La ferme contient déjà des données : chargez la démo sur une base vierge (npm run demo:reset en développement)',
  recovery:
    'Reprise : en développement, `npm run demo:reset` (détruit TOUTE la base) ; en production, restaurez une sauvegarde ou recréez la base avant de relancer.',
  interrupted: 'Un chargement précédent de la démo ne s’est pas terminé',
  concurrent: 'Un autre chargement de la démo est en cours',
};

/** A production install loads the demo only when `ALLOW_DEMO_SEED=1`. */
export function seedRefusal(env: NodeJS.ProcessEnv): string | null {
  return env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED !== '1'
    ? MESSAGES.production
    : null;
}

export const MIN_DEMO_PASSWORD = 10;
export const MIN_FORCED_DEMO_PASSWORD = 16;

/** 16 characters when the demo is forced in production (the accounts are reachable there), 10 otherwise. */
export function demoPasswordProblem(env: NodeJS.ProcessEnv): string | null {
  const forced = env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED === '1';
  const min = forced ? MIN_FORCED_DEMO_PASSWORD : MIN_DEMO_PASSWORD;
  return (env.DEMO_PASSWORD ?? '').length < min
    ? `DEMO_PASSWORD doit contenir au moins ${min} caractères${forced ? ' (démo forcée en production)' : ''}`
    : null;
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
/** The compose service name: local only inside a container (`/.dockerenv`). */
const COMPOSE_HOST = 'db';

const insideDocker = (): boolean => existsSync('/.dockerenv');

/**
 * `demo:reset` runs `prisma migrate reset --force`, which drops the WHOLE database: only with
 * `ALLOW_DEMO_RESET=1`, outside production and on a local database (localhost, 127.0.0.1, or the compose `db`
 * host inside a container). A `host` / `hostaddr` query parameter would override the URL's host (libpq), so it is refused.
 */
export function resetRefusal(
  env: NodeJS.ProcessEnv,
  inDocker: () => boolean = insideDocker,
): string | null {
  const refuse = (why: string) =>
    `demo:reset détruit TOUTE la base de données et est refusé : ${why}.`;
  if (env.NODE_ENV === 'production') return refuse('NODE_ENV=production');
  if (env.ALLOW_DEMO_RESET !== '1')
    return refuse('définissez ALLOW_DEMO_RESET=1');
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    return refuse('DATABASE_URL est absente ou invalide');
  }
  const overrides = [...url.searchParams.keys()].map((k) => k.toLowerCase());
  if (overrides.includes('host') || overrides.includes('hostaddr')) {
    return refuse(
      "DATABASE_URL contient un paramètre host ou hostaddr qui remplace l'hôte de l'URL",
    );
  }
  const host = url.hostname.toLowerCase();
  const local =
    LOCAL_HOSTS.includes(host) || (host === COMPOSE_HOST && inDocker());
  if (!local) {
    return refuse(
      `la base n'est pas locale (hôte « ${host} », attendu localhost, 127.0.0.1, ou db dans un conteneur)`,
    );
  }
  return null;
}
