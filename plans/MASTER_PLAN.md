# Master implementation plan

Headless Shopify storefront (Hydrogen) for a mattress and bedding catalog. Source of truth for scope: [SCOPE_OF_WORK](../docs/requirements/SCOPE_OF_WORK.md). Requirements, statuses and acceptance criteria: [REQUIREMENTS](../docs/requirements/REQUIREMENTS.md). Sequencing and critical path: [ROADMAP](ROADMAP.md). Current position: [CURRENT_PHASE](CURRENT_PHASE.md).

## Phases

The ten-phase sequence requested for this project is kept, with three dependency-driven changes (marked **changed**). No in-scope feature was removed; the validation script proves every requirement is assigned to exactly one phase.

| Phase | Title | Plan | Requirements | Status |
|---|---|---|---|---|
| 0 | Discovery, scope validation and technical feasibility | [plan](phases/phase-00-discovery-and-feasibility.md) | 1 | In progress: research and records done; dev store, Extend answers and client pack outstanding (tasks blocked) |
| 1 | Repository foundation, project bootstrap and CI | [plan](phases/phase-01-foundation-and-ci.md) | 3 | In progress: built, unverified (scaffold, tests, CI workflow in review); staging and the ADR-0008 migration blocked |
| 2 | Design system, shared UI components, responsive shell, Figma alignment | [plan](phases/phase-02-design-system-and-shell.md) | 3 | In progress: built, unverified (components and shell exist; client approval of the look and design review not done) |
| 3A **changed** | Shopify connectivity, data model and catalog import | [plan](phases/phase-03a-shopify-connectivity-and-catalog-data.md) | 8 | In progress: built on fakes, unverified (definitions, validator, importer; no dev store, no live run) |
| 3B **changed** | Catalog experience: menu, collections, filters, search, product pages, homepage | [plan](phases/phase-03b-catalog-experience.md) | 16 | In progress: built, unverified (pages on mock.shop and fixtures; reviews, pickup and brand links open) |
| 4 | Cart, matching add-ons, bundles, gifts and pre-checkout offers | [plan](phases/phase-04-cart-and-pre-checkout-offers.md) | 16 | In progress: built, unverified (cart, offers engine and gate; offer pickers are placeholders) |
| 5A **changed** | Extend accident protection (built against a local mock; go-live needs the client account) | [plan](phases/phase-05a-extend-protection.md) | 8 | In progress: built on the mock, unverified; PDP slot and protection step in progress; go-live gated |
| 5B **changed** | Delivery eligibility, haul-away, checkout configuration and post-purchase options (Basic plan, no Functions) | [plan](phases/phase-05b-delivery-functions-and-checkout.md) | 11 | In progress: partly built, unverified (eligibility, ZIP, steps, parity script); detective check and all checkout configuration open |
| 6 | Sleep quiz, comparison, store locator, customer journeys and content pages | [plan](phases/phase-06-quiz-compare-stores-account-content.md) | 15 | In progress: partly built, unverified (quiz, compare, stores on fixtures); account and content pages not built |
| 7 | Analytics, SEO, accessibility, performance and security hardening | [plan](phases/phase-07-analytics-seo-a11y-performance-security.md) | 10 | NOT_STARTED (hardening items recorded as carry-overs) |
| 8 | End-to-end acceptance testing, UAT and defect resolution | [plan](phases/phase-08-acceptance-and-uat.md) | 5 | NOT_STARTED |
| 9 | Production deployment, launch verification and handover | [plan](phases/phase-09-launch-and-handover.md) | 8 | NOT_STARTED |

No phase is marked complete and gates G1 to G8 have not been passed for any phase; "built, unverified" means code exists but nothing has run against a dev store or the Extend demo host. For the current task counts per phase see "Completion by phase" in [STATUS](../progress/STATUS.md#completion-by-phase-2026-10-15).

**Why the changes.** Phase 3 split: the catalog import and data model is a client-dependent, tool-building deliverable that everything else reads, while the shopping pages are UI work with a different risk profile. Phase 5 split: Extend depends on a third party (Q-005) and must not hold up delivery, haul-away and checkout configuration; checkout configuration was added to 5B because delivery and payment rules take effect there. The delivery-zone data-model decision moves earlier (P3A-10) so 5B implements a decided design. See [ROADMAP](ROADMAP.md#reordering-decisions).

## Phase gates

A phase cannot be marked complete until **all** of these hold. The orchestrator verifies; no agent may self-certify.

| Gate | Condition | Evidence |
|---|---|---|
| G1 | Acceptance criteria of every requirement in the phase are met | Traceability rows `PASSING`, linked in [TEST_RESULTS](../progress/TEST_RESULTS.md) |
| G2 | Applicable automated tests pass (lint, type check, unit, integration, e2e) | CI run or local run output recorded |
| G3 | `qa-engineer` has reviewed the relevant behaviour | QA report |
| G4 | `code-reviewer` has independently reviewed significant changes | Review report with findings and their resolution |
| G5 | Security checks completed where applicable (`security-engineer`) | Security review note |
| G6 | Known defects and limitations documented | [BLOCKERS](../progress/BLOCKERS.md) and the phase plan |
| G7 | Documentation and progress records updated (requirements status, traceability, decisions, status) | Diffs |
| G8 | Required approvals recorded (client or project owner) | Entry in [DECISIONS](../progress/DECISIONS.md) |

Never bypass a failing test to close a phase. Never deploy or publish production changes automatically; production actions need explicit, recorded human approval.

## Task status vocabulary

`TODO`, `IN_PROGRESS`, `BLOCKED` (state the blocker and who can clear it), `IN_REVIEW` (work complete, awaiting independent review), `DONE` (reviewed, verified, evidence linked). Generating code never makes a task DONE.

**Where status lives.** Phase plans define tasks (ID, owner, dependencies, outputs). [BACKLOG](BACKLOG.md) tracks status for tasks as they become active (rolling wave: the current and next phase). Tasks not in the backlog are implicitly `TODO`. This keeps one source of truth for status.

## Development workflow (every unit of work)

1. Read `CLAUDE.md` and the scoped rules that apply to the files you will touch.
2. Read the current phase plan and the relevant requirements.
3. `project-manager` identifies dependencies and task boundaries and confirms the work is in scope.
4. `solution-architect` reviews anything that changes system boundaries, data flow or an integration contract (and writes an ADR).
5. The orchestrator assigns bounded work to specialist agents with explicit file ownership; no two agents edit the same files at once.
6. Implement the smallest coherent unit.
7. Run format, lint, type check and the applicable tests.
8. Verify browser behaviour with Playwright where appropriate (MCP for exploration, Playwright Test for repeatable checks).
9. `code-reviewer` reviews independently; `security-engineer` and `qa-engineer` as the gate requires.
10. Fix findings and rerun the affected checks.
11. Update requirement status, traceability, backlog, decisions and status files.
12. Report: what was completed, the evidence, remaining risks and the next actionable task.

Parallelise only independent research or implementation with clear file ownership. The orchestrator integrates results and verifies completion; agents do not spawn agents.

## Change control

Anything not traceable to a requirement ID, or matching an exclusion (EXC-01 to EXC-13), is a change request: record it in [BACKLOG](BACKLOG.md) under *Change-request candidates*, estimate effect, and wait for written client approval (SOW §11). Do not implement it speculatively.
