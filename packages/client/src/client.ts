import { UbilltuApiError, UbilltuAuthError } from './errors.js';
import type {
  AccountBalance,
  Family,
  FamilyMember,
  Invoice,
  InvoiceItem,
  InviteCode,
  InvitePreview,
  Json,
  Page,
  Payment,
  PaymentMethod,
  Plan,
  Subscription,
  Tokens,
  UsageMetrics,
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

  /** The subscriber's outstanding balance + available credit. */
  async balance(): Promise<AccountBalance> {
    return toAccountBalance(await this._get('/api/v1/account/balance'));
  }

  /** The subscriber's usage metrics. */
  async usage(): Promise<UsageMetrics> {
    return toUsageMetrics(await this._get('/api/v1/account/usage'));
  }

  /** The subscriber's payment history. */
  async listPayments(): Promise<Page<Payment>> {
    return toPage(await this._get('/api/v1/account/payments'), toPayment);
  }

  /**
   * Right-to-erasure (GDPR Art. 17 / POPIA s24). Cancels subscriptions, scrubs
   * PII, and pseudonymizes the account — IRREVERSIBLE. `confirmEmail` must match
   * the account email; `confirmPhrase` must be exactly `"ERASE"`. Returns
   * `{ erasure_id, erased_fields }`.
   */
  eraseAccount(confirmEmail: string, confirmPhrase = 'ERASE'): Promise<Json> {
    return this._post('/api/v1/account/erase', {
      confirm_email: confirmEmail,
      confirm_phrase: confirmPhrase,
    });
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
  /** Whether the customer may self-resume this (paused) subscription (SEC-019). */
  async selfResumeAllowed(id: string): Promise<boolean> {
    const r = await this._get(
      `/api/v1/subscriptions/${encodeURIComponent(id)}/self-resume-allowed`,
    );
    return Boolean(r['allowed']);
  }

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

  /** Render an invoice as branded HTML (string). */
  async invoiceHtml(invoiceId: string): Promise<string> {
    const res = await this._fetch(
      `${this.baseUrl}/api/v1/invoices/${encodeURIComponent(invoiceId)}/html`,
      { headers: this._headers() },
    );
    if (!res.ok) await this._throw(res);
    return res.text();
  }

  // ---------------------------------------------------------------- Family --

  /** The caller's family view (owner or member), or `null` if not in a family. */
  async getFamily(): Promise<Family | null> {
    const fam = (await this._get('/api/v1/me/family'))['family'];
    return fam && typeof fam === 'object' ? toFamily(fam) : null;
  }

  /** Owner removes a member from their family. */
  removeFamilyMember(memberId: string): Promise<Json> {
    return this._post(
      `/api/v1/me/family/members/${encodeURIComponent(memberId)}/remove`,
      {},
    );
  }

  /** Leave the family the caller currently belongs to (members only). */
  leaveFamily(): Promise<Json> {
    return this._post('/api/v1/me/family-memberships/leave', {});
  }

  /** Owner generates a fresh invite code (invalidates any existing one). */
  async createFamilyInvite(expiresInHours = 72): Promise<InviteCode> {
    const r = await this._post('/api/v1/me/family/invite', {
      expires_in_hours: expiresInHours,
    });
    return toInviteCode(r['data'] ?? {});
  }

  /** List invite codes for the caller's owned family. */
  async listFamilyInvites(): Promise<InviteCode[]> {
    const r = await this._get('/api/v1/me/family/invites');
    const data: Json[] = Array.isArray(r['data']) ? r['data'] : [];
    return data.map(toInviteCode);
  }

  /** Owner revokes an invite code. */
  revokeFamilyInvite(code: string): Promise<Json> {
    return this._post(
      `/api/v1/me/family/invite/${encodeURIComponent(code)}/revoke`,
      {},
    );
  }

  /** Redeem an invite code to join a family (identity comes from the session). */
  acceptFamilyInvite(code: string): Promise<Json> {
    return this._post(
      `/api/v1/me/family/invite/${encodeURIComponent(code)}/accept`,
      {},
    );
  }

  /** Public preview of an invite code (no auth) — for a join page pre-login. */
  async validateInvite(code: string): Promise<InvitePreview> {
    const r = await this._request(
      'GET',
      `/api/v1/invite/${encodeURIComponent(code)}/validate`,
    );
    return toInvitePreview(r['preview'] ?? {});
  }

  // -------------------------------------------------------------- Payments --

  /** List the subscriber's saved payment methods (cards on file). */
  async listPaymentMethods(): Promise<Page<PaymentMethod>> {
    return toPage(await this._get('/api/v1/payments/methods'), toPaymentMethod);
  }

  /** Save a payment method from a PSP card token. */
  async addPaymentMethod(cardToken: string, isDefault = false): Promise<PaymentMethod> {
    return toPaymentMethod(
      await this._post('/api/v1/payments/methods', {
        card_token: cardToken,
        is_default: isDefault,
      }),
    );
  }

  /** Remove a saved payment method (re-promotes another card if it was default). */
  deletePaymentMethod(methodId: string): Promise<Json> {
    return this._delete(`/api/v1/payments/methods/${encodeURIComponent(methodId)}`);
  }

  /** Make a saved payment method the account default. */
  setDefaultPaymentMethod(methodId: string): Promise<Json> {
    return this._put(
      `/api/v1/payments/methods/${encodeURIComponent(methodId)}/default`,
      {},
    );
  }

  /** Ensure the account default points at a real, chargeable card. */
  reconcileDefaultPaymentMethod(): Promise<Json> {
    return this._post('/api/v1/payments/methods/reconcile-default', {});
  }

  /** Fetch a single payment's live status (reconciles PENDING with the gateway). */
  async getPayment(paymentId: string): Promise<Payment> {
    return toPayment(
      await this._get(`/api/v1/payments/${encodeURIComponent(paymentId)}`),
    );
  }

  /**
   * Make an ad-hoc / one-off payment. `source` describes what to pay
   * (`{ type: 'ad_hoc', amount, currency, description }`, or `{ type: 'invoice',
   * invoice_id }` / `{ type: 'addon', plan_id }`); `settlement` describes how
   * (`{ mode: 'saved', payment_method_id }` or `{ mode: 'hosted', return_url }`).
   * Returns the raw response (`status`, `requires_redirect`, `redirect_url`, `payment_id`).
   */
  createOneOffPayment(source: Json, settlement: Json): Promise<Json> {
    return this._post('/api/v1/payments/one-off', { source, settlement });
  }

  /**
   * Start a zero-amount card-on-file setup. Returns `{ redirect_url }` — send
   * the customer to that hosted page to enter their card.
   */
  setupPaymentMethod(returnUrl: string, isDefault = false): Promise<Json> {
    return this._post('/api/v1/payments/methods/setup', {
      return_url: returnUrl,
      is_default: isDefault,
    });
  }

  /**
   * Subscribe to a plan AND start payment collection in one call. Returns
   * `{ subscription_id, payment_id, redirect_url }` — the subscription exists
   * immediately; send the customer to `redirect_url` to pay the first invoice.
   */
  signup(planId: string, returnUrl: string): Promise<Json> {
    return this._post('/api/v1/subscriptions/signup', {
      plan_id: planId,
      return_url: returnUrl,
    });
  }

  /** Start a hosted checkout for an amount. Returns `{ payment_id, redirect_url }`. */
  checkout(input: {
    amount: number;
    currency?: string;
    invoiceId?: string;
    subscriptionId?: string;
  }): Promise<Json> {
    return this._post('/api/v1/payments/checkout', {
      amount: input.amount,
      currency: input.currency ?? 'ZAR',
      ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
      ...(input.subscriptionId ? { subscription_id: input.subscriptionId } : {}),
    });
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
      : (r['trial_days'] ?? r['trialDays'] ?? undefined),
    features: Array.isArray(r['features']) ? r['features'] : [],
    billingMode: r['billing_mode'] ?? r['billingMode'] ?? undefined,
    billingDay: r['billing_day'] ?? r['billingDay'] ?? undefined,
    familyConfig: r['family_config'] ?? r['familyConfig'] ?? undefined,
    raw: r,
  };
}

function toSubscription(r: Json): Subscription {
  // The detail endpoint wraps it as { subscription: {...}, events: [...] };
  // the list returns it flat. Unwrap so both shapes parse.
  const s: Json =
    r['subscription'] && typeof r['subscription'] === 'object'
      ? r['subscription']
      : r;
  return {
    id: String(s['subscription_id'] ?? s['id'] ?? ''),
    planName: s['plan_name'] ?? s['planName'] ?? undefined,
    productName: s['product_name'] ?? s['productName'] ?? undefined,
    state: s['state'] ?? s['status'] ?? undefined,
    price: s['price'] ?? undefined,
    currency: s['currency'] ?? undefined,
    cancelledDate: s['cancelled_date'] ?? s['cancelledDate'] ?? undefined,
    chargedThroughDate:
      s['charged_through_date'] ?? s['chargedThroughDate'] ?? undefined,
    billingEndDate: s['billing_end_date'] ?? s['billingEndDate'] ?? undefined,
    mrrMonthly: s['mrr_monthly'] ?? s['mrrMonthly'] ?? undefined,
    lastPaymentAmount: s['last_payment_amount'] ?? s['lastPaymentAmount'] ?? undefined,
    lastPaymentDate: s['last_payment_date'] ?? s['lastPaymentDate'] ?? undefined,
    lastPaymentCurrency:
      s['last_payment_currency'] ?? s['lastPaymentCurrency'] ?? undefined,
    events: Array.isArray(r['events'])
      ? r['events']
      : Array.isArray(s['events'])
        ? s['events']
        : [],
    raw: r,
  };
}

function toPaymentMethod(r: Json): PaymentMethod {
  return {
    id: String(r['payment_method_id'] ?? r['id'] ?? ''),
    isDefault: Boolean(r['is_default']),
    cardBrand: r['card_brand'] ?? undefined,
    cardLast4: r['card_last_four'] ?? r['last4'] ?? undefined,
    expiryMonth: r['expiry_month'] ?? undefined,
    expiryYear: r['expiry_year'] ?? undefined,
    raw: r,
  };
}

function toInvoiceItem(r: Json): InvoiceItem {
  return {
    description: r['description'] ?? undefined,
    planName: r['plan_name'] ?? r['planName'] ?? undefined,
    phase: r['phase'] ?? undefined,
    amount: r['amount'] ?? undefined,
    currency: r['currency'] ?? undefined,
    startDate: r['start_date'] ?? r['startDate'] ?? undefined,
    endDate: r['end_date'] ?? r['endDate'] ?? undefined,
    raw: r,
  };
}

function toInvoice(r: Json): Invoice {
  const items: Json[] = Array.isArray(r['items']) ? r['items'] : [];
  return {
    id: String(r['invoice_id'] ?? r['id'] ?? ''),
    amount: r['amount'] ?? r['balance'] ?? undefined,
    currency: r['currency'] ?? undefined,
    status: r['status'] ?? undefined,
    invoiceNumber: r['invoice_number'] ?? r['invoiceNumber'] ?? undefined,
    invoiceDate: r['invoice_date'] ?? r['invoiceDate'] ?? undefined,
    balance: r['balance'] ?? undefined,
    creditAdj: r['credit_adj'] ?? r['creditAdj'] ?? undefined,
    refundAdj: r['refund_adj'] ?? r['refundAdj'] ?? undefined,
    items: items.map(toInvoiceItem),
    raw: r,
  };
}

function toPayment(r: Json): Payment {
  return {
    id: String(r['payment_id'] ?? r['id'] ?? ''),
    amount: r['amount'] ?? r['purchased_amount'] ?? undefined,
    currency: r['currency'] ?? undefined,
    status: r['status'] ?? r['state'] ?? undefined,
    paymentNumber: r['payment_number'] ?? r['paymentNumber'] ?? undefined,
    paymentDate: r['payment_date'] ?? r['paymentDate'] ?? undefined,
    invoiceId: r['invoice_id'] ?? r['invoiceId'] ?? undefined,
    invoiceNumber: r['invoice_number'] ?? r['invoiceNumber'] ?? undefined,
    refundedAmount: r['refunded_amount'] ?? r['refundedAmount'] ?? undefined,
    description: r['description'] ?? undefined,
    raw: r,
  };
}

function toAccountBalance(r: Json): AccountBalance {
  return {
    balance: r['balance'] ?? undefined,
    credit: r['credit'] ?? undefined,
    currency: r['currency'] ?? undefined,
    raw: r,
  };
}

function toUsageMetrics(r: Json): UsageMetrics {
  return {
    totalSubscriptions: r['total_subscriptions'] ?? r['totalSubscriptions'] ?? undefined,
    activeSubscriptions:
      r['active_subscriptions'] ?? r['activeSubscriptions'] ?? undefined,
    totalInvoices: r['total_invoices'] ?? r['totalInvoices'] ?? undefined,
    unpaidInvoices: r['unpaid_invoices'] ?? r['unpaidInvoices'] ?? undefined,
    totalSpent: r['total_spent'] ?? r['totalSpent'] ?? undefined,
    currency: r['currency'] ?? undefined,
    raw: r,
  };
}

function toFamilyMember(r: Json): FamilyMember {
  return {
    memberId: String(r['member_id'] ?? r['id'] ?? ''),
    memberEmail: r['member_email'] ?? undefined,
    isOwner: Boolean(r['is_owner']),
    joinedDate: r['joined_date'] ?? r['joinedDate'] ?? undefined,
    isSelf: Boolean(r['is_self']),
    raw: r,
  };
}

function toFamily(r: Json): Family {
  const members: Json[] = Array.isArray(r['members']) ? r['members'] : [];
  return {
    familySubscriptionId: String(
      r['family_subscription_id'] ?? r['familySubscriptionId'] ?? '',
    ),
    planName: r['plan_name'] ?? r['planName'] ?? undefined,
    isOwner: Boolean(r['is_owner']),
    ownerName: r['owner_name'] ?? r['ownerName'] ?? undefined,
    ownerEmail: r['owner_email'] ?? r['ownerEmail'] ?? undefined,
    totalSeats: Number(r['total_seats'] ?? r['totalSeats'] ?? 0),
    activeMembers: Number(r['active_members'] ?? r['activeMembers'] ?? 0),
    extraSeatsPurchased: Number(
      r['extra_seats_purchased'] ?? r['extraSeatsPurchased'] ?? 0,
    ),
    members: members.map(toFamilyMember),
    raw: r,
  };
}

function toInviteCode(r: Json): InviteCode {
  return {
    code: String(r['code'] ?? ''),
    familySubscriptionId:
      r['family_subscription_id'] ?? r['familySubscriptionId'] ?? undefined,
    createdBy: r['created_by'] ?? r['createdBy'] ?? undefined,
    createdAt: r['created_at'] ?? r['createdAt'] ?? undefined,
    expiresAt: r['expires_at'] ?? r['expiresAt'] ?? undefined,
    maxUses: r['max_uses'] ?? r['maxUses'] ?? undefined,
    currentUses: Number(r['current_uses'] ?? r['currentUses'] ?? 0),
    status: String(r['status'] ?? 'ACTIVE'),
    raw: r,
  };
}

function toInvitePreview(r: Json): InvitePreview {
  return {
    familySubscriptionId:
      r['family_subscription_id'] ?? r['familySubscriptionId'] ?? undefined,
    planName: r['plan_name'] ?? r['planName'] ?? undefined,
    ownerName: r['owner_name'] ?? r['ownerName'] ?? undefined,
    ownerEmail: r['owner_email'] ?? r['ownerEmail'] ?? undefined,
    seatsAvailable: r['seats_available'] ?? r['seatsAvailable'] ?? undefined,
    expiresAt: r['expires_at'] ?? r['expiresAt'] ?? undefined,
    raw: r,
  };
}

/** Seats not yet filled on a family (`totalSeats - activeMembers`, min 0). */
export function familySeatsAvailable(family: Family): number {
  return Math.max(0, family.totalSeats - family.activeMembers);
}

// ── Lifecycle helpers (parity with the Python SDK's model properties) ────────

/** A pending end-of-term cancel: `cancelledDate` set while still ACTIVE (keeps
 * access until the date). Mirrors the storefront/portal "Cancelling" logic. */
export function isCancellationScheduled(sub: Subscription): boolean {
  return sub.cancelledDate != null && (sub.state ?? '').toUpperCase() === 'ACTIVE';
}

/** Currently paused (Kill Bill BLOCKED). A *scheduled* future pause instead
 * lives in `sub.events` as a future PAUSE_* event. */
export function isPaused(sub: Subscription): boolean {
  return (sub.state ?? '').toUpperCase() === 'BLOCKED';
}

/** True when the plan is family/group-enabled. */
export function isFamilyPlan(plan: Plan): boolean {
  return Boolean(plan.familyConfig?.enabled);
}

/** True when the plan charges the first period pro-rata. */
export function isProRata(plan: Plan): boolean {
  return (plan.billingMode ?? '').toLowerCase() === 'pro_rata';
}

/** The zero-total, zero-item invoice Kill Bill commits on subscription setup
 * (findings #1) — handy to filter out of a customer-facing list. */
export function isEmptyInvoice(inv: Invoice): boolean {
  return (inv.amount ?? 0) === 0 && inv.items.length === 0;
}
