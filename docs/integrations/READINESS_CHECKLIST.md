# Integration readiness checklist

Update at every phase gate and before any dependent work starts. States: `READY` (verified usable now, evidence linked), `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED` (cannot proceed until the named input exists). A BLOCKED item is never faked: its requirement stays Blocked. Dated 2026-10-11 (Stage A); reconciled with the code on `main` on 2026-10-15. Code that is built and tested against mocks does **not** move an item to READY: every row needs its own evidence from a store or provider, and none of the BLOCKED rows below has changed state since 2026-10-12.

| # | Item | Needed by | Depends on | Evidence required | State |
|---|---|---|---|---|---|
| IR-01 | Shopify development store with staff or collaborator access, equivalent to Basic | Phase 0 experiments | Q-002, V-21 | store URL, plan | BLOCKED |
| IR-02 | Client's live store plan confirmed | Phase 0 exit | Q-002 | owner answer 2026-10-12: **Basic**; written client confirmation still welcome | READY |
| IR-03 | Hydrogen or Headless channel installed; Storefront and Customer Account API tokens created; new customer accounts enabled | Phase 3A | IR-01, Q-003 | env var names present, API call succeeds | BLOCKED |
| IR-04 | **Dev Dashboard app** (custom distribution) with least-privilege Admin API scopes and webhooks (import, guest lookup, Extend sync) | Phase 3A and 5A | IR-01, V-20 | scopes list, token stored only in the secret store | BLOCKED |
| IR-05 | Metafield and metaobject definitions applied with Storefront access | Phase 3A | IR-01, V-05 | script run output | BLOCKED |
| IR-06 | Search and Discovery filters configured for the attribute metafields | Phase 3A | IR-05, V-04 | admin screenshot, API check | BLOCKED |
| IR-07 | Automatic discount behaviour in Storefront-API carts verified on a Basic-equivalent store (gift, bundle, 25-discount cap). Also gates `PUBLIC_GIFT_PICKER_ENABLED=true` (the picker is built and ships dark, DEC-047) and any bundle saving display (needs an automatic discount whose title equals the rule's `discountTitle`, DEC-046) | Phase 4 | IR-01, V-03 | experiment result | BLOCKED |
| IR-08 | Nested cart lines verified (removal, quantity, order and webhook representation) | Phase 4 and 5A | IR-01, V-02, V-16 | experiment result | BLOCKED |
| IR-09 | Extend merchant account approved; store ID; demo credentials. **Not needed to build** (mock); needed before the demo-host run and go-live | Phase 5A go-live | CLR-006, Q-005 | written confirmation from Extend | BLOCKED |
| IR-10 | Extend confirms headless custom UI, price-point table, line-property keys and who owns order sync | Phase 5A go-live | IR-09 | written answers | BLOCKED |
| IR-11 | Webhook subscriptions can be created for order, fulfilment and refund events | Phase 5A | IR-04, V-12 | test delivery received and verified | BLOCKED |
| IR-12 | Extend integration review passed | Go-live | IR-10, Phase 5A | Extend's written approval | NOT_STARTED |
| IR-13 | Haul-away detective control proven (Flow condition and email on Basic, or webhook check); optional quantity-limit app tested. Webhook check and `scripts/detective/report.mjs` are built and unit-tested (P5B-05, 2026-10-14); the development-store proof (violating test order logged, delivery_choice carried to the order) is outstanding | Phase 5B | IR-01, V-17, V-18 | dev-store screenshots | BLOCKED |
| IR-14 | Post-purchase option decided: client-chosen App Store app evaluated on the dev store (V-19) or dropped by change request | Phase 5B | Q-007, SD-02 | client decision, test result | BLOCKED |
| IR-15 | Single delivery zone: ZIP list, fee and free-over received; Local delivery configured; parity check passes | Phase 3A and 5B | Q-008, CLR-009, ADR-0007 | ADR, list, parity output | BLOCKED |
| IR-16 | Shopify Payments, PayPal and Affirm activated (test mode at least) | Phase 5B | CLR-007 | admin confirmation | BLOCKED |
| IR-17 | Reviews (default Judge.me) and chat (default Shopify Inbox) accounts accessible | Phase 3B and 7 | Q-011 | test accounts | BLOCKED (chat: the adapter, development fake and call-outs are built; Shopify Inbox cannot run on this storefront as verified 2026-10-25, so a different provider or the Hydrogen preview line needs a client decision; docs/integrations/CHAT.md) |
| IR-18 | Maps provider decided | Phase 6 | Q-010 | decision: OpenStreetMap with Leaflet by default | READY |
| IR-19 | Klaviyo, GA4, Meta access and IDs; SMS consent wording approved | Phase 7 | CLR-004, Q-015 | access, IDs, approval | NOT_STARTED |
| IR-20 | Client GitHub organisation and repository | Phase 1 (CI), 9 | Q-014 | repo URL, our access | BLOCKED |
| IR-21 | Staging server access | Phase 1 | project owner | host and method documented | BLOCKED |
| IR-22 | Hosting option chosen; for Option B the server with admin access | Phase 9 | Q-003, CLR-003 | decision; server access | BLOCKED |
| IR-23 | Domain registrar access | Phase 9 | CLR-004 | access confirmed | NOT_STARTED |
| IR-24 | Supported Node toolchain on build machines | Phase 1 | Q-017 | `node --version` = v22.23.3 through fnm (2026-10-12) | READY |
| IR-25 | Figma MCP approved and authenticated (only useful if the client has Figma files; account limited to 20 read calls per month) | Phase 2 | Q-004, B-04 | headless run showed connected and `whoami` OK (2026-10-11); interactive approval pending | IN_PROGRESS |
| IR-26 | Playwright MCP approved and connected in Claude Code | Phase 1 testing | B-04 | `/mcp` shows connected (stdio check of the server already passed) | IN_PROGRESS |
| IR-27 | Production configuration complete and verified per environment: `SESSION_SECRET` and `DELIVERY_COOKIE_SECRET` (32+ characters, different), `PUBLIC_SITE_URL`, `OFFER_CONFIG_JSON` / `OFFERS_ENABLED`, `SHOPIFY_APP_CLIENT_SECRET`, a `read_orders`-only `SHOPIFY_ADMIN_API_ACCESS_TOKEN`, `EXTEND_ORDER_SYNC`, `PUBLIC_EXTEND_ENABLED`, `PUBLIC_SUPPORT_PHONE` | Phase 9 (staging first) | IR-21, IR-22 | no `[config]` line in the first request logs; list ticked in [DEPLOYMENT](../deployment/DEPLOYMENT.md) | NOT_STARTED |
