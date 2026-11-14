import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hashPassword } from '../src/auth/password';
import { TokensService } from '../src/auth/tokens.service';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Role } from '../src/generated/prisma/enums';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

const PASSWORD = 'Correct-Horse-9';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmId: string;
  let passwordHash: string;

  const http = () => request(app.getHttpServer() as App);

  async function makeUser(role: Role = 'COMMERCIAL', farmIds: string[] = []) {
    return createUser({ organizationId: orgId, role, farmIds, passwordHash });
  }

  const login = (email: string, password: string) =>
    http().post('/api/auth/login').send({ email, password });

  /** Reads the `ap_refresh` cookie value (name=value) from a response. */
  function refreshCookie(res: request.Response): string {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const c = cookies.find((x) => x.startsWith('ap_refresh='));
    if (!c) throw new Error('no ap_refresh cookie');
    return c.split(';')[0];
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

  it('logs in a non-mandatory role and sets an httpOnly refresh cookie', async () => {
    const user = await makeUser('COMMERCIAL', [farmId]);
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(200);
    const body = res.body as {
      accessToken: string;
      user: Record<string, unknown>;
    };
    expect(typeof body.accessToken).toBe('string');
    expect(body.user).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'COMMERCIAL',
      twoFactorEnabled: false,
      twoFactorMandatory: false,
    });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('ap_refresh='),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).not.toMatch(/Secure/i);
    // The issued token works on a protected route.
    const me = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('answers 401 with the same message for a wrong password and an unknown email', async () => {
    const user = await makeUser();
    const wrong = await login(user.email, 'not-the-password');
    const unknown = await login('nobody@test.local', 'not-the-password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((wrong.body as { message: string }).message).toBe(
      'Identifiants invalides',
    );
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('locks after 5 failures, then unlocks once lockedUntil has passed', async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i += 1) {
      const res = await login(user.email, 'wrong-password');
      expect(res.status).toBe(401);
    }
    const locked = await login(user.email, PASSWORD);
    expect(locked.status).toBe(423);
    const body = locked.body as { message: string; lockedUntil: string };
    expect(body.message).toMatch(/^Compte verrouillé/);
    expect(new Date(body.lockedUntil).getTime()).toBeGreaterThan(Date.now());
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLogins).toBe(5);
    const minutes = (row.lockedUntil!.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    const ok = await login(user.email, PASSWORD);
    expect(ok.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.failedLogins).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it('rejects an inactive user with the generic 401', async () => {
    const user = await createUser({
      organizationId: orgId,
      role: 'COMMERCIAL',
      active: false,
      passwordHash,
    });
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(401);
    expect((res.body as { message: string }).message).toBe(
      'Identifiants invalides',
    );
  });

  it('returns a setup token for a mandatory-2FA role without 2FA, and a challenge token once 2FA is enabled', async () => {
    const user = await makeUser('COMPTABLE');
    const setup = await login(user.email, PASSWORD);
    expect(setup.status).toBe(200);
    const sBody = setup.body as Record<string, unknown>;
    expect(sBody.twoFactorSetupRequired).toBe(true);
    expect(typeof sBody.setupToken).toBe('string');
    expect(sBody.accessToken).toBeUndefined();
    expect(setup.headers['set-cookie']).toBeUndefined();

    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: 'x', totpEnabledAt: new Date() },
    });
    const challenge = await login(user.email, PASSWORD);
    const cBody = challenge.body as Record<string, unknown>;
    expect(cBody.twoFactorRequired).toBe(true);
    expect(typeof cBody.challengeToken).toBe('string');
    expect(cBody.accessToken).toBeUndefined();
    expect(challenge.headers['set-cookie']).toBeUndefined();
    // A challenge token is not a full session.
    const me = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${cBody.challengeToken as string}`);
    expect(me.status).toBe(403);
  });

  it('refreshes with the cookie and rotates it', async () => {
    const user = await makeUser();
    const first = await login(user.email, PASSWORD);
    const cookie1 = refreshCookie(first);
    const res = await http().post('/api/auth/refresh').set('Cookie', cookie1);
    expect(res.status).toBe(200);
    const body = res.body as { accessToken: string; user: { id: string } };
    expect(typeof body.accessToken).toBe('string');
    expect(body.user.id).toBe(user.id);
    const cookie2 = refreshCookie(res);
    expect(cookie2).not.toBe(cookie1);
    const old = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: { not: null } },
    });
    expect(old).toHaveLength(1);
    expect(old[0].replacedById).not.toBeNull();
  });

  it('rejects refresh without a cookie, and for a deactivated user', async () => {
    const user = await makeUser();
    expect((await http().post('/api/auth/refresh')).status).toBe(401);
    const cookie = refreshCookie(await login(user.email, PASSWORD));
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });
    const res = await http().post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('detects refresh token reuse and revokes the whole family', async () => {
    const user = await makeUser();
    const other = refreshCookie(await login(user.email, PASSWORD)); // second device
    const cookie1 = refreshCookie(await login(user.email, PASSWORD));
    const rotated = await http()
      .post('/api/auth/refresh')
      .set('Cookie', cookie1);
    const cookie2 = refreshCookie(rotated);

    const replay = await http()
      .post('/api/auth/refresh')
      .set('Cookie', cookie1);
    expect(replay.status).toBe(401);

    const newer = await http().post('/api/auth/refresh').set('Cookie', cookie2);
    expect(newer.status).toBe(401);
    const otherDevice = await http()
      .post('/api/auth/refresh')
      .set('Cookie', other);
    expect(otherDevice.status).toBe(401);
    expect(
      await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('logout revokes the token and clears the cookie', async () => {
    const user = await makeUser();
    const cookie = refreshCookie(await login(user.email, PASSWORD));
    const out = await http().post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(
      (out.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('ap_refresh=;'),
      ),
    ).toBeDefined();
    const res = await http().post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('me returns only assigned farms for RESP_AVICOLE and all farms for PROPRIETAIRE', async () => {
    const farm2 = await createFarm(orgId, 'Ferme 2');
    const agri = await makeUser('RESP_AVICOLE', [farmId]);
    const owner = await makeUser('PROPRIETAIRE');

    const a = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${await tokenFor(agri.id)}`);
    expect(a.status).toBe(200);
    const aBody = a.body as {
      user: { id: string; role: string };
      farms: { id: string; name: string }[];
      permissions: Record<string, string[]>;
      canSeeAllFarms: boolean;
    };
    expect(aBody.user.role).toBe('RESP_AVICOLE');
    expect(aBody.farms).toEqual([
      { id: farmId, name: 'Ferme Test', active: true },
    ]);
    expect(aBody.canSeeAllFarms).toBe(false);
    expect(aBody.permissions.lots).toContain('create');
    expect(aBody.permissions.finance).toEqual([]);

    const o = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${await tokenFor(owner.id)}`);
    const oBody = o.body as typeof aBody;
    expect(oBody.farms.map((f) => f.id).sort()).toEqual(
      [farmId, farm2.id].sort(),
    );
    expect(oBody.canSeeAllFarms).toBe(true);
  });

  it('change-password validates input, then changes it and revokes the other sessions', async () => {
    const user = await makeUser();
    const auth = `Bearer ${await tokenFor(user.id)}`;
    const wrong = await http()
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ currentPassword: 'nope', newPassword: 'A-brand-new-pass-1' });
    expect(wrong.status).toBe(400);
    const short = await http()
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ currentPassword: PASSWORD, newPassword: 'short6' });
    expect(short.status).toBe(400);

    const current = refreshCookie(await login(user.email, PASSWORD));
    const otherDevice = refreshCookie(await login(user.email, PASSWORD));
    const ok = await http()
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .set('Cookie', current)
      .send({ currentPassword: PASSWORD, newPassword: 'A-brand-new-pass-1' });
    expect(ok.status).toBe(204);
    expect((await login(user.email, PASSWORD)).status).toBe(401);
    expect((await login(user.email, 'A-brand-new-pass-1')).status).toBe(200);
    // The calling session survives, the other device does not.
    expect(
      (await http().post('/api/auth/refresh').set('Cookie', current)).status,
    ).toBe(200);
    expect(
      (await http().post('/api/auth/refresh').set('Cookie', otherDevice))
        .status,
    ).toBe(401);
  });

  it('reset-password validates the token, enforces the policy, and unlocks the account', async () => {
    const { createHash } = await import('crypto');
    const user = await makeUser();
    const cookie = refreshCookie(await login(user.email, PASSWORD));
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 5, lockedUntil: new Date(Date.now() + 600000) },
    });
    const raw = 'reset-token-for-test-0123456789abcdef';
    const issue = (expiresAt: Date, rawToken = raw) =>
      prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt,
        },
      });
    const reset = (token: string, newPassword: string) =>
      http().post('/api/auth/reset-password').send({ token, newPassword });

    expect((await reset('unknown-token', 'Another-pass-123')).status).toBe(400);
    await issue(new Date(Date.now() + 3600000));
    expect((await reset(raw, 'short')).status).toBe(400);
    expect((await reset(raw, 'Another-pass-123')).status).toBe(204);
    expect((await reset(raw, 'Another-pass-456')).status).toBe(400); // used
    await issue(new Date(Date.now() - 1000), 'expired-token-0123456789');
    expect(
      (await reset('expired-token-0123456789', 'Another-pass-456')).status,
    ).toBe(400);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect((await login(user.email, 'Another-pass-123')).status).toBe(200);
    expect(
      (await http().post('/api/auth/refresh').set('Cookie', cookie)).status,
    ).toBe(401);
  });

  it('cannot bypass the lockout with parallel guesses', async () => {
    const user = await makeUser();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => login(user.email, 'wrong-password')),
    );
    expect(results.every((r) => r.status === 401 || r.status === 423)).toBe(
      true,
    );
    const ok = await login(user.email, PASSWORD);
    expect(ok.status).toBe(423);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLogins).toBeGreaterThanOrEqual(5);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a correct password that raced a lock', async () => {
    const user = await makeUser();
    const results = await Promise.all([
      ...Array.from({ length: 8 }, () => login(user.email, 'wrong-password')),
      login(user.email, PASSWORD),
    ]);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Whatever the interleaving, a success is only valid if no lock exists.
    const success = results.some((r) => r.status === 200);
    if (row.lockedUntil && row.lockedUntil > new Date()) {
      expect(row.failedLogins).toBeGreaterThanOrEqual(5);
    }
    expect(success && row.failedLogins >= 5 && row.lockedUntil === null).toBe(
      false,
    );
  });

  it('resets the failure counter on success (4 failures, success, 1 failure)', async () => {
    const user = await makeUser();
    for (let i = 0; i < 4; i += 1) await login(user.email, 'wrong-password');
    expect((await login(user.email, PASSWORD)).status).toBe(200);
    expect((await login(user.email, 'wrong-password')).status).toBe(401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedLogins).toBe(1);
    expect(row.lockedUntil).toBeNull();
  });

  it('keeps the calling session alive when another revoked device refreshes', async () => {
    const user = await makeUser();
    const auth = `Bearer ${await tokenFor(user.id)}`;
    const current = refreshCookie(await login(user.email, PASSWORD));
    const otherDevice = refreshCookie(await login(user.email, PASSWORD));
    const ok = await http()
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .set('Cookie', current)
      .send({ currentPassword: PASSWORD, newPassword: 'A-brand-new-pass-1' });
    expect(ok.status).toBe(204);
    expect(
      (await http().post('/api/auth/refresh').set('Cookie', otherDevice))
        .status,
    ).toBe(401);
    expect(
      (await http().post('/api/auth/refresh').set('Cookie', current)).status,
    ).toBe(200);
  });

  it('normalises the email case on login', async () => {
    const user = await makeUser();
    const res = await login(`  ${user.email.toUpperCase()} `, PASSWORD);
    expect(res.status).toBe(200);
  });

  it('writes a LoginLog row for every attempt with the right success flag', async () => {
    const user = await makeUser();
    await login(user.email, 'wrong-password');
    await login('nobody@test.local', 'wrong-password');
    await login(user.email, PASSWORD);
    const logs = await prisma.loginLog.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => [l.email, l.success, l.userId === user.id])).toEqual(
      [
        [user.email, false, true],
        ['nobody@test.local', false, false],
        [user.email, true, true],
      ],
    );
  });
  describe('self-service security actions', () => {
    const securityRows = () =>
      prisma.auditLog.findMany({
        where: { module: 'utilisateurs' },
        orderBy: { createdAt: 'asc' },
      });

    it('change-password writes an audit row with the user, organisation and no secret', async () => {
      const user = await makeUser();
      await http()
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${await tokenFor(user.id)}`)
        .send({ currentPassword: PASSWORD, newPassword: 'A-brand-new-pass-1' })
        .expect(204);
      const rows = await securityRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'OTHER',
        module: 'utilisateurs',
        label: 'Mot de passe modifié',
        userId: user.id,
        userName: user.name,
        organizationId: orgId,
        recordId: user.id,
      });
      expect(JSON.stringify(rows)).not.toContain('A-brand-new-pass-1');
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    });

    it('a wrong current password writes no audit row', async () => {
      const user = await makeUser();
      await http()
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${await tokenFor(user.id)}`)
        .send({ currentPassword: 'nope', newPassword: 'A-brand-new-pass-1' })
        .expect(400);
      expect(await securityRows()).toHaveLength(0);
    });

    it('reset-password redemption writes an audit row without the token', async () => {
      const { createHash } = await import('crypto');
      const user = await makeUser();
      const raw = 'reset-token-for-audit-0123456789abcdef';
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      await http()
        .post('/api/auth/reset-password')
        .send({ token: raw, newPassword: 'Another-pass-123' })
        .expect(204);
      const rows = await securityRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'OTHER',
        label: 'Mot de passe réinitialisé par lien',
        userId: user.id,
        userName: user.name,
        organizationId: orgId,
      });
      expect(JSON.stringify(rows)).not.toContain(raw);
      expect(JSON.stringify(rows)).not.toContain('Another-pass-123');
    });

    it('change-password counts wrong current passwords and locks the account with 423', async () => {
      const user = await makeUser();
      const auth = `Bearer ${await tokenFor(user.id)}`;
      const change = (currentPassword: string) =>
        http()
          .post('/api/auth/change-password')
          .set('Authorization', auth)
          .send({ currentPassword, newPassword: 'A-brand-new-pass-1' });
      for (let i = 0; i < 5; i += 1) {
        expect((await change('wrong-password')).status).toBe(400);
      }
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.failedLogins).toBe(5);
      expect(row.lockedUntil).not.toBeNull();
      // Locked: even the right password is refused, and so is login.
      const locked = await change(PASSWORD);
      expect(locked.status).toBe(423);
      expect((await login(user.email, PASSWORD)).status).toBe(423);
      expect(await securityRows()).toHaveLength(0);
    });

    it('a successful change-password resets the failure counter', async () => {
      const user = await makeUser();
      const auth = `Bearer ${await tokenFor(user.id)}`;
      await http()
        .post('/api/auth/change-password')
        .set('Authorization', auth)
        .send({ currentPassword: 'wrong', newPassword: 'A-brand-new-pass-1' })
        .expect(400);
      await http()
        .post('/api/auth/change-password')
        .set('Authorization', auth)
        .send({ currentPassword: PASSWORD, newPassword: 'A-brand-new-pass-1' })
        .expect(204);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.failedLogins).toBe(0);
    });
  });

  it('exposes twoFactorMandatory on /me, login and refresh, and active on the farms', async () => {
    const mandatory = await makeUser('COMMERCIAL', [farmId]);
    const me = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${await tokenFor(mandatory.id)}`)
      .expect(200);
    const body = me.body as {
      user: { twoFactorMandatory: boolean; twoFactorEnabled: boolean };
      farms: { id: string; name: string; active: boolean }[];
    };
    expect(body.user.twoFactorMandatory).toBe(false);
    expect(body.user.twoFactorEnabled).toBe(false);
    expect(body.farms[0]).toMatchObject({ id: farmId, active: true });

    const signedIn = await login(mandatory.email, PASSWORD);
    expect(
      (signedIn.body as { user: { twoFactorMandatory: boolean } }).user
        .twoFactorMandatory,
    ).toBe(false);
    const refreshed = await http()
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie(signedIn))
      .expect(200);
    expect(
      (refreshed.body as { user: { twoFactorMandatory: boolean } }).user
        .twoFactorMandatory,
    ).toBe(false);

    const compta = await makeUser('COMPTABLE', [farmId]);
    const comptaMe = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${await tokenFor(compta.id)}`)
      .expect(200);
    expect(
      (comptaMe.body as { user: { twoFactorMandatory: boolean } }).user
        .twoFactorMandatory,
    ).toBe(true);
  });

  it('purgeExpired deletes refresh tokens expired or revoked over 30 days ago and keeps the rest', async () => {
    const user = await makeUser();
    const day = 24 * 60 * 60 * 1000;
    const make = (tokenHash: string, expiresAt: Date, revokedAt?: Date) =>
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash, expiresAt, revokedAt },
      });
    const future = new Date(Date.now() + day);
    await make('long-expired', new Date(Date.now() - 40 * day));
    await make('long-revoked', future, new Date(Date.now() - 31 * day));
    await make('recently-expired', new Date(Date.now() - 2 * day));
    await make('recently-revoked', future, new Date(Date.now() - 2 * day));
    await make('live', future);
    const removed = await app.get(TokensService).purgeExpired();
    expect(removed).toBe(2);
    const left = await prisma.refreshToken.findMany({
      select: { tokenHash: true },
    });
    expect(left.map((t) => t.tokenHash).sort()).toEqual([
      'live',
      'recently-expired',
      'recently-revoked',
    ]);
  });
});
