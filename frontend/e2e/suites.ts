/**
 * Options of the long end-to-end suites (`describe(name, LONG_SUITE, fn)`): a suite is one flow of many browser steps, and
 * its timeout covers all of them. `run.ts` gives every other suite the 120 s default of `--test-timeout`.
 */
export const LONG_SUITE = { timeout: 600_000 } as const;
