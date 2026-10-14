# Current phase

**Phase 0 (closing) and Phase 1 (started).** Plans: [phase-00](phases/phase-00-discovery-and-feasibility.md), [phase-01](phases/phase-01-foundation-and-ci.md). Updated 2026-10-14.

## State

| Item | State |
|---|---|
| Phase 0 | IN_PROGRESS: SOW confirmed final, plan = Basic, workarounds designed; waiting on a dev store and the client pack |
| Phase 1 | IN_PROGRESS: Node 22 (fnm), scaffold, Vitest, Prettier, Playwright and CI workflow built (IN_REVIEW); staging blocked (B-07); Hydrogen advisory migration held, launch blocker (B-12, P1-12) |
| Phases 3B, 4, 6 (early work) | IN_PROGRESS on fixtures and mock.shop, ahead of Phase 3A: home, collection, product, search, cart, quiz, compare and store pages built 2026-10-13 and in independent review; none verified on a dev store (B-13). Gaps are listed in the backlog's Sprint 3 block |
| Phase 4 (offers wiring) | IN_PROGRESS: commit `aa1a23e` wires the offers engine into every cart mutation and a new `/checkout-steps` gate (evaluate, repair, re-evaluate, max 3 passes; uncorrectable violations block the storefront path (our cart, drawer and `/checkout-steps` gate); direct Storefront API carts are detective only (ADR-0006)). Size swap (P4-02), free-delivery progress (P4-07) and the comfort-guarantee step (P4-09, P4-11) built. Offer pickers are placeholders (P4-04 to P4-06); rules come from server-only `OFFER_CONFIG_JSON` until P4-12; haul-away blocks checkout until P3B-11 and P5B-04. Independent review and security re-verification of aa1a23e running |
| Phases 5A and 5B (early work) | IN_PROGRESS on mocks and fakes, 2026-10-14 (commits 1173d79, 6f34eaf, 17e0f0e, d068db6): Extend webhook route `/webhooks/shopify`, `/api/extend/offers` route, coverage seam in the cart gate and `scripts/extend/reconcile.mjs`, all mock-only behind `PUBLIC_EXTEND_ENABLED`; signed `delivery_zip` cookie, `/delivery` route, PDP promise (in-zone yes/no) and the delivery-choice and haul-away steps at `/checkout-steps`. Code review of 1173d79 CHANGES REQUESTED (three Majors, fixed in d068db6); security review PASS WITH CONDITIONS, no High ([REVIEW-2026-10-14-extend-delivery](../docs/security/REVIEW-2026-10-14-extend-delivery.md)). Nothing runs against a dev store or Extend's demo host. Gaps: no browser action adds the coverage line (P5A-05, P5A-07), P5B-05 detective ZIP check not built, owner acceptances B-17 and B-18 outstanding |
| Phase 3B (2026-10-14) | 6f34eaf adds the search combobox, header my-store and server-side ZIP, admin-ordered homepage sections, brand pages, collection promo tiles; guarantee claims hidden until REQ-CNT-001 content. Open in 3B: P3B-06 sitemap and PDP brand links, P3B-10 pickup, P3B-12 reviews (Q-011), P3B-16 |
| Client | Pack drafted, not sent. SD-01 to SD-05, SD-07 await acknowledgement |
| Toolchain | fnm 1.39.0, Node v22.23.3, npm 10.9.9; PowerShell still on Node 25 (use Git Bash) |
| MCP servers | Figma verified connected (not needed now); Playwright awaits interactive approval |

## In progress or next

1. Independent review of 6f34eaf, 17e0f0e and d068db6 (none has its own review; the security reviewer should re-verify the d068db6 fixes to E-M1, E-L1 to E-L7), and the pending re-verification of aa1a23e. Mobile `delivery.spec` has not been re-run after the final fixes.
2. Unbuilt items that need no dev store, in order: **P5B-05** detective shipping-ZIP check (High, needed before the 5B gate, B-17); P5A-05 PDP protection slot and P5A-07 protection step (without them no browser action adds the coverage line); P4-04 to P4-06 real offer pickers; P4-03 PDP add-ons; cart drawer refresh after a ZIP change; P3B-06 sitemap entry and PDP brand link; remove the unused `SearchResultsPredictive.tsx`; document `link_label` and the homepage section types in `SHOPIFY_DATA_MODEL.md` and `scripts/shopify/README.md` (P3A-02 follow-up); the promo bar text and hero copy wait on admin entries (P3B-13).
3. P1-12 Hydrogen 2026.10 migration or a recorded exception: the owner must accept ADR-0008 for development (B-12); remains a launch blocker.
3a. Owner acceptances: B-17 (haul-away ZIP residual, due at the 5B gate) and B-18 (ADR-0006 detective-only limit, due at the 5A and 5B gates), alongside B-12 (ADR-0008). Production configuration prerequisites and the controls that wait on Q-003 are B-19.
4. P0-02 owner sends the client pack; P0-03 development store when a Partner account exists (B-02). This unlocks every dev-store verification (V-02, V-04, V-05) and the move of reviewed tasks to DONE (B-13).
5. (Cleared) Listing price freshness decided: 60s/300s (DEC-024, B-14).

## Exit criteria for Phase 0

See "Acceptance criteria" in the phase plan. Remaining: V-items that need a dev store (V-02, V-03, V-04, V-05, V-07, V-08, V-16 to V-20; the cart work of aa1a23e adds the `cartAttributesUpdate` replace-versus-merge check and the cart-total-equals-checkout-total check), client decisions on hosting and the SD rows.

## Gate status

G1 to G8: not yet evaluated (phases in progress).
