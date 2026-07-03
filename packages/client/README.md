# @ubilltu/client

Official TypeScript/JavaScript client for the [ubilltu](https://ubilltu.com) subscription
commerce API. **Isomorphic** — runs in Node, the browser, and any runtime with `fetch`;
**zero runtime dependencies.**

```bash
npm install @ubilltu/client
```

```ts
import { UbilltuClient } from '@ubilltu/client';

const client = new UbilltuClient({ storefrontSlug: 'your-store-slug' });
await client.login('user@example.com', 'password');

const plans = await client.listPlans();
const subs = await client.listSubscriptions();
```

Requires `fetch` (Node ≥ 18 or a browser). On older Node, pass one: `new UbilltuClient({ storefrontSlug, fetch })`.

## API

| Area | Methods |
|---|---|
| Auth | `login`, `register`, `refresh`, `logout`, `me`, `restoreSession` |
| Account | `account`, `updateAccount`, `balance`, `usage`, `listPayments` |
| Plans | `listPlans`, `getPlan` |
| Subscriptions | `listSubscriptions`, `getSubscription`, `subscribe`, `changePlan`, `previewChange`, `cancelSubscription`, `pauseSubscription`, `resumeSubscription`, `reactivateSubscription` |
| Invoices | `listInvoices`, `getInvoice`, `invoicePdf` |
| Payments | `listPaymentMethods`, `setupPaymentMethod`, `signup`, `checkout` |

List endpoints return a `Page<T>` (`{ items, total, page, perPage }`). Typed models
(`Plan`, `Subscription`, `Invoice`, `Payment`) surface common fields plus `.raw` for the
full payload. Errors throw `UbilltuApiError` / `UbilltuAuthError`.

## Persisting a session

```ts
// save client.tokens somewhere, then later:
client.restoreSession(savedTokens);
```
