import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createOrganization,
  createTestApp,
  createUser,
  resetDb,
  tokenFor,
} from './setup';

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.THROTTLE_IN_TEST = '1';
    app = await createTestApp();
    await resetDb();
  });

  afterAll(async () => {
    delete process.env.THROTTLE_IN_TEST;
    await app.close();
  });

  it('answers 429 on the 11th login request within a minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app.getHttpServer() as App)
        .post('/api/auth/login')
        .send({ email: 'nobody@test.local', password: 'x' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it('throttles change-password like login (11th request is 429)', async () => {
    const org = await createOrganization();
    const user = await createUser({
      organizationId: org.id,
      role: 'COMMERCIAL',
    });
    const token = await tokenFor(user.id);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app.getHttpServer() as App)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'x', newPassword: 'A-brand-new-pass-1' });
      statuses.push(res.status);
    }
    expect(statuses[10]).toBe(429);
    expect(statuses.slice(0, 10)).not.toContain(429);
  });
});
