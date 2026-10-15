# Requirements catalogue

Derived from [SCOPE_OF_WORK.md](SCOPE_OF_WORK.md) (the source of truth). Every in-scope SOW statement has an ID here; nothing is dropped silently. Planned test coverage per ID is in [TRACEABILITY.md](TRACEABILITY.md); open questions are in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

## Legend

| Field | Values |
|---|---|
| **ID** | `REQ-<AREA>-NNN` functional, `NFR-NNN` non-functional, `CLR-NNN` client responsibility, `EXC-NN` exclusion, `ASM-NN` assumption. IDs are never reused. |
| **Phase** | The phase in which the requirement is *completed and accepted*: `0, 1, 2, 3A, 3B, 4, 5A, 5B, 6, 7, 8, 9`. Plans: [../../plans/phases/](../../plans/phases/). |
| **Status** | `Confirmed` (stated in the SOW), `Assumed` (our inference, needs client confirmation or is a project invariant), `Blocked` (cannot be delivered or verified until an external input or eligibility check resolves), `Pending approval` (design or choice needs a recorded client decision). |
| **Depends on** | `REQ-*`/`NFR-*`, `CLR-*`, `Q-*` (open question), `G-*` (global dependency). |

**Global dependencies.** `G-1` Shopify store access (a development store first, then the client's store; Q-002, CLR-002). `G-2` Client brand kit (CLR-013). `G-3` Hosting option chosen (Q-003). `G-4` Supported Node.js toolchain on the build machine (Q-017). Almost every requirement needs `G-1` to be *verified* against real data; it is listed only where it is the direct blocker.

**A note on "Blocked".** Status reflects what is known today (2026-10-11, notes refreshed 2026-10-15). Blocked items keep their phase; the phase plan carries an explicit unblock task. We never mark a blocked requirement DONE with a stub.

**Status is scope status, not build progress** (DEC-025). Build and verification state lives in [TRACEABILITY.md](TRACEABILITY.md) and `plans/BACKLOG.md`. The wording of a requirement changes only through a recorded change request ([../../plans/BACKLOG.md](../../plans/BACKLOG.md), SOW §11); the notes below record, without changing any requirement, where an owner answer, a decision or a built workaround has overtaken an assumption or where the build intentionally differs.

## Build and decision notes (2026-10-15)

No Status value was changed by this refresh: every row below keeps the status in its table. All built behaviour ran on mock.shop, fixtures, fakes or the local Extend mock; nothing is verified on a development store (B-13), so no row is reported as delivered. Deviation rows (SD-xx) await client acknowledgement (B-11; the client pack has not been sent, B-08).

| Requirement | What has overtaken the text, or where the build differs | Recorded in |
|---|---|---|
| REQ-PRE-003, REQ-PROMO-003 (and REQ-PRE-006) | Basic plan (ASM-07): no in-checkout Function. Built: UI and server caps, the cart gate (re-read, repair, block; fails closed on a missing ZIP, rule or catalog), the haul-away step, and a log-only detective check after the order (P5B-05). The gate prevents violations only on carts built through our server; carts built directly through Shopify's public API are detected after the order, not prevented. Eligibility rests on the ZIP the shopper types, since our server cannot see the checkout address (the "in-home delivery inside the delivery area" criterion is met on that basis only). The Flow or webhook proof in REQ-PROMO-003 is unverified (V-17, V-20) | SD-01, [ADR-0006](../decisions/ADR-0006-basic-plan-pre-checkout-logic.md), DEC-029, DEC-031, DEC-033, DEC-043, B-17, B-18 |
| REQ-DEL-001, REQ-DEL-002, REQ-CHK-003, REQ-CHK-005, REQ-NAV-003 | Single delivery zone (ASM-09) with Shopify Local delivery. Built: one zone record, a signed `delivery_zip` cookie with its own secret read on the server, `/delivery`, a parity script (P5B-02, in review). The PDP promise currently shows in-zone yes or no only; the per-delivery-type promise wording stays a client-approved string not yet supplied (CLR-009). The ZIP cookie is personal data for the privacy policy (T-16). Express wallet limitation unchanged | SD-04, SD-07, [ADR-0007](../decisions/ADR-0007-single-delivery-zone-local-delivery.md), DEC-014, DEC-032, DEC-036, Q-008, Q-021 |
| REQ-ADD-003, REQ-PRE-004, REQ-EXT-001, REQ-EXT-002, REQ-EXT-003, REQ-EXT-005 | Extend is built against a local mock behind `PUBLIC_EXTEND_ENABLED` (ASM-10, owner decision), using price points and nested cart lines, with webhook order sync and a reconcile script. Status stays `Assumed` because the account, Extend's answers and the nested-line behaviour on Basic are unverified (V-02, V-11, V-16, V-20). **Assumption, not fact (V-11, DEC-040):** offers are quoted at quantity 1; coverage quantity still follows the covered item. With the flag off every coverage line is removed (DEC-038). Not live until the client has an approved account | SD-08, [ADR-0009](../decisions/ADR-0009-extend-price-points-nested-lines-own-sync.md), DEC-015, DEC-034, DEC-037, DEC-038, DEC-040, Q-005, B-03 |
| REQ-EXT-004 | Still `Blocked`. "Powered by Extend" is text only; no logo or terms link until Extend and the client supply them | Q-005, B-15 |
| REQ-CART-002, REQ-PROMO-001, REQ-PROMO-002, REQ-ADD-002, REQ-CAT-008 | Gift and bundle prices come only from Shopify discounts. A gift is shown as free only when Shopify prices the line at $0 (otherwise the gate refuses it); a bundle saving shows only when the cart carries an automatic discount titled to match the rule's `discountTitle`; the gift picker ships off (`PUBLIC_GIFT_PICKER_ENABLED`) until V-03 passes on a store. The client team must create those discounts and use dedicated gift variants (client action, Q-020) | DEC-046, DEC-047, B-21, SD-09, Q-020 |
| REQ-PRE-005 | A decline is recorded through cart attributes; whether `cartAttributesUpdate` replaces or merges is unverified (B-13) | DEC-033, R-30 |
| REQ-PRE-006, REQ-CHK-001 | Implemented as the cart gate and `/checkout-steps` (the permalink `/cart/:lines` redirects there); uncorrectable violations block the storefront path. The checkout hand-off, signed-in recognition and cart total equal to checkout total are unverified on a store (V-03) | DEC-029, DEC-030 |
| REQ-CART-005 | Slot decided as hidden until the provider is active; no computed monthly figure | SD-11, Q-016 |
| REQ-ACC-003 | Planned as an Admin API route limited to 60 days with generic errors; not built; the shared rate limiter waits on the host answer (R-27) | SD-05, Q-009, B-19 |
| REQ-CNT-001, REQ-HOME-001, REQ-NAV-001 | The client has not supplied the guarantee, warranty, financing, promo and phone content: those items are hidden through `awaitingContent` rather than shown invented, so the "every listed page exists and is linked" criterion cannot be met until CLR-016 arrives. Design follows the reference site's layout in the client's brand (ASM-08); neutral tokens until CLR-013 | B-15, ADR-0010, Q-004 |
| REQ-COL-001, REQ-PDP-001 | Price and availability queries are cached 60 seconds, then served stale up to 300 seconds while revalidating (owner decision); a listed price can lag by up to about 6 minutes, and checkout always charges the live price. The "From $" criterion is therefore met within that window | DEC-024 |
| REQ-COL-002, REQ-SRCH-002, REQ-PDP-005, REQ-PDP-003, REQ-LOC-001, REQ-QZ-001 to REQ-QZ-007, REQ-CMP-001 | Built or planned on fixtures and mock.shop through one data seam; the "edited in Shopify admin" and "matches Shopify data" criteria are unverified until the dev store exists (V-04, V-05, V-07). Defaults decided for reviews (Judge.me), chat (Shopify Inbox) and maps (Leaflet with OpenStreetMap) | DEC-023, DEC-017, Q-010, Q-011 |
| REQ-SEO-001 | Indexing policy decided: one canonical per indexable page (no query string), internal search `noindex,follow`, offer-only products out of the sitemap and `noindex` (the client team sets the `offer-only` tag), sitemap built from Shopify resources plus extras; Organization JSON-LD waits on client data | DEC-044, DEC-045, DEC-049, [SEO_POLICY](../architecture/SEO_POLICY.md) |
| NFR-002, NFR-003, NFR-009 | Targets adopted provisionally (Q-012); stay `Pending approval` until the client approves. axe runs in the specs; no Lighthouse baseline or screen-reader pass yet | DEC-017, Q-012 |
| NFR-004 | Its criterion "no open High findings; dependency audit clean or risk-accepted in writing" is **not met**: the react-router advisories (finding H-1, T-12) are open and ADR-0008 is still `Proposed` (launch blocker). Per-threat status: [THREAT_MODEL](../security/THREAT_MODEL.md) | B-12, R-23, Q-019 |
| NFR-010, NFR-013 | A redacting structured logger and an alert-definition table are built (alert delivery untested, needs the host); resilience specs inject Extend failures at the browser-to-route layer only | DEC-044, DEC-045, P5A-11 |
| REQ-HOST-001 to REQ-HOST-004 | Hosting not chosen (Q-003); build is host-agnostic (ADR-0004). Staging details missing (B-07). Controls waiting on the host are listed in B-19 | Q-003, B-06 |
| REQ-HAND-001 | The client's GitHub organisation is not yet known (Q-014); local commits only, pushes are owner-only (DEC-022) | Q-014 |
| REQ-GOV-001 | Its criterion ("no unverified item marked relied on for a phase that has started") is **not met as worded**: Phases 3B, 4, 5A, 5B and 7 started on mocks before V-02, V-03, V-04, V-05, V-16 and V-20 were verified. Behaviour that relies on an unverified fact is flag-gated or fails closed. This is recorded for the owner, not reworded here (R-34) | R-34, B-13 |

---

## Functional requirements

### Shell and navigation

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-NAV-001 | Responsive site shell: promotional bar, header (search, account and cart entry points), footer, mobile navigation drawer | §4 | 2 | Confirmed | G-2, NFR-001 | Renders at 360, 768 and 1280 px with no horizontal scroll; header, menu and drawer fully keyboard-operable; uses brand tokens; placeholders (mock data until Phase 3A) are each tracked in the backlog |
| REQ-NAV-002 | Mega menu: mattresses by size, brand, comfort, type and price; foundations and adjustable bases; furniture; bedding; sale; clearance; guides, driven by Shopify navigation menus | §4 | 3B | Confirmed | REQ-NAV-001, REQ-CAT-005 | Menu edits made in Shopify admin appear on the site within the documented cache TTL; every top-level item is reachable by keyboard; mobile equivalent is an accessible accordion; no link 404s |
| REQ-NAV-003 | Delivery zip-code entry in the header: validated, persisted, editable; feeds delivery eligibility | §4 | 3B | Confirmed | REQ-NAV-001 | Invalid ZIP shows an inline error; a valid ZIP persists across navigation and reload and is readable server-side for SSR; ZIP is never sent to third-party scripts |

### Homepage

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-HOME-001 | Homepage sections: sale banners, shop by size, brand tiles, category tiles, financing banner, store and chat call-outs, email/SMS signup block; every section editable and orderable in Shopify admin | §4 | 3B | Confirmed | REQ-CAT-006, REQ-LOC-002 | Client can add, remove, reorder and edit each section in Shopify admin without a developer and see the change on the site; every section tolerates missing optional fields; signup block UI present (submission wired by REQ-ANL-003); chat call-out follows the provider chosen in Q-011 |

### Collections

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-COL-001 | Collection listing: product grid, sorting, load more, "From $" pricing, sale and gift badges, star ratings | §4 | 3B | Confirmed | REQ-CAT-002, REQ-PDP-005 | "Load more" appends the next page without a full reload; sort options map to Shopify sort keys; "From $" equals the lowest available variant price; sale badge only when compare-at price exceeds price; gift badge only when an active gift promotion applies; ratings shown only when the reviews source provides them |
| REQ-COL-002 | Collection filters: size, brand, product type, comfort level, mattress type, benefits, sleep position, product line, price | §4 | 3B | Confirmed | REQ-CAT-005, REQ-CAT-002 | Each filter's results and counts match Shopify admin data; filter state is in the URL (shareable, back-button safe); empty-result state offers a reset; price filter is keyboard-operable |
| REQ-COL-003 | Promotional tiles inside the collection grid, positioned and edited in Shopify admin | §4 | 3B | Confirmed | REQ-HOME-001 | Tile content and position editable in admin; grid never breaks at any breakpoint; tiles are announced as links with accessible names |
| REQ-COL-004 | Collection FAQs, editable in Shopify admin | §4 | 3B | Confirmed | REQ-SEO-001 | FAQs render as a keyboard-accessible accordion; FAQPage JSON-LD validates |
| REQ-COL-005 | Brand collection pages and brand sections (logo, about text, warranty terms) reused on product pages | §4, §8 | 3B | Confirmed | REQ-CAT-006 | A brand page lists that brand's products with the standard filters; editing brand content in admin updates both the brand page and every product page of that brand |

### Search

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-SRCH-001 | Predictive search with product suggestions | §4 | 3B | Confirmed | REQ-CAT-002 | Suggestions update as the shopper types (debounced, no request below 2 characters); listbox keyboard pattern works; Esc closes; API errors fail silently to a plain search link |
| REQ-SRCH-002 | Search results page with the same filters as collections | §4 | 3B | Confirmed | REQ-COL-002 | `/search?q=` lists matches with the same filter set and URL state; zero-results state suggests alternatives |

### Product pages

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-PDP-001 | Image gallery; size selector showing dimensions and live price; savings and badges | §4 | 3B | Confirmed | REQ-CAT-002, REQ-CAT-003 | Choosing a size updates price, savings, SKU, availability and URL without a full reload; dimensions come from variant data; gallery usable by keyboard and touch with catalog alt text; sold-out sizes are disabled with a reason |
| REQ-PDP-002 | Overview, specifications and features; brand, delivery and warranty sections; FAQs | §4 | 3B | Confirmed | REQ-CAT-002, REQ-COL-005 | Each section renders from Shopify data and is omitted (not empty) when it has no data; Product JSON-LD present and valid |
| REQ-PDP-003 | Store pickup availability for the shopper's chosen store | §4 | 3B | Confirmed | REQ-LOC-002, REQ-LOC-003, G-1 | For the selected size and "my store", shows ready-for-pickup or not available from per-location inventory; updates on size or store change; prompts to choose a store when none is set |
| REQ-PDP-004 | "Try in store" link on the product page | §4 | 3B | Confirmed | REQ-LOC-003 | Link resolves to the shopper's store page, or the locator when none is set, carrying product context; no booking or appointment feature is implied (not in scope) |
| REQ-PDP-005 | Reviews on the product page, from the client's chosen reviews app | §4 | 3B | Assumed | Q-011, CLR-005, V-23 | Reviews and aggregate rating render through a provider adapter (default Judge.me, server-side proxy, key never in the browser); provider failure degrades to "no reviews yet" without breaking the page; rating structured data only when real reviews exist |

### Add-ons, bundles and comparison

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-ADD-001 | Size-matched foundations, adjustable bases and frames offered on the product page | §4 | 4 | Confirmed | REQ-CAT-007, REQ-PDP-001 | Offered items come from admin-configured relations and match the selected mattress size; changing size swaps the offered variant; accepted add-on is a normal cart line; unavailable variants are never offered |
| REQ-ADD-002 | "Frequently bought together" bundle with Add all | §4 | 4 | Confirmed | REQ-PROMO-002, REQ-CAT-008 | Bundle contents and saving come from admin configuration; Add all adds every line in one operation and reports partial failure; displayed price equals cart and checkout price |
| REQ-ADD-003 | Accident protection offer on the product page | §4, §6 | 5A | Assumed | REQ-EXT-001, REQ-EXT-005, Q-005, SD-08 | Eligible products show the Extend offer for the chosen size; accepting adds a linked coverage line (REQ-EXT-002); ineligible products show nothing; with the Extend feature flag off nothing renders |
| REQ-CMP-001 | Side-by-side comparison of similar products by rating, price, comfort, type, height and benefits | §4 | 6 | Confirmed | REQ-CAT-002, REQ-PDP-005 | Shopper can add products to a comparison from collections and product pages; table shows the six listed attributes; usable on mobile with fixed labels; selection persists for the session; rating row omitted when no reviews source |

### Sleep quiz

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-QZ-001 | Quiz flow: 6 to 8 one-tap questions with a progress bar covering sleep position, preferred feel, sleeping hot, sharing the bed, areas of discomfort, preferred mattress type, size and budget | §4 | 6 | Confirmed | REQ-QZ-004, CLR-012 | 6 to 8 questions shown; each answerable in one tap; progress bar and back navigation work; keyboard and screen-reader operable |
| REQ-QZ-002 | Quiz results: three best-matched mattresses with reasons, price in the chosen size, Add to cart; "See all matches" and "Retake quiz" | §4 | 6 | Confirmed | REQ-QZ-003, REQ-CART-001 | Exactly three results (fewer only if the catalog has fewer); each shows its match reasons and size price; Add to cart adds the chosen size; "See all matches" opens the collection with matching filters applied; Retake clears answers |
| REQ-QZ-003 | Matching: each answer scores products on stored attributes (comfort level, mattress type, sleep position, benefits, price); new products included automatically | §4 | 6 | Confirmed | REQ-CAT-002, REQ-QZ-004 | Scoring is a pure, unit-tested function; adding a product with the attributes makes it eligible with no code change; ties break deterministically; out-of-stock and wrong-size products are excluded |
| REQ-QZ-004 | Quiz question wording, answer options and answer-to-attribute mapping managed in Shopify admin | §4 | 6 | Confirmed | CLR-012, REQ-CAT-002 | Client edits questions, options and mappings in admin and sees the change on the site without a developer; invalid mapping is rejected or ignored with a logged warning, never a crash |
| REQ-QZ-005 | Saved results: remembered on the device and saved to the customer account when signed in | §4 | 6 | Confirmed | REQ-ACC-001 | Returning shopper sees prior results; signing in persists them to the account and a second device sees them; clearing is possible |
| REQ-QZ-006 | Tracking: quiz starts, completions and result clicks sent to Google Analytics | §4 | 6 | Confirmed | REQ-ANL-001 | The three event types fire exactly once per action with the documented parameters; no event fires without analytics consent |
| REQ-QZ-007 | Quiz entry points on homepage, mattress menu, collection pages and product pages; "not medical advice" note | §4 | 6 | Confirmed | REQ-HOME-001, REQ-NAV-002 | Entry point present on each listed surface; the guidance-only note appears on results |

### Stores and delivery

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-LOC-001 | Store locator: state, city and individual store pages with map, hours, phone and directions | §4 | 6 | Assumed | REQ-LOC-002, Q-010 | Pages exist for every store, city and state in the data; hours (including today's), tap-to-call phone and a directions link present; the map uses OpenStreetMap tiles on store pages only, with visible attribution and no tile prefetching; map failure falls back to the address and a Google Maps directions link; LocalBusiness JSON-LD valid |
| REQ-LOC-002 | Stores managed in Shopify admin and mapped to Shopify locations for pickup | §4, §7, §8 | 3A | Confirmed | CLR-015, G-1 | Store records (address, hours, phone, photo, coordinates, location mapping) editable in admin; client's store list imported; storefront reads them through the Storefront API |
| REQ-LOC-003 | "My store" selector in the header and "Set as my store" on store pages, persisted | §4 | 3B | Confirmed | REQ-LOC-002, REQ-NAV-001 | Selection persists across sessions; header shows the chosen store; pickup availability uses it; can be changed or cleared |
| REQ-DEL-001 | Delivery eligibility for the **single delivery zone** (owner decision): ZIP to white-glove eligibility, fee and free-delivery status, from one source of truth that the storefront and checkout agree on | §5, §7 | 5B | Pending approval | CLR-009, Q-008, SD-04, SD-07 | The zone list is stored once as a metaobject; eligibility for a ZIP is identical in the storefront, the haul-away step and Shopify Local delivery at checkout (a parity script and test compare the two lists); boundary and invalid ZIPs handled; zone editable by the client without a developer; the express-wallet limitation of Local delivery is documented |
| REQ-DEL-002 | Delivery promise on the product page for the shopper's zip code | §4 | 5B | Pending approval | REQ-DEL-001, REQ-NAV-003, REQ-PDP-001, SD-07 | Product page shows the delivery method and promise text for the saved ZIP, or asks for one; the promise wording is a client-approved string per delivery type (no stock or carrier calculation); no promise is shown for ineligible combinations |

### Account and content

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-ACC-001 | Customer sign-in using Shopify customer accounts | §4 | 6 | Confirmed | Q-018, G-1 | Login and logout complete against Shopify's customer account flow; protected routes redirect when signed out; expired sessions recover cleanly |
| REQ-ACC-002 | Order history and order details | §4 | 6 | Confirmed | REQ-ACC-001 | A signed-in customer sees only their own orders; details show every line (including protection and haul-away lines), status and tracking; cross-customer access test fails closed |
| REQ-ACC-003 | Guest order tracking by order number and email | §4 | 6 | Pending approval | Q-009, SD-05, V-20 | Matching number and email return status for orders within the last 60 days; any mismatch returns one generic message (no enumeration signal); older orders show how to sign in or use the email link; requests are rate-limited; no PII in logs |
| REQ-CNT-001 | Page layouts and loading of client text for the 15 listed pages (delivery and shipping, financing, comfort guarantee, price guarantee, warranty and returns, FAQ, About, Contact, size guide, comfort guide, mattress types guide, adjustable base guide, privacy policy, terms, accessibility) | §4, §8 | 6 | Confirmed | CLR-016 | Every listed page exists at a stable URL, is linked from the footer or menu, renders from Shopify content and is editable in admin |
| REQ-CNT-002 | Blog listing and article layouts | §4 | 6 | Confirmed | none | Listing paginates; article pages carry social and SEO metadata; content comes from the Shopify blog |

### Cart, offers and promotions

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-CART-001 | Cart as slide-out drawer and full page: edit sizes and quantities, remove items | §5 | 4 | Confirmed | REQ-PDP-001 | Size change, quantity change and removal update totals correctly in both views; state survives reload; failures show a recoverable message |
| REQ-CART-002 | Gift-with-purchase offers with a size picker, shown when a qualifying product is in the cart; removing the qualifying item removes the gift | §5 | 4 | Confirmed | REQ-PROMO-001, CLR-011 | Gift appears only while a qualifying item is present; size picker adds the chosen gift variant; removing the qualifying item removes the gift line and its discount |
| REQ-CART-003 | Matching protector, pillow and bedding offers in the cart | §5 | 4 | Confirmed | REQ-CAT-007 | Offers match the mattress in the cart (size, rules from admin); accepted offers are normal lines; no offer shown when no rule applies |
| REQ-CART-004 | Free-delivery progress message | §5 | 4 | Confirmed | CLR-009 | Message shows remaining amount to the admin-configured threshold and the success state; recomputed after every cart change |
| REQ-CART-005 | Store-card and Affirm monthly payment messages | §5 | 4 | Pending approval | CLR-007, CLR-008, Q-016, V-25, SD-11 | A message slot exists and is hidden when the provider is not active; default copy refers to Shop Pay Installments; no computed monthly figure unless a provider component supplies it; wording approved by the client |
| REQ-PRE-001 | Pre-checkout step orchestration after "Proceed to checkout": each step shown only when it applies, each with accept and decline | §5 | 4 | Confirmed | REQ-CART-001 | Steps appear in order and are skipped when not applicable; accept and decline both advance; browser back is safe; every step is reachable without a mouse |
| REQ-PRE-002 | Comfort-guarantee step: add a mattress protector in the mattress's size | §5 | 4 | Confirmed | REQ-CAT-007, CLR-010 | Offered only when a qualifying mattress is in the cart; protector variant matches the mattress size; accept adds the line; decline is recorded |
| REQ-PRE-003 | Haul-away and recycling step: choose old pieces to remove, up to the client's maximum; only for in-home delivery inside the delivery area | §5 | 5B | Pending approval | REQ-DEL-001, CLR-010, SD-01 | Offered only for an eligible ZIP and when the shopper chose in-home delivery in the step; quantity capped at the admin maximum in the UI and in every server action; revalidated before the checkout redirect; over-limit or mismatched orders created by other means are flagged (REQ-PROMO-003); line is "Recycle and disposal service" times pieces |
| REQ-PRE-004 | Accident-protection step: Extend coverage for each eligible item with price and coverage summary | §5, §6 | 5A | Assumed | REQ-EXT-001, REQ-EXT-002, Q-005, SD-08 | Each eligible cart item shows its coverage options; accept links coverage to that item; decline recorded |
| REQ-PRE-005 | A declined offer is recorded on the order for customer service | §5 | 4 | Confirmed | REQ-PRE-001 | After a decline, the order in Shopify admin shows which offers were declined (cart and order attributes); verified on a test order |
| REQ-PRE-006 | Offer eligibility and cart contents revalidated server-side before the checkout redirect | §5 | 4 | Assumed | REQ-PRE-001 | Tampered cart (orphaned add-on, over-limit haul-away, expired gift) is corrected or rejected before redirect; no client-supplied price is trusted; covered by unit and e2e tests |
| REQ-PROMO-001 | Gift with purchase implemented as Shopify discounts; gift line at $0 labelled with the promotion name | §5 | 4 | Confirmed | CLR-011, REQ-CART-002 | Cart shows gift at $0 with the promotion name and checkout total matches the cart total exactly |
| REQ-PROMO-002 | Bundle savings applied by Shopify discounts and shown as a discount on the bundle items | §5 | 4 | Confirmed | CLR-011 | Cart and checkout totals match; removing a bundle member removes the saving |
| REQ-PROMO-003 | Haul-away maximum enforced in layers before checkout with a detective control after the order (replaces the SOW's in-checkout Shopify Function; Functions in our own app need Plus) | §5 | 5B | Pending approval | Q-006, SD-01, V-17, V-18, V-26 | UI and server actions reject quantities above `haul_away_max`; revalidation corrects or rejects before hand-off; a Shopify Flow (or the webhook receiver) tags and notifies for any order whose haul-away quantity exceeds the maximum or whose delivery method is not in-home, proven on a development or paid Basic trial store (a development store is not plan-gated, so plan availability comes from Shopify's documentation and is checked on the client's store before go-live, V-26); if neither Flow nor the webhook can do it, a reconciliation report that staff run is the fallback; the limitation is documented and acknowledged by the client |
| REQ-POST-001 | Follow-up offer on the order confirmation (thank-you) page | §5 | 5B | Pending approval | Q-007, SD-03, V-19 | Either a client-chosen App Store thank-you app is installed and configured with the offer on the dev store, or the item is dropped by change request; we do not build our own extension on Basic |
| REQ-POST-002 | One-click offer between payment and the confirmation page, subject to Shopify enabling the feature | §5 | 5B | Pending approval | Q-007, SD-02, V-19 | Either a client-chosen App Store post-purchase app is installed and configured (Shopify access approval where required), or the item is dropped by change request; we do not build our own extension on Basic |

### Extend accident protection

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-EXT-001 | Live coverage options and prices from Extend's Offers API for each eligible product, fetched server-side | §6 | 5A | Assumed | Q-005, CLR-006 | Offers are requested with the documented `POST /offers` fields against the Extend demo host or the local mock and match for product, category and price; credentials are server-only; Extend downtime hides the offer; with the Extend feature flag off nothing Extend-related renders |
| REQ-EXT-002 | Chosen coverage added as an Extend line at the quoted price, linked to the covered item; not purchasable alone; quantity follows the covered item | §6 | 5A | Assumed | Q-005, REQ-CART-001, V-16 | Coverage is an Extend price-point variant whose price equals the quoted price (no match: the offer is hidden); it is added as a nested cart line under the covered line; removing the covered item removes coverage (Shopify behaviour, verified on the dev store); the child quantity follows the parent after every change; coverage cannot be added alone through the UI; orphan or mismatched coverage is detected by reconciliation |
| REQ-EXT-003 | Each order reported to Extend's Orders API; contract issued on fulfilment; refunds and cancellations update Extend | §6 | 5A | Assumed | Q-005, REQ-EXT-002, V-20 | Our webhook-driven sync sends a full-snapshot `PUT /orders` keyed by the Shopify order ID; fulfilment sets `fulfilledQuantity`; refund and cancel update Extend; replay is idempotent; the sync cross-checks that each coverage line's paid price equals the price of the plan ID in its attributes and that the covered product is in the order, flagging mismatches for staff instead of reporting them; every lifecycle step passes against the local mock and, when available, the Extend demo host; ownership of order sync (our sync versus Extend's Shopify app) is confirmed in writing before production |
| REQ-EXT-004 | Extend branding and a link to coverage terms on every offer; integration passes Extend's review | §6 | 5A | Blocked | Q-005 | Every offer surface shows Extend branding and the terms link; Extend's written approval is on file before go-live |
| REQ-EXT-005 | Coverage offered only for the client's list of eligible product categories | §6 | 5A | Assumed | CLR-018 | Products outside the list never show an offer; the list is editable in admin or configuration without a deploy |

### Checkout, delivery methods and payments

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-CHK-001 | Hand-off from cart and pre-checkout steps to Shopify's hosted checkout, preserving cart, discounts and signed-in identity | §5, §7 | 4 | Confirmed | REQ-PRE-006 | A cart (including add-on, gift and bundle lines) opens in Shopify checkout with identical lines and totals; signed-in customers are recognised |
| REQ-CHK-002 | Checkout styled with the client's logo, colours and fonts | §7 | 5B | Confirmed | G-2 | Checkout logo, background, colours and fonts are set in Shopify's checkout and accounts editor and visually match the brand kit (advanced branding is Plus only, SD-06) |
| REQ-CHK-003 | Delivery methods configured: white-glove in-home (zip list and fee rules, e.g. free above a threshold), store pickup (each store a pickup location with "ready for pickup" email), parcel shipping (carrier or flat rates) | §7 | 5B | Pending approval | REQ-DEL-001, CLR-009, REQ-LOC-002, SD-04 | Each method is offered or hidden exactly per its rule in a test order; fees and thresholds match client rules; in-home delivery is offered only when every item can ship from one stock location (F-28) |
| REQ-CHK-004 | Payment options configured, each subject to activation: cards, Shop Pay, Apple Pay, Google Pay, PayPal, Affirm | §7 | 5B | Blocked | CLR-007, Q-016 | Every activated option completes a test payment in a test environment; non-activated options are not shown |
| REQ-CHK-005 | Checkout features: discount codes, email marketing opt-in, express wallet and PayPal buttons; taxes per Shopify tax settings | §7 | 5B | Pending approval | CLR-004, SD-04 | Features present and working on test orders; tax calculation matches Shopify settings; where a chosen delivery method limits express wallet or PayPal buttons (for example Shopify local delivery, R-22) the behaviour is documented and approved by the client |
| REQ-CHK-006 | Customer emails styled in the client's brand: order confirmation, shipping, pickup-ready, refund | §7 | 5B | Confirmed | G-2 | Each email type sent to a test address renders correctly on desktop and mobile mail clients |

### Catalog and content

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-CAT-001 | Product sheet template and a validation report before import | §8 | 3A | Confirmed | CLR-014 | Template delivered; validator reports missing and invalid data per row with a clear message; no import runs on failing data |
| REQ-CAT-002 | Import of up to 400 products, one product per model with a variant per size, including SKUs, prices, sale prices, specifications and delivery type | §8 | 3A | Confirmed | REQ-CAT-001, G-1 | Import is idempotent (re-run does not duplicate); counts and a sampled field-by-field comparison match the sheet; sale price maps to compare-at pricing |
| REQ-CAT-003 | Images uploaded, ordered and given alt text | §8 | 3A | Confirmed | CLR-014 | Every product has ordered images with alt text; naming mismatches reported in the validation report |
| REQ-CAT-004 | Drafted descriptions, overview bullets, SEO titles and meta descriptions, for client approval | §8 | 3A | Confirmed | CLR-017 | Drafts exist for every product and are marked approved or not; only approved copy is published |
| REQ-CAT-005 | Rule-based collections and filters so new products sort themselves | §8 | 3A | Confirmed | REQ-CAT-002 | Adding a product with the right attributes places it in the right collections and filters with no manual step; the category structure is client-approved |
| REQ-CAT-006 | Brand data loaded: logos, about text, warranty terms | §8 | 3A | Confirmed | CLR-014 | Every brand has the three fields in Shopify and available to the storefront |
| REQ-CAT-007 | Add-on service products and offer rules configured: haul-away, comfort-guarantee protectors, matching protectors, pillows, bedding | §8 | 4 | Confirmed | CLR-010 | Service and add-on products exist with the configured rules and prices; changing a rule in admin changes the offer without a deploy |
| REQ-CAT-008 | Launch gift-with-purchase and bundle rules configured as Shopify discounts and offer placements | §8 | 4 | Confirmed | CLR-011 | Every launch rule is live in a test environment and verified end to end against REQ-PROMO-001 and REQ-PROMO-002 |
| REQ-CAT-009 | Re-runnable product import tool for the client | §8, §11 | 3A | Confirmed | REQ-CAT-001 | The client can edit the sheet and re-run the tool to update prices, sales and products; documented in the admin guide |

### Analytics and integrations

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-ANL-001 | Google Analytics (GA4) tracking of page views, ecommerce events and quiz events, subject to consent | §2, §4 | 7 | Confirmed | CLR-004, NFR-011 | Events appear in GA4 DebugView with correct parameters; nothing fires before consent where consent is required |
| REQ-ANL-002 | Meta tracking | §2 | 7 | Confirmed | CLR-004, NFR-011 | Standard events reach Meta's test tools; consent respected; no PII sent unhashed |
| REQ-ANL-003 | Klaviyo email and SMS signup forms (flows themselves are excluded) | §2, §4, §9 | 7 | Confirmed | CLR-004, Q-015 | Signup from the homepage and footer creates the profile in the right Klaviyo list with consent recorded; SMS consent text approved |
| REQ-ANL-004 | Live chat provider embedded and chat call-outs wired | §2, §4 | 7 | Assumed | CLR-005, Q-011, V-24 | Chat launcher loads on the chosen provider (default Shopify Inbox) behind an adapter without blocking rendering; call-outs open it; consent and CSP handled |
| REQ-SEO-001 | Search-engine basics: titles and meta from catalog copy, canonical URLs, sitemap and robots, structured data (Product, Breadcrumb, FAQ, LocalBusiness) | §8 | 7 | Assumed | REQ-CAT-004 | Sitemap and robots served; every indexable page has a unique title and description and a canonical; structured data validates; faceted URLs have a documented indexing policy |

### Hosting and deployment

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-HOST-001 | Staging site on our server during development, with an end-of-day change note and a weekly demo | §3, §11 | 1 | Confirmed | NFR-012 | A staging URL serves the latest main branch; a change note is delivered each working day; weekly demo is scheduled |
| REQ-HOST-002 | Option A go-live: Oxygen deployment, pipeline and environment settings, domain connected | §3 | 9 | Pending approval | Q-003, CLR-004 | Production serves from Oxygen on the client's domain; pipeline deploys from the client's repo; rollback rehearsed |
| REQ-HOST-003 | Option B go-live: hardened Linux server, Nginx, SSL, process manager, page caching, pipeline, staging site, uptime monitoring; Extend sync as a service | §3 | 9 | Pending approval | Q-003, CLR-003 | Production serves on the client's domain over valid TLS; process restarts on crash and reboot; monitoring alerts tested; Extend sync running as a service; rollback rehearsed |
| REQ-HOST-004 | Move from staging to the client's hosting at go-live and connect the client's domain | §3 | 9 | Pending approval | REQ-HOST-002 | Cutover runbook executed with zero lost orders; DNS and redirects verified; staging remains available |

### Handover and acceptance

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-HAND-001 | Source code in a GitHub repository owned by the client | §2, §11 | 9 | Pending approval | Q-014 | Repo is under the client's GitHub account, history intact, no secrets in history; client admins confirmed |
| REQ-HAND-002 | Product import tool and the completed product sheet handed over | §11 | 9 | Confirmed | REQ-CAT-009 | Client runs the tool from a clean checkout following the guide |
| REQ-HAND-003 | Written admin guide: products, promotions, offers, stores, homepage content | §11 | 9 | Confirmed | none | Guide covers the five areas with screenshots; a non-developer completes each task from the guide alone |
| REQ-HAND-004 | Training session for the client's team | §11 | 9 | Confirmed | REQ-HAND-003 | Session held; attendance and recording or notes archived |
| REQ-HAND-005 | Go-live support on launch day | §11 | 9 | Confirmed | REQ-HOST-004 | Named engineer on call for launch day; issues triaged using the SOW grading |
| REQ-ACPT-001 | Acceptance process: staging link, daily change note, weekly demo, one consolidated feedback round per page type in a single shared issue list, issues graded Blocker, Major or Minor | §11 | 8 | Confirmed | CLR-001 | Issue list exists with grading; each page type has one consolidated round recorded; grading follows the SOW table |
| REQ-ACPT-002 | A test order for every delivery method, add-on and payment type, then cancelled and refunded | §11 | 8 | Confirmed | REQ-CHK-003, REQ-CHK-004 | Evidence (order IDs, screenshots, Extend and Shopify records) for each combination; every test order cancelled and refunded |
| REQ-ACPT-003 | Go-live with zero open blockers; majors fixed or deferred by written agreement | §11 | 8 | Confirmed | REQ-ACPT-001 | Defect log shows no open Blocker; each open Major has a signed deferral |

### Governance

| ID | Requirement | SOW | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| REQ-GOV-001 | Platform capabilities the plan relies on (Shopify plan, Functions, post-purchase, parent line items, Extend headless model) are verified against official sources and recorded before dependent work starts | derived | 0 | Assumed | Q-002, Q-005 | [../research/TECH_FEASIBILITY.md](../research/TECH_FEASIBILITY.md) has no unverified item marked "relied on" for a phase that has started |

---

## Non-functional requirements

| ID | Requirement | Source | Phase | Status | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|
| NFR-001 | Mobile-first responsive layouts for mobile, tablet and desktop | §2, §4 | 2 | Confirmed | none | Every page type is designed at 360 px first and checked at 360, 768, 1280 and 1536 px; touch targets at least 44 px |
| NFR-002 | Performance budgets: fast page loads on mobile | §1 (fast store), §3 | 7 | Pending approval | Q-012 | Targets approved by the client (proposal: Core Web Vitals "good" at the 75th percentile on mobile for LCP 2.5 s, INP 200 ms, CLS 0.1; Lighthouse performance 85 or more on key templates) and met on staging |
| NFR-003 | Accessibility: the site is usable with keyboard and screen readers | §4 (accessibility page), derived | 7 | Pending approval | Q-012 | Proposal: WCAG 2.2 level AA on all templates; automated axe checks have zero serious or critical issues; manual keyboard and screen-reader pass recorded |
| NFR-004 | Security: no secrets or private tokens in browser code, validated inputs, verified webhook signatures, dependency hygiene | derived | 7 | Confirmed | none | [../security/THREAT_MODEL.md](../security/THREAT_MODEL.md) mitigations verified; security review has no open High findings; dependency audit clean or risk-accepted in writing |
| NFR-005 | Self-managed store: the client's team manages products, prices, promotions, offers, stores and homepage content in Shopify admin without developers | §1 | 6 | Confirmed | REQ-HAND-003 | A non-developer changes each content type in admin and sees it live; no content change requires a deploy |
| NFR-006 | The storefront holds no data of its own; Shopify is the system of record. State outside Shopify is limited to cookies and device storage | §2, §13 | 1 | Confirmed | none | Architecture review confirms no database in the storefront; Extend sync is stateless or reconstructible from Shopify and Extend |
| NFR-007 | No text, images, logos or trademarks from the reference site; only the client's brand and manufacturer-supplied assets | §1, §13 | 8 | Confirmed | none | Review of copy and assets finds no reference-site content; asset provenance recorded |
| NFR-008 | United States market, English, US dollars only; no multi-language or multi-currency scaffolding beyond what Hydrogen provides by default | §9, §13 | 2 | Confirmed | none | No locale or currency switcher; prices formatted in USD; i18n libraries are not added |
| NFR-009 | Supported browsers and devices defined and tested | §11 | 8 | Pending approval | Q-012 | A written matrix is approved; the e2e suite and a manual pass cover it |
| NFR-010 | Observability: errors and integration failures logged without personal data; uptime monitoring under Option B | derived, §3 | 7 | Assumed | REQ-HOST-003 | Integration failures (Extend, reviews, maps) produce structured logs with no PII; alerts configured for sync failures |
| NFR-011 | Privacy and consent: analytics, marketing pixels and SMS signup honour applicable US privacy rules and recorded consent | derived | 7 | Assumed | Q-012, Q-015 | Consent behaviour documented and approved; tracking tags are gated on it; privacy policy page matches actual data use |
| NFR-012 | Quality gates in CI: format, lint, type check, unit and e2e tests pass before merge and before any phase closes | derived | 1 | Confirmed | none | CI is green on main; a failing check blocks merge; local and CI commands are identical |
| NFR-013 | Graceful degradation: failure of Extend, reviews, maps, chat or analytics never blocks browsing, cart or checkout | derived | 5A | Confirmed | none | With each third party stubbed to fail or time out, product, cart and checkout hand-off still work (e2e) |

---

## Client responsibilities (SOW §10)

These gate delivery; the project "moves at the pace these items arrive". Status is *Open* until evidence is on file.

| ID | Item | Needed by phase | Blocks |
|---|---|---|---|
| CLR-001 | One named decision-maker who answers questions and feedback within 24 hours | 0 | all approvals (Q-013) |
| CLR-002 | Shopify store with staff access for our team | 0 | G-1; Phases 3A onward |
| CLR-003 | Hosting option chosen; for Option B a server or cloud account bought before go-live with administrator access | 1 (choice), 9 (account) | REQ-HOST-002, REQ-HOST-003 |
| CLR-004 | Access to the domain registrar, Klaviyo, Google Analytics and Meta | 7 | REQ-ANL-001 to REQ-ANL-003, REQ-HOST-004 |
| CLR-005 | Chosen reviews app and live-chat provider | 3B | REQ-PDP-005, REQ-ANL-004 |
| CLR-006 | Extend merchant account approved, with store ID | 5A | REQ-EXT-001 to REQ-EXT-004 |
| CLR-007 | Shopify Payments, PayPal and Affirm activated | 5B | REQ-CHK-004, REQ-CART-005 |
| CLR-008 | Store credit card programme details, if the client has one | 4 | REQ-CART-005 |
| CLR-009 | Delivery zip codes, fees and free-delivery threshold | 3A | REQ-DEL-001, REQ-CHK-003, REQ-CART-004 |
| CLR-010 | Haul-away price and maximum pieces; comfort-guarantee rules | 4 | REQ-PRE-002, REQ-PRE-003, REQ-CAT-007 |
| CLR-011 | Gift-with-purchase and bundle rules | 4 | REQ-PROMO-001, REQ-PROMO-002, REQ-CAT-008 |
| CLR-012 | Approval of the sleep quiz questions and recommendation rules | 6 | REQ-QZ-001 to REQ-QZ-004 |
| CLR-013 | Brand kit: logo, colours, fonts, lifestyle photography | 2 | G-2, REQ-NAV-001, REQ-CHK-002 |
| CLR-014 | Completed product sheet and manufacturer images for all products | 3A | REQ-CAT-001 to REQ-CAT-006 |
| CLR-015 | Store list with address, hours, phone and photo | 3A | REQ-LOC-002 |
| CLR-016 | Final text for the content pages | 6 | REQ-CNT-001 |
| CLR-017 | Approval of drafted product copy | 3A | REQ-CAT-004 |
| CLR-018 | List of product categories eligible for Extend coverage (SOW §6) | 5A | REQ-EXT-005 |

## Exclusions (SOW §9): do not build, do not promise

Anything below needs a written change request ([../../plans/BACKLOG.md](../../plans/BACKLOG.md) keeps a candidate list). Agents must raise a scope conflict rather than quietly implementing these.

| ID | Excluded |
|---|---|
| EXC-01 | Custom content inside Shopify's checkout steps (offers run on our pages before checkout) |
| EXC-02 | A custom-built checkout replacing Shopify's |
| EXC-03 | Automated email and SMS flows (abandoned cart, post-purchase, review requests); signup forms are included |
| EXC-04 | Online booking of delivery time windows |
| EXC-05 | Import of existing customer reviews |
| EXC-06 | ERP, POS or warehouse system integration |
| EXC-07 | A self-run warranty programme (Extend is the provider) |
| EXC-08 | An in-store sales or tablet app |
| EXC-09 | Static design mockups before build (design is built in the client's brand and reviewed on the preview site) |
| EXC-10 | Photography, video, and copywriting beyond the product copy in SOW §8 |
| EXC-11 | Multiple languages or currencies |
| EXC-12 | Third-party subscription and transaction fees (Shopify, apps, Extend, Affirm, payment processing, Option B server costs) |
| EXC-13 | Ongoing maintenance, hosting upkeep and new features after handover |

## Assumptions

| ID | Assumption | Source | State |
|---|---|---|---|
| ASM-01 | Catalog is up to 400 products; more by change request | §13 | Confirmed |
| ASM-02 | Shopify is the system of record for products, prices, inventory, customers and orders | §13 | Confirmed |
| ASM-03 | Extend, Affirm, Shopify Payments and Shopify's post-purchase offer feature are approved by those providers; dependent features go live once approved | §13 | Confirmed (approvals outstanding) |
| ASM-04 | The client holds the rights to all images and text it supplies | §13 | Confirmed |
| ASM-05 | The store sells in the United States, in English and US dollars | §13 | Confirmed |
| ASM-06 | The SOW attachment reviewed is the final version | derived | Confirmed (owner, 2026-10-12; the PDF is still to be placed in `source/`) |
| ASM-07 | The client's Shopify plan is **Basic**. Features that need Plus are replaced as set out in [BASIC_PLAN_WORKAROUNDS](../research/BASIC_PLAN_WORKAROUNDS.md) and [SOW_DEVIATIONS](SOW_DEVIATIONS.md) | owner | Confirmed (owner); client acknowledgement of the changes pending |
| ASM-08 | Design follows the layout and function of the reference site using the client's own brand, text and images; no Figma file is expected (SOW excludes mockups) | owner | Confirmed (owner, 2026-10-12) |
| ASM-09 | The delivery area is a **single zone** for now; more zones are a change request | owner | Confirmed (owner, 2026-10-12) |
| ASM-10 | Extend is implemented behind a feature flag against a local mock of its documented API; it goes live only with an approved client account and Extend's written answers | owner | Confirmed (owner, 2026-10-12) |
