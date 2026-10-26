// The page-level analytics bus the project's consent layer subscribes to (`useAnalytics().subscribe`, ADR-0012).
// Ported from the 2026.4.7 `Analytics.Provider` (MIT) without the parts Hydrogen 2026.10 took over: loading Shopify's
// consent and analytics scripts is now `<ShopifyScripts>` (rendered by AnalyticsGate), and Shopify's own bus is
// `window.Shopify.analytics`. This module keeps what the project's GA4 and Meta pipeline needs and 2026.10 does not
// offer: events published only while `canTrack()` allows them, a per-callback subscriber map, and the cart diff
// that turns two cart snapshots into add and remove events.
//
// Page, product, collection, search and cart-view events are also forwarded to Shopify's bus (with the product price
// shaped as money, as 2026.10 expects). Add and remove-from-cart events are NOT forwarded: 2026.10 derives them
// only from its own client cart store, which this project does not use (ADR-0012, open item).

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {useLocation} from 'react-router';
import {flattenConnection} from '@shopify/hydrogen';

export const AnalyticsEvent = {
  PAGE_VIEWED: 'page_viewed',
  PRODUCT_VIEWED: 'product_viewed',
  COLLECTION_VIEWED: 'collection_viewed',
  CART_VIEWED: 'cart_viewed',
  SEARCH_VIEWED: 'search_viewed',
  CART_UPDATED: 'cart_updated',
  PRODUCT_ADD_TO_CART: 'product_added_to_cart',
  PRODUCT_REMOVED_FROM_CART: 'product_removed_from_cart',
} as const;

type EventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export type AnalyticsShop = {shopId: string};

type CartConnection = {nodes?: unknown[]; edges?: Array<{node: unknown}>};
export type AnalyticsCartSnapshot = {
  id?: string;
  updatedAt?: string;
  lines?: CartConnection;
};

export type CartViewPayload = {
  cart: AnalyticsCartSnapshot | null;
  prevCart?: AnalyticsCartSnapshot | null;
  url?: string;
};

type Payload = Record<string, unknown>;
type Callback = (payload: Payload) => void;

type AnalyticsContextValue = {
  canTrack: () => boolean;
  cart: AnalyticsCartSnapshot | null;
  prevCart: AnalyticsCartSnapshot | null;
  customData: Record<string, unknown>;
  publish: (event: string, payload: Payload) => void;
  shop: AnalyticsShop | null;
  subscribe: (event: string, callback: Callback) => void;
};

const NOOP_CONTEXT: AnalyticsContextValue = {
  canTrack: () => false,
  cart: null,
  prevCart: null,
  customData: {},
  publish: () => {},
  shop: null,
  subscribe: () => {},
};

const AnalyticsContext = createContext<AnalyticsContextValue>(NOOP_CONTEXT);

// Module level, like the 2026.4 bus: a subscriber is keyed by the callback's source text and there is no unsubscribe, so
// callers act only while mounted (AnalyticsBridge does).
const subscribers = new Map<string, Map<string, Callback>>();

function subscribe(event: string, callback: Callback): void {
  let forEvent = subscribers.get(event);
  if (!forEvent) {
    forEvent = new Map();
    subscribers.set(event, forEvent);
  }
  forEvent.set(callback.toString(), callback);
}

function publishNow(event: string, payload: Payload): void {
  for (const callback of subscribers.get(event)?.values() ?? []) {
    try {
      callback(payload);
    } catch {
      // A subscriber must never break the page or the other subscribers; nothing from the payload is logged (T-05).
    }
  }
  forwardToShopify(event, payload);
}

/** True when Shopify's Customer Privacy API says analytics may run (the default gate when no provider is configured). */
function hasAnalyticsConsent(): boolean {
  try {
    const privacy = window.Shopify?.customerPrivacy;
    if (!privacy || privacy.consentStatus !== 'loaded') return false;
    if (privacy.currentVisitorConsent?.().analytics === 'no') return false;
    return privacy.analyticsProcessingAllowed?.() ?? false;
  } catch {
    return false;
  }
}

// --- Shopify's own bus (window.Shopify.analytics, created by <ShopifyScripts>) -------------------------------------

type ShopifyBus = {publish: (event: string, payload?: unknown) => void};

function shopifyBus(): ShopifyBus | undefined {
  if (typeof window === 'undefined') return undefined;
  const bus: unknown = (window as {Shopify?: {analytics?: unknown}}).Shopify
    ?.analytics;
  return bus && typeof (bus as ShopifyBus).publish === 'function'
    ? (bus as ShopifyBus)
    : undefined;
}

const SHOPIFY_FORWARDED: ReadonlySet<string> = new Set([
  AnalyticsEvent.PAGE_VIEWED,
  AnalyticsEvent.PRODUCT_VIEWED,
  AnalyticsEvent.COLLECTION_VIEWED,
  AnalyticsEvent.SEARCH_VIEWED,
  AnalyticsEvent.CART_VIEWED,
]);

/** 2026.10 wants `price` as money (`{amount, currencyCode}`); the page payloads carry the amount string (USD only, NFR-008). */
function asShopifyPayload(event: string, payload: Payload): Payload {
  if (event !== AnalyticsEvent.PRODUCT_VIEWED) return payload;
  const products = Array.isArray(payload.products) ? payload.products : [];
  return {
    ...payload,
    products: products.map((product: unknown) => {
      const item = product as Payload;
      return typeof item.price === 'string'
        ? {...item, price: {amount: item.price, currencyCode: 'USD'}}
        : item;
    }),
  };
}

function forwardToShopify(event: string, payload: Payload): void {
  if (!SHOPIFY_FORWARDED.has(event)) return;
  try {
    shopifyBus()?.publish(event, asShopifyPayload(event, payload));
  } catch {
    // Shopify's script failing must not affect the page.
  }
}

// --- provider ------------------------------------------------------------------------------------------------

type ProviderProps = {
  children?: ReactNode;
  /** The cart as the root loader holds it (a promise while it streams). */
  cart: Promise<AnalyticsCartSnapshot | null> | AnalyticsCartSnapshot | null;
  /** The shop identity (a promise while it streams); without it no event is published. */
  shop: Promise<AnalyticsShop | null> | AnalyticsShop | null;
  /** Overrides Shopify's consent answer, e.g. the project's own consent store. */
  canTrack?: () => boolean;
  customData?: Record<string, unknown>;
};

function useResolvedShop(
  shopProp: ProviderProps['shop'],
): AnalyticsShop | null {
  const [shop, setShop] = useState<AnalyticsShop | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve(shopProp).then((resolved) => {
      if (live) startTransition(() => setShop(resolved));
    });
    return () => {
      live = false;
    };
  }, [shopProp]);
  return shop;
}

function AnalyticsProvider({
  canTrack: customCanTrack,
  cart: currentCart,
  children,
  customData,
  shop: shopProp,
}: ProviderProps) {
  const shop = useResolvedShop(shopProp);
  const [carts, setCartsState] = useState<{
    cart: AnalyticsCartSnapshot | null;
    prevCart: AnalyticsCartSnapshot | null;
  }>({cart: null, prevCart: null});
  const setCarts = useCallback(
    (update: (previous: typeof carts) => typeof carts) =>
      startTransition(() => setCartsState(update)),
    [],
  );
  const canTrack = customCanTrack ?? hasAnalyticsConsent;
  const canTrackRef = useRef(canTrack);
  canTrackRef.current = canTrack;

  const guardedPublish = useCallback((event: string, payload: Payload) => {
    if (canTrackRef.current()) publishNow(event, payload);
  }, []);

  const data = customData ?? NO_DATA;
  const value = useMemo<AnalyticsContextValue>(
    () => ({
      canTrack,
      ...carts,
      customData: data,
      // A new function identity per consent answer: the view components re-run their effect when it changes, which is
      // how a shopper who agrees later is still counted for the page they are on.
      publish: canTrack() ? guardedPublish : () => {},
      shop,
      subscribe,
    }),
    [canTrack, carts, guardedPublish, data, shop],
  );

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
      {shop ? <PageView /> : null}
      {shop && currentCart ? (
        <CartAnalytics cart={currentCart} setCarts={setCarts} />
      ) : null}
    </AnalyticsContext.Provider>
  );
}

const NO_DATA: Record<string, unknown> = {};

export function useAnalytics(): AnalyticsContextValue {
  return useContext(AnalyticsContext);
}

// --- view components -----------------------------------------------------------------------------------------

type ViewProps = {
  type: EventName;
  data?: Payload;
  customData?: Record<string, unknown>;
};

function AnalyticsView({type, data = {}, customData}: ViewProps) {
  const location = useLocation();
  const {
    publish,
    cart,
    prevCart,
    shop,
    customData: providerCustomData,
  } = useAnalytics();
  const url = location.pathname + location.search;
  useEffect(() => {
    if (!shop?.shopId) return;
    publish(type, {
      ...data,
      customData: {...providerCustomData, ...customData},
      cart,
      prevCart,
      shop,
      url: window.location.href,
    });
    // The payload is read at publish time; the page identity and consent drive the re-run, as in 2026.4.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publish, url, shop?.shopId]);
  return null;
}

function PageView() {
  return <AnalyticsView type={AnalyticsEvent.PAGE_VIEWED} />;
}

type ViewDataProps = {data?: Payload; customData?: Record<string, unknown>};

// --- cart diff -----------------------------------------------------------------------------------------------

type DiffLine = {id: string; quantity: number};

function CartAnalytics({
  cart: currentCart,
  setCarts,
}: {
  cart: NonNullable<ProviderProps['cart']>;
  setCarts: (
    update: (previous: {
      cart: AnalyticsCartSnapshot | null;
      prevCart: AnalyticsCartSnapshot | null;
    }) => {
      cart: AnalyticsCartSnapshot | null;
      prevCart: AnalyticsCartSnapshot | null;
    },
  ) => void;
}) {
  const {publish, shop, customData, cart, prevCart, canTrack} = useAnalytics();
  const lastEvent = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.resolve(currentCart).then((updated) => {
      if (!live || !updated) return;
      // A cart without an id or a timestamp cannot be told apart from the last one.
      if (updated.lines && (!updated.id || !updated.updatedAt)) return;
      setCarts(({cart: previous, prevCart: before}) =>
        updated.updatedAt !== previous?.updatedAt
          ? {cart: updated, prevCart: previous}
          : {cart: previous, prevCart: before},
      );
    });
    return () => {
      live = false;
    };
  }, [setCarts, currentCart]);

  useEffect(() => {
    if (!cart?.updatedAt) return;
    if (cart.updatedAt === prevCart?.updatedAt) return;
    if (cart.updatedAt === lastEvent.current) return;
    const stored = readStoredCart();
    if (cart.id === stored?.id && cart.updatedAt === stored?.updatedAt) return;
    lastEvent.current = cart.updatedAt;

    const payload = {
      eventTimestamp: Date.now(),
      cart,
      prevCart,
      shop,
      customData,
    };
    publish(AnalyticsEvent.CART_UPDATED, payload);
    try {
      localStorage.setItem(
        'cartLastUpdatedAt',
        JSON.stringify({id: cart.id, updatedAt: cart.updatedAt}),
      );
    } catch {
      // Storage can be unavailable (private mode); the event was published already.
    }

    const previousLines = linesOf(prevCart);
    const currentLines = linesOf(cart);
    for (const prevLine of previousLines) {
      const matches = currentLines.filter((line) => line.id === prevLine.id);
      const matched = matches[0];
      if (matches.length === 1 && matched) {
        if (prevLine.quantity < matched.quantity) {
          publish(AnalyticsEvent.PRODUCT_ADD_TO_CART, {
            ...payload,
            prevLine,
            currentLine: matched,
          });
        } else if (prevLine.quantity > matched.quantity) {
          publish(AnalyticsEvent.PRODUCT_REMOVED_FROM_CART, {
            ...payload,
            prevLine,
            currentLine: matched,
          });
        }
      } else {
        publish(AnalyticsEvent.PRODUCT_REMOVED_FROM_CART, {
          ...payload,
          prevLine,
        });
      }
    }
    for (const line of currentLines) {
      if (!previousLines.some((previous) => previous.id === line.id)) {
        publish(AnalyticsEvent.PRODUCT_ADD_TO_CART, {
          ...payload,
          currentLine: line,
        });
      }
    }
  }, [cart, prevCart, publish, shop, customData, canTrack]);

  return null;
}

function readStoredCart(): {id?: string; updatedAt?: string} | null {
  try {
    return JSON.parse(localStorage.getItem('cartLastUpdatedAt') || 'null') as {
      id?: string;
      updatedAt?: string;
    } | null;
  } catch {
    return null;
  }
}

function linesOf(
  cart: AnalyticsCartSnapshot | null,
): Array<DiffLine & Payload> {
  if (!cart?.lines) return [];
  return flattenConnection(cart.lines as never) as Array<DiffLine & Payload>;
}

export const Analytics = {
  Provider: AnalyticsProvider,
  ProductView: (props: ViewDataProps) => (
    <AnalyticsView {...props} type={AnalyticsEvent.PRODUCT_VIEWED} />
  ),
  CollectionView: (props: ViewDataProps) => (
    <AnalyticsView {...props} type={AnalyticsEvent.COLLECTION_VIEWED} />
  ),
  SearchView: (props: ViewDataProps) => (
    <AnalyticsView {...props} type={AnalyticsEvent.SEARCH_VIEWED} />
  ),
  CartView: (props: ViewDataProps) => (
    <AnalyticsView {...props} type={AnalyticsEvent.CART_VIEWED} />
  ),
};
