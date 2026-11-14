import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { signAccessToken } from '../src/access/access-token';
import type { RequestContext } from '../src/access/decorators';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createFarm,
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

describe('Access guard (e2e)', () => {
  let app: INestApplication;
  let orgId: string;
  let farmA: string;
  let farmB: string;
  let otherOrgFarm: string;
  let agent: string;
  let auditeur: string;
  let avicole: string;

  const http = () => app.getHttpServer() as App;
  const get = async (
    path: string,
    userId?: string,
    headers: Record<string, string> = {},
  ) => {
    const req = request(http()).get(`/api${path}`);
    if (userId) req.set('Authorization', `Bearer ${await tokenFor(userId)}`);
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb();
    const org = await createOrganization();
    orgId = org.id;
    farmA = (await createFarm(orgId, 'A')).id;
    farmB = (await createFarm(orgId, 'B')).id;
    const other = await createOrganization('Autre');
    otherOrgFarm = (await createFarm(other.id, 'Z')).id;
    avicole = (
      await createUser({
        organizationId: orgId,
        role: 'RESP_AVICOLE',
        farmIds: [farmA],
      })
    ).id;
    auditeur = (await createUser({ organizationId: orgId, role: 'AUDITEUR' }))
      .id;
    agent = (
      await createUser({
        organizationId: orgId,
        role: 'AGENT_ELEVAGE',
        farmIds: [farmA],
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('is not exposed by AppModule alone', async () => {
    const m = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const bare = m.createNestApplication();
    configureApp(bare);
    await bare.init();
    const res = await request(bare.getHttpServer() as App).get('/api/_probe');
    expect(res.status).toBe(404);
    await bare.close();
  });

  it('keeps health public', async () => {
    expect((await get('/health')).status).toBe(200);
  });

  it('401 without a token', async () => {
    expect(
      (await get('/_probe', undefined, { 'X-Farm-Id': farmA })).status,
    ).toBe(401);
  });

  it('401 with a garbage or wrongly signed token', async () => {
    const bad = await request(http())
      .get('/api/_probe')
      .set('Authorization', 'Bearer nope');
    expect(bad.status).toBe(401);
    const jwt = await import('jsonwebtoken');
    const forged = jwt.sign(
      { sub: avicole, role: 'SUPER_ADMIN', org: orgId, stage: 'full' },
      'other-secret',
    );
    const res = await request(http())
      .get('/api/_probe')
      .set('Authorization', `Bearer ${forged}`)
      .set('X-Farm-Id', farmA);
    expect(res.status).toBe(401);
  });

  it('403 when the role lacks the permission', async () => {
    const res = await get('/_probe', auditeur, { 'X-Farm-Id': farmA });
    expect(res.status).toBe(403);
  });

  it('200 for an assigned farm and exposes the context', async () => {
    const res = await get('/_probe', avicole, { 'X-Farm-Id': farmA });
    expect(res.status).toBe(200);
    const ctx = res.body as RequestContext;
    expect(ctx.farmId).toBe(farmA);
    expect(ctx.farmIds).toEqual([farmA]);
    expect(ctx.allFarms).toBe(false);
    expect(ctx.user).toMatchObject({
      id: avicole,
      role: 'RESP_AVICOLE',
      organizationId: orgId,
    });
  });

  it('403 for a farm the user is not assigned to', async () => {
    expect((await get('/_probe', avicole, { 'X-Farm-Id': farmB })).status).toBe(
      403,
    );
  });

  it('403 for a farm of another organisation, even for AUDITEUR', async () => {
    expect(
      (await get('/_probe/read', auditeur, { 'X-Farm-Id': otherOrgFarm }))
        .status,
    ).toBe(403);
  });

  it('400 when X-Farm-Id is missing on a farm-scoped route', async () => {
    expect((await get('/_probe', avicole)).status).toBe(400);
  });

  it('403 for X-Farm-Id: all as a role without all-farms access', async () => {
    expect((await get('/_probe', avicole, { 'X-Farm-Id': 'all' })).status).toBe(
      403,
    );
    expect(
      (await get('/_probe/read', avicole, { 'X-Farm-Id': 'all' })).status,
    ).toBe(403);
  });

  it('200 for X-Farm-Id: all as AUDITEUR on a read route', async () => {
    const res = await get('/_probe/read', auditeur, { 'X-Farm-Id': 'all' });
    expect(res.status).toBe(200);
    const ctx = res.body as RequestContext;
    expect(ctx.allFarms).toBe(true);
    expect(ctx.farmId).toBeNull();
    expect([...ctx.farmIds].sort()).toEqual([farmA, farmB].sort());
  });

  it('AUDITEUR sees any farm of the organisation without assignment', async () => {
    const res = await get('/_probe/read', auditeur, { 'X-Farm-Id': farmB });
    expect(res.status).toBe(200);
    expect((res.body as RequestContext).farmId).toBe(farmB);
  });

  it('refuses X-Farm-Id: all on a non-read action even for SUPER_ADMIN', async () => {
    const admin = (
      await createUser({ organizationId: orgId, role: 'SUPER_ADMIN' })
    ).id;
    expect((await get('/_probe', admin, { 'X-Farm-Id': 'all' })).status).toBe(
      403,
    );
    expect((await get('/_probe', admin, { 'X-Farm-Id': farmA })).status).toBe(
      200,
    );
  });

  it('ignores X-Farm-Id on @NoFarm routes', async () => {
    const res = await get('/_probe/nofarm', avicole, {
      'X-Farm-Id': otherOrgFarm,
    });
    expect(res.status).toBe(200);
    const ctx = res.body as RequestContext;
    expect(ctx.farmId).toBeNull();
    expect(ctx.allFarms).toBe(false);
    expect((await get('/_probe/nofarm', avicole)).status).toBe(200);
  });

  it('requires a valid token on routes with no decorators other than NoFarm', async () => {
    expect((await get('/_probe/authed')).status).toBe(401);
    expect((await get('/_probe/authed', agent)).status).toBe(200);
  });

  it('takes the role from the database, not from the token', async () => {
    const token = signAccessToken({
      sub: agent,
      role: 'SUPER_ADMIN',
      org: orgId,
      stage: 'full',
    });
    const res = await request(http())
      .get('/api/_probe')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Farm-Id', farmA);
    expect(res.status).toBe(200); // AGENT_ELEVAGE can create lots
    const del = await request(http())
      .get('/api/_probe/read')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Farm-Id', 'all');
    expect(del.status).toBe(403); // AGENT_ELEVAGE has no all-farms access
  });

  it('applies role changes and deactivation immediately', async () => {
    const prisma = new PrismaService();
    try {
      const u = await createUser({
        organizationId: orgId,
        role: 'RESP_AVICOLE',
        farmIds: [farmA],
      });
      expect((await get('/_probe', u.id, { 'X-Farm-Id': farmA })).status).toBe(
        200,
      );
      await prisma.user.update({
        where: { id: u.id },
        data: { role: 'AUDITEUR' },
      });
      expect((await get('/_probe', u.id, { 'X-Farm-Id': farmA })).status).toBe(
        403,
      );
      await prisma.user.update({
        where: { id: u.id },
        data: { active: false },
      });
      expect((await get('/_probe', u.id, { 'X-Farm-Id': farmA })).status).toBe(
        401,
      );
      await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('401 when the token names a user that no longer exists', async () => {
    const token = signAccessToken({
      sub: 'ghost',
      role: 'SUPER_ADMIN',
      org: orgId,
      stage: 'full',
    });
    const res = await request(http())
      .get('/api/_probe/authed')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('403 TWO_FACTOR_REQUIRED for a non-full stage on a normal route', async () => {
    for (const stage of ['2fa', 'setup'] as const) {
      const res = await request(http())
        .get('/api/_probe/authed')
        .set('Authorization', `Bearer ${await tokenFor(agent, stage)}`);
      expect(res.status).toBe(403);
      expect((res.body as { code: string }).code).toBe('TWO_FACTOR_REQUIRED');
    }
  });

  it('accepts a non-full stage only on routes that allow it, and then refuses full', async () => {
    const ok = await request(http())
      .get('/api/_probe/setup')
      .set('Authorization', `Bearer ${await tokenFor(agent, '2fa')}`);
    expect(ok.status).toBe(200);
    const full = await request(http())
      .get('/api/_probe/setup')
      .set('Authorization', `Bearer ${await tokenFor(agent, 'full')}`);
    expect(full.status).toBe(403);
  });
});
