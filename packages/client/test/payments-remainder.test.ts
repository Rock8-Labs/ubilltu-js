import { describe, expect, it } from 'vitest';
import { UbilltuClient } from '../src/index.js';

/** Fake fetch that records calls and routes by path; auto-answers login. */
function makeClient() {
  const calls: { method: string; path: string; body?: any }[] = [];
  const fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.pathname === '/api/v1/auth/login') {
      return new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.push({ method, path: url.pathname, body });
    // Route a few paths to specific bodies; default is a generic success.
    let json: any = { success: true, message: 'ok' };
    if (url.pathname === '/api/v1/payments/methods' && method === 'POST') {
      json = { payment_method_id: 'pm1', is_default: true };
    } else if (url.pathname === '/api/v1/payments/pay1') {
      json = { payment_id: 'pay1', status: 'SUCCEEDED', amount: 250, currency: 'ZAR' };
    } else if (url.pathname === '/api/v1/payments/one-off') {
      json = { status: 'PENDING', requires_redirect: true, redirect_url: 'https://pay', payment_id: 'p1' };
    } else if (url.pathname.endsWith('/self-resume-allowed')) {
      json = { subscription_id: 's1', allowed: true };
    } else if (url.pathname === '/api/v1/account/erase') {
      json = { erasure_id: 'er1', erased_fields: ['email', 'name'] };
    } else if (url.pathname.endsWith('/html')) {
      return new Response('<html><body>Invoice</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const client = new UbilltuClient({ storefrontSlug: 'demo', fetch });
  return { client, calls };
}

describe('Tier-2 payments/account remainder', () => {
  it('addPaymentMethod posts the token and maps the result', async () => {
    const { client, calls } = makeClient();
    await client.login('a@b.com', 'pw');
    const pm = await client.addPaymentMethod('tok_abc', true);
    expect(pm.id).toBe('pm1');
    const c = calls.find((x) => x.path === '/api/v1/payments/methods');
    expect(c?.method).toBe('POST');
    expect(c?.body.card_token).toBe('tok_abc');
  });

  it('delete / set-default / reconcile hit the right verbs+paths', async () => {
    const { client, calls } = makeClient();
    await client.login('a@b.com', 'pw');
    await client.deletePaymentMethod('pm1');
    await client.setDefaultPaymentMethod('pm2');
    await client.reconcileDefaultPaymentMethod();
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', path: '/api/v1/payments/methods/pm1' }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'PUT', path: '/api/v1/payments/methods/pm2/default' }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/api/v1/payments/methods/reconcile-default' }),
    );
  });

  it('getPayment returns typed status', async () => {
    const { client } = makeClient();
    await client.login('a@b.com', 'pw');
    const p = await client.getPayment('pay1');
    expect(p.id).toBe('pay1');
    expect(p.status).toBe('SUCCEEDED');
  });

  it('createOneOffPayment posts source + settlement', async () => {
    const { client, calls } = makeClient();
    await client.login('a@b.com', 'pw');
    const r = await client.createOneOffPayment(
      { type: 'ad_hoc', amount: 50, currency: 'ZAR', description: 'Top-up' },
      { mode: 'hosted', return_url: 'https://store/done' },
    );
    expect(r['requires_redirect']).toBe(true);
    const c = calls.find((x) => x.path === '/api/v1/payments/one-off');
    expect(c?.body.source.type).toBe('ad_hoc');
    expect(c?.body.settlement.mode).toBe('hosted');
  });

  it('selfResumeAllowed returns a boolean', async () => {
    const { client } = makeClient();
    await client.login('a@b.com', 'pw');
    expect(await client.selfResumeAllowed('s1')).toBe(true);
  });

  it('invoiceHtml returns a string', async () => {
    const { client } = makeClient();
    await client.login('a@b.com', 'pw');
    const html = await client.invoiceHtml('i1');
    expect(html).toContain('<html>');
  });

  it('eraseAccount posts the confirmation', async () => {
    const { client, calls } = makeClient();
    await client.login('a@b.com', 'pw');
    const r = await client.eraseAccount('a@b.com');
    expect(r['erasure_id']).toBe('er1');
    const c = calls.find((x) => x.path === '/api/v1/account/erase');
    expect(c?.body.confirm_phrase).toBe('ERASE');
  });
});
