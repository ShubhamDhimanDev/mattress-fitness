# Domain, DNS plan and cutover (go-live runbook)

Tasks P9-03 (domain and DNS plan) and P9-04 (cutover and rollback runbook); requirements REQ-HOST-003, REQ-HOST-004. **Draft 1, dated 2026-10-26.** It builds on [VPS_RUNBOOK](VPS_RUNBOOK.md) (server, nginx, systemd, certbot, smoke test, rollback), [DEPLOYMENT](DEPLOYMENT.md) (variables, readiness checklist) and the [deployment-readiness skill](../../.claude/skills/deployment-readiness/SKILL.md) (the go or no-go list in section 5).

**Status: a plan and a template. Nothing here has been run.** No domain, DNS host, VPS, certificate or staging site exists in our hands (B-06, B-07; CLR-003, CLR-004). The VPS runbook it depends on was itself never run on Linux. Every `<PLACEHOLDER>` is an input we do not have. Tags: `[client input needed]`, `[assumed]` (a standard practice or our guess, to be confirmed), `UNVERIFIED` (a provider behaviour not seen). **Nothing here deploys anything; every production change needs the recorded approvals in section 4.** The hosting is the owner's interim answer (DEC-079); if the client chooses Oxygen or another host, sections 3 (certificates), 7 (steps) and 8 (rollback) change and the rest stays.

## 1. Inputs we must have before this plan can be fixed

| # | Input | Why | From |
|---|---|---|---|
| I-1 | The production domain name, and whether the shop answers on the bare name (`example.com`), on `www`, or both | DNS records, certificate names, `PUBLIC_SITE_URL` | Client `[client input needed]` (CLR-004) |
| I-2 | Who controls the registrar and the DNS host, and their logins (see [ACCESS_INVENTORY](../handover/ACCESS_INVENTORY.md) H-05, H-06) | We cannot change records without them | Client `[client input needed]` |
| I-3 | Does the client already have a live website on this name or another? Which URLs have search ranking or inbound links? | Redirect table (section 3). If there is no old site, section 3 is "not applicable" | Client `[client input needed]`. Not asked yet |
| I-4 | Where does the domain's e-mail live (MX, SPF, DKIM records)? | We must not break it when changing DNS | Client `[client input needed]` |
| I-5 | The VPS public IPv4 (and IPv6 if used) | A and AAAA records | Owner, once the VPS exists (B-07) |
| I-6 | Hosting confirmed by the client | Q-003, B-06 | Client |
| I-7 | Named decision-maker, launch date and window; named launch-day engineer and channel | Approvals, REQ-HAND-005 | Client (Q-013), owner |
| I-8 | Shopify checkout domain choice: leave checkout on the store's Shopify checkout domain (current design, `PUBLIC_CHECKOUT_DOMAIN`), or set a branded checkout subdomain | The cart hands off to this domain; changing it changes CSP and links | Client and owner. Default assumed: unchanged `[assumed]` |

## 2. Domain and DNS plan (template)

Fill in the table at plan time; keep a dated copy of the **old** values before any change (section 7, step 3).

| Name | Type | Value | TTL now (record) | TTL before cutover | TTL after | Notes |
|---|---|---|---|---|---|---|
| `<DOMAIN>` | A | `<VPS_IPV4>` | `<old>` | 300 s | restore to 3600 s after the stable window `[assumed]` | The shop. Today it points at `<old target>` `[client input needed]` |
| `<DOMAIN>` | AAAA | `<VPS_IPV6>` | n/a | 300 s | as above | Only if the VPS serves IPv6 and nginx listens on it. Otherwise **no AAAA record**, or browsers using IPv6 reach nothing |
| `www.<DOMAIN>` | CNAME to `<DOMAIN>`, or A/AAAA as above | | | 300 s | | Only if I-1 says `www` is used |
| `staging.<STAGING_DOMAIN>` | A | staging host | | | | The rehearsal and fallback name (section 6). Not indexed (robots and auth, phase 8 security) |
| MX, TXT (SPF, DKIM, DMARC), other records | unchanged | | | | | **Do not edit.** Copy and keep unchanged |
| `_acme-challenge.<DOMAIN>` | TXT | set by hand during certificate issuance | 300 s | | removed after | Section 3, option 2 |

**Gaps in the current nginx template that this plan depends on** (`deploy/nginx.conf.example`, `[verified]` by reading, never run): it answers only the one `<YOUR_DOMAIN>` and sends any other name to `return 444`. If the shop must also answer on `www`, add the name to `server_name` **and** a redirect from one name to the other (one canonical name), and the certificate must cover both. Both are edits to a template that has never passed `nginx -t`.

**TTL rule.** Lower the TTL on every record that will change **at least 48 hours before cutover** (longer than the old TTL; for example if the old TTL is 24 hours, lower it at least 24 hours ahead, preferably 48 hours) so the whole internet has the short value when the change is made `[assumed, standard DNS practice]`. Keep it short until the stable window passes (section 9). A low TTL makes DNS rollback take minutes instead of the old TTL.

**Provider-side domain settings to change with the switch** (each is a task in section 7): `PUBLIC_SITE_URL` in the server env file; the Customer Account API callback and logout URLs in Shopify admin (V-08 `UNVERIFIED`, not seen on a store); the webhook subscription address `https://<DOMAIN>/webhooks/shopify` (V-12, V-20 `UNVERIFIED`); GA4 data stream URL and Meta pixel domain/verification (client accounts, only if ids are set); Klaviyo list/form domain allow-lists if any `UNVERIFIED`; the privacy policy page text; the client submits the new sitemap (`https://<DOMAIN>/sitemap.xml`) in Google Search Console (client account `[client input needed]`).

## 3. Certificates (TLS)

The VPS runbook issues the certificate with certbot's webroot method (`VPS_RUNBOOK` section 8, step 4), which needs the domain to **already point at the VPS**. That creates a chicken-and-egg problem for a clean cutover: you cannot get the certificate until traffic goes to the VPS, and you do not want shoppers there without it.

| Option | How | Cost and risk |
|---|---|---|
| 1. Issue during cutover | Point DNS at the VPS, nginx serves the HTTP challenge block, certbot issues, then HTTPS block is enabled (the runbook's order) | Minutes of http-only or error pages for shoppers reaching the new IP. Not acceptable for a sales site unless done at a very quiet time. Old site is unavailable on that name during the window |
| 2. Issue before cutover with the DNS challenge (recommended) `[assumed]` | `sudo certbot certonly --manual --preferred-challenges dns -d <DOMAIN>` and create the TXT record by hand at the DNS host; then install the certificate files in nginx and test with `curl --resolve <DOMAIN>:443:<VPS_IPV4> https://<DOMAIN>/` before any DNS change | Needs DNS access ahead of time. A manual DNS challenge does not renew by itself: **after cutover, switch the certificate to the webroot method** (reissue with `certbot certonly --webroot ...`, then check `sudo certbot renew --dry-run` and the `certbot.timer`). The exact certbot behaviour on switching methods is `UNVERIFIED`: rehearse on the staging name first |
| 3. Provider certificate | If the client chooses a host that terminates TLS (Oxygen or a CDN), none of this applies | Changes the plan |

Whatever option: the certificate must cover every name in section 2; HSTS starts at `max-age=15552000`, no `includeSubDomains`, no `preload` ([SECURITY_HEADERS](../security/SECURITY_HEADERS.md)); alert on expiry 21 days ahead (VPS_RUNBOOK section 9); record the issue date and the renewal proof in the inventory (H-07).

## 4. Explicit approvals needed (nothing proceeds without all of them)

| # | Approval | Who | Recorded in | Status |
|---|---|---|---|---|
| AP-1 | Go decision after acceptance: Phase 8 exit, zero open Blockers, Majors fixed or deferred in writing (REQ-ACPT-003) | Client decision-maker and project owner | `progress/DECISIONS.md` (P8-09 record) | Not given |
| AP-2 | The specific release: tag and commit hash, built artefact | Project owner and client decision-maker | DECISIONS | Not given |
| AP-3 | DNS change: records, TTLs, redirect table, window | Client (they hold the registrar) and owner | DECISIONS | Not given |
| AP-4 | The one **live test order** (section 11): written authorisation, named observer, refund plan, which payment type | Client decision-maker (account owner) | DECISIONS and a dated written message (kept, no card data) | Not given |
| AP-5 | Owner's written acceptances that gate launch: ADR-0006 detective-only limit (B-18), haul-away ZIP residual risk (B-17), host limits (B-19), ADR-0008 and the react-router route (B-12), the CSP wildcards and the other items of B-32 and B-33 if analytics is switched on | Project owner | DECISIONS | None given |
| AP-6 | Client acknowledgement of the deviated SOW items SD-01 to SD-05, SD-07, SD-11 (B-11): a deviated item is not described as delivered until acknowledged | Client | DECISIONS and release notes | Not given |
| AP-7 | Provider-dependent features: Extend (approved account, Extend's written answers), Affirm, Shopify Payments, PayPal, Klaviyo double opt-in gate (SU-M1) | Providers, client | Release notes ("not live, because...") | None approved; features stay off and are listed as not live (SOW section 13) |
| AP-8 | Security and readiness sign-off (devops, security-engineer); QA sign-off of launch verification | Those agents' reports, owner | DECISIONS | Not given |

Production deployment is **never automatic** and never from a feature branch; releases are tagged from `main` (git-practices). The owner performs `git push`.

## 5. Go or no-go checklist (from the deployment-readiness skill)

Run the skill read-only at Phase 8 exit and again the day before cutover. Verdict: `GO`, `GO WITH CONDITIONS` (each with an owner) or `NO-GO`. Tick a line only with evidence.

| # | Check | Evidence to attach | State at 2026-10-26 |
|---|---|---|---|
| 1 | Release candidate: exact commit and tag; the artefact built by `npm run build` on that tag is what is deployed. **No CI exists (DEC-080)**, so local `npm run check` output is the evidence | Tag, commit, `RELEASE.txt`, check output in `progress/TEST_RESULTS.md` | Not started |
| 2 | Gates G1 to G8 passed; every in-scope requirement `PASSING` or with a signed deferral; zero open Blockers; browser and device matrix run recorded | TRACEABILITY, defect log, [RELEASE_TEST_PLAN](../testing/RELEASE_TEST_PLAN.md) | **NO-GO today**: 0 requirements `PASSING`, no gate passed (STATUS) |
| 3 | Security: latest review has no unresolved High; `npm audit` and secret scan clean or accepted in writing; CSP and headers behind the real host; history scanned before repository transfer | Review documents, audit output, scan output | **NO-GO today**: B-12 (react-router advisories, high), B-19, A-M1, SU-M1 |
| 4 | Environment and secrets: production variables per the inventory; none reused from staging; webhook secret and endpoint set | [ACCESS_INVENTORY](../handover/ACCESS_INVENTORY.md), DEPLOYMENT "Production readiness" list (no values) | Not started |
| 5 | Providers: Shopify channel and tokens for the client's store; Extend production credentials and approval; payments activated; analytics ids; unapproved features listed as not live | Provider confirmations; release notes | Extend on mock only (B-03); payments not activated (CLR-007) |
| 6 | Hosting: hardening, TLS with renewal, process manager, monitoring and an alert **test**, backups documented | VPS_RUNBOOK checklists with dates and names | **Never run** (VPS_RUNBOOK section 13) |
| 7 | Cutover and rollback: this document exists; **rollback rehearsed on staging within the last release cycle**; triggers and owners named; TTL lowered in advance; old site retained | Rehearsal record | Not rehearsed; no staging (B-07) |
| 8 | Verification plan: read-only smoke checks defined (section 10); the single live test order, observer and refund plan agreed in writing (AP-4) | Written authorisation | Drafted here only |
| 9 | Approvals and people: AP-1 to AP-8; launch-day support named | DECISIONS | None |
| 10 | Verdict recorded, with failing items and evidence links | `progress/DECISIONS.md` | The current honest verdict is **NO-GO** |

## 6. Rehearsal (required before the real cutover)

On a **staging name** with the same server layout (a second small VPS, or a second hostname on the same VPS, as VPS_RUNBOOK section 13 suggests), run the whole of sections 7 and 8 including:

1. certificate issuance and the switch to automatic renewal (section 3, option 2);
2. deploy release A, deploy release B, roll back to A, roll forward (VPS_RUNBOOK section 11), timing each restart and recording what shoppers see (nginx 503 page) meanwhile;
3. the full smoke test (section 10) and the nginx pre-launch security checklist (VPS_RUNBOOK section 8, items 1 to 9);
4. an alert test: stop the service and confirm someone is told (nothing is wired today);
5. a DNS rollback drill on the staging name: change the record, wait the TTL, change it back.

Record dates, names and results in `progress/TEST_RESULTS.md`. A rollback is not proven until this is done.

## 7. Cutover steps (production)

Window: `<DATE and TIME, low-traffic>` `[client input needed]`. People present: owner (deploys), client decision-maker (approves each step), launch-day engineer, observer for the test order. Channel: `<named channel>`.

**T-14 days to T-3 days (preparation)**

1. Confirm AP-1 to AP-8 are on record or listed as conditions with owners.
2. Lower the TTL on records that will change (section 2). Note the date and the old TTL.
3. Copy the **current DNS zone** (screenshot or export, no secrets) and the current Shopify domain settings, and keep them with the release record. This is the DNS rollback source.
4. Prepare the redirect table (section 8) and load it. Prepare the production env file values in the password manager; generate **new** `SESSION_SECRET` and `DELIVERY_COOKIE_SECRET` (never copied from staging).
5. Build and assemble the release on the server (VPS_RUNBOOK section 6) **without switching `current`** if the old release is already serving, or start it on port 3001 as the candidate and run the candidate check.
6. Issue the certificate (section 3) and prove HTTPS with `--resolve` before any DNS change.
7. Freeze: no catalog bulk change and no code change from here (hotfixes need owner approval).

**T-1 day**

8. Re-run the go or no-go (section 5). Decide `GO`, `GO WITH CONDITIONS` or `NO-GO` and record it.
9. Confirm the TTL has dropped (query the record from two public resolvers).
10. Confirm the old site (staging name or current site) is untouched and reachable.

**T-0 (cutover)**

11. **Pre-flight (abort here costs nothing):** from your machine run the smoke test (section 10) against `https://<DOMAIN>/` forced to the VPS with `curl --resolve <DOMAIN>:443:<VPS_IPV4> ...`. Any failure is an **abort**.
12. Set `PUBLIC_SITE_URL=https://<DOMAIN>` in `/etc/mattressfitness/env`, `sudo systemctl restart mattressfitness`, check `journalctl` for `node_server.listening` and none of `config.secret_unusable`, `offers.config_problem`, `request.unhandled`.
13. Update the Shopify side that names the domain: Customer Account API callback and logout URLs (S-06 in the inventory), and the `/webhooks/shopify` subscription address (S-11). Not yet tried; screen paths `UNVERIFIED`.
14. **Change the DNS records** (A, and AAAA if used) to the VPS. This is the **point of no return for the TTL window**: shoppers move over as their resolvers refresh. Rolling back is still possible (section 9) but is again a DNS change that takes the TTL to spread.
15. Watch: nginx access log (no query strings or cookies are logged), `journalctl -u mattressfitness -f`, the error log for `limiting requests` lines. Run the smoke test again against the public name (no `--resolve`).
16. Run the launch verification in sections 10 and 11. Declare the cutover complete only when it passes.

**Abort rule.** Before step 14: stop, change nothing in DNS, record why. After step 14: use section 9 if a trigger fires.

## 8. Redirects from old URLs

Applies only if I-3 says an old site exists. If the client has no old site, record "no old URLs" and delete this section from the final version.

| Old URL (path) | New URL | Type | Where implemented | Checked |
|---|---|---|---|---|
| `<old path>` | `<new path>` | 301 | Shopify URL redirects (below) | `[to fill]` |

Mechanisms, in order of preference:

1. **Shopify URL redirects** (Online Store > Navigation > URL redirects; also import by CSV) `[assumed menu path, verify on the dev store]`. The storefront's `server.ts` calls Hydrogen's `storefrontRedirect` on a not-found response, which looks the path up in Shopify's redirects `[verified]` by reading; **behaviour against a real store is `UNVERIFIED`** (not seen). The client's team can then maintain redirects without a deploy.
2. nginx `return 301` rules for bulk patterns (for example a whole old folder), added to `deploy/nginx.conf.example` copy and tested with `nginx -t`. Needs the owner; every edit is a reload with approval.

Rules: one hop only (no chains); redirect to the closest equivalent page, not the home page; keep `www`/bare redirect to one canonical name; product handles in the sheet are permanent keys, so sheet-driven products keep stable URLs. Test every row with `curl -sI` and record the status and `Location`. Old product or collection URLs with no equivalent: list them; the client decides (a 404 that shows search and navigation is acceptable `[assumed]`).

Also check after cutover that `robots.txt` and `/sitemap.xml` answer 200, that canonical links use the production name (`PUBLIC_SITE_URL`), and that staging remains `noindex`.

## 9. Rollback

**Triggers** (proposed numbers are `[assumed]`; the client decision-maker and owner confirm them before launch):

| Trigger | Threshold |
|---|---|
| Checkout hand-off fails (the cart's checkout link does not reach the store's checkout) | any occurrence confirmed twice |
| Shoppers cannot add to cart or the site returns 5xx | sustained more than 5 minutes |
| Order sync or the webhook check failing | only if Extend sync is live: more than 60 minutes. Otherwise log and fix forward |
| TLS error for shoppers | any |
| A security issue is reported (leaked secret, open redirect, data exposure) | any: roll back or take the site down first |
| Smoke test fails after cutover | any step in section 10 marked a launch blocker |

**Rollback ladder (try the smallest first):**

1. **Config-only** (edit `/etc/mattressfitness/env`, `sudo systemctl restart mattressfitness`): `PUBLIC_EXTEND_ENABLED=false`; clear `PUBLIC_GIFT_PICKER_ENABLED`; unset an analytics id; `OFFERS_ENABLED=false` only on purpose (it removes all offers). Or deactivate a discount in Shopify admin.
2. **Release rollback** (VPS_RUNBOOK section 11): move `current` to `previous`, restart, healthz, smoke test. Not rehearsed.
3. **DNS rollback:** restore the records saved at step 3 of section 7. With the short TTL set in advance this takes about the TTL (5 minutes) `[assumed]`; shoppers on resolvers that ignore TTLs may take longer. The old site must still be running (it is retained, section 7 step 10). If the Shopify callback and webhook addresses were changed in step 13, change them back.
4. **Take-down page:** if neither works, serve a maintenance answer from nginx (not prepared; write it during rehearsal).

After any rollback: run the smoke test, record the trigger, time and decision in `progress/DECISIONS.md`, and do not retry until the cause is fixed and the release is re-approved (AP-2).

**Orders are never lost by a storefront rollback:** carts and orders live in Shopify (NFR-006). A shopper in the middle of checkout continues on Shopify's checkout domain.

## 10. Launch-day smoke checks (read-only)

None of these places an order. Run from your own machine after step 15. Use the full list and expected results in [VPS_RUNBOOK](VPS_RUNBOOK.md) section 12 (items 1 to 13); the summary and the launch-blocker flag:

| # | Check | Launch blocker? |
|---|---|---|
| 1 | `http://<DOMAIN>/` returns 301 to https; `https` returns 200 over HTTP/2; gzip on | yes |
| 2 | Valid certificate for every served name (`curl -vI`, or a TLS checker); expiry date and renewal timer recorded | yes |
| 3 | Pages return 200: `/`, a collection, a product, `/cart`, `/search?q=bed`, `/quiz`, `/compare`, `/robots.txt`, `/sitemap.xml` | yes |
| 4 | Security headers present once each on pages, an asset, a 404 and the redirect; `Cache-Control: private, no-cache` and `Vary: Cookie` on the home document | yes |
| 5 | Add an item by `/cart/<variant-id>:1`; the `cart` cookie has `Secure; HttpOnly; SameSite=Lax` | yes |
| 6 | Checkout hand-off: the cart's checkout link reaches the store's checkout domain (do not pay) | yes |
| 7 | Webhook rejects an unsigned call (not 200) | yes |
| 8 | Customer account sign-in reaches Shopify and returns to `https://<DOMAIN>/account` (create no real customer data; use a synthetic test account) | yes if accounts are offered |
| 9 | Delivery ZIP: save an in-zone ZIP and an out-of-zone ZIP, reload; header and product page promise match | yes |
| 10 | Redirect table spot check (section 8) | yes for top URLs |
| 11 | Logs: `node_server.listening`; none of `config.secret_unusable`, `offers.config_problem`, `request.unhandled`, `render.failed`, `node_server.client_ip_header_warning` | yes |
| 12 | Analytics (only if ids set): consent banner appears, nothing loads before consent; GA4 DebugView shows events after consent | no; switch the id off if wrong |
| 13 | Extend, Klaviyo signup, chat: confirm each is **off** unless its gates are passed, and that the release notes say "not live" | yes |
| 14 | Rate limits and the 413 and 429 checks (VPS_RUNBOOK section 12 step 10) | run only with the owner's authorisation; they send traffic |
| 15 | Monitoring: external uptime check configured, an alert received from a test | recommended; nothing wired today |

Record the date, tester and result of every line in `progress/TEST_RESULTS.md`.

## 11. The single authorised live test order

Purpose: prove the real checkout, payment and refund path once, with the real payment setup (REQ-ACPT-002 covers the full matrix in test or development mode earlier; this is the live proof, P9-06). Not part of the matrix and **not the only test order**.

**Pre-conditions (all in writing, AP-4):**

- The client decision-maker authorises it, names who pays (a card the client controls) and who refunds.
- A named observer watches it and signs the record.
- The product is chosen by the client: one low-price in-stock parcel item `[client input needed]`; no haul-away, no Extend protection, no discount stacking, pickup or parcel only. White-glove delivery is not used on the live order because it would create a delivery job.
- A refund plan: cancel and fully refund the order in Shopify admin within the same day. **Whether the payment processor returns its fee on a refunded order varies by provider and is not documented here**; the client accepts a possible small loss `[assumed]`.
- Customer notification e-mails: use the client's own e-mail address as the customer.

**Procedure**

1. Placed by the observer-approved person, on the production domain, through the normal flow: product, cart, checkout (Shopify's hosted page), pay.
2. Record: order ID (not the card details), time, delivery method, lines, payment type. No screenshot may show card numbers or customer addresses beyond synthetic data; redact.
3. Check in Shopify admin that the order carries the expected attributes, and in the server journal that `webhook` handling logged without error (and, if Extend sync is live, `detective.checked`).
4. Cancel and refund in Shopify admin; record the refund confirmation.
5. Verify the confirmation, cancellation/refund e-mails arrived and are styled in the client's brand (SOW section 7).
6. Archive the record in `progress/TEST_RESULTS.md`; the order stays in the store's history, mark it with an order note "launch test" in admin.

If any step fails, it is a launch Blocker until understood.

## 12. After launch

- First 24 hours: owner and engineer watch journal and nginx logs; the issue log (P9-10) is opened; triage by the SOW grades (Blocker, Major, Minor).
- First week: check memory and restarts (`systemctl status`, `free -h`), tune `MemoryMax`; read `limiting requests` lines and raise any limit that refuses real shoppers; review certificate renewal status; confirm search engines can reach `robots.txt` and the sitemap.
- Day 7 to 30: if no incident, restore the DNS TTL to its normal value; consider the HSTS ramp (six months until launch plus a month of clean traffic, then one year; `includeSubDomains` and preload only after a subdomain inventory, SECURITY_HEADERS).
- Remove our Shopify staff or collaborator access when launch-day support ends, and record it in the inventory.
- Maintenance, hosting upkeep and new features after handover are not included (EXC-13).

## 13. Release record (fill in at deployment; keep in DECISIONS)

| Field | Entry |
|---|---|
| Release tag and commit | `[to fill]` |
| Go-or-no-go verdict, date, conditions with owners | `[to fill]` |
| Approvals (AP-1 to AP-8): who, when | `[to fill]` |
| DNS change time and old record values (reference to the saved zone) | `[to fill]` |
| Certificate issue date, renewal proof | `[to fill]` |
| Rollback rehearsal date and result | `[to fill]` |
| Smoke test result (section 10) | `[to fill]` |
| Live test order ID, observer, refund confirmed | `[to fill]` |
| Rollbacks or incidents | `[to fill]` |

## What this document does not cover

Hardening and monitoring detail (VPS_RUNBOOK); the client's server ownership model and OS patching (EXC-13, SOW section 3); an Oxygen deployment; moving e-mail; search-engine migration strategy beyond the redirect table; the content of the privacy policy; pixel baselines and WebKit or Firefox runs.
