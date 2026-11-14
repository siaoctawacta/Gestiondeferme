import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetDb } from './setup';

describe('Health & validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health reports database up', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('rejects unknown body fields', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({ email: 'a@b.c', password: 'x', evil: 1 });
    expect(res.status).toBe(400);
  });

  it('stub login answers 501 for a valid body', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'x' });
    expect(res.status).toBe(501);
  });

  it('serves Swagger UI at /api/docs', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });
});
