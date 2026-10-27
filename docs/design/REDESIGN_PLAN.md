# Storefront redesign plan (layout, type, colour, cart)

Status: **proposed 2026-10-27, not approved**. Requested by the owner; needs the owner's go-ahead and then the client's written approval (change request CR-31 in [BACKLOG](../../plans/BACKLOG.md); static design work is CR-01 / EXC-09). Nothing in `storefront/` has been changed for this plan.

Preview (clickable cart, home, mobile, style guide): <https://claude.ai/artifact/3Hx5jbtnEtfQAP2kXbK536> (private; share from its Share menu). Image prompts: [IMAGE_PROMPTS](IMAGE_PROMPTS.md).

## 1. What stays and what changes

- **Functionality does not change.** Every cart, offer, delivery, protection, quiz, compare, store and account behaviour keeps its code, its requirement IDs and its tests. The redesign is the look, the layout of the pages and some new content blocks.
- **Hard constraints, unchanged:** tokens only, no hard-coded hex in components ([ui-implementation](../../.claude/rules/ui-implementation.md)); mobile first at 360 px; 44 px touch targets; WCAG 2.2 AA as the working standard; Shopify hosted checkout; content from Shopify admin where supported; US English, USD.
- **No copying (NFR-007).** The reference site was studied for structure and feel only. Our text, images, icons, colours and code are our own. Provenance of every new asset goes in [BRAND_TOKENS](BRAND_TOKENS.md) (Provenance table).

## 2. Research: the reference site (tiro.insanedev.in), 2026-10-27

Read with a browser at 1440 px and from its computed styles. Observations, in our words:

| Area | What it does | What we take | What we leave |
| --- | --- | --- | --- |
| Overall feel | Big, heavy, friendly type; lots of white; one accent colour doing most of the work; chunky rounded cards; photography first | The confidence and the whitespace | Its colours (black, yellow, green) and its tyre content |
| Type | One geometric sans (Montserrat), headlines weight 800 with tight tracking (-1 px at 56 px), body 16/400 | One heavy geometric sans for everything, 800 headlines | Montserrat itself (we propose our own pairing, section 3) |
| Header | Thin dark utility bar; white main row with a location chip, one bold search button, phone, account, cart; second row of mega-menu links | Same two-row structure, our delivery-ZIP chip in the same place | A WhatsApp button (we have chat and phone) |
| Hero | Headline with one highlighted phrase; tabbed search card (by size / by vehicle) beside a large rounded photo | Highlighted headline phrase; finder card with tabs; large rounded photo with two floating cards | Vehicle search (ours is size, feel, brand and the quiz) |
| Sections in order | Trust strip, four "why" cards, category band on black, offers (three coloured cards), brands, image band, how it works, services, newsletter, coverage check, dark footer | The rhythm: light, dark, colour, light; offers as three solid-colour cards; a full-width brands band; how it works; a coverage (ZIP) check | Services grid (not our business), fleet pages |
| Buttons and cards | 8 to 10 px radius, bold labels, soft shadow on raised cards, 1 px grey borders | Slightly rounder (10 to 12 px buttons, 18 px cards) | |
| Cart | Own page, narrow centred card, large illustration for the empty state. The cart was empty, so the filled layout was **not observed** | The empty-state idea (illustration + one clear button) | Everything else is designed from our own cart (section 5) |
| Motion | 150 to 400 ms ease-out, no autoplay | Same, behind `motion-safe:` as today | |

## 3. Design direction

**One line:** bold, warm, easy to trust. Heavy rounded headlines, one red highlight in the hero, big friendly cards, red only for the brand and the main action.

### Colour

Tokens live in `storefront/app/styles/tailwind.css`. The red and the greys already exist; the redesign adds one warm neutral and re-roles a few.

| Role | Value | Token (today / proposed) | Contrast | Used for |
| --- | --- | --- | --- | --- |
| Brand red | `#DE0510` | `primary-500` (exists, from the logo) | white on it 5.08 | primary button, hero highlight, cart count, brands band, one offer panel |
| Red deep | `#A8030C` | `primary-700` (exists) | 7.83 on white | links, hover, text-sized red |
| Ink | `#141414` | `ink-900` (exists) | 18.42 on white | text, dark bands, footer |
| Warm paper | `#F7F4EF` | **new** `paper` (replaces the cool `ink-50` use for bands) | ink on it 16.79, muted 6.90, red text 4.63 | alternate section bands, finder card background, cart page background |
| Line | `#E6E2DC` | **new** `line` (today `ink-200`) | 1.29 (decorative border only) | card borders, dividers |
| Muted text | `#545454` | `ink-600` (exists) | 7.57 on white | secondary text |
| Control border | `#8C8C8C` | `ink-400` (exists) | 3.36 on white (needs 3.0) | inputs, qty stepper |
| Amber | `#F6B414` | `accent-400` (exists) | ink on it 10.05 | Sale pill, FREE GIFT badge, amber offer panel |
| Sale text | `#A14000` | `sale-fg` (exists) | 6.46 on white | savings amounts |
| Success | `#1B7A43` | `success-solid` (exists) | white on it 5.37 | free delivery reached, "in our delivery zone" |

Rules: a **saving amount is never brand red** (unchanged from today). **New:** red may fill a whole promo panel or the brands band because the white text on it passes; red text on warm paper is 4.63 and stays at 16 px and above. Every pair above is recomputed by `tests/unit/ui/contrast.test.ts` once the tokens change (add the `paper` pairs to that test).

### Type

- **Plus Jakarta Sans**, one variable font, weights 400 to 800, self-hosted WOFF2 under `public/fonts/` (SIL Open Font License; record it in the Provenance table). It is a geometric sans in the same family of feel as the reference but not the same typeface. `font-display: swap`, preload the 800 and 400 faces only. No third-party font request (security rule).
- This **replaces the open question in CR-15** (Archivo Black or Barlow Condensed): the owner chooses; the client still approves, and a font the client supplies wins.
- Scale (px, mobile / desktop): display 46 / 68 at 800 and -3 %; h2 30 / 40 at 800 and -2 %; h3 20 / 22 at 800; body 16 / 17; small 14. The `type-display` uppercase utility is retired for headings (sentence case is friendlier and avoids the 40-character rule), kept only for tiny labels (eyebrows).
- The hero highlight is a `mark` style: red background, white text, 10 px radius, wraps cleanly across lines.

### Shape, depth, space

Radii 8 (small controls), 12 (buttons, fields), 18 (cards), 28 (hero image); pills only for chips and round icon buttons. Depth: 1 px border for cards, a soft lift for the finder and the cart summary, a deep shadow only for drawers and dialogs. Spacing 8 / 16 / 24 / 32 / 48 / 64. Page width **1400 px** (today 1300) with a 40 px gutter (16 px on phones); sections 88 px apart on desktop, 44 px on phones.

### Imagery and icons

Warm, natural-light bedroom photography with one red accent object in some shots, so the red feels intentional. Photos are generated from the prompts in [IMAGE_PROMPTS](IMAGE_PROMPTS.md); product photos stay Shopify's. Icons stay project-drawn, 22 px, 2 px rounded stroke.

## 4. Page by page

| Page | Change | Existing pieces touched | New content from admin |
| --- | --- | --- | --- |
| **Header** | Two-row header as in the preview: dark utility bar (delivery promise, find a store, track order, phone), main row (logo 64 px, delivery-ZIP chip, wide search, account, cart with red count), nav row with mega-menu links and a red "Take the sleep quiz" button | `UtilityBar`, `TopStrip`, `SiteHeader`, `MainNav`, `MobileNav`, `DeliveryZipControl`, `HeaderSearch`, `BrandLogo` | none |
| **Sticky header** | Decision D3: keep scrolling away (today, CR-16) or make the compact header sticky. Not in the preview | `SiteHeader` | |
| **Footer** | Dark footer with logo, one-line blurb, three link groups, privacy choices; phone and hours from admin | `SiteFooter` | none |
| **Home** | Section order in section 4.1 | `HomeSections`, `CatalogSections`, `BannerSection`, `ReassuranceStrip`, `PromoBar` | new block types, 4.1 |
| **Collection / search** | Card grid with the new product card (badge, brand, name, type chip, From price, Compare checkbox); filter panel as a drawer on phones and a left column on desktop; same filters and URL state | `ProductTile`, `ProductListing`, `FilterPanel`, `SearchResults` | none |
| **Product page** | Larger gallery with thumbnails, buy box with size chips, delivery choice cards (home, pickup, try in store), protection and add-on offers as cards, sticky add-to-cart bar on phones | `ProductBuyBox`, `ProductGallery`, `ProductAddOns`, `ProductSections`, `PickupAvailability` | none |
| **Brand page** | Hero with the brand's name and an image, its mattresses grid, and the "about" text | `routes/brands.$handle.tsx` | brand `hero_image` field (4.2) |
| **Cart page, drawer, empty cart** | Section 5 | `CartMain`, `CartLineItem`, `CartSummary`, `CartOffers`, ... | empty-cart illustration |
| **Quiz, compare, stores, account, content pages** | Restyle through tokens and the new primitives only; layouts stay | | |

### 4.1 Home sections (top to bottom, as in the preview)

1. Hero: highlighted headline, short line, finder card (size chips, feel, brand, quiz tab), large photo with two floating cards (free delivery, try in store). *Existing `hero` banner; the finder card is new.*
2. Trust strip, four items. *Existing `ReassuranceStrip` / `HOME_ASSURANCE_ITEMS`; items still shown only when their content exists (B-15).*
3. **Brands showcase** (new look, section 4.2): full-width red band, 12 brand tiles, "See all brands" and "Compare mattresses". *Existing `brands` catalog block.*
4. Shop by size: six bed-size tiles drawn in the page (no photos). *Existing `shop-by-size`.*
5. Best sellers: eight product cards. *Existing `featured`.*
6. Shop by feel and type: dark band, six tiles with the cut-away images. *Existing `categories` block, restyled.*
7. Latest offers: three solid-colour cards (gift, bundle, delivery). *Existing `promo-banner`, up to three in a row; today one per block.*
8. Sleep quiz band with a photo. *New block type `quiz-band`.*
9. Complete your sleep setup: protection, bases, bedding cards. *New block type `setup-cards`.*
10. How it works, three steps with a photo. *New block type `how-it-works`.*
11. Find a store: ZIP field, two nearest stores, a map picture. *New block type `store-finder` (uses the existing store data and ZIP logic).*
12. FAQ accordion. *New block type `faq` (the project already has FAQ entries).*
13. Email signup band. *Existing `signup` block.*

New block types need an entry in `scripts/shopify/definitions.json` and `app/lib/shopify/home-sections.ts` (the unit test that compares them with `schema.mjs` must stay green), then the client can order and edit them in admin like the existing ones.

### 4.2 Brands showcase

- A band of 12 tiles (Tempur-Pedic, Stearns & Foster, Sealy, Molecule, Serta, Brooklyn Bedding, Helix, Puffy, Beautyrest, Aireloom, Kingsdown, Casper) from the brand entries, linking to their brand pages.
- **Logos need permission.** Until each brand supplies its logo file and allows its use, the tiles show the brand name as styled text, as in the preview. Do not generate or redraw logos with Gemini. Ask each brand's dealer portal for a brand kit.
- Brand page hero: one reusable lifestyle image (IMG-14) plus the brand's own image once supplied.

## 5. Cart redesign

Reference for the layout: the **Cart** and **Mini cart drawer** boards in the preview (the desktop cart is interactive: change size and watch the price move, change quantity, remove, add or remove the protection plan, add an offer, tick haul-away, apply `SLEEP50`, remove the mattress and watch the gift and protection go).

### Layout

- **Desktop page:** two columns, lines on the left, a **sticky order summary** (440 px) on the right. The page background is warm paper so the white cards stand out. A small "1 Cart, 2 Secure checkout (Shopify)" step marker tells shoppers what comes next.
- **Left column, top to bottom:** notices (repairs and refusals, as today), free-delivery progress card, the line cards, delivery card, "Complete your sleep setup" offers.
- **Line card:** photo, brand, name, size select with dimensions, delivery chip, quantity stepper, Remove, line total with the per-unit price below. The **protection plan sits inside the card it covers**, on a tinted strip: "Protect this mattress / Add protection" or "Protection plan added, covers this mattress only / Remove". It cannot exist alone, as today. The **free gift** is its own dashed amber card with a FREE GIFT badge and a struck-through value.
- **Summary card:** subtotal, haul-away, discount code line (amber, with Remove), delivery (Free, or "Calculated at checkout"), estimated total at 34 px, "Tax is calculated at checkout", discount code field, a **financing message slot** (shown only when the provider is connected, SD-11), a full-width red "Checkout securely" button, a one-line note that payment happens on Shopify. Three reassurance lines under it.
- **Mobile (360 to 767 px):** one column of the same cards; add-on offers become a horizontal scroll; the summary follows the offers; a **sticky bottom bar** keeps the total and the checkout button in reach; the discount code collapses under "Add a discount code".
- **Drawer:** same cards in compact form (84 px photo), progress strip on top, subtotal and two buttons ("Checkout securely", "View full cart") fixed at the bottom.
- **Empty cart:** illustration (IMG-19), one line, two buttons (continue shopping, take the quiz).

### Where today's behaviour lives in the new layout

| Behaviour (requirement) | Component today | Place in the new layout |
| --- | --- | --- |
| Lines, quantity, size change, remove (REQ-CART-001) | `CartLineItem`, `CartActionForm`, `CartSizeSelect` | line card, size select inside it |
| Protection linked to its item (REQ-EXT-002, REQ-PRE-004) | `CartLineItem` children, `CartOffers` | protection strip inside the line card |
| Free gift line, removed with its mattress (REQ-CART-002, REQ-PROMO-001) | `CartOffers`, `cart-results` | gift card under the lines |
| Bundle savings (REQ-PROMO-002) | Shopify discounts shown on the lines | discount shown on the bundle lines and in the summary |
| Matching protector, pillow and bedding offers (REQ-CART-003) | `CartOffers` | "Complete your sleep setup" cards |
| Delivery ZIP, delivery type, haul-away limits (REQ-DEL-001, REQ-PRE-003) | `DeliveryCheck` | delivery card |
| Free-delivery progress (REQ-CART-004) | `FreeDeliveryProgress` | progress card on top, drawer strip |
| Discount code entry | `CartDiscount` | summary card |
| Financing message (REQ-CART-005) | `FinancingMessage`, `AffirmPromo` | summary card slot |
| Notices, repaired lines, blocked checkout (REQ-PRE-006, ADR-0006) | `CartMessages`, `blocked` prop | notice bar on top; the checkout button shows its paused state |
| Checkout hand-off (ADR-0003) | `CartSummary`, `checkout-steps` route | red button; still revalidated on the server |

Server rules do not move: prices come from Shopify, every mutation goes through `routes/cart.tsx`, eligibility is rechecked before checkout.

### Cart acceptance

Every row of the table above works exactly as before (existing cart unit and e2e specs updated for new markup, not for new behaviour); focus lands on the line region after a removal; the progress bar has a `progressbar` role with a value; the total and checkout button stay visible on phones; no horizontal scroll at 360 px; quantity and remove targets are 44 px.

## 6. Implementation plan

Branch per step as `feat/redesign-<step>`. Each step ends with lint, typecheck, unit tests and one look in a browser at 360 and 1440 px (the owner's light-QA preference); no separate QA rounds. Effort is S (under a day), M (a day or two), L (several days).

| Step | What | Main files | Effort | Done when |
| --- | --- | --- | --- | --- |
| R0 | Decisions D1 to D7 below; client sees the preview; images generated and approved; logo as a transparent PNG or SVG | this plan, [DECISIONS](../../progress/DECISIONS.md) | S | owner approval recorded |
| R1 | **Tokens and font:** add `paper`, `line`; width 1400; radii; Plus Jakarta Sans WOFF2 and `@font-face`; heading styles; update contrast test; update BRAND_TOKENS | `app/styles/tailwind.css`, `public/fonts/`, `tests/unit/ui/contrast.test.ts`, `docs/design/BRAND_TOKENS.md` | M | contrast test green, no hex outside the stylesheet |
| R2 | **Primitives:** Button sizes and variants, Badge, Chip, Field and Input, Select, QuantityStepper, Accordion, Drawer, Tabs, Card, "mark" heading | `app/components/ui/*`, the `_dev.components` gallery | M | gallery shows every state; axe clean |
| R3 | **Shell:** utility bar, header rows, nav and mobile nav, ZIP chip, footer, promo bar, reassurance strip | `components/layout/*` | M | header and footer on all routes |
| R4 | **Cart:** page, drawer, empty state, line card with protection strip, gift card, summary, sticky mobile bar, progress, delivery card | `components/CartMain.tsx`, `CartLineItem.tsx`, `CartSummary.tsx`, `components/cart/*`, `routes/cart.tsx`, `Aside.tsx` | L | table in section 5 verified by hand and by the updated cart specs |
| R5 | **Home and brands:** hero with finder card, sections 4.1, new block types, brand tiles and brand page hero | `components/home/*`, `lib/shopify/home-sections.ts`, `scripts/shopify/definitions.json`, `routes/_index.tsx`, `routes/brands.$handle.tsx` | L | home renders from admin blocks; definition drift test green |
| R6 | **Catalog:** product card, listing, filters, product page, compare | `components/pages/ProductTile.tsx`, `collection/*`, `product/*`, `compare/*` | L | |
| R7 | **Rest and wrap-up:** quiz, stores, account, content pages, 404; page weight check; record in STATUS, DEVIATIONS and BRAND_TOKENS | remaining routes, `docs/` | M | owner walkthrough |

Order matters: R1 and R2 first (everything depends on them), then R3, then R4 (the cart is the owner's priority) and R5 can run in either order.

## 7. Decisions needed from the owner

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | Typeface | Plus Jakarta Sans (open licence, one file). Replaces CR-15's candidates |
| D2 | Red promo panels and the red brands band, with savings text staying amber and orange | Accept |
| D3 | Sticky compact header while scrolling (CR-16) | Yes on phones only (the cart and search stay in reach), after a keyboard test that focus is never hidden |
| D4 | Brand logos | Text names now; ask each brand for its logo file and written permission |
| D5 | New home block types (quiz band, setup cards, how it works, store finder, FAQ) | Build all five; each hides itself when empty |
| D6 | Hero finder tabs: size, feel, quiz (brand as a select) | As in the preview |
| D7 | Treat the redesign as change request CR-31 and send it to the client with the preview | Yes; nothing in the signed scope names a visual direction beyond "like the reference in the client's brand" (Q-004) |

## 8. Risks

- **Page weight.** A custom font and many photos cost LCP. Mitigation: one variable WOFF2 subset, preload two faces, Shopify image sizes and `srcset`, hero image in WebP at or under 250 KB, no autoplay. Measure with the existing performance script before and after R1 and R5.
- **Red text on paper is 4.63 : 1**, close to the 4.5 line. Mitigation: red text only at 16 px and up on paper; red deep for small text.
- **Admin content.** New home blocks are only useful if the client fills them. Each block hides itself when empty, so an unfilled site still looks complete.
- **Images are generated.** Confirm the commercial-use terms of the Gemini plan, keep the prompt IDs in the Provenance table, and expect an invisible AI watermark.
- **Copy.** Descriptions in the preview are placeholders; real wording (guarantee, delivery promise, protection plan) comes from the client (CLR-016) and the provider, never invented.
- **Scope.** Without client approval of CR-31 this is not billable scope and must not be described as delivered.

## 9. What the preview shows and does not

Shows: the look and layout of the home page (desktop, phone), the cart (desktop, interactive; phone; drawer) and the style guide, using the client's real logo, real catalog names and list prices from the new brand sheet. Does not show: product, collection, quiz, compare, store and account pages (restyle by the same system), real photos (labelled placeholders `IMG-xx` match the prompt IDs), real reviews (none are shown until real ones exist), or real offers (sample text).
