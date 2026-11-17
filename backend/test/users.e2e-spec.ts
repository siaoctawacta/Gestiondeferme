import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { UsersService } from '../src/admin/users/users.service';
import { hashPassword } from '../src/auth/password';
import { encrypt } from '../src/auth/crypto';
import { sha256 } from '../src/auth/tokens.service';
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

interface UserView {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  farms: { id: string; name: string }[];
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
}

const PASSWORD = 'Correct-Horse-9';
const LAST_ADMIN = 'Au moins un Super Administrateur actif est requis';

describe('Users and settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let otherOrgFarm: string;
  let passwordHash: string;

  const http = () => request(app.getHttpServer() as App);

  async function actor(role: Role, farmIds: string[] = [farmA]) {
    const user = await createUser({
      organizationId: orgId,
      role,
      farmIds,
      passwordHash,
    });
    const token = await tokenFor(user.id);
    return { user, headers: { Authorization: `Bearer ${token}` } };
  }

  const newUser = (over: Record<string, unknown> = {}) => ({
    name: 'Koffi Agent',
    email: 'Koffi@Example.com ',
    role: 'AGENT_ELEVAGE',
    farmIds: [farmA],
    password: PASSWORD,
    ...over,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaService();
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await resetDb();
    orgId = (await createOrganization()).id;
    farmA = (await createFarm(orgId, 'Ferme A')).id;
    farmB = (await createFarm(orgId, 'Ferme B')).id;
    const other = await createOrganization('Autre');
    otherOrgFarm = (await createFarm(other.id, 'Z')).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('users', () => {
    it('SUPER_ADMIN creates a user: normalised email, no secrets, can log in', async () => {
      const admin = await actor('SUPER_ADMIN');
      const res = await http()
        .post('/api/users')
        .set(admin.headers)
        .send(newUser())
        .expect(201);
      const u = res.body as UserView;
      expect(u).toMatchObject({
        name: 'Koffi Agent',
        email: 'koffi@example.com',
        role: 'AGENT_ELEVAGE',
        active: true,
        twoFactorEnabled: false,
        lastLoginAt: null,
        farms: [{ id: farmA, name: 'Ferme A' }],
      });
      expect(Object.keys(u).sort()).toEqual(
        [
          'active',
          'email',
          'farms',
          'id',
          'lastLoginAt',
          'name',
          'role',
          'twoFactorEnabled',
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

      await http()
        .post('/api/auth/login')
        .send({ email: 'koffi@example.com', password: PASSWORD })
        .expect(200);
      const stored = await prisma.auditLog.findMany({
        where: { module: 'utilisateurs' },
      });
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored[0].after)).not.toMatch(
        /passwordHash|argon2/,
      );
    });

    it('rejects duplicate email (409), bad role, weak password, foreign farm (400)', async () => {
      const admin = await actor('SUPER_ADMIN');
      await http()
        .post('/api/users')
        .set(admin.headers)
        .send(newUser())
        .expect(201);
      await http()
        .post('/api/users')
        .set(admin.headers)
        .send(newUser({ email: 'KOFFI@example.com' }))
        .expect(409);
      for (const over of [
        { email: 'a@b.c', role: 'ROI' },
        { email: 'b@b.c', password: 'court' },
        { email: 'c@b.c', farmIds: [otherOrgFarm] },
        { email: 'd@b.c', farmIds: ['inconnue'] },
        { email: 'pas-un-email' },
        { email: 'e@b.c', name: ' ' },
      ]) {
        await http()
          .post('/api/users')
          .set(admin.headers)
          .send(newUser(over))
          .expect(400);
      }
    });

    it('requires a farm for farm-limited roles, not for all-farms roles', async () => {
      const admin = await actor('SUPER_ADMIN');
      const res = await http()
        .post('/api/users')
        .set(admin.headers)
        .send(newUser({ role: 'RESP_AVICOLE', farmIds: [] }))
        .expect(400);
      expect((res.body as { message: string }).message).toBe(
        'Au moins une ferme est requise pour ce rôle',
      );
      await http()
        .post('/api/users')
        .set(admin.headers)
        .send(
          newUser({ email: 'aud@example.com', role: 'AUDITEUR', farmIds: [] }),
        )
        .expect(201);

      const u = (
        await http()
          .post('/api/users')
          .set(admin.headers)
          .send(newUser({ email: 'agent@example.com' }))
      ).body as UserView;
      // Emptying the farms of a farm-limited role, or moving an unassigned user to one, is refused.
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ farmIds: [] })
        .expect(400);
      const aud = (
        await http()
          .post('/api/users')
          .set(admin.headers)
          .send(
            newUser({
              email: 'aud2@example.com',
              role: 'AUDITEUR',
              farmIds: [],
            }),
          )
      ).body as UserView;
      await http()
        .patch(`/api/users/${aud.id}`)
        .set(admin.headers)
        .send({ role: 'COMMERCIAL' })
        .expect(400);
      await http()
        .patch(`/api/users/${aud.id}`)
        .set(admin.headers)
        .send({ role: 'COMMERCIAL', farmIds: [farmA] })
        .expect(200);
      // Existing farms are kept when only the role changes.
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ role: 'COMMERCIAL' })
        .expect(200);
    });

    it('lets a legacy farm-less user be renamed or deactivated, but not re-roled', async () => {
      const admin = await actor('SUPER_ADMIN');
      const legacy = await createUser({
        organizationId: orgId,
        role: 'RESP_AVICOLE',
        farmIds: [],
        passwordHash,
      });
      await http()
        .patch(`/api/users/${legacy.id}`)
        .set(admin.headers)
        .send({ name: 'Renommé' })
        .expect(200);
      await http()
        .patch(`/api/users/${legacy.id}`)
        .set(admin.headers)
        .send({ active: false })
        .expect(200);
      await http()
        .patch(`/api/users/${legacy.id}`)
        .set(admin.headers)
        .send({ role: 'COMMERCIAL' })
        .expect(400);
    });

    it('enforces permissions: DIRECTEUR_FERME 403, AUDITEUR read-only', async () => {
      const director = await actor('DIRECTEUR_FERME');
      await http().get('/api/users').set(director.headers).expect(403);
      const auditor = await actor('AUDITEUR');
      await http().get('/api/users').set(auditor.headers).expect(200);
      await http()
        .post('/api/users')
        .set(auditor.headers)
        .send(newUser())
        .expect(403);
    });

    it('lists the organisation users only, with search, sort and pagination', async () => {
      const admin = await actor('SUPER_ADMIN');
      const other = await createOrganization('Autre 2');
      await createUser({
        organizationId: other.id,
        role: 'COMMERCIAL',
        name: 'Intrus',
      });
      await http()
        .post('/api/users')
        .set(admin.headers)
        .send(newUser({ name: 'Zoé', email: 'zoe@example.com' }));
      await http()
        .post('/api/users')
        .set(admin.headers)
        .send(newUser({ name: 'Abla', email: 'abla@example.com' }));
      const page = (
        await http()
          .get('/api/users?sort=name:asc')
          .set(admin.headers)
          .expect(200)
      ).body as { items: UserView[]; total: number };
      expect(page.total).toBe(3);
      expect(page.items.map((u) => u.name)).not.toContain('Intrus');
      const search = (
        await http()
          .get('/api/users?search=ZOE@')
          .set(admin.headers)
          .expect(200)
      ).body as { items: UserView[] };
      expect(search.items.map((u) => u.name)).toEqual(['Zoé']);
      const p2 = (
        await http().get('/api/users?pageSize=2&page=2').set(admin.headers)
      ).body as { items: unknown[] };
      expect(p2.items).toHaveLength(1);
      await http()
        .get('/api/users?sort=passwordHash:asc')
        .set(admin.headers)
        .expect(400);
      await http()
        .get('/api/users?format=csv')
        .set(admin.headers)
        .expect(200)
        .expect('Content-Type', /text\/csv/);
    });

    it('exports the exact French role labels', async () => {
      const admin = await actor('SUPER_ADMIN');
      const labels: Record<string, string> = {
        SUPER_ADMIN: 'Super Administrateur',
        PROPRIETAIRE: 'Propriétaire / Direction',
        DIRECTEUR_FERME: 'Directeur de ferme',
        RESP_AVICOLE: 'Responsable avicole',
        RESP_PORCIN: 'Responsable porcin',
        VETERINAIRE: 'Vétérinaire',
        RESP_STOCK: 'Responsable stock',
        COMPTABLE: 'Comptable',
        COMMERCIAL: 'Commercial',
        AGENT_ELEVAGE: "Agent d'élevage",
        MAGASINIER: 'Magasinier',
        AUDITEUR: 'Auditeur',
      };
      for (const role of Object.keys(labels)) {
        if (role !== 'SUPER_ADMIN') await actor(role as Role);
      }
      const res = await http()
        .get('/api/users?format=csv&pageSize=200')
        .set(admin.headers)
        .expect(200);
      const text = res.text;
      for (const label of Object.values(labels)) {
        expect(text).toContain(label);
      }
    });

    it('updates name, role, active and farms; never the password', async () => {
      const admin = await actor('SUPER_ADMIN');
      const u = (
        await http().post('/api/users').set(admin.headers).send(newUser())
      ).body as UserView;
      const res = await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ name: 'Nouveau', role: 'COMMERCIAL', farmIds: [farmB] })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Nouveau',
        role: 'COMMERCIAL',
        farms: [{ id: farmB, name: 'Ferme B' }],
      });
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ password: 'Autre-Mot-De-Passe-1' })
        .expect(400);
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ farmIds: [otherOrgFarm] })
        .expect(400);
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ role: 'ROI' })
        .expect(400);
    });

    it('revokes refresh tokens on deactivation and on role change', async () => {
      const admin = await actor('SUPER_ADMIN');
      const u = (
        await http().post('/api/users').set(admin.headers).send(newUser())
      ).body as UserView;
      const live = async () =>
        prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } });
      const login = () =>
        http()
          .post('/api/auth/login')
          .send({ email: 'koffi@example.com', password: PASSWORD })
          .expect(200);

      await login();
      expect(await live()).toBe(1);
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ name: 'Renommé' })
        .expect(200);
      expect(await live()).toBe(1);
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ role: 'COMMERCIAL' })
        .expect(200);
      expect(await live()).toBe(0);

      await login();
      await http()
        .patch(`/api/users/${u.id}`)
        .set(admin.headers)
        .send({ active: false })
        .expect(200);
      expect(await live()).toBe(0);
      await http()
        .post('/api/auth/login')
        .send({ email: 'koffi@example.com', password: PASSWORD })
        .expect(401);
    });

    it('404 for a user of another organisation', async () => {
      const admin = await actor('SUPER_ADMIN');
      const other = await createOrganization('Autre 3');
      const foreign = await createUser({
        organizationId: other.id,
        role: 'COMMERCIAL',
      });
      await http()
        .patch(`/api/users/${foreign.id}`)
        .set(admin.headers)
        .send({ name: 'x' })
        .expect(404);
      await http()
        .delete(`/api/users/${foreign.id}`)
        .set(admin.headers)
        .expect(404);
      await http()
        .post(`/api/users/${foreign.id}/reset-link`)
        .set(admin.headers)
        .expect(404);
      await http()
        .post(`/api/users/${foreign.id}/reset-2fa`)
        .set(admin.headers)
        .expect(404);
    });

    it('protects the last active SUPER_ADMIN and the caller themselves', async () => {
      const admin = await actor('SUPER_ADMIN');
      const url = `/api/users/${admin.user.id}`;
      await http()
        .delete(url)
        .set(admin.headers)
        .expect(409)
        .expect(({ body }) => {
          expect((body as { message: string }).message).toBe(LAST_ADMIN);
        });
      await http()
        .patch(url)
        .set(admin.headers)
        .send({ active: false })
        .expect(409)
        .expect(({ body }) => {
          expect((body as { message: string }).message).toBe(LAST_ADMIN);
        });
      await http()
        .patch(url)
        .set(admin.headers)
        .send({ role: 'PROPRIETAIRE' })
        .expect(409)
        .expect(({ body }) => {
          expect((body as { message: string }).message).toBe(LAST_ADMIN);
        });

      // With a second admin, the last-admin rule no longer applies but self-protection does.
      const second = await actor('SUPER_ADMIN');
      await http().delete(url).set(admin.headers).expect(409);
      await http()
        .patch(url)
        .set(admin.headers)
        .send({ active: false })
        .expect(409);
      // An inactive second admin does not count.
      await prisma.user.update({
        where: { id: second.user.id },
        data: { active: false },
      });
      await http()
        .patch(url)
        .set(admin.headers)
        .send({ role: 'AUDITEUR' })
        .expect(409);
      await prisma.user.update({
        where: { id: second.user.id },
        data: { active: true },
      });
      // Demoting the other admin is fine while the caller stays.
      await http()
        .patch(`/api/users/${second.user.id}`)
        .set(admin.headers)
        .send({ active: false })
        .expect(200);
    });

    it('decides on the locked row, not on a stale snapshot (last admin)', async () => {
      const sole = await actor('SUPER_ADMIN');
      const service = app.get(UsersService);
      // A snapshot taken before the user was promoted: it still says COMMERCIAL.
      const stale = jest
        .spyOn(service as unknown as { load: () => Promise<unknown> }, 'load')
        .mockResolvedValue({ role: 'COMMERCIAL', active: true });
      const ctx = {
        user: {
          id: 'someone-else',
          name: 'Autre',
          role: 'PROPRIETAIRE' as const,
          organizationId: orgId,
        },
        farmId: null,
        allFarms: false,
        farmIds: [],
      };
      try {
        await expect(
          service.update(ctx, sole.user.id, { active: false }),
        ).rejects.toThrow('Au moins un Super Administrateur actif est requis');
        await expect(service.remove(ctx, sole.user.id)).rejects.toThrow(
          'Au moins un Super Administrateur actif est requis',
        );
      } finally {
        stale.mockRestore();
      }
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: sole.user.id },
      });
      expect(row.active).toBe(true);
    });

    it('two concurrent demotions of the two admins never leave zero', async () => {
      const a = await actor('SUPER_ADMIN');
      const b = await actor('SUPER_ADMIN');
      const demote = (by: typeof a, target: typeof a) =>
        http()
          .patch(`/api/users/${target.user.id}`)
          .set(by.headers)
          .send({ role: 'COMMERCIAL' });
      const statuses = (await Promise.all([demote(a, b), demote(b, a)]))
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual([200, 409]);
      expect(await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })).toBe(
        1,
      );
    });

    it('hard delete: refused with history, allowed without', async () => {
      const admin = await actor('SUPER_ADMIN');
      const fresh = (
        await http().post('/api/users').set(admin.headers).send(newUser())
      ).body as UserView;
      await http()
        .post('/api/auth/login')
        .send({ email: 'koffi@example.com', password: PASSWORD })
        .expect(200);
      const refused = await http()
        .delete(`/api/users/${fresh.id}`)
        .set(admin.headers)
        .expect(409);
      expect((refused.body as { message: string }).message).toBe(
        'Cet utilisateur a un historique ; désactivez-le plutôt',
      );

      const clean = await createUser({
        organizationId: orgId,
        role: 'COMMERCIAL',
        farmIds: [farmA],
      });
      await prisma.refreshToken.create({
        data: {
          userId: clean.id,
          tokenHash: 'x',
          expiresAt: new Date(Date.now() + 1e6),
        },
      });
      await http()
        .delete(`/api/users/${clean.id}`)
        .set(admin.headers)
        .expect(200);
      expect(await prisma.user.count({ where: { id: clean.id } })).toBe(0);
      expect(await prisma.userFarm.count({ where: { userId: clean.id } })).toBe(
        0,
      );
      expect(
        await prisma.refreshToken.count({ where: { userId: clean.id } }),
      ).toBe(0);
    });

    it('reset-link: one-time, 24 h, previous links invalidated, tokens revoked', async () => {
      const admin = await actor('SUPER_ADMIN');
      const u = (
        await http().post('/api/users').set(admin.headers).send(newUser())
      ).body as UserView;
      await http()
        .post('/api/auth/login')
        .send({ email: 'koffi@example.com', password: PASSWORD })
        .expect(200);

      const first = await http()
        .post(`/api/users/${u.id}/reset-link`)
        .set(admin.headers)
        .expect(201);
      const { url, expiresAt } = first.body as {
        url: string;
        expiresAt: string;
      };
      expect(url).toMatch(
        new RegExp(`^${process.env.WEB_ORIGIN}/reset/[0-9a-f]{64}$`),
      );
      const ttl = new Date(expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(23.9 * 3600_000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
      expect(
        await prisma.refreshToken.count({
          where: { userId: u.id, revokedAt: null },
        }),
      ).toBe(0);
      // Only the hash is stored.
      const token = url.split('/').pop()!;
      expect(
        await prisma.passwordReset.count({ where: { tokenHash: token } }),
      ).toBe(0);
      expect(
        await prisma.passwordReset.count({
          where: { tokenHash: sha256(token) },
        }),
      ).toBe(1);
      // The raw token never reaches the audit trail.
      expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(
        token,
      );

      // A newer link kills the previous one.
      const second = await http()
        .post(`/api/users/${u.id}/reset-link`)
        .set(admin.headers)
        .expect(201);
      const token2 = (second.body as { url: string }).url.split('/').pop()!;
      await http()
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'Nouveau-Mot-De-Passe-2' })
        .expect(400);
      await http()
        .post('/api/auth/reset-password')
        .send({ token: token2, newPassword: 'Nouveau-Mot-De-Passe-2' })
        .expect(204);
      await http()
        .post('/api/auth/reset-password')
        .send({ token: token2, newPassword: 'Encore-Un-Autre-3' })
        .expect(400);
      await http()
        .post('/api/auth/login')
        .send({
          email: 'koffi@example.com',
          password: 'Nouveau-Mot-De-Passe-2',
        })
        .expect(200);

      // An expired link is refused.
      const third = await http()
        .post(`/api/users/${u.id}/reset-link`)
        .set(admin.headers);
      const token3 = (third.body as { url: string }).url.split('/').pop()!;
      await prisma.passwordReset.update({
        where: { tokenHash: sha256(token3) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http()
        .post('/api/auth/reset-password')
        .send({ token: token3, newPassword: 'Nouveau-Mot-De-Passe-3' })
        .expect(400);
    });

    it('reset-2fa clears the second factor and forces a new enrolment', async () => {
      const admin = await actor('SUPER_ADMIN');
      const target = await createUser({
        organizationId: orgId,
        role: 'COMPTABLE',
        passwordHash,
      });
      await prisma.user.update({
        where: { id: target.id },
        data: {
          totpSecretEnc: encrypt('JBSWY3DPEHPK3PXP'),
          totpEnabledAt: new Date(),
          totpLastStep: 42,
          backupCodes: ['abc', 'def'],
        },
      });
      await prisma.refreshToken.create({
        data: {
          userId: target.id,
          tokenHash: 'y',
          expiresAt: new Date(Date.now() + 1e6),
        },
      });
      const before = await http()
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(200);
      expect(before.body).toHaveProperty('twoFactorRequired', true);

      await http()
        .post(`/api/users/${target.id}/reset-2fa`)
        .set(admin.headers)
        .expect(204);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row).toMatchObject({
        totpSecretEnc: null,
        totpEnabledAt: null,
        totpLastStep: null,
        backupCodes: [],
      });
      expect(
        await prisma.refreshToken.count({
          where: { userId: target.id, revokedAt: null },
        }),
      ).toBe(0);
      const after = await http()
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(200);
      expect(after.body).toHaveProperty('twoFactorSetupRequired', true);
    });
  });

  describe('settings', () => {
    it('ignores a value stored for the removed biosecurityWarningDays setting', async () => {
      const admin = await actor('SUPER_ADMIN');
      await prisma.setting.create({
        data: {
          organizationId: admin.user.organizationId,
          key: 'biosecurityWarningDays',
          value: 2,
        },
      });
      const res = await http()
        .get('/api/settings')
        .set(admin.headers)
        .expect(200);
      expect(res.body).not.toHaveProperty('biosecurityWarningDays');
    });

    it('returns every known key with its default, then the stored value', async () => {
      const admin = await actor('SUPER_ADMIN');
      const res = await http()
        .get('/api/settings')
        .set(admin.headers)
        .expect(200);
      expect(res.body).toEqual({
        currency: 'FCFA',
        mortalityDailyPct: 0.5,
        mortalityCumulPct: 3,
        consumptionDeviationPct: 25,
        expiryWarningDays: 30,
        farrowingWarningDays: 7,
        vaccinationWarningDays: 3,
        maintenanceWarningDays: 0,
        gestationDays: 114,
        invoiceDueDays: 15,
        eggsPerTray: 30,
        legal: { name: '', address: '', nif: '', rccm: '' },
      });
      await http()
        .put('/api/settings/gestationDays')
        .set(admin.headers)
        .send({ value: 115 })
        .expect(200);
      await http()
        .put('/api/settings/gestationDays')
        .set(admin.headers)
        .send({ value: 114 })
        .expect(200);
      await http()
        .put('/api/settings/legal')
        .set(admin.headers)
        .send({
          value: {
            name: 'AgriPilot SARL',
            address: 'Lomé',
            nif: '1',
            rccm: '2',
          },
        })
        .expect(200);
      const after = (await http().get('/api/settings').set(admin.headers))
        .body as Record<string, unknown>;
      expect(after.gestationDays).toBe(114);
      expect(after.legal).toMatchObject({ name: 'AgriPilot SARL' });
      expect(await prisma.setting.count()).toBe(2);
      expect(
        await prisma.auditLog.count({ where: { module: 'parametres' } }),
      ).toBe(3);
    });

    it('validates per key and rejects unknown keys', async () => {
      const admin = await actor('SUPER_ADMIN');
      const put = (key: string, value: unknown) =>
        http().put(`/api/settings/${key}`).set(admin.headers).send({ value });
      await put('nope', 1).expect(400);
      await http()
        .put('/api/settings/gestationDays')
        .set(admin.headers)
        .send({})
        .expect(400);
      for (const bad of [0, -1, '114', null, Number.MAX_VALUE * 10]) {
        await put('gestationDays', bad).expect(400);
      }
      await put('mortalityDailyPct', 0.75).expect(200);
      // Day counts are whole numbers; percentages stay within ]0, 100].
      for (const key of [
        'expiryWarningDays',
        'farrowingWarningDays',
        'vaccinationWarningDays',
        'gestationDays',
        'invoiceDueDays',
        'eggsPerTray',
      ]) {
        for (const bad of [1.5, 0.5, -3, 0, '7', null]) {
          await put(key, bad).expect(400);
        }
        await put(key, 21).expect(200);
      }
      // The biosecurity tolerance no longer exists: unknown key.
      await put('biosecurityWarningDays', 2).expect(400);
      for (const key of [
        'mortalityDailyPct',
        'mortalityCumulPct',
        'consumptionDeviationPct',
      ]) {
        for (const bad of [0, -1, 100.01, 101, 1000, '50', null]) {
          await put(key, bad).expect(400);
        }
        await put(key, 100).expect(200);
        await put(key, 0.1).expect(200);
      }
      await put('currency', '').expect(400);
      await put('currency', 'x'.repeat(11)).expect(400);
      await put('currency', 12).expect(400);
      await put('currency', 'XOF').expect(200);
      await put('legal', 'texte').expect(400);
      await put('legal', { name: 'a', address: 'b', nif: 'c' }).expect(400);
      await put('legal', { name: 'a', address: 'b', nif: 'c', rccm: 4 }).expect(
        400,
      );
    });

    it('is SUPER_ADMIN-write, AUDITEUR-read; others forbidden', async () => {
      const auditor = await actor('AUDITEUR');
      await http().get('/api/settings').set(auditor.headers).expect(200);
      await http()
        .put('/api/settings/currency')
        .set(auditor.headers)
        .send({ value: 'XOF' })
        .expect(403);
      const director = await actor('DIRECTEUR_FERME');
      await http().get('/api/settings').set(director.headers).expect(403);
    });

    it('keeps settings per organisation', async () => {
      const admin = await actor('SUPER_ADMIN');
      await http()
        .put('/api/settings/currency')
        .set(admin.headers)
        .send({ value: 'XOF' })
        .expect(200);
      const other = await createOrganization('Autre 4');
      const otherAdmin = await createUser({
        organizationId: other.id,
        role: 'SUPER_ADMIN',
      });
      const res = await http()
        .get('/api/settings')
        .set({ Authorization: `Bearer ${await tokenFor(otherAdmin.id)}` });
      expect((res.body as { currency: string }).currency).toBe('FCFA');
    });
  });
});
