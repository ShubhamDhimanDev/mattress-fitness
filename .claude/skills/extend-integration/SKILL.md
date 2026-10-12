---
name: extend-integration
description: "Implements and verifies the Extend accident protection integration: server-side Offers API calls, coverage lines linked to the covered item, branding and terms, webhook-driven idempotent Orders API sync, reconciliation and failure handling. Use only after Extend access and the headless modelling questions are answered, and never invent an Extend endpoint, host, field or lifecycle event."
---

# Extend integration

## When to use

Phase 5A work and anything touching coverage offers, coverage lines, Extend order reporting or its tests. Contract and known gaps: `docs/integrations/EXTEND.md`; verified facts F-10 to F-12 in `docs/research/TECH_FEASIBILITY.md`; plan: `plans/phases/phase-05a-extend-protection.md`.

## Steps

1. **Gate check.** Q-005 answered in writing? CLR-006 met (approved merchant account, store ID, sandbox credentials)? CLR-018 category list received? If not, the work is **BLOCKED**: update `docs/integrations/READINESS_CHECKLIST.md` and stop. Do not code against guessed hosts or payloads.
2. **Re-read the provider docs** you are about to rely on (Offers API, Orders API) and diff them against `EXTEND.md`; record changes with date.
3. **Offers (server side).** Build the request (`storeId`, `currency`, items with `category`, `productId`, `purchasePrice` in cents, `quantity`), send with `X-Extend-Access-Token` from the server environment, map the response to a typed result, enforce a timeout and circuit breaker, filter by eligible categories. Failure hides the offer and logs; it never blocks the page.
4. **UI.** Show Extend branding or "Powered by Extend", accurate price and a link to plan terms on every offer surface (product page, cart, pre-checkout step); record accept and decline.
5. **Coverage line.** Model per the Q-005 decision; link to the covered line using the mechanism chosen in P4-01 and ADR-0006; quantity and size changes follow the covered item; removing it removes coverage; coverage cannot be added alone through the UI.
6. **Order sync.** Verify the Shopify webhook HMAC on the raw body and reject replays; fetch the order through the Admin API (read-only token); build the full snapshot (`transactionId` = Shopify order ID, line `lineItemTransactionId` stable and immutable, `plan` or `category_contract` as agreed); `PUT /orders`; set `fulfilledQuantity` on fulfilment (that is what issues the contract); handle partial refund, full refund (`status: "refunded"`) and removal; never send partial updates.
7. **Reconcile and log.** Reconciliation compares Shopify protection lines with Extend orders and contracts; log failures with order and plan IDs only; retry with backoff; replay is safe because the API is idempotent.
8. **Tests.** Unit: request, mapping and snapshot builders; link rules. Integration against the sandbox: create, fulfil, partial refund, full refund, cancel, replay. E2E: accept, decline, quantity change, removal, ineligible product, Extend down.

## Outputs

Integration modules and tests, webhook route or service entry, reconciliation script, updated `EXTEND.md` and readiness checklist with evidence, and Extend's review submission.

## Validation

No Extend credential reaches the browser or logs; bad or replayed webhooks are rejected by tests; sandbox shows correct plans, orders and contracts; the covered-item link survives quantity, size and removal; branding and terms present everywhere; Extend's written approval is on file before production; with Extend stubbed to fail, shopping and checkout hand-off still work.
