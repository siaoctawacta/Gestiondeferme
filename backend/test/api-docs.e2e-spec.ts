import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './setup';

async function appWithEnv(env: Record<string, string | undefined>) {
  const saved = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await createTestApp();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('API docs exposure and robots header (e2e)', () => {
  const apps: INestApplication[] = [];
  const open = async (env: Record<string, string | undefined>) => {
    const app = await appWithEnv(env);
    apps.push(app);
    return request(app.getHttpServer() as App);
  };

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('serves Swagger UI outside production', async () => {
    const http = await open({ NODE_ENV: 'test', ENABLE_API_DOCS: undefined });
    expect((await http.get('/api/docs')).status).toBe(200);
    expect((await http.get('/api/docs-json')).status).toBe(200);
  });

  it('hides Swagger UI in production by default', async () => {
    const http = await open({
      NODE_ENV: 'production',
      ENABLE_API_DOCS: undefined,
    });
    expect((await http.get('/api/docs')).status).toBe(404);
    expect((await http.get('/api/docs-json')).status).toBe(404);
    expect((await http.get('/api/health')).status).toBe(200);
  });

  it('serves it in production when ENABLE_API_DOCS=true', async () => {
    const http = await open({
      NODE_ENV: 'production',
      ENABLE_API_DOCS: 'true',
    });
    expect((await http.get('/api/docs')).status).toBe(200);
  });

  it('sends X-Robots-Tag on every response, errors and docs included', async () => {
    const http = await open({ NODE_ENV: 'test', ENABLE_API_DOCS: undefined });
    for (const path of [
      '/api/health',
      '/api/auth/me',
      '/api/nope',
      '/api/docs',
    ]) {
      const res = await http.get(path);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
  });
});
