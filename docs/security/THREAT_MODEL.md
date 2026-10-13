# Threat model

Status: initial model from the SOW and architecture, 2026-10-11. Reviewed by `security-engineer` at the Phase 1 foundation, at every phase touching a listed threat, and at the Phase 7 gate. Findings and verification evidence go in `docs/security/REVIEW-*.md` and [TEST_RESULTS](../../progress/TEST_RESULTS.md).

## Assets

Shopper personal data (names, addresses, emails, phones, order contents); payment data (never touches us: Shopify's hosted checkout handles it); price and discount integrity; Shopify, Extend, Admin API, webhook and session secrets; client's catalog and store configuration; the repository and deployment pipeline; shopper trust (consent, privacy).

## Trust boundaries

Browser (untrusted) → storefront server (trusted, holds private tokens) → Shopify and Extend (trusted providers, authenticated). Shopify webhooks → sync endpoint (untrusted until the signature verifies). Third-party scripts in the browser (semi-trusted, constrained by CSP and consent). Client team's admin edits (trusted but may contain unsafe content). Developer machines, CI and AI agents (trusted with least privilege).

## Threats and controls

| ID | Threat | Impact | Controls | Verified by | Phase |
|---|---|---|---|---|---|
| T-01 | **Price or discount tampering**: crafted cart or request tries to change a price, apply an unauthorised discount or use a stale quote | revenue loss | Shopify prices every line; browser sends variant IDs and quantities only; discounts only through Shopify; server revalidation before hand-off; no price in client-trusted fields | unit and e2e tamper tests; manual compare of cart and checkout | 4, 7 |
| T-02 | **Offer-rule bypass**: over-limit haul-away quantity, gift without qualifier, ineligible ZIP, add-on in the wrong size | revenue loss, service failures | `evaluateOffers` on server; caps enforced server-side; Function in checkout where eligible; reconciliation report otherwise | unit tests, e2e, report | 4, 5B |
| T-03 | **Forged or replayed Shopify webhooks** trigger fake Extend orders or refunds | fraud, bad contracts | HMAC verification on the raw body with a constant-time compare, timestamp and ID replay protection, secret only on the server, idempotent sync | integration tests, review | 5A |
| T-04 | **Secret exposure**: private tokens in client bundles, logs, error pages, analytics, repo or prompts | account compromise | `PUBLIC_` prefix discipline, server-only modules, deny rules on `.env` reads, secret scan in CI, log redaction, rotation plan | CI scan, code review, bundle inspection | 1, 7 |
| T-05 | **PII in logs and analytics**: names, emails, addresses or full ZIP sent to logs or third parties | privacy breach | structured logging with redaction, event allow-list, no PII in URLs, hashed identifiers where needed | unit test on logger, network inspection | 7 |
| T-06 | **Orphaned or mismatched protection lines** and sync drift (coverage without product, covered item removed, quantity mismatch) | customer harm, invoicing errors | link model, server revalidation, hide coverage variants from browsing, reconciliation job | e2e, report | 5A |
| T-07 | **Stored or reflected XSS** through Shopify content (rich text, metaobjects, product descriptions, FAQs) or query parameters | account or session abuse | sanitise or render structured rich text; no unsanitised `dangerouslySetInnerHTML`; validate `?Size` and filter parameters; CSP | tests with malicious fixtures, review | 3B, 7 |
| T-08 | **CSRF and open redirects** on cart and checkout-step actions | unwanted cart changes, phishing | same-site cookies, origin checks on actions, allow-listed redirect targets (only our routes and the Shopify checkout URL) | tests | 4 |
| T-09 | **Guest order-tracking enumeration or leakage** | privacy breach | generic failure message, rate limiting, minimal data returned, least-privilege token, no PII in logs; or link to Shopify's status page | abuse tests | 6 |
| T-10 | **Third-party script compromise or over-collection** (analytics, chat, reviews, maps, Affirm, Klaviyo) | data theft, malicious code | approved origins only, CSP allow list, load after consent and interaction, subresource integrity where offered, no ZIP or email to scripts | CSP report, network inspection | 7 |
| T-11 | **Account takeover and cross-customer access** | privacy breach | Shopify's customer account flow (no passwords here), session expiry, ownership checks on every order query | negative e2e and integration tests | 6 |
| T-12 | **Supply-chain compromise**: malicious npm package, compromised GitHub Action, unpinned MCP server | code execution | lockfile, `npm audit` in CI, pinned versions (Playwright MCP pinned to 0.0.83), minimal dependencies, review of new packages and Actions | CI, review | 1 onward |
| T-13 | **Abuse of server proxies** (Extend offers, predictive search, guest lookup): scraping or cost and rate exhaustion | availability, cost | rate limits, input validation, timeouts, caching, circuit breaker | load and abuse tests | 5A, 6, 7 |
| T-14 | **Tooling misuse**: import script run against the wrong store, spreadsheet formula injection, oversized input | data loss or corruption | store allow-list, dry run default, run manifest, input sanitising, backups before live runs | integration tests | 3A |
| T-15 | **AI-agent risks**: prompt injection from web pages or MCP output, destructive commands, secrets pasted into prompts, tests run against production | data loss, leaks | untrusted-data rule in CLAUDE.md, least-privilege agent tools, `settings.json` deny and ask rules, sandbox stores only, written authorisation for any live order | review of settings, session audits | all |
| T-16 | **Consent and messaging compliance** (US privacy rules, SMS consent) | legal exposure | consent layer gating tags, recorded SMS consent text approved by the client, privacy policy matches practice; legal review requested of the client | e2e consent test, approval | 7 |

## Security acceptance criteria (NFR-004)

1. No private secret in any client bundle, repository or log (CI scan and bundle check).
2. All inputs validated at the server boundary; unknown parameters ignored or rejected.
3. Webhook signature verification proven by failing tests for bad and replayed requests.
4. Dependency audit has no unaccepted High or Critical issue; every accepted risk has a written note.
5. Security headers and a CSP are in place (report-only first, then enforced); third-party origins are allow-listed.
6. Customer data access is ownership checked, with negative tests.
7. Every threat above has a recorded verification result or a written risk acceptance by the project owner.

## Verification status

Latest: [REVIEW-2026-10-13-pages](REVIEW-2026-10-13-pages.md) (commits 8c533e2 and 46e64a2), after [REVIEW-2026-10-12-foundation](REVIEW-2026-10-12-foundation.md) (commit 2740454). Verified in code: T-04 (tree, history, range diff, client bundle; but the `cart` cookie lacks HttpOnly/SameSite/Secure, P-M1), T-03 and T-09 libraries, T-14 guards, T-07 (sanitiser probed with 63 hostile inputs, JSON-LD escaping, reflection tests; earlier M-3 closed), T-08 redirects (earlier M-1 closed, live-tested) and the CSRF origin check in the dev server (host and proxy behaviour unverified, P-L5), T-05 for the new routes (logs, error text, analytics). Partial: T-01 (input validated; server offer revalidation not wired to any route, P-M2), T-02, T-06 (P-L1), T-13 (P-L4, no rate limits yet), T-15. Open: T-12 (H-1, ADR-0008). Not yet in scope: T-10, T-11, T-16. Gate G5 verdict for the pages commits: pass with conditions (P-M1 before staging, P-M2 at phase 4 gate).

## Out of scope

Payment card handling (Shopify checkout), Extend's internal security, Shopify platform security.
