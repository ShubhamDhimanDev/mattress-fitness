---
paths:
  - "storefront/app/components/**"
  - "storefront/app/styles/**"
  - "storefront/app/routes/**/*.tsx"
  - "**/*.css"
---

# UI implementation rules

Design workflow: [FIGMA_WORKFLOW](../../docs/design/FIGMA_WORKFLOW.md). Phase plan: [phase-02](../../plans/phases/phase-02-design-system-and-shell.md).

- **Tokens only.** Colours, type, spacing, radius, shadow and breakpoints come from the Tailwind theme. No hard-coded hex values, pixel spacing or one-off font sizes in components.
- **Mobile first.** Write the base styles for 360 px and enhance upward with `md`, `lg`, `xl`. No horizontal scroll at any width. Touch targets at least 44 px.
- **Reuse before building.** Look in `app/components/ui/` first; extend a component with a variant or prop instead of copying it. Components are presentational: data comes in as props; no Shopify calls.
- **Semantic and accessible by default.** Real `button`, `a`, `nav`, `main`, `ul`, headings in order, form labels, `alt` from catalog data, visible focus, no focus traps, `aria-live` for async updates, `prefers-reduced-motion` respected. Dialogs and drawers manage focus, close on Esc and return focus. Target WCAG 2.2 AA (pending client approval, NFR-003).
- **States.** Every interactive component defines default, hover, focus-visible, active, disabled, loading and error. Every data component has loading, empty and error states.
- **Performance.** Use Shopify's image component with explicit sizes and aspect ratios (no layout shift), avoid blocking fonts (preload critical, `font-display: swap`), no layout-dependent JavaScript, and lazy-load below-the-fold and route-specific UI.
- **Brand and IP.** Use only the client's brand and supplied assets. Never copy text, images, logos, markup or CSS from the reference site (NFR-007). Record the provenance of every asset.
- **Content from Shopify** (rich text, metaobjects) is rendered through the sanitising renderer only.
- **Locale.** US English and USD only; no locale or currency switching UI (NFR-008).
- Record any intentional deviation from an approved design in `docs/design/DEVIATIONS.md`.
