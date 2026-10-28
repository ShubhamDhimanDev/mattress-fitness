# Redesign foundation: tokens, utilities and primitives (CR-31, R1 and R2)

Read this instead of the code. Built 2026-10-27 on branch `feat/cr31-redesign` (decision DEC-134). Plan: [REDESIGN_PLAN](REDESIGN_PLAN.md). Values and provenance: [BRAND_TOKENS](BRAND_TOKENS.md). Visual check: the dev-only gallery at `/components` (route file `storefront/app/routes/_dev.components.tsx`); every primitive below appears there in each state.

Labels: **NEW** (did not exist), **CHANGED** (same name and props, new look or behaviour noted), **UNCHANGED**. No prop was removed or renamed.

Rules that still hold: theme utilities only (no hex, no one-off pixel sizes), mobile first, 44 px targets, every motion class behind `motion-safe:` (a unit test fails otherwise), no money arithmetic in components. `cn()` has no tailwind-merge, so a caller's `className` adds layout (margin, width, grid placement) and never overrides a component's own utility.

## 1. Tokens (all in `app/styles/tailwind.css`)

### Colour

| Token | Value | Use | Status |
| --- | --- | --- | --- |
| `paper` (`bg-paper`, `text-paper`...) | `#f7f4ef` | alternate bands, the cart page background, tinted cards, chips, finder card | NEW |
| `paper-line` | `#e6e2dc` | the warm hairline (card borders, dividers); reach it through `border-line` | NEW |
| `surface-muted` | now `paper` (was `ink-100`) | quiet panels, hover and disabled fills, the footer | CHANGED (role re-pointed) |
| `line` | now `paper-line` (was `ink-200`) | dividers and card borders. Decorative only (1.29:1 on white): a control's edge uses `line-strong` | CHANGED (role re-pointed) |
| `primary-*`, `ink-*`, `accent-*`, `sale-*`, `success-*`, `warning-*`, `error-*`, `focus*`, `line-strong`, `fg*`, `surface`, `surface-inverse` | as before | | UNCHANGED |

Contrast on paper (all asserted in `tests/unit/ui/contrast.test.ts`): ink-900 16.79, ink-700 9.90, ink-600 6.90, ink-500 4.65, **primary-500 4.63 (red text on paper only at 16 px and up; use `primary-700` 7.13 for small red text)**, sale-fg 5.89, success-fg 7.39, control border `ink-400` 3.07 (needs 3.0).

Rules unchanged: a saving amount is never brand red (use `text-sale-fg` or an amber badge). Red or black bands carry `on-dark` (yellow focus ring). Red may fill a promo panel or the brands band (white text on it is 5.08).

### Type

| Token / utility | Value | Status |
| --- | --- | --- |
| Font | Plus Jakarta Sans, self-hosted variable WOFF2 (200 to 800, latin), `font-display: swap`, preloaded once; metric-adjusted Arial fallback. `font-sans` and `font-display` both resolve to it | NEW |
| `type-display` utility | weight 800, tracking -0.03em, line-height 1.05, **sentence case**, `overflow-wrap: anywhere`. Was heavy uppercase. Every existing use restyles by itself | CHANGED |
| `type-eyebrow` utility | 13 px / weight 700 / +0.14em / uppercase / colour `primary-700`. Recolour with a text utility (`text-primary-300` on a dark band; tested). Do not use on the red band | NEW |
| `type-mark` utility | for an inline `<span>` around one heading phrase: red background, white text, 0.16em side padding, 10 px radius, wraps cleanly across lines | NEW |
| `text-display` | 68 px, line-height 1.05 (was 60 px / 1) | CHANGED |
| `text-hero` | 46 px, 1.05: the phone display size | NEW |
| `text-heading` | 40 px, 1.1: h2 on desktop | NEW |
| `text-title` | 22 px, 1.75rem: h3 and card titles | NEW |
| `text-lead` | 17 px, 1.625rem: lead paragraph | NEW |
| `text-caption` | 13 px, 1.25rem: chips and small labels | NEW |
| `text-xs` to `text-5xl` | as before | UNCHANGED |
| bare `h1` to `h3` | weight 800, tracking -0.02em (sizes as before for the not-yet-rebuilt routes) | CHANGED |

Typical display heading: `<h1 className="type-display text-hero md:text-display">Sleep <span className="type-mark">better.</span></h1>`. Section heading: `type-display text-3xl md:text-heading`. Card title: `type-display text-title`.

`type-display` at small sizes (13 to 16 px nav labels, promo bar) has very tight tracking (-0.03em). For small bold labels prefer plain `font-extrabold` (what `displayHeadingClass` already returns for text over 40 characters). `lib/display-type.ts` is unchanged in behaviour (its tests pass); the 40-character rule no longer has a capitals reason, it now only decides between `type-display` and `font-extrabold`.

### Shape, depth, width

| Token | Value | Use | Status |
| --- | --- | --- | --- |
| `rounded-sm` | 8 px | badges, quantity-stepper button hover, tiny controls | NEW (was empty) |
| `rounded-choice` | 12 px (was 8) | buttons, fields, size options, choice cards | CHANGED |
| `rounded-card` | 18 px (was 8) | cards | CHANGED |
| `rounded-panel` | 24 px (was 12) | dialogs, large panels | CHANGED |
| `rounded-hero` | 28 px | the hero photo | NEW |
| `rounded-mark` | 10 px | used by `type-mark`; available for the same highlight | NEW |
| `rounded-pill` | full | chips, count bubble, round icon buttons | UNCHANGED |
| `shadow-lift` | `0 12px 40px -12px` ink at 18% | raised card, finder, cart summary, hovered card | NEW |
| `shadow-sm/md/lg` | as before | | UNCHANGED |
| `shadow-drawer` | deep, as before | drawers and dialogs only | UNCHANGED |
| `max-w-page` | 1400 px (was 1300) | page container | CHANGED |
| `max-w-drawer` | 440 px (was 400) | cart drawer, mobile menu | CHANGED |
| `--aside-width` in `app.css` | 440 px | the legacy cart summary inside the drawer | CHANGED |

Gutters (16 px phone, 40 px desktop) and section spacing (44 / 88 px) are spacing utilities the layout wave applies (`px-4 md:px-10`, `py-11 md:py-22`); there is no token for them.

Sizes you can now use: `h-13` and `min-h-13` (52 px), `size-11.5` (46 px), `min-h-14` (56 px), `min-h-16` (64 px), `min-h-18` (72 px), `h-2.5` (10 px). These are multiples of the 4 px spacing unit, not new tokens.

## 2. Primitives (`~/components/ui/...`)

Common to all interactive ones: default, hover, `focus-visible` (the global 3 px ring, drawn in the base layer), active, disabled; loading where it applies; errors use icon plus text plus border, never colour alone.

### Button (CHANGED, new variants NEW)

`import {Button, buttonStyles} from '~/components/ui/Button';`

Props: `variant`, `size`, `shape`, `fullWidth`, `loading`, `loadingLabel`, `leadingIcon`, `trailingIcon`, `className`, plus either button props, `to` (router link) or `href` (anchor). `buttonStyles({variant, size, shape, fullWidth})` returns the class string for a link that must look like a button.

| Variant | Look | Status |
| --- | --- | --- |
| `primary` (default) | brand red fill | CHANGED look |
| `secondary` | white, red 2 px border, red text | CHANGED look |
| `outline` | white, ink 2 px border, ink text | NEW |
| `dark` | ink fill, white text | NEW |
| `amber` (same as `accent`) | amber fill, ink text | NEW name (`accent` kept) |
| `white` | white fill, ink text: for red or black bands (inside `on-dark`) | NEW |
| `ghost` | transparent, red text, red tint on hover | CHANGED look |
| `link` | red underlined text, no box, still 48 px high | NEW |
| `pill` | primary in the pill shape | UNCHANGED name |
| `inverse`, `inverse-outline` | red-band buttons (white fill red text / white outline) | UNCHANGED |

Sizes: `sm` 44 px, `md` 48 px (default, 16 px text), `lg` 56 px (18 px text; hero, cart, checkout). All have the 12 px radius. **Labels are bold sentence case in every variant** (they were heavy uppercase); `shape="pill"` still gives the pill.

```tsx
<Button size="lg" fullWidth to="/checkout-steps">Checkout securely</Button>
<Button variant="outline" size="lg">View full cart</Button>
<Button variant="white" size="lg">Take the quiz</Button>   {/* inside a red or black band that has className="on-dark" */}
```

### Badge (CHANGED) and Chip (NEW)

`import {Badge} from '~/components/ui/Badge';` `variant`: `sale` (amber, tag icon), `gift` (**now amber**, gift icon; was a red outline), `new` (ink), `neutral` (grey), `success` (NEW: green, check icon). `size`: `label` (small caps, default) or `tag` (sentence case line). 8 px radius, weight 800. Whether to show one is decided from Shopify data by the caller.

`import {Chip} from '~/components/ui/Chip';` `tone`: `neutral` (paper pill), `outline` (white with hairline, for use on paper), `success` (green with a check icon). Optional `icon`. 13 px, weight 600. Static label only; use a Button or link for anything clickable.

```tsx
<Badge variant="gift">Free gift</Badge>
<Chip>Memory foam</Chip> <Chip tone="success">In our delivery zone</Chip>
```

### Card (NEW)

`import {Card, cardStyles} from '~/components/ui/Card';`

Props: `variant` (`flat` default, `raised`, `dashed-amber`, `tinted`), `padding` (`md` default = 16 px phone / 24 px from `md`, `sm` = 16 px, `none`), `as` (`div` default, `section`, `article`, `aside`, `li`), `interactive` (lifts 2 px on hover behind `motion-safe:`, shadow on hover), `className`, and `id`, `role`, `tabIndex`, `aria-label`, `aria-labelledby`, `aria-describedby`; it forwards a `ref` (use it to move focus to a line card after a removal). `cardStyles()` gives the classes for a link that is the whole card.

Looks: `flat` white, 1 px `border-line`, 18 px radius. `raised` adds `shadow-lift`. `dashed-amber` is the free-gift card: 2 px dashed amber border on `accent-50` (the border is decorative; the FREE GIFT badge and text carry the meaning). `tinted` is paper with no border (the protection strip).

```tsx
<Card as="li" variant="raised" aria-labelledby={titleId}>
  <h3 id={titleId} className="type-display text-title">Order summary</h3>
</Card>
<Card variant="dashed-amber"><Badge variant="gift">Free gift</Badge> ...</Card>
```

### Field, Input, Select (CHANGED; `Field` NEW)

`import {Input, CONTROL_CLASSES} from '~/components/ui/Input';` `import {Select} from '~/components/ui/Select';` `import {Field} from '~/components/ui/Field';`

`Input` and `Select` keep their props (`label`, `hint`, `error`, `hideLabel` for Input, `options` and `placeholder` for Select, any native attribute). Look: **52 px high** (`h-13`, `min-h-touch` kept as the floor), 2 px `ink-400` border (turns `ink-600` on hover, `error-solid` when invalid), 12 px radius, 16 px side padding, white fill (so it works on paper). Visible bold label; hint under it; error as icon plus bold text in a polite live region.

`Field` wraps any other control: render prop gets `{id, 'aria-describedby', 'aria-invalid', required}` to spread onto the control, and you give the control `CONTROL_CLASSES`.

```tsx
<Input label="ZIP code" name="zip" error={error} />
<Field label="Delivery date" hint="Weekdays only" required>
  {(control) => <input {...control} type="date" className={CONTROL_CLASSES} />}
</Field>
```

### Checkbox and Radio (CHANGED)

`import {Checkbox} from '~/components/ui/Checkbox';` `import {Radio} from '~/components/ui/Radio';` Same props as before plus `variant`: `plain` (default, a bare 44 px row with the native 24 px control) or `card` (NEW: the row becomes a bordered 12 px-radius choice card; checked turns the border red and the fill `primary-50`; the native control still shows the check). Use `card` for delivery method choices and "Add to compare". Group radios in a `<fieldset><legend>`. (`Radio` has no `aria-invalid`: it is not allowed on the radio role; the error text is described by `aria-describedby`.)

### QuantityStepper (CHANGED look, same API)

`import {QuantityStepper} from '~/components/ui/QuantityStepper';` Props unchanged (`value`, `onChange`, `min`, `max`, `label`, `itemName`, `disabled`). Bordered 2 px group (12 px radius), 46 px buttons, bold value, `aria-label`s and `aria-disabled`-at-limits behaviour kept. The real limit is still the server's.

### Accordion (CHANGED look, same API)

`import {Accordion} from '~/components/ui/Accordion';` Props unchanged (`items`, `type`, `defaultOpenIds`, `headingLevel`, `variant`, `findInPage`, `className`). `default` rows are now 64 px, 18 px bold, with a 24 px ink chevron and hairline dividers (`divide-line`); `menu` rows are 56 px as before. WAI-ARIA button-in-heading behaviour unchanged (the existing tests pass).

### Tabs (CHANGED look, same API)

`import {Tabs} from '~/components/ui/Tabs';` Underline style: 56 px tabs, the selected one has a 4 px brand-red bottom bar, ink text and weight 800; others are muted and show a grey bar on hover. Keyboard and ARIA behaviour unchanged.

### Drawer (CHANGED, new props NEW), Dialog (CHANGED look), IconButton (CHANGED, new props NEW)

`import {Drawer} from '~/components/ui/Drawer';`

New optional props: `countLabel` (a chip beside the title, e.g. `"3 items"`; outside the accessible name), `footer` (pinned under the scrolling body with a hairline above it: subtotal and checkout buttons), `bodyPadding="none"` (edge-to-edge body). Existing props `open`, `onClose`, `title`, `side`, `children`, `closeLabel`, `initialFocusRef` are unchanged. Look: panel up to 440 px wide, `shadow-drawer`, 72 px header with a `type-display` title and a **round 44 px soft close button**. Focus trap, Escape, scroll lock and focus return are unchanged (`Overlay.tsx`).

`IconButton` new props: `variant="soft"` (paper fill) and `shape="round"` (circle). Defaults unchanged. `Dialog` gets the same round close button and a `type-display text-title` title.

```tsx
<Drawer open={open} onClose={close} title="Your cart" countLabel="3 items"
  footer={<><ProgressBar .../><Button fullWidth size="lg">Checkout securely</Button></>}>
  ...lines...
</Drawer>
```

`components/Aside.tsx` (not edited here) wraps `Drawer` and does not forward `countLabel`, `footer` or `bodyPadding` yet: the cart step has to add that passthrough.

### ProgressBar (NEW)

`import {ProgressBar, progressPercent} from '~/components/ui/ProgressBar';`

Props: `value`, `min` (0), `max` (100), `label` (required accessible name), `valueText` (spoken value, e.g. "$300 away from free delivery"), `tone` (`red` while open, `success` once reached), `className`. Renders `role="progressbar"` with `aria-valuenow` (clamped into range), `aria-valuemin`, `aria-valuemax`; a 10 px pill track on `ink-100` with a fill whose width transition is `motion-safe:` only. It draws numbers it is given; the caller derives them from server data (`FreeDeliveryProgress` already does). Put the readable sentence beside the bar: colour is not the only cue.

```tsx
<ProgressBar value={percent} label="Progress to free delivery" valueText={sentence} tone={reached ? 'success' : 'red'} />
```

### Price, SizeSelector, Rating, Breadcrumb, Skeleton, Toast, Overlay, Action (UNCHANGED code)

They restyle only through the tokens (radius, hairline, font). `Price` still formats what Shopify returned and computes only integer savings from two Shopify prices; nothing was added that computes money in the browser. `SizeSelector` options now have the 12 px radius.

## 3. What the next wave must know

- Everything outside `components/ui/` still uses the old class names and now renders with the new tokens: wider page (1400), rounder cards, warm hairlines and paper surfaces, Plus Jakarta Sans, sentence-case `type-display`. Anything that relied on capitals (`uppercase` classes you add yourself) is untouched.
- `bg-surface-muted` is paper now, so `bg-surface-muted` next to `bg-paper` is the same colour. Prefer `bg-paper` for new bands so the intent is readable.
- Do not put a `bg-paper` chip on paper (`Chip tone="neutral"` vanishes); use `tone="outline"`.
- Test contracts changed on purpose (look only): Button no longer has `type-display` or uppercase and uses `font-bold`; `Badge variant="gift"` is amber; the gallery's primary-button assertions are now bold, sentence case, 12 px radius and 48 px high. Updated in `tests/unit/ui/brandPrimitives.test.tsx` and `tests/e2e/gallery.spec.ts`. No behaviour or accessibility assertion was loosened.
- `tests/unit/signup/SignupForm.test.tsx` checks the field's `min-h-touch` class, which is why `CONTROL_CLASSES` is `h-13 min-h-touch` and not `min-h-13`.
