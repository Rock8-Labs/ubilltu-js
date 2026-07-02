import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { UbilltuClient } from '@ubilltu/client';
import type { Invoice, Page, Plan, Subscription } from '@ubilltu/client';

const UbilltuContext = createContext<UbilltuClient | null>(null);

export interface UbilltuProviderProps {
  client: UbilltuClient;
  children: ReactNode;
}

/** Provides an {@link UbilltuClient} to the hooks below. */
export function UbilltuProvider(props: UbilltuProviderProps): ReactNode {
  return createElement(
    UbilltuContext.Provider,
    { value: props.client },
    props.children,
  );
}

/** Access the {@link UbilltuClient} from the nearest {@link UbilltuProvider}. */
export function useUbilltu(): UbilltuClient {
  const client = useContext(UbilltuContext);
  if (!client) {
    throw new Error('useUbilltu must be used within a <UbilltuProvider>.');
  }
  return client;
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Re-run the request. */
  refresh: () => void;
}

function useAsync<T>(
  run: (client: UbilltuClient) => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const client = useUbilltu();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    run(client)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tick, ...deps]);

  return { data, loading, error, refresh: () => setTick((t) => t + 1) };
}

/** Subscribe to the tenant's plan catalog. */
export function usePlans(): AsyncState<Page<Plan>> {
  return useAsync((c) => c.listPlans(), []);
}

/** Subscribe to the authenticated subscriber's subscriptions. */
export function useSubscriptions(): AsyncState<Page<Subscription>> {
  return useAsync((c) => c.listSubscriptions(), []);
}

/** Subscribe to the authenticated subscriber's invoices. */
export function useInvoices(): AsyncState<Page<Invoice>> {
  return useAsync((c) => c.listInvoices(), []);
}

export type {
  Invoice,
  Page,
  Plan,
  Subscription,
} from '@ubilltu/client';
export { UbilltuClient } from '@ubilltu/client';
