import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetDb } from './setup';

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
});
