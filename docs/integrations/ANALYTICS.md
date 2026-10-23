# Analytics, Meta tracking and consent (P7-01)

Requirements: REQ-ANL-001 (GA4), REQ-ANL-002 (Meta), REQ-QZ-006 (quiz events), NFR-011 (consent), NFR-013 (a failing provider never breaks the page). Threats: T-05 (PII), T-10 (third-party scripts), T-16 (consent, legal). Status 2026-10-23: **built and unit-tested; nothing verified against GA4 DebugView, Meta's Test Events tool, a real browser, a production build or a real host.** CLR-004 (client access to Google Analytics and Meta) is still needed to verify.

## What is built

| Part              | Where                                                                                   | Notes                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration     | `storefront/app/lib/analytics/config.ts`                                                | `PUBLIC_GA4_MEASUREMENT_ID`, `PUBLIC_META_PIXEL_ID`, `PUBLIC_CONSENT_MODE`; read in the root loader, public by design                                |
| Consent decision  | `consent.ts`, `consent-store.ts`, `browser.ts`                                          | two categories: `analytics` (GA4) and `marketing` (Meta); first-party cookie `mf_consent` plus `localStorage` fallback, every access guarded         |
| Dispatcher        | `runtime.ts`                                                                            | the consent gate, idle loading, replay, withdrawal and failure isolation; fully injected, so tested without a browser                                |
| Provider adapters | `ga4.ts`, `meta.ts`, `script-loader.ts`                                                 | thin; the pure mapping (`toGa4Call`, `toMetaCall`) is separate; `window`, scripts and cookies are injected                                           |
| Event mapping     | `hydrogen-events.ts`, `privacy.ts`, `money.ts`                                          | Hydrogen payloads and click contexts to provider-neutral events; PII filters; cents to dollars through `~/lib/format`                                |
| UI                | `app/components/consent/`                                                               | `ConsentAnalytics` (replaces `<Analytics.Provider>` in `root.tsx`), `ConsentBanner`, `ConsentPreferences`, `PrivacyChoicesButton`, `AnalyticsBridge` |
| CSP               | `app/lib/analytics/hosts.ts`, `app/lib/security-headers.ts`, `app/entry.server.tsx`     | hosts added only for a configured provider, to the report-only policy and to Hydrogen's enforced policy                                              |
| Tests             | `tests/unit/analytics/**` (168 new), `tests/e2e/consent.spec.ts` (written, **not run**) |                                                                                                                                                      |

Everything above sits behind `track()` (`app/lib/analytics.ts`), the single entry point from Phase 2. The quiz already calls it (REQ-QZ-006); the runtime is registered as its sink.

## Configuration

| Variable                    | Effect                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_GA4_MEASUREMENT_ID` | `G-` plus 4 to 16 letters or digits. Unset or malformed: GA4 is off, no script, no CSP host, no analytics checkbox |
| `PUBLIC_META_PIXEL_ID`      | digits only (6 to 20). Unset or malformed: Meta is off, same                                                       |
| `PUBLIC_CONSENT_MODE`       | `opt-in` (default) or `opt-out`. **Any other value, including a typo, means `opt-in`**                             |

Both ids unset: no consent state, no runtime, no banner, no script, no CSP change, and `<Analytics.Provider>` is called exactly as before (no `canTrack`). Names only are in the root `.env.example`.

**The legal choice is not made here.** `opt-in` is the stricter default. Whether the client may use `opt-out` for US visitors (and whether Global Privacy Control must be honoured) is a legal decision for the client (Q-012, T-16); changing it is one environment variable.

### Behaviour by mode

|                   | opt-in                                                          | opt-out                                                                              |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Before a decision | nothing loaded, nothing sent                                    | analytics allowed; marketing allowed unless the browser sends Global Privacy Control |
| Banner            | shown until the shopper decides                                 | shown until the shopper decides (wording says cookies can be turned off)             |
| After a decision  | the stored choice                                               | the stored choice                                                                    |
| Decision lifetime | 180 days, then asked again; a changed policy version asks again | same                                                                                 |

## Consent mechanics

- The banner is fixed to the bottom edge, renders only after hydration (server and first client render agree: "decided"), so it adds no layout shift. It is a labelled region, not a modal: focus is not taken, the page stays usable, and it comes before the header in the DOM so keyboard users meet it early. Accept all and Reject all are the same size and one press each; "Choose" opens a dialog (existing `Dialog`, focus return and Escape included) with one checkbox per configured category.
- **Withdrawal:** `PrivacyChoicesButton` reopens the preferences. **It is not yet placed in the footer** (see follow-ups); until it is, a shopper can only withdraw by clearing site data. This is a gap against NFR-011 and must be closed before launch.
- On withdrawal the runtime asks the adapter to stop (GA4's `ga-disable-<id>` flag, Meta's `consent revoke`), drops queued events and expires `_ga`, `_ga_<id>`, `_fbp` and `_fbc` on this host. A cookie set by a provider on a parent domain cannot be removed from here (no public-suffix list), so it may survive until the provider stops refreshing it.
- Cross-tab: a `storage` event re-reads the decision. Cookies and storage can be blocked: the choice then holds for the visit and the shopper is asked again next time.

## Loading rules (NFR-011, NFR-013)

1. No script is requested for a category that is not allowed. Verified by unit test (`runtime.test.ts`); **not yet by a browser** (the e2e spec asserts zero provider requests before a decision).
2. After consent the load is scheduled with `whenIdle` (`requestIdleCallback`, Safari fallback timer), `async`, never blocking render. A script is added only from `https://www.googletagmanager.com` or `https://connect.facebook.net`; any other origin is refused before a script element exists.
3. The page the shopper is on is held in memory (only the latest `page_view`, never sent) and reported once they agree. Events that arrive while a consented script loads are queued (25 at most) and replayed in order.
4. Load failure (ad blocker, CSP refusal, outage, 10 s timeout) marks the provider failed for the visit, logs one `analytics.provider_failed` line with provider and reason only, and carries on. No retry loop. A thrown error in an adapter, in `send` or in the failure callback is swallowed.
5. No Subresource Integrity: both vendors serve these files at fixed, unversioned URLs that change without notice, so a pinned hash would break the integration. Mitigation: the origin allow-list, the nonce and the report-only policy.

## Event mapping

Hydrogen publishes `product_viewed`, `collection_viewed`, `search_viewed`, `cart_viewed`, `product_added_to_cart` and `product_removed_from_cart`. `AnalyticsBridge` subscribes and maps them; `page_view` and `begin_checkout` are sent by the bridge itself. Hydrogen publishes only while `canTrack` allows it; with a provider configured `canTrack` is "any category allowed, or Shopify's own consent answer", and Hydrogen republishes the current page when that changes, so a shopper who agrees later is counted once.

| Our event (GA4 name)                               | Source                                                                                               | GA4                                                                                                                               | Meta                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `page_view`                                        | per navigation (path or query change), from `useLocation`                                            | `page_view`, `page_location`                                                                                                      | `PageView`                          |
| `view_item`                                        | product page                                                                                         | `view_item` with `currency`, `value`, `items`                                                                                     | `ViewContent`                       |
| `view_item_list`                                   | collection page                                                                                      | `view_item_list`, `item_list_id` and `item_list_name` = collection handle, **empty `items`** (Hydrogen's payload has no products) | not sent                            |
| `select_item`                                      | click inside an element given `selectItemAttributes(...)`                                            | `select_item` (beacon)                                                                                                            | not sent                            |
| `add_to_cart` / `remove_from_cart`                 | cart line quantity change                                                                            | the units changed, not the line total                                                                                             | `AddToCart`; remove not sent        |
| `view_cart`                                        | cart opened                                                                                          | `view_cart`                                                                                                                       | not sent                            |
| `begin_checkout`                                   | click on the link to `/checkout-steps` (the hand-off to the pre-checkout steps and Shopify checkout) | `begin_checkout` (beacon), `value` = sum of Shopify line totals                                                                   | `InitiateCheckout` with `num_items` |
| `search`                                           | search results page                                                                                  | `search`, `search_term`                                                                                                           | `Search`, `search_string`           |
| `quiz_start`, `quiz_complete`, `quiz_result_click` | `track()` from the quiz (P6-10) with the documented parameters                                       | forwarded as sent                                                                                                                 | not sent                            |

Money: Shopify decimal strings to integer cents once (`toCents`), kept in cents through the pipeline, converted to dollars at the edge from the exact two-decimal string (`fromCents`), so there is no float arithmetic (1999.99 stays 1999.99). USD only: any other currency drops the line. A line with an unusable price, id or title is dropped, never guessed. Quantities are capped at 99, items at 50.

### Privacy (T-05, REQ-ANL-002)

- Cart payloads from Hydrogen also hold the buyer's email, name and phone; the mapper reads named fields only and never spreads, and a test asserts none of them reach the output.
- Parameter names are an allow-pattern; names suggesting personal data (email, phone, zip, address, name, customer, order id or number, card, token, secret) and values that look like an email or hold seven or more digits are dropped; strings are cut at 100 characters; at most 25 parameters.
- The reported page address keeps origin, path and only `utm_*`, `gclid`, `fbclid`. Search words, filters, ZIP and other query strings stay out; `/account`, `/discount` and `/checkout-steps` paths are cut to their section.
- Search terms are sent (REQ-ANL-001 lists the `search` event) after the same email and digit check. A shopper can still type something personal that does not look like an email or a long number; this is a residual risk.
- Meta: `autoConfig` is turned off so the pixel does not scrape form fields or buttons; **hashed advanced matching is not implemented**; no email, phone, ZIP, name or order number is passed. Google signals and ad personalisation are off for GA4; GA4 sends no automatic page view.

## Content Security Policy (T-10)

Added **only** when the matching id is set, to the report-only policy (`buildReportOnlyCsp`) and to Hydrogen's enforced policy (`enforcedCspExtras`, passed to `createContentSecurityPolicy`). Which of the two is enforced is unchanged: Hydrogen's stays enforced, the tightened one stays report-only.

| Provider | script-src                         | img-src                                                              | connect-src                                                                                  | Source                                                                                                                                                                                      |
| -------- | ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GA4      | `https://www.googletagmanager.com` | `https://www.googletagmanager.com`, `https://*.google-analytics.com` | `https://www.googletagmanager.com`, `https://*.google-analytics.com`, `https://*.google.com` | Google's CSP guide, "Analytics without Ads features", read 2026-10-23 (developers.google.com/tag-platform/security/guides/csp)                                                              |
| Meta     | `https://connect.facebook.net`     | `https://www.facebook.com`                                           | `https://www.facebook.com`, `https://connect.facebook.net`                                   | **UNVERIFIED.** Meta's documentation says nothing about CSP (checked 2026-10-23); the hosts come from community and vendor guides. Review the console in report-only mode with a real pixel |

- Naming `script-src` or `img-src` in Hydrogen's policy replaces the `default-src` fallback (self, nonce, cdn.shopify.com, shopify.com), so those Shopify sources are repeated and only the provider hosts are added; the nonce is appended by Hydrogen. With no provider set, nothing is passed and the policy is byte-for-byte what it was (tested).
- The `*.google-analytics.com` and `*.google.com` wildcards break the rule "never a wildcard host" in `docs/security/SECURITY_HEADERS.md`. Google serves GA4 from regional hosts (for example `region1.google-analytics.com`), so an exact list would silently lose data. **Open decision for the security-engineer**: accept the wildcards for these two registrable domains, or list the regional hosts after observing them. The wildcards cover subdomains of those two domains only, and a test fails if any other wildcard appears.
- No `'unsafe-inline'`, no `'unsafe-eval'` for scripts. The scripts are added with the page nonce.
- `docs/security/SECURITY_HEADERS.md` ("Third-party allow-list policy") still says no third-party origin is allowed and should be updated by its owner with this table (not edited here).

## Verified and not verified

Verified (unit tests, 168 new; `app/lib/security-headers.test.ts` 39 and `app/lib/analytics.test.ts` 4 still pass; 211 in the 8 files run together):

- Config parsing, including the strict default and hostile ids; consent serialisation, expiry, tampering and storage failure; the store's snapshot stability.
- The runtime: nothing before consent in opt-in, idle scheduling, replay of the current page, category separation, opt-out mode, withdrawal before, during and after a load, re-grant without a second load, bounded queue, failed, timed-out, blocked and throwing providers.
- GA4 and Meta call mapping, dollars, items, beacon transport, privacy settings, the bootstrap call order, revoke and grant.
- The script loader: loaded, error (blocked), timeout, single settlement, refusal of other origins (http, look-alike hosts, user-info trick, data URLs) and a broken document.
- The Hydrogen mappers, including tampered quantities and prices, a hostile handle, and that buyer fields never leak.
- The consent UI in jsdom: labelled region, equal buttons, preferences dialog, Escape, withdrawal from the button.
- CSP: no host without an id; hosts only in script, image and connect sources; nonce kept; only the two documented wildcards.
- Typecheck, ESLint and Prettier clean on every touched file.

**UNVERIFIED** (nothing below has been observed):

- GA4: events in DebugView or Realtime, parameter acceptance, `transport_type: 'beacon'` surviving the navigation to checkout, and that GA4 honours `send_page_view: false` plus our manual `page_view` as intended. No GA4 property or DebugView access exists (CLR-004).
- Meta: events in the Test Events tool, that `autoConfig = false` suppresses automatic matching and button-click tracking as intended, the CSP host list, and that `fbevents.js` replays the queue we create (the bootstrap follows Meta's published snippet shape). No pixel or Test Events access exists.
- Every browser behaviour: the banner's look, focus order and axe result, layout shift, the real `securitypolicyviolation` events under the enforced policy, nonce acceptance of the dynamic scripts, behaviour with a real ad blocker. `tests/e2e/consent.spec.ts` is **written, not run**; it needs `E2E_ANALYTICS=on` and an env file with placeholder ids.
- A production build and a real host (`useNonce` on the client, CSP headers through the proxy).
- Dependence on Hydrogen's pipeline: events other than `page_view` and `begin_checkout` flow through Hydrogen's `publish`, which needs a real shop (`getShopAnalytics` not null) and waits for Shopify's consent script to register as ready. On the mock store (or if `cdn.shopify.com` is unreachable) those events are not sent; `page_view` and `begin_checkout` do not depend on it. Not observed on a real store (V-08, Q-018).
- The first load of a browser that already holds a cart: Hydrogen's cart observer can report existing lines as additions when its own `cartLastUpdatedAt` storage entry is missing. Mitigated by that entry, not otherwise; possible small over-count of `add_to_cart`. Residual risk until seen on a store.
- Legal sufficiency of the banner wording, the 180-day lifetime and the opt-in or opt-out choice (client legal review, Q-012, T-16). The wording is a draft.
- Whether Shopify's own analytics (sales channel reporting) is unchanged by the `canTrack` override: it should be (Shopify's consent answer still counts) but is not observed.

## Follow-ups for owners of files outside this task

1. **Footer** (`SiteFooter.tsx`, FOOTER_LEGAL_LINKS area): render `<PrivacyChoicesButton />` so consent can be withdrawn (NFR-011). It renders nothing when no provider is configured.
2. **Product cards and list items** (`ProductItem.tsx`, collection and search listings): spread `selectItemAttributes({...})` from `~/lib/analytics/hydrogen-events` onto the card to emit `select_item`; the listener is already in place and nothing sends it until a card carries the attributes.
3. `docs/handover/RUNBOOKS.md`: add the log event `analytics.provider_failed` (fields `provider`, `reason`) to the closed vocabulary.
4. `docs/security/SECURITY_HEADERS.md` and `docs/security/THREAT_MODEL.md` (T-05 network inspection, T-10): record the provider hosts and the wildcard decision; network inspection of analytics traffic is possible only once ids exist.
5. `progress/DECISIONS.md`: one line for each of: consent default `opt-in`, the two wildcard hosts, no SRI, no advanced matching. `plans/` and `progress/` were not touched here (out of ownership).
6. `docs/requirements/TRACEABILITY.md`: rows for REQ-ANL-001, REQ-ANL-002, NFR-011 and REQ-QZ-006 should point at `tests/unit/analytics/**` and `tests/e2e/consent.spec.ts`.
7. Collection `view_item_list` carries no products; adding them needs the listing's items passed to the analytics component by the Hydrogen developer.

## To go live

1. Client supplies a GA4 measurement id and a Meta pixel id (CLR-004); set them and `PUBLIC_CONSENT_MODE` in the host's environment.
2. Client legal review of the mode, wording and lifetime (Q-012, T-16).
3. Verify in GA4 DebugView and Meta Test Events on staging; record evidence in `progress/TEST_RESULTS.md`; flip every UNVERIFIED line above.
4. Load every template with the console open and no `[Report Only]` message; then promote per `SECURITY_HEADERS.md`.
5. Run `tests/e2e/consent.spec.ts` on a server with placeholder ids and on the default server.

Rollback: unset an id and that provider disappears (no script, no host, no checkbox) without a code change.
