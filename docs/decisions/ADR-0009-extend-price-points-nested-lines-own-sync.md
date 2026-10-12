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
