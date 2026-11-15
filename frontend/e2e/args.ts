// Command line of `npm run e2e`, read and checked before anything is reset or started.

export interface E2eArgs {
  /** `--serve`: keep the servers up for manual use instead of running the specs. */
  serve: boolean;
  /** Words selecting the specs whose file name contains one of them (all when empty). */
  only: string[];
}

/**
 * `--trace off` and `--trace=off` are accepted and ignored (the specs drive Playwright's library, which never records
 * a trace); any other use of `--trace` throws. Other `--flags` are left to their readers, bare words select specs.
 */
export function parseArgs(args: string[]): E2eArgs {
  const only: string[] = [];
  let serve = false;
  const refuse = (got: string | undefined) => new Error(`--trace n'accepte que « off » (reçu : ${got || 'rien'})`);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--trace') {
      if (args[i + 1] !== 'off') throw refuse(args[i + 1]);
      i += 1;
    } else if (arg.startsWith('--trace=')) {
      if (arg !== '--trace=off') throw refuse(arg.slice('--trace='.length));
    } else if (arg === '--serve') {
      serve = true;
    } else if (!arg.startsWith('--')) {
      only.push(arg);
    }
  }
  return { serve, only };
}
