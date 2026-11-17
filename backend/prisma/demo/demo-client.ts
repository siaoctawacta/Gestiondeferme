// A minimal HTTP client for the demo: every write goes through the API of the running app, with the guards, the
// validation, the ledgers and the audit a user meets. Any non-2xx answer stops the run with the route and the message.

export class DemoError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} -> ${status} ${body}`);
  }
}

export interface Created {
  id: string;
  code?: string;
}

export class DemoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    readonly farmId: string,
  ) {}

  async call<T = Created>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
        'x-farm-id': this.farmId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new DemoError(method, path, res.status, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get = <T = unknown>(path: string) => this.call<T>('GET', path);
  post = <T = Created>(path: string, body: unknown = {}) =>
    this.call<T>('POST', path, body);
  put = <T = unknown>(path: string, body: unknown) =>
    this.call<T>('PUT', path, body);
  patch = <T = Created>(path: string, body: unknown) =>
    this.call<T>('PATCH', path, body);

  /** Every row of a list route (one page of 200). */
  async list<T extends { id: string }>(path: string): Promise<T[]> {
    return (
      await this.get<{ items: T[] }>(
        `${path}${path.includes('?') ? '&' : '?'}pageSize=200`,
      )
    ).items;
  }
}

/** What every step of the demo shares. */
export interface DemoContext {
  api: DemoClient;
  /** Buildings by name. */
  buildings: Map<string, string>;
  /** Users by role. */
  users: Map<string, string>;
  /** Moves a numbering counter so that the next number issued is `last + 1` (no API sets a counter). */
  setCounter(
    kind: 'DA' | 'BC' | 'FA',
    last: number,
    mode?: 'exact' | 'raise',
  ): Promise<void>;
}
