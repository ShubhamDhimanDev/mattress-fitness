# Security review: pages and catalog commits 8c533e2 and 46e64a2

Reviewer: security-engineer. Date: 2026-10-13. Scope: commits `8c533e2` (quiz, compare, store locator routes on fixture data) and `46e64a2` (catalog data layer, home, collection, product, search, cart pages), 119 files, on `feat/foundation-libs-and-shell`. Prior review: [REVIEW-2026-10-12-foundation](REVIEW-2026-10-12-foundation.md). Focus: T-01, T-02, T-05, T-07, T-08, T-13.

Method: code reading of the routes and libraries; ad hoc probes of the real modules (sanitiser, redirect, cart input and action validators) run on Node 22 from the scratchpad directory (no repo file was changed); the dev server run locally on port 3000 against mock.shop (the public demo store, no client data) with hostile requests, then stopped; React Router and Hydrogen source read under `node_modules` for CSRF, cookie and JSON-LD behaviour; the existing `dist/client` bundle grepped; `npm audit --omit=dev`; the three directly relevant Vitest files re-run (99 tests pass). No `.env` file was read. No secret value appears in this note. The probes created throwaway carts on mock.shop only.

## Gate verdict

**PASS WITH CONDITIONS (proposed)** for a development branch that deploys nothing. No new High. The earlier open redirect (M-1) and unsanitised HTML (M-3) are fixed and verified. Two Medium findings are open and must be closed before the gate of the phase named in each (P-M1 before any staging URL; P-M2 at P4-09/P4-11). H-1 (react-router advisories, ADR-0008) is unchanged and still needs the owner's written acceptance for development use. Not a verdict for production.

## Findings

### High

None new. Carry-over H-1 (T-12, T-13): `npm audit --omit=dev` still reports 7 findings (2 high, 4 moderate, 1 low), all through react-router 7.16.0 and the packages that depend on it (`@react-router/node`, `@react-router/dev`, `@shopify/hydrogen`, `react-router-dom`). No dependency file changed between `392f52f` and `46e64a2`. Reachability for the new code: the "open redirect via backslash in Link" advisory needs attacker-controlled `to` values; every new `Link` target is built from validated handles or slugs (`CompareTable.tsx:60`, `StoreCard.tsx:57`, store and search link builders), so it is not reachable from request input. The route-matching denial of service stays reachable. Fix: P1-12 (Hydrogen migration) before any public URL.

### Medium

**P-M1. The `cart` cookie is set without HttpOnly, SameSite, Secure or an expiry (T-04, T-05, T-08).**
Evidence: live response from `GET /discount/SAVE10` was `set-cookie: cart=c1-...%3Fkey%3D...; Path=/` and nothing else. Source: Hydrogen's `cartSetIdDefault` (`node_modules/@shopify/hydrogen/dist/development/index.js:1677-1688`) adds only `path`; `createHydrogenContext` uses it unless `cart.setId` is given (`index.js:4300`), and `app/lib/context.ts:57-59` passes only `queryFragment`. The same default is used by `cart.setCartId` in `routes/cart.tsx:86`, `discount.$code.tsx:31` and `cart.$lines.tsx:33`.
Scenario: the value is the cart id plus its access key. Whoever holds it can read the cart and its `checkoutUrl`, and later any buyer identity (email, phone, address) attached to that cart. Because the cookie is readable by JavaScript, one XSS bug, or any third-party script added in Phase 7 (T-10), can exfiltrate it. The session cookie and `my_store` cookie are correctly flagged; the cart cookie is the outlier.
Fix: in `createHydrogenContext` pass `cart: {queryFragment, setId: cartSetIdDefault({httpOnly: true, sameSite: 'Lax', secure: <https>, maxAge: 60*60*24*14})}` (the client does not read this cookie; carts are read server-side). Add a test that the Set-Cookie carries the flags. Due: before the first staging deployment.

**P-M2. Offer and eligibility revalidation is still not wired to any route (T-01, T-02, T-06; carry-over of M-2).**
Evidence: `grep` for `evaluateOffers|revalidationOutcome` in `app/` finds only `lib/offers/**`. The cart action (`routes/cart.tsx:54-80`), the permalink route (`cart.$lines.tsx:23-37`) and the cart page's checkout link (`getCheckoutHref`) accept any well-formed variant id, so a gift, haul-away or coverage variant can be added or bought alone and sent to checkout. The input side of M-2 is fixed: quantities are integers 1 to 99 with whole-link rejection, variant ids are strict GIDs, extra keys (price, selling plan, parent, optimistic data) are dropped (probes below). The comment in `lib/cart/checkout.ts` says the offer steps will route through it (P4-09, P4-11).
Impact: the "our server prevents violations" claim in CLAUDE.md is not yet true for carts built through these routes; it stays detective for direct Storefront API carts by design (ADR-0006).
Fix: P4-09/P4-11 must call `evaluateOffers` and `revalidationOutcome` on the cart read back from Shopify in the action and before returning the checkout URL, and the permalink route must do the same or be removed. Add the hostile e2e cases (orphan coverage, over-limit haul-away, gift without qualifier). Until then keep these routes off any public URL. Due: gate G5 of phase 4.

### Low

**P-L1. A line update can erase hidden line properties (T-06, T-02).** `lib/cart/actions.ts:123-127` forwards `attributes: []` when the entry has an `attributes` key (probe: `{id, quantity: 1, attributes: []}` is accepted). Shopify replaces the whole property set on `cartLinesUpdate`, so a shopper can strip the server-set `_extend_plan_id`, `_extend_covered_product_id` or `_extend_term` from a coverage line and leave an unlinked coverage line. The key pattern correctly stops the browser writing underscore keys, but not deleting them. No coverage line exists in a cart yet, so no live impact. Fix: when P5A wires linking, do not take `attributes` from the browser on update (the UI does not need it), or merge server-side and keep every `_`-prefixed property; make `linking.ts` flag a coverage line with missing attributes (it already flags `plan_unverified`).

**P-L2. The request Host header is reflected into canonical URLs and JSON-LD (T-07, T-08 adjacent).** `routes/products.$handle.tsx:55-66`, `collections.$handle.tsx:44` and `stores.$state.$city.$slug.tsx:59` build absolute URLs from `new URL(request.url).origin`. Live: `curl -H 'Host: evil.example' /products/slides` returned `evil.example` in the page. On Oxygen the platform fixes Host; on an own server (Q-003) with a CDN that does not key on Host this is cache poisoning of canonical and structured data. Fix: take the site origin from a public env value (for example `PUBLIC_SITE_URL`) and fall back to the request only in development.

**P-L3. No explicit `Cache-Control` on per-user responses (T-05, ARCHITECTURE section 7).** Live headers for `/cart`, `/`, `/account` and the 303 from `/discount/:code` carry no `Cache-Control`. The store pages (`stores._index.tsx:31`, `stores.$state._index.tsx:35`, `stores.$state.$city._index.tsx:37`, `stores.$state.$city.$slug.tsx:44`) render "Your store" from the `my_store` cookie, and the redirects set a cart cookie. Today nothing caches them, but a CDN default or a later `Cache-Control` on documents would serve one shopper's store or Set-Cookie to another. Fix: add `Cache-Control: private, no-store` through each route's `headers` export (cart, stores, account, discount, cart permalink), and a header test.

**P-L4. Cart creation and discount replacement through GET routes (T-13, T-01).** `GET /discount/:code` and `GET /cart/:lines` create a Shopify cart on every request that has no cart cookie (live: a new `cart=` cookie per request) and need no origin check, so they can be used to burn Storefront API quota and can be embedded as an image or link. `/discount/:code` also replaces the cart's existing discount codes with the one in the link (`updateDiscountCodes([code])`), so a crafted link can remove a shopper's code; it cannot add an invalid price. Fix: rate limit these two routes at the host or edge, and have `/discount` keep existing codes as the cart action does (`validateDiscountCodes`).

**P-L5. Controls that depend on the host's proxy behaviour (T-08).** The action CSRF check compares `Origin` with `x-forwarded-host` or `host` (`chunk-S54KXAEJ.mjs:772-800`; `allowedActionOrigins` unset, so same host only). The `Secure` flag on the session and `my_store` cookies is derived from `request.url`'s protocol (`session.ts:32`, `stores._index.tsx:51`), which is `http:` when TLS ends at a proxy that does not rewrite the URL. Verify on the chosen host (Q-003) with the same live tests listed below; prefer `secure` from environment (production = true) over the request.

**P-L6. Response security headers are still minimal (carry-over, T-07, T-10).** The home response has only Hydrogen's CSP (nonce, `frame-ancestors 'none'`, `base-uri 'self'`, `style-src ... 'unsafe-inline'`) and `powered-by: Shopify, Hydrogen`. No `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`, and `content-type` has no charset. Fix at Phase 7 (P7-07) in `entry.server.tsx` or at the edge; CSP report-only first.

**P-L7. Free-text search terms reach cache keys and upstream logs (T-05).** `searchCache` is `CacheShort` keyed by query plus variables, so the typed term (up to 100 characters, `cleanText` strips tags) is in the cache key and in Shopify's request logs. A shopper can type an email address. Not preventable in code, so state it in the privacy notes and keep the term out of our own logs (it is: `logSearchFailure` logs only the error name).

**P-L8. Scaffold account routes return `error.message` to the browser (T-11, T-05).** `account.addresses.tsx:123,173,217,244` and `account.profile.tsx:74` are unchanged by these commits; review them at Phase 6 with the customer account work and replace with fixed messages.

## Verified

### Sanitiser (T-07): no bypass found

`lib/shopify/sanitize-html.ts` is an allow-list tokenizer and re-serialiser, so the output is built only from named tags and attributes. I ran 63 hostile inputs through the real module and read the tokenizer and the 17 existing tests. Results:
- Scheme tricks all dropped the attribute: `javascript:`, mixed case, leading spaces, NUL, NBSP, U+2028, BOM, U+180E, zero-width space, entity-hidden (`&#106;`, `&#x6A`, `&Tab;`, `&NewLine;`, `&colon;`, `&#58` without semicolon, zero-padded numeric), `data:`, `vbscript:`, protocol-relative `//evil.com`, backslash forms, tab between slashes.
- Attribute breakout: quotes in `href` and `title` are re-escaped by `escapeAttribute` after decoding (`title="a&quot; onmouseover=alert(1) x=&quot;"` stays inside the attribute); a duplicate `href` keeps only the first; `on*` and `style` attributes never pass the per-tag allow-list; numeric attributes must match `^\d{1,4}$`.
- Raw-text and foreign content: `script`, `style`, `iframe`, `object`, `embed`, `noscript`, `template`, `svg`, `math`, `textarea`, `select`, `title` and `head` drop their content; `<svg/onload>`, the math/mtext/style mutation vector and the noscript attribute vector produce an empty string; unterminated `<script src=...` produces an empty string; comments, CDATA, `<?` and doctype are dropped with their payload.
- Split tags (`<scr<script>ipt>`, `<<script>script>`) leave only escaped text. Entities in text stay inert (`&lt;script&gt;` renders as text). `h1` becomes `h2`. `img src` must be https, `a` gets `rel="noopener noreferrer"`, `target` is never emitted, `form`, `input`, `button`, `base`, `meta`, `link` are removed.
- Relative links `/%09/evil.com` pass, which is correct: a percent-encoded tab is not decoded in a path and resolves on our origin.
- Performance: 200,000 to 300,000 character pathological inputs (repeated quotes, unterminated tags, comments, ampersands, attributes, 60,000-deep nesting) finish in 0 to 36 ms; input is cut at 300,000 characters and nesting at 40, so no ReDoS or stack risk.
- The sanitiser is the only place that feeds `dangerouslySetInnerHTML` with Shopify content (`components/SafeHtml.tsx:32`; used by `pages.$handle`, `policies.$handle`, blog article). The product page no longer renders HTML (descriptions go through `richTextToParagraphs`, plain text escaped by React). The other `dangerouslySetInnerHTML` is the store JSON-LD, escaped (`serializeJsonLd`: `<`, `>`, `&`, U+2028/9). Product and collection JSON-LD goes through React Router's `script:ld+json` meta, which applies `escapeHtml` for `& > < U+2028 U+2029` (`chunk-QUQL4437.mjs:9933-9941, 8127-8136`).
- Reflection: live requests with `<script>` or `<img onerror>` in `?q=`, `?Size=` and `?handles=`/`?size=` produced no raw reflection (the search field value was `&quot;&gt;` after `cleanText` stripped the tag). Residual: `img src` may point to any https host, but the CSP (`default-src` with no `img-src`) blocks non-Shopify images in the browser; functionality, not security.

### Redirects (T-08): fixed since the prior review

- `safeRedirectPath` (`lib/cart/input.ts:72-90`) requires a single leading `/`, rejects backslash, whitespace and control characters, and checks the resolved origin. Probe over 21 targets: `//evil.com`, `/\evil.com`, tab, NUL, NBSP, `https://`, `javascript:` all fall back; `/.//evil.com`, `/%09/evil.com`, `/%5Cevil.com`, `/@evil.com` stay on the same origin when resolved by a browser.
- Live `GET /discount/SAVE10?redirect=...&utm=1` (with `MSYS_NO_PATHCONV=1`): `/\evil.com` gives `Location: /?utm=1`; `//evil.com` gives `/?utm=1`; `https://evil.com` gives `/?utm=1`; `/%5Cevil.com` gives `/%5Cevil.com?utm=1` (literal path); `/.//evil.com` gives `/evil.com?utm=1`; `/collections/all` and `/x?a=1` pass. A code with `<script>` gives a plain redirect to `/` with no cart.
- The cart action's `redirectTo` uses the same function with `/cart` as fallback (`routes/cart.tsx:90-94`). The stores action redirects only to paths built from its own store list (`stores._index.tsx:56-62`). `getCheckoutHref` accepts only an https `checkoutUrl` from Shopify's own response. No other `redirect(` takes request input in the new code.
- Tests exist for these (`cart-input.test.ts`, `e2e/cart.spec.ts:106-119`).

### Cart input (T-01)

- Probes of `validateAddLines`, `validateUpdateLines`, `validateLineIds`, `validateDiscountCodes`, `parseCartPermalink`, `parseDiscountCode`: quantity 0, 100, "2", 1.5, Infinity rejected; GID of a Product or with a query string rejected; underscore, space-leading and `__proto__` property keys rejected; 21 lines rejected; a `price`, `sellingPlanId` or `parent` key on a line is silently dropped; property values are `cleanText`ed (tags and control characters stripped); permalink `1:100`, `1:1e2`, `01:1`, `1:1:1`, `1,1`, `0:1`, `__proto__:1`, 23-digit ids all rejected as a whole; duplicate variants add up and cap at 99; discount codes limited to `[A-Za-z0-9_-]{1,64}`, at most 5. Note: `1:01` is accepted as quantity 1 (harmless). Repeating one variant 20 times at 99 passes validation (Shopify enforces inventory); revalidation belongs to P-M2.
- No price, discount amount or eligibility flag is read from the browser anywhere in the new code; the buy box sends `merchandiseId`, quantity and an optimistic display object that the validator drops (`ProductBuyBox.tsx:126-135`, `AddToCartButton.tsx`).
- Vitest: `sanitize-html.test.ts`, `cart-input.test.ts`, `cart-actions.test.ts`, 99 tests passed.

### CSRF and cookies (T-08)

- Live: `POST /cart` with `Origin: https://evil.example` returns 400 "Bad Request" before the action runs; same for `POST /stores`. A same-origin POST with invalid input returns the fixed rejection page (400), and an unknown action name returns the fixed "not supported" message. React Router 7.16 checks this for document and single-fetch actions (`chunk-S54KXAEJ.mjs:897, 1470`); `Origin: null` also fails the compare. The RSC-only CSRF advisory is not applicable (RSC mode unused).
- `my_store`: `Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure` (Secure when https). Live clear response matched. The value is a three-slug key validated against the store index on every read (`resolveMyStore`); a tampered cookie selects nothing.
- Session cookie: httpOnly, sameSite lax, Secure when the request is https (prior L-4 fixed; see P-L5 for the proxy caveat).

### Errors, logs, caching (T-05, T-13)

- Shoppers see fixed messages. Loader/route errors: `root.tsx:198-250` shows `detail` only under `import.meta.env.DEV`; thrown responses carry fixed text ("This cart link is not valid.", "may have expired"); `search.tsx` logs only the error name (prior L-9 fixed); cart user errors pass through `readCartMessages` (`cleanText`, 240 characters, 5 messages) and render as escaped text.
- Console logging in the new code: search failure (error name), product availability failure (`error.message` from the Storefront client: handle-level data only), `Price` (message only), quiz (warning codes only), stores (a count). No names, emails, addresses, ZIPs or cart contents are logged. Quiz analytics events are a closed set of counts, sizes and handles and have no sink until Phase 7 (`lib/pages/track.ts`); localStorage holds quiz results and compare handles only.
- Caching: `cache.ts` limits `CacheLong`/`CacheShort` to catalog, availability, search, content; cart reads and the account are not cached; keys contain handles, filters and cursors (P-L7 for search terms). Hydrogen's storefront client does not add customer or cart data to those queries.

### Secrets and bundle (T-04)

- Commit range diff scanned for token patterns and `secret|token|key = "<16+ chars>"` assignments: 0 hits; the only e-mail-like string is `help@example.com`; fixtures contain only mock.shop URLs. `git ls-files` shows `.env.example` as the only env file. Prior history scan stands.
- `dist/client` (80 files, built before this review, not rebuilt): 0 hits for `EXTEND_`, `SHOPIFY_ADMIN`, `SHOPIFY_APP`, `SESSION_SECRET`, `PRIVATE_STOREFRONT`, `CLIENT_SECRET`, `JUDGEME`, `X-Extend-Access`, `api.helloextend`, `X-Shopify-Access`, `GuestOrderLookup`, `verifyShopifyWebhook`, `SHOPIFY_ALLOWED_STORES`, `WEBHOOK_SECRET`. The only env names present are `PUBLIC_CHECKOUT_DOMAIN` and `PUBLIC_STOREFRONT_API_TOKEN`. No route or component imports `lib/extend` or `lib/orders`. `mock.shop` appears in the client bundle; confirm a production build uses the real store domain.

## Threat model verification (this review)

| ID | Status |
|---|---|
| T-01 | Input tampering verified (validators, probes, live 400s); price never read from the browser. Server revalidation still absent: P-M2 |
| T-02 | Partial: library proven earlier; no route calls it yet (P-M2); detective control pending (prior M-4) |
| T-04 | Verified for tree, range diff and client bundle; cart cookie flags P-M1 |
| T-05 | Verified for the new routes (logs, analytics, error text); P-L3 caching headers, P-L7 search term, P-L8 account scaffold |
| T-06 | Partial: P-L1 (hidden property erase) |
| T-07 | Verified: sanitiser (63 probes, no bypass), JSON-LD escaping, reflection tests; P-L2 host reflection, P-L6 headers |
| T-08 | Verified for redirects (fixed) and CSRF origin check in dev; host and proxy behaviour unverified (P-L5); cart cookie flags P-M1 |
| T-13 | Partial: P-L4 (cart creation by GET), search proxy validated and capped; no rate limits exist yet |
| T-09, T-10, T-11, T-12, T-16 | Not changed by these commits; T-12 still open (H-1) |

## Could not verify

Behaviour on the real host (Oxygen or own server, Q-003): Host/forwarded-host handling, TLS termination, edge caching, rate limits, client-IP header. Runtime headers beyond the dev server (the production build was not served). Real Shopify cart behaviour for `cartLinesUpdate` attribute replacement (documented behaviour, not tested against a development store; mock.shop only). Whether the browser actually refuses non-Shopify `img` sources under the production CSP (read from the generated header, not browser-tested). The full e2e suite and browser rendering of sanitised output were not run by me. `storefront/app/lib/offers-runtime/` is untracked in the working tree and was not part of these commits, so it was not reviewed.
