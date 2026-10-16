# Brand tokens (as built)

Task P2-01 / P2-02. Owner: `ui-ux-designer`. Single source of the values: [`storefront/app/styles/tailwind.css`](../../storefront/app/styles/tailwind.css) (`@theme` blocks). This page describes that file; if the two disagree, the file wins and this page is wrong. Rules for using the tokens: [ui-implementation](../../.claude/rules/ui-implementation.md). Why the token set is closed: [ADR-0010](../decisions/ADR-0010-ui-primitives-and-design-tokens.md).

## Status

**Every colour below is a PLACEHOLDER.** The client's brand kit (CLR-013) has not arrived, so the palette is a neutral one the project made up, and it is deliberately different from the reference site's colours (NFR-007). No Figma file has been supplied (Q-004: the owner wants the site to look and function like the reference site in the client's own brand), so none was opened and no node IDs or variables were mapped; nothing here comes from Figma. The client has not approved the visual direction, which the phase 2 plan requires before its gate. Whether the target is WCAG 2.2 AA is itself pending approval (Q-012); AA is the working standard.

What is a placeholder and what is structural:

| Group                                      | Status           | Meaning                                                                                                                                                                      |
| ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour palette, semantic status colours    | PLACEHOLDER      | Replace with the brand kit values (CLR-013).                                                                                                                                 |
| Font family                                | PLACEHOLDER      | System stack until the brand fonts and their web licence arrive.                                                                                                             |
| Radius (`choice`, `card`, `panel`, `pill`) | Project decision | Pill for navigation-level calls to action, 4 px for choice buttons (a structure taken from the reference notes, not its CSS). Retune to the brand if the kit says otherwise. |
| Type scale, spacing rhythm, elevation      | Project decision | Retune only if the brand kit has its own scale.                                                                                                                              |
| Breakpoints, `touch` size (44 px)          | Structural       | Come from NFR-001 (360, 768, 1280, 1536 px checked; 1024 px is the desktop navigation switch). Do not change with the brand.                                                 |

## Colour (PLACEHOLDER)

Utilities are the usual Tailwind ones with the token name, for example `bg-primary-700`, `text-ink-600`, `border-line`. Tailwind's default palette is removed, so a colour that is not listed here generates no CSS.

| Token         | Value     | Token        | Value     | Token     | Value     |
| ------------- | --------- | ------------ | --------- | --------- | --------- |
| `white`       | `#ffffff` |              |           |           |           |
| `primary-50`  | `#e8f5f4` | `accent-50`  | `#fff7e0` | `ink-50`  | `#f7f8f8` |
| `primary-100` | `#c9e8e6` | `accent-100` | `#ffecb3` | `ink-100` | `#eef0f1` |
| `primary-200` | `#9bd3cf` | `accent-200` | `#ffdd80` | `ink-200` | `#dde1e3` |
| `primary-300` | `#66b9b4` | `accent-300` | `#ffcb47` | `ink-300` | `#c3c9cd` |
| `primary-400` | `#3a9c97` | `accent-400` | `#f6b414` | `ink-400` | `#8a949a` |
| `primary-500` | `#1c7e79` | `accent-500` | `#e09a00` | `ink-500` | `#6b757c` |
| `primary-600` | `#146b68` | `accent-600` | `#b87800` | `ink-600` | `#525c63` |
| `primary-700` | `#0f5654` | `accent-700` | `#8a5a00` | `ink-700` | `#3b444a` |
| `primary-800` | `#0b4240` |              |           | `ink-800` | `#272e33` |
| `primary-900` | `#082f2e` |              |           | `ink-900` | `#161b1e` |

Status colours (each has a background, a text and a solid variant so a message is never colour alone: components pair them with an icon and text):

| Token           | Value     | Token           | Value     | Token         | Value     |
| --------------- | --------- | --------------- | --------- | ------------- | --------- |
| `success-bg`    | `#e6f4ec` | `warning-bg`    | `#fff4d6` | `error-bg`    | `#fdeaea` |
| `success-fg`    | `#0e5c2f` | `warning-fg`    | `#6b4100` | `error-fg`    | `#a31616` |
| `success-solid` | `#1b7a43` | `warning-solid` | `#f6b414` | `error-solid` | `#b42318` |

Focus ring: `focus` `#1f4fd8` on light surfaces, `focus-inverse` `#ffcb47` inside `.on-dark` (3 px outline, 2 px offset, drawn once for every interactive element in the base layer).

Semantic roles (what components use; the brand file decides which ink each one is):

| Role              | Resolves to | Used for                             |
| ----------------- | ----------- | ------------------------------------ |
| `surface`         | `white`     | page and card background             |
| `surface-muted`   | `ink-100`   | quiet panels, hover, disabled fields |
| `surface-inverse` | `ink-900`   | footer                               |
| `fg`              | `ink-900`   | body text                            |
| `fg-muted`        | `ink-600`   | secondary text                       |
| `fg-inverse`      | `ink-100`   | text on `surface-inverse`            |
| `line`            | `ink-200`   | dividers                             |
| `line-strong`     | `ink-400`   | control borders (non-text contrast)  |

Contrast pairs checked: the list with ratios is the comment at the top of `tailwind.css` (for example white on `primary-700` 8.47, `ink-500` placeholder text on white 4.71, `ink-400` control border on white 3.10 against 3.0, focus ring on white 6.63). The ratios are quoted from that comment and were not recomputed for this page; axe runs on the gallery and the shell in `tests/e2e/gallery.spec.ts` and `tests/e2e/shell.spec.ts`. After any colour change redo the table and rerun both.

## Type

| Token       | Value                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `font-sans` | `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` (PLACEHOLDER) |
| `font-mono` | `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`                                      |

| Utility        | Size              | Line height |
| -------------- | ----------------- | ----------- |
| `text-xs`      | 0.75 rem (12 px)  | 1 rem       |
| `text-sm`      | 0.875 rem (14 px) | 1.25 rem    |
| `text-base`    | 1 rem (16 px)     | 1.5 rem     |
| `text-lg`      | 1.125 rem         | 1.75 rem    |
| `text-xl`      | 1.25 rem          | 1.75 rem    |
| `text-2xl`     | 1.5 rem           | 2 rem       |
| `text-3xl`     | 1.875 rem         | 2.25 rem    |
| `text-4xl`     | 2.25 rem          | 2.5 rem     |
| `text-5xl`     | 3 rem             | 3.25 rem    |
| `text-display` | 3.75 rem          | 1           |

Bare `h1` to `h3` get `text-3xl`, `text-2xl` and `text-xl` bold in the base layer for the template routes not rebuilt yet.

## Space, shape, layout

- **Spacing**: Tailwind's 4 px unit is kept; the project rhythm is 8 px, so use the even steps (2 = 8 px, 4 = 16 px, 6 = 24 px, 8 = 32 px, 12 = 48 px, 16 = 64 px).
- **`touch`** (`min-h-touch`, `size-touch`): 2.75 rem = 44 px, the minimum height of anything a shopper taps. Text links are 44 px high but only as wide as their words (entry UXD-09 in [DEVIATIONS](DEVIATIONS.md)).
- **Radius**: `rounded-choice` 0.25 rem, `rounded-card` 0.5 rem, `rounded-panel` 0.75 rem, `rounded-pill` full.
- **Elevation**: `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-drawer` (all tinted with `ink-900`).
- **Widths**: `max-w-page` 1300 px, `max-w-prose` 42 rem, `max-w-drawer` 400 px, `max-w-dialog` 480 px.
- **Breakpoints** (mobile first, base styles are for 360 px): `sm` 360, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536 px.
- **Layers** (numeric `z-` utilities): 30 header, 40 menus and dropdowns, 50 overlays (drawer, dialog), 60 toasts and the focused skip link.

## Motion

| Token                                               | Value                                          |
| --------------------------------------------------- | ---------------------------------------------- |
| `animate-fade-in`                                   | 150 ms ease-out, opacity (overlay backdrop)    |
| `animate-drawer-in-left`, `animate-drawer-in-right` | 200 ms ease-out, slide                         |
| `animate-dialog-in`                                 | 180 ms ease-out, rise and fade (dialog, toast) |

Components use these (and `animate-pulse`, `animate-spin`, `transition-*`) only behind `motion-safe:`, and the base layer shortens every animation, transition and smooth scroll to about 0 ms under `prefers-reduced-motion: reduce`. A unit test fails if a `ui/` component uses motion without `motion-safe:` (`tests/unit/ui/motionSafe.test.ts`); `tests/e2e/design-rules.spec.ts` checks the computed styles in the browser.

## Provenance

| Asset          | Where it comes from                                                                                                                               | Licence or risk                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Colour values  | Made up by this project as a neutral placeholder (deep teal, warm amber, neutral ink). Not derived from the client or from the reference site.    | None; replaced when CLR-013 arrives.                                                                                                                                           |
| Fonts          | No font is loaded. The stack is the user's system fonts.                                                                                          | None. Brand fonts: self-host WOFF2 from the project, `font-display: swap`, preload only the critical weight, record the licence here (no third-party font CDN, security rule). |
| Icons          | Drawn for this project in `storefront/app/components/ui/Icons.tsx` (24 px stroke, decorative, hidden from assistive technology). No icon library. | Project-owned.                                                                                                                                                                 |
| Logo           | A text wordmark placeholder in `SiteHeader.tsx`.                                                                                                  | Replace with the client's logo; record its provenance.                                                                                                                         |
| Photography    | None committed. Product and brand images come from Shopify.                                                                                       | Shopify CDN only.                                                                                                                                                              |
| Reference site | Used for layout and behaviour notes only ([REFERENCE_PATTERNS](REFERENCE_PATTERNS.md)). No text, image, markup or CSS taken.                      | NFR-007.                                                                                                                                                                       |

## Changing to the client's brand

1. Edit the `@theme` blocks in `tailwind.css` (palette, `font-sans`, radii if needed) and the `@font-face` rules if fonts are self-hosted. Nothing else holds a brand value.
2. Recompute the contrast table in the file header and keep the pairs the components rely on at 4.5:1 (text) or 3:1 (borders, focus ring). Adjust the shade, not the component.
3. Run `npm run e2e -- gallery shell design-rules` (axe, touch targets, reduced motion) and review the gallery and shell at 360, 768, 1280 and 1536 px by eye.
4. Update this page, and log in [DEVIATIONS](DEVIATIONS.md) anything that now differs from the supplied kit.

## Inputs still needed from the client

- Logo files (SVG preferred) and clear-space rules.
- Brand colours with hex values, and which is the action colour.
- Brand fonts with a web licence, or confirmation that the system stack is fine.
- Photography direction and any approved lifestyle images.
- Written approval of the visual direction (recorded in `progress/DECISIONS.md`) and of the accessibility level (Q-012).
- A Figma file or library, only if the client has one (Q-004). Until one is supplied nothing here may claim to have been checked against Figma.
