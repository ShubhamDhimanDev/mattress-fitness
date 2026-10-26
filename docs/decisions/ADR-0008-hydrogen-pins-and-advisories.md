# ADR-0008: Hold the scaffold's Hydrogen 2026.4.7 and react-router 7.16.0 pins for now; track the advisories

- **Status:** Superseded by [ADR-0012](ADR-0012-hydrogen-2026-10-migration.md) (2026-10-26: the owner chose the Hydrogen 2026.10 migration; the pins described below are no longer held). Original status: Proposed (owner to confirm; revisit when Shopify's template supports Hydrogen 2026.10 or at P1-12)
- **Date:** 2026-10-12
- **Deciders:** project owner; solution-architect; security-engineer
- **Requirements:** NFR-004, NFR-012
- **Related:** F-03, F-33, ADR-0002, R-23, Q-019, T-12

## Context

`npm create @shopify/hydrogen@latest` produced Hydrogen **2026.4.7** with **react-router 7.16.0** (exact) and Vite 8, React 18, TypeScript 5.9. `npm audit` reports 7 findings. The ones that matter at runtime are in **react-router below 7.18**: a high-severity unauthenticated denial of service in route matching, plus moderate open-redirect (backslash in `Link` and `useNavigate`), SSR hydration constructor injection and an RSC XSS issue. The rest are build-time or development-server dependencies (GraphQL codegen toolchain, mini-oxygen's undici and ws, esbuild on Windows).

Trials in a scratch copy (2026-10-12):

| Trial | Result |
|---|---|
| react-router and its dev packages at 7.18.4 with Hydrogen 2026.4.7 | lint, typecheck, build and a dev-server request all pass; production audit falls to 2 findings (esbuild dev server on Windows, lodash in the codegen toolchain). **But** Hydrogen 2026.4.7 declares peers `react-router ~7.16.0` and `@react-router/dev ~7.16.0`, so `npm ci` rejects the tree; making it install needs `--legacy-peer-deps` or `--force`, which hides future conflicts |
| Hydrogen 2026.10.0 with react-router 7.18.4 | production audit: 0 findings, but `typecheck` and `build` fail: the template's `vite.config.ts` imports `hydrogen` from `@shopify/hydrogen/vite`, which no longer exports it. The release also moves to Storefront API 2026-10 and removes or renames analytics and cart APIs. This needs the new template, not a version bump |
| `shopify hydrogen upgrade --version 2026.10.0` | reports "latest is 2026.4.7" and refuses to run on a repository that is not clean (we have no commit yet) |

## Decision

1. **Hold** Hydrogen 2026.4.7 and react-router 7.16.0 as Shopify tested them. Do not force newer react-router into a peer-conflicting tree.
2. **Do not ship to production on the held pins** without a recorded decision: the Phase 7 security gate requires the high-severity react-router advisory to be resolved or accepted in writing, and Phase 9 requires resolution.
3. Resolve through the **Hydrogen 2026.10 migration** (task P1-12) as soon as either Shopify's CLI offers it (`shopify hydrogen upgrade`) or we re-scaffold from the 2026.10 template and port our changes. Do it **before substantial feature code exists** (Phase 3B), because every feature added to the old template adds migration work. Reassess monthly.
4. Interim mitigations: Oxygen or CDN-level request limits when hosted; no user-controlled redirect targets (T-08); keep the framework pins exact; run `npm audit` in CI and report, not fail, on the known set (a documented allow list, reviewed at each gate).
5. Authorise an **initial commit** (the owner decides when) so `shopify hydrogen upgrade` can run on a clean branch.

## Consequences

Easier now: a scaffold that Shopify supports and that builds, no peer-dependency hacks. Harder: a known high advisory stays open during development and must be closed before launch; the migration is real work (new Vite plugin, analytics, cart exports, API version bump). Risk R-23 tracks it.

## Alternatives considered

Force react-router 7.18.4 with `legacy-peer-deps`: works today, hides conflicts, unsupported by Shopify. Jump to Hydrogen 2026.10.0 now by hand: breaking, undocumented for the template. Wait silently: rejected, the advisory must be visible.

## Verification

P1-12 completes with a green CI on the migrated stack and `npm audit --omit=dev` showing no high or critical runtime finding; until then the gate G5 records the exception.

## Implementation note (2026-10-15, as built)

The pins are held: `storefront/package.json` has `@shopify/hydrogen` 2026.4.7 and `react-router`, `react-router-dom`, `@react-router/dev`, `@react-router/fs-routes` at 7.16.0, and a large amount of feature code now sits on that template, so the migration cost the decision warned about (point 3: do it before Phase 3B feature code) has grown; P1-12 is not done. The code uses Storefront API behaviour of the 2026.4 line; the storefront's Admin API client uses version 2026-10 (`ADMIN_API_VERSION` in `app/lib/extend/admin-order.ts`). The interim mitigations that exist in code: no user-controlled redirect targets (`safeRedirectPath`), exact framework pins, security headers. `npm audit` handling and the initial-commit point are not re-verified here. Status stays **Proposed**; it remains a launch blocker until the owner accepts the exception in writing or P1-12 completes (DEC-027).
