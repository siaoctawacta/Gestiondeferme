import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { decrypt, encrypt } from '../src/auth/crypto';
import { hashPassword } from '../src/auth/password';
import { stepAt, totpCode } from '../src/auth/totp';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Role } from '../src/generated/prisma/enums';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
} from './setup';

const PASSWORD = 'Correct-Horse-9';

interface Session {
  accessToken: string;
  user: { twoFactorEnabled: boolean };
}

describe('Two-factor authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmId: string;
  let passwordHash: string;

  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const hasCookie = (res: request.Response) =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).some((c) =>
      c.startsWith('ap_refresh='),
    );

  const makeUser = (role: Role) =>
    createUser({
      organizationId: orgId,
      role,
      farmIds: [farmId],
      passwordHash,
    });
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/auth/login').send({ email, password });
  const post = (path: string, token: string, body: object = {}) =>
    http().post(`/api/auth/2fa/${path}`).set(bearer(token)).send(body);

  /** Logs in a user without 2FA and returns a full or setup token. */
  async function firstToken(email: string): Promise<{
    token: string;
    res: request.Response;
  }> {
    const res = await login(email);
    const b = res.body as { accessToken?: string; setupToken?: string };
    return { token: (b.accessToken ?? b.setupToken)!, res };
  }

  async function enrol(email: string, step: number) {
    const { token } = await firstToken(email);
    const setup = await post('setup', token);
    const { secret } = setup.body as { secret: string };
    const enable = await post('enable', token, {
      code: totpCode(secret, step),
    });
    return { secret, enable, setup };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await createOrganization()).id;
    farmId = (await createFarm(orgId)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('encrypts and decrypts, with a fresh IV each time', () => {
    const a = encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(encrypt('JBSWY3DPEHPK3PXP'));
    expect(decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = Buffer.from(a, 'base64');
    tampered[tampered.length - 1] ^= 1;
    expect(() => decrypt(tampered.toString('base64'))).toThrow();
  });

  it('forces a mandatory role to enrol: no cookie, setup token blocked on /me', async () => {
    const user = await makeUser('COMPTABLE');
    const res = await login(user.email);
    expect(res.status).toBe(200);
    const body = res.body as {
      twoFactorSetupRequired: boolean;
      setupToken: string;
    };
    expect(body.twoFactorSetupRequired).toBe(true);
    expect(hasCookie(res)).toBe(false);
    const me = await http().get('/api/auth/me').set(bearer(body.setupToken));
    expect(me.status).toBe(403);
    expect((me.body as { code: string }).code).toBe('TWO_FACTOR_REQUIRED');
  });

  it('setup then enable gives 8 backup codes and a full session', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { token } = await firstToken(user.email);
    const setup = await post('setup', token);
    expect(setup.status).toBe(201);
    const s = setup.body as {
      otpauthUrl: string;
      qrDataUrl: string;
      secret: string;
    };
    expect(s.otpauthUrl).toContain('otpauth://totp/');
    expect(s.otpauthUrl).toContain('issuer=AgriPilot');
    expect(s.otpauthUrl).toContain(`secret=${s.secret}`);
    expect(s.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    // Stored encrypted and not yet enabled.
    const pending = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(pending.totpEnabledAt).toBeNull();
    expect(pending.totpSecretEnc).not.toBeNull();
    expect(pending.totpSecretEnc).not.toContain(s.secret);
    expect(decrypt(pending.totpSecretEnc!)).toBe(s.secret);

    const enable = await post('enable', token, {
      code: totpCode(s.secret, step),
    });
    expect(enable.status).toBe(201);
    const e = enable.body as Session & { backupCodes: string[] };
    expect(e.backupCodes).toHaveLength(8);
    for (const c of e.backupCodes) expect(c).toHaveLength(10);
    expect(new Set(e.backupCodes).size).toBe(8);
    expect(e.user.twoFactorEnabled).toBe(true);
    expect(hasCookie(enable)).toBe(true);
    const me = await http().get('/api/auth/me').set(bearer(e.accessToken));
    expect(me.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.backupCodes).toHaveLength(8);
    for (const c of e.backupCodes) expect(stored.backupCodes).not.toContain(c);
  });

  it('enable with a wrong code is 400 and leaves 2FA disabled', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { token } = await firstToken(user.email);
    const { secret } = (await post('setup', token)).body as { secret: string };
    const good = totpCode(secret, step);
    const wrong = good === '000000' ? '000001' : '000000';
    const res = await post('enable', token, { code: wrong });
    expect(res.status).toBe(400);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.totpEnabledAt).toBeNull();
    expect(stored.backupCodes).toHaveLength(0);
  });

  it('refuses enable without a prior setup, a second enable, and setup while enabled', async () => {
    const user = await makeUser('COMMERCIAL');
    const { token } = await firstToken(user.email);
    expect((await post('enable', token, { code: '123456' })).status).toBe(400);

    const setup = await post('setup', token);
    const { secret } = setup.body as { secret: string };
    const step = stepAt(Date.now());
    expect(
      (await post('enable', token, { code: totpCode(secret, step) })).status,
    ).toBe(201);
    expect(
      (await post('enable', token, { code: totpCode(secret, step + 1) }))
        .status,
    ).toBe(400);
    expect((await post('setup', token)).status).toBe(409);
  });

  it('rejects the setup token on verify and the 2fa token on setup/enable', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { token: setupToken } = await firstToken(user.email);
    expect((await post('verify', setupToken, { code: '123456' })).status).toBe(
      403,
    );
    await enrol(user.email, step);
    const ch = (await login(user.email)).body as { challengeToken: string };
    expect((await post('setup', ch.challengeToken)).status).toBe(403);
    expect(
      (await post('enable', ch.challengeToken, { code: '123456' })).status,
    ).toBe(403);
  });

  it('next login needs the challenge; verify issues the session; challenge token is blocked on /me', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { secret } = await enrol(user.email, step);
    const res = await login(user.email);
    const body = res.body as {
      twoFactorRequired: boolean;
      challengeToken: string;
    };
    expect(body.twoFactorRequired).toBe(true);
    expect(hasCookie(res)).toBe(false);
    const me = await http()
      .get('/api/auth/me')
      .set(bearer(body.challengeToken));
    expect(me.status).toBe(403);

    // The enrolment code is already consumed: replaying it is refused.
    const replay = await post('verify', body.challengeToken, {
      code: totpCode(secret, step),
    });
    expect(replay.status).toBe(401);

    const next = await post('verify', body.challengeToken, {
      code: totpCode(secret, step + 1),
    });
    expect(next.status).toBe(200);
    expect(hasCookie(next)).toBe(true);
    const session = next.body as Session;
    expect(
      (await http().get('/api/auth/me').set(bearer(session.accessToken)))
        .status,
    ).toBe(200);

    // The same code cannot be used twice.
    const again = await post('verify', body.challengeToken, {
      code: totpCode(secret, step + 1),
    });
    expect(again.status).toBe(401);
  });

  it('a backup code works once', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { enable } = await enrol(user.email, step);
    const [code] = (enable.body as { backupCodes: string[] }).backupCodes;
    const ch = (await login(user.email)).body as { challengeToken: string };
    const first = await post('verify', ch.challengeToken, { code });
    expect(first.status).toBe(200);
    expect(hasCookie(first)).toBe(true);
    const second = await post('verify', ch.challengeToken, { code });
    expect(second.status).toBe(401);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.backupCodes).toHaveLength(7);
  });

  it('writes a login log entry for each second-factor attempt', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { secret } = await enrol(user.email, step);
    const ch = (await login(user.email)).body as { challengeToken: string };
    const before = await prisma.loginLog.count({ where: { userId: user.id } });
    await post('verify', ch.challengeToken, { code: '000000' });
    await post('verify', ch.challengeToken, {
      code: totpCode(secret, step + 1),
    });
    const logs = await prisma.loginLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      skip: before,
    });
    expect(logs.map((l) => l.success)).toEqual([false, true]);
  });

  it('wrong codes lock the account like wrong passwords, and success resets the count', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { secret } = await enrol(user.email, step);
    const ch = (await login(user.email)).body as { challengeToken: string };
    for (let i = 0; i < 4; i += 1) {
      expect(
        (await post('verify', ch.challengeToken, { code: '000000' })).status,
      ).toBe(401);
    }
    // Success resets the counter.
    expect(
      (
        await post('verify', ch.challengeToken, {
          code: totpCode(secret, step + 1),
        })
      ).status,
    ).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .failedLogins,
    ).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await post('verify', ch.challengeToken, { code: '000000' })).status,
      ).toBe(401);
    }
    const locked = await post('verify', ch.challengeToken, {
      code: totpCode(secret, step - 1),
    });
    expect(locked.status).toBe(423);
    expect((await login(user.email)).status).toBe(423);
  });

  it('logging in again does not reset the failure count (no lockout bypass)', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    await enrol(user.email, step);
    const first = (await login(user.email)).body as { challengeToken: string };
    for (let i = 0; i < 4; i += 1) {
      expect(
        (await post('verify', first.challengeToken, { code: '000000' })).status,
      ).toBe(401);
    }
    const second = (await login(user.email)).body as {
      challengeToken: string;
    };
    const fifth = await post('verify', second.challengeToken, {
      code: '000000',
    });
    expect(fifth.status).toBe(401); // 5th failure triggers the lock
    expect((await login(user.email)).status).toBe(423);
    expect(
      (await post('verify', second.challengeToken, { code: '000000' })).status,
    ).toBe(423);
  });

  it('disable is forbidden for mandatory roles', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { secret, enable } = await enrol(user.email, step);
    const { accessToken } = enable.body as Session;
    const res = await post('disable', accessToken, {
      password: PASSWORD,
      code: totpCode(secret, step + 1),
    });
    expect(res.status).toBe(403);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .totpEnabledAt,
    ).not.toBeNull();
  });

  it('disable for an optional role needs password and code, then clears everything', async () => {
    const user = await makeUser('COMMERCIAL');
    const { token } = await firstToken(user.email);
    const { secret } = (await post('setup', token)).body as { secret: string };
    const step = stepAt(Date.now());
    expect(
      (await post('enable', token, { code: totpCode(secret, step) })).status,
    ).toBe(201);

    const code = totpCode(secret, step + 1);
    const attempt = (password: string, c: string) =>
      post('disable', token, { password, code: c });
    expect((await attempt('wrong-password-1', code)).status).toBe(400);
    expect((await attempt(PASSWORD, '000000')).status).toBe(400);
    // The code used to enable cannot be replayed.
    expect((await attempt(PASSWORD, totpCode(secret, step))).status).toBe(400);
    expect((await attempt(PASSWORD, code)).status).toBe(204);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.totpEnabledAt).toBeNull();
    expect(stored.totpSecretEnc).toBeNull();
    expect(stored.backupCodes).toHaveLength(0);
    expect(stored.totpLastStep).toBeNull();
    const again = await login(user.email);
    expect((again.body as Session).accessToken).toBeDefined();
  });

  it('the 2fa routes are throttled like login (11th request is 429)', async () => {
    const user = await makeUser('COMPTABLE');
    process.env.THROTTLE_IN_TEST = '1';
    const throttled = await createTestApp();
    try {
      const { token } = await firstToken(user.email);
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await request(throttled.getHttpServer() as App)
          .post('/api/auth/2fa/enable')
          .set(bearer(token))
          .send({ code: '000000' });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
      expect(statuses[10]).toBe(429);
    } finally {
      delete process.env.THROTTLE_IN_TEST;
      await throttled.close();
    }
  });

  it('stored secret never contains the plain secret (enable path)', async () => {
    const step = stepAt(Date.now());
    const user = await makeUser('COMPTABLE');
    const { secret } = await enrol(user.email, step);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.totpSecretEnc).not.toContain(secret);
  });
});
