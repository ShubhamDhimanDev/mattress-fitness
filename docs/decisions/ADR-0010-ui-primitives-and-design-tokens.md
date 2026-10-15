# ADR-0010: Hand-rolled overlay primitives and a closed Tailwind token set

- **Status:** Accepted (orchestrator, 2026-10-12; revisit if a primitive proves hard to maintain)
- **Date:** 2026-10-12
- **Deciders:** orchestrator; ui-ux-designer and shopify-hydrogen-developer (implementation)
- **Requirements:** REQ-NAV-001, NFR-001, NFR-003, NFR-008
- **Related:** phase-02 plan (overlay decision required), [ui-implementation rule](../../.claude/rules/ui-implementation.md), R-20

## Context

Phase 2 needs a drawer (cart, mobile navigation), a dialog (ZIP entry, store selector), an accordion and tabs, all keyboard operable and accessible (WCAG 2.2 AA target). The phase plan asked for either a small audited headless library or a recorded decision to hand-roll. The client brand is not yet available (CLR-013), so styling must be swappable in one place.

## Decision

1. **Hand-roll the overlay primitives** (`app/components/ui/Overlay.tsx`, Drawer, Dialog, Accordion, Tabs) on top of native elements and a small focus-trap utility. No new runtime dependency is added: each dependency is supply-chain surface (T-12) and bundle weight (NFR-002), and the behaviour needed is small. Behaviour is covered by unit tests (focus trap, Esc closes, focus returns to the trigger) and by axe and keyboard e2e specs.
2. **Closed token set.** `app/styles/tailwind.css` removes Tailwind's default palette and defines the brand tokens (`@theme`): any class that is not a token generates nothing, so colours cannot drift from the design system. Swapping to the client's brand means editing the `@theme` blocks only. Contrast of every text and surface pair is documented at the top of that file and checked by axe (one token was darkened to reach 4.5:1).
3. **Legacy template CSS** is kept in a CSS layer below utilities so it can never override a token-based class; the unlayered reset was removed for the same reason.
4. **Known shortcuts, tracked:** the gallery route is `/components` (pathless `_dev` segment) and returns 404 in production; the ZIP is held in memory until P3B-11 persists it; many nav links are placeholders until P3B-02.

## Consequences

Easier: no dependency to audit or upgrade, one-file rebrand, predictable styling. Harder: we own focus-management edge cases (nested overlays, iOS scroll lock); they are tested but only in Chromium so far. WebKit and Firefox run in CI (P1-06) and a real screen-reader pass is a Phase 7 task (accessibility-review skill).

## Alternatives considered

A headless library (Radix, React Aria, Headless UI): robust, but adds dependencies and, for Radix, many packages for four components. Revisit if the overlay code grows beyond these primitives or if a screen-reader pass finds defects we cannot fix cheaply.

## Verification

`npx vitest run tests/unit/ui`; `npm run e2e` shell and gallery specs (desktop and mobile Chromium) with zero serious or critical axe violations; WebKit and Firefox in CI.

## Implementation note (2026-10-15, as built)

The primitives exist under `app/components/ui/` (Overlay, Drawer, Dialog, Accordion, Tabs plus Button, Field, Select and others) with no headless-library dependency in `package.json`. Known shortcut 4 has moved: the ZIP is no longer held in memory but in a signed server cookie (P3B-11, `app/lib/delivery-runtime/zip-cookie.ts`); the gallery is still the `_dev.components.tsx` route (the state of the navigation links was not re-checked here). Whether WebKit and Firefox specs run in CI is for the devops-engineer's record; this note makes no claim about it.
