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

/** A subscription plan from the tenant catalog. */
export interface Plan {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  billingPeriod?: string;
  /** Free-trial length in days, derived from a TRIAL phase if present. */
  trialDays?: number;
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
  raw: Json;
}

/** An invoice. */
export interface Invoice {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
  raw: Json;
}

/** A payment record. */
export interface Payment {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
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
