# Brand tokens (as built)

Task P2-01 / P2-02. Owner: `ui-ux-designer`. Single source of the values: [`storefront/app/styles/tailwind.css`](../../storefront/app/styles/tailwind.css) (`@theme` blocks). This page describes that file; if the two disagree, the file wins and this page is wrong. Rules for using the tokens: [ui-implementation](../../.claude/rules/ui-implementation.md). Why the token set is closed: [ADR-0010](../decisions/ADR-0010-ui-primitives-and-design-tokens.md).

## Status

**Update 2026-10-22: the client supplied its logo** (a red disc with a white blocky all-caps wordmark and a small tagline; files in `storefront/public/brand/` for the served sizes and `storefront/brand-source/` for the 1254 px master, provenance below). The red and the white are now **taken from the client's logo**. The rest of the full brand kit (CLR-013: greys, black, secondary colours, fonts, clear-space rules) has still not arrived, so everything **not derived from the logo stays PLACEHOLDER**. The new palette is **built** (commit 8b31bbe, task BA-01, spec in [BRAND_APPLICATION_SPEC](BRAND_APPLICATION_SPEC.md)); this page was re-checked against `storefront/app/styles/tailwind.css`, the components and the routes on 2026-10-22 and the file wins if it disagrees with this page. The teal placeholder is gone from the code. No Figma file has been supplied (Q-004: the owner wants the site to look and function like the reference site in the client's own brand), so none was opened and no node IDs or variables were mapped; nothing here comes from Figma. The client has not approved the visual direction, which the phase 2 plan requires before its gate. Whether the target is WCAG 2.2 AA is itself pending approval (Q-012); AA is the working standard.

What is a placeholder and what is structural:

| Group                                      | Status           | Meaning                                                                                                                                                                      |
| ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand red `primary-500` and white          | **From the client's logo** (2026-10-22) | `#DE0510` sampled from the supplied artwork; white is the wordmark. The other `primary-*` steps are lightness steps made by this project from that hue. |
| Greys and near-black (`ink-*`), amber accent, sale, status colours, focus ring | PLACEHOLDER | Not in the logo. Chosen to be neutral and accessible; replace with the brand kit values (CLR-013). |
| Semantic status colours, focus ring colours | PLACEHOLDER      | Unchanged from phase 2 (success, warning, error, `focus`, `focus-inverse`); not in the logo.                                                                                  |
| Font family                                | PLACEHOLDER      | System stack until the brand fonts and their web licence arrive. `font-display` is the same stack; `type-display` (weight 800, uppercase, 0.02 em) approximates the logo's blocky wordmark. |
| Radius (`choice`, `card`, `panel`, `pill`) | Project decision | As built: `choice` 0.5 rem (8 px, was 4 px), `card` 0.5 rem, `panel` 0.75 rem, `pill` full (chips, count bubble, carousel arrows, the Sale nav pill, `shape="pill"` buttons). Home and size buttons are rounded rectangles. Pattern from own measurements of the reference. Retune to the brand if the kit says otherwise. |
| Type scale, spacing rhythm, elevation      | Project decision | Retune only if the brand kit has its own scale.                                                                                                                              |
| Breakpoints, `touch` size (44 px)          | Structural       | Come from NFR-001 (360, 768, 1280, 1536 px checked; 1024 px is the desktop navigation switch). Do not change with the brand.                                                 |

## Colour (as built, shipped 2026-10-22)

Utilities are the usual Tailwind ones with the token name, for example `bg-primary-500`, `text-ink-600`, `border-line`. Tailwind's default palette is removed, so a colour that is not listed here generates no CSS. Contrast ratios were computed with the WCAG 2.2 formula by script on 2026-10-22 (method and a worked example: [BRAND_APPLICATION_SPEC 2.1](BRAND_APPLICATION_SPEC.md)); the header comment of `tailwind.css` carries the same list and states that `tests/unit/ui/contrast.test.ts` recomputes each pair (that test was not run for this page). The values below match the `@theme` block read on 2026-10-22.

**Brand red, taken from the client's logo supplied 2026-10-22** (`500` is the sampled value; the other steps are derived lightness steps):

| Token | Value | White on it | It on white | Note |
| --- | --- | --- | --- | --- |
| `primary-50` | `#fff1f1` | | | tint; not for text |
| `primary-100` | `#ffdcdd` | | | pressed tint |
| `primary-200` | `#ffb8ba` | | | dark surfaces only (11.24 on `ink-900`) |
| `primary-300` | `#ff868a` | | | decorative |
| `primary-400` | `#f9454d` | | 3.51 | large text and icons; text on `ink-900` 5.25 |
| **`primary-500`** | **`#de0510`** | **5.08** | **5.08** | **logo red**: primary button, promo bar, cart count, selected size. As text: white surfaces only (4.42 on `ink-100`) |
| `primary-600` | `#c4040e` | 6.23 | 6.23 | hover |
| `primary-700` | `#a8030c` | 7.83 | 7.83 | pressed, links, red text on grey (6.81 on `ink-100`) |
| `primary-800` | `#8a020a` | 10.03 | 10.03 | link hover |
| `primary-900` | `#5e0107` | 14.16 | | dark band |
| `white` | `#ffffff` | | | taken from the logo wordmark |

**PLACEHOLDER (not in the logo):** pure-grey neutrals replace the cool-tinted ones.

| Token | Value | On white | | Token | Value | On white |
| --- | --- | --- | --- | --- | --- | --- |
| `ink-50` | `#f7f7f7` | 1.06 | | `ink-500` | `#6e6e6e` | 5.10 (placeholder text) |
| `ink-100` | `#efefef` | 1.15 | | `ink-600` | `#545454` | 7.57 (`fg-muted`) |
| `ink-200` | `#dedede` | 1.35 | | `ink-700` | `#3d3d3d` | 10.86 |
| `ink-300` | `#c4c4c4` | 1.74 | | `ink-800` | `#262626` | 15.13 (white on it) |
| `ink-400` | `#8c8c8c` | 3.36 (control border) | | `ink-900` | `#141414` | 18.42 (`fg`) |

Accent (`accent-*`, amber), `success-*`, `warning-*`, `error-*`, `focus` `#1f4fd8` and `focus-inverse` `#ffcb47` keep their as-built values (PLACEHOLDER). New PLACEHOLDER tokens: `sale-fg` `#a14000` (6.46 on white; sale price text) and `sale-bg` `#fff1e0`; the sale badge is `accent-400` with `ink-900` text (10.05). **Sale and savings never use the brand red** (brand hue 357 degrees, error 4, sale 24, badge 42).

Pairs the target relies on (ratio : needed): white on `primary-500` 5.08 : 4.5; white on `primary-600` 6.23; white on `primary-700` 7.83; `primary-700` on `primary-50` 7.12; `primary-700` on `ink-100` 6.81; `primary-500` on `ink-100` **4.42 : 4.5 fails, so not allowed**; `ink-900` on `accent-400` 10.05; `sale-fg` on `sale-bg` 5.82; `ink-700` on `ink-100` 9.45; `ink-600` on `ink-100` 6.59; `ink-500` on `ink-100` **4.43 fails for text on grey**; `ink-400` on white 3.36 : 3.0 (border); focus ring `focus` on white 6.63, on `ink-200` 4.93, on `primary-500` **1.31 and on `ink-900` 2.78 fail, so red and black bands carry `.on-dark`**; `focus-inverse` on `primary-500` 3.36, on `ink-900` 12.18.

Amber accent scale as built (PLACEHOLDER): `accent-50` `#fff7e0`, `-100` `#ffecb3`, `-200` `#ffdd80`, `-300` `#ffcb47`, `-400` `#f6b414`, `-500` `#e09a00`, `-600` `#b87800`, `-700` `#8a5a00`.

Semantic roles as built: `surface-muted` (`ink-100`) is the utility bar, panels and the footer surface; `surface-inverse` (`ink-900`) is the black promo band and tooltips, no longer the footer; `sale-fg` and `sale-bg` are new. Type: `font-display` (same system stack) and the `type-display` utility approximate the logo's blocky wordmark (the 40 character guard also covers the promo bar, nav labels, group headings and accordion menu rows); no font is loaded (owner decision pending, candidates in BRAND_APPLICATION_SPEC 2.7). Shadows are tinted `rgb(20 20 20)`.

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
| `surface-inverse` | `ink-900`   | black promo band, tooltips (not the footer) |
| `fg`              | `ink-900`   | body text                            |
| `fg-muted`        | `ink-600`   | secondary text                       |
| `fg-inverse`      | `ink-100`   | text on `surface-inverse`            |
| `line`            | `ink-200`   | dividers                             |
| `line-strong`     | `ink-400`   | control borders (non-text contrast)  |

Contrast pairs checked: the list with ratios is the comment at the top of `tailwind.css` (white on `primary-500` 5.08, `ink-500` placeholder text on white 5.10, `ink-400` control border on white 3.36 against 3.0, focus ring on white 6.63). The ratios on this page were computed by script on 2026-10-22; axe runs on the gallery and the shell in `tests/e2e/gallery.spec.ts` and `tests/e2e/shell.spec.ts` (not run for this page). After any colour change redo the table and rerun both.

## Type

| Token       | Value                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `font-sans` | `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` (PLACEHOLDER) |
| `font-display` | the same system stack (PLACEHOLDER); the one place a brand font would be swapped in           |
| `font-mono` | `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`                                      |

`type-display` (utility in `tailwind.css`): weight 800, uppercase, 0.02 em tracking, line height 1.05. For short labels only: headings, nav, strips, button labels. Admin-supplied headings longer than 40 characters keep weight 800 but go back to sentence case with no tracking (`app/lib/display-type.ts`, `DISPLAY_TYPE_MAX_LENGTH` 40; entry UXD-22). Never used for product names, body copy, prices, form labels or messages.

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
- **Radius**: `rounded-choice` 0.5 rem (8 px), `rounded-card` 0.5 rem, `rounded-panel` 0.75 rem, `rounded-pill` full.
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
| Colour values (as built, since 8b31bbe) | Brand red `#DE0510` (`primary-500`) and white **taken from the client's logo supplied 2026-10-22** (sampled from the 1254 px original with a canvas read: dominant pixel `rgb(222,5,16)`; the artwork is dithered, neighbours 216 to 224 / 0 to 8 / 8 to 16). The other `primary-*` steps are lightness steps made by this project. Greys (`ink-*`), amber (`accent-*`), sale (`sale-*`), status and focus colours are made up by this project and are **PLACEHOLDER pending CLR-013**. Nothing is sampled from the reference site. The earlier teal placeholder palette no longer exists in the code. | Red and white: the client's own artwork. Placeholders: none; replaced when CLR-013 arrives. |
| Fonts          | No font is loaded. The stack is the user's system fonts.                                                                                          | None. Brand fonts: self-host WOFF2 from the project, `font-display: swap`, preload only the critical weight, record the licence here (no third-party font CDN, security rule). |
| Icons          | Drawn for this project in `storefront/app/components/ui/Icons.tsx` (24 px stroke, decorative, hidden from assistive technology). No icon library. | Project-owned.                                                                                                                                                                 |
| Logo (earlier placeholder) | A text wordmark with a moon icon in `SiteHeader.tsx`. | Removed: `SiteHeader.tsx` now renders `HeaderLogo` (`app/components/layout/BrandLogo.tsx`, commit 12da964). |
| Logo files     | **Origin: supplied by the client's owner in the project chat on 2026-10-22.** Artwork: a red disc, a bold white blocky all-caps wordmark "MATTRESS FITNESS" in two lines, a small letter-spaced tagline. Files: `mattress-fitness-logo-original.png` (1254 x 1254), `-512.png`, `-256.png`, `-180.png`, `-96.png`, `-48.png`. The resized copies were made with System.Drawing from the original; the artwork is unchanged (no recolouring, redrawing or cropping). **Location:** the five resized copies (`-512`, `-256`, `-180`, `-96`, `-48`) are in `storefront/public/brand/` (served). The 1254 px original is the master in `storefront/brand-source/mattress-fitness-logo-original.png` (with a README there), outside `public/`, so it is not part of the build and never served; the comment in `app/lib/brand.ts` says the same (verified 2026-10-22 after the review-fix commit). Observed 2026-10-22: the original PNG has **no transparent pixels** (all sampled pixels, one in seven, have alpha 255, and the corners are opaque `rgb(254,254,254)`; the smaller copies were not checked), so on a non-white surface it must be clipped round with CSS; a transparent PNG or SVG is requested (BRAND_APPLICATION_SPEC Q1). | **Rights: the client's own artwork** (supplied by the owner; no separate licence document has been seen, confirm in the handover pack, ASM-04). No third-party material. Not to be recoloured, redrawn or shown on a red surface. Provenance was until now only in a code comment in `app/lib/brand.ts`; this row is the record. |
| Logo sizes (as built) | Header: `<img>` `width`/`height` 56 attributes, `srcSet` `-96.png 1x, -180.png 2x`, displayed `size-14` (56 px) below 1024 px and `size-16` (64 px) from 1024 px (fixed in the review-fix commit; as specified), **not clipped round** (white header). Footer: `srcSet` `-256.png 256w, -512.png 512w`, `sizes` 112 px, displayed `size-24` (96 px) below 768 px and `size-28` (112 px) from 768 px, clipped with `rounded-full`, lazy. Favicon `-48.png` (48x48) and apple-touch-icon `-180.png` are in `BRAND_HEAD_LINKS` (`app/lib/brand.ts`); `BRAND_THEME_COLOR` `#DE0510` is the mobile browser chrome colour and the one hex outside the stylesheet. The 512 px file is used by the footer `srcSet` (the spec had planned the 180 and 256 files there). | Same as above. |
| Photography    | None committed. Product and brand images come from Shopify.                                                                                       | Shopify CDN only.                                                                                                                                                              |
| Reference site | Used for layout and behaviour notes only ([REFERENCE_PATTERNS](REFERENCE_PATTERNS.md)). No text, image, markup or CSS taken.                      | NFR-007.                                                                                                                                                                       |

## Changing to the client's brand

1. Edit the `@theme` blocks in `tailwind.css` (palette, `font-sans`, radii if needed) and the `@font-face` rules if fonts are self-hosted. Nothing else holds a brand value.
2. Recompute the contrast table in the file header and keep the pairs the components rely on at 4.5:1 (text) or 3:1 (borders, focus ring). Adjust the shade, not the component.
3. Run `npm run e2e -- gallery shell design-rules` (axe, touch targets, reduced motion) and review the gallery and shell at 360, 768, 1280 and 1536 px by eye.
4. Update this page, and log in [DEVIATIONS](DEVIATIONS.md) anything that now differs from the supplied kit.

## Inputs still needed from the client

- Logo: **received 2026-10-22** (PNG, six sizes). Still needed: a transparent PNG or SVG, and clear-space and minimum-size rules.
- Brand colours with hex values: the red is known from the logo (`#DE0510`, the action colour as built); still needed are the black or dark grey, greys, any secondary or accent colour and the sale colour.
- Brand fonts with a web licence, or confirmation that the system stack is fine.
- Photography direction and any approved lifestyle images.
- Written approval of the visual direction (recorded in `progress/DECISIONS.md`) and of the accessibility level (Q-012).
- A Figma file or library, only if the client has one (Q-004). Until one is supplied nothing here may claim to have been checked against Figma.
