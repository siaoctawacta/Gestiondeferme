import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setAccessToken, getAccessToken, setFarmHeader } from './api';

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

function headersOf(call: number): Headers {
  return new Headers((fetchMock.mock.calls[call][1] as RequestInit).headers);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('tok-1');
  setFarmHeader('farm-1');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
  setFarmHeader(null);
});

describe('api client', () => {
  it('sends Authorization and X-Farm-Id with credentials', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api.get('/lots', { page: 2 })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/lots?page=2');
    expect((init as RequestInit).credentials).toBe('include');
    expect(headersOf(0).get('Authorization')).toBe('Bearer tok-1');
    expect(headersOf(0).get('X-Farm-Id')).toBe('farm-1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'tok-2', user: { id: 'u' } }))
      .mockResolvedValueOnce(json(200, { data: 1 }));
    await expect(api.get('/lots')).resolves.toEqual({ data: 1 });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect(headersOf(2).get('Authorization')).toBe('Bearer tok-2');
    expect(getAccessToken()).toBe('tok-2');
  });

  it('shares a single refresh between parallel 401s', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'tok-2', user: {} });
      const auth = new Headers((init as RequestInit).headers).get('Authorization');
      return auth === 'Bearer tok-2' ? json(200, { ok: url }) : json(401, { message: 'x' });
    });
    const [a, b] = await Promise.all([api.get('/a'), api.get('/b')]);
    expect(a).toEqual({ ok: '/api/a' });
    expect(b).toEqual({ ok: '/api/b' });
    const refreshes = fetchMock.mock.calls.filter(([u]) => u === '/api/auth/refresh');
    expect(refreshes).toHaveLength(1);
  });

  it('does not retry more than once', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'x' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'tok-2', user: {} }))
      .mockResolvedValueOnce(json(401, { message: 'still no' }));
    await expect(api.get('/lots')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects with ApiError 401 and clears the token when refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(401, { message: 'Session expirée' }));
    const err = (await api.get('/lots').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(getAccessToken()).toBeNull();
  });

  it('refreshes once for /auth/2fa/setup made with the session token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'tok-2', user: {} }))
      .mockResolvedValueOnce(json(200, { secret: 's' }));
    await expect(api.post('/auth/2fa/setup')).resolves.toEqual({ secret: 's' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    expect(headersOf(2).get('Authorization')).toBe('Bearer tok-2');
  });

  it('retries with a newer token without refreshing again', async () => {
    fetchMock.mockImplementationOnce(async () => {
      setAccessToken('tok-2'); // another request refreshed meanwhile
      return json(401, { message: 'x' });
    });
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(api.get('/lots')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(1).get('Authorization')).toBe('Bearer tok-2');
  });

  it('never tries to refresh for login, 2FA verify or explicit-token calls', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Identifiants invalides' }));
    await expect(api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({
      status: 401,
      message: 'Identifiants invalides',
    });
    fetchMock.mockResolvedValueOnce(json(401, { message: 'Code invalide' }));
    await expect(api.post('/auth/2fa/verify', { code: '1' }, { token: 'c' })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the server message, joining validation arrays', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { message: 'Ce nom existe déjà', code: 'DUP' }));
    await expect(api.post('/fermes', {})).rejects.toMatchObject({
      status: 409,
      message: 'Ce nom existe déjà',
      code: 'DUP',
    });
    fetchMock.mockResolvedValueOnce(json(400, { message: ['a est requis', 'b est invalide'] }));
    await expect(api.post('/fermes', {})).rejects.toMatchObject({
      message: 'a est requis\nb est invalide',
    });
  });

  it('returns undefined on 204 and omits X-Farm-Id when no farm is selected', async () => {
    setFarmHeader(null);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.del('/lots/1')).resolves.toBeUndefined();
    expect(headersOf(0).has('X-Farm-Id')).toBe(false);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('returns undefined on a 200 with an empty body (Nest DELETE handlers)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(api.del('/buildings/1')).resolves.toBeUndefined();
  });

  it('reports an unreachable server for 502/503/504 and for a rejected fetch', async () => {
    const msg = "Le serveur est injoignable. Vérifiez que l'API est démarrée, puis réessayez.";
    for (const status of [502, 503, 504]) {
      fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status }));
      await expect(api.get('/x')).rejects.toMatchObject({ status, message: msg });
    }
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: msg });
  });
});

describe('api client: files', () => {
  it('posts a FormData as is, without a JSON content type (the browser sets the multipart boundary)', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { ok: true }));
    const form = new FormData();
    form.append('file', new File(['x'], 'preuve.png', { type: 'image/png' }));
    await api.post('/tasks/t1/proof', form);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(form);
    expect(headersOf(0).has('Content-Type')).toBe(false);
  });

  it('fetches a file as a blob with the session credentials, and reports an error like any request', async () => {
    // jsdom's Response cannot wrap a Blob: answer with the blob its `blob()` hands out.
    fetchMock.mockResolvedValueOnce(Object.assign(new Response(null, { status: 200 }), { blob: async () => new Blob(['img'], { type: 'image/png' }) }));
    const blob = await api.blob('/tasks/t1/proof');
    expect(blob.type).toBe('image/png');
    expect(headersOf(0).get('Authorization')).toBe('Bearer tok-1');
    fetchMock.mockResolvedValueOnce(json(404, { message: 'Introuvable' }));
    await expect(api.blob('/tasks/t2/proof')).rejects.toMatchObject({ status: 404, message: 'Introuvable' });
  });
  it('keeps only the base name of an announced filename and reads a case-insensitive RFC 5987 one', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const names: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => { names.push((n as HTMLAnchorElement).download); return n; });
    const file = (cd: string) => Object.assign(new Response(null, { status: 200, headers: { 'content-disposition': cd } }), { blob: async () => new Blob(['x']) });
    for (const cd of ['attachment; filename="../../etc/rapport.csv"', "attachment; filename*=utf-8'fr'rapport%20%C3%A9t%C3%A9.csv", 'attachment; filename="C:\\tmp\\r.xlsx"']) {
      fetchMock.mockResolvedValueOnce(file(cd));
      await api.download('/reports/synthese', undefined, 'fallback.csv');
    }
    expect(names).toEqual(['rapport.csv', 'rapport été.csv', 'r.xlsx']);
    click.mockRestore();
    append.mockRestore();
  });
  it('downloads with the filename the server announces, the given one when it announces none', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const names: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const append = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => { names.push((n as HTMLAnchorElement).download); return n; });
    const file = (headers: Record<string, string>) =>
      Object.assign(new Response(null, { status: 200, headers }), { blob: async () => new Blob(['x']) });
    fetchMock.mockResolvedValueOnce(file({ 'content-disposition': 'attachment; filename="rapport-synthese-2026-11-01_2026-11-14.csv"' }));
    await api.download('/reports/synthese', { format: 'csv' }, 'fallback.csv');
    fetchMock.mockResolvedValueOnce(file({}));
    await api.download('/reports/synthese', { format: 'csv' }, 'fallback.csv');
    expect(names).toEqual(['rapport-synthese-2026-11-01_2026-11-14.csv', 'fallback.csv']);
    click.mockRestore();
    append.mockRestore();
  });
});
