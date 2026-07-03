import { describe, expect, it } from 'vitest';
import { UbilltuApiError, UbilltuAuthError, UbilltuClient } from '../src/index.js';

/** Build a fake fetch that routes by path and records the last request. */
function fakeFetch(
  routes: (req: {
    url: URL;
    method: string;
    body: any;
    headers: Headers;
  }) => { status?: number; json?: unknown; bytes?: Uint8Array },
): { fetch: typeof fetch; last: () => any } {
  let last: any = null;
  const fn = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers ?? {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    last = { url, method: init.method ?? 'GET', body, headers };
    const r = routes({ url, method: init.method ?? 'GET', body, headers });
    if (r.bytes) {
      return new Response(r.bytes, { status: r.status ?? 200 });
    }
    return new Response(r.json === undefined ? '' : JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, last: () => last };
}

describe('UbilltuClient', () => {
  it('login stores the token and attaches it + storefront header to later requests', async () => {
    const f = fakeFetch(({ url }) => {
      if (url.pathname === '/api/v1/auth/login') {
        return { json: { access_token: 'tok_123', token_type: 'bearer' } };
      }
      return { json: { items: [], total: 0, page: 1, per_page: 20 } };
    });
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });

    const tokens = await client.login('a@b.com', 'pw');
    expect(tokens.accessToken).toBe('tok_123');
    expect(client.isAuthenticated).toBe(true);

    const plans = await client.listPlans();
    expect(plans.items).toEqual([]);
    expect(f.last().headers.get('Authorization')).toBe('Bearer tok_123');
    expect(f.last().headers.get('X-Storefront-Slug')).toBe('demo');
  });

  it('throws UbilltuAuthError when calling an authed endpoint before login', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await expect(client.listPlans()).rejects.toBeInstanceOf(UbilltuAuthError);
  });

  it('maps a non-2xx response to UbilltuApiError (nested error.message)', async () => {
    const f = fakeFetch(({ url }) => {
      if (url.pathname === '/api/v1/auth/login') {
        return { json: { access_token: 't' } };
      }
      // The API nests error messages as { error: { message } }.
      return { status: 402, json: { error: { message: 'no active subscription' } } };
    });
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await client.login('a@b.com', 'pw');

    await expect(client.listSubscriptions()).rejects.toMatchObject({
      constructor: UbilltuApiError,
      statusCode: 402,
      message: 'no active subscription',
    });
  });

  it('parses a plans page using the real API shape (product_name + prices[])', async () => {
    const f = fakeFetch(({ url }) => {
      if (url.pathname === '/api/v1/auth/login') return { json: { access_token: 't' } };
      return {
        json: {
          items: [
            {
              plan_id: 'lite-monthly',
              plan_name: 'lite-monthly',
              product_name: 'Lite',
              billing_period: 'MONTHLY',
              prices: [{ currency: 'ZAR', amount: 50, billing_period: 'MONTHLY' }],
              phases: [
                { phase_type: 'TRIAL', duration_length: 14 },
                { phase_type: 'EVERGREEN' },
              ],
            },
          ],
          total: 1,
          page: 1,
          per_page: 20,
        },
      };
    });
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await client.login('a@b.com', 'pw');

    const plan = (await client.listPlans()).items[0]!;
    expect(plan.id).toBe('lite-monthly'); // slug — used for subscribe()
    expect(plan.name).toBe('Lite'); // product display name
    expect(plan.price).toBe(50); // from prices[]
    expect(plan.currency).toBe('ZAR'); // from prices[]
    expect(plan.billingPeriod).toBe('MONTHLY');
    expect(plan.trialDays).toBe(14);
  });

  it('register sends tos_accepted', async () => {
    const f = fakeFetch(() => ({ json: { access_token: 't' } }));
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await client.register({ email: 'new@example.com', password: 'password123' });
    expect(f.last().body).toMatchObject({
      email: 'new@example.com',
      tos_accepted: true,
    });
  });

  it('getSubscription unwraps the detail { subscription, events } shape', async () => {
    const f = fakeFetch(({ url }) => {
      if (url.pathname === '/api/v1/auth/login') return { json: { access_token: 't' } };
      return {
        json: {
          subscription: {
            subscription_id: 'sub_1',
            plan_name: 'premium-monthly',
            state: 'ACTIVE',
          },
          events: [],
        },
      };
    });
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await client.login('a@b.com', 'pw');
    const s = await client.getSubscription('sub_1');
    expect(s.id).toBe('sub_1');
    expect(s.planName).toBe('premium-monthly');
    expect(s.state).toBe('ACTIVE');
  });

  it('changePlan sends a PUT with plan_id + billing_policy', async () => {
    const f = fakeFetch(({ url }) => {
      if (url.pathname === '/api/v1/auth/login') return { json: { access_token: 't' } };
      return { json: { subscription_id: 'sub_1', state: 'ACTIVE', plan_name: 'premium-annual' } };
    });
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await client.login('a@b.com', 'pw');

    const sub = await client.changePlan('sub_1', 'premium-annual', { policy: 'IMMEDIATE' });
    expect(f.last().method).toBe('PUT');
    expect(f.last().url.pathname).toBe('/api/v1/subscriptions/sub_1');
    expect(f.last().body).toMatchObject({ plan_id: 'premium-annual', billing_policy: 'IMMEDIATE' });
    expect(sub.planName).toBe('premium-annual');
  });

  it('invoicePdf returns raw bytes', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]); // %PDF
    const f = fakeFetch(({ url }) => {
      if (url.pathname === '/api/v1/auth/login') return { json: { access_token: 't' } };
      return { bytes: pdf };
    });
    const client = new UbilltuClient({ storefrontSlug: 'demo', fetch: f.fetch });
    await client.login('a@b.com', 'pw');

    expect(await client.invoicePdf('inv_1')).toEqual(pdf);
  });
});
