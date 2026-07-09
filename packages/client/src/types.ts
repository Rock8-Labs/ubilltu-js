/** Loose JSON object. */
export type Json = Record<string, any>;

/** A paginated list envelope (`{ items, total, page, per_page }`). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/** Auth tokens returned by login/register/refresh. */
export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
}

/** Family/group config merged onto a plan (`null`/absent when not a family plan). */
export interface FamilyConfig {
  enabled: boolean;
  includedSeats?: number;
}

/** A subscription plan from the tenant catalog. */
export interface Plan {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  billingPeriod?: string;
  /** Free-trial length in days, derived from a TRIAL phase if present. */
  trialDays?: number;
  /** Plan features shown on the pricing page (API `plan_features` enrichment). */
  features: string[];
  /** `"full_price"` | `"pro_rata"` — how the first period is charged. */
  billingMode?: string;
  /** Anchor day-of-month; set only for pro-rata plans. */
  billingDay?: number;
  /** Family/group config, or `undefined` for an individual plan. */
  familyConfig?: FamilyConfig;
  /** The full raw payload for fields not surfaced above. */
  raw: Json;
}

/** A subscriber's subscription. */
export interface Subscription {
  id: string;
  planName?: string;
  productName?: string;
  state?: string;
  price?: number;
  currency?: string;
  /** Future date => a scheduled end-of-term cancel (still ACTIVE until then). */
  cancelledDate?: string;
  chargedThroughDate?: string;
  billingEndDate?: string;
  /** Catalog price normalized to monthly, for MRR. */
  mrrMonthly?: number;
  lastPaymentAmount?: number;
  lastPaymentDate?: string;
  lastPaymentCurrency?: string;
  /** Event stream (present on the detail endpoint); scheduled pauses live here. */
  events: Json[];
  raw: Json;
}

/** A single line on an invoice. */
export interface InvoiceItem {
  description?: string;
  planName?: string;
  phase?: string;
  amount?: number;
  currency?: string;
  startDate?: string;
  endDate?: string;
  raw: Json;
}

/** An invoice. */
export interface Invoice {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  balance?: number;
  creditAdj?: number;
  refundAdj?: number;
  items: InvoiceItem[];
  raw: Json;
}

/** A payment record. */
export interface Payment {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
  paymentNumber?: string;
  paymentDate?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  refundedAmount?: number;
  description?: string;
  raw: Json;
}

/** Result of a pause/resume (`{success, message, paused_until}`). */
export interface PauseResult {
  success: boolean;
  message?: string;
  /** When the pause takes effect (end of the current period), if scheduled. */
  pausedUntil?: string;
  raw: Json;
}

/** A saved payment method (card on file). */
export interface PaymentMethod {
  id: string;
  isDefault: boolean;
  cardBrand?: string;
  cardLast4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  raw: Json;
}

/** Outstanding balance + available credit for the account. */
export interface AccountBalance {
  /** What's owed (Kill Bill accountBalance). */
  balance?: number;
  /** Available credit / CBA (offsets future invoices, e.g. from a downgrade). */
  credit?: number;
  currency?: string;
  raw: Json;
}

/** Account usage/rollup metrics (`GET /account/usage`). */
export interface UsageMetrics {
  totalSubscriptions?: number;
  activeSubscriptions?: number;
  totalInvoices?: number;
  unpaidInvoices?: number;
  totalSpent?: number;
  currency?: string;
  raw: Json;
}

/** A member row in the caller's family view (`GET /me/family`). */
export interface FamilyMember {
  memberId: string;
  memberEmail?: string;
  isOwner: boolean;
  joinedDate?: string;
  /** True for the row representing the calling user (UI highlight). */
  isSelf: boolean;
  raw: Json;
}

/** The caller's family (owner or member view) from `GET /me/family`. */
export interface Family {
  familySubscriptionId: string;
  planName?: string;
  isOwner: boolean;
  ownerName?: string;
  ownerEmail?: string;
  totalSeats: number;
  activeMembers: number;
  extraSeatsPurchased: number;
  members: FamilyMember[];
  raw: Json;
}

/** A family invite code (`POST`/`GET /me/family/invite(s)`). */
export interface InviteCode {
  code: string;
  familySubscriptionId?: string;
  createdBy?: string;
  createdAt?: string;
  expiresAt?: string;
  maxUses?: number;
  currentUses: number;
  status: string;
  raw: Json;
}

/** Public preview of an invite code (`GET /invite/{code}/validate`). */
export interface InvitePreview {
  familySubscriptionId?: string;
  planName?: string;
  ownerName?: string;
  ownerEmail?: string;
  seatsAvailable?: number;
  expiresAt?: string;
  raw: Json;
}
