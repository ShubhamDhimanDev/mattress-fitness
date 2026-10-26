# ADR-0012: Migrate to Hydrogen 2026.10.2 (library model) and React Router 7.18.4

- **Status:** Accepted by owner choice 2026-10-26 (option (a) of DEC-083), for development. Built, builds and type checks; not run against a store in a browser (owner mode). Supersedes [ADR-0008](ADR-0008-hydrogen-pins-and-advisories.md).
- **Date:** 2026-10-26
- **Deciders:** project owner (choice); shopify-hydrogen-developer (implementation). No independent review yet.
- **Requirements:** NFR-004, NFR-012
- **Related:** P1-12, DEC-083, DEC-133, B-12, R-23, F-44, ADR-0002, ADR-0004, ADR-0011, T-12

## Context

ADR-0008 held Hydrogen 2026.4.7 with react-router 7.16.0 because 2026.4.7 declared peers `react-router ~7.16.0` and `@react-router/dev ~7.16.0`. React Router below 7.18 carries a high-severity unauthenticated denial of service in route matching (security review H-1). The owner chose to migrate (option (a)).

## Facts confirmed (2026-10-26)

| Fact | Evidence |
|---|---|
| `@shopify/hydrogen` 2026.10.0 to 2026.10.2 are published; `latest` is 2026.10.2. | `npm view @shopify/hydrogen versions` |
| 2026.10 is **not a version bump of the 2026.4 framework**. It is a framework-agnostic server-handler library: `createShopifyRequestContext`, `createStorefrontClient({type, requestContext, config}).graphql()`, `handleShopifyRoutes`, `handleShopifyRedirects`, `createCartServerHandlers`, `createCustomerSession`, `<ShopifyScripts>`, gql.tada typing. | Package contents (`dist/core`, `dist/customer-account`, `dist/react`); release notes at https://github.com/Shopify/hydrogen/releases |
| Removed in 2026.10: `createHydrogenContext`, `createRequestHandler` (Hydrogen's), `storefrontRedirect`, `hydrogenPreset`, `hydrogenRoutes`, `createContentSecurityPolicy`, `NonceProvider`/`useNonce`, `Analytics.Provider` and `Analytics.*View`, `getShopAnalytics`, `CartForm`, `useOptimisticCart`, `Image`, `Money`, `Pagination`, `getSitemap`/`getSitemapIndex`, the `hydrogen()` Vite plugin, and the `shopify hydrogen dev/build/codegen/preview` commands (the package disables them in its `shopify.cli.disabledCommands`). | Export list of `dist/core/index.d.mts`, `dist/react/index.d.mts`, package.json |
| The package's own upgrade guide is a packaged agent skill, `skills/migrate-to-hydrogen-2026-10` (with references for cart, customer account, analytics, routing, typing, tooling). It is the official guide for this migration; the 2026.10.1 release notes say it is synced with `hydrogen skills sync`. | `@shopify/hydrogen@2026.10.2` tarball, `skills/` |
| Peers of `@shopify/hydrogen@2026.10.2`: `react ^18 \|\| ^19`, `vite ^5..^8`, `vue ^3.5` (all optional). **No react-router peer**, so react-router 7.18.4 is a supported combination. | `npm view @shopify/hydrogen@2026.10.2 peerDependencies` |
| `@react-router/dev` and `@react-router/fs-routes` 7.18.4 require `react-router ^7.18.4`; `version-7` dist-tag is 7.18.4; `latest` is 8.5.0 (not used). | `npm view react-router dist-tags` |
| `@shopify/mini-oxygen` 4.2.3 (already installed) provides the `oxygen()` Vite plugin; 2026.10 needs >= 4.2.0. `@shopify/cli` is 4.8.1 (the template's pin; 4.9.4 is latest). `@shopify/cli-hydrogen`, `@shopify/remix-oxygen` and `@shopify/hydrogen-react` are not used by 2026.10. | package.json of the template and `npm view` |
| Shopify's template sets a MiniOxygen compatibility-date override (`2026-04-01`) because MiniOxygen cannot run the inferred `2026-10-01`. | `templates/react-router/vite.config.ts` on GitHub `main` |
| The Customer Account API is pinned to `2026-10` by the library: `CustomerAddressInput` has `countryCode` (not `territoryCode`). | `dist/customer-account-api-types.d.ts`; codegen output |

## Decision

1. Move to `@shopify/hydrogen` **2026.10.2**, `react-router` and the two `@react-router/*` dev packages **7.18.4** (exact pins), `@shopify/cli` **4.8.1**, remove `react-router-dom`. Keep React 18.3, Vite 8, TypeScript 5.9 (inside the peer ranges; the template's React 19 is not required).
2. **Keep our own server, router and entry points.** `storefront/server.ts` stays the single fetch handler (ADR-0011: the Node server loads `dist/server/index.js`); it now calls React Router's `createRequestHandler`, Hydrogen's `handleShopifyRoutes` (restricted, see 4) and `handleShopifyRedirects`. Build output and the Node adapter are unchanged.
3. **Adapter layer instead of rewriting 80 files.** `app/lib/hydrogen/` provides, on top of the 2026.10 library, the surface the routes were written against: `context.storefront` (`query`/`mutate`/`Cache*`/`i18n`, `storefront.ts`), `context.cart` (`cart-handler.ts`), `context.customerAccount` (`customer-account.ts`), `CartForm` and `useOptimisticCart` (`cart-form.tsx`), `Image`, `Pagination`, `Money`, sitemap helpers, CSP/nonce, and the analytics bus (`analytics.tsx`). Code ported from 2026.4.7 is MIT licensed and marked as ported. The 46 query call sites, the cart routes with the offer engine (ADR-0003) and the account routes did not change.
4. **`handleShopifyRoutes` only for two path patterns**: the same-origin Storefront API proxy (`/api/<version>/graphql.json`, which Shopify's analytics script posts through) and `/__shopify/*`. The library would otherwise answer `/checkout` and `/cart/<variant>:<qty>` by handing the cart to Shopify without the offer gate (ADR-0003, REQ-PRE-006) and would redirect `/account/login` to the store's own login. Those paths stay ours.
5. **Types stay on the codegen pipeline**, not gql.tada: `codegen.mjs` runs `@graphql-codegen/cli` with `@shopify/hydrogen-codegen`'s preset against the schemas shipped in the new package. `hydrogen gql check` and the ts-plugin are not adopted (follow-up, optional).
6. **Customer accounts**: our login, authorize and logout routes stay (they add same-origin and no-store rules, T-05, T-08, T-11) and call `createCustomerSession` (`prepareLoginUrl`, `handleOAuthCallback`, `logout`, `getOrRefreshAccessToken`); the cookie session (`AppSession`) is the session manager. The library's handler group is not registered.
7. **Analytics**: Shopify's scripts come from `<ShopifyScripts>` (consent mode `no-banner`, `webMcp` off); our consent layer and GA4/Meta pipeline keep their bus (`app/lib/hydrogen/analytics.tsx`, ported) and forward page, product, collection, search and cart-view events to `window.Shopify.analytics`.
8. **Dev and build** are Vite and React Router commands: `vite dev` (use `--mode <name>` instead of `--env-file .env.<name>`), `react-router build`, `vite preview`. `npm run build` runs `node codegen.mjs` first.

## Steps taken

1. Fetched the package, its skills and the template (read-only). 2. Uninstalled and reinstalled the five version-bound packages (a plain `npm install` fails because npm keeps the installed 2026.4.7 peers); the lockfile was regenerated. 3. `codegen.mjs`; `vite.config.ts`, `react-router.config.ts`, `tsconfig.json`, `env.d.ts`, `app/routes.ts`. 4. `app/lib/hydrogen/*`, `context.ts`, `server.ts`, `entry.*`, `root.tsx`, `AnalyticsGate`. 5. Imports of the removed exports repointed (61 files). 6. Customer address field `territoryCode` to `countryCode` (2026-10 API). 7. Typecheck, build, lint, format, bundle budgets, unit tests, Node-server smoke test.

## Consequences

- `npm audit --omit=dev`: **7 findings (1 low, 4 moderate, 2 high) before, 0 after.** All dependencies: 42 (4 low, 6 moderate, 32 high) before, 35 (2 low, 2 moderate, 31 high) after; what remains is build-time or development-server tooling (GraphQL codegen chain, lodash, miniflare/undici/ws from mini-oxygen, body-parser); none reaches the shipped bundle.
- Bundle budgets: unchanged, all routes within their budgets (smallest headroom 2.2 kB).
- We own ported code (about 2,100 lines in `app/lib/hydrogen/`) that Shopify will not update. Future Hydrogen releases change the library, not these files; each upgrade needs the packaged skills re-read (`hydrogen skills sync`).

## Not verified and known limits (owner mode: no browser, no store run)

- No browser run. A dev server (demo env) and the built bundle on `scripts/node-server` answered `/`, `/cart`, `/collections/all`, `/search`, `/products/testing` with 200 and the Shopify script tags carry the CSP nonce; with a fake store the Node server answers 500 for store-backed pages as expected.
- Cart add/update/remove/discount, the checkout hand-off, customer login (needs an HTTPS origin), consent banner behaviour, GA4/Meta events and Shopify analytics were not exercised against a store. `cartDiscountCodesUpdate` no longer uses `@defer`.
- **Shopify-side add-to-cart / remove-from-cart analytics events are not forwarded**: 2026.10 derives them only from its own client cart store. Page, product, collection, search and cart-view events are forwarded. Decide at the analytics verification whether to adopt the library cart store or accept this.
- The CSP hosts for the new Shopify scripts were not checked in a browser (script-src uses the nonce; connect-src/img-src may need additions).
- `vite preview --mode <name>` loading env files is assumed from MiniOxygen's preview support; unverified.
- `scripts/spikes/option-b-node-server.mjs` still imports the removed 2026.4 API; it is a historical spike and was not migrated.
- Private Storefront token: the buyer address comes from `oxygen-buyer-ip` or `x-real-ip` (set by `scripts/node-server`); without one the client is `private_no_buyer_context`.

## Rollback

Revert the branch `feat/p1-12-hydrogen-2026-10` (no commit was made; discard the working tree changes of this branch). ADR-0008 would return to Proposed and B-12 to open.

## Alternatives considered

Force react-router 7.18.4 under Hydrogen 2026.4.7 (peer conflict, unsupported); use the library's cart/predictive-search/collection stores and gql.tada everywhere (a rewrite of the cart routes and 46 queries, rejected as out of proportion for this task and a risk to the offer gate).
