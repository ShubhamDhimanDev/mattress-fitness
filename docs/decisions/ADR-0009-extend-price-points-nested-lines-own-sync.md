# ADR-0009: Extend protection: price points, nested cart lines, our own order sync, behind a flag and a local mock

- **Status:** Proposed (design decision for implementation; production use depends on Extend's written answers, Q-005)
- **Date:** 2026-10-12
- **Deciders:** project owner ("just implement it"); integration-engineer; solution-architect
- **Requirements:** REQ-EXT-001 to REQ-EXT-005, REQ-ADD-003, REQ-PRE-004, NFR-013
- **Related:** F-09, F-10, F-11, F-12, F-26, F-27, Q-005, SD-08, R-03, V-16

## Context

The owner wants Extend built whether or not the client already has an account. Extend's documentation gives us the Offers API, the Orders API, the demo and production hosts and the **Price Points** pattern for Shopify (a small set of coverage SKUs named by price; plan details as line properties), but no headless guide, no property key names and no go-live checklist (F-27). On Basic we cannot override a line price in checkout, so the quoted coverage price has to equal an existing variant price. Shopify's nested cart lines let a coverage line hang off the covered line and be removed with it (F-26).

## Decision

1. **Coverage products:** a small set of Shopify products (price-point variants named `Extend-Protection-Plan-<price>`, at most 250, final table from Extend) published to the headless channel, hidden from collections and search. An offer is shown **only if the plan price equals an existing price-point variant price**; otherwise the offer is hidden (we never charge a different price than quoted).
2. **Linking:** accepting a plan adds the coverage variant as a **nested line** (`parent` = the covered line) and writes our own line attributes with the plan ID, covered product ID and term (our keys, documented in `EXTEND.md`; Extend's own key names are unknown). The server keeps the child quantity equal to the parent quantity after every cart change.
3. **Order sync:** our own webhook receiver builds a full-snapshot `PUT /orders` from the Shopify order (Admin API read) and sends it with `X-Extend-Access-Token`; fulfilment sets `fulfilledQuantity`. Mode switch `EXTEND_ORDER_SYNC=self|extend-app|off`, default `self`. If Extend says its Shopify app must do the sync, we switch to `extend-app` and drop our sync to avoid double reporting.
4. **Feature flag:** `PUBLIC_EXTEND_ENABLED=false` hides every Extend surface; the rest of the store never depends on it (NFR-013).
5. **Mock first:** a small local server (`scripts/mocks/extend-mock.mjs`) implements only the documented subset (`POST /offers`, `PUT /orders`) from the Extend docs, labelled MOCK, with fixtures. Unit and integration tests run against it. Nothing in the mock is presented as Extend's real behaviour; every assumption is a `V-11` item to confirm against the Extend demo host (`https://api-demo.helloextend.com`) when credentials exist.
6. Hosts, token and store ID are environment variables; production uses `https://api.helloextend.com`.
7. **Cross-check in the sync:** a direct-API cart can add a cheaper price-point SKU alone or attach any plan ID as an attribute. Before reporting, the sync verifies that the paid price of each coverage line equals the price of the plan ID in its attributes (from the Offers response or a stored quote) and that the covered product is in the same order; mismatches are flagged for staff and never sent to Extend.

## Consequences

Easier: Extend work starts now, independent of UI and of the client's account; tests are fast and deterministic. Harder: the mock can drift from reality, so the demo-host run is a hard gate before any production use; the price-point table must come from Extend; nested-line behaviour on Basic is unverified (V-16) and the child-quantity rule may need a different mechanism if updates on nested lines are refused.

## Alternatives considered

Extend's Listed Shopify app with theme app blocks: not usable for the storefront UI (F-12). Note that the documented Price Points pattern itself requires Extend's Listed app (F-27); whether the model may be used without it, or alongside it, is a Q-005 question and the reason `EXTEND_ORDER_SYNC` exists. Draft Orders: excluded by Price Points and by our hosted-checkout rule. A Cart Transform to set the price: needs a Function (Plus for custom apps).

## Verification

Offers and snapshot builders unit-tested; sync lifecycle (create, fulfil, partial refund, full refund, cancel, replay) tested against the mock; V-16 on a dev store; Extend demo-host run and Extend's written approval before go-live.

## Implementation note (2026-10-15, as built; mock-green only)

All seven decisions are built against the local mock: price-point catalog (tag `extend-coverage`, 250 at most, recognised also by name `Extend-Protection-Plan-<price>`), nested lines with our `_extend_plan_id`, `_extend_covered_product_id`, `_extend_term` attributes, own sync with `EXTEND_ORDER_SYNC`, the flag `PUBLIC_EXTEND_ENABLED` (exactly `true`), the mock, and the item 7 cross-check. Developments since the decision, all recorded in decisions DEC-034, DEC-037, DEC-038, DEC-040, DEC-042 and in [EXTEND.md](../integrations/EXTEND.md): (a) the flag is a true kill switch: with Extend off every coverage line is removed, and with it on but the catalog unreadable checkout is paused; (b) coverage price must equal a plan Extend quoted for its parent (`coverage-price-mismatch`), and coverage that cannot be judged is removed; (c) offers are quoted at quantity 1 (an ASSUMPTION, V-11); (d) the browser accept actions `CustomAddWithProtection` and `CustomAddProtection` exist and the server re-derives plan, variant, price and parent; (e) the sync cannot read the nested-line parent from an order (not documented), so it falls back to the covered product id and flags `covered_product_ambiguous`. Item 2 says the server keeps child quantity equal to parent quantity: built in the gate, but whether Shopify itself lets a child's quantity follow its parent is unverified (V-16). Status stays **Proposed** (design); production use waits for Extend's written answers (Q-005, IR-10) and a demo-host run (IR-09). No divergence needs a new ADR.

## Addendum 2026-10-12: webhook timing, secrets and replay (decided by the orchestrator after the library review)

- **Respond fast, sync in the background.** Shopify requires a webhook response within about 5 seconds and does not guarantee delivery order; a sync with retries can take longer. The webhook route verifies the signature, records the event, answers `200`, and runs the sync inside `waitUntil` (Oxygen) or as a background promise (Node; the process is stateful). Failures are logged (no personal data) and are recovered by Shopify's own retries and by the reconciliation report (`reconcile()`, script P5A-10), which compares Shopify orders with Extend orders and re-sends what is missing. Because `PUT /orders` is an idempotent full snapshot, a repeated or re-ordered event is harmless.
- **One secret for webhooks.** Shopify signs app-subscribed webhooks with the app's client secret, so the receiver uses `SHOPIFY_APP_CLIENT_SECRET`; a separate `SHOPIFY_WEBHOOK_SECRET` is dropped from the configuration unless a webhook created another way needs it.
- **Replay protection does not need a database.** The signature check, a timestamp window where the payload carries one, `X-Shopify-Webhook-Id` de-duplication in a best-effort store (Cache API on Oxygen, memory on Node) and the idempotent snapshot together make a replay a no-op. A durable store is optional hardening, not a requirement, and keeps NFR-006 (no database) intact.
- **Retry facts used:** Shopify retries failed webhook deliveries 8 times over about 4 hours (checked by the library author against Shopify's docs).
