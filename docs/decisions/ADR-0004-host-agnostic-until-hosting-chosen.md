# ADR-0004: Build host-agnostic until the hosting option is chosen

- **Status:** Proposed (accept at P1-09; revisit when Q-003 is answered)
- **Date:** 2026-10-11
- **Deciders:** project owner, client (Q-003), solution-architect
- **Requirements:** REQ-HOST-001 to REQ-HOST-004, REQ-EXT-003
- **Related:** Q-003, F-05, F-06, D-02, R-04, V-13

## Context

The SOW lets the client choose at sign-off between Option A (Shopify Oxygen, Hydrogen sales channel) and Option B (a Node.js server, Headless channel). The choice has not been communicated to us. Shopify's self-hosting guide says it might not be compatible with Hydrogen features introduced in 2025-05 and later, and the current release is 2026.10 (F-06). The Extend order sync runs as a route inside the storefront under Option A and as a service on the same server under Option B (SOW §3).

## Decision

Develop against the current Hydrogen template and keep everything that depends on the runtime behind small seams:

- Server entry and context creation in the template's files only; business code reads configuration from `context.env` and never from `process.env` or Oxygen globals.
- The Extend sync core is a pure library with two thin entry points (a route and a standalone service entry) so either option reuses it.
- No Oxygen-only APIs outside one `app/lib/platform.ts` adapter. The scaffold's `app/lib/context.ts` already uses the Workers global `caches.open('hydrogen')` and `executionContext.waitUntil`; those two lines, `server.ts` and `vite.config.ts` (`oxygen()` plugin) are the known platform seams to adapt for Option B.
- P1-08 proves a plain-Node production build early, and Phase 9 builds only the chosen option.

Recommend Option A to the client, as the SOW does, and state that Option B effort beyond the SOW's description is a change request.

## Consequences

Easier: no rework when Q-003 is answered. Harder: small amount of indirection now; Option B may still surface Hydrogen features that need adaptation (R-04).

## Alternatives considered

Choose Option A silently: risks rework if the client needs Option B. Build both: doubles effort for one deliverable.

## Verification

P1-08 spike result recorded; a grep check in code review confirms no runtime-specific globals outside the adapter.
