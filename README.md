# Mattress storefront: headless Shopify (Hydrogen)

A custom, mobile-first storefront for a mattress and bedding retailer, built on Shopify Hydrogen (React, TypeScript, Tailwind CSS). Shopify stays the back end for products, prices, inventory, checkout, customers and orders; this project is the storefront in front of it: product discovery, a sleep quiz, comparison, store locator, accident protection (Extend), add-on offers, delivery services and customer accounts.

The scope is defined by the Scope of Work (SOW): [docs/requirements/SCOPE_OF_WORK.md](docs/requirements/SCOPE_OF_WORK.md). The client owns the repository and all source code.

## Where things stand

The project is in **Phase 0 (closing) and Phase 1 (started)**. The engineering framework (requirements, plans, agents, skills, rules, docs) is in place and `storefront/` holds a Hydrogen scaffold (mock.shop data) whose lint, type check and build pass; **no project features exist yet**. The client's store is on **Shopify Basic**, which changes some SOW promises: see [docs/research/BASIC_PLAN_WORKAROUNDS.md](docs/research/BASIC_PLAN_WORKAROUNDS.md) and [docs/requirements/SOW_DEVIATIONS.md](docs/requirements/SOW_DEVIATIONS.md). Read [progress/STATUS.md](progress/STATUS.md), [plans/CURRENT_PHASE.md](plans/CURRENT_PHASE.md) and [progress/BLOCKERS.md](progress/BLOCKERS.md).

## Quick start

```
cd storefront
npm ci
npm run dev      # http://localhost:3000, mock.shop data until a dev store is connected
npm run lint && npm run typecheck && npm run build
```

Vitest, Playwright Test and `format:check` arrive with tasks P1-04 and P1-05. The Hydrogen version is held on purpose: see [ADR-0008](docs/decisions/ADR-0008-hydrogen-pins-and-advisories.md).

## Repository layout

| Path | What it holds |
|---|---|
| `CLAUDE.md` | Instructions for Claude Code: rules of engagement, workflow, links |
| `.claude/` | Agents, skills, scoped rules and project settings for Claude Code |
| `.mcp.json` | Project MCP servers: Figma and Playwright |
| `docs/requirements/` | SOW transcription, requirement catalogue, traceability matrix, open questions |
| `docs/architecture/`, `docs/decisions/` | Architecture, data model, ADRs |
| `docs/research/`, `docs/integrations/` | Verified platform facts, provider contracts, readiness checklist |
| `docs/security/`, `docs/testing/`, `docs/deployment/`, `docs/design/`, `docs/handover/` | Threat model, test strategy, deployment, Figma workflow, handover |
| `plans/` | Master plan, roadmap, current phase, backlog, risks, acceptance criteria, `phases/` plans |
| `progress/` | Status, decisions log, blockers, test results |
| `scripts/` | Repo tooling; `validate-framework.mjs` checks the framework |
| `storefront/` | The Hydrogen app (scaffolded 2026-10-12; features arrive from Phase 2) |

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

Copy `.env.example` to `storefront/.env` (after Phase 1) and fill it locally. Never commit real values. Variable names and origins: [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md).

## Contributing

Work from a requirement ID and its phase plan; use a feature branch; keep changes small; tests and review before merge; update the progress records. Commit and push only when the project owner asks. See [.claude/rules/git-practices.md](.claude/rules/git-practices.md) and [CLAUDE.md](CLAUDE.md).

## Scope changes

Anything outside the SOW, or listed under its exclusions, needs a written change request and client approval ([plans/MASTER_PLAN.md](plans/MASTER_PLAN.md#change-control)).
