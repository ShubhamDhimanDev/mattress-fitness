# Response security headers and Content Security Policy

Task P7-07 (finding P-L6 of [REVIEW-2026-10-13-pages](REVIEW-2026-10-13-pages.md); threats T-07 and T-10 in [THREAT_MODEL](THREAT_MODEL.md)). Decision: DEC-044. Code: `storefront/app/lib/security-headers.ts` (pure, unit-tested), applied in `storefront/app/entry.server.tsx`. Status 2026-10-15: **built, verified on the dev server; not yet verified on a real host** (Q-003). The host-independent set below is enforced; the tightened CSP is **report-only**.

## What is sent

| Header | Value | Where | Why |
|---|---|---|---|
| `X-Content-Type-Options` | `nosniff` | documents, `.data` requests, robots and sitemap routes | stops a browser treating an answer as another type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | same | full URL (which can hold a cart or search term) never leaves the site cross-origin |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | same | a grep of `app/` finds no use of these features; the store locator searches by ZIP and payment is on Shopify's origin. Only features every browser recognises are listed, because an unknown name is a console error and the e2e specs fail on console errors. If a "use my location" button is ever added, change `geolocation` to `(self)` in the same commit |
| `X-Frame-Options` | `DENY` | same | legacy twin of CSP `frame-ancestors 'none'`. Shopify checkout, the customer account and admin previews navigate to their own origins; none frames this site |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | same | `same-origin` would sever the opener of any popup we open. The Phase 7 providers (payment, chat, consent) are not chosen, so the compatible value is used; tighten to `same-origin` once P7-01 to P7-03 show no popup is needed |
| `Strict-Transport-Security` | `max-age=15552000` | only when the request is https (URL scheme or first `X-Forwarded-Proto`) **and** the host is a public name (not localhost, an IP literal or a single label) | a localhost preview must never pin itself to https |
| `Content-Type` | `text/html; charset=utf-8` | documents | the charset was missing |
| `Content-Security-Policy` | Hydrogen's nonce policy, unchanged | documents | enforced (T-07) |
| `Content-Security-Policy-Report-Only` | the tightened policy below | documents | to be reviewed, then enforced |
| `Link: <canonical>; rel="canonical"` | see [SEO_POLICY](../architecture/SEO_POLICY.md) | indexable documents | not a security header; set in the same place |

The root document's `Cache-Control: private, no-cache` and `Vary: Cookie` (DEC-036) are untouched; a test asserts it.

### HSTS: not done, on purpose

`includeSubDomains` and `preload` are **not** sent. Both are effectively permanent and need (a) the final host and domain (Q-003) and (b) an inventory of every subdomain of the client's domain, because `includeSubDomains` forces https on all of them. Ramp: keep six months until launch plus a month of clean traffic, raise to one year, and only then consider `includeSubDomains` and the preload list, as a separate decision. Terminate TLS and redirect http to https at the host or edge; this header does not do that.

## The report-only policy and why it is tighter

Hydrogen's enforced policy is `default-src 'self' 'nonce-X' https://cdn.shopify.com https://shopify.com`, plus `style-src ... 'unsafe-inline'`, `connect-src` and `frame-ancestors 'none'`. Everything not listed falls back to `default-src`, which also allows Shopify's account host for scripts, plugins and form targets. The report-only variant:

| Directive | Sources | Difference from the enforced policy |
|---|---|---|
| `default-src` | `'self'` | no longer includes the nonce, the CDN or `shopify.com` |
| `script-src` | `'self'`, `'nonce-X'`, `https://cdn.shopify.com` | `shopify.com` removed from scripts (Hydrogen's consent script loads from the CDN) |
| `script-src-attr` | `'none'` | no inline event handlers |
| `style-src` | `'self'`, `https://cdn.shopify.com` (dev adds `'unsafe-inline'` for Vite) | no inline `<style>` elements |
| `style-src-attr` | `'unsafe-inline'` | React `style=""` attributes only |
| `img-src` | `'self'`, `data:`, `https://cdn.shopify.com` | explicit, instead of the fallback |
| `font-src`, `media-src` | `'self'`, `https://cdn.shopify.com` | explicit |
| `connect-src` | `'self'`, CDN, `https://monorail-edge.shopifysvc.com`, checkout and store domains | same as Hydrogen's |
| `object-src`, `frame-src` | `'none'` | new |
| `worker-src`, `manifest-src`, `base-uri` | `'self'` | new or same |
| `form-action` | `'self'`, `https://shopify.com`, checkout and store domains | new; the customer-account sign-in and sign-out leave through `shopify.com` |

`frame-ancestors` is left out because browsers ignore it in a report-only policy; the enforced policy sends `'none'`. Shop domains come from `PUBLIC_STORE_DOMAIN` and `PUBLIC_CHECKOUT_DOMAIN` and are accepted only as plain DNS names, so an odd environment value cannot add a directive. A nonce that is not a plain token produces no header.

**Verification so far:** unit tests (`app/lib/security-headers.test.ts`, table-driven cases including injected domains and nonces); the dev server on 2026-10-15 sent every header on `/`, on `.data` requests and on `robots.txt` and `sitemap.xml`; the e2e spec `tests/e2e/seo-headers.spec.ts` loads the home page in desktop and mobile Chromium and sees **no** policy violation in the console. **Not done:** a production build served on a real host (production lists no `localhost` sources), a check of the customer-account sign-in flow under `form-action`, and the checkout hand-off.

## Reports

Violations show in the browser console only. There is no collector: adding `report-uri` or `report-to` means choosing a receiving endpoint (a third-party service is a T-10 decision, a self-hosted route is an abuse target, T-13) and depends on the host (Q-003). Until then review by loading each template (home, collection, product, cart, search, stores, quiz, compare, blog, account) in Chromium with the console open.

## Promotion to enforced

1. Host chosen, `PUBLIC_SITE_URL` set, a staging URL serving a production build.
2. Every template above loaded with no `[Report Only]` message, including after each Phase 7 provider is added.
3. Replace Hydrogen's header with the tightened one in `entry.server.tsx` (keep the nonce), keep `frame-ancestors 'none'`.
4. Keep the report-only header for one release carrying any stricter next step.

## Third-party allow-list policy (T-10)

**Today no third-party origin is allowed**: only the site itself and Shopify (`cdn.shopify.com`, `shopify.com`, `monorail-edge.shopifysvc.com`, the store and checkout domains). A test fails if the report-only policy gains any other origin.

To add a provider (analytics, Meta pixel, Klaviyo, Judge.me, Shopify Inbox, a map tile server, Affirm):

1. The task that adds it (P7-01 to P7-03, P6-xx) names the exact hosts the vendor documents, and the directive each belongs in (`script-src`, `connect-src`, `img-src`, `frame-src`...). Never a wildcard host and never `'unsafe-inline'` or `'unsafe-eval'` for scripts; use the nonce.
2. The origin goes into `security-headers.ts` for the report-only policy first, with a test, and into the enforced policy only after the promotion steps above.
3. The script loads after consent or interaction (NFR-011), with Subresource Integrity where the vendor publishes a stable file, and sends no ZIP or e-mail unhashed.
4. Record the provider, hosts and reason in `progress/DECISIONS.md`; remove the origin in the same change that removes the provider.
5. A provider that needs `frame-src` also needs `frame-ancestors`/COOP reconsidered (`same-origin-allow-popups` is already chosen for popups).

## Where the headers are applied

`storefront/server.ts` is the single exit: every response (documents, `.data` requests, resource routes such as `/api/*` and `/webhooks/*`, redirects from `storefrontRedirect` and the 500 error response) passes through `withSecurityHeaders` (`app/lib/security-headers.ts`), which copies a response whose headers are immutable (`Response.redirect()`, a proxied `fetch`) before writing. The headers go on **before** the pending session cookie is appended (`finishResponse` in `app/lib/server-safety.ts`), so a response with immutable headers and a pending session is copied first and cannot throw into the 500 path. `entry.server.tsx` adds what only a document needs (the two CSPs with the nonce, the charset, the canonical `Link`) and repeats the base set for `.data` requests as a safety net. **An own-server entry (Q-003) that does not use `server.ts` must make the same `withSecurityHeaders` call on every response**, or only documents and data requests are covered. Tests cover the immutable-headers copy and `finishResponse` with an immutable response and a pending session; the `server.ts` wiring itself runs only on a built server (verified with a request to `/api/extend/offers` on the dev server).

## Shopify's blocked telemetry (decision DEC-045)

Shopify's consent script (loaded from `cdn.shopify.com` by Hydrogen's analytics) posts performance telemetry to `otlp-http-production.shopifysvc.com`, which neither Hydrogen's enforced `connect-src` nor ours allows. Blocking it is **intended**: nothing we ship depends on it and it is a third-party origin (T-10). The e2e helpers (`tests/e2e/helpers/telemetry-refusal.ts`, unit-tested) ignore a console line only when it is a Content Security Policy refusal whose **blocked URL** is an https URL with exactly that host name (read from the quoted URL in Chromium's message; a longer host such as `<that host>.attacker.example`, the host in a query string, path or user-info part, or only in the policy text, does not count); a violation naming any other host (including in `[Report Only]` form) fails the specs.

## Known gaps

- `powered-by: Shopify, Hydrogen` is added by Hydrogen after our code runs; remove it with `poweredByHeader: false` in `createRequestHandler` options (server.ts) if the client wants it gone.
- Behaviour behind a real proxy (`X-Forwarded-Proto`, P-L5) and on a production build is unverified.
