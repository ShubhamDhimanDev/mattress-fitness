# Current phase

**Phase 0 (closing) and Phase 1 (started).** Plans: [phase-00](phases/phase-00-discovery-and-feasibility.md), [phase-01](phases/phase-01-foundation-and-ci.md). Updated 2026-10-13.

## State

| Item | State |
|---|---|
| Phase 0 | IN_PROGRESS: SOW confirmed final, plan = Basic, workarounds designed; waiting on a dev store and the client pack |
| Phase 1 | IN_PROGRESS: Node 22 (fnm), scaffold, Vitest, Prettier, Playwright and CI workflow built (IN_REVIEW); staging blocked (B-07); Hydrogen advisory migration held, launch blocker (B-12, P1-12) |
| Phases 3B, 4, 6 (early work) | IN_PROGRESS on fixtures and mock.shop, ahead of Phase 3A: home, collection, product, search, cart, quiz, compare and store pages built 2026-10-13 and in independent review; none verified on a dev store (B-13). Gaps are listed in the backlog's Sprint 3 block |
| Client | Pack drafted, not sent. SD-01 to SD-05, SD-07 await acknowledgement |
| Toolchain | fnm 1.39.0, Node v22.23.3, npm 10.9.9; PowerShell still on Node 25 (use Git Bash) |
| MCP servers | Figma verified connected (not needed now); Playwright awaits interactive approval |

## In progress or next

1. Fix the failing `quiz.spec` full run (console CSP telemetry error); complete the independent code and security reviews of commits 8c533e2 and 46e64a2 and apply findings.
2. Unbuilt page items that need no dev store: P3B-05 promo tiles (REQ-COL-003), P3B-06 brand pages (REQ-COL-005), P3B-10 header "my store" and pickup, P3B-13 homepage section types and copy, the predictive search combobox (P3B-07, needs `layout/HeaderSearch.tsx`), P4-09 and P4-11 pre-checkout steps and revalidation wiring, P5A-05 and P5A-08 Extend UI and webhook route.
3. P1-12 Hydrogen 2026.10 migration or a recorded exception: the owner must accept ADR-0008 for development (B-12); remains a launch blocker.
4. P0-02 owner sends the client pack; P0-03 development store when a Partner account exists (B-02). This unlocks every dev-store verification (V-02, V-04, V-05) and the move of reviewed tasks to DONE (B-13).
5. Owner or client decision on listing price freshness (DEC-024, B-14).

## Exit criteria for Phase 0

See "Acceptance criteria" in the phase plan. Remaining: V-items that need a dev store (V-02, V-03, V-04, V-05, V-07, V-08, V-16 to V-20), client decisions on hosting and the SD rows.

## Gate status

G1 to G8: not yet evaluated (phases in progress).
