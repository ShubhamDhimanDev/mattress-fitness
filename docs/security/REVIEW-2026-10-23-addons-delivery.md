# Security review: product-page add-ons and the delivery "service-unavailable" state

Date: 2026-10-23. Reviewer: security-engineer (read-only; this note is the only file written).
Scope: commits `297f894` (P4-03, REQ-ADD-001: `GET /api/product-addons`, `CustomAddAddOn` with `mattressVariantId`, picker add without the repeat full gate) and `47c5918` (P3B-11, P5B-03: `/delivery` early 503 and `service-unavailable` view, cart offers refresh after a ZIP change, predictive search removal). Threats: T-01, T-02, T-05, T-06, T-08, T-13 (T-04, T-07 touched).
Out of scope: the uncommitted working-tree edits (header/nav/fragments/root/package changes, `deploy/`, `scripts/node-server/` other than what the rate-limit and cache questions needed), dependency audit (no dependency change in the two commits), the other `docs/security` reviews (not edited, historical).

## Verdict

**Pass with conditions. No High, no Medium.** Three Low findings and several informational notes. This is a review of two commits, not a phase gate pass; "verified" below means in code, unit tests and a local production build, not on a development store or behind the real host (Q-003).

| ID | Grade | Threat | Title |
|---|---|---|---|
| A-L1 | Low | T-13 | `POST /cart` (every cart action, now including the product-page add) has no nginx rate-limit zone beyond the general one |
| A-L2 | Low | T-13 | `GET /api/product-addons` turns a failed Shopify read into a cacheable "show nothing" answer |
| A-L3 | Low | T-02 (K-L5 family) | Product-page add has no compare-then-act guard when there is no cart yet; the guard with a cart is best effort (V-27) |
| A-I1..A-I5 | Info | various | Notes below |

## What I checked and how

1. Read the diff of both commits (`git show`), the new and changed source in full: `app/routes/api.product-addons.tsx`, `lib/offers-runtime/product-addons.ts`, `product-addons-server.ts`, `picker-steps.ts` (`addAddOn`, `addForCartMattress`, `addWithMattress`, `mattressFacts`), `facts.ts`, `lib/cart/actions.ts` (`validateAddAddOn`), `routes/cart.tsx` (action), `routes/checkout-steps.tsx`, `lib/cart/checkout.ts` (`decideCheckout`), `routes/delivery.tsx`, `delivery-runtime/{view,zip-cookie,summary,response}.ts`, `lib/cookie-secret.ts`, `lib/delivery/status.ts`, `lib/offers/{addons,evaluate,haul-away,lines}.ts`, `lib/offers-runtime/{runtime,messages,config}.ts`, `useCartOffers.ts`, `cart-results.ts`.
2. Ran the four directly relevant Vitest files: `product-addon-steps`, `product-addons-routes`, `delivery-routes`, `product-addons` (4 files, 134 tests, all pass; the hostile table covers wrong size, unrelated variant, gift/coverage as add-on, gift/protector/haul-away as mattress, sold-out add-on and mattress, no config, stale cart, cart changed, cross-site POST, malformed id).
3. Built the committed tree into a scratch directory (`scratchpad/sbuild`, a copy with a junction to `node_modules`; the repository `dist/` was not touched) and inspected the production bundles for the dev cookie, private env names and the new route.
4. Read `deploy/nginx.conf.example`, `docs/deployment/VPS_RUNBOOK.md` rate-limit table and `scripts/node-server/cache.mjs` for the reverse-proxy, rate-limit and cache questions.
5. Grepped the two commits' added lines for secret shapes (`shpat_`, `shpss_`, `sk_live`, `ghp_`, JWT, key=value literals) and for log calls: nothing found. No `.env` file was read.
6. Grepped every consumer of the delivery status and of `readDeliveryZip`.

## (1) `GET /api/product-addons`

Verified in code:

- **Input validation.** `productId` must match `^gid://shopify/Product/[1-9]\d{0,19}$` (`product-addons.ts:15`, used at `api.product-addons.tsx:24`); anything else (missing, repeated, wrong shape, long) gets `400 {"status":"invalid"}`. Bounded linear regex, no ReDoS. `URLSearchParams.get` takes the first value only. Cross-site fetch (`Sec-Fetch-Site: cross-site`) gets `403` (`:22`). Both error bodies are fixed strings, `Cache-Control: private, no-store`.
- **Cost bound / enumeration.** The rules lookup is in memory (`addOnRelationsFor`, `product-addons-server.ts:40`). A well-formed id the admin has not configured costs no Shopify call and answers `{"status":"ok","items":[]}`. Only products named in `OFFER_CONFIG_JSON` can reach Shopify, with one `nodes()` read through `pricedCache` (60 s + SWR). Hydrogen's cache key is query plus variables (variant ids from the rules), not the URL, so varying the query string or the product id does not multiply Shopify reads; the Node cache stand-in is bounded (500 entries, `scripts/node-server/cache.mjs`). Scraping is bounded by the number of configured mattress products.
- **Cache-Control.** `private, max-age=60` (`api.product-addons.tsx:32`): never shared, so the nginx plan (no `proxy_cache`, `deploy/nginx.conf.example:183`) and any future CDN will not store it. The body is identical for every shopper and depends on no cookie, so no `Vary` is needed.
- **Information leakage.** The body holds, per item, only category (`foundation`), size, variant id, product title, handle, variant title and Shopify's price (`facts.ts` builds the object field by field; `quantityAvailable` is not queried, `OFFER_VARIANTS_QUERY` selects `availableForSale` only). A sold-out, unpublished or unknown variant is absent and indistinguishable, so no stock level leaks. The admin relations disclosed are exactly what the product page shows. Protectors, pillows and bedding relations are not returned (`PRODUCT_PAGE_CATEGORIES`).
- **Rate limit on the VPS plan.** `map $uri $mf_key_api { "~*^/api/" ... }` with `mf_api` at 5 r/s, burst 20, per client IP (`deploy/nginx.conf.example:23,33,189`) covers this route; it is also under `mf_general` and `limit_conn`. The runbook table wording ("a new route that calls Shopify needs a zone") is satisfied for this route. Starting values are guesses; no load test (runbook says so).
- **No PII.** Only a catalog GID in the query; the nginx `mf_privacy` log format drops query strings; the route logs nothing; the Shopify cache key holds variant ids and the fixed US context.

Findings:

### A-L2 (Low, T-13): a failed Shopify read is answered as a cacheable success

Evidence: `facts.ts` `loadOfferedVariants` catches every error and returns an empty map (`logFailure`); `loadProductAddOns` then returns `{status:'ok', items:[]}`; the route sends it with `private, max-age=60` (`api.product-addons.tsx:32`). A transient Storefront error therefore makes the shopper's browser remember "no add-ons" for 60 s (a reload within the minute shows nothing, the hook has no error state to retry from). Impact: lost upsell for a minute per shopper; no security or money effect. Fix: have the loader return a no-store response (for example `503 {"status":"unavailable"}`, which `useProductAddOns` already turns into its retryable error state) when the read failed, which needs `loadOfferedVariants` to report failure to this caller (a `{variants, failed}` result or a thrown error caught in the route). Optional.

## (2) `CustomAddAddOn` with `mattressVariantId` (T-01, T-02, T-06, T-08)

Verified in code (`picker-steps.ts:195-326`, `actions.ts` `validateAddAddOn`, `cart.tsx:190`):

- **Trust.** The browser sends two variant ids. Quantity is fixed at one per line (`oneOf`), no price, discount, parent id, attribute or line id is read. `validateAddAddOn` refuses a present but malformed `mattressVariantId` (no silent downgrade to the cart-picker meaning) and `mattressVariantId === variantId`; unknown fields are dropped (test "keeps the two ids and drops a quantity, a price and anything else").
- **Mattress is read from Shopify.** The product id and size of the viewed mattress come from the cart line (itself read from Shopify) or from a fresh `loadSwapTarget` read that also requires `availableForSale` (`facts.ts:145-167`). The request cannot assert a product or size. The pair must satisfy the admin relation with the same size comparison as the cart engine (`relationFitsSize`, `addons.ts:28`). The add-on must be in stock by a fresh (`noCache`) read. A sold-out mattress that is not in the cart is refused, so no orphan add-on is added.
- **Gift / protector / haul-away as the "mattress".** Refused up front (`picker-steps.ts:289-291`), and in any case a mattress id must resolve to a product that has foundation relations in the rules. As the add-on `variantId` they are refused unless the admin listed them as add-ons; if an admin did list one variant in two roles, `classifyLine` gives the service, then gift, then protector role precedence (`lines.ts:62-77`), so the gate still treats it as a gift or service line. Coverage variants are never keyed by a mattress product and are refused (tested).
- **Stale cart cookie.** `current === null` after a stale cookie: `addLines` answers no cart and no error, then `create({lines})` starts a fresh cart with the same two validated lines and the response sets the new cart id (`picker-steps.ts:319-322`, `cart.tsx:end of action`, `setCartId`). A real failure does not create a second cart (tested). The cart-picker path with no cart answers `cart-gone` and adds nothing.
- **CSRF.** The action is behind `isSameOriginRequest` (`cart.tsx` top of action): foreign `Origin` and `Sec-Fetch-Site: cross-site` refused (test "refuses a cross-site post"); a cross-site top-level form post always carries `Origin`, and the cart cookie is `SameSite`, so a forged post carries no identity. A request with neither header passes by design (T-08, P-L5 unchanged).
- **Size/quantity.** The add path cannot exceed one per line per post; repeated posts are possible (an add-on is an ordinary line the shopper may increase with the stepper; the engine never limits add-ons, `evaluate.ts:87` only produces offers).

Finding:

### A-L3 (Low, T-02 / K-L5 family): compare-then-act is skipped without a cart and is best effort with one

Evidence: `picker-steps.ts:315` runs `cartUnchanged` only `if (current && ...)`; with no cart two parallel product-page posts each create a cart and the last `Set-Cookie` wins, the other cart is abandoned (Shopify carts expire; no money effect). With a cart, the `updatedAt` comparison is the same narrowed guard as K-L5 whose resolution is unverified (V-27). Worst case is a duplicated add-on line (an ordinary, priced, shopper-adjustable line) or an orphan cart; no price, eligibility or limit can be changed this way. Fix: none required; keep V-27 open and note it on the add-on path. Accept as Low.

## (3) Removal of the repeat full gate before the add (T-01, T-02)

Conclusion: **no invalid combination of a rule-enforced kind can reach checkout through this change.**

- The pre-add gate's job for add-ons was one question, "is this variant offered for a mattress line of this cart". `addForCartMattress` now answers it directly with `matchingAddOnOffers(prepareCart(toCartLike(current), rules), rules.matchingAddOns)` (the same function the gate's view used, `evaluate.ts:87`) plus an in-stock read and the `cartUnchanged` check. It fails closed on `config.unverified` (production without rules) and on an empty cart.
- Add-on relations are **advisory in the engine**: `matchingAddOnOffers` yields offers, never a violation or correction. The rules the gate enforces (haul-away eligibility and limit, gifts, comfort protector, Extend coverage) are untouched by an add-on line. A wrong-size or orphan foundation can already be added through the generic `CartForm.LinesAdd` (`validateAddLines`), so the picker's checks are a UX and abuse control, not the security boundary; removing the repeat gate does not loosen anything enforceable. The price of every line is Shopify's.
- The post-add gate runs on every request in `cart.tsx` (revalidate, repair, return the full cart). If it throws, the change is kept and the error logged; the hand-off then runs the same gate again. `checkout-steps.tsx` `loader` revalidates every visit, and `decideCheckout` returns `unavailable` for a null view and `blocked` for any block reason, so an unverified or blocked cart never gets a checkout href through our routes (`checkout.ts:57-60`). A cart the old gate would have called `unverified` (for example the coverage catalog unreadable) now accepts an ordinary add-on, which "cannot make it worse"; checkout stays withheld by the post-add and hand-off gates. Carts built directly through Shopify's API remain detective only (ADR-0006, unchanged).
- Tests: `product-addon-steps.test.ts` "still refuses a variant the rules do not offer", "refuses an empty cart", "reads only the one variant it adds" pass.

## (4) `/delivery` early 503 when `DELIVERY_COOKIE_SECRET` is unusable (T-05, T-02)

Verified in code (`delivery.tsx:81`, `view.ts`, `zip-cookie.ts`, `cookie-secret.ts`) and by the new tests:

- **No cookie, no ZIP echo.** The 503 uses `failure(env, null, ...)`: the view is `service-unavailable` regardless of the ZIP, no `Set-Cookie` is built, and the body is read after the check, so a posted ZIP is never parsed or returned. The test asserts `cookieOf(result) === ''` and that the payload does not contain the posted ZIP. In production `deliveryViewForEnv` returns `service-unavailable` for GET too, whatever the stored cookie holds (`readDeliveryZip` already returns null without a secret).
- **No secret in logs.** `reportUnusableSecret` writes the variable name and the constant 32 once per isolate (`config.secret_unusable`); never a value or its length; the test asserts the logged JSON has the name, not the ZIP, not the secret filler. The field is `variable`, not `name`, so the redaction layer does not erase it.
- **No fail-open of haul-away.** Haul-away eligibility does not use `DeliveryView`. It uses `runtime.zip`, read by `offerRuntimeOf` through `readDeliveryZip`, which is null with an unusable secret, and `haulAwayEligibility` turns a null ZIP into `zip-missing` (`haul-away.ts:56-62`), which is a violation that blocks checkout until the service is removed. Grep of every consumer of `deliveryViewFor`, `service-unavailable`, `'in-zone'` and `DeliveryView`: only `DeliveryCheck.tsx` (renders text), `SiteHeader.tsx:74,83` (shows a promise only for `in-zone`/`outside-zone`; hides the control for `service-unavailable`), `response.ts` (parses the seed) and `status.ts`. Nothing treats `service-unavailable` (or `unavailable`) as eligible. The client refresh after a ZIP change (`useCartOffers`, `zip-change.ts`) only drops stale display views; the eligibility decision stays on the server.
- Development keeps the old behaviour on purpose (`deliveryZipSavingAvailable` returns true when not production, then the cookie step answers the 503 at `delivery.tsx` "No secret to sign with").

No finding. Notes: A-I1 below.

## (5) `e2e_addons_expected` (dev-only cookie)

Gated by `import.meta.env.DEV && hasDevAddOnsCookie(...)` at `products.$handle.tsx:136`. In a production build Vite replaces `import.meta.env.DEV` with `false`, so the branch (and the cookie read) is removed.

Evidence: I built the committed tree to a scratch directory (production mode, `shopify hydrogen build`). `grep -c "e2e_"` on `dist/server/index.js` returns 0 and no file under `dist/client` contains `e2e_`; the compiled loader reads `addOnsExpected:wL(e.env,c.id)`, that is, only the rules lookup, and the page loader's `isDev:!1` is a literal. The new route string `api/product-addons` is in the client bundle (expected; it is public). No `OFFER_CONFIG_JSON`, `DELIVERY_COOKIE_SECRET` or `SESSION_SECRET` name appears in `dist/client`. So no request can opt a page into the slot in production, and even in development the cookie only makes the page ask for the list; adding is still rule-checked.

## (6) PII in logs and cache keys (T-05)

- No new `console`/`log*` call in either commit's added lines other than the configuration report above. `facts.ts` failure logging is unchanged (`what` plus `errorFields`).
- Cache keys: Shopify query cache keys contain variant ids from the rules and the fixed country/language context; no cookie, ZIP or cart data. `pricedCache` is `public` mode inside the server's own query cache only; the HTTP response to the browser is `private`.
- The ZIP stays in a signed HttpOnly cookie and POST body; it is not in any URL, log, cache key or bundle introduced here. The 503 and `service-unavailable` bodies carry no ZIP.
- nginx access log format omits query strings and cookies (`mf_privacy`).

## Findings in detail

### A-L1 (Low, T-13): `POST /cart` has only the general rate limit

Evidence: `deploy/nginx.conf.example:25-26` limits the `/cart/<lines>` and `/discount/<code>` permalinks (`mf_cartget`) and `/api/` (`mf_api`), but the cart action itself, `POST /cart`, falls under `mf_general` only (20 r/s, burst 60, `:31,187`). One product-page add costs several Storefront calls (cart read, swap target, variant read, cart re-read, add, then the gate's reads) and, with no cart cookie, creates a Shopify cart. Pre-existing for `LinesAdd`; the new action adds one more shape of it. Impact: a single IP can spend Storefront quota and create carts at up to the general rate; no money or data effect. Fix: add a zone for the cart action, for example `map "$request_method$uri" $mf_key_cartpost { default ""; "~*^POST/cart(\.data)?/?$" $binary_remote_addr; }` with `rate=3r/s`, `burst=10`, and list it in the runbook table; re-check `/checkout-steps` and `/delivery` POST the same way (`/delivery` is covered). The nginx file is an example not yet deployed.

## Informational notes

- **A-I1.** With an unusable secret in production every haul-away line is a `zip-missing` violation (fail closed, correct), but the message says "We need a delivery ZIP code inside our delivery area", while the ZIP control is hidden and replaced by "Delivery check unavailable". The shopper's way out is "Remove the service" (also in the text). Consider a message variant for `service-unavailable`. Availability and copy only. Also, a previously saved valid `delivery_zip` cookie is ignored (not cleared) while the secret is unusable.
- **A-I2.** The endpoint publicly exposes the foundation relations of any configured mattress, including handles of offer-only products (K-L3). Same data as the product page and reachable by URL; no stock counts. No action.
- **A-I3.** `isSameSiteFetch` lets requests without `Sec-Fetch-Site` through (curl). Intended; the rate limit above is the control. The data is public.
- **A-I4.** `readOfferConfig` has no validation that one variant id appears in two rule roles (add-on and gift, for example). Safe today because `classifyLine` gives precedence to the service and gift roles, but an admin-config linter (P4-12) would remove the doubt.
- **A-I5.** `addWithMattress` accepts any add-on category the rules relate to the mattress, not only `foundation`, when the request is crafted; the product-page list only offers foundations. Allowed by the same rules the cart picker uses; no impact.

## Threat model verification (proposed updates; the model file was not edited)

| ID | Proposed status | Evidence added |
|---|---|---|
| T-01 | Verified in code for the new add path | ids only from the browser, quantity fixed, mattress facts read from Shopify, 134 tests |
| T-02 | Partial, unchanged | pre-add gate removal does not weaken rule enforcement; A-L3 (V-27); K-M1, E-M3 unchanged |
| T-05 | Verified in code for the range | A-I-notes; no PII, ZIP or secret in logs, cache keys, bodies or the production bundle |
| T-06 | Unchanged | coverage variants refused as add-on and as mattress |
| T-08 | Verified in code for the new action | cross-site refusal tested; headerless behaviour unchanged (P-L5) |
| T-13 | Partial | `/api/product-addons` covered by `mf_api` and bounded by the rules; A-L1, A-L2 |

Dependency and secret scans: no dependency change in the two commits (`npm audit` not re-run; H-1 / ADR-0008 unchanged, owner decision still open). Secret-shape scan of the added lines: clean. Production-bundle name scan: clean.

## What I could not verify

- Behaviour on a development store (real cart `updatedAt` resolution, the real `checkoutUrl`, add-on pricing next to automatic discounts): V-03, V-27, B-13.
- nginx behaviour (config not deployed; `nginx -t` not run); the rate-limit numbers are unmeasured; the response headers behind the real proxy (Q-003, B-19).
- The effect of the uncommitted working-tree edits and the new `deploy/` and `scripts/node-server/` files beyond what is cited.
- That the `headers` export of `delivery.tsx` applies `no-store` to a fetcher POST error response on the real host; the response itself sets `Cache-Control: private, no-store` and tests assert it on the loader.
- Dependency audit (not re-run for this range).

Scratch build output sits only under the session scratchpad; no file outside this note was changed.
