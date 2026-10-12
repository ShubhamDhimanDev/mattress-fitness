# Runbooks for developers and maintainers

**Draft 1, dated 2026-10-12.** For a developer or maintainer who sets up, deploys, operates and upgrades the storefront. Deliverable H-07 (REQ-HOST-002, REQ-HOST-003). The client-facing guide for store staff is [ADMIN_GUIDE.md](ADMIN_GUIDE.md).

## How to read this document

| Tag | Meaning |
|---|---|
| (no tag) | Stated in a repository file named in the same section. Commands in the setup section are taken from `storefront/CLAUDE.md`, `storefront/package.json` and the scripts' own usage text. They were **not re-run** for this draft. |
| `PLANNED` + task ID | Designed but not built. The file or script named does not exist yet. IDs are from `plans/phases/*.md` and `plans/BACKLOG.md`. |
| `UNVERIFIED` | Depends on a Shopify, Extend or host behavior not proven yet. The V-number is the verification task in `docs/research/TECH_FEASIBILITY.md`. |
| `PROPOSAL` | A suggestion by the writer, not a decision in the project records. |

**Not rehearsed.** H-07 requires rehearsal evidence (deploy, rollback, failed sync, secret rotation). None of the procedures below has been rehearsed. **Not covered:** the cutover and DNS plan (P9-03, P9-04, planned for `docs/deployment/RUNBOOK.md`), server hardening details for Option B, and Klaviyo, analytics and reviews operations.

**State on 2026-10-12.** No development store is connected (P0-03 is blocked), the hosting option is undecided (Q-003), staging is blocked (P1-07), there is no remote repository yet (Q-014), and the framework pins are held (ADR-0008). Extend is built against a mock and switched off.

## Contents

1. [Set up a development machine](#1-set-up-a-development-machine)
2. [Environment variables](#2-environment-variables)
3. [Deploy and roll back](#3-deploy-and-roll-back)
4. [Failed Extend sync and the reconciliation report](#4-failed-extend-sync-and-the-reconciliation-report)
5. [Rotate a secret](#5-rotate-a-secret)
6. [Add a store](#6-add-a-store)
7. [Refresh the product catalog](#7-refresh-the-product-catalog)
8. [Investigate a flagged haul-away order](#8-investigate-a-flagged-haul-away-order)
9. [Upgrade Hydrogen](#9-upgrade-hydrogen)
10. [Open items and document conflicts](#10-open-items-and-document-conflicts)

---

## 1. Set up a development machine

**Versions on the reference machine:** fnm 1.39.0, Node v22.23.3, npm 10.9.9 (`progress/TEST_RESULTS.md`, `plans/CURRENT_PHASE.md`). `.nvmrc` holds `22`. The app's `engines` allows `^22 || ^24`. CI reads `.nvmrc`. ADR-0005.

**Windows note.** PowerShell on the reference machine still defaults to Node 25. Use **Git Bash**, which loads the version from `.nvmrc` through fnm via `~/.bashrc`.

1. Install Git and fnm. (Install method for fnm: any; it was installed with the owner's approval, Q-017.)
2. From the repository root, install and select Node 22 (standard fnm commands, not re-run here):

   ```bash
   fnm install 22
   fnm use
   node --version    # expect v22.x
   ```

3. Install dependencies exactly from the lockfile:

   ```bash
   cd storefront
   npm ci
   ```

4. Environment file. `storefront/.env` is git-ignored and, today, holds mock.shop values for local work. **Never read it aloud, print it, paste it or commit it.** For a real development store, take the variable names from `.env.example` and the values from the sources in section 2. Connecting the storefront to a dev store is `PLANNED` (P3A-01).
5. Start the dev server (against mock.shop until a store is connected): `npm run dev`, then open http://localhost:3000.

**Commands** (run in `storefront/`)

| Command | Does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run lint` | ESLint |
| `npm run typecheck` | `react-router typegen` and `tsc --noEmit` |
| `npm run test` | Vitest (unit and integration) |
| `npm run test:watch`, `npm run test:coverage` | Watch mode, coverage |
| `npm run format:check`, `npm run format` | Prettier check or write |
| `npm run build` | `shopify hydrogen build --codegen` |
| `npm run codegen` | Regenerate Storefront and Customer Account API types |
| `npm run check` | Format check, lint, types, unit tests and build in one go |
| `npm run e2e` | Playwright Test: desktop and mobile Chromium, dev server on port 3100 |
| `npm run e2e:ui` | Playwright UI mode |

- `E2E_ALL_BROWSERS=1 npm run e2e` adds WebKit and Firefox. In Git Bash that is a valid one-line form.
- **Browsers for Playwright.** CI installs them with `npx playwright install --with-deps chromium webkit firefox`. For a local run, `npx playwright install chromium` is the matching command; it is `UNVERIFIED` on the reference machine because no local install is recorded.
- **Framework and docs check** (from the repository root): `node scripts/validate-framework.mjs`.

**The scripts folder.** Scripts in `scripts/` are plain Node ES modules run with `node` from the repository root. The ones read for this document (`catalog/import.mjs`, `lib/cli.mjs`, `lib/env.mjs`, `mocks/extend-mock.mjs`) use only Node built-ins and sibling files. Each prints usage with `--help`.

**Working rules.** Check `git status` first. Work on `feat/<id>-<slug>`, `fix/...`, `docs/...` or `chore/...`. Commit and push only when the project owner asks. CI (`.github/workflows/ci.yml`) runs the framework check, then in `storefront/`: `npm ci`, format check, lint, typecheck, test, build, an `npm audit --omit=dev --audit-level=high` report (non-blocking, ADR-0008) and e2e on all three browsers. Its first real run waits for a remote repository (P1-06). The template files `AGENTS.md`, `.cursor/` and `guides/` are reference only; do not install any toolkit they suggest (threat T-12).

---

## 2. Environment variables

**Names only.** Values live in the hosting platform's secret store and in git-ignored local files. Variables with the `PUBLIC_` prefix are exposed to browsers by Hydrogen's convention; the rest are server-only. Source: `docs/deployment/DEPLOYMENT.md` and `.env.example`; names are reconciled with the scaffold in P1-09. Use separate values per environment (local, staging, preview, production). Production secrets must be rotated away from any value that touched staging (Phase 9).

| Variable | Exposure | Where the value comes from |
|---|---|---|
| `SESSION_SECRET` | server | Generated by us, one per environment |
| `PUBLIC_STORE_DOMAIN` | public | The client's Shopify store (the `myshopify.com` domain) |
| `PUBLIC_STOREFRONT_ID` | public | The Hydrogen or Headless channel |
| `PUBLIC_STOREFRONT_API_TOKEN` | public | The channel's public Storefront API token |
| `PRIVATE_STOREFRONT_API_TOKEN` | server | The channel's private token |
| `PUBLIC_CHECKOUT_DOMAIN` | public | The store's checkout domain |
| `PUBLIC_CUSTOMER_ACCOUNT_API_CLIENT_ID`, `PUBLIC_CUSTOMER_ACCOUNT_API_URL` | public | Customer Account API settings in the channel |
| `SHOP_ID` | see conflict C1 | The Shopify store ID (analytics) |
| `SHOPIFY_APP_CLIENT_ID`, `SHOPIFY_APP_CLIENT_SECRET` | server | A Dev Dashboard app with custom distribution on the client's store (legacy custom apps cannot be created, V-20). Least-privilege scopes. |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | server | Offline token from the authorization-code grant, if used. Least privilege. Never stored in the repo. |
| `SHOPIFY_APP_CLIENT_SECRET` | server | The webhook signing secret (where it comes from: `UNVERIFIED`, V-12) |
| `EXTEND_API_HOST` | server | `http://127.0.0.1:4010` (the local mock), `https://api-demo.helloextend.com` or `https://api.helloextend.com`. Other hosts are rejected by the config parser. |
| `EXTEND_STORE_ID`, `EXTEND_ACCESS_TOKEN` | server | Extend Merchant Portal (an API Integration; demo and production are authenticated separately) |
| `EXTEND_ORDER_SYNC` | server | `self` (default), `extend-app` or `off`. Guards against double reporting (ADR-0009). |
| `PUBLIC_EXTEND_ENABLED` | public | Our feature switch (not a secret). `false` hides every Extend offer. |
| `JUDGEME_PRIVATE_API_TOKEN` | server | Judge.me, if chosen (Q-011). Never a `PUBLIC_` variable. |
| `PUBLIC_GA4_MEASUREMENT_ID`, `PUBLIC_META_PIXEL_ID`, `PUBLIC_KLAVIYO_COMPANY_ID` | public | The client's accounts (CLR-004) |
| `PUBLIC_AFFIRM_PUBLIC_KEY` | public | Affirm (Q-016) |
| `PUBLIC_MAPS_API_KEY` | public, restricted by referrer | A maps provider, if any (Q-010) |

**Variables the command-line scripts read** (from `scripts/lib/env.mjs`; **not listed in DEPLOYMENT.md or `.env.example`**, see conflict C2)

| Variable | Use |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | Default store for the scripts (or pass `--store`). Must be `<name>.myshopify.com`. |
| `SHOPIFY_ALLOWED_STORES` | The allow-list. Any contact with a store, even read-only, needs the domain listed. Separate with commas, spaces or new lines. Invalid entries are dropped. |
| `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | Admin API token. Read from the environment only, never from the command line. |
| `SHOPIFY_ADMIN_API_VERSION` | Optional API version override |
| `EXTEND_MOCK_ACCESS_TOKEN`, `EXTEND_MOCK_STORE_ID` | Optional overrides for the local Extend mock only |

**Where values are stored**

| Environment | Store |
|---|---|
| Local | `storefront/.env` (git-ignored, `.env.*` ignored except `.env.example`) |
| Staging | Our staging server's secret store. `PLANNED` (P1-07 is blocked: no server details) |
| Option A | Oxygen environment variables per environment. Screens and commands `UNVERIFIED` (P9-01, P9-02) |
| Option B | Environment on the client's server, outside the repository. `PLANNED` (P9-01, P9-02) |

---

## 3. Deploy and roll back

**Rules.** Nothing deploys or publishes automatically to production. Every production deployment needs recorded human approval. Production deploys come from a tagged release on `main`, never a feature branch, and use the same artefact that passed CI. Hosting is undecided (Q-003); both options stay viable (ADR-0004). The only platform seams are `server.ts`, `app/lib/context.ts` and the `oxygen()` plugin in `vite.config.ts`.

### 3.1 Before any production deploy

1. Tag a release candidate on `main`. Run the `deployment-readiness` skill.
2. CI is green, including e2e on all browsers and the audit report.
3. **Hydrogen pins.** ADR-0008 says do not ship to production on the held react-router pins without a recorded decision. The high-severity advisory must be resolved or accepted in writing (Phase 7 gate; resolved by Phase 9). Check ADR-0008's status first.
4. Environment variables for the target are set (section 2) and secrets are rotated away from staging values (section 5).
5. Record the approval (who, when, which commit) in `progress/DECISIONS.md`.
6. Identify the rollback target (previous Oxygen deployment, or previous release directory) **before** deploying.

### 3.2 Option A: Shopify Oxygen

All of this is `PLANNED` (P9-01, P9-04, REQ-HOST-002) and `UNVERIFIED` until rehearsed. Oxygen's plan terms on Basic were not on the documents read (F-40).

1. Connect the repository's `storefront/` to the Hydrogen sales channel.
2. Set environment variables per Oxygen environment (section 2).
3. Deploy. The command named in `DEPLOYMENT.md` is `shopify hydrogen deploy`. Flags and environment selection are `UNVERIFIED`. Previews per pull request come with Oxygen.
4. Connect the client's domain (DNS plan: P9-03).
5. Run the smoke checks (3.5).

**Roll back.** Redeploy the previous Oxygen deployment, or restore the previous domain assignment. For a configuration-only problem use the quick rollbacks in 3.4.

### 3.3 Option B: the client's Node server

The spike (P1-08, `docs/deployment/OPTION_B_NODE.md`) proved the same Hydrogen code runs on plain Node. **Production Option B is `PLANNED`** (P9-01, REQ-HOST-003). The file `scripts/spikes/option-b-node-server.mjs` is a spike, not production code.

**The seven changes** (all localized to the build config, one entry file and one cache line)

| # | Change |
|---|---|
| 1 | Remove the `oxygen()` plugin from `vite.config.ts`; build with `react-router build` (output in `dist/server` and `dist/client`) |
| 2 | Alias `react-dom/server` to `react-dom/server.browser` in the Vite config (React 18's Node entry lacks `renderToReadableStream`; re-check on React 19) |
| 3 | A Node entry `server.node.ts` replacing `server.ts`: convert Node requests to Web `Request`, write the `Response` back, serve `dist/client`, stream bodies, forward several `Set-Cookie` headers |
| 4 | Replace `caches.open('hydrogen')` in `app/lib/context.ts` with Hydrogen's `InMemoryCache`, or a shared cache such as Redis for several processes |
| 5 | `waitUntil`: a no-op that tracks pending promises |
| 6 | Session: `AppSession` works unchanged |
| 7 | Environment variables from `process.env` with the same names |

**Not covered by the spike:** cart and customer-account routes against a real store, HTTPS and reverse-proxy headers, caching under load, process management, Nginx, TLS, graceful shutdown, the Extend webhook and sync service, Hydrogen's analytics and consent features. **Re-run the spike after the Hydrogen 2026.10 migration (P1-12).**

**What Option B adds** (SOW §3, all `PLANNED`): hardened Linux server, Nginx, TLS certificate and renewal, process manager, page caching, deployment pipeline, a staging site, uptime monitoring, and the Extend sync as a service on the same server. OS updates, security patches, backups and scaling are the client's, or a separate maintenance agreement's (EXC-13).

**Deploy outline** (`PROPOSAL`; `DEPLOYMENT.md` states only the rollback principle)

1. Build once in CI, with the Option B build config, from the tagged commit.
2. Copy the artefact to a new release directory on the server, for example `releases/<tag>/`.
3. Place environment values outside the release directory.
4. Point the process manager at the new release and reload; Nginx proxies to it.
5. Run the smoke checks (3.5).

**Roll back.** Point the process manager at the previous release directory and reload Nginx (`DEPLOYMENT.md`). Keep at least the previous release on disk.

### 3.4 Rollback triggers and quick rollbacks

Written triggers (to be finalized in the Phase 9 runbook, P9-04): checkout hand-off failing, sync failing beyond a set time, an error-rate spike, a security issue.

| Problem | Quick action | Needs a deploy? |
|---|---|---|
| Extend offers misbehaving or Extend unhealthy | Set `PUBLIC_EXTEND_ENABLED=false` (hides every Extend surface). Order sync can keep running so paid coverage still reaches Extend. | Environment change; redeploy or restart as the host requires `UNVERIFIED` |
| Webhook route misbehaving | Disable the route on its own; Shopify retries failed deliveries, so events queue (retry window `UNVERIFIED`, V-12). Sync is idempotent, so a missed window can be replayed. | Yes, if the route is code |
| A gift or bundle promotion wrong | Deactivate the discount in Shopify admin | No |
| A haul-away rule or check misfiring | Disable the offer rule or the Flow rule in Shopify admin | No |
| A delivery zone edit wrong | Restore the last good copy of **both** lists (metaobject and Local delivery) | No |
| A bad catalog import | Restore previous values from the run manifest (7.4) | No |
| A bad release | Option A: redeploy previous. Option B: previous release directory. | Yes |

### 3.5 Smoke checks after a deploy (read-only)

Home page, a collection, a product page, cart to checkout hand-off, account sign-in, webhook delivery, sync status, TLS, redirects (Phase 9). Option B adds a monitoring alert test. One authorised live test order, always refunded, only with explicit written authorisation and only for the first launch.

### 3.6 Rehearse

Rehearse deploy **and rollback** on staging before the first production release (P9-04). Record the evidence; H-07 is not complete without it.

---

## 4. Failed Extend sync and the reconciliation report

### 4.1 State

| Piece | State |
|---|---|
| Config parser, offers, price points, linking, snapshot builder, sync orchestration, webhook verifier and router, reconciliation comparison (`storefront/app/lib/extend/*`) | Written, with unit tests in the repository (not re-run for this draft) |
| Webhook route `app/routes/webhooks.shopify.tsx` | `PLANNED` (P5A-08). No such route exists in `storefront/app/routes/` on 2026-10-12 |
| Reconciliation script `scripts/reconcile-extend.mjs` | `PLANNED` (P5A-10). Only the comparison function `reconcile()` exists |
| Structured failure logging and its destination | `PLANNED` (P5A-10, NFR-010) |
| Extend itself | Mock only. Production needs an approved account and Extend's written answers (Q-005, CLR-006, P5A-12) |

Mock: `node scripts/mocks/extend-mock.mjs --port 4010` (binds 127.0.0.1; every response carries `X-Extend-Mock: true`). A mock-green result proves our code matches our reading of the docs, nothing more.

### 4.2 How the sync works

Topics handled: `orders/paid`, `orders/updated`, `orders/cancelled`, `refunds/create`, `fulfillments/create`. Every topic leads to the same thing: read the order again from the Admin API and send a **full snapshot** `PUT /orders` keyed by the Shopify order ID. The webhook is only a trigger; the payload is never trusted for content. The HMAC (`X-Shopify-Hmac-Sha256`) is verified on the raw body first. Because the Orders API is idempotent and snapshot-based, replays and retries are safe. Fulfilment sets `fulfilledQuantity`, which makes Extend issue the contract.

Retry defaults in `sync.ts`: up to 4 attempts, base delay 500 ms, maximum delay 8 s, 10 s per request, 30 s in total.

**Open item:** the replay store in `webhook.ts` is in-memory and for tests and local use only. Production needs a durable store (the code comment suggests a key-value store). Which one depends on the host (Q-003). `PLANNED` (P5A-08).

### 4.3 What a sync result means

| Result | Meaning | Action |
|---|---|---|
| `synced` | Snapshot accepted | None. If any lines were **flagged**, they were not sent; see 4.5 |
| skipped: `disabled` | Extend config is off (flag off or credentials missing or invalid) | Check section 2 variables; expected while Extend is off |
| skipped: `order_sync_extend_app` / `order_sync_off` | `EXTEND_ORDER_SYNC` says not to sync | Expected if set on purpose |
| skipped: `no_coverage_lines` | The order has no Extend coverage | None |
| skipped: `all_coverage_flagged` | Every coverage line failed a cross-check | Reconcile (4.5) and inspect the order |
| failed: `timeout`, `network` | Extend or the network did not answer | Transient. Retry or replay later |
| failed: `http` | Extend answered with an error status | Read the status in the log. General guidance, not Extend-specific: 401 or 403 suggests credentials (section 5); 4xx otherwise suggests a request problem; 5xx suggests Extend is unhealthy |
| failed: `malformed` | Extend's answer could not be read | Treat as an Extend-side or contract change; compare with the demo host |
| failed: `circuit_open` | The breaker is protecting Extend after repeated failures | Wait; fix the cause; offers are hidden meanwhile by design |
| failed: `quote_lookup_failed` | Could not confirm the plan price with Extend (Extend down) | Transient. Retriable, the order is not flagged |
| failed: `invalid_order` | The Shopify order could not be turned into a snapshot | Not retriable. Inspect the order data |
| failed: `unsupported_currency` | The order is not in a supported currency (USD only) | Not retriable. Inspect the order |

### 4.4 Procedure: a sync failed

1. **Scope it.** One order or many? Which `EXTEND_API_HOST` (mock, demo, production)?
2. **Find the events** in the structured logs. They carry order IDs, line IDs, plan IDs and reasons only; customer data is never logged. Where logs go depends on the host `PLANNED`.
3. **Check configuration** (names only): `PUBLIC_EXTEND_ENABLED`, `EXTEND_ORDER_SYNC`, `EXTEND_API_HOST`, `EXTEND_STORE_ID`, `EXTEND_ACCESS_TOKEN`. The parser reports disabled reasons `flag_off`, `missing_credentials`, `invalid_host`, `invalid_store_id`, `invalid_token`, `invalid_order_sync` and the names of the missing variables. Order sync can run with the flag off, so paid coverage still reaches Extend.
4. **If Extend is down:** do nothing destructive. For a long outage, hide offers with `PUBLIC_EXTEND_ENABLED=false` (the breaker already hides them automatically).
5. **Replay.** Re-sending an order is safe (idempotent snapshot). Shopify retries failed webhook deliveries (window `UNVERIFIED`, V-12). For orders beyond that window, replay the missed window; the phase plan calls for this, but **no replay tool is named or written** `PLANNED` (P5A-08, P5A-10).
6. **Verify** by running the reconciliation report for the window (4.5). Expect `clean: true`.
7. **Record** the incident, cause and fix in `progress/` notes. If the cause is systemic, use the quick rollbacks in 3.4.

If Extend says its own Shopify app must sync orders, set `EXTEND_ORDER_SYNC=extend-app` and drop our sync to avoid double reporting. Get that answer in writing (Q-005).

### 4.5 The reconciliation report

`reconcile(shopifyOrders, extendOrders, { storeId, quotesForOrder })` is pure. It returns `checkedOrders`, a list of issues, a count per kind, and `clean`. Issues carry order, line and plan IDs and a short detail only (no personal data, T-05). The script that fetches both sides is `PLANNED` (`scripts/reconcile-extend.mjs`, P5A-10); its flags are not defined yet.

**Open item (`UNVERIFIED`, V-11):** Extend documents no way to read orders back. The Extend side of the comparison is, today, the mock's state. For production it would have to be a Merchant Portal export or an API read, once Extend confirms one exists.

A schedule for the report is `PLANNED` (`DEPLOYMENT.md`, Monitoring).

| Kind | Meaning | Usual cause and action |
|---|---|---|
| `missing_sync` | Shopify has coverage lines that Extend's copy lacks | A failed or missed sync. Replay the order |
| `unexpected_extend_order` | Extend has an order not among the Shopify orders checked | Window too narrow, or a duplicate reporter (Extend's app also installed?). Check `EXTEND_ORDER_SYNC` |
| `orphan_coverage` | Coverage with no valid covered item (reasons: `covered_product_missing`, `_mismatch`, `_ambiguous`, `_ineligible`), or Extend holds a line Shopify does not | A cart built outside the site, or a linking defect. Inspect the order. The line is not reported to Extend |
| `price_mismatch` | Paid price differs from the plan's quoted price, or Shopify and Extend disagree | A direct-API cart picked a cheaper price-point variant, or a price-point table change. Not reported to Extend. Staff decide with the client (ADMIN_GUIDE section 9) |
| `quantity_mismatch` | Coverage quantity differs from the covered item's | The child quantity rule did not hold (V-16). Investigate linking |
| `status_mismatch` | Shopify and Extend disagree on active, cancelled or refunded | A missed cancel or refund event. Replay |
| `contract_missing` | The item is fulfilled in Shopify but Extend issued no contract | Fulfilment event missed, or Extend-side issue. Replay; then contact Extend |
| `flagged_coverage` | A line failed a check (`invalid_plan_id`, `invalid_covered_product_id`, `duplicate_coverage`, `unknown_plan`) | An attribute was tampered with or the price-point table is out of date. Inspect |
| `invalid_order` | The order could not be built into a snapshot | Inspect the order |

### 4.6 Before Extend goes live

Extend must give written approval of the headless custom UI, answers on price points, line-property key names, the mattress category and order-sync ownership (Q-005, `docs/integrations/EXTEND.md` section 3). Run the full lifecycle against the demo host (P5A-12) before production. Keep a recorded statement of whether Extend is live, off or waiting.

---

## 5. Rotate a secret

### 5.1 When

- Scheduled: production secrets must be rotated away from any value that touched staging before go-live; routinely thereafter (the interval is the client's or the maintenance agreement's decision `TO BE DECIDED`).
- After a person with access leaves, or a provider tells you to.
- **Suspected exposure:** stop. Do not copy the value anywhere. Report it to the project owner at once, then rotate (`.claude/rules/security.md`).

### 5.2 General steps

1. Find the secret in the access inventory (H-06: names, owners, where stored, renewal dates; no values).
2. Create the new value at its source (table below). Where two values can be valid at once, add the new one first.
3. Put the new value in the secret store of **each affected environment** (section 2). Never in the repository, a ticket, chat or a log.
4. Restart or redeploy so the process reads it.
5. Run the check in the last column.
6. Revoke the old value at the source.
7. Update the inventory (date, who); no values.

### 5.3 Per secret

| Secret | New value from | Effect and check |
|---|---|---|
| `SESSION_SECRET` | Generated by us: a long random string (method not specified in the docs) | `app/lib/context.ts` passes a single secret to the cookie session (`AppSession.init(request, [env.SESSION_SECRET])`), so existing session cookies stop verifying. Whether shoppers lose carts or sign-in state is `UNVERIFIED`; test on staging. `AppSession.init` already accepts a list, so a zero-downtime rotation (new first, old second) would need a small code change `PROPOSAL` |
| `PRIVATE_STOREFRONT_API_TOKEN`, `PUBLIC_STOREFRONT_API_TOKEN` | The Hydrogen or Headless channel in Shopify admin | How to regenerate is `UNVERIFIED`. Check a product page and add to cart |
| `SHOPIFY_APP_CLIENT_SECRET`, `SHOPIFY_ADMIN_API_ACCESS_TOKEN` | The Dev Dashboard app (custom distribution) on the client's store | Authorization-code grant on the client's store (V-20 `UNVERIFIED`). Check with a dry run of the import tool (read-only) |
| `SHOPIFY_APP_CLIENT_SECRET` | The webhook signing secret (source `UNVERIFIED`, V-12) | While old and new differ, signatures fail and events are rejected; Shopify retries. Do it at a quiet time. Check with a test order or a resent webhook on staging |
| `EXTEND_ACCESS_TOKEN` (and the Merchant Portal Client ID and Secret) | Extend Merchant Portal API Integration (an Admin or API Manager creates it). Demo and production are separate. | Rotation steps are not documented by Extend `UNVERIFIED`. The Client ID and Secret are exchanged at `/auth/oauth/token` for an access token. Check with an offers call against the correct host |
| `JUDGEME_PRIVATE_API_TOKEN` | Judge.me dashboard `UNVERIFIED` | Check that reviews load |
| `PUBLIC_*` identifiers | Not secrets. Change only if the provider requires it | Check the feature |
| Deploy credentials | None exist yet. `ci.yml` uses no secrets. | `PLANNED` (P9-01) |

### 5.4 Before transfer

The repository history is scanned for secrets before it moves to the client's account (REQ-HAND-001). The scan tool and CI step are `PLANNED`; `ci.yml` does not contain a secret-scan step today (conflict C4).

---

## 6. Add a store

"Store" can mean two things. Both are covered.

### 6.1 Add a retail store (a location)

Content-only. **No deploy is needed** (NFR-005), apart from the cache delay (ADMIN_GUIDE section 10.2).

1. In Shopify admin, create the Shopify location and put stock at it. `UNVERIFIED` (no dev store yet; screens not seen)
2. Turn on local pickup for it and set the "ready for pickup" email. `UNVERIFIED`
3. Create a `store` metaobject entry: name, slug, address lines, city, state, postal code, latitude, longitude, phone, hours, photo, `pickup_enabled`, and `location_handle` matching the Shopify location.
4. For many stores, the importer `scripts/catalog/import-stores.mjs` is `PLANNED` (P3A-07). It does not exist yet. The hours JSON shape is fixed in P3B with the locator.
5. Verify: the store page, the city and state pages, tap-to-call, directions link, pickup availability for a size with known stock, valid `LocalBusiness` JSON-LD (REQ-LOC-001, REQ-PDP-003).

### 6.2 Point the tooling and the storefront at another Shopify store

Use this for a new development store, a staging copy or the client's store.

1. **Plan check.** Development stores are not plan-gated (V-26). A feature that works there is not proof it works on Basic. Check plan-dependent features against Shopify's documentation and, before go-live, read-only on the client's store or a paid Basic trial.
2. **Access.** Collaborator access through the Partner Dashboard (SD-10, V-21 `UNVERIFIED`). Create the Hydrogen or Headless channel storefront; collect the tokens and Customer Account API settings (section 2).
3. **Admin API access.** Create a Dev Dashboard app with custom distribution and least-privilege scopes. The documents name `read_orders` (guest order lookup; `read_all_orders` only if a longer window is approved), `write_publications` (import publish), and read and write access to metaobject definitions. The product-write scopes the importer needs belong in `scripts/catalog/README.md`. Obtain the token with the authorization-code grant (`UNVERIFIED`, V-20).
4. **Allow-list.** Set, in the shell session and never in a file in the repository:

   ```bash
   export SHOPIFY_ALLOWED_STORES="my-dev-store.myshopify.com"
   export SHOPIFY_STORE_DOMAIN="my-dev-store.myshopify.com"
   # SHOPIFY_ADMIN_API_ACCESS_TOKEN: set from your secret manager; never type it into a command or file
   ```

5. **Apply the definitions** (metaobjects and metafields). Creates only what is missing; any difference is reported, never changed silently. Dry run is the default.

   ```bash
   node scripts/shopify/apply-definitions.mjs --offline                       # plan only, no network
   node scripts/shopify/apply-definitions.mjs --store my-dev-store.myshopify.com          # dry run, reads the store
   node scripts/shopify/apply-definitions.mjs --store my-dev-store.myshopify.com --live   # creates missing definitions
   ```

   The definitions in `scripts/shopify/definitions.json` are checked against the documentation but **not yet against a development store** (V-05).
6. **Manual steps the Admin API cannot do or that are not scripted:** Search & Discovery filter configuration (V-04); Storefront API access for the metaobjects (V-05); sales-channel publication; Local delivery and the postal-code list; pickup locations; the Flow rule (V-17); automatic discounts; checkout and accounts branding; the webhook subscription (V-12).
7. **Load data:** import the catalog (section 7). Brands must exist before products so the brand link resolves (the importer warns otherwise).
8. **Check parity** between the metaobject zone list and Local delivery: `scripts/shopify/check-delivery-parity.mjs` is `PLANNED` (P5B-02).
9. Update the access inventory (H-06).

---

## 7. Refresh the product catalog

Read [scripts/catalog/README.md](../../scripts/catalog/README.md) first (written by another team member; not present when this draft was written). This section records what the tool's own usage text and code state.

**What it does.** `import.mjs` compares the product sheet (CSV) with the store and makes the store match. It is idempotent (handle and SKU are the keys), validates before writing, and defaults to a dry run. It uses `productSet` per product.

**Safety guards.** Any contact with a store needs the domain in `SHOPIFY_ALLOWED_STORES`. Writes also need `--live`. The token comes from the environment only. A sheet over 5 MB is refused. If the sheet has validation errors, **nothing** is imported.

### 7.1 Commands (from the tool's usage text)

```bash
# 1. Validate the sheet (no store needed)
node scripts/catalog/validate.mjs sheet.csv --images ./images --report validation.md --strict

# 2. Plan against an empty store (no network, no credentials)
node scripts/catalog/import.mjs sheet.csv --offline

# 3. Dry run: reads the store, prints the plan, writes nothing
node scripts/catalog/import.mjs sheet.csv --images ./images

# 4. Live run, limited to a few products first
node scripts/catalog/import.mjs sheet.csv --images ./images --only handle-one,handle-two --live

# 5. Live run, everything
node scripts/catalog/import.mjs sheet.csv --images ./images --live
```

| Flag | Use |
|---|---|
| `--offline` | Plan against an empty store; no network |
| `--images <folder>` | Folder with the image files named in the sheet |
| `--store <domain>` | `<name>.myshopify.com` (default: `SHOPIFY_STORE_DOMAIN`) |
| `--publication <gid>` | Publish ACTIVE products to this publication (needs `write_publications`) |
| `--only <h1,h2>` | Only these handles |
| `--allow-removals` | Allow deleting sizes and images that are in Shopify but not in the sheet. Off by default |
| `--manifest-dir <dir>` | Where run manifests go (default `scripts/catalog/.runs`) |
| `--json` | Print the plan as JSON |
| `--live` | **Write to the store** |

Exit codes: 0 ok; 1 errors or blocked items; 2 usage or file problem; 3 refused by a guard.

### 7.2 Steps

1. Apply the definitions (6.2, step 5) and import the brands first.
2. Validate the sheet. Fix errors.
3. Dry run. Review the plan table: `CREATE`, `UPDATE`, `UNCHANGED`, `BLOCKED` and the notes. A SKU that belongs to a different product is `BLOCKED`.
4. Run live with `--only` for one or two handles. Check them in admin.
5. Run live for the rest. Per-product failures are recorded and the run continues; credential or store errors stop it.
6. Re-run after fixing failures; unchanged products are skipped.
7. After import: configure filters in Search & Discovery (manual, V-04), check collection rules (P3A-08), spot-check products field by field (P3A-11), and allow the cache delay.

### 7.3 Run manifests (and a gap)

Each live run writes a JSON manifest with the run ID, store, sheet checksum, products created, products updated (with their previous values), failures and skips. The default folder `scripts/catalog/.runs` is **not covered by `.gitignore`** (conflict C3). Use `--manifest-dir` outside the repository, or have the owner approve a `.gitignore` entry, so manifests are never committed.

### 7.4 Reverting a run

The manifest's `before` values let a person restore updated products by hand. Created products have no previous state. **No automated revert is documented** in the files reviewed; check the README before promising one.

### 7.5 Limits

Sequential, throttled calls (about 400 products times 3 calls); bulk operations are noted as a future optimization. Admin API limit: 100 points per second. 400 products maximum under the SOW. The client-side clean run (H-02, REQ-HAND-002) is the acceptance evidence.

---

## 8. Investigate a flagged haul-away order

**State.** The detective control is `UNVERIFIED` (V-17) and `PLANNED` (P5B-05). It is either a Shopify Flow rule on *Order created*, or a webhook check (`app/lib/orders/haul-away-check.ts`, which does not exist yet). The replacement for the SOW's in-checkout Function is not yet acknowledged by the client (SD-01, CR-08). Use order IDs only in tickets, no customer details.

**What the preventive layers do** (`storefront/app/lib/offers/haul-away.ts`)

- Haul-away is eligible only when: a usable rule exists with a maximum of at least 1; the shopper chose `in-home`; the zone loaded; and the ZIP is valid and inside the zone. Ineligible reasons: `not-configured`, `delivery-not-chosen`, `pickup-selected`, `zone-unavailable`, `zip-missing`, `zip-invalid`, `outside-zone`.
- Quantity is clamped to 0 to the maximum, with anything non-numeric read as 0.
- Revalidation before checkout reduces or removes over-limit lines (`haul-away-over-max`), removes lines when the offer is switched off (`haul-away-disabled`), and reports a `haul-away-not-eligible` violation for a line the shopper is not entitled to.

**Steps**

1. Get the order number from the Flow email or the order tag.
2. In Shopify admin (read-only), note: the quantity of the "Recycle and disposal service" line, the delivery method, and the order attributes `delivery_choice` and `offer_declined_haul_away`.
3. Compare with the current maximum in `site_settings.haul_away_max` **and** with the number set by hand in the Flow condition. If they differ, the flag may be a false positive (stale Flow number). Which of `site_settings.haul_away_max` and the `offer_rule` field `max_quantity` is authoritative is open (conflict C5).
4. Classify:

   | Finding | Meaning | Next |
   |---|---|---|
   | Quantity above the maximum, cart built by our site | A defect in the preventive layers | Reproduce on staging; write a failing test; fix; this is a Major |
   | Quantity above the maximum, no sign of our flow | A cart built directly through the public Storefront API | Expected residual risk (SD-01). Staff handle the order |
   | Haul-away on a pickup or parcel order | The shopper changed the delivery method inside checkout | Expected residual risk. Staff handle the order |
   | ZIP in or out of the zone does not match checkout | The two ZIP lists differ | Run the parity check `PLANNED` (P5B-02); fix both lists |
   | Flow number stale | Maximum changed in one place only | Fix the Flow condition; record |

5. Staff handle the order under the client's policy (ADMIN_GUIDE section 4.6).
6. If flags are frequent, consider the optional App Store quantity-limit app (CR-13, V-18 unverified on Basic with Storefront API carts), host-level rate limits, or a review of the public token's exposure.
7. If Flow turns out unable to test a line-item quantity or send an internal email (V-17), switch to the webhook check, or fall back to a reconciliation report staff run (REQ-PROMO-003).

---

## 9. Upgrade Hydrogen

**Pins today.** Hydrogen 2026.4.7, react-router and its dev packages 7.16.0 (exact), Vite 8, React 18, TypeScript 5.9, Storefront API of the template. ADR-0008 (status: Proposed, owner to confirm) holds them. `npm audit` reported 7 findings; the runtime-relevant ones are in react-router below 7.18 (a high-severity unauthenticated denial of service in route matching, plus moderate issues). Hydrogen 2026.4.7 declares peers `react-router ~7.16.0`, so forcing 7.18.4 needs `--legacy-peer-deps` or `--force`, which hides future conflicts: **do not do that**. P1-12 (the 2026.10 migration) is BLOCKED; the 2026.10 template on GitHub `main` is a different, unreleased architecture (F-44).

Hydrogen is calendar-versioned and released about quarterly. Reassess monthly (ADR-0008). After handover, upgrades are the client's or a maintenance agreement's (EXC-13).

### 9.1 Procedure

1. **Check what is on offer.** Has `npm create @shopify/hydrogen` delivered the target template? Does `shopify hydrogen upgrade` list a newer version? (In the 2026-10-12 trial it reported "latest is 2026.4.7".) Read ADR-0008 for the current decision.
2. **Clean git state.** `shopify hydrogen upgrade` **refuses to run on a repository that is not clean** (ADR-0008 trial). Run `git status`; get the owner's go-ahead to commit or stash your work (commits happen only when the owner asks). Create a branch such as `chore/hydrogen-<version>`. Never upgrade on `main`.
3. **Baseline.** On the current pins, `npm run check` and `npm run e2e` are green. Record the output of `npm audit --omit=dev`.
4. **Read the target's release notes** for breaking changes. For 2026.10.0 the trial found: `@shopify/hydrogen/vite` no longer exports `hydrogen`, so the template's `vite.config.ts` breaks `typecheck` and `build`; the Storefront API moves to 2026-10; analytics and cart APIs are removed or renamed.
5. **Upgrade** from `storefront/` with `shopify hydrogen upgrade` (the trial used `--version 2026.10.0`). If the tool does not support it, scaffold the new template into a **scratch folder outside `storefront/`** and port our code. Port the platform seams first (`server.ts`, `app/lib/context.ts`, `vite.config.ts`; ADR-0004).
6. **Dependencies.** Keep framework pins exact. No `--force` or `--legacy-peer-deps`. If a peer conflict appears, stop and record it. A dependency or framework change needs its own commit, a compatibility check and an ADR (`.claude/rules/git-practices.md`). The lockfile is never edited by hand.
7. **Regenerate and fix.** `npm run codegen`, then `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
8. **Option B only:** re-run the plain-Node spike (`scripts/spikes/option-b-node-server.mjs`) and re-check the `react-dom/server` alias (change 2 in 3.3); React 19 may not need it.
9. **Full verification:** `E2E_ALL_BROWSERS=1 npm run e2e`; manual smoke on staging; accessibility and performance baselines; `npm audit --omit=dev` must show no high or critical runtime finding (ADR-0008 verification).
10. **Review and record:** independent code review; security review; update ADR-0002 (pins), ADR-0008 (status) and `progress/DECISIONS.md` with one line; update `.env.example` and section 2 if variable names changed.
11. **Release** through staging first, with the rollback target ready (3.1).

---

## 10. Open items and document conflicts

### 10.1 Not implemented yet

| Item | Task |
|---|---|
| Staging pipeline and server | P1-07 (blocked) |
| Hydrogen 2026.10 migration | P1-12 (blocked) |
| Connect to a dev store; document env vars | P3A-01 |
| Store importer | P3A-07 (`scripts/catalog/import-stores.mjs`) |
| Delivery parity script | P5B-02 (`scripts/shopify/check-delivery-parity.mjs`) |
| Haul-away detective control | P5B-05 |
| Webhook route | P5A-08 (`app/routes/webhooks.shopify.tsx`) |
| Reconciliation script and failure logging | P5A-10 (`scripts/reconcile-extend.mjs`) |
| Extend demo-host run and Extend's review | P5A-12 |
| Hosting implementation, secrets, DNS, cutover and rollback runbook | P9-01 to P9-04 |
| Production Node entry for Option B | P9-01 |
| Secret scan in CI and history scan before transfer | P9-07 (REQ-HAND-001) |

### 10.2 Conflicts between documents (to reconcile)

| # | Conflict |
|---|---|
| C1 | `DEPLOYMENT.md` lists `SHOP_ID` as public; `.env.example` has no `PUBLIC_` prefix and says only `PUBLIC_` names are browser-exposed. Decide the exposure and fix one of them. |
| C2 | The scripts read `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ALLOWED_STORES` and `SHOPIFY_ADMIN_API_VERSION`; none is in `DEPLOYMENT.md` or `.env.example`. |
| C3 | `scripts/catalog/.runs` (the default manifest folder) is not in `.gitignore`. |
| C4 | `DEPLOYMENT.md` and P1-06 name a secret scan in the pipeline; `.github/workflows/ci.yml` has none. |
| C5 | The haul-away maximum appears as `site_settings.haul_away_max` (data model, workaround notes) and as `offer_rule.max_quantity` with type `haul_away` (`definitions.json`). |
| C6 | The runbook is planned at `docs/deployment/RUNBOOK.md` (P9-04) but H-07 expects runbooks under `docs/handover/`. This file is the maintenance set; decide where the cutover runbook lives. |
| C7 | `.env.example` calls the Admin credential a "custom app"; `DEPLOYMENT.md` and V-20 say legacy custom apps cannot be created and a Dev Dashboard app is needed. |

### 10.3 What could not be verified, and who can

| Item | Who |
|---|---|
| Every command in sections 1, 6, 7 on a clean checkout and a dev store | `devops-engineer` / `qa-engineer` |
| `npx playwright install chromium` locally | `devops-engineer` |
| Oxygen deploy commands and secrets screens | `devops-engineer` (P9-01) |
| Flow capability, webhook retries, webhook secret source, token regeneration | `integration-engineer` (V-12, V-17, V-20) |
| Extend rotation, read-back, headless approval | Extend, through `integration-engineer` (Q-005, V-11) |
| Effect of rotating `SESSION_SECRET` on carts and sign-in | `qa-engineer` on staging |
