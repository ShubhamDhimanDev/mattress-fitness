# Phase 5A: Extend accident protection

## Objective

Sell Extend accident protection on the product page, in the cart and in the pre-checkout step, and report every sale to Extend so coverage starts without manual work. **Business outcome:** a protection attach-rate that customer service never has to repair by hand. Owner decision (2026-10-12): **implement it whether or not the client has an Extend account yet**; it is built against a local mock of Extend's documented API behind a feature flag, and goes live only when the account and Extend's written answers exist (ADR-0009, SD-08).

## Scope

In: offers (server-side), coverage products and the nested-line link, product page and pre-checkout UI with Extend branding and terms, webhook receiver, order sync (create, fulfil, refund, cancel), reconciliation, resilience, the local mock, the Extend feature flag, Extend's integration review when an account exists.
Out: Extend claims handling (Extend's job), any self-run warranty (EXC-07), Extend's theme app blocks (they target Liquid themes, F-12).

## Prerequisites

**Build** can start as soon as Phase 4's cart and linking foundation exists (the pure library, mock and tests can start earlier, in parallel lane C of the [ROADMAP](../ROADMAP.md)). **Go-live** needs: an approved Extend merchant account and store ID (CLR-006), Extend's written answers (headless custom UI approval, price-point table, line-property key names, who owns order sync, Q-005), the eligible category list (CLR-018), V-16 and V-20 verified on a dev store.

## Requirement IDs

REQ-ADD-003, REQ-PRE-004, REQ-EXT-001, REQ-EXT-002, REQ-EXT-003, REQ-EXT-004, REQ-EXT-005, NFR-013

## Architecture and design decisions

Contract and sequences: [EXTEND](../../docs/integrations/EXTEND.md); decisions: [ADR-0009](../../docs/decisions/ADR-0009-extend-price-points-nested-lines-own-sync.md), [ADR-0006](../../docs/decisions/ADR-0006-basic-plan-pre-checkout-logic.md).

- **Server-side only.** The browser calls our route; our server calls Extend with `X-Extend-Access-Token`. Credentials never reach the client (REQ-EXT-001). Hosts are environment variables: demo `https://api-demo.helloextend.com`, production `https://api.helloextend.com`.
- **Price Points.** Coverage is a small set of Shopify variants named `Extend-Protection-Plan-<price>`; an offer is shown only when its price equals an existing price-point variant price.
- **Nested cart lines.** Coverage is a child line under the covered line; Shopify removes the child when the parent goes; our server keeps child quantity equal to parent quantity (V-16).
- **Order sync is a stateless projection**: verified Shopify webhook, then a full-snapshot `PUT /orders` keyed by the Shopify order ID; fulfilment sets `fulfilledQuantity`; the Orders API is idempotent so retries and replays are safe (NFR-006). `EXTEND_ORDER_SYNC=self|extend-app|off` guards against double reporting.
- **Feature flag and mock.** `PUBLIC_EXTEND_ENABLED` hides every Extend surface. `scripts/mocks/extend-mock.mjs` implements only the documented subset and is labelled MOCK.
- **Failure never blocks shopping**: timeouts, a circuit breaker and cached "no offer" results keep product, cart and checkout working when Extend is down (NFR-013).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P5A-01 | Ask Extend the Q-005 questions in writing and, when an account exists, obtain demo credentials | project-manager | Q-005 | answers recorded in `docs/integrations/EXTEND.md` |
| P5A-02 | Coverage modelling and link design: price-point product configuration, nested-line behaviour on a Basic-equivalent dev store (V-16); ADR-0009 accepted | solution-architect | V-16 | ADR-0009 status, config spec |
| P5A-03 | Local mock server of the documented Extend subset (`POST /offers`, `PUT /orders`) with fixtures, labelled MOCK | integration-engineer | none | `scripts/mocks/extend-mock.mjs`, `scripts/mocks/fixtures/*` |
| P5A-04 | Server-side Offers client and proxy route: request builder, response mapping, price-point matching, timeouts, circuit breaker, category eligibility (REQ-EXT-005), feature flag | integration-engineer | P5A-03, CLR-018 | `storefront/app/lib/extend/offers.ts`, route |
| P5A-05 | Product page offer UI with Extend branding and terms link | shopify-hydrogen-developer | P5A-04 | `app/components/protection/*` |
| P5A-06 | Cart linking: add as nested line, quantity follows, size change, removal, orphan detection | integration-engineer | P5A-02, P5A-05 | `app/lib/extend/linking.ts`, tests |
| P5A-07 | Pre-checkout protection step (accept or decline recorded) | shopify-hydrogen-developer | P5A-06 | `app/routes/checkout-steps.tsx` extension |
| P5A-08 | Webhook receiver: HMAC verification, topic routing, safe replay, Admin API read of the order | integration-engineer | V-12, V-20 | `app/routes/webhooks.shopify.tsx` |
| P5A-09 | Order snapshot builder and sync: create, fulfil, refund, cancel, replay, tested against the mock | integration-engineer | P5A-08, P5A-03 | `app/lib/extend/orders.ts`, integration tests |
| P5A-10 | Reconciliation report (Shopify coverage lines versus Extend orders and contracts) and structured failure logging with retry | integration-engineer | P5A-09 | `scripts/reconcile-extend.mjs` |
| P5A-11 | Resilience tests: Extend slow, down, malformed; shopping and checkout hand-off still work | qa-engineer | P5A-04 to P5A-07 | `storefront/tests/e2e/resilience.spec.ts` |
| P5A-12 | Run the full lifecycle against the Extend demo host and submit for Extend's review when an account exists (REQ-EXT-004) | integration-engineer | CLR-006, P5A-09 | evidence and approval on file |
| P5A-14 | Reconciliation script on top of the pure `reconcile()` (Shopify orders versus Extend orders; reports and optionally re-sends missing syncs) | integration-engineer | P5A-09 | `scripts/reconcile-extend.mjs` |
| P5A-13 | Phase gate review | project-manager | all buildable tasks | gate record; REQ-EXT-004 stays open until Extend approves |

## Dependencies and blockers

P5A-01 and P5A-12 depend on the client and Extend (Q-005, CLR-006); everything else can proceed against the mock. A mock-green result is **not** evidence that Extend behaves that way. If Extend declines a headless custom UI, stop and raise a change request. If Extend says its Shopify app must sync orders, set `EXTEND_ORDER_SYNC=extend-app` and drop our sync.

## Security considerations

Extend token, client secret and store credentials are server secrets; the webhook route verifies `X-Shopify-Hmac-Sha256` against the raw body with a constant-time compare and rejects replays outside a time window; the sync logs order IDs and plan IDs, never customer names, emails, addresses or tokens; the Admin API token (read orders) is least privilege and comes from a Dev Dashboard app (V-20); outbound calls have timeouts and are allow-listed to Extend hosts (SSRF safety). Threats T-03 to T-06 and T-13.

## Testing

Unit: request and snapshot builders, price-point matching, linking rules, category filter. Integration against the **local mock** for create, fulfil, partial refund, full refund, cancel and replay (idempotent), then the same suite against the Extend demo host when available. E2E: accept, decline, quantity change, remove covered item, ineligible product, Extend down, flag off. Manual: contract visible in Extend demo after fulfilment.

## Acceptance criteria

All REQ-EXT and the dependent REQ-ADD-003 and REQ-PRE-004 criteria are met against the mock; the same suite passes against the Extend demo host before any production use; Extend's written approval is on file before go-live; NFR-013 e2e passes with the flag on and off.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: reconciliation report runs clean on mock and demo data; runbook for failed syncs written; a recorded statement of whether Extend is live, off, or waiting on the account.

## Review and sign-off

`security-engineer` signs webhook, secrets and logging; `code-reviewer` reviews linking and sync logic; `qa-engineer` signs evidence; Extend approves the integration (a third-party sign-off we cannot waive).

## Rollback and recovery

`PUBLIC_EXTEND_ENABLED=false` hides offers instantly without a code change; the webhook route can be disabled independently so orders are queued by Shopify retries. Because sync is idempotent, a missed window is recovered by replaying orders for that window.
