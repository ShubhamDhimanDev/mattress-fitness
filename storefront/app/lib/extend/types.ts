// Shared types for the Extend integration (ADR-0009, REQ-EXT-001 to REQ-EXT-005).
// Web-standard APIs only: this code runs on Oxygen workers and possibly Node. No node:* imports in app/lib.

/** The init object our server code passes to fetch. `redirect: 'error'` stops a redirect from carrying the token to another host. */
export type FetchInit = {
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  redirect: 'error';
};

/** Injected so tests (and the mock) need no network stubbing. The global `fetch` is assignable to this. */
export type FetchLike = (url: string, init: FetchInit) => Promise<Response>;

export type SleepFn = (ms: number) => Promise<void>;
export type NowFn = () => number;

/** The two plan families in an Offers response (Extend docs, fetched 2026-10-12). */
export type ExtendPlanType = 'adh' | 'base';

export type ExtendPlanContract = {
  category: string | null;
  coverageIncludes: string | null;
  coverageStarts: string | null;
  /** Documented as an integer (example value 0); the unit is not documented. */
  deductible: number | null;
  /** Months, per the documented example (36). */
  termLength: number | null;
};

export type ExtendPlan = {
  id: string;
  priceCents: number;
  title: string;
  contract: ExtendPlanContract;
  /** https link to Extend's plan details and terms. A plan without one is dropped: every offer must link to terms (REQ-EXT-004). */
  url: string;
  offerPlanId: string | null;
  imageUrl: string | null;
};

export type ExtendCoveredProduct = {
  productId: string;
  quantity: number;
  purchasePriceCents: number;
};

export type ExtendOffer = {
  offerId: string;
  plans: {
    adh: ExtendPlan[];
    base: ExtendPlan[];
    recommended: ExtendPlanType | null;
  };
  coveredProducts: ExtendCoveredProduct[];
};

/** A price we can compare a paid coverage line against. */
export type PlanQuote = {planId: string; priceCents: number};
