import {
  demoPasswordProblem,
  MESSAGES,
  resetRefusal,
  seedRefusal,
} from './demo-guards';

const LOCAL = 'postgresql://u:p@localhost:5432/agripilot';

describe('demo:reset guard (it drops the whole database)', () => {
  it('needs ALLOW_DEMO_RESET=1', () => {
    expect(resetRefusal({ DATABASE_URL: LOCAL })).toContain(
      'ALLOW_DEMO_RESET=1',
    );
    expect(
      resetRefusal({ DATABASE_URL: LOCAL, ALLOW_DEMO_RESET: 'true' }),
    ).toContain('ALLOW_DEMO_RESET=1');
  });
  it('allows a local database', () => {
    for (const host of ['localhost', '127.0.0.1', 'db']) {
      expect(
        resetRefusal({
          ALLOW_DEMO_RESET: '1',
          DATABASE_URL: `postgresql://u:p@${host}:5432/x`,
        }),
      ).toBeNull();
    }
  });
  it('refuses a remote or missing database, and production', () => {
    const base = { ALLOW_DEMO_RESET: '1' };
    expect(
      resetRefusal({
        ...base,
        DATABASE_URL: 'postgresql://u:p@db.example.com/x',
      }),
    ).toContain('db.example.com');
    expect(resetRefusal({ ...base })).toContain('DATABASE_URL');
    expect(resetRefusal({ ...base, DATABASE_URL: 'pas une url' })).toContain(
      'DATABASE_URL',
    );
    expect(
      resetRefusal({ ...base, DATABASE_URL: LOCAL, NODE_ENV: 'production' }),
    ).toContain('NODE_ENV=production');
  });
  it('says what it destroys, in one line', () => {
    const message = resetRefusal({}) as string;
    expect(message).toContain('détruit TOUTE la base');
    expect(message).not.toContain('\n');
  });
});

describe('demo seed guards', () => {
  it('refuses production unless ALLOW_DEMO_SEED=1', () => {
    expect(seedRefusal({ NODE_ENV: 'production' })).toBe(MESSAGES.production);
    expect(
      seedRefusal({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' }),
    ).toBe(MESSAGES.production);
    expect(
      seedRefusal({ NODE_ENV: 'production', ALLOW_DEMO_SEED: '1' }),
    ).toBeNull();
    expect(seedRefusal({})).toBeNull();
  });
  it('asks 10 characters, and 16 when the demo is forced in production', () => {
    expect(demoPasswordProblem({ DEMO_PASSWORD: 'a'.repeat(9) })).toContain(
      '10',
    );
    expect(demoPasswordProblem({ DEMO_PASSWORD: 'a'.repeat(10) })).toBeNull();
    expect(demoPasswordProblem({})).toContain('10');
    const forced = { NODE_ENV: 'production', ALLOW_DEMO_SEED: '1' };
    expect(
      demoPasswordProblem({ ...forced, DEMO_PASSWORD: 'a'.repeat(15) }),
    ).toContain('16');
    expect(
      demoPasswordProblem({ ...forced, DEMO_PASSWORD: 'a'.repeat(16) }),
    ).toBeNull();
  });
});
