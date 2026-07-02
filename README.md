# ubilltu JavaScript / TypeScript SDK

Official JS/TS SDK for the [ubilltu](https://ubilltu.com) subscription commerce API.
A monorepo of two packages:

| Package | What it is |
|---|---|
| [`@ubilltu/client`](packages/client) | Isomorphic core client — works in **Node, the browser, and any JS runtime** (uses global `fetch`, zero runtime dependencies). |
| [`@ubilltu/react`](packages/react) | Thin **React** bindings — a provider + hooks (`usePlans`, `useSubscriptions`, `useInvoices`) on top of the core. |

The core is the same everywhere; React just gets idiomatic hooks. (Vue/Svelte/etc. bindings can be added the same way later.)

## Core client — Node / browser / anywhere

```bash
npm install @ubilltu/client
```

```ts
import { UbilltuClient } from '@ubilltu/client';

const client = new UbilltuClient({ storefrontSlug: 'your-store-slug' });

await client.login('user@example.com', 'password');
const plans = await client.listPlans();
const sub = await client.subscribe(plans.items[0].id);
await client.changePlan(sub.id, 'premium-annual', { policy: 'IMMEDIATE' });
```

Every request is scoped to a tenant via the `X-Storefront-Slug` header; the bearer token from `login()` is attached automatically. Errors are thrown as `UbilltuApiError` (non-2xx, with `statusCode`) or `UbilltuAuthError` (called before login).

## React bindings

```bash
npm install @ubilltu/react @ubilltu/client react
```

```tsx
import { UbilltuClient } from '@ubilltu/client';
import { UbilltuProvider, usePlans } from '@ubilltu/react';

const client = new UbilltuClient({ storefrontSlug: 'your-store-slug' });

function App() {
  return (
    <UbilltuProvider client={client}>
      <Plans />
    </UbilltuProvider>
  );
}

function Plans() {
  const { data, loading, error, refresh } = usePlans();
  if (loading) return <p>Loading…</p>;
  if (error) return <p>{error.message}</p>;
  return <ul>{data!.items.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;
}
```

## A note on webhooks

ubilltu's webhook surface is **entirely inbound** (its billing engine and PSP call *it*) — there is **no outbound webhook delivery to your application**. So there's no signature-verification helper here; there's nothing for a merchant app to receive. To react to subscription/invoice changes, poll the relevant endpoints (or query state on load).

## Development

```bash
npm install          # installs + links the workspace
npm run typecheck    # tsc across packages
npm test             # vitest (client)
npm run build        # tsup → dual ESM/CJS + .d.ts for both packages
```
