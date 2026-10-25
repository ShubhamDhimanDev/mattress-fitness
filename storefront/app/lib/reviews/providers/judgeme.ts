// SERVER ONLY. Judge.me adapter (P3B-12, REQ-PDP-005). UNVERIFIED: there is no Judge.me account (Q-011, CLR-005), so nothing
// here has run against the real service. What is documented and what is assumed is listed in docs/integrations/REVIEWS.md.
//
// Documented (Judge.me help article "Using Judge.me API", fetched 2026-10-26):
//   - GET https://api.judge.me/api/v1/reviews with `api_token` (the PRIVATE token, server side only) and `shop_domain`
//     (`example.myshopify.com`); optional `per_page` (max 100), `page`, `product_id`.
//   - `product_id` is Judge.me's INTERNAL id, not Shopify's. Found with GET https://api.judge.me/api/v1/products/-1 plus
//     `handle` (or `external_id`); the id is the `id` field of the returned `product` object.
//   - An unknown `product_id` makes the reviews endpoint answer with ALL of the store's reviews, so this adapter only ever
//     passes an id it got from the lookup, and shows nothing when the lookup does not return one.
// Assumed (from third-party catalogues, not Judge.me): the list sits under a `reviews` array; each entry has `id`, `rating`,
// `body`, `title`, `created_at`, `reviewer.name`, and optional `hidden` / `published` booleans. A response that does not fit
// is `unavailable`, never guessed at.
//
// The private token travels in the query string because that is how the docs list it; the URL is therefore never logged,
// and `redirect: 'error'` stops a redirect from carrying it to another host.

import type {ReviewsProviderId} from '~/lib/reviews/config';
import type {
  ReviewsAggregate,
  ReviewsAggregateResult,
  ReviewsPageOptions,
  ReviewsProvider,
  ReviewsResult,
  ReviewView,
} from '~/lib/reviews/provider';
import {
  displayAuthor,
  isoDate,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  plainText,
} from '~/lib/reviews/sanitize';

export const JUDGEME_API_BASE = 'https://api.judge.me/api/v1';
const JUDGEME_HOST = 'api.judge.me';
export const JUDGEME_TIMEOUT_MS = 2500;
const AGGREGATE_PAGE_SIZE = 100;
/** Bounds the cost of an aggregate: at most 300 reviews read, then the count is reported as inexact. */
export const AGGREGATE_MAX_PAGES = 3;
const MAX_REMEMBERED_IDS = 500;
const ID_TTL_MS = 60 * 60_000;

export type JudgeMeFetch = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<Response>;

export type JudgeMeDeps = {
  readonly token: string;
  readonly shopDomain: string;
  readonly fetch: JudgeMeFetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  /** Reason codes only. Never a URL, a token, a handle or a review. */
  readonly log?: (
    event: string,
    fields: Record<string, string | number>,
  ) => void;
};

type Fetched =
  | {readonly ok: true; readonly json: unknown}
  | {readonly ok: false; readonly reason: string; readonly status?: number};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Entry = {readonly rating: number; readonly view: ReviewView | null};

function entryOf(raw: unknown): Entry | null {
  if (!isRecord(raw)) return null;
  // A hidden or unpublished review must never be shown or counted.
  if (raw['hidden'] === true || raw['published'] === false) return null;
  const rating = raw['rating'];
  if (
    typeof rating !== 'number' ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return null;
  }
  const id = raw['id'];
  const body = plainText(raw['body'], MAX_BODY_LENGTH);
  if ((typeof id !== 'number' && typeof id !== 'string') || body === '') {
    return {rating, view: null};
  }
  const reviewer = raw['reviewer'];
  const title = plainText(raw['title'], MAX_TITLE_LENGTH);
  return {
    rating,
    view: {
      id: String(id).slice(0, 40),
      rating,
      title: title === '' ? null : title,
      body,
      author: displayAuthor(isRecord(reviewer) ? reviewer['name'] : undefined),
      date: isoDate(raw['created_at']),
    },
  };
}

/** The entries of a `GET /reviews` answer, plus how many the provider sent (for the "is there another page" decision). */
export function parseReviewsPayload(
  json: unknown,
): {readonly entries: readonly Entry[]; readonly received: number} | null {
  if (!isRecord(json)) return null;
  const list = json['reviews'];
  if (!Array.isArray(list)) return null;
  const entries = list.flatMap((raw: unknown) => {
    const entry = entryOf(raw);
    return entry ? [entry] : [];
  });
  return {entries, received: list.length};
}

/** Judge.me's internal id from a `GET /products/-1` answer, or null. */
export function parseProductId(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const product = json['product'];
  if (!isRecord(product)) return null;
  const id = product['id'];
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
    return String(id);
  }
  return typeof id === 'string' && /^[0-9]{1,18}$/.test(id) ? id : null;
}

export function aggregateOf(
  ratings: readonly number[],
  exact: boolean,
): ReviewsAggregate | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, value) => total + value, 0);
  return {
    average: Math.round((sum / ratings.length) * 10) / 10,
    count: ratings.length,
    exact,
  };
}

export function createJudgeMeProvider(deps: JudgeMeDeps): ReviewsProvider {
  const id: ReviewsProviderId = 'judgeme';
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? JUDGEME_TIMEOUT_MS;
  const productIds = new Map<string, {id: string | null; until: number}>();

  async function getJson(
    path: string,
    params: Record<string, string>,
  ): Promise<Fetched> {
    const url = new URL(`${JUDGEME_API_BASE}${path}`);
    // Defence in depth: the base is a constant, but the host is asserted anyway before a token is attached.
    if (url.protocol !== 'https:' || url.hostname !== JUDGEME_HOST) {
      return {ok: false, reason: 'host_refused'};
    }
    url.searchParams.set('api_token', deps.token);
    url.searchParams.set('shop_domain', deps.shopDomain);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await deps.fetch(url.toString(), {
        method: 'GET',
        headers: {Accept: 'application/json'},
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        return {ok: false, reason: 'http', status: response.status};
      }
      return {ok: true, json: (await response.json()) as unknown};
    } catch (error) {
      return {
        ok: false,
        reason: controller.signal.aborted
          ? 'timeout'
          : error instanceof SyntaxError
            ? 'malformed'
            : 'network',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function fail(reason: string, status?: number): {status: 'unavailable'} {
    deps.log?.('reviews.provider_failed', {
      provider: id,
      reason,
      ...(status === undefined ? {} : {status}),
    });
    return {status: 'unavailable'};
  }

  /** `none`: the product is not in Judge.me (no reviews). `unavailable`: could not find out. */
  async function lookupProductId(
    handle: string,
  ): Promise<
    | {readonly kind: 'id'; readonly id: string}
    | {readonly kind: 'none'}
    | {readonly kind: 'unavailable'}
  > {
    const known = productIds.get(handle);
    if (known && known.until > now()) {
      return known.id === null ? {kind: 'none'} : {kind: 'id', id: known.id};
    }
    const answer = await getJson('/products/-1', {handle});
    if (!answer.ok) {
      if (answer.reason === 'http' && answer.status === 404) {
        return {kind: 'none'};
      }
      fail(answer.reason, answer.status);
      return {kind: 'unavailable'};
    }
    const found = parseProductId(answer.json);
    if (found === null) {
      // Not an error worth paging anyone for: an unknown handle and a changed response look the same here, and both
      // mean "show no reviews". Logged once as a shape problem so a changed response is noticed.
      fail('no_product_id');
      return {kind: 'none'};
    }
    if (productIds.size >= MAX_REMEMBERED_IDS) productIds.clear();
    productIds.set(handle, {id: found, until: now() + ID_TTL_MS});
    return {kind: 'id', id: found};
  }

  async function fetchProductReviews(
    productHandle: string,
    options: ReviewsPageOptions,
  ): Promise<ReviewsResult> {
    const product = await lookupProductId(productHandle);
    if (product.kind === 'unavailable') return {status: 'unavailable'};
    if (product.kind === 'none') {
      return {status: 'ok', reviews: [], hasMore: false};
    }
    const answer = await getJson('/reviews', {
      product_id: product.id,
      per_page: String(options.limit),
      page: String(options.page),
    });
    if (!answer.ok) return fail(answer.reason, answer.status);
    const parsed = parseReviewsPayload(answer.json);
    if (parsed === null) return fail('unexpected_shape');
    return {
      status: 'ok',
      reviews: parsed.entries.flatMap((entry) =>
        entry.view ? [entry.view] : [],
      ),
      // No total is documented, so a full page means "maybe more"; the worst case is one empty extra page.
      hasMore: parsed.received >= options.limit,
    };
  }

  async function fetchAggregate(
    productHandle: string,
  ): Promise<ReviewsAggregateResult> {
    const product = await lookupProductId(productHandle);
    if (product.kind === 'unavailable') return {status: 'unavailable'};
    if (product.kind === 'none') return {status: 'ok', aggregate: null};
    const ratings: number[] = [];
    for (let page = 1; page <= AGGREGATE_MAX_PAGES; page += 1) {
      const answer = await getJson('/reviews', {
        product_id: product.id,
        per_page: String(AGGREGATE_PAGE_SIZE),
        page: String(page),
      });
      if (!answer.ok) return fail(answer.reason, answer.status);
      const parsed = parseReviewsPayload(answer.json);
      if (parsed === null) return fail('unexpected_shape');
      for (const entry of parsed.entries) ratings.push(entry.rating);
      if (parsed.received < AGGREGATE_PAGE_SIZE) {
        return {status: 'ok', aggregate: aggregateOf(ratings, true)};
      }
    }
    return {status: 'ok', aggregate: aggregateOf(ratings, false)};
  }

  return {id, fetchProductReviews, fetchAggregate};
}
