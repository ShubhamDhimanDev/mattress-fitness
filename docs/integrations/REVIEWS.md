# Reviews integration (P3B-12, REQ-PDP-005)

Status: built behind an adapter; **no provider chosen or verified (Q-011, CLR-005)**. With `REVIEWS_PROVIDER` unset (the default) reviews are OFF: no section, no JavaScript chunk, no request, no rating markup. Tests are deferred (owner decision, 2026-10-26).

## Flow

- Loader (`routes/products.$handle.tsx`) calls `loadReviewsPageState` (`app/lib/reviews/page.ts`): free when off; when on, reads the aggregate with a 1.2 s deadline (the read keeps running and fills the in-process memory). Gives the stars at the top of the buy box and `aggregateRating` in the product JSON-LD.
- `ReviewsSlot` (heading + `#reviews` anchor) mounts the lazy `ReviewsList` chunk when near the viewport; it calls `GET /api/reviews?handle=&page=&limit=` (page 1 also carries the aggregate; "Load more" appends pages).
- `routes/api.reviews.tsx`: same-origin check, strict handle/page/limit validation (page 1..20, limit 1..20), short public cache (`max-age=60, s-maxage=300, swr=300`) for successes only; any provider failure is HTTP 200 `{"status":"unavailable"}` (no-store) and the page shows "No reviews yet". Reviews off answers 404.
- `app/lib/reviews/service.ts`: in-process memory (5 min, failures 30 s, in-flight sharing) and a ceiling of 120 upstream reads a minute (ASSUMPTION). Per-client rate limiting is not done (needs the host decision, Q-003 / P6-14).
- Text is plain and capped (`sanitize.ts`: tags stripped, control/bidi characters removed, body 2000, title 120); authors are reduced to first name plus initial; an email-like name becomes "Customer". Logs carry reason codes only (`reviews.provider_failed`, `reviews.config_refused`, `reviews.budget_exceeded`).
- JSON-LD: `aggregateRating` only when the provider's aggregate is exact, count > 0 and 1 <= average <= 5. Individual `review` objects are not emitted. Collection cards have no rating slot yet, so none was added.

## Environment (names only; server only)

`REVIEWS_PROVIDER` (`judgeme`; `fake` is refused outside development), `JUDGEME_PRIVATE_API_TOKEN`, `JUDGEME_SHOP_DOMAIN` (`example.myshopify.com`). See `.env.example`.

## Judge.me: documented versus assumed

Source: Judge.me help article "Using Judge.me API" https://judge.me/help/en/articles/8409180-using-judge-me-api (fetched 2026-10-26). The reference at https://judge.me/api/docs is a script-rendered page that returned no content to our fetch, so response schemas could not be read from Judge.me directly.

Documented by Judge.me:

- `GET https://api.judge.me/api/v1/reviews`; required `api_token` and `shop_domain` (`example.myshopify.com`); optional `per_page` (max 100), `page`, `rating`, `published`, `reviewer_id`, `reviewer_email`, `product_id`.
- The private token grants read/write and is for server-side use only; it cannot be self-regenerated (contact support if exposed).
- `product_id` is Judge.me's internal id, not Shopify's. `GET https://api.judge.me/api/v1/products/-1` with `handle` or `external_id` returns a `product` object whose `id` is the internal id. An unknown `product_id` makes `/reviews` return ALL store reviews (the adapter therefore only passes an id from the lookup).
- Rate limits, error codes, pagination totals and the response schema are NOT documented in that article.

Assumed (third-party catalogues only: https://apis.apievangelist.com/store/judge-me-reviews-api/ and a Truto blog post; labelled unofficial): auth goes in the query string; the list is under a `reviews` array; entries carry `id`, `rating`, `body`, `title`, `created_at`, `reviewer.name`, optional `hidden`/`published`. Anything that does not fit is treated as `unavailable`, never guessed. A 404 from the product lookup means "no reviews".

Also assumed: no total count exists, so "more" is `received >= limit` (worst case one empty extra page), and the aggregate is computed from up to 3 pages of 100 reviews (inexact beyond 300, then no count is shown and no rating markup is emitted). A Judge.me aggregate or widget endpoint (`/widgets/product_review`, `/widgets/preview_badge`, returning HTML) exists per a third-party listing but is not used.

## Unblocks

Client chooses the app (Q-011, CLR-005) and provides a Judge.me account: then verify the response fields above with one real request on the development store (V-23), correct `providers/judgeme.ts`, and confirm the private token never appears in logs or the browser.
