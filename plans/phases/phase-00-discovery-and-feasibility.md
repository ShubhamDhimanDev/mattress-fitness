# Phase 0: Discovery, scope validation and technical feasibility

## Objective

Make sure we build the right thing on a platform that can actually do it. Turn the SOW into a traceable catalogue, get the client questions out early (some providers have lead times), verify the platform capabilities the plan relies on, and settle the architecture baselines before any storefront code exists. **Business outcome:** no later phase is built on an unverified promise, and the client hears about plan or eligibility problems in week one, not at acceptance.

## Scope

In: requirements catalogue, traceability, open-question pack, feasibility experiments on a development store (throwaway scripts), architecture decision records, toolchain readiness, reference-site pattern study (layout and features only), framework verification.
Out: any production storefront code, any change to the client's live store, any provider credentials handling beyond sandbox, any assets or text copied from the reference site (NFR-007).

## Prerequisites

- SOW transcription in the repo ([SCOPE_OF_WORK](../../docs/requirements/SCOPE_OF_WORK.md)) and the original signed PDF when available (Q-001).
- A Shopify development store (Partner account) for experiments (Q-002).
- Approval to install a supported Node.js LTS (Q-017).

## Requirement IDs

REQ-GOV-001

## Architecture and design decisions

- Proposed ADRs 0001 to 0005 ([docs/decisions/](../../docs/decisions/)) are reviewed and set to Accepted or revised.
- Decide the fallback design for each Blocked requirement (Q-006, Q-007) before Phase 4 so interfaces are shaped correctly from the start.
- Decide where verification scripts live (`scripts/feasibility/`, throwaway, never imported by the app).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P0-01 | Transcribe the SOW and build the requirements catalogue, traceability matrix and question list | project-manager | none | `docs/requirements/*` (done in Stage A) |
| P0-02 | Send the consolidated question pack to the client's decision-maker: signed SOW copy, Shopify plan and access, hosting option, design inputs, Extend status, delivery rules, providers (Q-001 to Q-016, Q-018). Ask Extend about the headless model immediately because of review lead time | project-manager | P0-01 | question pack (from OPEN_QUESTIONS.md), tracked in `progress/BLOCKERS.md` |
| P0-03 | Establish the Shopify development store and record the live store's plan (V-01) | solution-architect | Q-002 | note in `docs/research/TECH_FEASIBILITY.md` |
| P0-04 | Prove Storefront API assumptions on the development store: parent lines and their removal behaviour, automatic discounts in carts, metafield filters, metaobject access, pickup availability, customer account setup (V-02 to V-05, V-07, V-08) | shopify-hydrogen-developer | P0-03 | `scripts/feasibility/*` (throwaway) and updated feasibility table |
| P0-05 | Extend: read the "Getting Started" guide, obtain sandbox access, resolve coverage modelling, headless approval and double-sync questions (V-11, V-12, Q-005) | integration-engineer | P0-02 | `docs/integrations/EXTEND.md` updated; ADR-0006 draft |
| P0-06 | Verify Functions, post-purchase and checkout-customisation eligibility for the client's plan; recommend fallbacks for Q-006 and Q-007 (V-10, F-07, F-08) | integration-engineer | P0-03 | recommendation in feasibility file; client decision logged |
| P0-07 | Delivery-zone approach: compare Shopify local-delivery postal codes, shipping profiles and a metaobject list; propose a single source of truth (V-06, Q-008) | solution-architect | P0-03 | `docs/research/DELIVERY_ZONE_OPTIONS.md`; ADR to be accepted in P3A-10 |
| P0-08 | Reference-site pattern study: capture layout and feature patterns as our own notes and wireframe-level descriptions only. No text, images, logos or markup copied | ui-ux-designer | none | `docs/design/REFERENCE_PATTERNS.md` |
| P0-09 | Toolchain readiness: fnm and Node 22 LTS side by side, confirm `npm` (Shopify CLI is used through `npx` in `storefront/`) (Q-017, F-02, F-21) | devops-engineer | Q-017 | verified versions recorded in `progress/STATUS.md` and `progress/TEST_RESULTS.md` |
| P0-10 | Framework verification: `node scripts/validate-framework.mjs`, agents listed, MCP servers approved and authenticated (Figma, Playwright) | project-manager | none | results in `progress/TEST_RESULTS.md` |
| P0-11 | Phase 0 exit review: update risks, set Phase 1 go or no-go | project-manager | P0-02 to P0-10 | updated `plans/RISKS_AND_DEPENDENCIES.md`, `plans/CURRENT_PHASE.md` |

## Dependencies and blockers

Depends on the client for P0-02/03/05 (Q-001, Q-002, Q-005, Q-013) and on the project owner for P0-09 (Q-017). Phase 1 can begin once P0-09 is done even if client answers are pending, because Phase 1 is host-agnostic (ADR-0004); Phases 3A and 4 cannot start without P0-03.

## Security considerations

- Throwaway scripts use a development store only; tokens come from environment variables and never enter the repo.
- Extend sandbox credentials are server-side secrets; never pasted into prompts, docs or logs.
- The reference-site study must not store copies of its pages or assets.

## Testing

Experiments are evidence, not tests: each verified claim in `TECH_FEASIBILITY.md` links to the script, the output and the date. `node scripts/validate-framework.mjs` must pass.

## Acceptance criteria

1. REQ-GOV-001: every V-item needed by Phases 1 to 4 is verified or has a documented fallback and a client decision.
2. The question pack is sent and its status is tracked.
3. ADR-0001 to ADR-0005 are Accepted or revised with reasons.
4. A supported Node version is installed and verified.
5. Framework check passes and MCP approval status is recorded.

## Definition of done

All MASTER_PLAN phase gates (G1 to G8, [MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: the Phase 1 go or no-go is recorded in `progress/DECISIONS.md`.

## Review and sign-off

`qa-engineer` reviews that each verified item has reproducible evidence; `code-reviewer` reviews the scripts (hygiene, no secrets); client decision-maker approves the fallback decisions for Q-006 and Q-007.

## Rollback and recovery

Nothing deployed. If an experiment pollutes the development store, delete the store's test data; the live store is never touched in this phase.
