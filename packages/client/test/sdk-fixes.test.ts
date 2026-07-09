import { describe, expect, it } from 'vitest';
import { UbilltuClient } from '../src/index.js';

/** Fetch that routes by (method, path) and records requests. */
function makeFetch(routes: (req: { method: string; path: string; body?: any; headers: Headers }) => {
  status?: number;
  json?: unknown;
}) {
  const requests: { method: string; path: string; body?: any; headers: Headers }[] = [];
  const fn = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers ?? {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    const req = { method: init.method ?? 'GET', path: url.pathname, body, headers };
    requests.push(req);
    const r = routes(req);
    return new Response(r.json === undefined ? '{}' : JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, requests };
}

describe('SDK fixes from integration testing', () => {
  it('listPlans is public — no login, no Authorization header', async () => {
    const f = makeFetch((req) => {
      expect(req.headers.has('authorization')).toBe(false);
      return { json: { items: [{ plan_name: 'basic', price: 99 }], total: 1 } };
    });
    const c = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    const page = await c.listPlans(); // no login
    expect(page.items).toHaveLength(1);
  });

  it('pause/resume return a typed PauseResult', async () => {
    const f = makeFetch((req) =>
      req.path === '/api/v1/auth/login'
        ? { json: { access_token: 't', refresh_token: 'r' } }
        : { json: { success: true, message: 'ok', paused_until: '2026-09-01' } },
    );
    const c = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await c.login('a@b.com', 'pw');
    const r = await c.pauseSubscription('s1');
    expect(r.success).toBe(true);
    expect(r.pausedUntil).toBe('2026-09-01');
  });

  it('cancel defaults to END_OF_TERM and accepts a policy', async () => {
    const f = makeFetch((req) =>
      req.path === '/api/v1/auth/login' ? { json: { access_token: 't' } } : { json: { success: true } },
    );
    const c = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await c.login('a@b.com', 'pw');
    await c.cancelSubscription('s1');
    expect(f.requests.at(-1)?.body).toEqual({ use_policy: 'END_OF_TERM' });
    await c.cancelSubscription('s2', 'IMMEDIATE');
    expect(f.requests.at(-1)?.body).toEqual({ use_policy: 'IMMEDIATE' });
    await c.cancelSubscription('s3', null);
    expect(f.requests.at(-1)?.body).toBeUndefined();
  });

  it('refreshes once on 401 then retries', async () => {
    let accountCalls = 0;
    const f = makeFetch((req) => {
      if (req.path === '/api/v1/auth/login') return { json: { access_token: 'old', refresh_token: 'r1' } };
      if (req.path === '/api/v1/auth/refresh') return { json: { access_token: 'new', refresh_token: 'r2' } };
      if (req.path === '/api/v1/account') {
        accountCalls++;
        return req.headers.get('authorization') === 'Bearer old'
          ? { status: 401, json: { detail: 'expired' } }
          : { json: { email: 'a@b.com' } };
      }
      return { json: {} };
    });
    const c = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await c.login('a@b.com', 'pw');
    const acct = await c.account();
    expect(acct['email']).toBe('a@b.com');
    expect(accountCalls).toBe(2); // original 401 + retry
    expect(c.tokens?.accessToken).toBe('new');
  });
});
