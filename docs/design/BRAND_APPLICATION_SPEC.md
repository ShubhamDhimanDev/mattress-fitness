# Brand application spec: reference patterns in the client's own brand

Owner: `ui-ux-designer`. Written 2026-10-22 on branch `feat/brand-reference-design-real-store`. Status: **specification; built on this branch (see "Implementation status (2026-10-22)" below)**. This document itself changes nothing in `storefront/`. Every visible difference from the reference is logged as UXD-11 onward in [DEVIATIONS](DEVIATIONS.md) and is **pending client approval**.

Inputs: the pattern notes in [REFERENCE_PATTERNS](REFERENCE_PATTERNS.md) (observation pass of 2026-10-22), the client's logo supplied the same day (provenance in [BRAND_TOKENS](BRAND_TOKENS.md)), the current code in `storefront/app/components/**` and `storefront/app/styles/tailwind.css`, and the rules in [ui-implementation](../../.claude/rules/ui-implementation.md) and [ADR-0010](../decisions/ADR-0010-ui-primitives-and-design-tokens.md) (closed token set, tokens only, motion-safe, 44 px targets). No Figma file exists (Q-004), so none was read.

**IP rule (NFR-007).** The reference is used for structure only. Nothing here copies its text, images, logos, markup or CSS, and its colour values were deliberately not recorded or matched. The reference also uses a red accent; the client's own logo is red, so the similarity of hue comes from the client's brand and is not a copy. Do not sample, eyedrop or "match" any reference colour while implementing this.

**What the logo gives and does not give.** Given: one circular mark (a red disc, a bold white blocky all-caps wordmark in two lines, a small letter-spaced tagline), the red value, and white. Not given: any near-black, grey, secondary or accent colour, any typeface file, a transparent or vector version, or clear-space and minimum-size rules. Those stay placeholders (CLR-013) and are chosen here only so that the design is complete and accessible; each is marked PLACEHOLDER in [BRAND_TOKENS](BRAND_TOKENS.md).

---

## 1. Design intent in one paragraph

A white, high-contrast, promotion-dense storefront in the reference's layout (utility bar, logo row, navigation row, reassurance strip, bordered product cards, three-column size grid on the product page, a light footer), drawn in the client's red and white with near-black text and neutral greys. Headings, strips and buttons use heavy uppercase type with a little tracking to echo the blocky wordmark. The brand red is reserved for brand and action (primary buttons, the promo bar and hero band, link hover, the cart count, the selected size, home section headings and one rule above the footer). **Sale and saving never use brand red** (burnt orange text, amber badge) so a discount cannot be mistaken for the brand or for an error.

---

## 2. Tokens

The single source stays `storefront/app/styles/tailwind.css` (`@theme`). This section is the target; task BA-01 applies it.

### 2.1 Contrast method

WCAG 2.2 relative luminance: for each channel c in 0..255, `s = c / 255`, `lin = s / 12.92` if `s <= 0.03928`, else `((s + 0.055) / 1.055) ^ 2.4`; `L = 0.2126 R + 0.7152 G + 0.0722 B`; ratio `= (L_light + 0.05) / (L_dark + 0.05)`. Thresholds: 4.5 normal text, 3.0 large text (24 px, or 18.66 px bold) and non-text parts (control borders, focus ring, icons that carry meaning).

Worked example, white on the logo red `#DE0510`: R 222 gives lin 0.7304, G 5 gives 0.00152, B 16 gives 0.00518; `L = 0.2126 x 0.7304 + 0.7152 x 0.00152 + 0.0722 x 0.00518 = 0.1568`; `ratio = 1.05 / (0.1568 + 0.05) = 5.08`. All ratios below were computed with this formula by script on 2026-10-22 (not estimated), rounded to two places.

### 2.2 Brand red scale (derived from the logo red; `500` is the logo's sampled value)

The logo's red area was sampled from the 1254 px original: the dominant pixel value is `rgb(222,5,16)` = `#DE0510` (the artwork is dithered, neighbouring values 216 to 224 / 0 to 8 / 8 to 16 occur). Other steps are lightness steps of the same hue made by this project, not taken from the logo.

| Token | Hex | White text on it | It as text on white | Use |
| --- | --- | --- | --- | --- |
| `primary-50` | `#fff1f1` | | 1.05 (do not use as text) | quiet red tint: chips, selected row, hover fill |
| `primary-100` | `#ffdcdd` | | | pressed tint on tinted controls |
| `primary-200` | `#ffb8ba` | | | on dark surfaces only (11.24 on `ink-900`) |
| `primary-300` | `#ff868a` | | | decorative only |
| `primary-400` | `#f9454d` | | 3.51 (large text or icons only) | red text on `ink-900` (5.25) |
| **`primary-500`** | **`#DE0510`** | **5.08** | **5.08** | **brand: primary button, promo bar, cart count, selected size, section headings** |
| `primary-600` | `#C4040E` | 6.23 | 6.23 | button hover |
| `primary-700` | `#A8030C` | 7.83 | 7.83 | button pressed, text links, red text on grey or tint |
| `primary-800` | `#8A020A` | 10.03 | 10.03 | link hover, tag text on tint |
| `primary-900` | `#5E0107` | 14.16 | | rare: pressed link, dark band |

Rules that come from the numbers:

1. `primary-500` as **text** is allowed on white only (5.08). On `ink-100` it is 4.42 (fails 4.5) and on `primary-50` it is 4.62 (too close to rely on): on any grey or tinted surface use `primary-700` (6.81 on `ink-100`, 7.12 on `primary-50`).
2. White on `primary-500` passes 4.5 at every size (5.08), so 14 px bold white labels on red buttons and bars are compliant. No other text colour on red: do not use tints (`primary-100`) for body text on a red band.
3. Never place `primary-500` next to `primary-600` or `primary-700` to signal a state (1.23 and 1.54): hover and pressed also change the label contrast and the cursor, and selection uses an icon (section 5.3).

### 2.3 Neutrals (PLACEHOLDER: the logo contains no grey or black)

A pure-grey scale replaces the current cool-tinted one so the red reads clean. Same token names, so no component changes name.

| Token | Hex | On white | On `ink-100` | Typical use |
| --- | --- | --- | --- | --- |
| `white` | `#ffffff` | | | page, card (taken from the logo's wordmark) |
| `ink-50` | `#f7f7f7` | 1.06 | | subtle panel |
| `ink-100` | `#efefef` | 1.15 | | `surface-muted`: utility bar, footer, panels |
| `ink-200` | `#dedede` | 1.35 | | hairlines (`line`; decorative only) |
| `ink-300` | `#c4c4c4` | 1.74 | | empty star track, disabled hairline |
| `ink-400` | `#8c8c8c` | **3.36** | 2.92 | control border on white (`line-strong`, needs 3.0) |
| `ink-500` | `#6e6e6e` | **5.10** | 4.43 | placeholder text on white |
| `ink-600` | `#545454` | 7.57 | 6.59 | `fg-muted` (secondary text) |
| `ink-700` | `#3d3d3d` | 10.86 | 9.45 | utility bar and footer links |
| `ink-800` | `#262626` | | | `white` on it 15.13 |
| `ink-900` | `#141414` | 18.42 | 16.02 | `fg` (body text), black promo band (white on it 18.42) |

Rules: `ink-400` is a border colour on **white** only. On `ink-100` or `ink-50` surfaces a control border must be `ink-500` (4.43 on `ink-100`, passes 3.0) and placeholder or helper text must be `ink-600` (`ink-500` on `ink-100` is 4.43, below 4.5).

### 2.4 Sale, accent, status (all PLACEHOLDER, all distinct from the brand red)

| Role | Token | Hex | Pairing and ratio | Use |
| --- | --- | --- | --- | --- |
| Sale text | `sale-fg` (new) | `#A14000` | on white 6.46, on `sale-bg` 5.82, on `ink-100` 5.62 | sale price, "Save $x (n%)" text |
| Sale tint | `sale-bg` (new) | `#FFF1E0` | `ink-600` on it 6.82 | sale callout panel |
| Sale badge | `accent-400` (existing) | `#F6B414` | `ink-900` on it **10.05**, `ink-900` on `accent-500` 7.71 | "Save n%" tag, Sale nav pill, promo accents |
| Success | `success-fg` / `-bg` / `-solid` (existing) | `#0E5C2F` / `#E6F4EC` / `#1B7A43` | 7.15; white on solid 5.37 | unchanged |
| Warning | `warning-fg` / `-bg` / `-solid` (existing) | `#6B4100` / `#FFF4D6` / `#F6B414` | 8.05 | unchanged |
| Error | `error-fg` / `-bg` / `-solid` (existing) | `#A31616` / `#FDEAEA` / `#B42318` | 6.76; on white 7.83; white on solid 6.57 | unchanged |

Why a sale is not red: brand red is hue 357 degrees, the error red is hue 4 degrees, the sale text is hue 24 degrees (burnt orange) and the badge is hue 42 degrees (amber). A red price would read as brand or as an error. Information is never by colour alone: every sale shows the words "Sale price" (screen reader), a struck-through original price and, where space allows, "Save $x (n%)" (existing `Price` behaviour).

**Known risk (UXD-19):** the error red and the brand red are the same family (hue 4 and 357). Mitigation, mandatory: errors are always an icon plus text inside an `error-bg` box with a 1 px `error-solid` border and `role="alert"` or `aria-live`; error is never a filled button; the invalid field border is 2 px `error-solid` plus the message text. Primary buttons are never shown in an error context.

Star ratings: filled stars `ink-900` (decorative; the number and "N Reviews" are visible text), empty track `ink-300`. This replaces the amber star (2.4 : 1 on white).

### 2.5 Focus ring (unchanged values, re-verified)

3 px outline, 2 px offset, drawn once in the base layer. Values stay: `focus` `#1F4FD8`, `focus-inverse` `#FFCB47`. The ring is drawn in the gap beside the control, so the contrast that matters is against the surface behind it.

| Ring on surface | Ratio | Needs 3.0 |
| --- | --- | --- |
| `focus` on white | 6.63 | pass |
| `focus` on `ink-50` / `ink-100` / `ink-200` | 6.19 / 5.76 / 4.93 | pass |
| `focus` on `primary-50` / `primary-100` | 6.03 / 5.22 | pass |
| `focus` on `primary-500` (red band) | **1.31** | **fails: use `.on-dark`** |
| `focus` on `ink-900` | **2.78** | **fails: use `.on-dark`** |
| `focus-inverse` on `ink-900` | 12.18 | pass |
| `focus-inverse` on `primary-500` / `-600` / `-700` / `-800` | 3.36 / 4.12 / 5.17 / 6.63 | pass |

Rule: any surface that is `primary-500` or darker, or `ink-800` or darker, carries the `on-dark` class so the ring flips to yellow. This covers the promo bar, the hero band, the black promo band and the category-tile overlay. A button on a white or grey surface keeps the blue ring even when the button itself is red.

### 2.6 Semantic roles (the brand file decides which ink it is)

| Role | Now | Target |
| --- | --- | --- |
| `fg` | `ink-900` | `ink-900` (no change in name) |
| `fg-muted` | `ink-600` | `ink-600` |
| `fg-inverse` | `ink-100` | `ink-100` |
| `surface` | `white` | `white` |
| `surface-muted` | `ink-100` | `ink-100` (now also the **footer** surface) |
| `surface-inverse` | `ink-900` | `ink-900` (black promo band, tooltips; no longer the footer) |
| `line` / `line-strong` | `ink-200` / `ink-400` | same names, new neutral values |
| `sale-fg`, `sale-bg` | none | new, section 2.4 |

### 2.7 Typography

No font is loaded and no external font service is used (a Google Fonts or similar request is a third-party call; not allowed in the demo, security rule). The logo's blocky display feel is approximated with **weight, case and tracking on the system stack**.

| Token | Value |
| --- | --- |
| `font-sans` | unchanged: `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| `font-display` (new) | the same stack. It exists so one brand font can replace it in one place later. |
| `type-display` (new `@utility`) | `font-family: var(--font-display); font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; line-height: 1.05` |

`system-ui` at weight 800 resolves to the heaviest installed face (Segoe UI Black on Windows, SF Black on Apple, Roboto Black on Android), which is the closest blocky match available without a file. Where to use `type-display`: hero headlines, section headings ("Shop by size"), page titles on listing and content pages, the reassurance strip, nav top-level items, the promo bar, button labels, footer group headings, tile labels. Where **not**: product names (H1 and card titles stay sentence case, 700), body copy, prices, form labels, error messages, long headings in admin-supplied content over 40 characters (use sentence case, 800, no tracking; the component checks the length).

Scale (existing tokens, mobile first, only the pairings change):

| Role | 360 | 768 | 1280 and up |
| --- | --- | --- | --- |
| Hero headline | `text-4xl` (36/40) | `text-5xl` (48/52) | `text-display` (60/60) |
| Page title (H1, listing and content) | `text-3xl` (30/36) | `text-3xl` | `text-3xl` |
| Section heading (H2) | `text-2xl` (24/32) | `text-3xl` | `text-3xl` |
| Card title | `text-base` bold | `text-lg` (18/28) bold | `text-lg` |
| Price (card) | `text-xl` extra-bold | | |
| Price (PDP) | `text-3xl` extra-bold | | |
| Body | `text-base` (16/24) | | |
| Meta, tags, nav items | `text-sm` (14/20) | | |

**Owner decision, not added (font):** if the owner wants the wordmark feel more closely, a self-hosted open-licence file would help. Two candidates, to be verified against the upstream licence file before adoption: **Archivo Black** (single heavy weight, a wide blocky grotesque, SIL Open Font License 1.1) for headings only, or **Barlow Condensed** ExtraBold (condensed, squared terminals, SIL OFL 1.1). Rules if adopted: WOFF2 in `storefront/public/fonts/`, `@font-face` with `font-display: swap`, preload one file, `font-src 'self'` in the CSP, size measured (NFR-002) and the licence recorded in [BRAND_TOKENS](BRAND_TOKENS.md). Until the owner decides, nothing is added.

### 2.8 Shape, depth, spacing, layout

| Token | Now | Target | Why (observation) |
| --- | --- | --- | --- |
| `radius-choice` (buttons, size options, inputs, tags) | 0.25 rem (4 px) | **0.5 rem (8 px)** | reference buttons and tags about 8 px, size options 6 px |
| `radius-card` (cards, images) | 0.5 rem | 0.5 rem | reference cards 8 px |
| `radius-panel` (hero, bands, drawers) | 0.75 rem | 0.75 rem | |
| `radius-pill` | full | full | chips, count bubble, carousel arrows, nav emphasis pill only. Home and size buttons stop using pill (rounded rectangle in the reference). |
| `shadow-sm` / `md` / `lg` / `drawer` | tinted `rgb(22 27 30 / ...)` | tinted `rgb(20 20 20 / ...)` same alphas | match `ink-900` |
| Card elevation | none or shadow | **none at rest** (hairline border), `shadow-md` on hover | reference cards have no shadow |
| `container-page` | 1300 px | 1300 px (1252 px content with the 24 px gutter) | reference content about 1240 px |
| Spacing | 8 px rhythm | unchanged: section gap `py-8 md:py-12`, grid gap `gap-3` (12) mobile and `gap-6` (24) from `lg` | reference grid gap 24 px |
| `touch` | 44 px | 44 px | NFR-001; larger than the reference's 34 px search field (UXD-21) |

### 2.9 Target `@theme` values for BA-01 (colour block only; keep every other token)

```css
--color-white: #ffffff;
--color-primary-50: #fff1f1;  --color-primary-100: #ffdcdd;
--color-primary-200: #ffb8ba; --color-primary-300: #ff868a;
--color-primary-400: #f9454d; --color-primary-500: #de0510; /* logo red */
--color-primary-600: #c4040e; --color-primary-700: #a8030c;
--color-primary-800: #8a020a; --color-primary-900: #5e0107;
--color-ink-50: #f7f7f7;  --color-ink-100: #efefef; --color-ink-200: #dedede;
--color-ink-300: #c4c4c4; --color-ink-400: #8c8c8c; --color-ink-500: #6e6e6e;
--color-ink-600: #545454; --color-ink-700: #3d3d3d; --color-ink-800: #262626;
--color-ink-900: #141414;
--color-sale-fg: #a14000; --color-sale-bg: #fff1e0;
/* accent-*, success-*, warning-*, error-*, focus, focus-inverse: unchanged */
--font-display: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
--radius-choice: 0.5rem;
--shadow-sm: 0 1px 2px 0 rgb(20 20 20 / 0.08);
--shadow-md: 0 4px 12px -2px rgb(20 20 20 / 0.12);
--shadow-lg: 0 12px 28px -6px rgb(20 20 20 / 0.2);
--shadow-drawer: 0 0 48px rgb(20 20 20 / 0.28);
```

and the display utility (outside `@theme`):

```css
@utility type-display {
  font-family: var(--font-display);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  line-height: 1.05;
}
```

The `.link` class (`primary-700`, hover `primary-800`) and `::placeholder` (`ink-500`) need no change. The contrast comment at the top of `tailwind.css` must be rewritten with the table in sections 2.2 to 2.5.

---

## 3. Logo and favicon

Files (provenance in BRAND_TOKENS): the served copies `mattress-fitness-logo-512`, `-256`, `-180`, `-96`, `-48` (`.png`) are in `storefront/public/brand/`; the 1254 px master `mattress-fitness-logo-original.png` is in `storefront/brand-source/` (not served). Never recolour, redraw, stretch, add a shadow or put it on a red surface (it is a red disc: on red it disappears). Use unchanged artwork only.

**Fact found while sampling the original (2026-10-22):** the PNG has **no transparency**. Its four corners are opaque near-white (`rgb(254,254,254)`), and the disc touches the image edges. On a white surface this is invisible. On any other surface (the grey footer, a dark band) a white square would show. Decision: always render the image with `rounded-full` (a CSS clip of the square to its inscribed circle; the artwork is not altered). A one-pixel anti-aliased fringe may remain on non-white surfaces; the clean fix is a transparent PNG or SVG from the client (open question Q1).

| Place | Rendered size | `src` and `srcSet` | `sizes` | Classes |
| --- | --- | --- | --- | --- |
| Header, below `lg` | 56 px | `-96.png`; `srcSet` `-96.png 1x, -180.png 2x`; `width` and `height` attributes 56 | none (density descriptors) | `size-14` (as built: not clipped round, the header is white) |
| Header, `lg` and up | 64 px | same | same | `lg:size-16` |
| Footer, below `md` | 96 px | `-256.png`; `srcSet` `-256.png 256w, -512.png 512w`; `width` and `height` attributes 112 | `112px` | `size-24 shrink-0 rounded-full`, lazy |
| Footer, `md` and up | 112 px | same | same | `md:size-28` |

The table matches `app/lib/brand.ts` and `BrandLogo.tsx` as read on 2026-10-22; the first draft of this section said the header was clipped round and the footer used the 180 and 256 files, which is not what was built.
| Favicon | 48 px | `<link rel="icon" type="image/png" sizes="48x48" href="/brand/mattress-fitness-logo-48.png">` | | in `root.tsx` links (replaces the template SVG) |
| Touch icon | 180 px | `<link rel="apple-touch-icon" sizes="180x180" href="/brand/mattress-fitness-logo-180.png">` | | `root.tsx` |

Notes. Use a plain `<img>` with `width` and `height` attributes (as built 56 and 56 for the header, 112 and 112 for the footer) so no layout shift occurs; Hydrogen's `Image` is for Shopify CDN data, this is a static project asset (same reasoning as the ADR-0010 note). `alt="Mattress Fitness"`; the link to `/` has no other label. From `md` up a wordmark text (`type-display text-lg leading-none text-fg`, two lines "Mattress" and "Fitness", `aria-hidden="true"`) sits to the right of the disc to compensate for the small mark (at 56 px the logo's name letters are about 6 px tall and the tagline is unreadable; the tagline is decorative). Do not draw a second tagline. Working clear-space rule (client has not supplied one): at least one quarter of the diameter on every side (14 px at 56, 16 px at 64). Working minimum size 56 px. The logo link keeps the 44 px target (it is larger).

The 512 px file is used by the footer `srcSet`; the 1254 px original is not served (it is in `storefront/brand-source/`). 512 would also suit a share image if the owner wants one.

---

## 4. Layout and responsive behaviour (360, 768, 1280, 1536)

The build is mobile first (`sm` 360, `md` 768, `lg` 1024 desktop-navigation switch, `xl` 1280, `2xl` 1536). Content is capped at `max-w-page` 1300 px and centred, so **1536 looks like 1280** with wider margins; full-bleed bands (promo bar, utility bar, footer) run edge to edge.

| Area | 360 | 768 | 1280 | 1536 |
| --- | --- | --- | --- | --- |
| Header | promo (if any), utility (ZIP and store only), logo row (logo left, finder link right), control row (menu, search, account, cart), reassurance 3 compact columns | same stack, utility shows tracking, contact, chat | one main row (logo, search max `max-w-xl` right-aligned, store, account, cart with captions), nav row (56 px), reassurance spread | same, centred in 1300 px |
| Home hero | one column, text centred if no image, image below if present | two columns if image | two columns, headline `text-display` | same |
| Shop by size | 2 per row | 3 per row, block `max-w-2xl` centred | same | same |
| Brand and category tiles | 2 per row | 3 per row | 4 brand, 3 category | same |
| Collection | 1 column, **horizontal cards**, Filters button + sort stacked | 3 columns, filters in a drawer | sidebar `w-72` + **3 columns** | same |
| Product page | one column: gallery, then buy box | one column, wider | two equal columns (`lg:grid-cols-2`, gap 40 px), size grid 3 across | same |
| Product sections | stacked, accordions | stacked | specifications left (1/3), overview right (2/3) | same |
| Footer | collapsible groups, brand row stacked | groups in 3 columns | 5-column shop block | same |

No horizontal scroll at 320 px or 400 percent zoom except deliberate scroll regions (carousel rows, which are focusable regions with buttons; section 5.7).

---

## 5. Page and component specs

For every item: **Pattern** (own words), **Ours now**, **Change**. States listed where a component is new or changes. Class lists use tokens only; they are the intended result, the developer keeps existing props and logic.

### 5.1 Shared primitives (`app/components/ui/`)

**Button** (`Button.tsx`). Now: primary `primary-700`, accent amber, pill shape on `shape="pill"`, 2 px border, uppercase bold wide tracking. Change:

| Variant | Default | Hover | Pressed | Contrast (label on fill) | Where |
| --- | --- | --- | --- | --- | --- |
| `primary` | `bg-primary-500 border-primary-500 text-white` | `bg-primary-600 border-primary-600` | `bg-primary-700` | 5.08 / 6.23 / 7.83 | all main actions, Add to cart, shop-by-size tiles |
| `secondary` | `border-primary-500 bg-surface text-primary-700` | `bg-primary-50` | `bg-primary-100` | 7.83 / 7.12 / 6.16 | Load more, Filters, second action on white |
| `ghost` | transparent, `text-primary-700` | `bg-primary-50` | `bg-primary-100` | 7.83 / 7.12 / 6.16 | text-like actions |
| `accent` | `bg-accent-400 text-ink-900` | `accent-300` | `accent-500` | 10.05 / 12.18 / 7.71 | actions on dark bands |
| `inverse` (new) | `bg-white border-white text-primary-700` | `bg-primary-50` | `bg-primary-100` | 7.83 / 7.12 / 6.16 | actions on the red hero band |
| `inverse-outline` (new) | transparent, `border-white text-white` | `bg-white text-primary-700` | `bg-primary-50 text-primary-700` | 5.08 on red; 7.83 hover | second action on the red hero band |

Labels: `type-display` (uppercase, 800) for all except `ghost` (sentence case, 700). Sizes unchanged (`sm` 44, `md` 48, `lg` 56 px). Radius: `rounded-choice` (8 px) by default; **stop using `shape="pill"` for the home hero and shop-by-size buttons** (reference: rounded rectangles). `pill` stays available. Disabled and loading: unchanged (`opacity-60`, spinner, `aria-busy`). Focus: global ring; the two `inverse` variants only appear inside an `on-dark` band, so the ring is yellow there. Keyboard: native button or link, Enter and Space.

**IconButton** (`IconButton.tsx`). Count bubble: `bg-primary-500 text-white` (5.08, 12 px bold, was amber). The `solid` variant becomes `bg-primary-500` (hover 600, pressed 700). Ghost hover `bg-surface-muted` unchanged. Caption under the icon from `lg` stays (our addition; the reference has bare icons).

**Badge** (`Badge.tsx`). `sale`: `bg-accent-400 text-ink-900` with the tag icon (10.05) (was solid error red). `gift`: `border border-primary-500 bg-surface text-primary-700` (7.83; outlined like the reference tag, not filled). `new`: `bg-ink-900 text-white`. `neutral`: `bg-ink-100 text-ink-700` (9.45). Radius `rounded-choice`. Text stays `text-xs` bold uppercase with `tracking-wide`; add `text-sm normal-case` when the badge is the **under-image card tag** (section 5.5) so a long offer line stays readable.

**Price** (`Price.tsx`). Replace the two `text-error-fg` classes with `text-sale-fg` (price and "Save $x (n%)"); the struck original stays `text-fg-muted`. Add `font-extrabold` to the main amount. Screen-reader texts unchanged. The "From" prefix is `text-fg-muted` small, not uppercase (reference: a small "From" word before the bold amount): drop `uppercase` from the prefix.

**Rating** (`Rating.tsx`). Filled star `text-ink-900`, track `text-ink-300`, size `size-5`. The visible count text becomes `N Reviews` (singular "Review") in `text-sm font-bold text-fg` (still `aria-hidden`; the `sr-only` sentence already carries the value). With no reviews provider (Q-011) the component renders nothing as today.

**Checkbox and Radio** (`Checkbox.tsx`, `Radio.tsx`). The native control stays (`accent-color`): change `accent-primary-700` to `accent-primary-500`. Control border on white: native; verify the unchecked box edge is at least 3 : 1 in Chromium, Firefox and WebKit (the browser draws it; if one fails, add `border-line-strong` through `appearance-none` styling in a follow-up, not now). Label row stays 44 px. In filter lists on a grey surface (none today) the label colour must be `fg`.

**SizeSelector** (`SizeSelector.tsx`). Selected option: `border-primary-700 bg-primary-500 text-white` (5.08) **plus a 16 px `CheckIcon` before the label** (wrapper gets `group`, the icon is `hidden group-has-[:checked]:inline`), so selection never relies on colour (WCAG 1.4.1; supersedes the amber fill in UXD-07, see UXD-15). Unselected: `border-line-strong bg-surface text-fg`, hover `border-primary-500`. Sold out: unchanged (struck through, "Sold out" text, `bg-surface-muted text-fg-muted`). Min height `min-h-14` (56 px) so two-line labels fit (reference 60 px); `rounded-choice`. Grid: **`grid-cols-2 sm:grid-cols-3`** (`sm` is 360 px, so phones from 360 px get three columns like the reference desktop and narrower windows, 320 px or 400 percent zoom, get two; the reference itself uses two columns on a 390 px phone). The line under the legend keeps showing dimensions of the selected size.

**Accordion** (`Accordion.tsx`). Structure unchanged (APG pattern already). Row text `font-extrabold`, chevron `text-fg-muted`; row hover `bg-surface-muted`. Use for the product page "about the brand", "delivery and shipping" and "warranty" rows (5.6).

**Input and Select** (`Input.tsx`, `Select.tsx`). Border `border-line-strong` (3.36 on white), radius `rounded-choice`; on a grey surface use `border-ink-500` (section 2.3 rule). The focus ring is global. Invalid: 2 px `error-solid` border plus message (existing).

### 5.2 Header (REQ-NAV-001)

**Pattern.** Brand-switch strip; grey utility bar with two underlined icon links at the left and plain text links at the right; main row with logo left, search at the right with the magnifier inside, solid icons; centred navigation row with chevrons on items that open a panel; three-item reassurance strip; the header turns compact and fixed on scroll.

**Ours now.** Promo bar (amber), optional top strip (hidden), utility bar (grey), main row with a moon icon and the site name as logo, pill search, `IconButton`s, desktop `MainNav`, `ReassuranceStrip` (tinted, content-gated).

**Change.**

| Part | Target |
| --- | --- |
| Promo bar (`PromoBar.tsx`) | `on-dark bg-primary-500 text-white`, `type-display text-sm`, link underlined; keep `min-h-touch` and the "no text from admin means no bar" rule |
| Top strip (`TopStrip.tsx`) | no change (hidden; the client has no sister brand) |
| Utility bar (`UtilityBar.tsx`) | `bg-surface-muted text-ink-700` (9.45); ZIP and store links `font-bold underline underline-offset-2 hover:no-underline` with their icons; right links regular, underline on hover. 44 px high. **As built (QA BV-006, UXD-28): the right-hand links show from 1024 px (`lg:flex`), not 768 px**, because they need about 870 px beside the ZIP and store controls and wrapped the bar to 88 px at 768 px. The menu button stays until 1024 px and the menu lists the same links, so nothing is unreachable. (The 768 px column of the section 4 table above, "utility shows tracking, contact, chat", is superseded.) |
| Main row (`SiteHeader.tsx`) | `BrandLogo` (section 3) replaces the moon icon and name; row padding `py-2`; at `lg` the logo is 64 px so the row is 80 px high; search spans the middle column but is capped `lg:max-w-xl lg:justify-self-end` |
| Search (`HeaderSearch.tsx`) | input `rounded-l-choice` (was pill), border `border-line-strong`; submit `rounded-r-choice bg-primary-500 border-primary-500 text-white hover:bg-primary-600 hover:border-primary-600`; suggestion panel unchanged |
| Navigation (`MainNav.tsx`) | top item `type-display text-sm`, `min-h-14` (56 px), hover `text-primary-700` (7.83), open `bg-primary-50 text-primary-700` (7.12); current page keeps underline; the emphasised item (Sale) keeps the amber pill with `ink-900` text. Panel: `border-t-4 border-primary-500 bg-surface shadow-md`, group headings `text-xs font-extrabold uppercase tracking-wide text-fg` (was muted), "View all" link `text-primary-700` bold. Keyboard behaviour unchanged (disclosure, arrows, Esc) |
| Reassurance strip (`ReassuranceStrip.tsx`) | `bg-surface border-b border-line text-fg`, text `type-display text-xs md:text-sm`, icons `text-primary-500 size-6` (5.08, non-text 3.0). Still hidden until the client supplies the wording (UXD-03) |
| Scroll behaviour | **not sticky** (UXD-12) |

States for the nav button: default, hover (colour), focus-visible (ring), expanded (tint and chevron turned), current page (underline). Mobile menu drawer: no structural change; its heading uses `type-display`, rows `font-extrabold`.

Heights, top to bottom at 1280 with a promo message: promo 44, utility 44, main row 80, navigation 56, reassurance 48 = 272 px (the reference is about 263 px with its brand-switch strip); without a promo message and without the reassurance strip it is 180 px.

### 5.3 Footer (`SiteFooter.tsx`)

**Pattern.** Light grey footer: signup band at the top (email, text message), a brand row with the logo and round social icons, a quick-links row, three link groups with two sub-columns each, a big five-sub-column shop block, then the legal line.

**Ours now.** Dark `surface-inverse` footer, support groups (3) and shop groups (5 at `lg`), collapsible groups below 768 px, legal row with the phone link.

**Change.**

1. Surface `bg-surface-muted text-fg`; remove `on-dark` (the ring is blue: 5.76 on `ink-100`). Add `border-t-4 border-primary-500` on top of the footer as the one brand accent.
2. Group headings: `type-display text-sm text-fg`. Links: `text-sm text-ink-700 hover:text-primary-700 hover:underline` (9.45 and 6.81 on `ink-100`), 44 px rows as now. Mobile separators `border-ink-300`.
3. Add a brand row above the groups: `BrandLogo` footer size and, at the right, the social links **only when the client supplies the URLs** (REQ-CNT-001; round `border-2 border-ink-700` icon links, 44 px, `aria-label` per network). Until then the row shows the logo only.
4. Add a quick-links row (order tracking, delivery information, account at the left; store locator, contact at the right; text `text-base font-bold`), which reuses `UTILITY_LINKS` and `STORE_LOCATOR_PATH`.
5. Signup band: **not rendered** until the email and text-message providers and wording exist (P7-02, UXD-16). Reserve no space. When built: a heading in `type-display text-primary-700` (7.83 on `ink-100`), a labelled email field, a `primary` button, consent text for the text-message line (NFR-011).
6. Bottom row: copyright `text-sm text-ink-700`, legal links and the phone link (existing).

### 5.4 Home (`HomeSections.tsx`, `BannerSection.tsx`, `CatalogSections.tsx`; REQ-HOME-001)

Section order stays admin-driven; the observed order is the default order guidance for the client (reassurance, hero, shop by size, brands, finance, finder, features, in-store blocks, categories, partner banner, signup).

| Block | Pattern | Change |
| --- | --- | --- |
| Hero (`BannerSection` type `hero`, and `PlaceholderHero`) | container-width band, huge headline, subline, two buttons, centred | frame `on-dark rounded-panel bg-primary-500 text-white px-6 py-12 md:px-12 md:py-16`; headline `type-display text-4xl md:text-5xl xl:text-display`; subline `text-lg text-white` (never a tint on the red); buttons `inverse` (first) and `inverse-outline` (second), size `lg`, rounded rectangle; **centred single column when there is no image**, two columns (`md:grid-cols-2`, text left) when admin supplies one. Image `rounded-card`. Heading stays the single `h1` |
| Shop by size (`SizeTiles`) | centred red uppercase heading, six red buttons, 3 per row desktop, 2 mobile, block narrower than the page | heading `type-display text-2xl md:text-3xl text-primary-500 text-center` (5.08; large text); grid `mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-3 md:gap-4`; each tile `Button variant="primary" size="lg" fullWidth` (was outlined pill) |
| Featured products (`FeaturedProducts`) | product cards in a row | heading `type-display text-2xl`, "View all" link `text-primary-700` bold; grid `grid-cols-2 gap-3 md:grid-cols-4 md:gap-6`; cards use the new `ProductItem` (5.5) in stack layout |
| Brand tiles (`BrandTiles`) | large image tiles | tile `rounded-card border border-line bg-surface p-4 hover:border-primary-500 hover:shadow-md` (was `hover:border-ink-900`); heading as above |
| Category tiles (`CategoryTiles`) | image tiles with the label centred over a dark overlay | label **over** the image: tile `relative aspect-[4/3] overflow-hidden rounded-card`, overlay `absolute inset-0 flex items-center justify-center bg-ink-900/60 px-3 text-center type-display text-lg text-white`; worst case (white photo under the 60 percent overlay) white text is about 4.8 : 1; with no image the tile is `bg-ink-800` with the same label (15.13). The link keeps its text content, so the name is unchanged |
| Promo banner (`type promo-banner`) | strong coloured block with centred text and a button | `on-dark rounded-panel bg-ink-900 text-white`, heading `type-display`, button `accent` |
| Financing (`type financing`) | banner with a big statement and a button | `rounded-panel bg-surface-muted text-fg`, button `primary`. Wording only from admin (B-15) |
| Assurance placeholder | | `bg-primary-50`, links `text-primary-800` (9.12) as now |

### 5.5 Product card and listing (`ProductItem.tsx`, `ProductListing.tsx`, `FilterPanel.tsx`, `PromoTileCard.tsx`; REQ-COL-001 to REQ-COL-003)

**Card pattern (own words).** A hairline-bordered 8 px card with inner padding; an almost square image inset in the padding; an **outlined tag under the image**; the product name, bold, up to three lines; the star row and review count; the price line with a small "From" and a bold amount, a struck original and a sale amount when discounted; no add-to-cart and no compare control; equal heights in a row. On a phone the card is **horizontal** (image about 160 px left, content right).

**Change to `ProductItem`.**

1. New prop `layout?: 'stack' | 'row'` (default `'stack'`). `'row'` means "row below 768 px, stack from 768 px"; the collection listing and search results pass `'row'`; the home featured block keeps `'stack'`. DOM order is identical in both (image, tag, title, rating, price, compare) so reading order and focus order never change.
2. Container: `group relative flex h-full flex-col gap-2 rounded-card border border-line bg-surface p-3 motion-safe:transition-shadow hover:shadow-md` and for `'row'`: `max-md:grid max-md:grid-cols-5 max-md:gap-3` with the image wrapper `max-md:col-span-2` and the content wrapper `max-md:col-span-3`.
3. Image: `aspect-square overflow-hidden rounded-choice bg-surface-muted`, keep `object-cover` and the hover zoom behind `motion-safe`. **Remove the overlay badges from the image** (the sold-out neutral badge may stay as a small overlay because it states availability).
4. Tag line under the image (new): `sale` badge (`Save n%`, amber) and any `gift` badge (outlined red) in `text-sm normal-case`; only rendered when the data exists (compare-at above price; gift from Shopify data). Never a promise from the front end (B-15).
5. Vendor line `text-xs font-extrabold uppercase tracking-wide text-fg-muted`; title `text-base font-bold md:text-lg`, `md:line-clamp-4` (as built: no clamp on phones, four lines from 768 px; the first draft said three lines at every width); rating (5.1); attribute badges as now (`neutral`); price `size="sm"` becomes `size="md"` (20 px) with the new `Price` colours; compare toggle unchanged (our addition).
6. States: default, hover (shadow and underline of the title), focus-visible (the cover link keeps its global ring; because the link's `after:inset-0` covers the card, verify in the browser that the ring is fully visible at the card edge and is not clipped by the card's padding or the grid), sold out (neutral badge, price still shown), loading (use `Skeleton` with the same aspect ratio), empty and error are handled by the listing.

**Change to `ProductListing`.**

- Wrapper: sidebar `w-64` to `w-72` (288 px); gap `lg:gap-8` stays.
- Grid: `grid-cols-1 gap-3` (row cards) at base, `md:grid-cols-3 md:gap-6`, `lg:grid-cols-2`, `xl:grid-cols-3` (was `md:3, xl:4`; with the sidebar the content width at 1280 is about 900 px, so three columns of about 290 px match the reference's three at 1440).
- Count line: `text-lg font-bold text-fg` (was small muted), still `role="status"`.
- Toolbar below `lg`: the Filters button becomes `secondary`, full width on its own row (`w-full`), sort select below; from `lg` the sort sits at the right of the count line (as now).
- Page title (route files, `h1`): `type-display text-3xl` with `border-b border-line pb-4` and `mb-6`, as the reference's rule under the title. Our breadcrumb (UXD-08) stays above it.
- "Load more": `secondary` `lg`, centred (as now).

**Change to `FilterPanel`.** Group summary `text-lg font-extrabold`; replace the "+" and minus glyphs with `ChevronDownIcon` turning 180 degrees when open (`motion-safe:transition-transform`, as the Accordion); keep native `details`/`summary` (keyboard and screen reader behaviour free). Active chips: `bg-primary-50 text-primary-800` (9.12) as now. Instant apply stays (the reference applies on a button; ours updates the URL on each tick, which is better; the drawer keeps its "Show results" button).

**Change to `PromoTileCard`.** Surface `bg-surface-muted` (was `primary-50`), heading `type-display text-xl text-fg`, a `primary` button label when the tile has a link; the tile stretches to the row height (`h-full`) like the reference's tall tiles. A **red finder tile** (`on-dark bg-primary-500 text-white`, white `inverse` button) is allowed only when the admin entry says so: that needs an optional tone field in the promo-tile metaobject (data task for the Shopify developer, not part of BA-07; until then every tile is grey).

### 5.6 Product page (`ProductBuyBox.tsx`, `ProductGallery.tsx`, `ProductSections.tsx`, route `products.$handle.tsx`; REQ-PDP-001, REQ-PDP-002)

**Pattern.** Two equal columns: gallery with arrows and dots on the left; on the right rating, title, tag, price, size line, three-column size grid with the selected size filled, a full-width Add to cart, a grey panel with three white fulfilment tiles, collapsed guarantee rows; below, horizontal "also need" and "bought with" rows, a two-column specification and overview block, collapsed brand, delivery and warranty rows, comparison, reviews. No sticky bar. On a phone the title comes first.

**Change.**

| Part | Target |
| --- | --- |
| Page grid (route) | `lg:grid-cols-2 lg:gap-10` (40 px); gallery left, `ProductBuyBox` right, no sticky column |
| Gallery | keep arrows (`size-touch rounded-pill bg-surface shadow-md`) and the counter; selected thumbnail border `border-primary-500` (was `ink-900`); keep thumbnails (UXD-17); `aspect-square` and `Image` unchanged |
| Buy box order | vendor, title (`text-3xl font-bold`, sentence case), tag line (gift outlined, sale amber), price block, size line, size selector, Add to cart, then our panels; the reviews slot (TODO P3B-12) goes between title and tag when a provider exists |
| Price | `Price size="lg" showSavings` with `sale-fg` (5.3) |
| Size selector | section 5.1; Add to cart `Button size="lg" fullWidth`, label sentence case allowed here: the button uses the default `type-display` (uppercase) like all primary actions (UXD-13) |
| Fulfilment panel (P3B-10, not built yet) | `rounded-card bg-surface-muted p-3` holding three white tiles `rounded-choice bg-surface p-3`; icon 24 px, label `text-sm font-bold`, action link `text-primary-700 underline` (the delivery tile is the existing `DeliveryCheck`). Layout: **stacked rows (icon left) below 768 px, three columns from 768 px** (reference keeps three columns at 390; 105 px tiles break link text at 200 percent zoom, UXD-18) |
| Guarantee rows | `Accordion type="multiple"`, content from the client (B-15); nothing rendered until supplied |
| "You might also need", "Frequently bought with" (P4-03, REQ-ADD-001/002, not built) | a `ul` in a focusable scroll region (`overflow-x-auto snap-x`, `tabIndex=0`, `aria-label`), cards `w-44 shrink-0 snap-start` (the card of 5.5, stack layout, with its own `Button size="sm"`), previous and next buttons 44 px for mouse and screen reader users; the bundle row adds a checkbox per card, the total (from Shopify, never computed in the browser) and an "Add all to cart" `primary` button at the right. Prices and discounts come from Shopify only |
| Sections (`ProductSections.tsx`) | from `lg`: `grid lg:grid-cols-3 lg:gap-10`, left column (`lg:col-span-1`) = **specification tiles** (2 x 2 grid `grid grid-cols-2 border border-line`, each tile centred with label `text-xs font-extrabold uppercase tracking-wide text-fg-muted` and value `text-lg font-bold`; tiles for comfort level, sleep positions, height, type; the remaining rows stay in the existing definition table below) then features; right column (`lg:col-span-2`) = overview. Below: `Accordion type="multiple"` with "About {brand}", "Delivery and shipping", "Warranty" (the brand logo and see-all link stay inside the first row). FAQs stay as they are. All content remains in the HTML (Accordion uses `hidden`) |
| Mobile order | gallery first, then buy box (UXD-18): the title is not duplicated above the gallery |

States for the buy box: in stock, sold out (button label and disabled), loading (button `loading`), error (`CartMessages`, alert with icon and text). No new interactive control other than those in 5.1.

### 5.7 Cart (`CartMain.tsx`, `CartSummary.tsx`, `CartLineItem.tsx`, `FreeDeliveryProgress.tsx`, `CartOffers.tsx`, `routes/cart.tsx`)

**Pattern (only the empty state was observed).** A page with a 30 px bold title, one sentence and a red "Continue shopping" button under the normal header; adding an item and the filled layout were not observed.

**Change (tokens and type only; structure and behaviour stay: drawer plus page, hosted checkout, ADR-0003).** Page and drawer title `type-display text-2xl`; empty state: sentence plus `Button variant="primary"` to `/collections/all`; checkout button `primary size="lg" fullWidth`; line sale price `text-sale-fg`; remove link `text-primary-700 underline`; `FreeDeliveryProgress` fill `bg-primary-500` on a `bg-ink-200` track with the text amount beside it (the bar is decorative, the text carries the value); offers tags use the `gift` badge. The drawer keeps `max-w-drawer` and its focus trap.

### 5.8 Interactive states checklist (every component above)

Default, hover, focus-visible (global ring, yellow on `on-dark` surfaces), active (pressed shade), disabled (`opacity-60`, not focusable for buttons), loading (spinner, `aria-busy`), error (icon + text, `role="alert"`). Keyboard path: unchanged for Button, IconButton, MainNav (disclosure), Accordion, FilterPanel (`details`), SizeSelector (radio arrows), gallery (arrow keys), carousel rows (new: Tab into the region, arrow keys scroll, buttons Previous and Next). Screen readers: logo link named "Mattress Fitness"; category tile name unchanged; selected size announced by the checked radio plus visible "Size: label"; sale announced as "Sale price" and "Original price" (existing). Motion: everything animated stays behind `motion-safe:`; no new animation is introduced.

---

## 6. Implementation checklist (ordered; each task is small and owns its files)

Task IDs are proposals (`BA-xx`); the orchestrator registers them in `plans/BACKLOG.md` (this agent may only edit `docs/design/`). Requirements: NFR-001, NFR-003, NFR-007, NFR-008 for all; page IDs per task. Rule for all tasks: tokens only, no hex in components, run `npm run check` and `npm run e2e -- gallery shell design-rules`, check at 360, 768, 1280 and 1536 px, no two tasks edit the same file at once.

| Order | ID | What | Files (all under `storefront/` unless noted) | Done when |
| --- | --- | --- | --- | --- |
| 1 | BA-01 | Tokens: palette (2.9), `font-display`, `type-display`, `radius-choice` 0.5 rem, shadow tint, rewrite the contrast comment with section 2 tables | `app/styles/tailwind.css` | build and lint pass; gallery and shell axe specs show no serious or critical issues; the whole site renders in red, white and grey with no teal left (`grep -R "primary-" app` still resolves: names unchanged) |
| 2a | BA-02 | `BrandLogo` component (header and footer sizes, section 3), favicon and touch-icon links, replace the moon-and-name `Logo` in the header; add a gallery entry | new `app/components/ui/BrandLogo.tsx`; `app/components/layout/SiteHeader.tsx` (Logo function and imports only); `app/root.tsx` (links); `app/routes/_dev.components.tsx` | logo link named "Mattress Fitness"; no layout shift (width and height set); disc round on white and grey backgrounds |
| 2b | BA-03 | Primitives: Button (variants `inverse`, `inverse-outline`, radius, labels), IconButton bubble, Badge variants, Price colours and "From" style, Rating stars and count, Checkbox and Radio accent, SizeSelector selected state with check icon, `grid-cols-2 sm:grid-cols-3` | `app/components/ui/Button.tsx`, `IconButton.tsx`, `Badge.tsx`, `Price.tsx`, `Rating.tsx`, `Checkbox.tsx`, `Radio.tsx`, `SizeSelector.tsx`; `app/routes/_dev.components.tsx` (all new states); unit tests under `tests/unit/ui/` | every variant has all states in the gallery; contrast pairs match section 5.1; `motionSafe` unit test passes |
| 3 | BA-04 | Header: promo bar, utility bar, main row layout (80 px at `lg`, search cap), search shape, nav type and panel, reassurance strip | `app/components/layout/PromoBar.tsx`, `UtilityBar.tsx`, `HeaderSearch.tsx`, `MainNav.tsx`, `ReassuranceStrip.tsx`, `SiteHeader.tsx` (layout classes only; after BA-02) | keyboard and shell specs pass; heights as in 5.2; focus ring yellow on the promo bar |
| 4 | BA-05 | Footer: light surface, brand row, quick links, group styles; signup band and social icons left out until content exists | `app/components/layout/SiteFooter.tsx`; `app/lib/navigation.ts` (footer quick-link list only if needed) | footer text contrast 4.5 : 1 or better on `ink-100`; logo clipped round; mobile groups still collapse |
| 5 | BA-06 | Home: hero (red band, inverse buttons, centred without image), size tiles (filled, `max-w-2xl`), category tiles with overlay, promo and financing frames, brand tile hover | `app/components/home/HomeSections.tsx`, `BannerSection.tsx`, `CatalogSections.tsx` | one `h1`; white text on every band at 4.5 : 1 or better; tiles keep their link names |
| 6 | BA-07 | Product card (row/stack layout, tag under image, price size) and listing (columns, count line, toolbar, title rule, filter chevrons, promo tile surface) | `app/components/ProductItem.tsx`, `app/components/collection/ProductListing.tsx`, `FilterPanel.tsx`, `PromoTileCard.tsx`; the `h1` in `app/routes/collections.$handle.tsx` and `brands.$handle.tsx` | Load more still moves focus to the first new card (`data-product-index`); no horizontal scroll at 320 px; row cards at 360, stack from 768 |
| 7 | BA-08 | Product page: two-column grid, thumbnail border, sections grid with specification tiles, accordions for brand, delivery, warranty | `app/routes/products.$handle.tsx` (grid classes only), `app/components/product/ProductGallery.tsx`, `ProductBuyBox.tsx` (class changes only), `ProductSections.tsx` | content of collapsed rows is in the HTML; the page is two equal columns from 1024 px; axe clean |
| 8 | BA-09 | Cart visual pass (tokens, titles, empty state button) | `app/components/CartMain.tsx`, `CartSummary.tsx`, `CartLineItem.tsx`, `cart/FreeDeliveryProgress.tsx`, `cart/CartOffers.tsx`, `app/routes/cart.tsx` | drawer and page keep focus management; empty state button works |
| 9 | BA-10 | Verification and records: axe on home, collection (with filters open), product, cart, drawer, mobile menu; four-width screenshots before and after; keyboard-only journey; fix e2e assertions that name old colours or classes; update [BRAND_TOKENS](BRAND_TOKENS.md) "as built" and every UXD status | `tests/e2e/*.spec.ts`, `docs/design/BRAND_TOKENS.md`, `docs/design/DEVIATIONS.md` | zero serious or critical axe issues; before and after screenshots stored outside the repository or in the test artefacts; deviations updated |
| later | BA-11 (blocked) | Signup band, social icons, financing line, fulfilment tiles, carousels: build when their data or provider exists (P7-02, P3B-10, P4-03, Q-011, B-15) | n/a | not started |

Tasks 2a and 2b can run in parallel (no shared files). Everything after BA-01 can also proceed one task at a time by different developers as long as no two share a file (BA-02 and BA-04 both touch `SiteHeader.tsx`, so BA-04 starts after BA-02).

---

## Implementation status (2026-10-22)

Checked by reading the code at HEAD (not by running tests). Commits on `feat/brand-reference-design-real-store`. Differences from this spec are logged in [DEVIATIONS](DEVIATIONS.md) (build status table under the log); as-built values are in [BRAND_TOKENS](BRAND_TOKENS.md).

| Task | Commit | State | Notes |
| --- | --- | --- | --- |
| BA-01 tokens | 8b31bbe | Built | Palette, `font-display`, `type-display`, 8 px `choice` radius, neutral shadows, `sale-*` tokens, contrast comment rewritten |
| BA-02 logo and favicon | 12da964, then the review-fix commit | Built; text wordmark not built | Header logo 56 px below `lg`, 64 px at `lg` (fixed in the review-fix commit); the 1254 px original moved to `storefront/brand-source/` (README there, not in `public/`); text wordmark beside the logo from 768 px not built |
| BA-03 primitives | 8b31bbe | Built | Button variants `inverse` and `inverse-outline`, badge sizes, `Price`, `Rating`, `SizeSelector` check icon, accordion `menu` variant |
| BA-04 header | 1ba6624 | Built | Red promo bar, 80 px-class logo row, nav type and red panel rule, reassurance strip; header not sticky |
| BA-05 footer | 1ba6624 | Built | Light grey, red top rule, logo, quick links; signup band and social icons deliberately absent |
| BA-06 home | 396baf4 | Built | Red hero band, filled size tiles, overlay category tiles; category-tile focus ring is blue, not yellow |
| BA-07 card and listing | 396baf4 | Built | Row and stack card, tag under image, sidebar 288 px, grey promo tiles |
| BA-08 product page | 0f1deae | Partly built | Two columns, specification tiles, brand and warranty accordions; no "Delivery and shipping" row (no supplied wording, B-15) |
| BA-09 cart | 0f1deae | Built | Tokens, titles and empty state button |
| BA-10 verification | 42dfae0, f3e73f9, 4655f77, d20f25c, 2cd0931 (after 6366e20) | Done (independent QA run), designer decisions open | QA run recorded in [BRAND_VERIFICATION](../testing/BRAND_VERIFICATION.md). BV-001 to BV-007 and BV-012 fixed in f3e73f9; review notes in 2cd0931; the code-reviewer approved f3e73f9 and 4655f77 with notes and no Blocker or Major (as reported by the coordinator; the review report was not read here); BV-008 mitigated (card padding `p-2.5 md:p-3`); BV-009 to BV-011 are open designer decisions. The QA run used Chromium only (no WebKit, Firefox, real device or assistive technology) |
| BA-11 | none | Blocked | Signup, social, financing, fulfilment tiles, carousels: need client content or other tasks |

Review-fix commit 6366e20 on this branch (the code was re-read on 2026-10-22; the commit hash itself was not checked with git, it is as given by the coordinator), changes against this spec:

| Area | Change | Where |
| --- | --- | --- |
| Logo | Header 56 px below `lg`, 64 px at `lg`; original in `storefront/brand-source/`, comment in `brand.ts` corrected | `BrandLogo.tsx`, `lib/brand.ts` |
| Info colour | Info toast and `QuizIntro` frame are a neutral ink frame (UXD-24) | `Toast.tsx`, `QuizIntro.tsx` |
| 40 character guard | Also covers promo bar, nav labels, nav and mobile group headings, footer group headings, accordion menu rows (UXD-22) | `PromoBar`, `MainNav`, `MobileNav`, `SiteFooter`, `Accordion` |
| Footer quick links | `/track-order`, `/pages/delivery-and-shipping`, `/pages/contact` hidden (`awaitingContent`); row shows "Your account" and "Store locator"; "Track your order" in the support group held back (UXD-26) | `lib/navigation.ts` |
| Card titles | Clamp at 4 lines only from `md`, none below | `ProductItem.tsx` |
| Find in page | Brand and FAQ accordion rows use `hidden="until-found"` (Ctrl+F reveal not verified on a real page) | `Accordion.tsx` |
| Price | Savings badge inside the live price region; stale price italic, not dimmed | `ProductBuyBox.tsx`, `Price.tsx` |
| QA fixes BV-004, BV-006, BV-008 and focus-ring fixes | Utility bar right links from `lg` (UXD-28). Product card title clamp (`md:line-clamp-4`) is on an inner span, so the focus ring on the link is never clipped. Card padding `p-2.5 md:p-3`. Hero headline steps `text-3xl sm:text-4xl md:text-5xl xl:text-display` (spec 2.7 said `text-4xl` at 360). `.type-display` gets `overflow-wrap: anywhere`. Gallery thumbnail strip carries ring padding (`-m-1.5 p-1.5`). Tabs draw the ring inside (`-outline-offset-3`) | `UtilityBar.tsx`, `ProductItem.tsx`, `BannerSection.tsx`, `HomeSections.tsx`, `tailwind.css`, `ProductGallery.tsx`, `Tabs.tsx` |
| Cart summary | Subtotal shows the last amount in italic (never dimmed) or a placeholder while Shopify answers; an always-mounted `role="status"` text says "Updating price" | `CartSummary.tsx` |
| Skip link | `on-dark` yellow ring on an ink band | `SkipLink.tsx` |

**Open designer decisions (QA BV-009 to BV-011, not decided):** the category-tile overlay can look muddy over mid-tone photos; with four size tiles the fourth sits alone on the second row; the gap between the size legend and the first option is about 40 px; the text wordmark beside the header logo is not built; whether the tagline stays as live footer text (Q4).

Still needing the client: Q1 transparent logo or SVG; Q2 brand greys, black, accent and sale colour; Q3 display typeface; Q4 clear-space rules and permission to show the tagline as text (it is shown, UXD-23); Q5 approval of the look (UXD-11 to UXD-25); Q6 content for signup, social, financing, guarantees and "Delivery and shipping".

---

## 7. Open questions for the client or owner

1. **Q1.** Please supply the logo as a transparent PNG or SVG (the supplied PNG has opaque white corners). Until then the logo is clipped round in CSS.
2. **Q2.** Do you have brand greys, a black, a secondary colour or an accent? The near-black, greys, amber and the burnt-orange sale colour here are our placeholders (CLR-013).
3. **Q3.** Do you want a display typeface? Candidates and licences in 2.7; nothing is added without your decision.
4. **Q4.** Logo clear-space and minimum-size rules, and whether the tagline may be used as live text (for example in the footer).
5. **Q5.** Approve the visual direction as specified here, including uppercase heavy type (UXD-13), the non-red sale colour (UXD-14), no sticky header (UXD-12) and a light grey footer.
6. **Q6.** Social links, email and text-message signup providers and wording, financing wording, guarantee wording (UXD-03 to UXD-05, UXD-16).
