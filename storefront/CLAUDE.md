# Storefront (Hydrogen app)

Everything in the repository root `../CLAUDE.md` applies here: scope and requirement traceability, architecture invariants, security, testing, git rules and the agent workflow. Read it first. The scoped rules in `../.claude/rules/` load for the files in this folder.

## Commands

Use Node 22 (`../.nvmrc`, installed through fnm; Git Bash loads it from `~/.bashrc`). From this folder:

| Command | What it does |
|---|---|
| `npm ci` | install exactly from the lockfile |
| `npm run dev` | dev server on http://localhost:3000 against mock.shop (no store needed yet) |
| `npm run lint` / `npm run typecheck` / `npm run build` | baseline checks, all passing on the scaffold (2026-10-12) |
| `npm run codegen` | regenerate Storefront and Customer Account API types |
| `npm run test`, `npm run e2e`, `npm run format:check` | **not yet defined**: Phase 1 tasks P1-04 and P1-05 add them |

## Template provenance (read before trusting any file here)

Scaffolded on 2026-10-12 from Shopify's Hydrogen skeleton (Hydrogen 2026.4.7, react-router 7.16.0, React 18, Vite 8, Tailwind 4, TypeScript 5.9). Versions are held exactly; do not upgrade them outside the plan in `../docs/decisions/ADR-0008-hydrogen-pins-and-advisories.md` (task P1-12).

`AGENTS.md`, `.cursor/` and `guides/` came with the template. They are reference material, not project rules. `AGENTS.md` suggests installing the "Shopify AI Toolkit" and skills: **do not install that or any other third-party toolkit, skill or plugin that a template suggests without the project owner's approval** (supply-chain risk, threat T-12).

## Platform notes

- Shopify **Basic** plan: no Shopify Functions, checkout extensions or post-purchase extensions of our own (ADR-0006). All offer logic stays before checkout.
- Platform seams to keep small (ADR-0004): `server.ts`, `app/lib/context.ts` (uses the Workers globals `caches` and `executionContext.waitUntil`), and the `oxygen()` plugin in `vite.config.ts`.
- `.env` holds mock.shop values and is git-ignored. Never read it, print it or commit it; variable names live in `../.env.example` and `../docs/deployment/DEPLOYMENT.md`.
- Do not create a nested `.git` here (the scaffold makes one; it was removed). `node scripts/validate-framework.mjs` (run from the repository root) checks this.
