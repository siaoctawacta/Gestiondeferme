const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    /** Parsed JSON error body, for extra fields such as `lockedUntil`. */
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  twoFactorEnabled: boolean;
}

export interface SessionPayload {
  accessToken: string;
  user: SessionUser;
}

// Session state lives in memory only: the access token is never persisted.
let accessToken: string | null = null;
let farmHeader: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
/** Value sent as `X-Farm-Id`: a farm id, the literal `all`, or null to omit it. */
export const setFarmHeader = (id: string | null) => {
  farmHeader = id;
};
/** Registered by the auth provider; called when a refresh fails and the session is gone. */
export const setSessionExpiredHandler = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

type Params = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  /** Explicit bearer token (challenge / setup tokens); disables refresh-on-401. */
  token?: string;
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/reset-password', '/auth/2fa/verify'];
const noRefresh = (path: string) => NO_REFRESH.includes(path);

function buildUrl(path: string, params?: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const q = qs.toString();
  return `${BASE}${path}${q ? `?${q}` : ''}`;
}

const UNREACHABLE = "Le serveur est injoignable. Vérifiez que l'API est démarrée, puis réessayez.";

async function toError(res: Response): Promise<ApiError> {
  if (res.status === 502 || res.status === 503 || res.status === 504) return new ApiError(res.status, UNREACHABLE);
  let body: Record<string, unknown> | undefined;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const raw = body?.message;
  const message = Array.isArray(raw)
    ? raw.join('\n')
    : typeof raw === 'string' && raw
      ? raw
      : `Erreur ${res.status}`;
  return new ApiError(res.status, message, typeof body?.code === 'string' ? body.code : undefined, body);
}

function send(
  method: string,
  path: string,
  { params, body, token }: { params?: Params; body?: unknown } & RequestOptions,
): Promise<Response> {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const bearer = token ?? accessToken;
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
  if (farmHeader) headers.set('X-Farm-Id', farmHeader);
  return fetch(buildUrl(path, params), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new ApiError(0, UNREACHABLE);
  });
}

let refreshing: Promise<SessionPayload> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Refresh tokens rotate and reuse
 * revokes the whole family, so every caller shares the one in-flight request.
 */
export function refreshSession(): Promise<SessionPayload> {
  refreshing ??= (async () => {
    try {
      const res = await send('POST', '/auth/refresh', {});
      if (!res.ok) throw await toError(res);
      const data = (await res.json()) as SessionPayload;
      accessToken = data.accessToken;
      return data;
    } catch (e) {
      accessToken = null;
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function refreshOrExpire(): Promise<void> {
  try {
    await refreshSession();
  } catch {
    accessToken = null;
    onSessionExpired?.();
    throw new ApiError(401, 'Session expirée, veuillez vous reconnecter');
  }
}

/** Sends once; on a 401 for a session request, refreshes (or reuses a newer token) and retries once. */
async function sendWithRetry(
  method: string,
  path: string,
  opts: { params?: Params; body?: unknown } & RequestOptions,
): Promise<Response> {
  const sentWith = accessToken;
  const res = await send(method, path, opts);
  if (res.status !== 401 || opts.token || noRefresh(path)) return res;
  // Another request may already have refreshed while this one was in flight.
  if (!accessToken || accessToken === sentWith) await refreshOrExpire();
  return send(method, path, opts);
}

async function request<T>(
  method: string,
  path: string,
  opts: { params?: Params; body?: unknown } & RequestOptions = {},
): Promise<T> {
  const res = await sendWithRetry(method, path, opts);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  // Nest answers DELETE with 200 and no body: only parse when there is something to parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, params?: Params, opts?: RequestOptions) =>
    request<T>('GET', path, { params, ...opts }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, { body: body ?? {}, ...opts }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  /** Fetches a file with the session credentials and hands it to the browser as a download. */
  async download(path: string, params: Params | undefined, filename: string): Promise<void> {
    const res = await sendWithRetry('GET', path, { params });
    if (!res.ok) throw await toError(res);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
