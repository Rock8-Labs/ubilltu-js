import { UbilltuApiError, UbilltuAuthError } from './errors.js';
import type {
  Invoice,
  Json,
  Page,
  Payment,
  Plan,
  Subscription,
  Tokens,
} from './types.js';

export interface UbilltuClientOptions {
  /** The tenant storefront slug, sent as the `X-Storefront-Slug` header. */
  storefrontSlug: string;
  /** API base URL. Defaults to production. */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

/**
 * A client for the ubilltu subscription commerce API (customer/storefront plane).
 *
 * Every request is scoped to a tenant via the `X-Storefront-Slug` header. After
 * {@link UbilltuClient.login}, the bearer token is attached automatically.
 *
 * ```ts
 * const client = new UbilltuClient({ storefrontSlug: 'my-store' });
 * await client.login('user@example.com', 'password');
 * const plans = await client.listPlans();
 * ```
 */
export class UbilltuClient {
  readonly storefrontSlug: string;
  readonly baseUrl: string;
  private readonly _fetch: typeof fetch;
  private _tokens: Tokens | null = null;

  constructor(options: UbilltuClientOptions) {
    this.storefrontSlug = options.storefrontSlug;
    this.baseUrl = options.baseUrl ?? 'https://api.ubilltu.com';
    const f = options.fetch ?? globalThis.fetch;
    if (!f) {
      throw new Error(
        'No global fetch available — pass options.fetch (Node < 18).',
      );
    }
    this._fetch = f;
  }

  /** The active session tokens, or `null` if not authenticated. */
  get tokens(): Tokens | null {
    return this._tokens;
  }

  /** Whether a session is currently active. */
  get isAuthenticated(): boolean {
    return !!this._tokens && this._tokens.accessToken.length > 0;
  }

  /** Restore a session from previously persisted tokens. */
  restoreSession(tokens: Tokens): void {
    this._tokens = tokens;
  }

  // ------------------------------------------------------------------ Auth --

  /** Authenticate a subscriber and store the session. */
  async login(email: string, password: string): Promise<Tokens> {
    const data = await this._post(
      '/api/v1/auth/login',
      { email, password },
      false,
    );
    return (this._tokens = toTokens(data));
  }

  /**
   * Register a new subscriber. Stores the session if the API returns tokens.
   * The API requires `tos_accepted` (the caller's user must accept the Terms of
   * Service); it defaults to `true` here for convenience.
   */
  async register(input: {
    email: string;
    password: string;
    name?: string;
    tosAccepted?: boolean;
  }): Promise<Tokens> {
    const { tosAccepted = true, ...rest } = input;
    const data = await this._post(
      '/api/v1/auth/register',
      { ...rest, tos_accepted: tosAccepted },
      false,
    );
    const tokens = toTokens(data);
    if (tokens.accessToken) this._tokens = tokens;
    return tokens;
  }

  /** Refresh the access token using the stored refresh token. */
  async refresh(): Promise<Tokens> {
    const rt = this._tokens?.refreshToken;
    if (!rt) throw new UbilltuAuthError('No refresh token available.');
    const data = await this._post(
      '/api/v1/auth/refresh',
      { refresh_token: rt },
      false,
    );
    return (this._tokens = toTokens(data));
  }

  /** Clear the local session. Does not revoke the token server-side. */
  logout(): void {
    this._tokens = null;
  }

  /** The authenticated subscriber's profile (`/auth/me`). */
  me(): Promise<Json> {
    return this._get('/api/v1/auth/me');
  }

  // --------------------------------------------------------------- Account --

  /** The authenticated subscriber's account details. */
  account(): Promise<Json> {
    return this._get('/api/v1/account');
  }

  /** Update the subscriber's profile fields (e.g. `name`, `phone`). */
  updateAccount(fields: Json): Promise<Json> {
    return this._put('/api/v1/account', fields);
  }

  /** The subscriber's account balance. */
  balance(): Promise<Json> {
    return this._get('/api/v1/account/balance');
  }

  /** The subscriber's usage metrics. */
  usage(): Promise<Json> {
    return this._get('/api/v1/account/usage');
  }

  /** The subscriber's payment history. */
  async listPayments(): Promise<Page<Payment>> {
    return toPage(await this._get('/api/v1/account/payments'), toPayment);
  }

  // ----------------------------------------------------------------- Plans --

  /** List available plans from the tenant catalog. */
  async listPlans(): Promise<Page<Plan>> {
    return toPage(await this._get('/api/v1/plans'), toPlan);
  }

  /** Fetch a single plan by id. */
  async getPlan(planId: string): Promise<Plan> {
    return toPlan(await this._get(`/api/v1/plans/${encodeURIComponent(planId)}`));
  }

  // --------------------------------------------------------- Subscriptions --

  /** List the subscriber's subscriptions. */
  async listSubscriptions(): Promise<Page<Subscription>> {
    return toPage(await this._get('/api/v1/subscriptions'), toSubscription);
  }

  /** Fetch a single subscription. */
  async getSubscription(id: string): Promise<Subscription> {
    return toSubscription(
      await this._get(`/api/v1/subscriptions/${encodeURIComponent(id)}`),
    );
  }

  /**
   * Subscribe to a plan. Extra fields (e.g. `billing_period`, `external_key`)
   * can be supplied via {@link extra}.
   */
  async subscribe(planId: string, extra?: Json): Promise<Subscription> {
    return toSubscription(
      await this._post('/api/v1/subscriptions', { plan_id: planId, ...extra }),
    );
  }

  /**
   * Change a subscription's plan (upgrade / downgrade / change billing period).
   * The billing period is encoded in `newPlanId` (e.g. `premium-annual`).
   * `policy` defaults to `END_OF_TERM`; pass `IMMEDIATE` to apply now.
   */
  async changePlan(
    id: string,
    newPlanId: string,
    opts: { policy?: 'END_OF_TERM' | 'IMMEDIATE'; priceList?: string } = {},
  ): Promise<Subscription> {
    return toSubscription(
      await this._put(`/api/v1/subscriptions/${encodeURIComponent(id)}`, {
        plan_id: newPlanId,
        billing_policy: opts.policy ?? 'END_OF_TERM',
        ...(opts.priceList ? { price_list: opts.priceList } : {}),
      }),
    );
  }

  /** Preview the pro-rata invoice for a plan change before committing to it. */
  previewChange(id: string, newPlan?: string): Promise<Json> {
    const q = newPlan ? `?new_plan=${encodeURIComponent(newPlan)}` : '';
    return this._get(`/api/v1/subscriptions/${encodeURIComponent(id)}/dry-run${q}`);
  }

  /** Cancel a subscription. */
  cancelSubscription(id: string): Promise<Json> {
    return this._delete(`/api/v1/subscriptions/${encodeURIComponent(id)}`);
  }

  /** Pause a subscription. */
  async pauseSubscription(id: string): Promise<Subscription> {
    return toSubscription(
      await this._post(`/api/v1/subscriptions/${encodeURIComponent(id)}/pause`, {}),
    );
  }

  /** Resume a paused subscription. */
  async resumeSubscription(id: string): Promise<Subscription> {
    return toSubscription(
      await this._post(`/api/v1/subscriptions/${encodeURIComponent(id)}/resume`, {}),
    );
  }

  /** Reactivate a cancelled subscription. */
  async reactivateSubscription(id: string): Promise<Subscription> {
    return toSubscription(
      await this._post(
        `/api/v1/subscriptions/${encodeURIComponent(id)}/reactivate`,
        {},
      ),
    );
  }

  // -------------------------------------------------------------- Invoices --

  /** List the subscriber's invoices. */
  async listInvoices(): Promise<Page<Invoice>> {
    return toPage(await this._get('/api/v1/invoices'), toInvoice);
  }

  /** Fetch a single invoice with line-item detail. */
  getInvoice(invoiceId: string): Promise<Json> {
    return this._get(`/api/v1/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /** Download an invoice as raw PDF bytes. */
  async invoicePdf(invoiceId: string): Promise<Uint8Array> {
    const res = await this._fetch(
      `${this.baseUrl}/api/v1/invoices/${encodeURIComponent(invoiceId)}/pdf`,
      { headers: this._headers() },
    );
    if (!res.ok) await this._throw(res);
    return new Uint8Array(await res.arrayBuffer());
  }

  // ------------------------------------------------------------- internals --

  private _headers(json = false): Record<string, string> {
    const h: Record<string, string> = {
      'X-Storefront-Slug': this.storefrontSlug,
      Accept: 'application/json',
    };
    if (json) h['Content-Type'] = 'application/json';
    const t = this._tokens?.accessToken;
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  private _requireAuth(): void {
    if (!this.isAuthenticated) throw new UbilltuAuthError();
  }

  private async _get(path: string): Promise<Json> {
    this._requireAuth();
    return this._request('GET', path);
  }

  private async _post(path: string, body: Json, auth = true): Promise<Json> {
    if (auth) this._requireAuth();
    return this._request('POST', path, body);
  }

  private async _put(path: string, body: Json): Promise<Json> {
    this._requireAuth();
    return this._request('PUT', path, body);
  }

  private async _delete(path: string): Promise<Json> {
    this._requireAuth();
    return this._request('DELETE', path);
  }

  private async _request(
    method: string,
    path: string,
    body?: Json,
  ): Promise<Json> {
    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this._headers(body !== undefined),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) await this._throw(res);
    const text = await res.text();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Json)
        : { data: parsed };
    } catch {
      return {};
    }
  }

  private async _throw(res: Response): Promise<never> {
    let body: Json | undefined;
    let message = res.statusText || 'Request failed';
    try {
      const text = await res.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          body = parsed as Json;
          const err = body['error'];
          message =
            (err && typeof err === 'object' ? err['message'] : undefined) ??
            body['detail'] ??
            body['message'] ??
            message;
        }
      }
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new UbilltuApiError(res.status, String(message), body);
  }
}

// ------------------------------------------------------------------ mappers --

function toTokens(r: Json): Tokens {
  return {
    accessToken: String(r['access_token'] ?? r['token'] ?? ''),
    refreshToken: r['refresh_token'] ?? undefined,
    tokenType: r['token_type'] ?? undefined,
  };
}

function toPage<T>(r: Json, map: (item: Json) => T): Page<T> {
  const items: Json[] = Array.isArray(r['items']) ? r['items'] : [];
  return {
    items: items.map(map),
    total: Number(r['total'] ?? items.length),
    page: Number(r['page'] ?? 1),
    perPage: Number(r['per_page'] ?? items.length),
  };
}

function toPlan(r: Json): Plan {
  const phases: Json[] = Array.isArray(r['phases']) ? r['phases'] : [];
  const trial = phases.find(
    (p) => (p['phase_type'] ?? p['phaseType']) === 'TRIAL',
  );
  // The API returns price/currency inside a `prices[]` array and the display
  // name in `product_name`; fall back to flat fields for safety.
  const prices: Json[] = Array.isArray(r['prices']) ? r['prices'] : [];
  const first: Json = prices[0] ?? {};
  return {
    id: String(r['plan_id'] ?? r['id'] ?? r['plan_name'] ?? r['name'] ?? ''),
    name: String(r['product_name'] ?? r['plan_name'] ?? r['name'] ?? ''),
    price: r['price'] ?? r['amount'] ?? first['amount'] ?? undefined,
    currency: r['currency'] ?? first['currency'] ?? undefined,
    billingPeriod:
      r['billing_period'] ?? r['billingPeriod'] ?? first['billing_period'] ?? undefined,
    trialDays: trial
      ? (trial['duration_length'] ?? trial['durationLength'] ?? undefined)
      : undefined,
    raw: r,
  };
}

function toSubscription(r: Json): Subscription {
  return {
    id: String(r['subscription_id'] ?? r['id'] ?? ''),
    planName: r['plan_name'] ?? r['planName'] ?? undefined,
    state: r['state'] ?? r['status'] ?? undefined,
    raw: r,
  };
}

function toInvoice(r: Json): Invoice {
  return {
    id: String(r['invoice_id'] ?? r['id'] ?? ''),
    amount: r['amount'] ?? r['balance'] ?? undefined,
    currency: r['currency'] ?? undefined,
    status: r['status'] ?? undefined,
    raw: r,
  };
}

function toPayment(r: Json): Payment {
  return {
    id: String(r['payment_id'] ?? r['id'] ?? ''),
    amount: r['amount'] ?? r['purchased_amount'] ?? undefined,
    currency: r['currency'] ?? undefined,
    status: r['status'] ?? r['state'] ?? undefined,
    raw: r,
  };
}
