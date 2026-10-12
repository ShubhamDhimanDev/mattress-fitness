---
name: figma-to-hydrogen
description: "Translates client-provided Figma frames or a brand kit into design tokens and reusable Hydrogen components that match desktop, tablet and mobile behaviour and accessibility, then validates the result against the design and logs deviations. Use when the client shares a Figma URL, when building design-system components, or when comparing a built page with its design. Never invents a Figma file."
argument-hint: "[Figma URL or frame names, or 'brand kit']"
---

# Figma to Hydrogen

## When to use

A Figma file, frame or library has been provided, or a component needs to be built or verified against the brand kit. Full process and guardrails: `docs/design/FIGMA_WORKFLOW.md`. Input: $ARGUMENTS

## Steps

1. **Check the input and the connection.** If no Figma URL was provided, say so, record the pending input (Q-004) and work from the brand kit. Confirm Figma MCP is connected (`/mcp`); if not, report what is needed (approval and OAuth) instead of guessing.
2. **Locate** the exact file, page and frames; record URLs and node IDs in `docs/design/BRAND_TOKENS.md`.
3. **Retrieve** layout, components and variants, text styles, spacing, variables and assets through the MCP; confirm the real tool names from the server's list.
4. **Tokens first:** map Figma variables and styles to the Tailwind theme; never hard-code values.
5. **Reuse:** search `storefront/app/components/ui/` before building; extend a component with a variant rather than duplicating.
6. **Build** presentational components from the mobile frame upward (`.claude/rules/ui-implementation.md`), semantic and accessible, using Shopify's image component.
7. **Validate** with Playwright at 360, 768, 1280 and 1536 px: screenshots against the frame, the accessibility tree and keyboard operation. Fix differences or log them.
8. **Log deviations** in `docs/design/DEVIATIONS.md` with reason, rule or requirement, and approver.

## Outputs

Tokens in the theme, reusable components with documented states, screenshots at four widths, a deviation log, and updated task and requirement notes.

## Validation

No hard-coded colour, spacing or font values in the new code; every interactive state exists; axe shows no serious or critical issues; visual difference from the design is explained or fixed; no reference-site content or unlicensed assets were used; nothing is claimed about files that were not inspected.
