# ADR-0005: Pin Node.js 22 LTS for development and CI

- **Status:** Accepted (owner approved on 2026-10-12; installed)
- **Date:** 2026-10-11
- **Deciders:** project owner, devops-engineer
- **Requirements:** NFR-012
- **Related:** F-02, D-01, Q-017, R-05

## Context

This machine runs Node v25.8.2 (an odd-numbered, non-LTS release). `@shopify/cli-hydrogen` 13.0.6 and `@shopify/mini-oxygen` 4.2.3 declare `engines.node: ^22 || ^24`, and `@shopify/cli` 4.9.3 declares `>=22.12.0` (F-02). Shopify's getting-started page still says Node 16.20+, which is stale (D-01). No version manager (nvm, fnm, volta) is installed.

## Decision

**Implemented 2026-10-12:** `fnm` 1.39.0 (winget, user scope) and Node **v22.23.3** (npm 10.9.9) as the default alias; `.nvmrc` contains `22`; Git Bash loads fnm from `~/.bashrc`. PowerShell was not changed (execution policy) and still resolves the system Node 25 unless fnm is initialised in the PowerShell profile (`fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression`). Commands run by agents use Git Bash with the fnm Node first on PATH.

Original decision:

Standardise on **Node 22 LTS** (the lowest supported major, so it also satisfies the `>=22.12.0` floor), recorded in `.nvmrc`, the app's `engines` and CI. Install it side by side with Node 25 through a version manager or the official installer, **only after the owner approves the system change**. Re-evaluate Node 24 LTS when the template or Oxygen runtime moves.

## Consequences

Easier: reproducible builds, supported local dev server. Harder: one-time setup on every developer machine; a version manager is recommended.

## Alternatives considered

Stay on Node 25: outside the declared range, so dev-server breakage would be unsupported by Shopify. Node 24: also supported; pick it if the template requires it. Containerised dev: heavier than needed.

## Verification

P0-09 records `node --version` and a successful `shopify hydrogen --help` (or `npm create` dry run) on the pinned version; CI uses the same version.

## Implementation note (2026-10-15, as built)

`.nvmrc` is `22`, `storefront/package.json` declares `engines.node` `^22 || ^24`, and project commands run from Git Bash with fnm's Node 22.23.3 first on PATH (CLAUDE.md). Whether a CI workflow pins the same version is for the devops-engineer's record (DEPLOYMENT.md); this ADR makes no claim about it.
