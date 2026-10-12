# Risks and external dependencies

Updated 2026-10-11. Likelihood (L) and impact (I): H, M, L. Review at every phase gate. Each risk has an owner who acts on it; closed risks stay in the table with the closing note.

## Risk register

| ID | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | **Scope versus price.** The SOW delivers roughly 100 requirements, five third-party integrations, a catalog import tool and two hosting options for a fixed USD 1,000. Any slippage or rework is absorbed by the provider | H | H | Strict change control (SOW §11); requirements baseline; phase-level effort estimate before Phase 3A starts so a conversation with the client can happen early; reuse Hydrogen defaults; avoid gold-plating. This is a commercial decision for the project owner, not something agents can mitigate | project owner | OPEN |
| R-02 | **Shopify plan is Basic (confirmed 2026-10-12).** Functions and extensions of our own are Plus only (F-07, F-22 to F-24); the SOW promises an in-checkout Function and post-purchase offers | H | M | Everything pre-checkout (ADR-0006); layered haul-away enforcement; App Store route for post-purchase; client acknowledgement of SD-01 to SD-04 ([SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md)); Plus only if the client insists (CR-05) | integration-engineer | OPEN: mitigated by design, client acknowledgement pending |
| R-03 | **Extend headless model unproven.** No headless guide; coverage price must match a Shopify variant price; key names, price-point table and order-sync ownership unknown; review lead time | M | H | Build now against a local mock behind a flag (ADR-0009); keep go-live gated on Extend's written answers and a demo-host run; if Extend declines headless, raise a change request | integration-engineer | OPEN: building, go-live gated |
| R-04 | **Option B self-hosting compatibility.** Shopify warns its guide may not cover Hydrogen 2025-05 and later features; current is 2026.10 (F-06, D-02) | M | M | Host-agnostic build; early plain-Node proof (P1-08); recommend Option A as the SOW does; price any extra adaptation by change request | devops-engineer | OPEN |
| R-05 | **Unsupported Node on the build machine.** Node 25.8.2 is outside the Hydrogen toolchain range (F-02) | H | M | fnm and Node 22.23.3 installed 2026-10-12; `.nvmrc`; PowerShell still resolves Node 25 until fnm is added to its profile (use Git Bash for project commands) | devops-engineer | MITIGATED |
| R-06 | **Late client inputs.** Brand kit, product sheet and images, store list, content, business rules (CLR list) | H | M | Request everything in the Phase 0 pack; placeholders tracked and removed before gates; the SOW already ties pace to arrivals | project-manager | OPEN |
| R-07 | **No schedule in the SOW.** No dates, milestones or named decision-maker (Q-013) | H | M | Plan by gates, report against them; get a decision-maker and target date | project-manager | OPEN |
| R-08 | **SOW not confirmed signed.** The attachment's signature block is blank (Q-001) | M | H | Obtain the signed copy; until then record deviations as change requests | project owner | OPEN |
| R-09 | **Delivery-zone lists drift.** Storefront and checkout use different ZIP lists, so shoppers see promises checkout rejects | M | H | Single source of truth (P3A-10, Q-008); parity test | solution-architect | OPEN |
| R-10 | **Cart price differs from checkout.** A client promotion cannot be expressed as a native discount | M | H | Use only Shopify discounts for pricing (REQ-PROMO-001/002); verify in V-03; raise change requests rather than computing prices in code | integration-engineer | OPEN |
| R-11 | **Orphaned or mismatched protection lines.** Without a Function, a crafted cart could hold coverage without its product (T-06) | M | M | UI linking, server revalidation, reconciliation report, hide coverage variants from browsing | integration-engineer | OPEN |
| R-12 | **Guest order tracking abuse or privacy leak** (T-09) | M | M | Generic errors, rate limiting, least-privilege token, no PII in logs; or link to Shopify's status page (Q-009) | security-engineer | OPEN |
| R-13 | **Accessibility and privacy exposure.** US storefront with no stated WCAG level, consent approach or SMS consent text (Q-012, Q-015) | M | H | Propose WCAG 2.2 AA and a consent model for approval; legal review requested of the client for consent wording | project-manager | OPEN |
| R-14 | **Reviews and chat providers undecided** (Q-011) | M | M | Adapter interfaces; ship "no provider" states | project-manager | OPEN |
| R-15 | **Reference-site content copied by accident** (NFR-007) | L | H | Pattern notes only; provenance review (P8-07); code review checks | code-reviewer | OPEN |
| R-16 | **AI-agent risks.** Prompt injection through web pages or MCP output, destructive commands, secret exposure, tests against production (T-15) | M | H | Least-privilege agent tools, deny rules for `.env` and force-push, ask rules for deploys, untrusted-data rule in CLAUDE.md, sandbox stores only | orchestrator | MITIGATED (controls in place, verify in use) |
| R-17 | **Toolchain churn.** Hydrogen uses calendar versions; TypeScript 7 and newer React Router exist but the CLI pins React Router 7.16 (F-03, V-14) | M | M | Use the template's pins; upgrade only with passing CI and an ADR | shopify-hydrogen-developer | OPEN |
| R-18 | **Catalog data quality.** Up to 400 products from a spreadsheet | H | M | Validation report before any import; idempotent import; sampled comparison; client approves copy | shopify-hydrogen-developer | OPEN |
| R-19 | **Shopify limits unverified** (automatic discount counts, metaobject limits, cart line limits, filter limits) | M | M | Verify during Phase 0 and 3A; record in the feasibility file | solution-architect | OPEN |
| R-20 | **Third-party scripts hurt performance** (chat, reviews, analytics, Extend) against NFR-002 | M | M | Defer and lazy-load; budgets in CI; measure each addition | shopify-hydrogen-developer | OPEN |
| R-21 | **Design drift without mockups** (EXC-09): the client reacts to a built site, which can multiply feedback rounds | M | M | Tokens first; one consolidated round per page type (SOW §11); client approves visual direction at Phase 2 gate | ui-ux-designer | OPEN |
| R-22 | **White-glove delivery versus express checkout buttons.** Shopify's native local delivery (ZIP-list) does not work with Apple Pay, Google Pay or PayPal in the first checkout step (F-18), but SOW §7 lists both white-glove by ZIP and express wallet buttons | M | H | Verify in the current checkout (V-06b); choose the mechanism in P3A-10 ([DELIVERY_ZONE_OPTIONS](../docs/research/DELIVERY_ZONE_OPTIONS.md)); put the trade-off to the client in writing (Q-008) | solution-architect | OPEN |
| R-23 | **Hydrogen scaffold ships react-router 7.16.0 with known advisories** (high: unauthenticated DoS via route matching; moderate: open redirect, hydration constructor injection, RSC XSS); newer react-router breaks Hydrogen 2026.4.7 peer ranges; Hydrogen 2026.10.0 needs a template migration (F-33, ADR-0008) | H | M | Hold Shopify-tested pins; migrate to 2026.10 before Phase 3B feature code (P1-12); CI reports `npm audit` with a reviewed allow list; do not launch on the held pins without a recorded decision | shopify-hydrogen-developer | OPEN |
| R-24 | **Haul-away and eligibility rules cannot be enforced inside checkout on Basic**: a shopper who calls the public Storefront API directly can bypass server rules (SD-01) | M | L | Private-token cart writes, revalidation, Flow or webhook detective control, client acknowledgement; low money impact because pricing stays Shopify's | security-engineer | OPEN: accepted by owner, client pending |
| R-25 | **Admin API access on the client store** (legacy custom apps cannot be created since 2026-01-01; client-credentials works only within one organisation) may need a one-time merchant approval and Partner access | M | M | Dev Dashboard app with custom distribution and authorization-code grant (V-20); collaborator request early (V-21, SD-10) | integration-engineer | OPEN |
| R-26 | **Nested cart lines on Basic are unverified in practice** (child quantity behaviour, webhook representation); Extend linking depends on them (V-16) | M | M | Verify on a dev store first; fall back to an attribute pair checked by our server and reconciliation | integration-engineer | OPEN |

## External dependencies

| Dependency | Needed for | Owner | Lead time risk | Status |
|---|---|---|---|---|
| Shopify store (development store now, client store later), staff access, plan confirmation | everything from Phase 3A | client | medium | OPEN (Q-002) |
| Shopify sales channel: Hydrogen channel (Option A) or Headless channel (Option B) | Storefront and Customer Account API access | client and us | low | OPEN (Q-003) |
| Extend merchant approval, sandbox, integration review | Phase 5A and go-live | client and Extend | **high** | OPEN (Q-005) |
| App Store post-purchase or thank-you app (client choice) and, optionally, a quantity-limit app | REQ-POST-001/002, optional layer for REQ-PROMO-003 | client | medium (Shopify access approval up to seven days for apps using post-purchase) | OPEN (Q-007, V-18, V-19) |
| Affirm, Shopify Payments, PayPal activation | REQ-CHK-004, REQ-CART-005 | client | medium | OPEN (CLR-007) |
| Klaviyo, Google Analytics, Meta access | Phase 7 | client | low | OPEN (CLR-004) |
| Reviews app and chat provider | REQ-PDP-005, REQ-ANL-004 | client | medium | OPEN (CLR-005) |
| Maps provider | REQ-LOC-001 | client | low | OPEN (Q-010) |
| GitHub organisation for the client-owned repository | CI, handover | client | low | OPEN (Q-014) |
| Staging server (ours) | REQ-HOST-001 | us | low | details missing |
| Production hosting: Oxygen (included in Shopify) or client's server and DNS access | Phase 9 | client | medium (Option B) | OPEN (Q-003, CLR-003) |
| Figma files (optional) | Phase 2 design alignment | client | low | OPEN (Q-004) |
| Supported Node toolchain | Phase 1 | project owner | low | CLEARED 2026-10-12 (fnm, Node 22.23.3) |
