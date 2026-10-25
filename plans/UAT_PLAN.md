# User acceptance testing (UAT) plan

Task P8-04 (preparation); used by P8-05 (rounds) and P8-06 (defect resolution). Requirements: REQ-ACPT-001, REQ-ACPT-002, REQ-ACPT-003. Source: SOW section 11 and [ACCEPTANCE_CRITERIA](ACCEPTANCE_CRITERIA.md); phase plan [phase-08](phases/phase-08-acceptance-and-uat.md). **Draft 1, dated 2026-10-26, branch `feat/remaining-scope-fast`.**

**Status: a plan. UAT has not started and cannot start today.** There is no staging URL (B-07), no client decision-maker named (Q-013, B-08), no development store holding a real catalog (B-26, B-27), and the client question pack has not been sent. Testing and QA are deferred by owner decision of 2026-10-26; this plan exists so the documents are ready when they run. No walkthrough below has been performed, so every "expected" line is the intended behaviour from the requirements, not an observed result. Tags: `[assumed]`, `[client input needed]`.

The issue list itself is `plans/UAT_ISSUES.md`, created by the project manager when UAT opens (phase plan P8-04); this plan defines its columns (section 5) but does not create it.

## 1. Purpose and principles

1. The client team tests each deliverable of SOW sections 4 to 8 on the supported browsers and devices and signs off against them (SOW section 11).
2. Feedback is collected as **one consolidated round per page type** in **one shared issue list**, graded Blocker, Major or Minor (REQ-ACPT-001).
3. The site goes live with **zero open Blockers**; Majors are fixed or deferred by written agreement; Minors may follow after go-live (REQ-ACPT-003).
4. UAT finds defects against what was agreed. New wishes are **change requests** (SOW section 11, `plans/BACKLOG.md`), not UAT issues.
5. A deviated item (SD-01 to SD-05, SD-07, SD-11 in [SOW_DEVIATIONS](../docs/requirements/SOW_DEVIATIONS.md)) is accepted against its **acknowledged wording**, not the SOW's. If the client has not acknowledged it, it is listed as "not yet agreed", never as delivered.
6. A feature waiting on a provider approval (Extend, Affirm, Shopify Payments, post-purchase) is reported as **not live, with the reason**, and is not faked or silently removed (SOW section 13). UAT checks only that its absence is honest.

## 2. Entry criteria (UAT does not open until all are true)

| # | Criterion | Evidence | Today |
|---|---|---|---|
| E-1 | Phase 2 to 7 gates passed | Gate records in DECISIONS | No gate passed |
| E-2 | A staging link exists, not indexed (robots and authentication), serving the release candidate, with a short change note each working day and a weekly demo (REQ-ACPT-001, REQ-HOST-001) | URL, notes archive | No staging (B-07) |
| E-3 | The client's real catalog and content are loaded; no CLR item outstanding for the page types in scope | CLR list; import record | Not supplied (B-15, B-26) |
| E-4 | Browser and device matrix approved (Q-012, NFR-009) | [RELEASE_TEST_PLAN](../docs/testing/RELEASE_TEST_PLAN.md) section 2 signed | Proposal only |
| E-5 | Full regression and the test-order matrix passed on the release candidate (P8-02, P8-03) | `progress/TEST_RESULTS.md` | Deferred by owner (2026-10-26) |
| E-6 | Payment methods activated in test mode (CLR-007); Extend sandbox approved or the feature declared not live | Provider confirmations | No |
| E-7 | A named client decision-maker who answers within 24 hours (SOW section 10) | Name, contact | None named |
| E-8 | Access in section 6 is in place | Checklist | No |
| E-9 | Walkthrough scripts in section 4 reviewed by the client once for clarity | Review note | No |
| E-10 | Known limitations list ready (release notes draft) so testers are not surprised by deliberate gaps | [RELEASE_NOTES_TEMPLATE](../docs/handover/RELEASE_NOTES_TEMPLATE.md) | Template only |

## 3. Scope by page type

Rounds follow this table, one consolidated round per row group. IDs refer to [TRACEABILITY](../docs/requirements/TRACEABILITY.md); confirm each against it before the round.

| Round | Page type | What the client checks | Main requirement IDs | Build state on 2026-10-26 |
|---|---|---|---|---|
| R1 | Home and global shell (header, footer, menus, promo bar, phone, guarantees, delivery ZIP in header, my store) | Sections show the client's content; links work; nothing invented shows; hidden items are hidden until the client's text exists | REQ-HOME-001, REQ-NAV-001 to 003, REQ-CNT-001 | Built on mocks; client text not supplied |
| R2 | Collections, brands, filters, search | Products sort into the right collections; filters (size, brand, comfort, type, price) and counts correct; search suggestions and results; sale prices crossed out | REQ-COL-001, REQ-COL-002, REQ-SRCH-001, REQ-SRCH-002 | Built on mocks; filters unverified on a store (V-04) |
| R3 | Product pages (size selector, price, gallery, specs, bullets, brand section, pickup availability, reviews slot, delivery promise, add-ons slot, protection panel) | Facts match the product sheet; sizes and prices correct; sale logic; copy approved; images and alt text | REQ-PDP-003 to 005, REQ-ADD-*, REQ-EXT-* | Built on mocks; pickup and reviews placeholders; Extend off |
| R4 | Compare and quiz | Compare shows the right attributes; quiz questions approved; answers recommend sensible products; results can be saved to the account | REQ-CMP-001, REQ-QZ-001 to 007 | Built on fixtures and a default quiz; the client has not approved the questions |
| R5 | Cart, offers and pre-checkout steps (gift, bundle, add-on, comfort-guarantee protector, haul-away, delivery choice, Extend protection) | Prices and discounts in the cart equal checkout; rules enforced; messages understandable; free-delivery progress | REQ-CART-*, REQ-PROMO-001/002, REQ-PRE-*, REQ-CHK-001 | Built on mocks and fakes; gift picker off until V-03; cart-equals-checkout unverified (B-25) |
| R6 | Delivery, checkout hand-off and payments | One delivery zone by ZIP; white-glove in-zone only; pickup; parcel; hand-off to Shopify's hosted checkout; payment types the client activated; emails | REQ-DEL-001, REQ-DEL-002, REQ-CHK-001 to 006 | Zone is developer-managed (OFFER_CONFIG_JSON); checkout never exercised (B-25) |
| R7 | Store locator and store pages | Addresses, hours (time zone), phone, photo, directions, pickup flag | REQ-LOC-001 to 003 | Built on sample stores; admin data path unverified |
| R8 | Account and order tracking | Sign-in (new customer accounts), orders, addresses; guest order tracking (60-day limit, SD-05) | REQ-ACC-001 to 003 | Built; never run against a store; SD-05 not acknowledged |
| R9 | Content pages, policies, blog, FAQs | The 15 pages and policies read correctly; links appear only when a page exists with text; privacy policy matches practice | REQ-CNT-001, REQ-CNT-002 | Layouts built; no store holds client text |
| R10 | Sign-up, consent, analytics, chat | Email signup and confirmation; consent banner and withdrawal; nothing fires before consent; chat call-outs | REQ-ANL-001 to 004, NFR-011 | Built on fakes; providers not connected; chat has no provider |

Cross-cutting checks (done inside each round): the supported browsers and devices; reading with larger text and on a small phone; keyboard use; no page asks for information it cannot use. The formal accessibility (WCAG 2.2 AA target, NFR-003, pending approval) and performance checks are qa-engineer work (P7-05, P7-06, P8-08), not a client task; the client reports anything that looks or feels wrong.

**Not tested by the client in UAT:** the test-order matrix (qa-engineer, P8-03; the client receives the evidence table), server hardening, security headers, DNS and cutover (CUTOVER_AND_DNS), the catalog import tool (its own handover check, REQ-HAND-002).

## 4. Walkthrough scripts

Each script is run by a client team member on one device, following the steps in order and writing what they see. Use only the synthetic accounts and addresses in section 6. Expected results come from the requirements and are not yet observed. If the real behaviour differs, raise an issue with the template in section 5.

**WT-01 Home and shell (R1)**
1. Open the staging link on a phone, then a laptop. Expect the logo, a search field, account and cart, and the main menu from your Shopify menu (or the fixed menu if none is set).
2. Open the menu; every link opens a real page (no "not found").
3. Read the promo bar and phone number: they are the ones you entered in Site settings; with none entered, nothing is shown.
4. Scroll the home page: sections appear in the order set in Shopify admin; each image and button works.
5. Footer: only links to pages that exist appear. Open each.
6. Enter a delivery ZIP in the header: inside your zone and outside it. The header and the message change correctly; reload and it is remembered.

**WT-02 Collections, brands, filters, search (R2)**
1. Open a size collection and a brand page. Product count and products match what you expect.
2. Apply a filter (comfort, then size, then price). Counts and results change; clear the filters.
3. Open a sale product: the sale price shows, the regular price is crossed out.
4. Search a product name, a brand, a misspelling, a nonsense word. Suggestions and results make sense; "no results" is clear.

**WT-03 Product page (R3)**
1. Open three products of different kinds (mattress, foundation or add-on, a sale item).
2. Check the name, brand, sizes, dimensions, prices, bullets and specifications against your product sheet. Report any difference as an issue with the sheet row.
3. Switch sizes: price, SKU-specific pictures and stock message update.
4. Open the gallery with the keyboard and with touch.
5. Check the delivery promise (in-zone or not) and the add-ons box.
6. If Extend protection is shown it must say it is a preview or not appear at all (Extend is not live until approved).

**WT-04 Compare and quiz (R4)**
1. Add two or three products to compare; open the comparison; remove one.
2. Take the quiz twice with different answers. Results differ sensibly; each result links to a product.
3. Sign in and save the result if offered; sign out and back in; it is still there.
4. Read every question and answer: are they the ones you approved?

**WT-05 Cart and offers (R5)**
1. Add a qualifying mattress. Check the free-delivery progress, the gift offer (if live), the add-on and protector offers.
2. Add and remove an offer; change quantity; swap a size. The cart total always matches what you expect.
3. Try to break a rule in the normal screens (haul-away more than the maximum; protection without its item). The site explains what to change.
4. Go to checkout and compare the totals, delivery and taxes with the cart. They must match (the client checks the total; qa-engineer proved the logic).

**WT-06 Delivery and checkout (R6)**
1. In-zone ZIP with a mattress: white-glove is offered. Out-of-zone ZIP: it is not, and parcel or pickup is offered for suitable items.
2. Choose store pickup for an item available at a store.
3. Reach Shopify's checkout; confirm your logo and colours; the payment methods shown are the ones activated (test mode). **Do not enter a real card.** Use the test card numbers the payment provider documents, only in test mode.
4. After a test order, check the order emails (confirmation, shipping, pickup-ready, refund) read correctly in the client's brand.

**WT-07 Stores (R7)**
1. Open the store list and each store page: address, hours, phone, photo. Hours match the store's actual hours and time zone.
2. Tap the phone and directions links on a phone.
3. Set "my store"; open a product and check pickup availability for that store.

**WT-08 Account and tracking (R8)**
1. Create a test account with a synthetic email; sign in; sign out.
2. View orders (after a test order), edit name and an address.
3. Guest tracking: use the order number and email of a test order. A wrong combination gives the same neutral message. Orders older than 60 days are not found (the acknowledged SD-05 limit).

**WT-09 Content pages (R9)**
1. Open each of the 15 pages in the content guide and the policies. Read for facts: delivery, financing, guarantee, warranty, FAQ, about, contact, size guide, comfort guide, types guide, adjustable-base guide, privacy, terms, accessibility.
2. Anything not yet approved must not be visible (check the link is absent as well as the page).
3. Open the blog listing and an article; use "load more".
4. Print one page.

**WT-10 Sign-up, consent, chat (R10)**
1. First visit in a private window: the consent banner appears when analytics is on; decline; browse; nothing loads. Accept; the choice is remembered; withdraw it from the footer.
2. Submit the email signup with an address you control; the confirmation message arrives (double opt-in). A second submission is handled politely.
3. If no chat provider is live there must be no chat link.

**WT-11 Everything on a small phone and a large text setting**
Repeat WT-01 and WT-05 on a phone with larger system text. Nothing is cut off; tap targets are comfortable; keyboard users can reach every control.

## 5. Issue list and grading

One shared list, `plans/UAT_ISSUES.md`. Every issue is one row; testers do not edit others' rows.

| Column | Content |
|---|---|
| ID | `UAT-<round>-<nn>` |
| Round and page type | R1 to R10 |
| Page or URL | staging address |
| Device, browser, version | per the matrix |
| What I did, what I expected, what happened | three short sentences, with a screenshot (no real customer data) |
| Proposed grade | tester's grade |
| Agreed grade | project-manager and decision-maker, after triage |
| Requirement or deliverable (SOW section) | for example "section 4, product pages" |
| Type | Defect, Wording, Change request, Question, Duplicate |
| Owner, status, fix commit, retest date and tester | updated by the team |
| Deferral reference | the signed note if a Major is deferred |

**Grading (SOW section 11).**

| Grade | Meaning | Before go-live | Examples |
|---|---|---|---|
| Blocker | Stops a shopper from finding, buying or paying | Must be fixed | Add to cart fails; checkout will not open; wrong price charged; the delivery ZIP blocks every order; site down on a common phone |
| Major | A listed deliverable does not work as described | Fixed, or deferred by written agreement | Filter returns wrong products; quiz result links broken; store hours wrong; offer does not apply |
| Minor | Cosmetic or wording | May be fixed after go-live | Spacing, a typo, an icon not centred |

Rules: when in doubt between two grades, the decision-maker and project manager choose the higher until evidence says otherwise; a Major that cannot be fixed before go-live is deferred only with a signed deferral (what, why, risk, fix date); a deviated SOW item graded against the acknowledged wording; a request for something not in the SOW is typed Change request and leaves the list for the backlog; Duplicate rows point to the first.

## 6. Access and materials the client needs

| Need | Detail | Who provides |
|---|---|---|
| Staging link | Not indexed; behind authentication; the credentials sent separately, never in the issue list | Owner (B-07) |
| Test accounts | Synthetic customer emails the client controls; no real customer data anywhere | Client and project manager |
| Test payment mode | Shopify Payments / PayPal / Affirm in test or sandbox mode per provider; the documented test card numbers only | Client activates (CLR-007) |
| Devices | The matrix's phones, tablet and laptop browsers; at least one iPhone and one Android phone (proposal) | Client team |
| Issue list access | Edit access limited to named testers | Project manager |
| Shopify admin access for the decision-maker | To view orders created by tests (read access is enough) | Client |
| Walkthrough scripts, this plan, the known-limitations list | Section 4; release notes draft | Us |
| Short training or briefing (30 minutes) | How to test, how to grade, how to log an issue | Us |
| A weekly demo slot and a daily change note | REQ-ACPT-001 | Us |

## 7. Consolidated feedback rounds

| Step | Rule |
|---|---|
| Order | Rounds R1 to R10 in the order of section 3, or in an order the decision-maker prefers; two rounds may run at once if different people test them |
| Open | The project manager announces the round, build version and scripts |
| Collect | Testers add rows. The decision-maker consolidates duplicates and conflicting opinions into **one** list for the page type and confirms it is final |
| Close | The round closes when the decision-maker sends the consolidated list (or after `<number>` working days, `[client input needed]`). Later findings on the same page type are logged for the next release or as a Blocker/Major if they meet the grade, not as a new round |
| Respond | Our triage within one working day `[assumed]`; each Blocker and Major gets an owner and a target |
| Fix and retest | Fixes go into a new build; the tester who found the issue retests; evidence recorded (P8-06) |
| Report | The weekly demo shows the list status |

Rounds, dates and decision-maker answers (SOW section 10: within 24 hours) are filled in below when UAT opens.

| Round | Opened | Closed | Issues | Blockers open | Majors open |
|---|---|---|---|---|---|
| R1 to R10 | `[to fill]` | `[to fill]` | | | |

## 8. Exit criteria

| # | Criterion | Evidence |
|---|---|---|
| X-1 | All rounds R1 to R10 closed with a consolidated list | Round table |
| X-2 | **Zero open Blockers** | Issue list |
| X-3 | Every open Major fixed or covered by a signed deferral | Deferral notes |
| X-4 | Minors scheduled (owner and date) | Issue list |
| X-5 | Regression and test-order evidence on the final build; accessibility and security re-checks without new High findings | TEST_RESULTS, review documents |
| X-6 | Every in-scope row of TRACEABILITY is `PASSING`, or has a signed deferral, or is declared not live with its reason (provider approval) | TRACEABILITY |
| X-7 | The client acknowledged each deviated item (SD-01 to SD-05, SD-07, SD-11) or the item is reported as not agreed | DECISIONS |
| X-8 | The asset provenance check is signed ([ASSET_PROVENANCE](../docs/handover/ASSET_PROVENANCE.md)) | Provenance list |
| X-9 | Release notes list what is live, what is not and why, residual risks | [RELEASE_NOTES_TEMPLATE](../docs/handover/RELEASE_NOTES_TEMPLATE.md) completed |

## 9. Sign-off template

| Field | Entry |
|---|---|
| Release candidate (tag, commit) | `[to fill]` |
| UAT period | `[to fill]` |
| Browsers and devices covered | `[to fill]` |

Acceptance against SOW sections 4 to 8 (built from TRACEABILITY; one row per in-scope requirement group):

| SOW section | Deliverable group | Result (Accepted / Accepted with deferral / Not live, reason / Not accepted) | Issue IDs or deferral reference |
|---|---|---|---|
| 4 | Storefront: home, collections, product pages, search, compare, quiz, store locator, account, content pages | `[to fill]` | |
| 5 | Cart, pre-checkout offers and upsells | `[to fill]` | |
| 6 | Accident protection (Extend) | `[to fill]` (live only once Extend approves) | |
| 7 | Checkout, delivery and payments | `[to fill]` | |
| 8 | Product catalog and content | `[to fill]` | |

Statements to sign:

1. Zero Blockers are open. `[to fill]`
2. The Majors deferred are listed above, each with a signed deferral. `[to fill]`
3. The deviated items accepted in their acknowledged wording are: `[to fill]`.
4. The features reported as not live, and why: `[to fill]`.
5. This acceptance does not include maintenance, hosting upkeep or new features after handover (EXC-13).

| | Name | Role | Date | Signature |
|---|---|---|---|---|
| Client decision-maker | `[client input needed]` | | | |
| Project owner | | | | |
| qa-engineer (evidence) | | | | |
| code-reviewer (release candidate diff) | | | | |
| security-engineer (final check) | | | | |

## 10. Risks to UAT

| Risk | Mitigation |
|---|---|
| UAT opens before the real catalog and text exist, so testers see placeholders | Entry criterion E-3; hidden-until-supplied rule (B-15) |
| Testers confuse deliberate gaps with defects | Known-limitations list (E-10) |
| Late findings reopen a closed page type | The close rule in section 7; changes become change requests |
| A tester uses a real card or real customer data | Test mode only; synthetic accounts; briefing |
| The decision-maker is unavailable | SOW section 10 (24 hours); escalate to the project owner |

## What this plan does not cover

The actual issue list; the QA regression and test-order execution (RELEASE_TEST_PLAN); launch (CUTOVER_AND_DNS); the content of any client text; accessibility certification (NFR-003 is a target pending approval, Q-012).
