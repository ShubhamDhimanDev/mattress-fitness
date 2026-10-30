# Reference-site functionality gap analysis

Prepared 2026-10-23 by the project manager for the owner's instruction "match as close as the reference site's functioning". Companion to [REFERENCE_PATTERNS](../design/REFERENCE_PATTERNS.md), which covers layout and visual structure.

## Basis and limits (read first)

- **Source of the reference behaviour.** Only the inventory the orchestrator observed on public pages on 2026-10-23, plus the earlier layout notes in REFERENCE_PATTERNS (2026-10-11, 10-12, 10-22). Everything else about the reference site is marked **not observed**. Nothing was clicked through to a result (no cart, checkout, account or form submission), so the reference's behaviour behind a link or button is not known.
- **NFR-007.** This note describes behaviour in our own words. It records no reference text, numbers presented as our policy, images, logos, markup or CSS. Figures the reference shows (a financing term, a guarantee length, a discount percentage, a delivery fee) are **not** adopted: our values come from the client (CLR-009, CLR-010, CLR-011, CLR-016).
- **Scope rule.** The SOW (§4 to §9) and the requirements catalogue decide what is in scope. A reference behaviour that is not traceable, or matches an exclusion (EXC-01 to EXC-13), is a change-request candidate (SOW §11), never speculative work. The SOW was written against this reference site ("layout and features only", SOW §1), so most of the observed behaviour is already in scope.
- **Build state words** come from [TRACEABILITY](../requirements/TRACEABILITY.md) and [BACKLOG](../../plans/BACKLOG.md). Nothing in our build is `PASSING` or `DONE`: all of it ran on mock.shop, fixtures, fakes or the Extend mock, and dev-store verification waits for the Admin token (DEC-076, B-13).
- **Not decided here:** the effort bands (S under 1 day, M 1 to 3 days, L over 3 days) are rough project-manager estimates for the owner to price, not quotes. Value is the manager's judgement of effect on buying decisions or order value.

## 1. Reference behaviour against our requirements

Coverage: **Covered** (a requirement matches the behaviour), **Partly** (part is in scope; the gap is named), **Not in scope** (no requirement, or an exclusion). "Build state" is today's TRACEABILITY or BACKLOG state.

### Header and global

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| Delivery ZIP entry in the header | REQ-NAV-003 | Covered | IN_PROGRESS: signed cookie, server-side read, `/delivery` page built; no dev-store evidence |
| Store selector | REQ-LOC-003 | **Dropped 2026-10-28 (DEC-141, SD-12): one store only** | Descoped; removed |
| Order-tracking link | REQ-ACC-003 | Partly: the SOW tracking is by order number and email, limited to 60 days (SD-05, CR-11). What the reference's tracking page does is not observed | IN_PROGRESS: library only, no route or UI (P6-08); the footer link is hidden until the page exists (UXD-26) |
| Contact link | REQ-CNT-001 (Contact page) | Covered | NOT_STARTED (P6-09); link hidden until the page exists |
| Live chat | REQ-ANL-004 | Covered (default Shopify Inbox, Q-011) | NOT_STARTED (P7-03); needs a provider choice; hidden until configured |
| Click-to-call phone | REQ-NAV-001 (support phone from admin or `PUBLIC_SUPPORT_PHONE`) | Covered | Built, hidden until the client supplies the number (B-15) |
| Product search | REQ-SRCH-001, REQ-SRCH-002 | Covered | IN_PROGRESS: combobox, results with filters; filters unverified (V-04) |
| Account icon | REQ-ACC-001 | Covered | IN_PROGRESS: scaffold routes hardened; never run against Shopify (V-08) |
| Cart | REQ-CART-001 | Covered | IN_PROGRESS: drawer and page; worked on a real Shopify cart for read and cart paths only |
| Brand switcher to a sister brand | none | **Not in scope.** REFERENCE_PATTERNS already decided "not needed for us". Whether the client has a sister brand is not known | Not built. Candidate CR-28 |
| Compact fixed header while scrolling (earlier observation) | REQ-NAV-001 names none | Not in scope | Deliberately not built (UXD-12). CR-16 exists |

### Navigation and Sleep Guide

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| Top-level groups: sale, mattresses, foundations and adjustable beds, furniture, bedding, clearance, sleep guide | REQ-NAV-002 | Covered (the SOW list matches) | NOT_STARTED in TRACEABILITY. A `MainNav` with fallback links exists from the shell; the Shopify-menu-driven mega menu (P3B-02) has no backlog row and is **not in the functionality-first list**. Finding F-1 below |
| Mega menus by size, brand, comfort, type, price band | REQ-NAV-002 | Covered | As above. Menu opening behaviour on the reference is not observed |
| Bedding menu: pillows, sheets, protectors, toppers | REQ-NAV-002 (bedding), REQ-CAT-005 (collections) | Covered as menu and collections; the products and categories come from the client's sheet (CLR-014) | Depends on catalog import (P3A, waits for the Admin token) |
| Finder in the guide menu (questionnaire to ranked recommendations, then shop online or try in store) | REQ-QZ-001 to REQ-QZ-007 | Covered; the "try in store" next step (CR-30) was withdrawn 2026-10-28 with the store locator (DEC-141) | IN_PROGRESS on fixtures; wording not client-approved (CLR-012) |
| Blog | REQ-CNT-002 | Covered | NOT_STARTED (P6-09) |
| FAQs | REQ-CNT-001 (FAQ page); REQ-COL-004, REQ-PDP-002 (FAQ blocks) | Covered | Collection FAQs IN_PROGRESS; FAQ page NOT_STARTED |
| Guides by comfort, type, size, adjustable base | REQ-CNT-001 (comfort, mattress types, size, adjustable base guides) | Covered | NOT_STARTED; text is the client's (CLR-016) |
| Guide by sleep position | none | **Not in scope** (not among the 15 listed pages). Candidate CR-22 | Not built |
| Troubleshooting guides | none | **Not in scope.** Candidate CR-22 (copy would also touch EXC-10, CR-06) | Not built |

### Homepage

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| Hero sale banner; shop-by-size tiles; brand sale tiles; category tiles | REQ-HOME-001 | Covered, editable and orderable in admin | IN_REVIEW to IN_PROGRESS: eight admin-ordered section types with fallbacks; admin editing unproven (no dev store) |
| Financing promo (0% for 60 months above a threshold) | REQ-HOME-001 (financing banner), REQ-CNT-001 (Financing page), REQ-CART-005 | Partly. The banner and page layout are in scope. The offer itself needs a real provider and terms (CLR-007, CLR-008); the SOW gives no computed monthly figure | Banner and links hidden until content exists (SD-11, CR-14, Q-016) |
| Finder block and store-finder block | REQ-QZ-007, REQ-HOME-001 | Finder block covered; the store-finder block was dropped 2026-10-28 (DEC-141) | Finder built on fixtures |
| In-store-only offers (mattress plus free base) | REQ-HOME-001 can show a **teaser tile** (content) | Partly. The online teaser is in scope. Honouring an in-store-only price at the point of sale is POS (EXC-06, EXC-08) | Tile type exists; nothing offer-specific. Candidate CR-29 for anything beyond a tile |
| Floor-model clearance | REQ-NAV-002 (clearance), REQ-CAT-005 (rule collections) | Partly. A clearance collection is in scope. One-off, store-specific floor units are not (needs per-location stock and POS) | Candidate CR-29 |
| Chat, store-finder and call prompts | REQ-HOME-001, REQ-ANL-004 | Chat and call prompts covered; store-finder dropped 2026-10-28 (REQ-LOC-001 descoped, DEC-141) | Chat is tawk.to (DEC-136) |
| Email and text-message signup block | REQ-HOME-001, REQ-ANL-003, NFR-011 | Covered (form and consent). Incentive and reminders: see the SMS row below | Signup section renders nothing until P7-02; NOT_STARTED |

### Guarantees, policies and company pages

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| Free in-home delivery and setup banner (strip on every page) | REQ-NAV-001 promotional bar; REQ-CNT-001 | Covered as client-supplied content | Reassurance strip hidden until content (B-15, UXD-26) |
| Comfort guarantee (with a mattress protector condition on our side) | REQ-CNT-001 (Comfort guarantee page), REQ-PRE-002 | Covered. The guarantee length and terms are the client's, not the reference's | Step built on placeholder wording (CLR-010) |
| Lifetime price guarantee | REQ-CNT-001 (Price guarantee page) | Covered as a page. A claim or price-match **process** is not observed and not in scope | NOT_STARTED |
| Warranty and return policy | REQ-CNT-001 (Warranty and returns) | Covered | NOT_STARTED |
| Extended warranty (Extend) FAQ and claims | REQ-EXT-001 to REQ-EXT-005; claims are handled by Extend (SOW §6) | Partly. Offer, linking and reporting are in scope. A dedicated FAQ and claims page is not among the 15 pages. Candidate CR-21 | Extend runs on the local mock only (ADR-0009, DEC-078); REQ-EXT-004 Blocked |
| Military discount page | none | **Not in scope.** Candidate CR-19 | Not built |
| Refer-a-friend | none | **Not in scope.** Candidate CR-20 | Not built |
| Financing page | REQ-CNT-001 (Financing) | Covered as layout and client text | Hidden until content |
| Privacy, "submission" and cookie settings | REQ-CNT-001 (Privacy policy), NFR-011 (consent) | Partly. Privacy page and consent are in scope. What the "submission" item is (a data-request form or a do-not-sell control) is **not observed**; whether the client needs one is a client and legal question, not a feature to assume | Consent layer not built (P7-01) |
| Accessibility page | REQ-CNT-001 | Covered | NOT_STARTED |
| Affiliate, careers, press pages | none | **Not in scope.** Candidate CR-23 | Not built |
| Text-message signup with a 10% offer and cart reminders | Signup form and consent: REQ-ANL-003. Reminders: EXC-03 | Partly. The signup form is in scope; an automated reminder is an excluded flow (CR-03). The welcome incentive is a client marketing decision (candidate CR-18) | NOT_STARTED (P7-02); blocked on Klaviyo access (CLR-004) and consent text (Q-015) |

### Collections

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| Filter groups: size, brand, product type, comfort, mattress type, benefits, sleep position, collection | REQ-COL-002 | Covered. The SOW adds price (REFERENCE_PATTERNS: price not evident on the reference) | IN_PROGRESS: UI and URL codec built; ids and counts unverified (V-04); price filter worked on the real store |
| Product cards with badges (free gift, dollars off, free base) | REQ-COL-001 | Covered, with rules: sale badge only when compare-at exceeds price; gift badge only when an active gift promotion applies. A "free base" badge works only if the client sets it up as a gift rule (CLR-011) | IN_PROGRESS; gift badge source needs P4-06 and the discounts |
| Review count and rating | REQ-PDP-005, REQ-COL-001 | Covered | NOT_STARTED (P3B-12); blocked on the provider (Q-011) |
| "From" price with struck-through price | REQ-COL-001 | Covered | Built |
| "Load more products" (about 48 per load) | REQ-COL-001 | Covered. Our page size is a build setting I did not read; the reference figure is not a requirement | Built |
| Inline promo tiles (finder, financing, guarantee) | REQ-COL-003 | Covered | IN_PROGRESS; tiles show only in the unfiltered view |
| FAQ block | REQ-COL-004 | Covered | IN_PROGRESS |
| No compare checkbox on cards; no breadcrumbs | REQ-CMP-001 and REQ-SEO-001 (Breadcrumb data) | We differ on purpose (section 3) | Compare control and breadcrumb built |

### Delivery, pickup and haul-away

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| In-home delivery and setup only inside a footprint checked by ZIP | REQ-DEL-001, REQ-DEL-002, REQ-CHK-003 | Covered, as **one** zone (ASM-09, SD-07, CR-12) | IN_PROGRESS: eligibility module, signed ZIP, PDP yes or no; no fee or free-delivery text; zone list and fee not supplied (CLR-009) |
| Free at or above a threshold, flat fee below | REQ-CHK-003, REQ-CART-004 | Covered | Free-delivery progress message built (threshold unconfirmed); checkout rate NOT_STARTED, configured in Shopify admin |
| 3-hour window announced the evening before; fee refund if missed | EXC-04 (online booking of windows; the client's team schedules) | **Not in scope** as a feature. The announcement and refund are client operations; the policy can be stated in the Delivery and shipping page content | No build. Booking is CR-02; dynamic promise is CR-25 |
| Next-day delivery on eligible orders | REQ-DEL-002 allows a client-approved promise string per delivery type, with no stock or carrier calculation | Partly. A static line is in scope; deciding "next day" per order from stock and routes is not (EXC-06 if it needs warehouse data). Candidate CR-25 | PDP promise shows in-zone yes or no only; wording not supplied (CLR-009) |
| Standard parcel shipping for small items, no setup | REQ-CHK-003 (parcel shipping) | Covered | NOT_STARTED; configured in Shopify admin; parcel mixing with in-home items is a client answer (SD-04) |
| In-store pickup | REQ-CHK-003 (REQ-PDP-003 and REQ-LOC-002 descoped 2026-10-28, DEC-141) | Pickup is a delivery choice at the client's one store; no per-store availability on the product page | Pickup location and email set up in Shopify (SHOPIFY_STORE_SETUP 2.3) |
| Some pickup items take days to reach the store | none | **Not in scope.** Shopify has a per-location pickup-time text (F-29); a per-item transfer lead time needs warehouse data (EXC-06). Candidate CR-26 | Not built |
| Nationwide delivery by contacting service, with a fee | none (single zone, SD-07). Boxed items can use parcel shipping | **Not in scope.** Candidate CR-24 (message and contact path); a real quote engine is not proposed | Not built |
| Haul-away, priced per piece, chosen online by quantity | REQ-PRE-003, REQ-PROMO-003, REQ-CAT-007 | Covered, with a client-set maximum (the reference states none) | IN_PROGRESS: cart gate, step, detective check built on fakes; residual risk B-17, B-18 |
| Haul-away excludes frames, bases, bedding and stained items | REQ-PRE-003 acceptance criteria do not list exclusions | Partly. Excluding types is a wording and eligibility rule the client would define (CLR-010) | Not built beyond the cap |
| Haul-away chosen "before the delivery date" | REQ-PRE-003 is a pre-checkout step | Not observed whether the reference lets a shopper add it **after** the order. If the client wants that, it is a post-order feature, not in the SOW. Ask, do not assume | Not built |

### Finder

| Reference behaviour | Our ID | Coverage | Build state |
|---|---|---|---|
| Questionnaire, ranked recommendations | REQ-QZ-001 to REQ-QZ-003 | Covered; ours returns the best three with reasons | IN_PROGRESS on fixtures |
| Shop online or try in store as the next step | REQ-QZ-002 (Add to cart, See all matches, Retake) | Partly: no store link on the results. CR-30 withdrawn 2026-10-28 (DEC-141) | Not built, and no longer planned |
| Saved results, tracking, "not medical advice" | REQ-QZ-005, REQ-QZ-006, REQ-QZ-007 | Covered (the SOW goes beyond what was observed) | Device storage built; account sync and GA events not |

## 2. Reference behaviours outside the SOW or against an exclusion: change-request candidates

Registered in [BACKLOG](../../plans/BACKLOG.md) as CR-18 to CR-30, status **proposed, not approved**. Nothing is built. SOW §11 requires a written change request and the client's written approval before any of this starts; each needs an effort and price from the owner. Existing candidates that this analysis touches are not re-registered: CR-02 (delivery windows), CR-03 (automated flows, which includes cart reminders), CR-06 (copywriting), CR-12 (more delivery zones), CR-14 (financing hidden), CR-16 (sticky header).

| CR | Candidate | Touches | Effort | Value | Dependency and notes |
|---|---|---|---|---|---|
| CR-18 | Signup incentive (a welcome offer on email or text signup) and an optional first-visit signup pop-up | REQ-ANL-003, EXC-03 | S for a fixed code shown after signup; M or more for unique codes (that is a Klaviyo flow, so CR-03) | Medium to high: lifts list growth and first orders | Klaviyo access (CLR-004), consent wording (Q-015), a Shopify discount the client creates. Cart-reminder SMS stays CR-03. A pop-up adds a keyboard-trap and layout-shift risk (NFR-003) |
| CR-19 | Military (and similar) discount page | none | S for an information page; M if the shopper must be verified by a third-party service | Low to medium | The client's policy and discount; verifier fees are the client's (EXC-12). Verification method on the reference is not observed |
| CR-20 | Refer-a-friend programme | EXC-03, EXC-12 | M to L (App Store app, tracking, referral emails) | Medium | Client programme rules, app choice and fees; referral emails are automated flows |
| CR-21 | Extended-warranty (Extend) FAQ and claims page | REQ-CNT-001, REQ-EXT-004 | S | Medium: reduces support load and supports the protection offer | Extend's claims address and approved wording (Q-005, blocked on the client's account). The owner may prefer to fold it into the Warranty and returns page at no cost |
| CR-22 | Extra guide pages: sleep-position guide and troubleshooting guides | REQ-CNT-001 (15 pages named), EXC-10, CR-06 | S per page for layout using the existing guide layout; copy is the client's or CR-06 | Medium: helps decisions and search traffic | Client copy (CLR-016) |
| CR-23 | Company pages: careers, press, affiliate programme | none | S each for careers and press; M for an affiliate programme with tracking | Low | Client content; an affiliate platform adds fees (EXC-12) |
| CR-24 | Out-of-area delivery message with a "contact us for a delivery quote" path | REQ-DEL-002, SD-07, CR-12 | S | Medium: stops dead ends for shoppers outside the one zone | Client policy for out-of-area orders and who answers (operations). A fee calculator is not proposed |
| CR-25 | Dynamic delivery promise: next-day eligibility per item, window announcement and fee refund tracking | REQ-DEL-002, EXC-04, EXC-06, CR-02 | L | High if the client runs next-day delivery, but needs data we do not hold | Warehouse, route and stock data (EXC-06); windows booking is CR-02. The static promise string is already in scope |
| CR-26 *(withdrawn 2026-10-28, DEC-141)* | Pickup lead time for items that must be transferred to the store | REQ-PDP-003, EXC-06 | M to L | Medium | Shopify's per-location pickup-time field (F-29) and V-07; per-item transfer data needs a warehouse or ERP feed (EXC-06) |
| CR-27 *(withdrawn 2026-10-28, DEC-141)* | Per-store stock on listings and search ("available at my store" badge or filter) | REQ-PDP-003, REQ-LOC-003 | M | Medium: connects online browsing to the showroom | REQ-PDP-003 verified first (V-07), a Storefront API cost and cache check across 400 products. **Not observed on the reference**; a candidate extension of the store selector |
| CR-28 | Sister-brand switcher or strip above the header | none | S | Low unless the client has a second brand | Client confirmation that a sister brand exists; REFERENCE_PATTERNS says not needed |
| CR-29 | Floor-model clearance listings (one-off, store-specific units) and in-store-only offer handling beyond a teaser tile | EXC-06, EXC-08, REQ-HOME-001 | M | Medium for clearance revenue | Per-location stock, one product record per unit, POS rules. A homepage teaser tile and a clearance collection are already in scope |
| CR-30 *(withdrawn 2026-10-28, DEC-141)* | Store-finder or "try in store" step on the quiz results page | REQ-QZ-002 | S | Medium: matches the reference's finder hand-off to a showroom visit | REQ-LOC-003 and REQ-PDP-004 exist; the owner may rule it a design detail inside REQ-QZ-002 instead |

Quick wins the owner could offer the client together: CR-21, CR-22, CR-24, CR-30 and the fixed-code form of CR-18 (all S). Needs a client policy first: CR-19, CR-20, CR-23, CR-28. Large and needs data we do not hold: CR-25, CR-26, CR-27, CR-29.

## 3. Where our approach differs but still meets the SOW

| Topic | Reference (observed) | Ours | Why this meets the SOW |
|---|---|---|---|
| Load more | A "Load more products" button, about 48 per load | Same button pattern; page size is a build setting (not read for this note) | REQ-COL-001 asks for "load more" without a full reload; the number per load is not specified |
| Compare and breadcrumbs | No compare checkbox on cards, no breadcrumbs | Compare control and breadcrumbs are built | The SOW lists comparison (REQ-CMP-001); breadcrumbs support REQ-SEO-001 structured data |
| Delivery area | A delivery footprint checked by ZIP | One zone, ZIP typed by the shopper and stored in a signed cookie; the server cannot see the checkout address (SD-04, ADR-0007) | SD-07 and ASM-09: owner decision, client acknowledgement pending |
| Delivery windows and next-day | A 3-hour window announced the evening before; next-day on eligible orders; refund if missed | A static, client-approved promise string; no booking or stock-based promise | EXC-04 and REQ-DEL-002 (no stock or carrier calculation) |
| Haul-away | Per-piece price, chosen online, no stated maximum | Per-piece price with a client-set maximum, enforced in the UI, on the server and by a detective check after the order | SOW §5 requires a maximum; enforcement outside our server is detective only on Basic (SD-01, ADR-0006) |
| Financing | A 0% term above a spend threshold | A hidden message slot until a provider is active; no computed monthly figure | SD-11, CR-14, Q-016. The SOW asks for messages, not a specific offer |
| Extended warranty | Extend FAQ and a claims page | Extend offer, linked coverage line and order sync, run against a local mock behind a flag; Extend handles claims | SOW §6; ADR-0009. Live only with the client's approved account (REQ-EXT-004 Blocked) |
| Signup | Text signup with a discount and reminders | Email and text signup forms with recorded consent; no incentive and no automated reminders | EXC-03 excludes the flows; forms are included (REQ-ANL-003) |
| Order tracking | A tracking link in the header | Guest lookup by order number and email, 60 days, generic errors, rate limited | SD-05, CR-11. The reference's own rules are not observed |
| Pickup | Pickup, with some items taking days to reach the store | Pickup at the one store as a delivery choice; no per-store availability and no transfer lead time (REQ-PDP-003 descoped 2026-10-28, DEC-141) | REQ-CHK-003; lead times need warehouse data (EXC-06) |
| Header on scroll | Compact fixed header (earlier observation) | Whole header scrolls away | REQ-NAV-001 names no sticky header; CR-16, UXD-12 |
| Filter counts | No counts visible (earlier observation) | Counts that must match Shopify admin | REQ-COL-002 acceptance criteria |
| Offers | Not observed beyond badges and inline rows | Offers run on our pages before Shopify's hosted checkout and arrive as ordinary lines | SOW §5; ADR-0003; EXC-01 and EXC-02 keep checkout Shopify's |

## 4. Recommendation

### Build now, on mocks and fixtures (already in scope; no change request)

These reference behaviours are in the SOW and fit the functionality-first plan in [CURRENT_PHASE](../../plans/CURRENT_PHASE.md). Everything stays on mocks, fixtures and fakes, hidden until content or configuration exists, and nothing can go `DONE` before the dev-store pass (DEC-076).

1. **Product-page fulfilment choices** (delivery by ZIP, pickup by store; "try in store" was dropped 2026-10-28, DEC-141) and the **add-on rows** ("you might also need", "frequently bought with"): plan steps 3 and 8 (P4-03, P4-12 seam, P3B-10). This is the largest visible functional gap between our product page and the reference's.
2. **Reviews and ratings** adapter with a hidden slot: step 8 (P3B-12).
3. **Signup (email and text) and chat** adapters: step 4 (P7-02, P7-03) plus the consent layer (P7-01), each off until configured.
4. **Content and policy pages** and the blog, including the guarantee, price guarantee, warranty, financing, delivery and shipping, accessibility, FAQ and the four guides: step 5 (P6-09), hidden until the client supplies text.
5. **Guest order tracking** on a fake Admin client: step 6 (P6-08, P6-14).
6. **Per-type delivery promise wording slot** (REQ-DEL-002) and the fee and free-delivery lines on the product page, once the client gives the zone, fee and threshold (CLR-009). The structure can be built now; the strings cannot be invented.
7. **Quiz** account sync and admin-managed scoring: step 7.
8. **Finding F-1: the Shopify-menu-driven mega menu (REQ-NAV-002, P3B-02) is missing from the functionality-first list.** TRACEABILITY says NOT_STARTED, the backlog has no row for P3B-02, and the real-store test shows only fallback links answering 404 (RS-07, B-26). The reference's navigation is the first thing a shopper uses, so I recommend adding it as a step before step 5. This is an addition to the plan, not to the scope; the orchestrator should decide where it sits.

### Register as change requests and ask the client (SOW §11)

- Take **CR-18 to CR-30** (section 2) to the owner for pricing and then to the client in writing. Suggested order: first the S quick wins (CR-21, CR-22, CR-24, CR-30, CR-18 fixed-code form), because they close the visible content and conversion gaps cheaply; next the policy-dependent items (CR-19, CR-20, CR-23, CR-28) only if the client says it runs them; leave CR-25, CR-26, CR-27 and CR-29 until the client confirms it can supply stock, route and POS data, because without that data they would be fake promises.
- **Do not describe any CR-18 to CR-30 behaviour as delivered or promised** to the client or in the build until the written approval exists. This matters most for next-day, delivery windows and pickup lead times, where a wrong promise is costly.
- **Do not copy the reference's figures or policies** (financing term, guarantee length, discount percentage, delivery fee, return period). The client sets its own.

### Questions for the owner before the client pack

1. Does the client have a sister brand (CR-28), a military or referral programme (CR-19, CR-20), or careers and press pages (CR-23)?
2. Does the client run next-day delivery, delivery windows or out-of-area delivery by quote (CR-24, CR-25)? If yes, who handles them and what data exists?
3. Can a shopper add haul-away **after** ordering at the reference (not observed)? Does the client want that? It would be a post-order feature outside the SOW.
4. Does the client want a signup incentive and a pop-up (CR-18), and which discount?
5. Does the client need a "do not sell or share" or data-request control in its privacy setup (a legal question; the SOW covers only the privacy page and consent)?

### Not observed (do not treat as facts)

How the mega menu opens; the cart, drawer and checkout of the reference; what the order-tracking, military, referral, financing, claims, affiliate, careers, press and "submission" pages contain or require; what the email pop-up offers; how the finder ranks results or how many it shows; whether pickup shows a store-by-store stock figure; whether delivery fees, thresholds or windows differ by region; the reference's mobile menu and footer; any behaviour after a button is pressed.

## Records to update after this note

The orchestrator should add: a decision line for the owner's "match the reference" instruction and its handling (DEC next free), a risk entry for the F-1 plan gap, and the client-pack section for CR-18 to CR-30 (owner decides whether to send them). Run `node scripts/validate-framework.mjs` after these edits.
