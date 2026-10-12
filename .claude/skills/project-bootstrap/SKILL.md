---
name: project-bootstrap
description: "One-time (or per-machine) bootstrap of the Hydrogen app in storefront/: verifies the Node toolchain, scaffolds Hydrogen with TypeScript and Tailwind without overwriting anything, records resolved versions, reconciles .env.example and runs the baseline checks. Run manually when starting Phase 1 or onboarding a new machine."
disable-model-invocation: true
---

# Project bootstrap

## When to use

Phase 1 tasks P1-01 to P1-04, or when a new developer machine needs the project running. Not for routine feature work. Requires the project owner's approval for any system install (Q-017).

## Steps

1. **Inspect, do not assume.** `git status`; list the repo root; confirm `storefront/` does not exist or is empty. Read `docs/decisions/ADR-0001`, `ADR-0002`, `ADR-0005` and `docs/research/TECH_FEASIBILITY.md` (F-02, F-04, F-05).
2. **Node.** `node --version` must be 22.x (or 24.x). The Hydrogen CLI declares `^22 || ^24`; Node 25 is unsupported. If it is not, stop and ask for approval to install Node 22 LTS side by side; do not change system Node silently. Record the version.
3. **Scaffold into the empty folder only.** From the repo root: `npm create @shopify/hydrogen@latest -- --path storefront --language ts --styling tailwind --markets none --mock-shop --install-deps --no-shortcut`. **Never** pass `--force` unless `storefront/` is empty and you have looked. Read what the prompts and generated files do (telemetry, analytics) before accepting defaults.
4. **Record what you got.** From `storefront/package.json` and the lockfile note the resolved versions of Hydrogen, React Router, Vite, TypeScript, Tailwind and the Shopify CLI packages in `docs/architecture/ARCHITECTURE.md`. Do not upgrade anything; if a version differs from ADR-0002's assumptions, write a note and update the ADR.
5. **Environment.** Compare the scaffold's `.env` variable names with `.env.example`; update `.env.example` (names only, no values) and `docs/deployment/DEPLOYMENT.md`. Create `storefront/.env` only from the scaffold's mock values or leave it unset; never read or print real secrets.
6. **Baseline.** In `storefront/`: install from the lockfile, run the dev server once, then the lint, type check, test and build scripts that exist. Add the missing scripts per P1-04 (`lint`, `format:check`, `typecheck`, `test`, `build`, `e2e`).
7. **Update records.** `plans/BACKLOG.md` task statuses, `progress/STATUS.md`, `progress/TEST_RESULTS.md` with commands and real output, `progress/DECISIONS.md` if anything changed.

## Outputs

A running `storefront/` app on the pinned Node; versions recorded; `.env.example` reconciled; baseline command results recorded; backlog and status updated; no changes to governance files.

## Validation

`node scripts/validate-framework.mjs` passes; `git status` shows only intended additions; the governance files (CLAUDE.md, .claude/, docs/, plans/) are byte-identical to before the scaffold; `npm run build` succeeds and the dev server serves the home page; no secret appears in any tracked file.
