# ADR-0002: Storefront stack: Hydrogen, React Router 7, TypeScript, Tailwind

- **Status:** Accepted (stack is mandated by SOW §2); exact versions are confirmed when the scaffold is created (P1-03)
- **Date:** 2026-10-11
- **Deciders:** SOW and project brief; solution-architect
- **Requirements:** NFR-001, NFR-006, REQ-NAV-001
- **Related:** F-01, F-03, F-04, V-14, R-17

## Context

The SOW specifies Shopify Hydrogen (React), TypeScript and Tailwind CSS, mobile first. The project brief forbids starting with a generic Next.js, Laravel or custom back end unless a documented requirement or verified limitation justifies it. Verified facts: Hydrogen is calendar-versioned (latest 2026.10.0), the Hydrogen CLI declares `@react-router/dev ~7.16.0` as a peer (so the framework is React Router 7 in framework mode on Vite, not Remix), and `hydrogen init` offers `--language ts` and `--styling tailwind`. npm also lists TypeScript 7 and React Router 8 as latest, but the CLI pins React Router 7.16 and TypeScript 7 support is unverified.

## Decision

Use Hydrogen as scaffolded by `shopify hydrogen init --language ts --styling tailwind --markets none`, with the template's dependency versions. Do not upgrade React Router, TypeScript, Vite or the Shopify packages independently; upgrade only through Hydrogen's own upgrade path, with CI green and a recorded note. Use the Storefront API, Customer Account API and Shopify's hosted checkout. No i18n or multi-currency scaffolding (EXC-11).

## Resolved versions (2026-10-12)

Scaffold: Hydrogen 2026.4.7, react-router 7.16.0, React 18.3.1, Vite 8, Tailwind 4, TypeScript 5.9. Newer Hydrogen 2026.10.0 needs a template migration and the react-router advisories are tracked in [ADR-0008](ADR-0008-hydrogen-pins-and-advisories.md).

## Consequences

Easier: Shopify-native patterns, documented upgrade path, edge hosting option. Harder: Hydrogen's pace of change (new version roughly each quarter) means periodic upgrade work after handover, which is outside this scope (EXC-13) and must be explained in the handover. Some behaviour is Oxygen-specific (see ADR-0004).

## Alternatives considered

Next.js with the Storefront API: rejected by the brief and unnecessary. Remix-based Hydrogen: superseded by the React Router based CLI. Theme (Liquid) storefront: not what the SOW sells (headless, custom flows).

## Verification

P1-03 records the scaffold's resolved versions in [ARCHITECTURE](../architecture/ARCHITECTURE.md); P1-08 proves a Node build; CI proves the lockfile installs cleanly.
