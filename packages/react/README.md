# @ubilltu/react

React hooks and provider for the [ubilltu](https://ubilltu.com) subscription commerce API,
built on [`@ubilltu/client`](https://www.npmjs.com/package/@ubilltu/client).

```bash
npm install @ubilltu/react @ubilltu/client react
```

```tsx
import { UbilltuClient } from '@ubilltu/client';
import { UbilltuProvider, usePlans, useSubscriptions, useUbilltu } from '@ubilltu/react';

const client = new UbilltuClient({ storefrontSlug: 'your-store-slug' });

function App() {
  return (
    <UbilltuProvider client={client}>
      <Catalog />
    </UbilltuProvider>
  );
}

function Catalog() {
  const { data, loading, error, refresh } = usePlans();
  // ...
}
```

## Exports

- `UbilltuProvider` — supplies the client to the tree.
- `useUbilltu()` — the raw `UbilltuClient` for imperative calls (`login`, `subscribe`, …).
- `usePlans()`, `useSubscriptions()`, `useInvoices()` — each returns `{ data, loading, error, refresh }`.

For mutations (login, subscribe, change plan), call the client from `useUbilltu()` and
`refresh()` the relevant hook afterward.
