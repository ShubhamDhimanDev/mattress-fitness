# Test and verification results

Every entry records the command, the date, what it ran against and the **actual** result. Failures are recorded as failures. Link traces, screenshots and order IDs here; the traceability matrix ([TRACEABILITY](../docs/requirements/TRACEABILITY.md)) points to this file as evidence. Application tests do not exist yet (no storefront code); this log currently holds framework and environment verification from Stage A.

## Framework and environment verification, 2026-10-11

| # | What | Command or method | Result |
|---|---|---|---|
| V-A1 | Environment inventory | `node --version`, `npm --version`, `pnpm --version`, `git --version`, `yarn`, `claude`, `gh`, `shopify` | Node v25.8.2, npm 11.11.1, pnpm 11.9.0, git 2.53.0; yarn, `claude` on PATH, gh and Shopify CLI **not found**; workspace was empty and not a git repository |
| V-A2 | SOW document on disk | Glob for `*.pdf` in the project and `c:\tmp` | **None found.** SOW transcribed from the attachment |
| V-A3 | Registry versions and engines | `npm view` for Hydrogen, Shopify CLI, cli-hydrogen, mini-oxygen, hydrogen-react, Playwright, Playwright MCP, Tailwind, react-router, TypeScript | See F-01 to F-03 in TECH_FEASIBILITY; **Node 25 is outside `^22 \|\| ^24`** |
| V-A4 | MCP servers added | `claude mcp add --scope project --transport http figma https://mcp.figma.com/mcp`; `claude mcp add --scope project playwright -- npx @playwright/mcp@0.0.83 --isolated` (bundled `claude.exe` 2.1.296) | Both written to `.mcp.json` |
| V-A5 | MCP health from the CLI | `claude mcp list` | `claude.ai Claude Docs` connected; `figma` and `playwright` **Pending approval** (interactive approval required) |
| V-A6 | Playwright MCP package | `npx -y @playwright/mcp@0.0.83 --version` | `Version 0.0.83`, exit 0 |
| V-A7 | Playwright MCP over stdio | Node script spawning `cmd /c npx @playwright/mcp@0.0.83 --isolated --headless`, sending `initialize` and `tools/list` | `initialize` OK (server Playwright 1.64.0), **25 tools** listed |
| V-A8 | Claude Code loads agents and skills | `claude -p ... --output-format stream-json --verbose` (haiku, one turn), parse the init event | All **10 agents** and **15 skills** present; built-in `code-review` and `security-review` still present; MCP: `figma` connected, `playwright` pending, Claude Docs connected |
| V-A9 | Figma authentication | headless `claude -p` allowing only `mcp__figma__whoami` | Returned an account: **authenticated**; plan Starter, seat View (20 read calls per month, F-16) |
| V-A10 | Git | `git init -b main`; `git status --short`; `git check-ignore -v .env .env.example .claude/settings.local.json` | Repository initialised on `main`, no commits; `.env` and `settings.local.json` ignored, `.env.example` tracked |

## Framework validation script

| # | Command | Result |
|---|---|---|
| V-B1 | `node scripts/validate-framework.mjs` (first run, before README, STATUS and this file existed) | 13 errors: exactly the three then-missing files and the ten links to them. No agent, skill, rule, requirement, plan or traceability error |
| V-B2 | `node scripts/validate-framework.mjs --ids-by-phase` | 104 requirement IDs grouped across phases 0, 1, 2, 3A, 3B, 4, 5A, 5B, 6, 7, 8, 9 |

| V-B3 | Negative test: copy the repo to a scratch folder, inject 11 known defects (unquoted `: ` in an agent description, `Agent` tool on an agent, `Write` on the reviewer, a requirement removed from its phase plan, a Shopify-token-shaped string, a broken link, an invalid backlog status and unknown dependency, a skill name mismatch, an unknown requirement reference and an invalid phase, a value in `.env.example`, the `.env` deny rule removed), then `node scripts/validate-framework.mjs --root <copy>` | **Exit 1 with 14 errors, every injected defect reported** (the extra three are consequences, for example the traceability phase mismatch) |
| V-B4 | `node scripts/validate-framework.mjs` on the real repository, final run after P0-07 and P0-08 | `agents: 10  skills: 15  rules: 6  requirements: 104  phase tasks: 138`, **`framework check: OK`**, exit 0 |

## Not run (and why)

No application tests exist: there is no storefront code yet (Phase 1 is blocked on Node 22 LTS, Q-017). Playwright MCP has not been used by an agent: its Claude Code connection awaits interactive approval (B-04). The Figma MCP was only exercised with `whoami`; no design file was read, because none has been provided (Q-004). No GitHub, Shopify, Extend or hosting system was contacted.

## Toolchain, scaffold and trials, 2026-10-12

| # | What | Command or method | Result |
|---|---|---|---|
| V-C1 | Version manager installed (owner approved) | `winget install --id Schniz.fnm --scope user` | fnm 1.39.0 installed; `Command line alias added` but the WinGet Links folder stayed empty, so the package folder is found by `~/.bashrc` instead |
| V-C2 | Node 22 installed | `fnm install 22`, `fnm default 22` | v22.23.3, npm 10.9.9 (`fnm exec ... npm` fails on Windows with "program not found"; the Node folder on PATH works) |
| V-C3 | Fresh Git Bash login shell | `env -i ... bash -lc 'fnm --version; node --version'` | fnm 1.39.0, Node v22.23.3 through the fnm multishell path. Existing shells still show Node 25.8.2 until restarted |
| V-C4 | Hydrogen scaffold | `npm create @shopify/hydrogen@latest -- --path storefront --language ts --styling tailwind --markets none --mock-shop --install-deps --no-shortcut` | Success: Hydrogen 2026.4.7, react-router 7.16.0, Tailwind 4, TypeScript 5.9, 840 packages. The scaffold created a nested `.git` (template history, no local changes), removed with `rm -rf storefront/.git` |
| V-C5 | Baseline checks on the scaffold | `npm run lint`, `npm run typecheck`, `npm run build` in `storefront/` | All three exit 0 (react-router v8 future-flag warnings and a "bundle analysis summary" warning only) |
| V-C6 | Dependency audit | `npm audit` | 7 findings (1 low, 4 moderate, 2 high) including react-router below 7.18 (high DoS in route matching; moderate redirect, hydration and RSC issues); rest are build-time or dev-server dependencies. See F-33 and ADR-0008 |
| V-C7 | Trial: official upgrade | `npx shopify hydrogen upgrade --version 2026.10.0` in a scratch copy with its own git repo | Reports "You are on the latest Hydrogen version: 2026.4.7" (the tool does not offer 2026.10.0 yet). On the real storefront it refuses: "can only be run on a clean git branch" |
| V-C8 | Trial: react-router 7.18.4 on Hydrogen 2026.4.7 (scratch copy) | direct dependency bumps plus `overrides` | lint, typecheck, build exit 0; dev server `GET /` returned 200 with the mock shop; production audit 2 findings (esbuild dev server on Windows, lodash in codegen). **But** `npm ci` fails with ERESOLVE because Hydrogen 2026.4.7 declares peers `~7.16.0`. **Not adopted** |
| V-C9 | Trial: Hydrogen 2026.10.0 with react-router 7.18.4 (scratch copy) | `npm i @shopify/hydrogen@2026.10.0` | production audit 0 findings; `typecheck` and `build` fail: `vite.config.ts` imports `hydrogen` from `@shopify/hydrogen/vite`, which no longer exists. Needs the new template. **Not adopted** |
| V-C10 | Real storefront restored to the scaffold pins after the trials | copy the saved `package.json` and lockfile, `npm ci`, then lint, typecheck, build | `npm ls`: hydrogen 2026.4.7, react-router 7.16.0; all three checks exit 0 |
| V-C11 | Reference-site visual study | headless Chrome screenshots (home desktop and mobile, collection, product desktop and mobile) saved to the scratchpad, **not committed** | Layout notes added to REFERENCE_PATTERNS in our own words |
| V-C12 | Framework validator after this round | `node scripts/validate-framework.mjs` | `framework check: OK` (10 agents, 15 skills, 104 requirements, 142 phase tasks), re-run after the review fixes below |

## Independent review of the 2026-10-12 documentation and tooling, and fixes

| # | What | Result |
|---|---|---|
| V-D1 | `code-reviewer` agent (read-only, not the author) reviewed the Basic-plan documents, the client pack, TECH_FEASIBILITY F-21 to F-41, the validator changes, `storefront/CLAUDE.md` and `.claude/settings.json` | **CHANGES REQUESTED**: 0 Blockers, 7 Major, about 20 Minor, 4 Nit. It ran the validator (OK) and probed it with scratch copies |
| V-D2 | Major findings and how each was resolved | (1) 60-day guest-lookup claim untraced: added F-42 (secondary) and "verify V-09, V-20" in SD-05; (2) detective control stated as delivered: softened in the pack and SD-01, fallback to a reconciliation report; (3) local-delivery effect understated: SD-04 and the pack now state the one-location and no-mixing rules, the Shopify option name and "verify V-06b", plus a new pack question; (4) the pack committed the owner on price, timing and "Let's talk": removed, "Let's talk" is explicitly not approval; (5) requirement statuses did not follow the SD rule: REQ-DEL-001/002, REQ-ACC-003, REQ-CHK-003/005, REQ-CART-005 are now Pending approval, D-03 corrected; (6) dev stores are not plan-gated: V-26 added, REQ-PROMO-003 criteria and the Basic document corrected; (7) pricing-integrity overclaim in ADR-0006: corrected, and ADR-0009 and REQ-EXT-003 now require the sync to cross-check paid price against the plan and flag mismatches |
| V-D3 | Minor findings fixed | Unsourced "Available" cells marked as unverified; hand-set Flow number wording; SD-11 added for the financing messages (CR-14); SD-02, SD-08, SD-09, SD-10 wording; ADR-0009 now acknowledges that Price Points requires Extend's Listed app; ADR-0006 duplicate requirement; client-pack jargon and unverified "free option" claims; TECH_FEASIBILITY header, F-09, F-18, F-39, V-01, V-03, V-10 notes; root CLAUDE.md invariant now says rules are prevented by our server and **detected** for direct-API carts; git-practices states exactly what settings cover; `*.tsbuildinfo` ignored; storefront validate command path |
| V-D4 | Validator hardening from the review | engines check now parses ranges (rejects `^18.22.0`, accepts `^22 \|\| ^24`, errors when `engines.node` is missing); template-doc exemption narrowed to the files the scaffold ships; SD, CR, F, V, R, T and ADR references are now checked against their definitions (question IDs now come from table rows only) |
| V-D5 | Negative test of the new checks | Scratch copy with one non-existent SD, CR, V, F, R, T and ADR reference each, an engines mismatch and a nested `.git`: **exit 1, 9 errors, every injected defect reported** |
| V-D6 | Final clean run | `node scripts/validate-framework.mjs`: `framework check: OK` |
| V-D7 | Not changed, on purpose | The reviewer suggested `**/.env` forms for the deny rules; the Claude Code permissions page we read says bare filenames already match at any depth. Ask and deny rules still cover the Bash tool only; PowerShell equivalents were not added and have not been tested, so the project owner should prefer Git Bash for agent commands. `storefront/AGENTS.md` keeps the template's toolkit-install line; `storefront/CLAUDE.md` warns against following it |
