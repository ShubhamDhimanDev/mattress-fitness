# Reference-site pattern notes (layout and features only)

Task P0-08. The SOW says the shopping experience "follows the patterns" of the reference site for layout and features only, and that **no text, images, logos or trademarks are reused** (SOW §1, NFR-007). These notes are our own description of structure and behaviour, taken from the text of three pages (home, a collection, a product) on 2026-10-11. They contain no marketing copy, no brand or product names, and no markup or styles. Do not paste anything from the reference site into the codebase or content; the client's brand, copy and manufacturer-supplied assets are used throughout.

## Header and global elements

- A slim strip above the header carries a cross-link to the retailer's sister brand (not needed for us).
- Delivery ZIP entry and a "my store" selector sit in the header on the reference site (observation). Ours has the ZIP entry only (REQ-NAV-003); the my-store selector (REQ-LOC-003) was descoped 2026-10-28, DEC-141.
- Utility links: order tracking, contact, chat, phone number (REQ-ACC-003, REQ-ANL-004).
- Search, account and cart sit on the main row; the cart icon is not visible in page text, so confirm placement visually before copying a pattern (we decide ours).
- Main navigation groups: sale, mattresses, foundations and adjustable bases, beds and furniture, bedding, clearance, a guide section, plus a link to the sleep finder (REQ-NAV-002 follows the SOW list).
- Three reassurance strips under the header (free in-home delivery and setup, a comfort guarantee, a price guarantee) repeated on every page type. Our equivalent is the promotional bar plus guarantee content from Shopify admin (REQ-NAV-001, REQ-CNT-001).

## Homepage section order (pattern, 13 blocks)

Reassurance strips; sale hero with two calls to action (shop, find a store); shop by size tiles (six sizes); brand tiles; financing callout; quiz or finder explainer with a store call to action; more brand tiles; in-store-only deal and clearance tiles; category tiles; a partner-brand feature block; support tiles (chat, store finder); text-message signup with consent language; social links. Maps to REQ-HOME-001, with every block editable and reorderable in Shopify admin.

## Collection page

- Title only (no breadcrumb and no intro text in the page text): we add a breadcrumb and a short intro (REQ-SEO-001).
- A "Sort and Filter" panel with these groups: size (including split variants), brand (about 25), product type, comfort level, mattress type, benefits, sleep position, and product line. This matches REQ-COL-002. A price filter was not evident in the text; the SOW requires one.
- Product card: image, a promo badge (free gift or savings amount), brand and name as a link, review count, a "From" price with the original price struck through on sale. No visible add to cart or compare checkbox on the card (our comparison entry point is a design choice, REQ-CMP-001).
- Promotional tiles sit inside the grid (finder, financing, guarantee): REQ-COL-003.
- "Load more" button instead of page numbers: REQ-COL-001.
- A short FAQ block at the bottom (four questions about the size): REQ-COL-004.
- Entry point to the finder (quiz) as an in-grid banner and a footer link: REQ-QZ-007.

## Product page (section order observed)

1. Header and reassurance strips.
2. Title block with rating or "be the first to review" and a free-gift tag.
3. Image gallery as a slideshow with a counter (main, lifestyle, cutaway, detail shots).
4. Price.
5. Size selector with dimensions that match the chosen size.
6. Add to cart, then **three fulfilment choices**: home delivery by ZIP, in-store pickup by store, and try in store with a nearby-stores link (REQ-DEL-002, REQ-PDP-003, REQ-PDP-004).
7. Guarantee badges repeated.
8. "You might also need" cards: foundations, adjustable base, frames, each with price and add to cart (REQ-ADD-001).
9. "Frequently bought with" bundle with an add-all button (REQ-ADD-002).
10. Overview, then feature list; then specification block (comfort level, sleep positions, height, type, feature tags).
11. Collapsed sections: about the brand, delivery and shipping, warranty (REQ-PDP-002).
12. A comparison table against a similar product by price, comfort, type, height and benefits (REQ-CMP-001).
13. Reviews with a write-a-review link (REQ-PDP-005).
14. Text-message signup, then the footer.

Not observed on the product page (SOW requires them, so we design them): financing messaging, FAQs, accident protection, delivery promise text, and any sticky mobile add-to-cart bar.

## Visual structure (screenshot study, 2026-10-12; own words, nothing stored in the repo)

Headless Chrome screenshots of the home, a collection and a product page at desktop (1440 px) and mobile (390 px) were viewed privately for structure only. They are kept in the session scratchpad, not in the repository, and no colour, copy, image or markup is carried over.

**Header stack, desktop (top to bottom):** a slim strip with a link to a sister brand (we have none); a grey utility bar with two icon links on the left (enter delivery ZIP, select store) and small text links on the right (track order, contact, chat, phone number); the main row with the logo on the left, a wide search field with a magnifier button, and three icon buttons (store locator, account, cart) on the right; a centred navigation row where most items open a dropdown (chevron) and a few are plain links (sale, clearance), with the finder link at the end; then a three-item reassurance strip (icon plus short uppercase line) spaced evenly across the page.

**Header stack, mobile:** the same strips stacked and compressed: the grey bar keeps the two links, the logo row keeps the finder link, a control row holds a hamburger button, a search field and the account and cart icons, and the reassurance strip becomes three compact columns with smaller text.

**Home:** the hero is a container-width banner (about 1,300 px) with a headline, a large number or offer, and two pill-shaped calls to action; "shop by size" is a centred heading above a grid of wide pill buttons (three per row on desktop, two on mobile) with six sizes; brand tiles follow as image tiles. A cookie-consent card appears bottom-left and a third-party rating badge floats bottom-left; we build our own consent banner (NFR-011) and no floating badge.

**Collection:** title, a filter and sort entry (a panel, not a sidebar on narrow widths), a product grid of cards, a "load more" button, FAQs at the bottom.

**Product page, desktop:** two columns. Left: the image gallery with arrows and a slide counter. Right (the buy box, top to bottom): star rating and review count, the product name, an outlined "free gift" tag under the name, the price, a size label that shows the **dimensions of the selected size**, size options as bordered rectangular buttons in three columns with the selected size filled in the accent colour, and a full-width primary "Add to cart" button; then the three fulfilment options (home delivery by ZIP, store pickup, try in store).

**Visual language to reproduce as structure, not as brand:** heavy use of bold uppercase for strips and buttons; high-contrast accent colour on white; pill buttons for navigation-level calls to action and rectangular buttons for choices; generous tap targets; a restrained, single sans-serif typeface.

**Our tokens (updated 2026-10-22):** the brand red `#DE0510` and white are taken from the client's own logo supplied that day; the greys, amber accent, sale and status colours are still placeholders until the brand kit arrives (CLR-013). One sans-serif system font stack (heavy uppercase display utility for short labels), 8 px spacing scale, 44 px minimum targets. No colour is sampled from or matched to the reference site (NFR-007); the similarity of hue comes from the client's logo. Swapping in the rest of the client's palette and fonts remains a one-file token change. Values: [BRAND_TOKENS](BRAND_TOKENS.md). (This paragraph previously described a teal placeholder palette.)

## Observation pass of 2026-10-22 (live pages, observer only)

Method and limits. The home, one size-collection page, one product page, the empty cart page and the footer were opened in an isolated headless Chromium context at 1440 x 900 and 390 x 844 on 2026-10-22, viewed as screenshots (kept in the session scratchpad, never in the repository) and measured with read-only page queries (box sizes, computed radius, grid tracks, fixed or sticky elements). Nothing was submitted, added to a cart or signed in. An email-offer modal, a cookie card, a third-party rating badge, a recaptcha badge and a chat launcher appear on first load; they were hidden with a style rule inside the private context so the page itself could be seen. This is **our own description of patterns**: no wording, brand or product names, images, markup or styles are recorded, and the reference's exact colours are not recorded (only "red accent", "grey", and so on). Anything not seen is listed at the end of this section. This pass **corrects** the earlier notes where marked "(correction)".

### Generic UI labels (NFR-007 sign-off needed)

Three short labels in our build also appear on the reference site: **"Shop by size"** (home size block heading and a footer group), **"Continue shopping"** (empty cart and delivery page buttons), and **"N Reviews"** (product-card rating count); "Shop now" (promo tile button) appears there as well. They are standard storefront vocabulary with no brand or distinctive phrasing (how each came into our code was not traced). They are flagged here so the owner can **consciously sign them off or ask for rewording** (NFR-007: no text from the reference). No longer passage, headline, offer line or brand name is reused.

### Global structure (both widths)

- **Header stack, desktop 1440 (heights measured):** slim brand-switch strip 48 px (two text links, current one underlined); grey utility bar about 50 px (delivery ZIP and store links with icons on the left, order tracking, contact, chat and phone as plain text on the right, no icons except the first two); main row about 78 px (logo left at about 150 x 50, a search field about 385 px wide and 34 px tall with the magnifier inside its right edge, then three solid black icons: store pin, account, cart, no captions); navigation row about 56 px with centred items, a chevron on items that open a panel and none on plain links, and a finder link at the right end that is a logo-style image rather than text; reassurance strip about 47 px with three evenly spread items (large line icon plus bold uppercase text), each a link. Total about 263 px. The page content container is about 1240 px inside a 1440 viewport (page gutter about 96 px each side at 1440).
- **Header on scroll (desktop and mobile):** the header becomes fixed and **compact**: the strips above and below disappear, leaving only the logo, search, icons and (desktop) the navigation row, 133 px on desktop and 64 px on mobile. (not an accessibility judgement; see UXD-12.)
- **Header, mobile 390:** brand-switch strip, utility bar with two shortened links (ZIP, store), a logo row with the logo left and the finder logo right, a control row with a bordered square hamburger button, a search field with the magnifier at its right inside edge, then account and cart icons; a three-column compact reassurance strip (small icon above two short lines). The phone number, tracking, contact and chat links are not in the mobile bar.
- **Mega menu:** the panels exist in the page as link lists (a "view all" link, then groups: size (six), brand (about 25 in columns), comfort level (five), type (five), price bands (five)). The same group names are repeated in the footer. How a panel opens (hover or click), its width and its visual style were **not observed** (see the end of this section).
- **Floating elements:** a chat launcher (round, bottom right) and a rating badge (bottom left) float on every page; no sticky add-to-cart bar exists on the product page at either width (fixed or sticky elements measured: the compact header and the chat launcher only).
- **Type feel:** one humanist sans-serif throughout; body 16 px; page titles 30 px bold in sentence case; section headings on the home are uppercase, red and about 28 to 32 px; the home hero headline is very large (over 100 px) and heavy; strip text and button labels are bold; the Add to cart label is sentence case at about 20 px, 700 weight; home buttons are uppercase.
- **Shape and depth:** cards have a hairline border (about 0.8 px, mid grey) and an 8 px radius with **no shadow**; the Add to cart button and the product-card tag use 8 px; size choice buttons use 6 px; the search field is a small-radius rectangle (not a pill). **(correction)** the earlier notes call the home hero buttons and the shop-by-size buttons "pill-shaped"; at 1440 they are **rounded rectangles** (roughly 8 to 10 px radius), not full pills.
- **Density and rhythm:** medium to high. Sections are separated by roughly 40 to 60 px; promotional blocks go edge to edge of the 1240 px container with little padding; grid gaps are 24 px on desktop.

### Home (section order as observed, 1440 and 390)

1. Reassurance strip. 2. Hero banner, container width, about 280 px tall at desktop: an illustrated seasonal background, a giant offer headline, a short subline, two red rounded-rectangle buttons side by side (shop, find a store). 3. "Shop by size": a centred red uppercase heading and six equal red buttons, **three per row at desktop (each about 180 x 50 px), two per row on mobile**. 4. Three large image tiles for featured brands (brand logo as image, a shop button, a small free-gift line at the bottom); on mobile they stack one per row, full width. 5. Four yellow "up to N percent off" brand tiles in a row (two by two on mobile). 6. A financing banner (card image, big "0 percent" statement, a learn-more button). 7. A finder (quiz) block: a red band holding a white card with a heading, one line, a store button, three small trust lines and a four-step "how it works" row. 8. Three feature tiles (product image, offer text, shop button). 9. A large yellow in-store-only offer block with centred text and a button. 10. A black in-store clearance block with a button. 11. Six category image tiles (three by two), each with its label centred on the image over a dark overlay. 12. A pink partner-campaign banner. 13. Email signup and text-message signup (see Footer), then the footer.

### Collection page (a size collection, 345 products, 1440 and 390)

- Title 30 px bold, sentence case, with a full-width hairline rule under it; no breadcrumb and no intro text above the grid.
- **Desktop:** two columns. Left: a filter sidebar about 290 px wide headed "Filters"; each group (size, brand, product type, comfort level, mattress type, benefits, sleep position, collection) is a heading about 20 px with a chevron at the right, a hairline rule between groups, and a list of rounded-square checkboxes with plain labels (no counts were visible); the size group lists twelve options including split variants. Right: a count line ("N products found", bold) at the left and a "Sort by" label with a bordered select at the right, then the grid. **Three cards per row at 1440** (each about 299 px wide, 24 px gaps).
- **Card anatomy, top to bottom:** hairline border and 8 px radius with about 12 px inner padding; image inset in the padding (not edge to edge, almost square); an **outlined rectangular tag under the image** in the red accent (gift or savings wording; it is not over the image); product name bold, up to three lines; a star row (dark filled stars on a light track, partial star allowed) followed by "N Reviews" text; a price line with a small "From" label and a bold price, about 20 px; on sale the original price is struck through (small, grey) before the bold sale price which is drawn in the red accent. No add-to-cart button and no compare control on the card. Cards in a row stretch to equal height.
- **Promo tiles inside the grid:** two seen, each one column wide and two rows tall: a red finder (quiz) tile with a large heading, a product image and a white button, and a grey financing tile with a card image, a big statement and a red button. They sit at the third position of row one and the middle of row three (positions vary by page).
- **Mobile (390):** one column. The card turns **horizontal**: image about 160 px wide on the left, the tag, name, rating and price stacked on the right; titles wrap to four lines. Above the list: a full-width outlined "Sort and Filter" button and the count. The button opens a full-height panel (not a bottom sheet): a "Sort" heading with a round close button, a select with its own red Apply button, then "Filters" with a red Apply button and the same collapsible groups with checkboxes. The panel applies on a button press, not on each tick.
- Below the grid: a "Load more" button, a short FAQ block, then the footer (the end of the grid was not scrolled to in this pass; see not observed).

### Product page (one queen-size hybrid mattress, 1440 and 390)

- **Desktop, two equal columns** with a gap of about 40 px inside the 1240 px container. Left: the gallery, a near-square image with round white arrow buttons on its left and right edges and a row of dots under it; no thumbnails. Right, top to bottom: star row and "N Reviews"; title 30 px bold; an outlined tag; price about 22 px bold; a small financing line to the right of the price (a provider widget); a small "Size: dimensions of the selected size" line; **size options in a three-column grid**, each about 60 px tall with 6 px radius and a hairline border, labels may wrap to two lines, the selected one **filled with the red accent and white text**; a full-width Add to cart button about 54 px tall; a **light grey panel holding three white tiles** (delivery with an "enter ZIP" link, pick up in store with a "select store" link, try before you buy with a "see nearby stores" link); two collapsed rows for the guarantees (title and chevron, hairline separators).
- Below the two columns: "You might also need" as a **horizontally scrolling row** of small product cards (image, name, rating, price, an Add to cart button each); "Frequently bought with" as a similar row with a checkbox on each card, then a total price and an "Add all to cart" button at the right; then a two-column block: **left, a specification block as a 2 x 2 grid of bordered tiles** (small uppercase label, large centred value) followed by a feature bullet list; **right, the overview** as a long text column with a bold lead-in on each paragraph; then three collapsed rows (about the brand, delivery and shipping, warranty); a comparison table section; customer reviews; the text-message signup; the footer.
- **Mobile (390):** the order differs from desktop: star row, **title and tag come first, above the gallery**; the gallery is full width with round arrow buttons and dots; then price, size line, size grid (**two columns**), Add to cart, the three fulfilment tiles in a row (about 105 px each, link text wraps), the same collapsed rows, the horizontal rows (about 1.5 cards visible), overview. **No sticky bar.**

### Cart (empty state only, 1440)

The cart is a page at its own address. The empty state is a 30 px bold "Your Cart" title, one sentence and a red "Continue shopping" button (8 px radius) on a white page under the normal header stack. The header cart icon links to the page; **whether adding an item opens a drawer, and the layout of lines, totals and the checkout button, were not observed** (no item was added).

### Footer (1440 only; the mobile footer was not captured)

On a **light grey** background (not dark). Top band: email signup at the left (heading in the red accent, one line, a pill-shaped email field with a red button) and, after a vertical divider, a text-message signup at the right (heading, a phone illustration, one short line and small legal print). Then: the logo at the left and four round-outlined social icons at the right; a row of five quick links (three left, two right, 18 px); three link groups side by side (each with a bold heading and **two sub-columns** of small grey links); a large "mattresses" block with five sub-columns (size, brand in two columns, comfort, type, price) with small uppercase sub-headings; then rows for the other categories; finally the two company logos centred, a copyright line and three legal links separated by bars. On mobile the group headings carry a chevron, so groups collapse (seen in the heading markup only).

### Not observed in this pass (do not treat as facts)

Mega-menu open behaviour and visuals (hover or click, width, any images); the mobile menu drawer (the tap did not open anything in the headless run); cart with items (drawer or page, lines, totals, quantity and remove controls, checkout button); the mobile footer; the end of the collection grid (Load more, FAQ); the compare table and reviews layout; hover, focus and active states of every control; 768 px and 1024 px layouts; the product page for a product with no sale or no gift tag; any account or checkout page; keyboard behaviour and accessibility of the reference (not assessed, and not part of this task).

## Observations to learn from, not copy

- The bundle total showed a zero amount in the page text: a reminder that bundle pricing must come from Shopify and be tested (REQ-ADD-002, REQ-PROMO-002).
- Heavy repetition of reassurance strips on every page is useful but adds weight; ours must not hurt layout shift or performance (NFR-002).
- Long brand and product-line filter lists need a searchable or collapsible pattern on mobile.
- Collapsed information sections hide important content from users and crawlers if implemented badly; ours render real content server-side.

## How the build used these notes (checked 2026-10-15)

Built from these patterns, in our own structure and wording: header with delivery ZIP (the reference's my-store entry, store locator, "find a store" and "try in store" were not copied: one store only, 2026-10-28, DEC-141), search combobox, main navigation, home sections (eight admin-ordered types), collection with filters, promo tiles and "Load more", product page with size selector and buy box, cart drawer and page, quiz, compare and brand pages. Deliberately **not shown until the client supplies content** (REQ-CNT-001, B-15): the reassurance strip, guarantee claims, Financing and Warranty links, the promo bar text and the support phone link. Not built yet: the reviews slot, pickup choice, "you might also need" cards on the product page (the cart pickers exist), the sticky mobile add-to-cart bar (not confirmed either way), the text-message signup, social links and the floating chat. No text, image or markup from the reference site is used.

## Use

These notes inform information architecture only. Final layouts are decided with the client from the brand kit and reviewed on staging (EXC-09: no static mockups). Any deviation or addition is logged in `docs/design/DEVIATIONS.md`. How our components change to follow these patterns in the client's own brand (the logo supplied 2026-10-22) is specified in [BRAND_APPLICATION_SPEC](BRAND_APPLICATION_SPEC.md); read that page, not this one, before changing a component.
