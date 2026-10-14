# Phase 6: Sleep quiz, product comparison, store locator, customer journeys and content pages

## Objective

Deliver the guidance and trust features: a quiz that recommends mattresses from the live catalog, side-by-side comparison, the store locator, customer accounts with order tracking, and every content page and the blog. **Business outcome:** shoppers are guided to the right product, and the client's team can run all of it from Shopify admin (NFR-005).

## Scope

In: quiz (configuration, scoring, UI, persistence, tracking hooks), comparison, store, city and state pages with map, sign-in, order history and details, guest order tracking, 15 content pages and blog layouts.
Out: analytics provider wiring and consent (7), SEO polish (7), delivery time-window booking (EXC-04).

## Prerequisites

Phase 3B (product data and pages), Phase 4 (add to cart), Phase 3A stores data. CLR-012 quiz approval (draft questions can start the build), CLR-016 content text, Q-009, Q-010, Q-018 decisions, V-08 and V-09 verified.

## Requirement IDs

REQ-CMP-001, REQ-QZ-001, REQ-QZ-002, REQ-QZ-003, REQ-QZ-004, REQ-QZ-005, REQ-QZ-006, REQ-QZ-007, REQ-LOC-001, REQ-ACC-001, REQ-ACC-002, REQ-ACC-003, REQ-CNT-001, REQ-CNT-002, NFR-005

## Architecture and design decisions

- **Quiz config is data.** Questions, options and per-option scoring rules are metaobjects (REQ-QZ-004); a loader validates them and ignores or logs invalid mappings rather than failing. The scoring function is pure: `score(answers, products) -> ranked results with reasons`, with golden tests, so behaviour is reviewable and the client can approve the rules in plain language (CLR-012).
- Results use only attributes stored on products (comfort, type, sleep position, benefits, price), so new products appear automatically; out-of-stock and wrong-size products are excluded.
- Quiz saves to device storage and to the customer account (a customer metafield written through the Customer Account API if V-08 allows; otherwise record the limitation) (REQ-QZ-005).
- Quiz events call the Phase 2 `track()` interface (REQ-QZ-006); provider wiring is Phase 7.
- Store pages are generated from store metaobjects (state, city, store routes); the map is behind an adapter and falls back to address and directions links (Q-010).
- Customer accounts use Shopify's customer account flow; no passwords or tokens are handled by us (REQ-ACC-001). Guest tracking is a server route with strict rate limiting and a single generic failure message (Q-009).
- Content pages render from Shopify pages or metaobjects; the client edits text in admin.

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P6-01 | Quiz configuration model, loader and validation | shopify-hydrogen-developer | P3A-02, CLR-012 | `storefront/app/lib/quiz/config.ts` |
| P6-02 | Scoring engine with reasons and golden test cases agreed with the client | shopify-hydrogen-developer | P6-01 | `app/lib/quiz/score.ts`, tests |
| P6-03 | Quiz UI: one-tap questions, progress bar, results with Add to cart, See all matches, Retake, guidance note, entry points | shopify-hydrogen-developer | P6-02, P4-02 | `app/routes/quiz.tsx`, components |
| P6-04 | Quiz persistence on device and in the account | shopify-hydrogen-developer | P6-03, P6-07 | `app/lib/quiz/storage.ts` |
| P6-05 | Product comparison from collections and product pages | shopify-hydrogen-developer | P3B-03 | `app/routes/compare.tsx`, components |
| P6-06 | Store locator: state, city and store pages, hours, phone, directions, map adapter | shopify-hydrogen-developer | P3A-07, Q-010 | `app/routes/stores.*.tsx` |
| P6-07 | Account: sign-in, order history, order details | shopify-hydrogen-developer | V-08, Q-018 | `app/routes/account.*.tsx` |
| P6-08 | Guest order tracking route with rate limiting and generic errors | integration-engineer | Q-009, V-09 | `app/routes/track-order.tsx` |
| P6-09 | Content page layouts and loading of client text (15 pages), blog listing and article | technical-writer | CLR-016 | routes and `docs/handover` notes |
| P6-10 | Quiz event hooks via `track()` (start, complete, result click) | shopify-hydrogen-developer | P6-03 | events documented |
| P6-11 | E2E and accessibility for quiz, compare, stores, account, content | qa-engineer | P6-03 to P6-09 | `storefront/tests/e2e/{quiz,compare,stores,account,content}.spec.ts` |
| P6-13 | Friendlier quiz scoring model in Shopify admin: `quiz_scoring_rule` metaobjects (attribute, value, weight, boost or exclude) referenced from each option, replacing the raw JSON field, so non-developers can edit mappings (NFR-005, REQ-QZ-004); keep the JSON loader as a fallback | solution-architect | P6-01 | `scripts/shopify/definitions.json`, `app/lib/quiz/config.ts` |
| P6-14 | Shared rate limiter for guest order tracking (the in-memory limiter is per runtime instance): Cache API key, edge rule or Shopify-side control, decided with security-engineer (R-27) | security-engineer | P6-08 | `app/lib/orders/guest-lookup.ts` integration, review note |
| P6-12 | Phase gate review | project-manager | all | gate record |

## Dependencies and blockers

REQ-LOC-001 pending approval of the map provider (Q-010). REQ-ACC-003 pending approval of the lookup approach (Q-009). Quiz results need Phase 4 add to cart. Content needs client text (CLR-016); until then pages carry clearly marked placeholders that are tracked, and the gate requires them removed.

## Security considerations

Account routes only show the signed-in customer's data, with a negative test for cross-customer access (T-11). Guest tracking must not reveal whether an order number or an email exists, must be rate limited and must not log personal data (T-09). Quiz answers are not personal data by design; do not collect free text. Rich text from content pages is sanitised (T-07). Maps load only after the page is interactive and never receive the shopper's ZIP.

## Testing

Unit: scoring (every attribute, ties, exclusions), config validation, comparison rows, hours formatting. Integration: store and account queries, guest lookup route. E2E: full quiz to add to cart, retake, saved results on return and after sign-in, compare on mobile, store pages, login and orders, content page smoke for all 15 pages, blog. Accessibility scans on every new template.

## Acceptance criteria

All listed REQ criteria met on staging; client has approved quiz questions and scoring behaviour on sample products; every listed content page exists with final text; a non-developer edits a quiz question and a store hours entry in admin and sees the change.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: the admin guide sections for quiz, stores and content are drafted.

## Review and sign-off

`code-reviewer` reviews scoring and account code; `security-engineer` reviews account and guest tracking; `qa-engineer` signs journeys; client approves quiz behaviour in writing (CLR-012).

## Rollback and recovery

Each feature is a separate route; hide an entry point in admin or revert. If scoring misbehaves, the quiz falls back to "See all matches" using filters only. Account changes revert by commit; no customer data is migrated.
