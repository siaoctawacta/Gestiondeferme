import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
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
  tokenFor,
} from './setup';

const PASSWORD = 'Correct-Horse-9';

interface AuditRow {
  id: string;
  userName: string;
  action: string;
  module: string;
  label: string | null;
  recordId: string | null;
  farmId: string | null;
  before: unknown;
  after: unknown;
}
interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

describe('Audit trail (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orgId: string;
  let farmId: string;
  let passwordHash: string;

  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function actor(role: Role, name = 'Agent Test') {
    const user = await createUser({
      organizationId: orgId,
      role,
      farmIds: [farmId],
      passwordHash,
      name,
    });
    const token = await tokenFor(user.id);
    return {
      user,
      headers: { ...bearer(token), 'X-Farm-Id': farmId },
      token,
    };
  }

  const rows = () =>
    prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });

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

  describe('@Audited interceptor', () => {
    it('logs CREATE with user, module, farm, organisation and after', async () => {
      const { user, headers } = await actor('SUPER_ADMIN', 'Awa Admin');
      const res = await http()
        .post('/api/_audit_probe')
        .set(headers)
        .send({ name: 'Poulailler 1' })
        .expect(201);
      const body = res.body as { id: string };

      const logs = await rows();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'CREATE',
        module: 'lots',
        userId: user.id,
        userName: 'Awa Admin',
        organizationId: orgId,
        farmId,
        recordId: body.id,
        label: 'Poulailler 1',
        before: null,
      });
      expect((logs[0].after as { name: string }).name).toBe('Poulailler 1');
    });

    it('logs UPDATE with before and after', async () => {
      const { headers } = await actor('SUPER_ADMIN');
      const created = await http()
        .post('/api/_audit_probe')
        .set(headers)
        .send({ name: 'Avant' });
      const { id } = created.body as { id: string };
      await http()
        .patch(`/api/_audit_probe/${id}`)
        .set(headers)
        .send({ name: 'Après' })
        .expect(200);

      const update = (await rows()).find((r) => r.action === 'UPDATE')!;
      expect(update.recordId).toBe(id);
      expect((update.before as { name: string }).name).toBe('Avant');
      expect((update.after as { name: string }).name).toBe('Après');
      expect(update.label).toBe('Après');
    });

    it('logs DELETE with the route id and the removed record as before', async () => {
      const { headers } = await actor('SUPER_ADMIN');
      const created = await http()
        .post('/api/_audit_probe')
        .set(headers)
        .send({ name: 'À supprimer' });
      const { id } = created.body as { id: string };
      await http().delete(`/api/_audit_probe/${id}`).set(headers).expect(200);

      const del = (await rows()).find((r) => r.action === 'DELETE')!;
      expect(del.recordId).toBe(id);
      expect((del.before as { name: string }).name).toBe('À supprimer');
      expect(del.label).toBe('À supprimer');
    });

    it('records nothing when validation fails or permission is denied', async () => {
      const { headers } = await actor('SUPER_ADMIN');
      await http()
        .post('/api/_audit_probe')
        .set(headers)
        .send({ name: '' })
        .expect(400);
      const agent = await actor('AGENT_ELEVAGE');
      await http()
        .patch('/api/_audit_probe/x')
        .set(agent.headers)
        .send({ name: 'x' })
        .expect(403);
      await http()
        .patch('/api/_audit_probe/missing')
        .set(headers)
        .send({ name: 'x' })
        .expect(404);
      expect(await rows()).toHaveLength(0);
    });

    it('does nothing on routes without @Audited', async () => {
      const { headers } = await actor('SUPER_ADMIN');
      await http()
        .post('/api/_audit_probe/silent')
        .set(headers)
        .send({ name: 'x' })
        .expect(201);
      expect(await rows()).toHaveLength(0);
    });

    it('strips sensitive keys at every depth', async () => {
      const { headers } = await actor('SUPER_ADMIN');
      await http().post('/api/_audit_probe').set(headers).send({ name: 'S' });
      const json = JSON.stringify((await rows())[0].after);
      expect(json).not.toContain('passwordHash');
      expect(json).not.toContain('tokenHash');
      expect(json).not.toContain('backupCodes');
      expect(json).not.toContain('argon2-secret');
      expect(json).toContain('"name":"S"');
    });

    it('lets the response through when the audit write fails', async () => {
      const { headers } = await actor('SUPER_ADMIN');
      const spy = jest
        .spyOn(app.get(PrismaService).auditLog, 'create')
        .mockRejectedValue(new Error('db down'));
      // Silence the expected server-side error log for pristine output.
      const { Logger } = await import('@nestjs/common');
      const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      try {
        await http()
          .post('/api/_audit_probe')
          .set(headers)
          .send({ name: 'Survit' })
          .expect(201);
        expect(logSpy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe('GET /api/audit', () => {
    it('is forbidden for AGENT_ELEVAGE and allowed for AUDITEUR', async () => {
      const agent = await actor('AGENT_ELEVAGE');
      await http().get('/api/audit').set(agent.headers).expect(403);
      const auditor = await actor('AUDITEUR');
      await http().get('/api/audit').set(auditor.headers).expect(200);
    });

    it('requires authentication', async () => {
      await http().get('/api/audit').expect(401);
    });

    it('exposes no write endpoint', async () => {
      const admin = await actor('SUPER_ADMIN');
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await http()[method]('/api/audit').set(admin.headers);
        expect(res.status).toBe(404);
      }
    });

    it('lists the organisation rows newest first, farm header optional', async () => {
      const admin = await actor('SUPER_ADMIN');
      const farm2 = await createFarm(orgId, 'Ferme 2');
      await prisma.auditLog.createMany({
        data: [
          {
            organizationId: orgId,
            userName: 'A',
            module: 'lots',
            action: 'CREATE',
            farmId,
            createdAt: new Date('2026-01-01'),
          },
          {
            organizationId: orgId,
            userName: 'B',
            module: 'stocks',
            action: 'UPDATE',
            farmId: farm2.id,
            createdAt: new Date('2026-02-01'),
          },
        ],
      });
      const all = await http()
        .get('/api/audit')
        .set(bearer(admin.token))
        .expect(200);
      const page = all.body as AuditPage;
      expect(page.total).toBe(2);
      expect(page.items.map((r) => r.userName)).toEqual(['B', 'A']);

      const one = await http()
        .get('/api/audit')
        .set(bearer(admin.token))
        .set('X-Farm-Id', farm2.id)
        .expect(200);
      expect((one.body as AuditPage).items.map((r) => r.userName)).toEqual([
        'B',
      ]);

      await http()
        .get('/api/audit')
        .set(bearer(admin.token))
        .set('X-Farm-Id', 'nope')
        .expect(403);
    });

    it('never returns another organisation’s rows', async () => {
      const admin = await actor('SUPER_ADMIN');
      const other = await createOrganization('Autre');
      await prisma.auditLog.create({
        data: {
          organizationId: other.id,
          userName: 'Intrus',
          module: 'lots',
          action: 'CREATE',
        },
      });
      const res = await http().get('/api/audit').set(bearer(admin.token));
      expect((res.body as AuditPage).total).toBe(0);
    });

    it('limits a farm-scoped role without header to its own farms', async () => {
      const director = await actor('DIRECTEUR_FERME');
      const farm2 = await createFarm(orgId, 'Ferme 2');
      await prisma.auditLog.createMany({
        data: [
          {
            organizationId: orgId,
            userName: 'Mine',
            module: 'lots',
            action: 'CREATE',
            farmId,
          },
          {
            organizationId: orgId,
            userName: 'Autre ferme',
            module: 'lots',
            action: 'CREATE',
            farmId: farm2.id,
          },
        ],
      });
      const res = await http().get('/api/audit').set(bearer(director.token));
      expect((res.body as AuditPage).items.map((r) => r.userName)).toEqual([
        'Mine',
      ]);
    });

    it('rejects a farm-limited user asking for an unassigned, foreign or all-farms scope', async () => {
      const director = await actor('DIRECTEUR_FERME');
      const unassigned = await createFarm(orgId, 'Non assignée');
      const foreignOrg = await createOrganization('Autre');
      const foreignFarm = await createFarm(foreignOrg.id, 'Étrangère');
      for (const header of [unassigned.id, foreignFarm.id, 'all']) {
        await http()
          .get('/api/audit')
          .set(bearer(director.token))
          .set('X-Farm-Id', header)
          .expect(403);
      }
    });

    it('filters by search, module and date range, and paginates', async () => {
      const admin = await actor('SUPER_ADMIN');
      await prisma.auditLog.createMany({
        data: [
          {
            organizationId: orgId,
            userName: 'Koffi',
            module: 'lots',
            action: 'CREATE',
            label: 'Lot A',
            createdAt: new Date('2026-03-01T10:00:00Z'),
          },
          {
            organizationId: orgId,
            userName: 'Awa',
            module: 'stocks',
            action: 'UPDATE',
            label: 'Maïs',
            createdAt: new Date('2026-04-01T10:00:00Z'),
          },
          {
            organizationId: orgId,
            userName: 'Awa',
            module: 'lots',
            action: 'DELETE',
            label: 'Lot B',
            createdAt: new Date('2026-05-01T10:00:00Z'),
          },
        ],
      });
      const get = async (qs: string) =>
        (
          await http()
            .get(`/api/audit?${qs}`)
            .set(bearer(admin.token))
            .expect(200)
        ).body as AuditPage;

      expect((await get('search=koffi')).total).toBe(1);
      expect((await get('search=maïs')).total).toBe(1);
      expect((await get('module=lots')).total).toBe(2);
      expect((await get('from=2026-04-01&to=2026-04-30')).total).toBe(1);
      const p = await get('pageSize=2&page=2');
      expect(p).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(p.items).toHaveLength(1);
      expect((await get('sort=createdAt:asc')).items[0].userName).toBe('Koffi');
    });

    it('rejects an unknown sort field, a bad page size and a bad date', async () => {
      const admin = await actor('SUPER_ADMIN');
      for (const qs of [
        'sort=passwordHash:asc',
        'sort=createdAt:sideways',
        'pageSize=500',
        'page=0',
        'from=not-a-date',
        'format=pdf',
      ]) {
        await http()
          .get(`/api/audit?${qs}`)
          .set(bearer(admin.token))
          .expect(400);
      }
    });

    it('exports CSV and XLSX with the French columns', async () => {
      const admin = await actor('SUPER_ADMIN');
      await prisma.auditLog.create({
        data: {
          organizationId: orgId,
          userName: 'Awa',
          module: 'lots',
          action: 'CREATE',
          label: '=EVIL()',
        },
      });
      const csv = await http()
        .get('/api/audit?format=csv')
        .set(bearer(admin.token))
        .buffer(true)
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toContain('.csv');
      const text = csv.text;
      expect(text.startsWith('﻿Date;Utilisateur;Action;Module;Élément')).toBe(
        true,
      );
      expect(text).toContain(";Awa;CREATE;lots;'=EVIL()");

      const xlsx = await http()
        .get('/api/audit?format=xlsx')
        .set(bearer(admin.token))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(xlsx.headers['content-type']).toContain('spreadsheetml');
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });
  });

  describe('login and logout', () => {
    const login = (email: string) =>
      http().post('/api/auth/login').send({ email, password: PASSWORD });

    it('writes a LOGIN row for a password-only login, not for a failure', async () => {
      const user = await createUser({
        organizationId: orgId,
        role: 'COMMERCIAL',
        passwordHash,
        name: 'Koffi Vendeur',
      });
      await http()
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong-password-1' })
        .expect(401);
      expect(await rows()).toHaveLength(0);

      await login(user.email).expect(200);
      const logs = await rows();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'LOGIN',
        module: 'auth',
        userId: user.id,
        userName: 'Koffi Vendeur',
        organizationId: orgId,
      });
    });

    it('writes LOGIN only once the second factor completes the session', async () => {
      const user = await createUser({
        organizationId: orgId,
        role: 'COMPTABLE',
        passwordHash,
      });
      // Enrol 2FA from the setup stage: that enable issues a session -> LOGIN.
      const first = await login(user.email).expect(200);
      const { setupToken } = first.body as { setupToken: string };
      expect(await rows()).toHaveLength(0);
      const setup = await http()
        .post('/api/auth/2fa/setup')
        .set(bearer(setupToken));
      const { secret } = setup.body as { secret: string };
      const step = stepAt(Date.now());
      await http()
        .post('/api/auth/2fa/enable')
        .set(bearer(setupToken))
        .send({ code: totpCode(secret, step) })
        .expect(201);
      expect((await rows()).map((r) => r.action)).toEqual(['LOGIN']);

      // Next login: password alone writes nothing, the verify step does.
      const second = await login(user.email).expect(200);
      const { challengeToken } = second.body as { challengeToken: string };
      expect(await rows()).toHaveLength(1);
      await http()
        .post('/api/auth/2fa/verify')
        .set(bearer(challengeToken))
        .send({ code: totpCode(secret, step + 1) })
        .expect(200);
      expect((await rows()).map((r) => r.action)).toEqual(['LOGIN', 'LOGIN']);
    });

    it('writes a LOGOUT row for the owner of the presented refresh cookie', async () => {
      const user = await createUser({
        organizationId: orgId,
        role: 'COMMERCIAL',
        passwordHash,
        name: 'Koffi Vendeur',
      });
      const res = await login(user.email).expect(200);
      const cookie = (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('ap_refresh='))!
        .split(';')[0];
      await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
      const logout = (await rows()).filter((r) => r.action === 'LOGOUT');
      expect(logout).toHaveLength(1);
      expect(logout[0]).toMatchObject({
        userName: 'Koffi Vendeur',
        organizationId: orgId,
      });
      // A logout without any session leaves no row.
      await http().post('/api/auth/logout').expect(204);
      expect((await rows()).filter((r) => r.action === 'LOGOUT')).toHaveLength(
        1,
      );
    });
  });
});
