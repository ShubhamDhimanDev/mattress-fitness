# Reference-site pattern notes (layout and features only)

Task P0-08. The SOW says the shopping experience "follows the patterns" of the reference site for layout and features only, and that **no text, images, logos or trademarks are reused** (SOW §1, NFR-007). These notes are our own description of structure and behaviour, taken from the text of three pages (home, a collection, a product) on 2026-10-11. They contain no marketing copy, no brand or product names, and no markup or styles. Do not paste anything from the reference site into the codebase or content; the client's brand, copy and manufacturer-supplied assets are used throughout.

## Header and global elements

- A slim strip above the header carries a cross-link to the retailer's sister brand (not needed for us).
- Delivery ZIP entry and a "my store" selector sit in the header on every page; both persist (REQ-NAV-003, REQ-LOC-003).
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

**Our tokens until the brand kit arrives (CLR-013):** a neutral placeholder palette deliberately different from the reference site's, one sans-serif system font stack, 8 px spacing scale, 44 px minimum targets. Swapping to the client's palette, logo and fonts must be a one-file token change.

## Observations to learn from, not copy

- The bundle total showed a zero amount in the page text: a reminder that bundle pricing must come from Shopify and be tested (REQ-ADD-002, REQ-PROMO-002).
- Heavy repetition of reassurance strips on every page is useful but adds weight; ours must not hurt layout shift or performance (NFR-002).
- Long brand and product-line filter lists need a searchable or collapsible pattern on mobile.
- Collapsed information sections hide important content from users and crawlers if implemented badly; ours render real content server-side.

## How the build used these notes (checked 2026-10-15)

Built from these patterns, in our own structure and wording: header with delivery ZIP and my-store entry, search combobox, main navigation, home sections (eight admin-ordered types), collection with filters, promo tiles and "Load more", product page with size selector and buy box, cart drawer and page, quiz, compare, store locator and brand pages. Deliberately **not shown until the client supplies content** (REQ-CNT-001, B-15): the reassurance strip, guarantee claims, Financing and Warranty links, the promo bar text and the support phone link. Not built yet: the reviews slot, pickup choice, "you might also need" cards on the product page (the cart pickers exist), the sticky mobile add-to-cart bar (not confirmed either way), the text-message signup, social links and the floating chat. No text, image or markup from the reference site is used.

## Use

These notes inform information architecture only. Final layouts are decided with the client from the brand kit and reviewed on staging (EXC-09: no static mockups). Any deviation or addition is logged in `docs/design/DEVIATIONS.md` when Phase 2 starts.
