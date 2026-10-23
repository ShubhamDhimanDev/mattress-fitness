# Guest order tracking (REQ-ACC-003, P6-08, SD-05, Q-009, threat T-09)

Security review 2026-10-24: pass with conditions (`docs/security/REVIEW-2026-10-24-guest-tracking.md`). Code-side fixes for M-1, L-1, L-4, L-5, L-6 and I-2 are in; L-3 (nginx lookup zone), the nginx and adapter side of M-1, L-7 and the re-review are not done here.

Status: **built against a typed fake Admin client; UNVERIFIED against any real store.** No Admin call has ever been made by this code. Nothing here is "done" until a development store and a `read_orders`-only token exist (V-09, V-20) and the client has acknowledged SD-05.

## Behaviour

| Item              | Behaviour                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route             | `storefront/app/routes/track-order.tsx`. `GET` shows the form (or the unavailable notice); the query string is never read. `POST` does the lookup. No lookup on `GET`.                                                                                                                                                                      |
| Input             | Order number (`1001`, `#1001`, `ORDER-1001`, optional split suffix `1001-A`) and email. Bounded, pattern-checked (`guest-lookup.ts`). Form body capped at 4 KB.                                                                                                                                                                             |
| Lookup            | Admin GraphQL, one constant query, the only user-derived value travels as the variable `name:<number>` after validation (`GUEST_ORDER_LOOKUP_QUERY`). Host is `<shop>.myshopify.com` from `PUBLIC_STORE_DOMAIN`, token `SHOPIFY_ADMIN_API_ACCESS_TOKEN` (read_orders only), redirects refused, 6 s timeout, 500 KB body cap, one attempt.   |
| Match             | Order name equal, email equal (normalised, constant-time compare, best effort in JavaScript) and `createdAt` within 60 days. Every check always runs.                                                                                                                                                                                       |
| Result            | Minimal view only: order name, date, status label, item titles and quantities, shipment status, carrier, tracking number, and a tracking link only for an allow-listed carrier host (see below). No email, address, phone, prices or customer data.                                                                                         |
| Any other outcome | One response: HTTP 200, `{status: 'not_found', message}` with the same message and headers: wrong email, no such order, malformed or missing input, over-size input, order older than 60 days, Admin API error, timeout or bad answer. The message also carries the "sign in or use the confirmation email link" guidance for older orders. |
| Timing class      | The response is held until at least 800 ms after the request began (`GUEST_LOOKUP_MIN_DURATION_MS`), so a request that skipped the Admin API is not faster than one that used it. Mitigation, not a guarantee; slower lookups are not padded.                                                                                               |
| Not configured    | No token or store domain: page shows "Order lookup is not available right now" (no form), `POST` answers 503 with the same notice. Fails closed; nothing is faked.                                                                                                                                                                          |
| Rate limited      | HTTP 429 with `Retry-After` and a fixed message. Limiter failure: 503 unavailable (fails closed).                                                                                                                                                                                                                                           |
| Method and origin | Non-POST: 405 (`Allow: POST`). Cross-origin (`Origin` host mismatch or `Sec-Fetch-Site: cross-site`): 403. Checked before the body is read or any counter touched.                                                                                                                                                                          |
| Headers and meta  | `Cache-Control: private, no-store`, `Vary: Cookie`, `X-Robots-Tag: noindex, nofollow`, `<meta robots noindex, nofollow>`.                                                                                                                                                                                                                   |
| Logs              | Event names, codes and counts only: `guest_lookup.completed`, `rate_limited` (with `limitedBy`), `limiter_failed`, `upstream_failed`, `unavailable`, `rejected`, `config_invalid`. Never an order number, email, client address, token or message text. A test greps logs across all outcomes.                                              |

## Rate limiting (R-27, P6-14)

Interface: `RateLimitStore` in `app/lib/orders/guest-lookup-limiter.ts` with two async operations, `peek(scope, key, rule)` (read only) and `hit(scope, key, rule)` (record), both returning `RateLimitResult`. The gate (`createGuestLookupGate`) decides which counters apply and fails closed if a store rejects, throws, or answers something unexpected, in either operation.

| Counter                | Default (per 15 min) | Purpose                                                                                |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| overall                | 300                  | ceiling across everyone (checked first; alert on `limitedBy=overall`)                  |
| address                | 10                   | one client trying many orders (IPv6 counted per /64)                                   |
| order number + address | 3                    | one client guessing emails for one order                                               |
| order number           | 10                   | one order, from anywhere: cannot be dodged by changing address or email (security L-1) |
| email                  | 5                    | one email probed from many addresses                                                   |

Two passes (L-1). The gate first PEEKS at every counter, overall first, and records nothing; only if all allow does it HIT them all. An attempt that any counter refuses is recorded nowhere, so a flood past the ceiling or from one blocked address cannot burn a victim's email or order allowance or fill the stores. The two passes are separate awaits, so simultaneous requests can both pass the peek and a counter can be exceeded by the number in flight (a hit that then refuses still refuses the request). Malformed values count against the overall and address counters only. Keys are HMAC-SHA-256 hashes (random per-instance key), so no raw order number, email or address reaches a store key; a failed key import is not cached and is retried once.

Trade-off to accept (owner): the email and order-number counters let anyone hold one person's or one order's guest lookup shut for 15 minutes. The shopper can still sign in or use the link in the confirmation email, and the message says so. Ops alert on `guest_lookup.rate_limited` with `limitedBy=email|order|overall` (event name and `limitedBy` are the only fields needed; `clientSource` and `retryAfterSeconds` are also logged).

The shipped store is `createInMemoryRateLimitStore` (`kind: 'instance'`): **per runtime instance**, bounded to 5000 keys per scope, forgotten on restart. On Oxygen each isolate has its own memory; on a Node server there is a counter per process. It slows casual guessing; it is not a hard limit. **P6-14** replaces it with a shared store (Cache API key, edge rule, or a Shopify-side control); waits on Q-003. The host's own per-address limit (nginx, which sees the real address) is the authoritative per-address layer; that is the devops agent's file.

## Client address (security review M-1, L-5)

There is **no default header**. The address is read from the ONE header named by `TRUSTED_CLIENT_IP_HEADER`, lower-cased and trimmed, and only if the name is one of `oxygen-buyer-ip`, `x-real-ip`, `cf-connecting-ip`, `true-client-ip`, `x-forwarded-for` (last entry, the one the nearest proxy appended). Unset, empty, an unlisted name, an absent header, a joined value (`a, b`) on any header but `x-forwarded-for`, or a value that is not a valid IPv4 or IPv6 address all give one shared `unknown` bucket (stricter, never looser). No other header is consulted, so a client-sent `oxygen-buyer-ip` or `cf-connecting-ip` is ignored unless the deployment named it.

An earlier version of this document and the code defaulted to `oxygen-buyer-ip` and said it was "absent anywhere but Oxygen". That was wrong behind our nginx, which passes `Oxygen-Buyer-IP`, `CF-Connecting-IP` and `True-Client-IP` through from the client, and the Node adapter forwards every header: a client could pick its own "address". Now the deployment must opt in. On the VPS: set `TRUSTED_CLIENT_IP_HEADER=x-real-ip` and have nginx overwrite `X-Real-IP` with `$remote_addr` and blank the other names (devops). On Oxygen: `oxygen-buyer-ip`, only after Q-003 confirms Oxygen overwrites an inbound copy (UNVERIFIED).

Key shape: IPv4 as written (leading zeros dropped); IPv6 reduced to its /64 (`v6:2001:db8:0:1::/64`) because one home connection owns a /64 and rotating low bits would otherwise dodge the counters; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is the IPv4 address. The address is never logged; the log carries only `clientSource` (`header` or `none`), so a rising `none` count shows the header is missing or wrong.

## Tracking links (security review L-4)

A tracking URL becomes a link only if it is `https`, has no username or password, uses the default port, has a named host (no IP literal, no trailing dot, at least two labels), is at most 2000 characters, and its host equals or is a subdomain of an allowed carrier domain. Built in: `ups.com`, `fedex.com`, `usps.com`, `dhl.com`, `ontrac.com`. `TRACKING_LINK_HOSTS` adds more: comma-separated bare domains (for example `freight.example.org,whiteglove.example.net`), at most 30, each lower-cased and de-duplicated; an entry with a scheme, path, port, wildcard, IP address, single label, credentials or space is refused and counted (one `guest_lookup.config_invalid` warning per instance with the count only, never the value). Any other link is not shown: the carrier name and tracking number stay as text. The client's own freight and white-glove carriers are not known yet; they must come from the client.

## Environment names

| Name                             | Used for                                                                                                                                                                                                                                                                                                                                      | Status                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | the `read_orders`-only Admin token (shared with the Extend sync today; a separate app and token is advised, review L-7), with `PUBLIC_STORE_DOMAIN`                                                                                                                                                                                           | exists                  |
| `TRUSTED_CLIENT_IP_HEADER`       | which one header carries the caller's address (see above). Unset means the shared `unknown` bucket                                                                                                                                                                                                                                            | new, read now           |
| `TRACKING_LINK_HOSTS`            | extra carrier domains whose tracking pages may be linked                                                                                                                                                                                                                                                                                      | new, read now, optional |
| `GUEST_LOOKUP_KEY_SECRET`        | FUTURE (P6-14): one 32-byte random secret, `root:root 0600` beside `SESSION_SECRET`, never `PUBLIC_`, distinct from the other secrets, used to derive per-scope counter keys (HKDF) when counters leave the process. NOT read by any code yet; today each instance uses a random key. Rotate by restart (counters reset, nothing else breaks) | not implemented         |

None of these may carry a `PUBLIC_` prefix. The names are not yet in the root `.env.example`, `docs/deployment` or the runbook.

## Files

`app/routes/track-order.tsx`; `app/lib/orders/guest-lookup.ts` (existing pure library, plus tracking-link rules and the read-only `peek` on the limiter), `guest-lookup-handler.ts` (flow), `guest-lookup-address.ts` (client address), `guest-lookup-client.ts` (Admin client behind `GuestOrderAdminClient`), `guest-lookup-limiter.ts` (store interface, in-memory store, hasher, two-pass gate); `app/components/orders/*`; tests in `app/lib/orders/guest-lookup.test.ts`, `tests/unit/orders/*`, `tests/unit/routes/track-order.test.ts`, `tests/e2e/track-order.spec.ts` (written, not run).

## UNVERIFIED list (all of it until a dev store and token exist)

1. The app has `read_orders` on the client's store and `Order.email`, `displayFulfillmentStatus`, `lineItems`, `fulfillments { displayStatus trackingInfo }` are readable with it (V-20).
2. `orders(query: "name:1001")` matches the order named `#1001`; behaviour with a custom order-name prefix/suffix (the library assumes the default `#`; `shopifyOrderName` takes a prefix but the route does not use it) and with split orders `1001-A`.
3. Without `read_all_orders`, orders older than about 60 days are absent from the result (F-42, secondary sources). With `read_all_orders` the library still enforces 60 days itself.
4. Enum values of `OrderDisplayFulfillmentStatus` and `FulfillmentDisplayStatus` used for labels; unknown values fall back to "Being prepared" / no label.
5. The Admin API version `2026-10` (shared constant with the Extend sync).
6. Admin API latency versus the 800 ms response floor; and the Admin API cost/throttle for `orders(first: 5)`.
7. The client-address header on the chosen host (Q-003): that nginx overwrites `X-Real-IP`, blanks the other address headers and that the Node adapter drops untrusted ones (devops files, not verified here); that Oxygen overwrites an inbound `oxygen-buyer-ip`.
8. Real browser behaviour of the page (focus move to the answer, axe, 360 px): the Playwright spec has not been run.
9. The client has not acknowledged SD-05 (AWAITING CLIENT, B-11); REQ-ACC-003 stays Pending approval.

## Navigation

The header utility link "Track order" already points to `/track-order` and now resolves (to the form, or the unavailable notice). The footer "Track your order" and "Order tracking" links stay `awaitingContent` in `app/lib/navigation.ts` and `tests/unit/pages/shell-content.test.ts` asserts they are hidden; that file is outside this task's ownership, so it is unchanged. Remove the two flags and update that test once the lookup is verified on a dev store.
