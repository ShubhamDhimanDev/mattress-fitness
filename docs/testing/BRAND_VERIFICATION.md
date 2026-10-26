# Brand restyle verification (BA-10)

Task BA-10 of [BRAND_APPLICATION_SPEC](../design/BRAND_APPLICATION_SPEC.md) section 6. Run on 2026-10-22 by the QA engineer. Requirements touched: NFR-001, NFR-003, NFR-007, REQ-NAV-001, REQ-HOME-001, REQ-COL-001, REQ-PDP-001, REQ-CART-001. Run records: V-E105 to V-E111 in [TEST_RESULTS](../../progress/TEST_RESULTS.md).

## What state of the code was tested

(Sections 1 to 5 describe the first verification, on HEAD `0f1deae`, and are kept as the original record. The developer's fixes for BV-001 to BV-008 and BV-012 are **committed** (`f3e73f9`, with review notes in `2cd0931`) and were independently reviewed by the code-reviewer; section 6 is their first re-verification (taken on the working tree before the commit), and **section 7 is the re-run on the committed HEAD**, which is the result that counts.) Every run in sections 1 to 5 used **committed HEAD `0f1deae`** ("product page, cart and mobile menu in the brand style") served from git worktrees outside the repository (own dev servers, ports 6700 client dev store, 6710 and 6720 bedding.mock.shop; stopped and removed afterwards). The BEFORE state is commit `c758620` (before any brand work). While those runs were going, a developer was editing `storefront/app/` in the working tree (logo size, toast, cart summary, footer links, `ProductItem`, and more): none of those edits was under test then; they are the fixes that section 7 covers. The Playwright specs ran from the working tree's `tests/` folder (they touch no app code). Environment: Windows, Node 22.23, Chromium only (desktop 1280 x 800 and Pixel 7 emulation, phone viewport set to 360 where stated). WebKit, Firefox, real devices and assistive technology were **not** run.

New and changed test files (QA owned): `storefront/tests/e2e/brand-verification.spec.ts` (new, 62 tests at the time; 86 after round 3, section 7), `storefront/tests/e2e/helpers/ring.ts` (new: measures the painted focus ring, its contrast against the surrounding background, whether an ancestor clips it, and the reflow and uppercase checks). No app code, no docs/design file was edited.

## Results at a glance

| # | Check | Where | Result |
|---|---|---|---|
| 1 | Real-store spec `real-store.spec.ts`, restyled build | client dev store, desktop and mobile Chromium | run 1: **73 passed, 1 failed, 12 skipped**; run 2 (same server, unchanged): **74 passed, 0 failed, 12 skipped**. The one failure was "add to cart answered by Shopify" returning HTTP **500** while the dev server's worker logged `MiniOxygen: Error during evaluation: TypeError: fetch failed (read ECONNRESET)`; the test passed 6 of 6 alone and in run 2: classified **dev-server flake, not a restyle regression, not explained further**. 12 skips: 10 axe tests that run once by design, 2 checkout-total comparison tests (BLOCKED, below) |
| 1 | Does the store password still block checkout? | client dev store | **Yes.** Redirect chain, both runs, both projects: `302 localhost/checkout-steps`, `302 mattressfitness-1iakxuvz.myshopify.com/cart/c`, `200 .../checkouts/cn`, `200 .../password`. Nothing was typed. "Cart total equals checkout total" stays **BLOCKED** |
| 1 | RS-02 (subtotal shows "-" after add) re-checked | client dev store | **Fixed as designed:** the drawer now shows the text "Updating price" (no "-") for 173 to 495 ms, then `$193.00` (was about 1 s of "-") |
| 1 | RS-01 (offers config error per request) | client dev store | **Fixed:** the server log has one `offers.config_absent` info line and no error line |
| 1 | axe 360 and 1280, home, /collections/all, product, cart with item, **empty cart** | client dev store (`brand-verification.spec.ts`) | **0 violations of any impact** (critical 0, serious 0, moderate 0, minor 0, best practice 0) at both widths, plus cart drawer empty and with an item, mobile menu drawer (closed, section open) and mega menu, a collection with its filters open, search results, the dev gallery |
| 1b | Same axe set on bedding.mock.shop | `.env.bedding` | **0 / 0 / 0 / 0 / 0 on all 27 states**, including a product with sizes after changing size |
| 2 | Before and after screenshots | bedding.mock.shop, 360, 768, 1280, 1536 | 48 images captured (24 per state, no capture errors); defects below |
| 3 | Keyboard-only journey | desktop 1280 and phone 360 | passes except BV-001 to BV-003 (focus ring clipped); no trap; see below |
| 4 | Reflow 320 px and text spacing | bedding and client store | no horizontal scroll and no clipped text on the real pages; BV-004 (long single word in the hero headline) and BV-005 (single long vendor word, client store) |
| 5 | Whole store-agnostic suite | bedding.mock.shop | desktop complete; phone completed in two parts; **1 real regression (BV-012)**; see "Full suite" |

## 2. Visual comparison (screenshots)

Method: a small Playwright script (outside the repository) captured home, `/collections/all`, a product with sizes and colours, the cart drawer with one item, the cart page, and the open menu (the menu drawer at 360 and 768, the "Mattresses" mega menu at 1280 and 1536) at 360, 768, 1280 and 1536 px wide, with BEFORE served from a worktree of `c758620` and AFTER from `0f1deae`, both on bedding.mock.shop. Phone widths used mobile emulation, scrollbars hidden. Reduced motion was on so nothing was captured mid-animation. **The images are kept in the scratchpad folder, not in the repository** (they contain third-party demo product photos): `C:\Users\hp\AppData\Local\Temp\claude\c--zzz-shubham-MattressFitness\8de96906-2e7d-475d-ad96-8a728ce94eb7\scratchpad\img\{before,after}-{360,768,1280,1536}-{home,collection,product,cart-drawer,cart-page,menu-open}.png`, side-by-side strips in `...\scratchpad\side\`, focus-ring close-ups in `...\img\focus-*.png`. They may be deleted when the session's scratchpad is cleared; the script can regenerate them. I viewed the 360 pairs side by side and the 768, 1280 and 1536 after-images myself. **Hover states were not captured** (only focus, by keyboard); that part of the checklist is not covered.

What the restyle does as seen: teal and amber replaced by the logo red on white and light grey; logo disc in the header (56 px, 64 px from 1024) and footer (96 px below 768, 112 px from 768, from the `-256` file with a 512 px 2x source, as the spec's section 3 table says); promo bar absent (no admin text on these stores, as designed); grey utility bar; red search button; centred uppercase navigation with the amber "Find your mattress" pill; red hero with white and outlined buttons; filled red size tiles; hairline cards with a "Save n%" amber tag under the image and a rust sale price; selected size and colour in red with a check mark; red Add to cart and Checkout; light grey footer under a red rule; collapsible footer groups on a phone.

No clipping, overlap, unreadable text or wrong colour was found in the 24 AFTER captures apart from the items below. Dark text sits on light surfaces everywhere; white text only on red (5.08 : 1) and the dark category-tile overlay.

## 3. Keyboard-only journey (WCAG 2.1.1, 2.4.3, 2.4.7, 2.4.11, 1.4.11)

Specs: `brand-verification.spec.ts` "keyboard-only journey" (both projects). Tab walks run from the top of the page to the point where focus leaves the document; every stop is measured for a painted ring, ring colour against the surface behind it, clipping by an ancestor and covering by another element.

| Check | Result |
|---|---|
| Skip link | first stop, visible on screen, blue ring 6.63 : 1, Enter moves focus to `#main-content` (pass, both projects) |
| Tab walks: home 84 stops desktop / 54 phone, collection 89 / 47, all products 90 / 55, product 73 / 38, cart page with item 70 / 35, dev gallery 134 / 99 | **No keyboard trap** (focus left the page, or wrapped to the first stop, every time; see the note below on how "completed" is decided); order header, main, footer; no stop covered by another element; every stop has a painted ring. Rings that are not clipped: **blue `rgb(31,79,216)` on white 6.63 : 1, on the grey footer and utility bar 5.76 : 1**; red buttons carry the same blue ring drawn outside the button (crisp, seen in `focus-add-1280.png`, `focus-size-tile-1280.png`) |
| Red hero band and the other `on-dark` bands | yellow ring `rgb(255,203,71)`: **3.36 : 1 on the brand red** (passes 3 : 1 with a thin margin; seen in `focus-hero-button-1280.png`), 12.18 : 1 on black. The promo bar has no text on any test store, so its ring was measured **only on the dev gallery `/components`** (dev server only): yellow on red as above |
| Header search combobox | type, ArrowDown sets `aria-activedescendant`, ring stays on the field, Escape closes the list and keeps focus (pass) |
| Desktop mega menu | Enter opens, Tab reaches the first panel link with a ring, Escape closes and focus returns to the "Mattresses" button (pass) |
| Phone menu drawer | Enter opens, 25 Tab presses stay inside with a ring on every stop, Escape closes and focus returns to the Menu button (pass) |
| Journey | first product card link reached by Tab only, Enter opens the product; size selector: ArrowRight moves the selection and the ring stays (red fill plus check mark); Add to cart by Enter opens the drawer with focus inside; quantity increase by Enter changes it to 2 and focus stays on the button; 14 more Tab presses stay inside the drawer, every stop has a ring of 6.63 : 1 and none is clipped by the drawer; Checkout link has `href="/checkout-steps"` (not pressed); Escape closes the drawer and **focus returns to the Add to cart button** (pass) |
| Footer | desktop: last link ring 5.76 : 1 on the grey; phone: group button opens with Enter, first link in the opened group has a ring (pass) |
| Focus ring on cards and thumbnails | **FAIL, BV-001 and BV-002**: the ring is clipped by an ancestor with `overflow: hidden` and shows as two short vertical bars |

How a walk completes (helper rule, tightened in round 3): focus leaving the document, or **wrapping to the first stop**, completes the walk. Focus returning to any **other** stop already visited (A, B, C, then B) is reported as a keyboard trap and fails the test with the stop it returned to. The first round counted every repeat as complete, so a trap could have passed; the 2026-10-22 round 3 results use the strict rule. Guard tests build small pages in the browser (closed loop, trap, no end, split word, painted pixels) so the helper itself is proven to bite.

Test-quality note: in the first full phone run the "product" tab walk recorded 0 stops and still passed (an unhydrated first Tab); it now fails if fewer than 11 stops are reached, and passed again with 38 stops. Fixed in the spec, no app change.

## 4. Reflow at 320 px and text spacing (WCAG 1.4.10, 1.4.12)

Method: viewport 320 x 256 CSS px (400 percent of 1280 x 1024); the 1.4.12 override (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraphs 2em) at 360, 1280 and 320; also text that is wider than its own box in uppercase display type (a Range measurement), and an injected long word.

| Check | bedding.mock.shop | client dev store |
|---|---|---|
| 320 px, home, collection, product, cart with item, empty cart: no page scroll, nothing outside the viewport | pass (all five) | pass; "uppercase text wider than its box" flags the vendor line `MATTRESSFITNESS` by 6 px (inside the card padding, not visible): see BV-005 |
| Header, menu drawer with a section open, cart drawer with an item at 320 px | pass | not run separately (same components) |
| Text spacing at 360 and 1280, five templates: no clipped text, no new scroll | pass (10 of 10) | **fail on home at 360 and at 320**: the single-word vendor `MATTRESSFITNESS` runs 10 px past the card edge (BV-005); everything else passes |
| Long uppercase words at 320 px | collection title, section headings, footer headings, a long button label: fit. **Hero headline: fails (BV-004)**: `HYPOALLERGENIC` makes the page scroll sideways by 54 px, `ORTHOPAEDIC-RECOMMENDED` by 17 px; a 34-letter word by 467 px (report only). The collection `h1` is 6 px wider than its box for `HYPOALLERGENIC` but inside the viewport | same |

## 5. Defects

Grades follow the project scale. No Blocker. Two Majors (BV-001, BV-012, one root cause). All are in `storefront/app/`; QA did not change application code. **Status after the developer fixes (re-verified in section 6): BV-001 to BV-007 fixed, BV-008 mitigated, BV-012 cured; BV-009 to BV-011 are open designer decisions.** The table below is the original finding as reported on HEAD `0f1deae`. The BV-001 to BV-004 tests are ordinary tests that must pass (the temporary expected-failure markers are gone).

| ID | Grade | Route and state | Repro | Proposed fix | Owner |
|---|---|---|---|---|---|
| BV-001 | **Major** (WCAG 2.4.7, 1.4.11; the ring is partly present, so arguable as Minor) | every product card: home best sellers, `/collections/*`, `/collections/all`, search (`ProductItem`), at 360 to 1536 px | Tab to a card title link (or run `brand-verification.spec.ts -g BV-001`). The link sits inside `h3.line-clamp-3`, which is `overflow: hidden`, so the 3 px ring (offset 2 px) is cut off on the left, top and bottom: only two short blue bars at the right edge of the text are visible (`focus-card-1280.png`, `focus-card-360.png`; measured `clippedBy: h3.line-clamp-3 (left+top+bottom)` on all 8 to 12 cards per page). The restyle introduced the clamp (spec 5.5, UXD-22 item 5) | Draw the ring on the card instead: `has-[a:focus-visible]:outline outline-3 outline-offset-2` on the `article` (not clipped) and `focus-visible:outline-none` on the title link; or move the clamp to an inner span and give the `h3` `p-1 -m-1`. A change to `md:line-clamp-4` (seen in the working tree) does not fix it from 768 px up | shopify-hydrogen-developer (`ProductItem.tsx`) |
| BV-012 | **Major** (WCAG 1.4.12; regression of an existing guard test) | product card titles, home best sellers and `/collections/all`, 320 px with the text-spacing override | `npx playwright test design-rules -g "text spacing on product cards"`: **fails at HEAD `0f1deae`** (desktop `/` and `/collections/all`, phone `/` ; 7 titles of 8 on the home page have `scrollHeight > clientHeight`, the titles are cut off). The spec's own comment says the title "used to be clamped to three lines, which clipped real titles"; BA-07 put `line-clamp-3` back (`c758620` had no clamp). Same root cause as BV-001 | Remove the clamp from the `h3` below `lg` (or use `line-clamp-none` when spacing is wider), which also cures BV-001 on a phone. The uncommitted edit `md:line-clamp-4` removes the clamp below 768 px, so it should cure the 320 px case; re-run `design-rules` to confirm. Do **not** relax the test | shopify-hydrogen-developer (`ProductItem.tsx`) |
| BV-002 | Minor | product page gallery thumbnails (`ProductGallery.tsx`) | Tab to "Show image 1 of 3": `ul.flex gap-2 overflow-x-auto pb-1` clips the ring above and to the left (`focus-thumb-1280.png`) | `p-1.5` and `-m-1.5` on the `ul` (room for ring plus offset) | shopify-hydrogen-developer |
| BV-003 | Minor (latent) | `ui/Tabs` (only used in the dev gallery today) | Tab to a tab in `/components`: `div.flex overflow-x-auto border-b` clips the ring | same padding on the tab list before Tabs is used on a page | shopify-hydrogen-developer |
| BV-004 | Minor (content dependent) | home hero headline `h1` (`BannerSection`, `HomeSections` placeholder hero), 320 px and below | Set the hero title to a single word of 14 or more capitals (`HYPOALLERGENIC`): headline wider than the red frame (text 40 to 374 px in a 40 to 265 px box) and the page scrolls sideways by 54 px (WCAG 1.4.10) | `overflow-wrap: anywhere` (or `hyphens: auto` with `lang`) on `.type-display` and drop the hero to `text-3xl` below 360 px; the admin guide should say very long single words are not supported | shopify-hydrogen-developer / ui-ux-designer |
| BV-005 | Minor (data dependent) | home featured cards at 320 px with text spacing; client dev store (vendor is the single word `mattressfitness`) | 1.4.12 override at 320 or 360: the uppercase vendor line is wider than the card and crosses its border by up to 10 px (no clipping, no page scroll) | `break-words` (overflow-wrap) on the vendor line in `ProductItem` | shopify-hydrogen-developer |
| BV-006 | Minor | header at 768 px | The utility bar wraps to two lines (88 px; ZIP and store stacked at the left, links in the middle); the spec calls for a 44 px bar (5.2) | shorten or hide the dev placeholder phone text, or let the left group stay on one line (`flex-nowrap`, smaller gap) at `md`; check with the real phone number | shopify-hydrogen-developer |
| BV-007 | Minor | cart page (`/cart`) at 360 to 1536 px | The first line item starts directly under the "YOUR CART" title, and the list's top rule touches the product image and the summary card top; no space under the title | add `mt-4` to the lines region or `pb-4` to the title | shopify-hydrogen-developer |
| BV-008 | Minor (visual) | home featured cards and listing cards at 360 and 768 | Two-column cards are narrow: the vendor wraps to two lines, titles run to four lines, a sale price stacks "From / $265.00 / struck price" on three lines; equal-height cards leave a large blank between the title and the price when a neighbour has a tag | let the price line wrap as a flex row (`flex-wrap items-baseline`), `line-clamp` on the vendor, align price blocks with `mt-auto` only | ui-ux-designer |
| BV-009 | Observation | home category tiles | Photos sit under a 60 percent dark overlay and look muddy; at 360 a hyphenated name breaks as "SUN- / DRENCHED"; the fourth tile and the fourth size tile sit alone on their row (UXD-22 item 6) | designer's call; `hyphens: manual`, a lighter overlay with a text shadow | ui-ux-designer |
| BV-010 | Observation | product page | A 40 px gap between the "Size: Twin" legend and its grid (and the same for Color); the breadcrumb's current page drops to its own line at 360 with a dangling chevron (both existed before the restyle) | tighten the legend margin; hide the chevron after the last link when wrapped | shopify-hydrogen-developer |
| BV-011 | Observation | header and footer | The spec's text wordmark beside the logo (section 3, from 768 px) is not built; the disc's own lettering is about 6 px tall. The footer prints the tagline "Rest. Recover. Perform." as live text although Q4 (may the tagline be live text?) is still open | confirm with the owner or build the wordmark | ui-ux-designer |

Not defects, recorded so they are not rediscovered: the 15 px classic scrollbar at 360 and 1280 in a non-mobile Chromium narrows the layout viewport (measured `scrollWidth - clientWidth` is negative); the real store's `/password` page replaces checkout (the owner's setting); the client dev store has one product with one variant and no image, so sizes, gallery, filters groups, sale tags and the promo bar are exercised on bedding.mock.shop and the dev gallery only.

## Coverage gaps (not checked)

Hover states, pressed states, the Filters drawer's keyboard flow beyond axe, the promo bar on a real page (no admin text anywhere), WebKit and Firefox, screen readers, forced colours and 200 percent text-only zoom after the restyle, real device rendering, the checkout total comparison (password), performance after the restyle (Lighthouse not re-run), the cart "Add protection" row at 320 px (needs an Extend-eligible line; not present on bedding.mock.shop or on the flag-on dev server: skipped with a reason), a real product with five or more images (the end-of-strip test uses a cloned strip, see BV-014), phone-width (412 px) gallery strip, rings over images measured on painted pixels (the helper can do it and is guard-tested, but no real page had a ring over an image or gradient: 0 stops on all six walks, both projects).

**Accepted trade-off, not covered by a test (code-reviewer note, recorded 2026-10-22):** WCAG 1.4.12 (text spacing) at **768 px and up**. From 768 px the product-card title keeps `md:line-clamp-4` (UXD-28; below 768 px there is no clamp). With the 1.4.12 override (line height 1.5, letter spacing 0.12em, word spacing 0.16em) a title that needs more than four lines can lose its tail at those widths. The designer accepted the clamp as a layout trade-off; the text-spacing tests run at 320, 360 and 1280 px, `clippedContent` skips deliberate line clamps by design, and the 320 px card-title guard in `design-rules` runs where the clamp is off. So no test would notice a lost tail at 768 to 1279 px. If the client's accessibility target turns into a conformance claim, this needs a decision (drop the clamp, or raise it with the spacing override) or a recorded exception.

## How to re-run

```
cd storefront
# own server first: npm run dev -- --port 6710 --mode bedding   (client store: .env.demo)
E2E_PORT=6710 E2E_ENV_FILE=.env.bedding npx playwright test tests/e2e/brand-verification.spec.ts
E2E_REAL_STORE=1 E2E_PORT=6700 E2E_ENV_FILE=.env.demo npx playwright test tests/e2e/real-store.spec.ts tests/e2e/brand-verification.spec.ts
```

The axe, spacing and 320 px width checks run once, in the desktop project (they set their own width); everything else runs in both projects.

## Full suite on bedding.mock.shop (`.env.bedding`, HEAD `0f1deae`, Chromium only)

First run, `--workers=2`, all specs, desktop then phone: **killed by an external stop at 889 of 1082 tests** (the owner's no-idle-browser action; no summary line). Counted from the list output: desktop-chromium **393 ok** (5 of them were the expected-failure markers BV-001 to BV-004 reporting the defects as designed; the markers were removed when the defects were fixed), **141 skipped**, **2 failed** (both `design-rules` text spacing on product cards: BV-012); phone **242 ok, 100 skipped, 1 failed** (the same test) before the stop. The unrun part (phone: protection tail, quiz, real-store, resilience, search, seo-headers, shell, smoke, stores, visual) was then run alone with `--workers=1`: **91 passed, 109 skipped, 0 failed**. `design-rules` was re-run on the phone with one worker: 10 passed, 1 failed (`/` only; `/collections/all` passes on a phone). A single combined number for the whole suite does not exist; the parts above are what ran.

Skips are by design: the real-store spec without `E2E_REAL_STORE=1`, production-preview specs without `E2E_PROD_PREVIEW=1`, Extend specs without the flag, delivery specs without an offer config zone, desktop-only and phone-only tests. The progress record's last full-suite numbers (`progress/TEST_RESULTS.md`: 142 pass and 36 skipped for four spec groups, 2026-10-17) are not comparable in scope.

Classification: **restyle regression** = BV-012 (3 failures). **Flake** = none seen in these runs (the one real-store 500 was on the client's store, see the table). **Data** = none: every failure reproduced alone with one worker.

## 6. Re-verification of the developer fixes (2026-10-22)

**State tested:** the working tree over HEAD `42dfae0` (`ProductItem`, `ProductGallery`, `Tabs`, `UtilityBar`, `CartMain`, `BannerSection`, `HomeSections`, `tailwind.css`), served by one dev server on port 6710 against bedding.mock.shop (`.env.bedding`), Chromium only, `--workers=1`, one project at a time. The designer recorded the same changes as UXD-28 in `docs/design/DEVIATIONS.md`. WebKit, Firefox, real devices and assistive technology were **not** run. These changes are now committed (`f3e73f9`, `2cd0931`) and independently reviewed; the committed result is section 7.

| ID | Original grade | State now | Evidence |
|---|---|---|---|
| BV-001 card title ring clipped | Major | **Fixed** | `BV-001` test passes (desktop and phone): `clippedBy: null`, blue ring 6.63 : 1 on white, tab walks of home, collection, all products, product, cart and gallery report no clipped stop. The clamp now sits on an inner span of a block link |
| BV-002 gallery thumbnail ring clipped | Minor | **Fixed** | `BV-002` test passes, both projects |
| BV-003 `Tabs` ring clipped | Minor (latent) | **Fixed** | `BV-003` test passes (dev gallery `/components`), both projects |
| BV-004 long single word in the hero headline | Minor | **Fixed** | `BV-004` tests pass for `HYPOALLERGENIC` and `ORTHOPAEDIC-RECOMMENDED` at 320 px; no sideways scroll; the section heading, collection title and footer heading checks also pass. The 34-letter stress word is report-only |
| BV-005 vendor word crosses the card border | Minor | **Fixed** (the real-store spec was not re-run: the client dev store was not part of this round) | text-spacing and 320 px checks pass on bedding.mock.shop; the `break-words` change is on the vendor line. **Not re-checked on the client's dev store, where the defect was seen** |
| BV-006 utility bar wraps at 768 px | Minor | **Fixed, with a deviation** (below) | five new tests, widths 360, 768, 1023, 1024, 1280: the ZIP and store controls share one row and the bar is **44 px** high at every width (it was 88 px at 768) |
| BV-007 cart page: no space under the title | Minor | **Fixed** | `BV-007` test: gap between the title box and the first line list is **16 px** at 360 and at 1280 (threshold 12 px); also seen in the screenshots |
| BV-008 narrow cards | Minor (visual) | **Mitigated, not eliminated** | the sale price takes two rows at most in a card 151 px wide (360, home), 158 px (768, home), 313 px (360, listing: one column) and 219 px (768, listing), measured on the 2 to 3 sale products the store has. Seen in the screenshots: the vendor still wraps to two lines in the narrow cards (`CLOUDHAVEN / LINENS`), and equal-height cards leave a blank gap between a short title and the price when a neighbour has a longer one or a "Save" tag. The gap is the design (price aligned at the bottom); the owner or designer should say whether it is acceptable |
| BV-012 title clipped under text spacing | Major | **Cured** | the `design-rules` text-spacing test on product cards passes on desktop and phone (it failed three times on `0f1deae`). The test was not changed |
| BV-009 to BV-011 | Observation | **Open designer decisions** | untouched by this round |

**Screenshots for BV-007 and BV-008** (taken by a script outside the repository: third-party product photos): `C:\Users\hp\AppData\Local\Temp\claude\c--zzz-shubham-MattressFitness\8de96906-2e7d-475d-ad96-8a728ce94eb7\scratchpad\bvshots\` holds `after-cart-page-360.png`, `after-cart-page-1280.png` (the cart page: title, space, first line and summary card, no touching), `after-header-768.png` (one-line grey bar at 768 px: ZIP and store at the left, no links, menu button in the main row) and `after-cards-360.png`, `after-cards-768.png` (home best sellers, two and four columns, sale cards with the price on two rows). I looked at all five. They may disappear when the session scratchpad is cleared.

### Skip link: not a defect, the helper had two blind spots

`SkipLink.tsx` is a black pill (`bg-ink-900`) with a 4 px solid `ring-ink-900` box-shadow band around it and the global 3 px yellow outline (`rgb(255,203,71)`, offset 2 px) over it, on a `position: fixed` element. `helpers/ring.ts` had measured yellow against its **DOM ancestor background** (white), 1.51 : 1, ignoring (1) the band and (2) that a fixed link floats over the grey utility bar and the header, not over its parent. I read the **rendered pixels** before changing the helper (focused skip link, 1280 and 360 px, bedding.mock.shop, a one-off script in the scratchpad `skip-probe.cjs`). Left edge, going inwards from the link: grey `239,239,239` (surround), then 3 px of yellow, then 2 px of ink `20,20,20`, then the link. So the ring is 3 px wide, **2 px of it lies on the ink band** (yellow on ink 12.18 : 1) and **1 px on the surround**; the band is the outer edge of the indicator as a whole. Band against the surround: ink on grey 239 about 16 : 1, on white about 17.6 : 1, on the brand red of the logo behind the lower edge `222,4,16` about 3.6 : 1 (the worst surface found). Every boundary of the dark-and-light indicator is therefore at least 3 : 1 (WCAG 1.4.11 and 2.4.11, the two-colour ring pattern of technique C40). **The only part below 3 : 1 is the single outer pixel of yellow on grey (about 1.3 : 1), which sits directly beside a 16 : 1 band.** If the owner wants the whole ring on ink, the band would have to be `ring-[5px]` or more (a one-class change, optional, not required for the criterion).

The helper now (a) reads a solid, blur-free `box-shadow` whose spread is larger than the outline offset as a band under the ring and reports the **lower of ring vs band and band vs surround**, and (b) for a `position: fixed` control, samples what is actually painted just outside the ring on all four sides and uses the worst. Other controls are measured exactly as before. A new test, "the skip link contrast check bites", removes the band on the page and asserts the same ring then fails (< 3 : 1), so the rule cannot let anything through. Result for the real skip link: ring `rgb(255,203,71)`, band `rgb(20,20,20)`, contrast **12.18** (limited by yellow on ink), desktop and phone, both tests pass.

### BV-006 deviation (record in the deviations log; designer's UXD-28 says the same)

The right-hand utility links (track order, contact, chat, phone, find a store) now show from **1024 px, not 768 px**: they need about 870 px beside the ZIP and store controls. Between 768 and 1023 px they are only in the mobile menu, which always lists them, and the **menu button stays until 1024 px** (the full navigation also starts at 1024). `shell.spec.ts` (REQ-NAV-001) asserted this on the phone project only, which is 412 px wide, so it needed only its comment changed ("below 1024 px"). The width boundary is now tested at 1023 and 1024.

### Runs of this round (V-E112 to V-E120 in [TEST_RESULTS](../../progress/TEST_RESULTS.md))

All on bedding.mock.shop, 0 failures after classification; skips are by design (width-setting tests run once, phone-only or desktop-only tests, opt-in pixel snapshots).

| Project | Specs | Result |
|---|---|---|
| desktop | shell, cart, home, catalog (product), design-rules | 89 passed, 10 skipped, 0 failed |
| desktop | brand-verification (73 tests) | final full run: 71 passed, **2 failed, both timeouts (flake)**, then the two re-run 3 times each: 6 of 6 passed. An earlier full run had 72 passed, 1 failed: **test needed an update** (below) |
| desktop | gallery, search, visual | 67 passed, 8 skipped, 0 failed |
| desktop | a11y-audit | 113 passed, 2 skipped, 0 failed |
| phone | shell, cart, home, catalog, design-rules | 72 passed, 27 skipped, 0 failed |
| phone | brand-verification, gallery, search, visual | 83 passed, 65 skipped, 0 failed (the BV-006 to BV-008 width tests are desktop-only by design) |
| phone | a11y-audit | 114 passed, 1 skipped, 0 failed |

Failure classification:

- **Test needed an update (not a product regression):** axe reported `color-contrast` white on `#e7464e`, 3.9 : 1, on the "Show results" button in the Filters drawer at 360 px, five times in a row. The colour is the brand red blended with white: the drawer was still fading in when axe ran (`toBeVisible` passes on the first frame). The settled button passes (the earlier runs, and the probe after 600 ms, show 0 violations). The audit now waits for finite animations to finish (`settle`) before axe and its failure message lists the violation detail. Nothing was skipped or relaxed: the same zero-violation check runs, on the state the user sees.
- **Flake (infrastructure):** in the final desktop run, "collection (cards) @1280" hit a 180 s `networkidle` wait (the remote demo store kept a request open) and "cart page with an item @1280" never saw the cart drawer subtotal; both passed 3 of 3 when re-run alone and in the two earlier full runs. Not explained further. They are not quarantined; they will be recorded again if they recur.
- **Specs asserting the old 768 px breakpoint:** only `shell.spec.ts` line 181 (a comment; the assertion is phone-only). Updated.
- **Regressions:** none seen. **Data:** none.

Not run this round: the client dev store (`real-store.spec.ts`), the other specs of the suite (compare, quiz, stores, protection, delivery, resilience, seo-headers, brands, pickers, lazy panels), WebKit and Firefox, Lighthouse, hover states.

## 7. Round 3: committed HEAD, stricter helpers, two new findings (2026-10-22)

**State tested:** committed HEAD `2941969` (its `storefront/app/` is the same as `2cd0931`, which holds the BV fixes; `git status` showed no change under `app/` before and after the runs; the only working-tree changes were the QA test files). Tests ran from the working tree: `brand-verification.spec.ts` and `helpers/ring.ts` carry the round 3 edits below. bedding.mock.shop (`.env.bedding`, port 6710), Chromium only, `--workers=1`, one project at a time, one tab at a time, no Playwright MCP. Run records: V-E126 to V-E135 in [TEST_RESULTS](../../progress/TEST_RESULTS.md).

**Test-side changes (code-reviewer notes on `4655f77`):**

| Note | Change |
|---|---|
| walkRings counted every repeat as complete | `completed` now means focus left the document or wrapped to the **first** stop; any other repeat sets `trap` (which stop it returned to) and fails the walk. Four guard tests on minimal pages (leaves, wraps to first, returns to a later stop, hits `max`) |
| band rule too permissive | a box-shadow counts as a band only when its spread is at least offset + width - 1 (4 px for the 2 px offset and 3 px ring) and it is opaque; otherwise the ring is judged against the surround. "The skip link contrast check bites" now has three cases: no band, a pale 4 px band (read as a band, still below 3 : 1) and a 2 px ink band (not a band, below 3 : 1) |
| rings over images excused without counting | stops over a gradient or image are counted and annotated on every tab walk, the walk fails above 2 per page, and their ring is judged on **painted pixels** (viewport screenshot read back on a canvas, three 5 x 5 blocks per side, worst block); the same is done for a fixed control with no band. Guard test for the sampler. Result: **0 stops over images on all six walks, both projects**, so the sampler had nothing to judge on these pages |
| BV-006 reachability | at 360, 768 and 1023 px the Menu button must be visible and, opened, list Track order, Contact us, Chat with us and the phone link in the "Help and contact" navigation; at 1024 and 1280 px the Menu button must be hidden. New cases: a saved ZIP text and a 31-character store name at 1023 and 1024 px |
| vacuous passes | BV-001, BV-002, BV-003, BV-008 and the dev gallery tests now use `test.skip` with the reason when the data or page is missing (no card, one image, `/components` not served, zero sale cards) instead of returning a pass |
| BV-002 end of strip, 320 px words | new: the LAST thumbnail's ring of a strip of 5 or more thumbnails at 360 px (a real product when the store has one, else the strip is cloned to six: annotated "synthetic"); new: the discount "Apply" button does not break inside a word at 320 px (per-word Range measurement, guard-tested); new: the same for the cart "Add protection" row (skips with a reason when the row is absent: it was absent on bedding.mock.shop and on the flag-on dev server) |

**Results on bedding.mock.shop:**

| Project | Specs | Result |
|---|---|---|
| desktop | brand-verification, design-rules, shell, gallery, cart, home, catalog, a11y-audit | **320 passed, 13 skipped, 2 failed** (18.7 min). brand-verification alone: 83 passed, 1 skipped, 2 failed |
| phone | the same eight specs | **257 passed, 78 skipped, 0 failed** (14.7 min). brand-verification alone: 38 passed, 48 skipped (width-setting tests run once, in the desktop project) |

Classification of the 2 failures: both are **new product findings, not flakes and not test errors**; BV-013 failed in 2 of 2 runs (the first full spec run and the committed-HEAD run) and BV-014 in 3 of 3 (an exploratory probe, a targeted run and the full run), always with the same numbers:

| ID | Grade | Route and state | Evidence | Proposed fix | Owner |
|---|---|---|---|---|---|
| BV-013 | Minor | utility bar at **1024 px** when the shopper has a saved ZIP and a real-length store name ("My store: Wrenfield Sleep Gallery Buffalo", a 31-character name from the store fixtures) | the bar wraps to two rows (88 px, store link on the second row, `zipBox.y = 0`, `storeBox.y = 44`). Default texts fit (44 px), and 1023 px passes with the long texts (the links are not shown below 1024). The BV-006 fix fits the default texts only | let the store name truncate on one row (`min-w-0 max-w-*` plus `truncate` on its own flex item with `flex-nowrap` in the left group), or show the right-hand links from `xl` | shopify-hydrogen-developer (`UtilityBar`, `StoreSelectorLink`) |
| BV-014 | **Major** (WCAG 1.4.10 reflow; common data: any product with five or more images) | product page at **360 px** (and 412 px with six or more) | the gallery `section` is a grid item with `min-width: auto`, and the thumbnail strip's intrinsic width (5 x 64 px + gaps + padding) widens the column: with the strip cloned to 6 thumbnails the section is 424 px wide in a 328 px column and the **page scrolls sideways by 86 px** (`scrollWidth` 447 against 360). The strip never scrolls inside its own box, so the end-of-strip ring cannot be clipped but the page overflows. **Proved by a one-style probe: `min-width: 0` on the gallery `section` gives page `scrollWidth` 360 and a 340 px strip that scrolls.** The bedding.mock.shop products have 3 images, so the evidence is the same DOM with cloned thumbnails: **confirm with a real five-image product on the client's store** | add `min-w-0` to the `section` in `ProductGallery.tsx` (or to the grid child in `products.$handle.tsx`) | shopify-hydrogen-developer |

The test for BV-014 (`BV-002 the focus ring of the LAST thumbnail ...`) stayed red until the fix (status in section 8); it was not skipped or weakened. The 13 desktop skips and 78 phone skips are by design (phone-only or desktop-only tests, width-setting tests that run once, the axe tests that run once, shell ZIP-zone tests without a delivery zone, the first product has one size for the cart size swap, the gallery's hover tests on a phone, no Add protection row).

**Client dev store (`.env.demo`, port 6700, `E2E_REAL_STORE=1`, never read; the password page was never filled):** `real-store.spec.ts` desktop **42 passed, 1 skipped, 0 failed** (2.7 min), phone **32 passed, 11 skipped, 0 failed** (2.1 min); the skips are the 10 axe tests that run once and the cart-total-equals-checkout-total test, which stays **BLOCKED** (the checkout chain ends on the store's `/password` page, as before). BV-005 re-checked on the client's store (vendor `mattressfitness` as one word): the text-spacing (360 and 1280), 320 px and 320 px with spacing tests of brand-verification, **17 passed, 0 failed**, so **BV-005 is confirmed fixed on the store where it was seen**.

Not run in round 3: the rest of the suite (compare, quiz, stores, protection, delivery, resilience, seo-headers, brands, pickers, lazy panels, search, visual), the brand-verification axe and keyboard walks on the client store, WebKit, Firefox, Lighthouse, hover states.

## 8. Round 4: BV-013 and BV-014 fixed (2026-10-22)

**State tested:** committed HEAD `8c21887` ("gallery no longer widens the page with 5+ thumbnails; utility bar keeps one row with a long store name": `ProductGallery.tsx`, `ProductBuyBox.tsx`, `UtilityBar.tsx`, `StoreSelectorLink.tsx`, `DeliveryZipControl.tsx`); no change under `app/` in the working tree. The two tests that failed in round 3 were not edited. Same browser rules (one worker, one project at a time, no MCP). Run records: V-E136 to V-E142 in [TEST_RESULTS](../../progress/TEST_RESULTS.md).

| ID | Status | Evidence |
|---|---|---|
| BV-013 utility bar wraps at 1024 px with a long store name and a saved ZIP | **Fixed** | both long-text tests pass (1023 and 1024 px): at 1024 px the bar is **44 px**, ZIP and store on one row (y 0 and 0), the store link is 242 px wide (it was 305 px and on row two); also passes on the client dev store |
| BV-014 gallery widens the product column, page scrolls sideways with 5+ thumbnails | **Fixed (synthetic evidence)** | the end-of-strip test passes: with the strip cloned to six thumbnails at 360 px the page no longer scrolls sideways, the strip scrolls inside its own box, and the last thumbnail's ring is not clipped (6.63 : 1, `clippedBy` null). **Still synthetic**: no bedding.mock.shop or client-store product has five images, so the clone stands in for one. Confirm with a real product of five or more images when the client's catalog is loaded |

**Results on bedding.mock.shop:** desktop-chromium (brand-verification, design-rules, gallery, shell, a11y-audit) **291 passed, 12 skipped, 0 failed** (17.4 min; brand-verification 85/1/0, design-rules 9/2/0, gallery 35/0/0, shell 49/7/0, a11y-audit 113/2/0). Phone (same five specs) **226 passed, 77 skipped, 0 failed** (13.3 min; brand-verification 38/48/0, design-rules 11/0/0, gallery 33/2/0, shell 30/26/0, a11y-audit 114/1/0). The single desktop brand-verification skip is the cart "Add protection" row (no such row on this store).

**Client dev store (`.env.demo`, never read; password page never filled):** `real-store.spec.ts` desktop **42 passed, 1 skipped, 0 failed**, phone **32 passed, 11 skipped, 0 failed** (same skips as before: once-only axe tests and the BLOCKED cart-total comparison). The first desktop attempt did not start: the dev server for that store did not answer within the 240 s start-up timeout (a Shopify `HeadersTimeoutError` in the server log), so no test ran; the same command passed on the second attempt. Classified **infrastructure flake, no test result**. The BV-014 check cannot run for real on the client store: its one product has no image, so the end-of-strip test skips with its reason there (the BV-006 long-text tests passed on it: bar 44 px at 1023 and 1024 px).

**Helper change:** `walkTabOrder` in `helpers/a11y.ts` (used by the `a11y-audit` tab walks) now applies the same rule as `walkRings`: a repeat completes the walk only when it is the wrap-around to the first stop; any other repeat sets `trap` and the audit asserts it is null. All 9 `a11y-audit` tab walks still pass on desktop and phone.

## Rule note

After the first long runs the owner restricted browser use: later work used one worker, one project at a time, one dev server on port 6710, and the process list showed no `chrome-headless-shell` afterwards.
