# Mattress storefront: headless Shopify (Hydrogen)

A custom, mobile-first storefront for a mattress and bedding retailer, built on Shopify Hydrogen (React, TypeScript, Tailwind CSS). Shopify stays the back end for products, prices, inventory, checkout, customers and orders; this project is the storefront in front of it: product discovery, a sleep quiz, comparison, accident protection (Extend), add-on offers, delivery services and customer accounts.

The scope is defined by the Scope of Work (SOW): [docs/requirements/SCOPE_OF_WORK.md](docs/requirements/SCOPE_OF_WORK.md). The client owns the repository and all source code.

## Where things stand

As of 2026-10-15 the project is in **Phase 0 (closing) and Phase 1 (started), with early work on Phases 2 to 7** (see [progress/STATUS.md](progress/STATUS.md) for the authoritative state). The engineering framework is in place and `storefront/` holds a working Hydrogen storefront on **mock.shop and fixtures**: catalog pages (home, collection, product, search), cart with offer pickers and a pre-checkout gate, delivery ZIP, quiz, compare, brand pages, SEO and security headers, and Extend protection built against a local mock behind a flag. **None of it has run against a real Shopify store, a real webhook, Extend's demo host or a real proxy; no requirement is verified `PASSING` and nothing is deployed.** Not built: reviews, pickup, signup, chat, customer accounts beyond the template, and Phase 8 onward. The store/quiz/compare pages use sample data until their Shopify readers exist. **Update 2026-10-23:** two features have since been built and unit-tested, and neither has run against a real store, provider account or proxy: the **GA4 and Meta analytics layer with a consent banner** (it loads nothing unless the client's ids are set; [docs/integrations/ANALYTICS.md](docs/integrations/ANALYTICS.md)) and **guest order tracking** at `/track-order` (built against a fake Admin client; needs the `read_orders` token and the client's acknowledgement; [docs/integrations/GUEST_TRACKING.md](docs/integrations/GUEST_TRACKING.md)). The owner's interim hosting answer is a hand-deployed VPS running our own Node server, with no CI ([docs/deployment/VPS_RUNBOOK.md](docs/deployment/VPS_RUNBOOK.md)). The client's store is on **Shopify Basic**, which changes some SOW promises: see [docs/research/BASIC_PLAN_WORKAROUNDS.md](docs/research/BASIC_PLAN_WORKAROUNDS.md) and [docs/requirements/SOW_DEVIATIONS.md](docs/requirements/SOW_DEVIATIONS.md). Read [progress/STATUS.md](progress/STATUS.md), [plans/CURRENT_PHASE.md](plans/CURRENT_PHASE.md) and [progress/BLOCKERS.md](progress/BLOCKERS.md).

## Quick start

Use Git Bash (it loads Node 22 from `.nvmrc` through fnm; PowerShell may still resolve Node 25, which is unsupported).

```
cd storefront
npm ci
# create storefront/.env first (git-ignored): see storefront/DEV_DATA.md for the mock-store values.
# The app refuses to serve without SESSION_SECRET.
npm run dev      # http://localhost:3000, mock.shop data until a dev store is connected
```

Checks, all run in `storefront/`: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test` (Vitest), `npm run build`, `npm run e2e` (Playwright, desktop and mobile Chromium; `E2E_ALL_BROWSERS=1` adds WebKit and Firefox), or `npm run check` for format check, lint, types, tests and build. From the repository root: `node --test "scripts/**/*.test.mjs"` (tooling tests) and `node scripts/validate-framework.mjs`. Environment variables: [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md). Test setup, e2e switches and env files: [docs/testing/PLAYWRIGHT_WORKFLOW.md](docs/testing/PLAYWRIGHT_WORKFLOW.md) and [storefront/DEV_DATA.md](storefront/DEV_DATA.md). Operations and the admin guide for the client: [docs/handover/RUNBOOKS.md](docs/handover/RUNBOOKS.md), [docs/handover/ADMIN_GUIDE.md](docs/handover/ADMIN_GUIDE.md). Catalog import and Shopify definitions tools: [scripts/catalog/README.md](scripts/catalog/README.md), [scripts/shopify/README.md](scripts/shopify/README.md). The Hydrogen version is held on purpose: see [ADR-0008](docs/decisions/ADR-0008-hydrogen-pins-and-advisories.md). These commands were read from `package.json`, not re-run for this edit.

## Repository layout

| Path                                                                                    | What it holds                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                                             | Instructions for Claude Code: rules of engagement, workflow, links                                                                                                                                                                      |
| `.claude/`                                                                              | Agents, skills, scoped rules and project settings for Claude Code                                                                                                                                                                       |
| `.mcp.json`                                                                             | Project MCP servers: Figma and Playwright                                                                                                                                                                                               |
| `docs/requirements/`                                                                    | SOW transcription, requirement catalogue, traceability matrix, open questions                                                                                                                                                           |
| `docs/architecture/`, `docs/decisions/`                                                 | Architecture, data model, ADRs                                                                                                                                                                                                          |
| `docs/research/`, `docs/integrations/`                                                  | Verified platform facts, provider contracts, readiness checklist                                                                                                                                                                        |
| `docs/security/`, `docs/testing/`, `docs/deployment/`, `docs/design/`, `docs/handover/` | Threat model, test strategy, deployment, Figma workflow, handover                                                                                                                                                                       |
| `plans/`                                                                                | Master plan, roadmap, current phase, backlog, risks, acceptance criteria, `phases/` plans                                                                                                                                               |
| `progress/`                                                                             | Status, decisions log, blockers, test results                                                                                                                                                                                           |
| `scripts/`                                                                              | `validate-framework.mjs`; `catalog/` (product sheet validator and importer), `shopify/` (definitions and delivery parity), `extend/` (reconcile), `detective/` (order report), `mocks/` (local Extend mock), `node-server/` (plain Node entry for the built storefront, ADR-0011; `npm run start:node` in `storefront/`), `spikes/` (Option B spike, superseded) |
| `deploy/`                                                                               | Example systemd unit, nginx site and environment-file templates for the VPS (names only, never values; see [docs/deployment/VPS_RUNBOOK.md](docs/deployment/VPS_RUNBOOK.md)) |
| `storefront/`                                                                           | The Hydrogen app (`app/`, `server.ts`, `tests/`); `DEV_DATA.md` explains the mock-store setup                                                                                                                                           |

## Prerequisites

- **Node.js 22 LTS through fnm** (the Hydrogen CLI declares `^22 || ^24`; Node 25 is unsupported). `.nvmrc` pins 22. Install fnm (`winget install Schniz.fnm`), then `fnm install 22`. Git Bash: add `eval "$(fnm env --use-on-cd --shell bash)"` to `~/.bashrc` (see the maintainer's setup in [ADR-0005](docs/decisions/ADR-0005-node-runtime.md)). PowerShell needs `fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression` in its profile.
- npm (the project's package manager, [ADR-0001](docs/decisions/ADR-0001-repository-layout-and-tooling.md)), Git, and a Shopify development store for anything beyond the mock shop.
- Claude Code (CLI or the VS Code extension) to use the AI team.

## Working with the AI team

Open the project in Claude Code. The main session acts as the orchestrator and delegates to the agents in `.claude/agents/` (project manager, architect, Hydrogen developer, UI/UX designer, integration engineer, QA, security, code reviewer, DevOps, technical writer). Repeatable procedures are skills; invoke one with `/<skill-name>` (for example `/phase-planning 3B`). The workflow, phase gates and rules are in [plans/MASTER_PLAN.md](plans/MASTER_PLAN.md).

### Connect the MCP servers (one-time, per person)

`.mcp.json` defines `figma` (https://mcp.figma.com/mcp) and `playwright` (`@playwright/mcp@0.0.83 --isolated`). Claude Code asks you to approve project servers the first time. Open a new session, run `/mcp`, approve both; if **figma** shows unauthenticated, select it and **Authenticate** (browser OAuth). Figma is used read-only and your Figma plan's call limit applies (the connected account had 20 read calls per month at setup). Never put Figma credentials in the repository. Details: [docs/design/FIGMA_WORKFLOW.md](docs/design/FIGMA_WORKFLOW.md), [docs/testing/PLAYWRIGHT_WORKFLOW.md](docs/testing/PLAYWRIGHT_WORKFLOW.md).

## Checking the framework

```
node scripts/validate-framework.mjs
```

Validates agents, skills, rules, settings, MCP config, requirement traceability (every requirement is in exactly one phase plan and in the test matrix), backlog, links, and scans for committed secrets. Add `--ids-by-phase` to list requirements per phase.

## Environment and secrets

To run against a demo store with no third-party services, follow [docs/deployment/DEMO_STORE_SETUP.md](docs/deployment/DEMO_STORE_SETUP.md) (`node scripts/setup/demo-env.mjs --mock` writes the environment file for you). Otherwise copy `.env.example` (it lists names only) to `storefront/.env` and fill it locally, or use the mock-store values in `storefront/DEV_DATA.md`. Never commit real values; every `.env*` file except `.env.example` is git-ignored. Variable names, origins and what fails without each one: [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md).

## Contributing

Work from a requirement ID and its phase plan; use a feature branch; keep changes small; tests and review before merge; update the progress records. Commit and push only when the project owner asks. See [.claude/rules/git-practices.md](.claude/rules/git-practices.md) and [CLAUDE.md](CLAUDE.md).

## Scope changes

Anything outside the SOW, or listed under its exclusions, needs a written change request and client approval ([plans/MASTER_PLAN.md](plans/MASTER_PLAN.md#change-control)).
