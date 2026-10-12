# ADR-0001: Repository layout, package manager and test tooling

- **Status:** Proposed (accept at P1-09)
- **Date:** 2026-10-11
- **Deciders:** project owner (approve), solution-architect
- **Requirements:** NFR-006, NFR-012, REQ-HAND-001
- **Related:** Q-014, Q-017, F-04

## Context

The workspace started empty. It must hold the governance and planning system (Claude Code agents, skills, rules, plans, docs) and a Hydrogen app that the client will own on GitHub (SOW §2, §11). `shopify hydrogen init` scaffolds a whole project and its `--force` flag **overwrites** the destination (F-04), so scaffolding into a directory that already holds our governance files would destroy them. Shopify's documentation and CLI default to npm; pnpm 11.9 is also installed here but nothing requires it.

## Decision

- One repository. Governance, plans and docs at the root; the Hydrogen app in `storefront/`; repo-level tooling (catalog import, Shopify definitions, validation) in `scripts/`; a Shopify app project for Functions in `shopify-app/` only if Phase 5B needs it.
- **npm** with a committed `package-lock.json` inside `storefront/`; no root `package.json` until a root task needs one.
- **Vitest** for unit and integration tests and **Playwright Test** for end-to-end and accessibility, both inside `storefront/`. The root `tests/` directory is not created.
- Scaffold only into an empty `storefront/`, with flags recorded in the phase plan.

## Consequences

Easier: clean ownership boundaries (the client's CI runs inside `storefront/`), no risk to governance files, simple handover. Harder: Shopify tooling must be run from `storefront/`; paths in CI need `working-directory`. If the client prefers the app at the repository root, a move is mechanical but must be done before Phase 2.

## Alternatives considered

Scaffold at the root with `--force`: rejected, destroys files. Scaffold elsewhere and merge: error-prone, and the merge would hide template conflicts. pnpm: workable but adds a non-default tool for the client's team; revisit only if the client asks. A monorepo manager (Turborepo, Nx): unnecessary for one app plus scripts.

## Verification

P1-03 scaffolds into `storefront/` and the governance files are unchanged afterwards; `node scripts/validate-framework.mjs` still passes; CI runs from `storefront/`.
