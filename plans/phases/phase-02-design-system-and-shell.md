# Phase 2: Design system, shared UI components, responsive shell and Figma alignment

## Objective

Build the brand tokens, accessible shared components and the responsive site shell so every later page composes from one system. **Business outcome:** the client sees the brand on a real, mobile-first site early, and later phases do not re-invent UI.

## Scope

In: design tokens from the client's brand kit, base components, header, footer, promotional bar, mobile navigation, a dev-only component gallery, accessibility baseline, USD formatting, analytics event interface (no-op).
Out: real catalog data (placeholders only until Phase 3A), mega menu content (3B), static mockups (EXC-09; design is built directly and reviewed on staging).

## Prerequisites

Phase 1 done. Brand kit: logo, colours, fonts, photography (CLR-013, G-2). Figma files only if the client has them (Q-004).

## Requirement IDs

REQ-NAV-001, NFR-001, NFR-008

## Architecture and design decisions

- Tokens live in the Tailwind theme (CSS variables with Tailwind 4 `@theme`, or the template's equivalent) and nowhere else; no hard-coded colours or spacing in components ([ui-implementation rule](../../.claude/rules/ui-implementation.md)).
- Mobile first: design at 360 px, enhance at 768, 1024, 1280.
- Components are presentational and data-agnostic; Shopify data mapping stays in loaders and `app/lib`.
- Interactive primitives (drawer, dialog, accordion, listbox) follow WAI-ARIA patterns with tested keyboard behaviour; prefer the template's or a small, audited headless library over hand-rolled focus management; record the choice in an ADR.
- A single `track(event)` interface exists now (no-op) so later phases emit events without rewrites.
- No i18n or currency libraries (NFR-008).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P2-01 | Collect brand kit and confirm whether Figma files exist; if yes, authenticate Figma MCP and map frames and variables per the Figma workflow | ui-ux-designer | CLR-013, Q-004 | `docs/design/BRAND_TOKENS.md` |
| P2-02 | Define tokens: colour, type scale, spacing, radius, elevation, breakpoints, motion | ui-ux-designer | P2-01 | `storefront/app/styles/*` |
| P2-03 | Base components: Button, Link, Input, Select, Checkbox, Radio, Badge, Price, Rating (adapter ready), Skeleton, Toast, Image wrapper | shopify-hydrogen-developer | P2-02 | `storefront/app/components/ui/*` |
| P2-04 | Overlay primitives: Drawer, Dialog, Accordion, Tabs with focus management | shopify-hydrogen-developer | P2-02 | `storefront/app/components/ui/*` |
| P2-05 | Shell: promotional bar, header (search, account, cart entry points), footer, mobile navigation drawer, root layout | shopify-hydrogen-developer | P2-03, P2-04 | `storefront/app/components/layout/*`, `app/root.tsx` |
| P2-06 | Dev-only component gallery route and visual snapshots at 360, 768, 1280, 1536 px | qa-engineer | P2-05 | `storefront/app/routes/_dev.components.tsx`, specs |
| P2-07 | Accessibility baseline: skip link, landmarks, focus ring, reduced motion, 44 px targets, axe on the gallery and shell | ui-ux-designer | P2-05 | rules applied, axe spec |
| P2-08 | USD formatting helper and the no-op `track()` interface | shopify-hydrogen-developer | P2-01 | `storefront/app/lib/format.ts`, `app/lib/analytics.ts` |
| P2-09 | Design review on staging and deviation log (Figma or brand kit versus built) | ui-ux-designer | P2-05 | `docs/design/DEVIATIONS.md` |
| P2-10 | Phase gate review | project-manager | all | gate record |

**Brand application (added 2026-10-22).** The client's logo arrived and the owner asked for the reference's structure in the client's own brand. The designer's checklist in [BRAND_APPLICATION_SPEC](../../docs/design/BRAND_APPLICATION_SPEC.md) section 6 (BA-01 to BA-11) carries that work as **sub-tasks of P2-01, P2-02, P2-03, P2-05, P2-06, P2-07 and P2-09 and of the page tasks of Phases 3B and 4** (no new requirement: NFR-001, NFR-003, NFR-007, REQ-NAV-001, REQ-HOME-001, REQ-COL-001, REQ-PDP-001, REQ-CART-001). Status of every BA row lives in [BACKLOG](../BACKLOG.md) ("Brand restyle (BA) and real-store findings (RS)"). The BA ids are deliberately not rows of the table above (task ids in this table must be `P2-NN`). Phase 2 gate unchanged: P2-10 needs the client's recorded approval of the look (CLR-013, UXD-01 to UXD-28) and a staging review (B-07).

## Dependencies and blockers

Blocked by CLR-013 for final tokens; the phase can start with neutral tokens and swap values once the kit arrives, but cannot pass the gate until the client approves the look (recorded approval).

## Security considerations

No third-party scripts or fonts loaded from unknown origins; self-host or use Shopify's font CDN; images from Shopify CDN only. Do not inject unsanitised HTML.

## Testing

Unit: format helper. E2E and accessibility: shell at four viewports, keyboard path through header, drawer and footer, axe zero serious or critical. Visual snapshots reviewed manually, not auto-approved.

## Acceptance criteria

1. REQ-NAV-001 and NFR-001 acceptance criteria met on staging at all four viewports.
2. Every component has documented states (default, hover, focus, disabled, error) and passes axe.
3. NFR-008: no locale or currency switcher or library present.
4. Client has approved the visual direction (recorded in `progress/DECISIONS.md`).

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: design deviations logged and each either fixed or approved.

## Review and sign-off

`qa-engineer` verifies behaviour; `code-reviewer` reviews components for type safety and a11y; `ui-ux-designer` self-review is not sufficient: client approval of the visual direction is required.

## Rollback and recovery

Components are additive; revert the commit. Token changes are one file, so a bad theme change is a one-file revert.
