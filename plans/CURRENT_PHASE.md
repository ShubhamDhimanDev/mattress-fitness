# Current phase

**Phase 0 (closing) and Phase 1 (started).** Plans: [phase-00](phases/phase-00-discovery-and-feasibility.md), [phase-01](phases/phase-01-foundation-and-ci.md). Updated 2026-10-13.

## State

| Item | State |
|---|---|
| Phase 0 | IN_PROGRESS: SOW confirmed final, plan = Basic, workarounds designed; waiting on a dev store and the client pack |
| Phase 1 | IN_PROGRESS: Node 22 (fnm), scaffold, Vitest, Prettier, Playwright and CI workflow built (IN_REVIEW); staging blocked (B-07); Hydrogen advisory migration held, launch blocker (B-12, P1-12) |
| Phases 3B, 4, 6 (early work) | IN_PROGRESS on fixtures and mock.shop, ahead of Phase 3A: home, collection, product, search, cart, quiz, compare and store pages built 2026-10-13 and in independent review; none verified on a dev store (B-13). Gaps are listed in the backlog's Sprint 3 block |
| Phase 4 (offers wiring) | IN_PROGRESS: commit `aa1a23e` wires the offers engine into every cart mutation and a new `/checkout-steps` gate (evaluate, repair, re-evaluate, max 3 passes; uncorrectable violations block the hand-off). Size swap (P4-02), free-delivery progress (P4-07) and the comfort-guarantee step (P4-09, P4-11) built. Offer pickers are placeholders (P4-04 to P4-06); rules come from server-only `OFFER_CONFIG_JSON` until P4-12; haul-away blocks checkout until P3B-11 and P5B-04. Independent review and security re-verification of aa1a23e running |
| Client | Pack drafted, not sent. SD-01 to SD-05, SD-07 await acknowledgement |
| Toolchain | fnm 1.39.0, Node v22.23.3, npm 10.9.9; PowerShell still on Node 25 (use Git Bash) |
| MCP servers | Figma verified connected (not needed now); Playwright awaits interactive approval |

## In progress or next

1. Complete the independent code and security reviews of `aa1a23e` (the security review must re-verify P-M1, P-L1 to P-L4 and P-M2) and apply findings. The `quiz.spec` telemetry failure was fixed (agent-reported).
2. Unbuilt items that need no dev store: P3B-11 server-side delivery ZIP (now on the checkout path: haul-away blocks checkout without it), then P5B-04 haul-away step; P3B-05 promo tiles (REQ-COL-003), P3B-06 brand pages (REQ-COL-005), P3B-10 header "my store" and pickup, P3B-13 homepage section types and copy, the predictive search combobox (P3B-07, needs `layout/HeaderSearch.tsx`), P4-04 to P4-06 real offer pickers, P4-03 PDP add-ons, P5A-05 and P5A-08 Extend UI and webhook route. Decision needed on the header reassurance strip and footer About links that show a comfort and price guarantee the client has not supplied (REQ-CNT-001; needs a layout owner).
3. P1-12 Hydrogen 2026.10 migration or a recorded exception: the owner must accept ADR-0008 for development (B-12); remains a launch blocker.
4. P0-02 owner sends the client pack; P0-03 development store when a Partner account exists (B-02). This unlocks every dev-store verification (V-02, V-04, V-05) and the move of reviewed tasks to DONE (B-13).
5. (Cleared) Listing price freshness decided: 60s/300s (DEC-024, B-14).

## Exit criteria for Phase 0

See "Acceptance criteria" in the phase plan. Remaining: V-items that need a dev store (V-02, V-03, V-04, V-05, V-07, V-08, V-16 to V-20; the cart work of aa1a23e adds the `cartAttributesUpdate` replace-versus-merge check and the cart-total-equals-checkout-total check), client decisions on hosting and the SD rows.

## Gate status

G1 to G8: not yet evaluated (phases in progress).
