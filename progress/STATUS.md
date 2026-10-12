# Project status

Updated 2026-10-12 (after the owner's answers, the Basic-plan research and the Hydrogen scaffold).

## Summary

**Phase 0 closing, Phase 1 started.** Node 22 is installed (fnm), the Hydrogen storefront is scaffolded in `storefront/` on mock.shop and its lint, type check and build pass. The owner's answers are recorded: SOW final, **Shopify Basic**, everything pre-checkout, single delivery zone, Extend built regardless of the client's account, design follows the reference site. The Basic plan forces six SOW changes, listed in [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md) with a client-facing pack ready to send. One engineering risk is open: the scaffold's react-router has known advisories (ADR-0008).

## What exists

| Area | State |
|---|---|
| Requirements | 104 requirements (91 functional, 13 non-functional); statuses revised 2026-10-12; 18 client responsibilities, 13 exclusions, 10 assumptions |
| Open questions | Q-001 to Q-019: answered or decided where the owner gave direction; remaining client data is in the pack |
| Basic-plan analysis | [BASIC_PLAN_WORKAROUNDS](../docs/research/BASIC_PLAN_WORKAROUNDS.md) (16 workarounds), [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md) (SD-01 to SD-10), [CLIENT_QUESTION_PACK](../docs/requirements/CLIENT_QUESTION_PACK.md), ADR-0006 to ADR-0009 |
| Plans | Master plan, roadmap, 12 phase plans (142 tasks), backlog, risk register (26 risks), acceptance criteria |
| Claude Code framework | 10 agents, 15 skills, 6 rules, project settings; validator `scripts/validate-framework.mjs` now also checks the toolchain |
| Docs | Architecture, data model, 9 ADRs, feasibility file (41 verified facts F-01 to F-41, 4 source discrepancies, 25 open verifications), integration contracts, Extend contract, readiness checklist, threat model, test strategy, deployment, handover, reference-site patterns |
| Code | `storefront/`: Hydrogen scaffold only (Hydrogen 2026.4.7, react-router 7.16.0, React 18, Vite 8, Tailwind 4, TypeScript 5.9). No project features yet |
| Repository | git on `main`, **no commits** (owner decides when) |

## Environment (verified 2026-10-12)

| Item | Value |
|---|---|
| Node via fnm | v22.23.3, npm 10.9.9 (fnm 1.39.0). Git Bash loads it from `~/.bashrc`. PowerShell still resolves system Node 25.8.2 until fnm is added to its profile |
| Not installed | Shopify CLI (used through `npx shopify` inside `storefront/`), GitHub CLI |
| Claude Code | extension 2.1.296 (bundled `claude.exe`) |

## MCP servers

| Server | Configured | Connected |
|---|---|---|
| Figma | `.mcp.json` | Connected and authenticated in a headless run (read-only policy; View seat, 20 calls per month). Not needed now: no Figma file expected |
| Playwright (`@playwright/mcp@0.0.83 --isolated`) | `.mcp.json` | Not connected in Claude Code yet (approval pending); server itself works over stdio |

## Next actions (in order)

1. **Owner:** review and send [CLIENT_QUESTION_PACK](../docs/requirements/CLIENT_QUESTION_PACK.md); create or share a Shopify Partner account so we can make a development store (B-02).
2. **Owner:** approve the project MCP servers with `/mcp` (B-04); authorise the first commit when ready (B-10).
3. **Agents (unblocked):** P1-04 Vitest and Prettier scripts, P1-05 Playwright Test harness, P1-08 plain-Node build proof, P5A-03 Extend mock server, P2-01 neutral tokens.
4. **Review:** independent review of P1-03, P0-06, P0-07, P0-08, P1-13 (still IN_REVIEW).

## Gate status

Phase 0: not yet evaluated (blocked items remain). No phase gate has been passed.
