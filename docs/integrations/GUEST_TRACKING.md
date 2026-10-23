# Guest order tracking (REQ-ACC-003, P6-08, SD-05, Q-009, threat T-09)

Status: **built against a typed fake Admin client; UNVERIFIED against any real store.** No Admin call has ever been made by this code. Nothing here is "done" until a development store and a `read_orders`-only token exist (V-09, V-20) and the client has acknowledged SD-05.

## Behaviour

| Item              | Behaviour                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route             | `storefront/app/routes/track-order.tsx`. `GET` shows the form (or the unavailable notice); the query string is never read. `POST` does the lookup. No lookup on `GET`.                                                                                                                                                                      |
| Input             | Order number (`1001`, `#1001`, `ORDER-1001`, optional split suffix `1001-A`) and email. Bounded, pattern-checked (`guest-lookup.ts`). Form body capped at 4 KB.                                                                                                                                                                             |
| Lookup            | Admin GraphQL, one constant query, the only user-derived value travels as the variable `name:<number>` after validation (`GUEST_ORDER_LOOKUP_QUERY`). Host is `<shop>.myshopify.com` from `PUBLIC_STORE_DOMAIN`, token `SHOPIFY_ADMIN_API_ACCESS_TOKEN` (read_orders only), redirects refused, 6 s timeout, 500 KB body cap, one attempt.   |
| Match             | Order name equal, email equal (normalised, constant-time compare, best effort in JavaScript) and `createdAt` within 60 days. Every check always runs.                                                                                                                                                                                       |
| Result            | Minimal view only: order name, date, status label, item titles and quantities, shipment status, carrier, tracking number and https tracking link. No email, address, phone, prices or customer data.                                                                                                                                        |
| Any other outcome | One response: HTTP 200, `{status: 'not_found', message}` with the same message and headers: wrong email, no such order, malformed or missing input, over-size input, order older than 60 days, Admin API error, timeout or bad answer. The message also carries the "sign in or use the confirmation email link" guidance for older orders. |
| Timing class      | The response is held until at least 800 ms after the request began (`GUEST_LOOKUP_MIN_DURATION_MS`), so a request that skipped the Admin API is not faster than one that used it. Mitigation, not a guarantee; slower lookups are not padded.                                                                                               |
| Not configured    | No token or store domain: page shows "Order lookup is not available right now" (no form), `POST` answers 503 with the same notice. Fails closed; nothing is faked.                                                                                                                                                                          |
| Rate limited      | HTTP 429 with `Retry-After` and a fixed message. Limiter failure: 503 unavailable (fails closed).                                                                                                                                                                                                                                           |
| Method and origin | Non-POST: 405 (`Allow: POST`). Cross-origin (`Origin` host mismatch or `Sec-Fetch-Site: cross-site`): 403. Checked before the body is read or any counter touched.                                                                                                                                                                          |
| Headers and meta  | `Cache-Control: private, no-store`, `Vary: Cookie`, `X-Robots-Tag: noindex, nofollow`, `<meta robots noindex, nofollow>`.                                                                                                                                                                                                                   |
| Logs              | Event names, codes and counts only (`guest_lookup.completed                                                                                                                                                                                                                                                                                 | rate_limited | limiter_failed | upstream_failed | unavailable | rejected`). Never an order number, email, client address, token or message text. A test greps logs across all outcomes. |

## Rate limiting (R-27, P6-14)

Interface: `RateLimitStore.hit(scope, key, rule) -> Promise<RateLimitResult>` in `app/lib/orders/guest-lookup-limiter.ts`. The gate (`createGuestLookupGate`) decides which counters apply and fails closed if a store rejects, throws, or answers something unexpected.

| Counter                | Default (per 15 min) | Purpose                                  |
| ---------------------- | -------------------- | ---------------------------------------- |
| address                | 10                   | one client trying many orders            |
| order number + address | 3                    | one client guessing emails for one order |
| email                  | 5                    | one email probed from many addresses     |
| overall                | 300                  | ceiling across everyone                  |

Counters are checked in that order; an attempt refused earlier is not recorded on a later counter (a blocked attacker cannot burn a victim's email allowance). Malformed values count against the address only. Keys are HMAC-SHA-256 hashes (random per-instance key), so no raw order number, email or address reaches a store key.

The shipped store is `createInMemoryRateLimitStore` (`kind: 'instance'`): **per runtime instance**, bounded to 5000 keys per scope, forgotten on restart. On Oxygen each isolate has its own memory; on a Node server there is a counter per process. It slows casual guessing; it is not a hard limit. **P6-14** replaces it with a shared store (Cache API key, edge rule, or a Shopify-side control) and needs one shared hashing secret across instances; waits on Q-003.

Client address: taken from one header named by `TRUSTED_CLIENT_IP_HEADER` (allow-list: `cf-connecting-ip`, `x-real-ip`, `oxygen-buyer-ip`, `x-forwarded-for` last entry, `true-client-ip`), default `oxygen-buyer-ip`. A missing or malformed value puts the caller in one shared `unknown` bucket (stricter). If the header is client-controllable on the chosen host, per-address counters can be dodged; the email and overall counters cannot. New environment variable name: `TRUSTED_CLIENT_IP_HEADER` (not yet in `.env.example` or deployment docs; outside this task's file ownership).

## Files

`app/routes/track-order.tsx`; `app/lib/orders/guest-lookup.ts` (existing pure library), `guest-lookup-handler.ts` (flow), `guest-lookup-client.ts` (Admin client behind `GuestOrderAdminClient`), `guest-lookup-limiter.ts` (store interface, in-memory store, hasher, gate); `app/components/orders/*`; tests in `app/lib/orders/guest-lookup.test.ts`, `tests/unit/orders/*`, `tests/unit/routes/track-order.test.ts`, `tests/e2e/track-order.spec.ts` (written, not run).

## UNVERIFIED list (all of it until a dev store and token exist)

1. The app has `read_orders` on the client's store and `Order.email`, `displayFulfillmentStatus`, `lineItems`, `fulfillments { displayStatus trackingInfo }` are readable with it (V-20).
2. `orders(query: "name:1001")` matches the order named `#1001`; behaviour with a custom order-name prefix/suffix (the library assumes the default `#`; `shopifyOrderName` takes a prefix but the route does not use it) and with split orders `1001-A`.
3. Without `read_all_orders`, orders older than about 60 days are absent from the result (F-42, secondary sources). With `read_all_orders` the library still enforces 60 days itself.
4. Enum values of `OrderDisplayFulfillmentStatus` and `FulfillmentDisplayStatus` used for labels; unknown values fall back to "Being prepared" / no label.
5. The Admin API version `2026-10` (shared constant with the Extend sync).
6. Admin API latency versus the 800 ms response floor; and the Admin API cost/throttle for `orders(first: 5)`.
7. The client-address header on the chosen host (Q-003).
8. Real browser behaviour of the page (focus move to the answer, axe, 360 px): the Playwright spec has not been run.
9. The client has not acknowledged SD-05 (AWAITING CLIENT, B-11); REQ-ACC-003 stays Pending approval.

## Navigation

The header utility link "Track order" already points to `/track-order` and now resolves (to the form, or the unavailable notice). The footer "Track your order" and "Order tracking" links stay `awaitingContent` in `app/lib/navigation.ts` and `tests/unit/pages/shell-content.test.ts` asserts they are hidden; that file is outside this task's ownership, so it is unchanged. Remove the two flags and update that test once the lookup is verified on a dev store.
