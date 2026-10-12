# Backlog (dependency-aware, rolling wave)

Task definitions live in the phase plans ([plans/phases/](phases/)). This file is the **single place where task status is tracked**, for tasks that are active (the current phase, the next phase and anything already started). Tasks not listed here are implicitly `TODO` and defined only in their phase plan. Status vocabulary and gates: [MASTER_PLAN](MASTER_PLAN.md). Updated 2026-10-12.

`Depends on` lists task IDs (validated by `scripts/validate-framework.mjs`) and open items (`Q-*`, `CLR-*`, `G-*`). Priority: High (on the critical path or blocks others), Med, Low.

## Sprint 1 (Phase 0 and Phase 1 start): state after the owner's answers

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P0-01 | Transcribe SOW; requirements catalogue, traceability, question list | 0 | project-manager | none | IN_REVIEW | High | Owner confirmed the SOW is final (Q-001). Still to do: place the PDF in `docs/requirements/source/` and diff the transcription |
| P0-02 | Send consolidated question pack to the client's decision-maker | 0 | project-manager | P0-01 | IN_REVIEW | High | Drafted: `docs/requirements/CLIENT_QUESTION_PACK.md` (plain language). Owner reviews and sends; Extend questions go with it |
| P0-03 | Establish the Shopify development store; confirm the live store's plan | 0 | solution-architect | Q-002 | BLOCKED | High | Plan is **Basic** (owner). Still needs a Partner account or collaborator access to create or reach a store |
| P0-04 | Prove Storefront API assumptions on the development store | 0 | shopify-hydrogen-developer | P0-03 | BLOCKED | High | V-02, V-03, V-04, V-05, V-07, V-08, V-16, V-17 |
| P0-05 | Extend: written answers and demo credentials | 0 | integration-engineer | P0-02 | BLOCKED | Med | **Building does not wait for this** (ADR-0009); only go-live does |
| P0-06 | Verify Functions, post-purchase and checkout eligibility for the plan; recommend fallbacks | 0 | integration-engineer | none | IN_REVIEW | High | Done by research: [BASIC_PLAN_WORKAROUNDS](../docs/research/BASIC_PLAN_WORKAROUNDS.md), ADR-0006, SOW_DEVIATIONS. Needs independent review and client acknowledgement |
| P0-07 | Delivery-zone approach comparison (research) | 0 | solution-architect | none | IN_REVIEW | Med | `DELIVERY_ZONE_OPTIONS.md`; single zone decided by the owner, ADR-0007 proposed |
| P0-08 | Reference-site pattern notes (layout and features only) | 0 | ui-ux-designer | none | IN_REVIEW | Low | `REFERENCE_PATTERNS.md`, extended with a visual-structure study; needs review for NFR-007 |
| P0-09 | Install and verify Node 22 LTS side by side | 0 | devops-engineer | Q-017 | DONE | High | fnm 1.39.0 and Node v22.23.3 installed with owner approval; evidence in `progress/TEST_RESULTS.md` |
| P0-10 | Framework verification: validation script, agents listed, MCP approval | 0 | project-manager | none | IN_PROGRESS | High | Script passes; Claude Code loads agents and skills (F-17); Figma verified; owner must approve the project MCP servers and confirm Playwright connects (B-04) |
| P0-11 | Phase 0 exit review and Phase 1 go or no-go | 0 | project-manager | P0-02, P0-07, P0-09, P0-10 | TODO | Med | |
| P1-01 | Pin Node 22 LTS through fnm; add `.nvmrc` | 1 | devops-engineer | P0-09 | DONE | High | `.nvmrc` = 22; scaffold `engines` is `^22 \|\| ^24` |
| P1-02 | Initialise git repository on `main` | 1 | devops-engineer | none | DONE | Low | No commits yet (commit only on the owner's request) |
| P1-03 | Scaffold Hydrogen into `storefront/` (TypeScript, Tailwind, mock shop) | 1 | shopify-hydrogen-developer | P1-01 | IN_REVIEW | High | Done 2026-10-12 with the recorded flags; lint, typecheck, build pass; nested `.git` removed. Needs independent review |
| P1-04 | Quality tooling: Vitest, Prettier check, scripts | 1 | shopify-hydrogen-developer | P1-03 | TODO | High | Next |
| P1-05 | Playwright Test setup, axe helper and smoke spec | 1 | qa-engineer | P1-03 | TODO | High | Next |
| P1-06 | CI workflow (verified locally first) | 1 | devops-engineer | P1-04, P1-05 | TODO | High | No remote yet (Q-014) |
| P1-07 | Staging pipeline on our server | 1 | devops-engineer | P1-06 | BLOCKED | Med | Staging server details not provided |
| P1-08 | Prove a plain-Node build (Option B viability) | 1 | devops-engineer | P1-03 | TODO | Med | V-13; seams are `server.ts`, `app/lib/context.ts`, `vite.config.ts` |
| P1-09 | Reconcile architecture docs and ADRs with the scaffold | 1 | solution-architect | P1-03, P1-08 | TODO | Med | |
| P1-10 | Daily change-note template and weekly demo cadence | 1 | project-manager | none | TODO | Low | |
| P1-12 | Hydrogen dependency advisories and the 2026.10 migration | 1 | shopify-hydrogen-developer | P1-03, Q-019 | BLOCKED | High | Needs an initial commit (the upgrade tool requires a clean branch) or a hand migration; ADR-0008, R-23; must precede Phase 3B feature code |
| P1-13 | Review template-supplied agent files; replace `storefront/CLAUDE.md` | 1 | devops-engineer | P1-03 | IN_REVIEW | Med | Written; template `AGENTS.md` left as reference, not followed |
| P1-11 | Phase 1 gate review | 1 | project-manager | P1-04, P1-05, P1-06, P1-07, P1-08, P1-09, P1-10, P1-12, P1-13 | BLOCKED | Med | |

## Sprint 2 (proposed, unblocked first)

| ID | Task | Phase | Owner | Depends on | Status | Priority | Notes |
|---|---|---|---|---|---|---|---|
| P2-01 | Brand kit and neutral placeholder tokens (no Figma expected) | 2 | ui-ux-designer | P0-02 | TODO | Med | Reference-site patterns, own brand; tokens swapped when CLR-013 arrives |
| P5A-03 | Local mock server of Extend's documented subset | 5A | integration-engineer | P1-04 | TODO | High | Lane C, starts without the client's account (owner decision) |
| P5A-04 | Offers client, price-point matching, feature flag | 5A | integration-engineer | P5A-03 | TODO | High | After P5A-03 |
| P3A-10 | Delivery-zone single source of truth (ADR-0007 accepted) | 3A | solution-architect | P0-07 | TODO | Med | Needs the ZIP list (Q-008) |

## Placeholders and mocks to retire

Tracked so nothing mock ships. The scaffold runs on **mock.shop** (`MockShopNotice` component, mock environment values); retired in P3A-01 when the dev store is connected. Every other mock added gets a row with the task that removes it.

## Change-request candidates (not in scope; need written client approval)

| ID | Candidate | Source | Note |
|---|---|---|---|
| CR-01 | Static design mockups or Figma design work | EXC-09 | Only if the client wants designs before build |
| CR-02 | Online booking of delivery time windows | EXC-04 | |
| CR-03 | Automated email and SMS flows | EXC-03 | Signup forms are in scope |
| CR-04 | Import of existing customer reviews | EXC-05 | |
| CR-05 | Shopify Plus upgrade or an App-Store-reviewed app of our own, for in-checkout enforcement | SD-01, ADR-0006 | Client cost decision, not ours |
| CR-06 | Copywriting beyond product copy (content pages, blog) | EXC-10 | |
| CR-07 | Ongoing maintenance and hosting upkeep after handover | EXC-13 | Mandatory conversation under Option B (SOW §3) |
| CR-08 | Replace in-checkout haul-away Function with layered enforcement (SD-01) | SOW §5 | Awaiting client acknowledgement |
| CR-09 | Post-purchase and thank-you offers through a client-paid App Store app, or drop (SD-02, SD-03) | SOW §5 | Awaiting client choice |
| CR-10 | Local delivery wallet-button limitation (SD-04) | SOW §7 | Awaiting client acknowledgement |
| CR-11 | Guest order tracking limited to 60 days (SD-05) | SOW §4 | Awaiting client acknowledgement |
| CR-12 | Single delivery zone (SD-07); extra zones later | SOW §7 | Owner chose one zone; client acknowledgement |
| CR-13 | App Store quantity-limit app as an extra haul-away layer (client-paid) | SD-01 | Optional |
| CR-14 | Financing messages hidden until provider details exist (SD-11) | SOW §5, §7 | Awaiting client acknowledgement |
