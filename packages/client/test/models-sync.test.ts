import { describe, expect, it } from 'vitest';
import {
  UbilltuClient,
  isCancellationScheduled,
  isPaused,
  isFamilyPlan,
  isProRata,
  isEmptyInvoice,
  type Invoice,
  type Plan,
  type Subscription,
} from '../src/index.js';

/** Fake fetch that routes by path; auto-answers login so authed calls work. */
function client(routes: (path: string) => unknown) {
  const fn = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v1/auth/login') {
      return new Response(JSON.stringify({ access_token: 't' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = routes(url.pathname);
    return new Response(JSON.stringify(body ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return new UbilltuClient({ storefrontSlug: 'demo', fetch: fn });
}

describe('Tier-1 model sync', () => {
  it('surfaces plan features, billing mode and family config', async () => {
    const c = client((p) =>
      p === '/api/v1/plans'
        ? {
            items: [
              {
                plan_name: 'feature-monthly',
                product_name: 'Feature',
                prices: [{ amount: 250, currency: 'ZAR', billing_period: 'MONTHLY' }],
                features: ['Unlimited boards', 'Priority support'],
                billingMode: 'pro_rata',
                billingDay: 1,
                familyConfig: { enabled: true, includedSeats: 5 },
              },
            ],
            total: 1,
            page: 1,
            per_page: 20,
          }
        : {},
    );
    await c.login('a@b.com', 'pw');
    const plan = (await c.listPlans()).items[0];
    expect(plan.features).toEqual(['Unlimited boards', 'Priority support']);
    expect(plan.billingMode).toBe('pro_rata');
    expect(plan.billingDay).toBe(1);
    expect(plan.familyConfig).toEqual({ enabled: true, includedSeats: 5 });
    expect(isFamilyPlan(plan)).toBe(true);
    expect(isProRata(plan)).toBe(true);
  });

  it('surfaces scheduled cancel + mrr on a subscription and detects "cancelling"', async () => {
    const c = client((p) =>
      p === '/api/v1/subscriptions/s1'
        ? {
            subscription: {
              subscription_id: 's1',
              state: 'ACTIVE',
              cancelled_date: '2026-09-01',
              charged_through_date: '2026-09-01',
              mrr_monthly: 250,
              last_payment_amount: 250,
            },
            events: [{ eventType: 'STOP_ENTITLEMENT' }],
          }
        : {},
    );
    await c.login('a@b.com', 'pw');
    const s = await c.getSubscription('s1');
    expect(s.cancelledDate).toBe('2026-09-01');
    expect(s.mrrMonthly).toBe(250);
    expect(s.events).toHaveLength(1);
    expect(isCancellationScheduled(s)).toBe(true);
    expect(isPaused(s)).toBe(false);
  });

  it('maps invoice line items + balance', async () => {
    const c = client((p) =>
      p === '/api/v1/invoices'
        ? {
            items: [
              {
                invoice_id: 'i1',
                invoice_number: '1001',
                amount: 250,
                balance: 0,
                credit_adj: -50,
                items: [{ plan_name: 'feature-monthly', phase: 'EVERGREEN', amount: 250 }],
              },
            ],
            total: 1,
            page: 1,
            per_page: 20,
          }
        : {},
    );
    await c.login('a@b.com', 'pw');
    const inv = (await c.listInvoices()).items[0];
    expect(inv.invoiceNumber).toBe('1001');
    expect(inv.balance).toBe(0);
    expect(inv.creditAdj).toBe(-50);
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].planName).toBe('feature-monthly');
    expect(isEmptyInvoice(inv)).toBe(false);
  });

  it('balance() returns typed AccountBalance', async () => {
    const c = client((p) =>
      p === '/api/v1/account/balance' ? { balance: 0, credit: 151, currency: 'ZAR' } : {},
    );
    await c.login('a@b.com', 'pw');
    const bal = await c.balance();
    expect(bal.balance).toBe(0);
    expect(bal.credit).toBe(151);
    expect(bal.currency).toBe('ZAR');
  });

  it('usage() returns typed UsageMetrics', async () => {
    const c = client((p) =>
      p === '/api/v1/account/usage'
        ? {
            total_subscriptions: 3,
            active_subscriptions: 1,
            total_invoices: 5,
            unpaid_invoices: 1,
            total_spent: 999,
            currency: 'ZAR',
          }
        : {},
    );
    await c.login('a@b.com', 'pw');
    const u = await c.usage();
    expect(u.totalSubscriptions).toBe(3);
    expect(u.activeSubscriptions).toBe(1);
    expect(u.totalSpent).toBe(999);
  });

  it('helpers handle plain/edge shapes', () => {
    expect(isCancellationScheduled({ state: 'ACTIVE', events: [], raw: {} } as Subscription)).toBe(
      false,
    );
    expect(isPaused({ state: 'BLOCKED', events: [], raw: {} } as Subscription)).toBe(true);
    expect(isFamilyPlan({ features: [], raw: {} } as unknown as Plan)).toBe(false);
    expect(isEmptyInvoice({ amount: 0, items: [], raw: {} } as Invoice)).toBe(true);
  });
});
