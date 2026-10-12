# Phase 1: Repository foundation, project bootstrap and CI

## Objective

Produce a running Hydrogen (TypeScript, Tailwind) storefront in `storefront/` on a supported Node version, with a repeatable local workflow, CI quality gates and a staging pipeline. **Business outcome:** the client gets a live staging link early (REQ-HOST-001) and every later change is checked automatically.

## Scope

In: Node toolchain, git repository, Hydrogen scaffold on `mock.shop`, lint, type check, unit and e2e harness, CI workflow, staging pipeline, proof that the app also builds for plain Node, ADR finalisation.
Out: real Shopify data (Phase 3A), brand styling (Phase 2), any production deployment.

## Prerequisites

Node 22 LTS available (Q-017, P0-09). Staging server access details (we host staging; not yet documented). GitHub remote is **not** required to start (Q-014).

## Requirement IDs

REQ-HOST-001, NFR-006, NFR-012

## Architecture and design decisions

- Layout: governance at the repo root, the app in `storefront/`, repo-level tooling in `scripts/` (ADR-0001). `shopify hydrogen init --force` overwrites its target, so we scaffold only into an empty `storefront/`.
- Stack: Hydrogen on React Router 7 framework mode with Vite, TypeScript, Tailwind (ADR-0002, F-03). Do not upgrade TypeScript or other toolchain packages beyond the template's pins without a passing CI (V-14).
- Package manager: npm, lockfile committed (ADR-0001).
- Host-agnostic until Q-003: use `context.env`, no Oxygen-only APIs outside one adapter file (ADR-0004).
- Test stack: Vitest for unit and integration, Playwright Test for e2e and axe ([TEST_STRATEGY](../../docs/testing/TEST_STRATEGY.md)).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P1-01 | Install and pin Node 22 LTS through fnm; add `.nvmrc` (engines come from the scaffold) | devops-engineer | Q-017 | `.nvmrc`, fnm 1.39.0, Node 22.23.3 |
| P1-02 | Initialise the git repository (`main`), confirm `.gitignore`; first commit only on the owner's request | devops-engineer | none | `.git/` |
| P1-03 | Scaffold Hydrogen: `npm create @shopify/hydrogen@latest -- --path storefront --language ts --styling tailwind --markets none --mock-shop --install-deps --no-shortcut`; record template versions and the env var names it uses; reconcile `.env.example` | shopify-hydrogen-developer | P1-01 | `storefront/**`, updated `.env.example`, ADR-0002 evidence |
| P1-04 | Quality tooling: ESLint, Prettier, `typecheck`, Vitest; scripts `lint`, `format:check`, `typecheck`, `test`, `build`; extend the `.claude/settings.json` allow list for exactly those scripts | shopify-hydrogen-developer | P1-03 | `storefront/package.json`, `storefront/vitest.config.ts` |
| P1-05 | Playwright Test: config with desktop Chrome, mobile Chrome and WebKit projects, trace on first retry, axe helper, one smoke spec against the dev server | qa-engineer | P1-03 | `storefront/playwright.config.ts`, `storefront/tests/e2e/smoke.spec.ts` |
| P1-06 | CI workflow: install, lint, typecheck, unit, build, e2e smoke, `validate-framework`, dependency audit report, secret scan. Each step is run locally first because no remote exists yet | devops-engineer | P1-04, P1-05 | `.github/workflows/ci.yml` |
| P1-07 | Staging pipeline on our server (REQ-HOST-001): approach, deploy script, URL, daily change note | devops-engineer | P1-06, staging access | `docs/deployment/DEPLOYMENT.md` staging section |
| P1-08 | Prove a plain-Node production build and start (V-13) so Option B stays viable and host assumptions are caught early | devops-engineer | P1-03 | spike notes in `docs/research/TECH_FEASIBILITY.md` |
| P1-09 | Reconcile `ARCHITECTURE.md` and ADRs with the real scaffold; set ADR-0001 to ADR-0005 to Accepted | solution-architect | P1-03, P1-08 | updated docs |
| P1-10 | Start the delivery cadence: daily change note template and weekly demo schedule | project-manager | P1-07 | `progress/STATUS.md` |
| P1-12 | Hydrogen dependency advisories: schedule and perform the 2026.10 migration (new template, Storefront API 2026-10, analytics and cart changes) or record the accepted exception; keep `npm audit` reporting in CI with a reviewed allow list (ADR-0008, R-23) | shopify-hydrogen-developer | P1-03, Q-019 | migration branch or ADR-0008 update; clean runtime audit |
| P1-13 | Review template-supplied agent files (`storefront/CLAUDE.md`, `AGENTS.md`, `.cursor/`) and replace `storefront/CLAUDE.md` so it defers to the root rules and does not tell agents to install third-party toolkits | devops-engineer | P1-03 | `storefront/CLAUDE.md` |
| P1-11 | Phase gate review | project-manager | all | gate record in `progress/STATUS.md` |

## Dependencies and blockers

P1-01 blocked by Q-017 (Node install approval). P1-07 blocked until staging server details exist. P1-06 cannot run remotely until Q-014 is resolved; it must pass locally.

## Security considerations

Lockfile committed; `npm audit` reported in CI; no secrets in the scaffold's `.env` (use `.env.example` names only; real values stay local and ignored). Review what `shopify hydrogen init` writes (analytics, telemetry prompts) before accepting defaults.

## Testing

Unit: example Vitest test runs in CI. E2E: smoke spec loads the home page, checks title, no console errors and an axe scan of the shell. CI proves a failing check blocks merge (NFR-012). Record results in [TEST_RESULTS](../../progress/TEST_RESULTS.md).

## Acceptance criteria

1. `npm run dev`, `lint`, `typecheck`, `test`, `build` and the e2e smoke all pass locally on the pinned Node.
2. CI definition runs the same commands; a deliberately failing test is shown to block (NFR-012).
3. A staging URL serves the current main branch (REQ-HOST-001), or the blocker is recorded with a date.
4. The architecture review confirms the storefront has no database of its own (NFR-006).
5. A plain-Node build is demonstrated or its failure is documented with consequences for Q-003.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: ADR-0001 to ADR-0005 are Accepted and the dependency pins are recorded in `docs/architecture/ARCHITECTURE.md`.

## Review and sign-off

`code-reviewer` reviews scaffold changes, tooling and CI; `security-engineer` reviews CI secrets handling and the dependency audit; `solution-architect` signs the architecture baseline; project owner approves go to Phase 2.

## Rollback and recovery

The scaffold is isolated in `storefront/`; recovery is `git revert` or deleting the folder and re-running the scaffold with the recorded flags. Never run the scaffold with `--force` outside an empty `storefront/`.
