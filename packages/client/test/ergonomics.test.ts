import { describe, expect, it } from 'vitest';
import {
  UbilltuClient,
  resolveSubscriptionPrice,
  type Plan,
  type Subscription,
} from '../src/index.js';

function makeClient(capture: { query?: string }) {
  const fetch = (async (input: any) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/auth/login') {
      return new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    capture.query = url.search;
    return new Response(JSON.stringify({ items: [], total: 0, page: 2, per_page: 5 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return new UbilltuClient({ storefrontSlug: 'demo', fetch });
}

describe('Tier-3 ergonomics', () => {
  it('list methods send page/per_page query params', async () => {
    const cap: { query?: string } = {};
    const c = makeClient(cap);
    await c.login('a@b.com', 'pw');
    await c.listPlans({ page: 2, perPage: 5 });
    expect(cap.query).toBe('?page=2&per_page=5');
  });

  it('list methods omit the query when no opts given', async () => {
    const cap: { query?: string } = {};
    const c = makeClient(cap);
    await c.login('a@b.com', 'pw');
    await c.listSubscriptions();
    expect(cap.query).toBe('');
  });

  it('resolveSubscriptionPrice keeps a present price', () => {
    const sub = { planName: 'feature-monthly', price: 250, events: [], raw: {} } as Subscription;
    expect(resolveSubscriptionPrice(sub, [])).toBe(250);
  });

  it('resolveSubscriptionPrice derives from the matching plan when null', () => {
    const sub = { planName: 'feature-monthly', events: [], raw: {} } as Subscription;
    const plans: Plan[] = [
      { id: 'basic-monthly', name: 'Basic', price: 99, features: [], raw: {} } as Plan,
      { id: 'feature-monthly', name: 'Feature', price: 250, features: [], raw: {} } as Plan,
    ];
    expect(resolveSubscriptionPrice(sub, plans)).toBe(250);
  });

  it('resolveSubscriptionPrice returns undefined when unresolvable', () => {
    const sub = { planName: 'gone', events: [], raw: {} } as Subscription;
    expect(resolveSubscriptionPrice(sub, [])).toBeUndefined();
  });
});
