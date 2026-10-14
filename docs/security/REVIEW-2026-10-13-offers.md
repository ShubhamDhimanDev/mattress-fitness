# Security review: offers revalidation wiring, commit aa1a23e

Reviewer: security-engineer. Date: 2026-10-13. Scope: commit `aa1a23e` on `feat/foundation-libs-and-shell`: `storefront/app/lib/offers-runtime/**`, `app/lib/cart/**`, routes `cart.tsx`, `cart.$lines.tsx`, `checkout-steps.tsx`, `discount.$code.tsx`, the cart cookie, and the fixes for P-M1, P-M2, P-L1 to P-L4 of [REVIEW-2026-10-13-pages](REVIEW-2026-10-13-pages.md). Focus: T-01, T-02, T-04, T-05, T-06, T-08, T-13.

Line numbers refer to `aa1a23e`. The working tree now holds uncommitted edits by the offers agent (facts.ts, server.ts, cart.tsx, checkout-steps.tsx and others), so re-check lines after they land.

Method: code reading; the 308 Vitest tests of the touched areas re-run (19 files, all pass); the dev server run on port 3700 against bedding.mock.shop with a scratch env file outside the repo (no `.env` file read) and throwaway carts, with hostile requests and a test `OFFER_CONFIG_JSON`; Storefront reads of the resulting carts; a throwaway Vitest probe of `readOfferConfig` with hostile JSON; a fresh `npm run build` and a grep of `dist/client` (83 JS files). The dev server was stopped afterwards (port 3700 verified free). No source file changed. No secret value appears in this note.

## Gate verdict

**PASS WITH CONDITIONS (proposed).** No High. The revalidation is wired and holds on every path I could drive through our server. Three Medium findings must close at the stated points. The residual bypass (a cart built straight through Shopify's public Storefront API, and the checkout URL being visible in page data) is the detective-only limit already accepted in ADR-0006; the owner's written acceptance of that limit is still needed to close T-02 for the phase 4 gate. H-1 (react-router advisories, ADR-0008) is unchanged, not re-run, and still needs the owner's acceptance for development use.

## Earlier findings

| ID | Result | Evidence |
|---|---|---|
| P-M1 cart cookie flags | **Closed** | Live `GET /discount/SAVE10`: `set-cookie: cart=...; Max-Age=864000; Path=/; SameSite=Lax; HttpOnly` (no `Secure` on localhost, by design). `cookie.test.ts` proves `Secure` on a public host, also when the app sees http. `context.ts:58-62` passes `setId`; `cart.tsx:142`, `cart.$lines.tsx:49`, `discount.$code.tsx:46` and `checkout-steps.tsx:154` all use that handler. Caveat in P-L9. |
| P-M2 revalidation not wired | **Closed for paths through our server; detective-only beyond** | See "Bypass hunt" below. |
| P-L1 attribute erase on update | **Closed** | `actions.ts:37-40` type has no `attributes`; live `LinesUpdate` with `attributes:[]`, `merchandiseId` and `price` keys changed only the quantity (line stayed variant 17593, q=2). Test in `hardening.test.ts`. |
| P-L2 Host reflected in canonicals | **Closed for canonical and JSON-LD; one leftover** | `lib/site-origin.ts` takes `PUBLIC_SITE_URL`, falls back to the request only in dev; `site-origin.test.ts` passes. Not live-tested (the dev server refuses a foreign Host with 403). Leftover: P-L10. |
| P-L3 Cache-Control on private responses | **Closed** | Live: `cache-control: private, no-store` on `/cart`, `/checkout-steps` (200 and 302), the permalink redirect and `/discount` (with `vary: Cookie`). |
| P-L4 cart creation by GET | **Partly closed** | `/cart/:lines` refuses non-document destinations and prefetch (live: `Sec-Fetch-Dest: image`, `Sec-Purpose: prefetch;prerender` and `Purpose: prefetch` each gave 400 and no cookie). `/discount/:code` now merges codes but has no guard: live `Sec-Fetch-Dest: image` returned 303 and a new `cart=` cookie. See M-3 / P-L11. |

## Findings

### High

None.

### Medium

**O-M1. A missing or unreadable `OFFER_CONFIG_JSON` fails open, silently (T-02, T-06).**
Evidence: `config.ts:352-375` returns empty rules for a missing value (`none`), an oversized value, bad JSON or a non-object (`invalid`). `server.ts:134-139` logs only when the status is `invalid` or an entry was dropped, and then continues. Empty rules mean no variant is classed as gift, haul-away or protector, so the engine finds nothing to correct and `decideCheckout` answers `ready`. The test `revalidate.test.ts:276` states this as intended ("degrades to no offers"). Probe: `{bad` gives `invalid`, an unset value gives `none`, 40,000 nested arrays and a 100,001-character value give `invalid`; none throws. The code reviewer reached the same finding independently.
Impact: one typo, a missing variable in the production environment, or a value over 100,000 characters switches off every server-side rule at once: haul-away lines are no longer refused (service the client cannot deliver outside the zone), orphan gifts and protectors stay, and nothing alerts anyone. This contradicts the stated rule that an unverified cart must not reach checkout (`checkout.ts:48-52`).
Fix: separate "offers not configured" (allowed in development, set explicitly with a flag such as `OFFERS_ENABLED=false`) from "configuration required but unreadable". In production an `invalid` or `none` result with offers enabled should yield `unavailable` at the hand-off (503 page) and a loud, value-free log, and the same applies to the P4-12 metaobject reader. Add a startup or health check and a test for each branch. Due: before any staging URL that takes orders, and in P4-12.

**O-M2. Coverage lines are not recognised, so Extend coverage is not enforced yet (T-06, T-02).**
Evidence: `extend-seam.ts:16-19` passes an empty `coverageVariantIds` and empty `protectionEligibleLineIds`; `server.ts:148-155` uses them. A coverage variant is therefore an ordinary line and `protection.ts:46-76` never runs. The seam's own comment says so.
Impact: none today, because Extend is mocked behind a flag (ADR-0009) and no coverage product exists in the store. Once the price-point products exist, a coverage line can be bought alone or linked to the wrong item through our own `/cart` endpoint, which breaks the "our server prevents it" claim.
Fix: P5A-06 must supply the variant list from server data before `PUBLIC_EXTEND_ENABLED` is turned on in any shared environment, with the hostile tests (coverage alone, nested under a gift, quantity above the item). Also handle size swap on a covered line (`server.ts:210-246`): after a swap the plan no longer matches the item's price, so the swap must remove or re-quote the coverage. Due: gate of phase 5A.

**O-M3. The server gate is bypassable by anyone who reads the page data or builds a cart through Shopify directly (T-01, T-02; accepted limit of ADR-0006, needs the owner's written acceptance).**
Evidence: live, a cart that the gate blocks (haul-away x5, no delivery choice) still carries `"checkoutUrl","https://..."` in the `/cart` HTML, in `/cart.data` and in `/_root.data` (`fragments.ts:126` selects it; the root loader returns the whole cart). Every path through our server was refused (below), but the URL that skips the gate is handed to the browser. The public Storefront token also allows creating or editing a cart and reading its checkout URL directly.
Impact: a determined shopper can check out a cart that violates an offer rule, for example haul-away outside the zone or a gift without its qualifier. The cost is the service and revenue exposure already described in ADR-0006; the detective control (Flow or webhook reconciliation, phase 5B) is what catches it after the order.
Fix: (1) the owner accepts the detective-only limit in writing (propose wording: "Offer rules are enforced before checkout on our pages; carts built outside them are detected after the order"); (2) as hygiene, project the cart for the browser without `checkoutUrl` (the gate redirects server-side, so the UI does not need it); this removes the casual path, not the determined one; (3) make sure the reconciliation job exists before launch.

### Low

**O-L1. Product-facts failure over-repairs (T-02, availability).** `facts.ts:100-103` returns "nothing known" when the read fails, and `server.ts:104-112` then gives lines no collection ids. A gift qualified by collection stops qualifying and is removed as an orphan (`gifts.ts:70-79`), and the notice (`messages.ts:79`) says the qualifying item left the cart, which is false. Fail-closed for revenue, but it destroys a shopper's gift on a transient error. Also `collections(first: 20)` and `variants(first: 50)` (`queries.ts:38,49`) silently truncate. Fix: on a facts read failure return `unavailable` for the hand-off and do not apply gift corrections; mark the view as unverified instead of repairing. (Code review finding, confirmed.)

**O-L2. Step action drops errors (T-02 usability).** `checkout-steps.tsx:148-156` redirects on `rejected` and ignores `outcome.result.errors`, so a failed accept loops back to the same step with no message. Not exploitable, and the loop cannot skip the gate. Fix: carry a fixed message in the redirect state. (Code review finding, confirmed.)

**O-L3. The gate hands off an emptied cart (T-02).** Live: `/cart/17609:2` (gift alone) is repaired to an empty cart and `/checkout-steps` then answers 302 to the Shopify checkout URL (`checkout-steps.tsx:70-82` tests emptiness before the repair, `decideCheckout` after). Harmless (Shopify shows an empty checkout) but wrong. Fix: re-test `checked.cart.lines.nodes.length` after revalidation and redirect to `/cart`.

**O-L4. `/discount/:code` still creates a Shopify cart per request (T-13).** Live proof above; `discount.$code.tsx:15-52` has no `mayCreateCartFromLink` check. A cross-site subresource cannot store the SameSite=Lax cookie, but each request still costs Storefront API quota. Fix: apply the same destination and purpose guard, and rate limit both routes at the host (Q-003).

**O-L5. A cross-site top-level link can replace the shopper's cart (T-08).** `cart.$lines.tsx:38-50` always creates a new cart and overwrites the cookie when the navigation is a document load, which Lax allows. An email or ad link silently swaps the cart; Shopify's own permalinks behave the same, and the shopper still reviews and pays. Fix, if wanted: add to the existing cart instead of replacing it. The `Sec-Fetch-Dest` guard is sound for subresources (every non-`document` value is refused, prefetch and prerender headers are refused) but cannot stop a navigation, and it allows requests with no Fetch Metadata (curl, old browsers). It is a guard, not rate limiting.

**O-L6. Amplification (T-13).** One cart request runs up to three repair passes (each a mutation and a read) plus the product, variant and cart reads: roughly ten Storefront calls (`revalidate.ts:30,148-176`, `server.ts:188-199`). Every cart GET repeats it. Fix: rate limit and cap at the host; skip the product read when no rule needs it.

**O-L7. Hydrogen's own error logging may print cart ids (T-04, T-05).** The storefront client's `logErrors` default prints thrown errors with a `cause` that holds the query and variables (`@shopify/hydrogen` index.js lines 1719-1760, 1845); a cart id carries its access key. Our own logging is clean (messages only, no variables; `console.*` calls listed below). I did not trigger a thrown storefront error, so I did not see the output. Fix: set `logErrors` to a function that logs the message only, or redact in the log sink.

**O-L8. A stale cart cookie makes adds fail silently (availability).** Live: `cart=<unknown id>` then `POST /cart` gave 200 with `cart: null`, no error text and no new cookie, so the shopper cannot add to a cart until the cookie expires (up to ten days). `/cart` and `/checkout-steps` handle the stale cookie correctly (`/checkout-steps` redirects to `/cart`). Not a bypass. Whether a completed order's cart behaves the same on a real store is unverified. Fix: on a null cart from a mutation with an existing cookie, create a cart and set the cookie.

**O-L9. Cookie `Secure` depends on the Host header and request URL (T-08, carries P-L5).** `cookie.ts:12-25` omits `Secure` for localhost names read from the request URL, and `isSameOriginRequest` (`http.ts:34-45`) compares hosts taken from the request. A request cannot gain anything for another user by forging its own Host, but the control relies on the host fixing Host. Prefer `secure` from environment (production = true). The CSRF check is a second layer: live, React Router's own check already returned 400 for `Origin: https://evil.example` and `Origin: null` on `/cart` and `/checkout-steps` before our check ran; same-origin and no-Origin requests pass (Lax covers the latter).

**O-L10. `robots.txt` builds its origin from the request (T-07/T-08 adjacent).** `routes/[robots.txt].tsx:5` uses `url.origin` for the sitemap line. Use `resolveSiteOrigin`.

### Forward-looking (no finding yet)

- Haul-away eligibility: the ZIP is `null` in the context (`server.ts:150-154`), so haul-away always fails closed today (live: haul-away x5 and x99 blocked, with qualifier and without). When P5B stores the ZIP and delivery choice, they must be server-held; the `delivery_choice` cart attribute is writable through Shopify's public API (`attributes.ts` says so) and must never be the only evidence.
- The decline attribute is an unauthenticated cart attribute by design; it only records a decline for customer service.

## Verified

### Bypass hunt for the Shopify checkout URL (P-M2)

All driven live with throwaway carts:
- Every route that creates or changes a cart revalidates: the `/cart` action (`cart.tsx:130`), the `/cart` loader (167), `/cart/:lines` (redirects to `/checkout-steps`, not to Shopify), `/discount/:code` (adds a code only), `/checkout-steps` loader and action. No server route or component links to `checkoutUrl` except through the gate: `grep checkoutUrl` finds only `fragments.ts`, `checkout.ts` (used by the gate and by `CartSummary` to decide whether to show the button) and the generated types. The "Checkout" button targets `/checkout-steps` with `reloadDocument`.
- Haul-away alone, with a qualifier, x5 and x99, through the `/cart` action and through the permalink: `/checkout-steps` returned the blocked page (200, no Location); `/cart` showed "Checkout is on hold" and no checkout link.
- Gift alone: removed on add. Gift x3 with a qualifier: lowered to 1. Wrong-size protector: removed. Qualifier removed: gift and protector removed (protector parts covered by `revalidate.test.ts:205`; the live mock cannot resolve `nodes(ids)` or `node(id)`, so the comfort step and size swap cannot be exercised live).
- Prefetch: `Link prefetch` is used only on product, collection, blog and home links; none targets `/cart`, `/checkout-steps` or the permalink. `/checkout-steps` with `Sec-Purpose: prefetch` returned the same gate answer (a GET that repairs a cart is idempotent and needs the cookie, which Lax withholds from cross-site subresources).
- Stale and forged cart cookies (`garbage`, an all-zero id with and without a key, `../`, CR-LF injection): `/cart` 200 empty, `/checkout-steps` 302 to `/cart`, no header injection, no checkout redirect.
- Step parameter: `?step=../../x`, `<script>`, `haul-away` all fall to the gate's decision; only `comfort-guarantee` is a known step (`checkout-steps.tsx:43-45`). A forged accept with extra fields (`merchandiseId`, `quantity=50`) ignored them: the add comes only from the engine (`server.ts:252-277`, test `steps.test.ts:172`).
- If revalidation throws, the `/cart` action still returns the cart (`cart.tsx:134-139`) but `/checkout-steps` returns `unavailable` 503 (`checkout-steps.tsx:47-60,88`): fails closed.
- Direct Shopify cart URLs and Storefront API carts: not preventable, see O-M3.

### Actions, CSRF and input

- Unsupported actions (`AttributesUpdate`, `BuyerIdentityUpdate`, `NoteUpdate`, `MetafieldsSet`, `GiftCardCodesUpdate`, `SelectedDeliveryOptionsUpdate`, `DeliveryAddressesAdd`, `__proto__`, `constructor`) each returned 400 "That cart action is not supported." (`cart.tsx:119`). So cart attributes (delivery choice, declines) and buyer identity cannot be written by the browser through our server.
- Malformed JSON and a 3 MB `cartFormInput` returned 400 with fixed text. There is no explicit body-size cap in the app; set one at the host.
- Role and attribute forgery: `cart-mapper.ts` never reads a role from the cart; roles come from variant lists only (`classifyLine`, `roles.ts`). Live, a gift line added with line properties `role=regular` and `Role=coverage` behaved as a gift (capped, kept only with a qualifier). Underscore keys are rejected on add (400). Tests: `revalidate.test.ts:79,96,115`.
- Size swap (`server.ts:210-246`, `sizes.ts`): the browser sends a line id and a variant id; the quantity comes from the cart, the target must be available, in the same product and differ only in size, and offer-only lines are refused. Live (mock cannot resolve variants, so every case fails closed): another product's variant, a Product GID, a foreign line id each rejected with a fixed message. `steps.test.ts:81-170` covers the success and tamper cases with a fake cart. A swap that breaks a protector's size is repaired by the revalidation that follows (`cart.tsx:130`).
- `OFFER_CONFIG_JSON` parsing (`config.ts`): size cap 100,000 characters, every id checked against a GID pattern, counts bounded, a malformed rule dropped whole. Probe: `__proto__` keys in a size map and at the top level did not pollute (`{}.polluted` stayed undefined); 14,000 postal codes parsed in 24 ms; `maxPieces` 1e20 and negative thresholds switch the rule off with a warning; deep nesting is caught as `invalid`. The source is an operator-set environment variable, not a browser input, so the remaining risk is O-M1 (what happens when it is wrong), not injection.
- Error text: shoppers see fixed messages only (`cart.tsx`, `checkout-steps.tsx`, `messages.ts`); the blocked page shows server-written reasons with no ids; cart user errors go through `readCartMessages` (cleaned, capped).
- PII in logs: the new code's only logging is `console.error`/`console.warn` with an error message or a rule-name note (`facts.ts:19`, `server.ts:137`, `cart.tsx:135,173`, `checkout-steps.tsx:54`); no names, emails, ZIPs, cart ids or variables. See O-L7 for Hydrogen's own logger.
- Client bundle: fresh build, `dist/client` (83 files) has 0 hits for `OFFER_CONFIG_JSON`, `readOfferConfig`, `revalidateCartOffers`, `swapLineSize`, `acceptComfortGuarantee`, `isSameOriginRequest`, `mayCreateCartFromLink`, `cartSetId`, `giftVariantIdsBySize`, `protectorVariantIdBySize`, `EXTEND_`, `SHOPIFY_ADMIN`, `SESSION_SECRET`, `PRIVATE_STOREFRONT`, `CLIENT_SECRET`, `X-Extend-Access`, `WEBHOOK_SECRET`. The dev server prints env variable names only.

## Threat model verification (this review)

| ID | Status |
|---|---|
| T-01 | Verified: no price, discount or eligibility read from the browser; extra keys dropped live; revalidation on every server path. Residual: O-M3 (direct Storefront API, accepted limit pending owner) |
| T-02 | Partial: gifts, protectors, haul-away enforced and live-tested; O-M1 (config fails open), O-L1, O-L3; detective control still to be built (phase 5B) |
| T-04 | Verified: cart cookie flags (P-M1 closed), bundle clean; O-L7 open |
| T-05 | Verified for the new code; O-L7 (Hydrogen logger) unverified |
| T-06 | Partial: P-L1 closed; O-M2 (coverage not recognised until P5A-06) |
| T-07 | P-L2 closed for canonical and JSON-LD; O-L10 |
| T-08 | Verified in dev: CSRF layers, Lax cookie, Sec-Fetch guard on the permalink; O-L5, O-L9 |
| T-13 | Partial: O-L4, O-L6; no rate limits until the host is chosen (Q-003) |
| T-03, T-09, T-10, T-11, T-12, T-14, T-15, T-16 | Not changed by this commit; T-12 still open (H-1) |

## Could not verify

A real store: the mock cannot resolve `nodes(ids)` or `node(id)`, so the comfort-guarantee step, size swap success, add-on offers and collection-qualified gifts were covered by unit tests with a fake cart, not live. Whether `cartLinesUpdate` with a `merchandiseId` keeps line properties on Shopify. How a completed order's cart behaves with the stale-cookie path. Host behaviour (Host and forwarded-host handling, TLS termination, edge caching, rate limits, request-size limits; Q-003). Hydrogen's error log output (O-L7). The production build served with headers. The uncommitted edits in the working tree (offers agent) were not reviewed.
