# Training outline for the client's team

Deliverable H-04 (task P9-09; requirement REQ-HAND-004: a session held, attendance and a recording or notes archived). **Draft 1, dated 2026-10-26.** Built on [ADMIN_GUIDE](ADMIN_GUIDE.md), [CONTENT_PAGES](CONTENT_PAGES.md), [CATALOG_IMPORT_GUIDE](CATALOG_IMPORT_GUIDE.md), [RUNBOOKS](RUNBOOKS.md) and [ACCESS_INVENTORY](ACCESS_INVENTORY.md). **No date, time, trainer or attendee is fixed**: all are `[to fill]` or `[client input needed]`. Nothing here has been delivered or rehearsed, and the guides it teaches from have not been tested by a non-developer (REQ-HAND-003's acceptance test), so the first training run doubles as that test and every stumble is recorded as a guide defect.

## 1. Principles

1. **Teach on a development or staging store with synthetic data, never on the live store.** No real customer data in any exercise.
2. **Teach what is true on the day.** The admin guide marks items `BUILT, AWAITING DEV-STORE VERIFICATION`, `NOT CONNECTED YET`, `DEVELOPER-MANAGED`, `PLANNED`. Before the session the trainer re-reads those tags against the release notes ([RELEASE_NOTES_TEMPLATE](RELEASE_NOTES_TEMPLATE.md)) and updates the slides. On 2026-10-26 the following were **not** self-service: offer rules, the haul-away maximum and the delivery ZIP list (a developer edits `OFFER_CONFIG_JSON`); the quiz may still read built-in sample data; Extend protection, chat, post-purchase offers and Affirm are not live.
3. Each topic is **show, then do**: the trainee performs the task from the written guide, not from the trainer's memory. The guide is the test subject.
4. Say what the trainee should **not** do (the "Please do not change these" list, ADMIN_GUIDE section 1) before they touch anything.
5. Say who to call (ADMIN_GUIDE "Who to call"; the names are filled at handover, `[client input needed]`/`[to fill]`), and that after launch-day support, maintenance, hosting upkeep and new features are separate (EXC-13).

## 2. Audiences and format

| Group | Who | Sessions | Format |
|---|---|---|---|
| A. Store managers and merchandisers | Products, prices, sales, collections, homepage, menus, the store's contact details, quiz | 1 to 5 | Live (screen share or in person), hands-on, `[assumed]` 3 to 4 hours in total, over one or two sittings |
| B. Customer service | Order tracking page, privacy choices, troubleshooting, what is not live | 1, 6 | Live, 60 minutes `[assumed]` |
| C. Content writers | The 15 pages, policies, blog, SEO fields | 5 | Live, 60 minutes `[assumed]` |
| D. Technical contact (client's developer or maintenance provider, if any) | Deploy, rollback, rotate a secret, failed sync, catalog import setup | 7 | Live, 90 minutes `[assumed]`, separate |

Durations are planning guesses, not measured. Record the session (with the attendees' agreement) or keep written notes; archive under the handover pack (REQ-HAND-004). Attendees and their roles: `[client input needed]`.

## 3. Before the session (trainer checklist)

| # | Item | Source |
|---|---|---|
| 1 | A training store (development store) with: synthetic products with sizes and images, a collection, brand entries, a homepage section set, a menu, a Site settings entry, two test pages and a policy, a `journal` blog with one article, a test discount | B-26, OFFER_SETUP_DEVSTORE |
| 2 | Staff logins on that store for every attendee (no shared logins), with only the permissions the real role needs `[client input needed]` | ADMIN_GUIDE "Read this first" |
| 3 | The catalog tool installed on the trainee's machine (Node 22) with the sample sheet; for exercises that touch a store, a developer sets the allow-list and token in the trainee's shell (never typed into a command) | CATALOG_IMPORT_GUIDE sections 1 and 7 |
| 4 | Printed or shared copies of the guides, the sheet template and the sample images | |
| 5 | The current release notes, with what is live and not live | RELEASE_NOTES_TEMPLATE |
| 6 | An attendance sheet and the recording consent | section 9 |
| 7 | A guide defect log (where trainees write what was unclear) | section 9 |

## 4. Agenda

### Session 1. Orientation: how the store is put together (30 minutes, groups A and B)

Content: Shopify is the source of truth; the website reads it; most edits show after a cache delay (ADMIN_GUIDE section 10.2: listings about 6 minutes after a price change, navigation menus about an hour; confirm the figures against the guide on the day). Where things live in Shopify admin (section 1): products, collections, metaobjects, discounts, menus, pages. What is live, what is waiting, what a developer still does (the status table at the top of the guide). The "do not change" list. Who to call and how to grade a problem (Blocker, Major, Minor).

Exercise 1: find, in admin, a product, a collection, the Site settings entry, a menu, a page, a discount. Find the same product on the website.

Check: the trainee can say where to change a price, a homepage section and the phone number, and which three things are not theirs to change.

### Session 2. Products, prices and sales (60 to 75 minutes, group A)

Content, from ADMIN_GUIDE section 2 and CATALOG_IMPORT_GUIDE:
- choose one method per change (admin or sheet);
- change a price; start and end a sale (sale price crossed out);
- add a product in admin (title, sizes, SKUs, images, brand, metafields);
- take a product off the site (Draft or Archived; do not delete sold products);
- service, gift and protection products and the `offer-only` / `extend-coverage` tags (section 2.8);
- the sheet and the import tool: columns, validate, preview, run for one product, keep the run record, rerun to see `unchanged`, what `BLOCKED` means, no automatic undo.

Exercises:
- 2a. Change one price and one sale price in admin; find them on the website after the cache delay.
- 2b. Fix the errors in `scripts/catalog/sample/invalid.csv` using the validator's messages until it passes.
- 2c. Run the offline preview on `mattresses.csv`; read the plan; explain `CREATE`, `UPDATE`, `unchanged`, `BLOCKED`.
- 2d. (With a developer present, development store only) Live import of one product with `--only`; check it in admin; rerun and see `unchanged`; end its sale by emptying `sale_price` and preview the change.
- 2e. Tag a test product `offer-only` and explain what changes for search engines.

Check: the trainee completes 2b and 2c alone from the written guide.

Honest limit to say aloud: the importer has not been run against the real store; the first live run happens with a developer (CATALOG_IMPORT_GUIDE "Read this first").

### Session 3. Promotions, offers and delivery (45 to 60 minutes, group A)

Content (ADMIN_GUIDE sections 3, 4, 8, 9): how a gift or bundle discount works and the 25-discount limit; create and end a promotion; check that the cart equals checkout; if they differ, what to do (3.7). Add-on offers, the comfort-guarantee protector and matching add-ons: what the client's team changes in admin, and what a developer changes. The single delivery zone: why it is kept in two places, how to give the developer a new ZIP list, the 3,000-character limit, fee and free delivery, what shoppers will notice. Extend: not live; what staff will do once it is (section 9).

Exercises:
- 3a. Create a test "buy a mattress, get a pillow" style discount on the training store; add a qualifying cart; compare cart and checkout totals; end the discount.
- 3b. Read the free-delivery and haul-away messages in the cart with an in-zone and an out-of-zone ZIP.
- 3c. Write the change request message to the developer for adding five ZIP codes (what to send, what to expect).

Check: the trainee can state which of these they can change themselves today (discounts) and which need a developer (offer rules, zone, haul-away maximum, until P4-12 lands).

### Session 4. Your store's details, homepage, menus and the quiz (60 minutes, group A)

Content (ADMIN_GUIDE sections 5, 6, 7): where the one store's address, hours and phone are edited (Contact page, Settings > Policies, the support phone field); homepage sections and promo tiles; collection FAQs; promo bar and phone number; brands; menus (handle, nesting, tag-filtered items); the quiz: edit a question, an answer and its scoring, what a bad mapping does, test the quiz after an edit. Use the tags on the day: the quiz may still be `NOT CONNECTED YET`; teach only what is connected, and say so for the rest.

Exercises:
- 4a. Edit one homepage section; reorder two; see the result.
- 4b. Create a menu with one nested item; ask the developer to set the handle; see the header change.
- 4c. Add the phone number in Site settings; confirm the link appears and that with the field empty no link shows.
- 4d. Edit the address and hours text on the Contact page and see the change after the cache delay.
- 4e. (If connected) change one answer's weight; retake the quiz; confirm the change; undo it.

Check: the trainee finds the "do not change" fields and says how long a change takes to show.

### Session 5. Content pages, policies, blog and SEO (60 minutes, groups A and C)

Content (CONTENT_PAGES): the 15 pages at a glance; create a page; the one rule (a link shows only when the page exists with text; keep unapproved pages hidden or empty); the approval step moves into Shopify admin; policies and where privacy and terms live (Settings > Policies, one copy); take a page down quickly; SEO fields; the pre-publish checklist; preview; the blog (listing, articles, load more).

Exercises:
- 5a. Create a test page with headings; see the contents list, the footer link and the SEO fields; take it down and watch the link disappear.
- 5b. Write a FAQ page with two question headings and see the structured data behaviour as described in the guide.
- 5c. Walk the pre-publish checklist on the page.
- 5d. Publish a test article in the `journal` blog.

Check: the trainee can explain why a page with text appears in the footer by itself and what the approval consequence is (CLR-016: promise pages need approval before they have text).

### Session 6. Customer service topics and troubleshooting (45 minutes, group B, plus anyone)

Content (ADMIN_GUIDE sections 10 to 13): order tracking page for guests (what shoppers see, the 60-day limit, what staff do; only if it has been switched on after verification and the client acknowledged SD-05); the privacy choices link and the consent banner (only when an analytics id is set; your lawyer decides the mode); troubleshooting: where to look first, what is cached and for how long, how to tell a data problem from a site problem; what to send the developer (page address, time, device, what you expected, screenshot without customer data). What is not live and why (release notes).

Exercises:
- 6a. Given three made-up complaints (a price differs from the cart; a store's hours are wrong; a shopper cannot find an order), find the first place to look.
- 6b. Fill in a defect report using the template in the UAT plan.

### Session 7. For the technical contact (90 minutes, group D)

Content (RUNBOOKS; VPS_RUNBOOK; CUTOVER_AND_DNS; ACCESS_INVENTORY): set up a development machine; the environment variables and which are secret; deploy and roll back by hand (release folders, symlink, restart); smoke checks; failed Extend sync and the reconciliation report (only once Extend is live); rotate a secret; add a store; refresh the catalog; investigate a flagged order; upgrade Hydrogen; log events and alerts; certificate renewal; what the access inventory holds and who owns each row. Maintenance and upgrades are not included after handover (EXC-13).

Exercises:
- 7a. Read the access inventory and find who can rotate `SESSION_SECRET`, what breaks, and how to check.
- 7b. On a throwaway server or the staging copy: roll back one release and roll forward (VPS_RUNBOOK section 11).
- 7c. Run the read-only smoke test (VPS_RUNBOOK section 12) and explain two results.
- 7d. Rotate a test secret on staging and verify.

## 5. Competence check at the end (per trainee)

| Task | Done from the guide alone? (Y/N) | Time | Notes |
|---|---|---|---|
| Change a price and a sale | | | |
| Validate a sheet with errors and fix it | | | |
| Preview an import and explain the plan | | | |
| Create and end a discount; compare cart and checkout | | | |
| Edit a homepage section and a menu | | | |
| Create, take down and publish a content page | | | |
| Know what is not live and who to call | | | |

A "N" becomes a guide defect (fix the guide) or a follow-up session. REQ-HAND-003's acceptance is that a non-developer completes each task from the guide alone; this check is its evidence.

## 6. Materials to hand over

The five documents named at the top; the sheet template and the sample files; the training store's synthetic data description; a one-page "who to call and how to grade a problem"; a one-page cache-delay table; the release notes; the access inventory (group D only).

## 7. What attendees must not do

Change anything in the "Please do not change these" list; edit offer rules or the delivery ZIP list in any developer-managed place; run `--live` imports on the live store without the written go-ahead, an export and a developer; paste tokens or customer data into chat, tickets or documents; enable analytics or signup keys before counsel and the owner have signed the gates in [B-33](../../progress/BLOCKERS.md).

## 8. After the session

Within a week: send the recording or notes, the filled competence check, the list of guide defects with owners and dates, and the answers to open questions. Update ADMIN_GUIDE and the other documents for every defect. Launch-day support (REQ-HAND-005) and the first-week issue log (P9-10) follow; after that, requests are quoted separately (EXC-13).

## 9. Records to keep (REQ-HAND-004)

| Record | Content |
|---|---|
| Session record | Date, time, place or link, trainer(s), sessions delivered, version of each guide (date line) `[to fill]` |
| Attendance | Name, role, group, sessions attended `[client input needed]` |
| Recording or notes | Link or file in the handover pack; consent noted |
| Guide defect log | What was unclear, which section, who fixes, fixed on |
| Competence check | Section 5 table, one per trainee |
| Sign-off | Client decision-maker confirms the session was held (H-04) `[client input needed]` |

## What this outline does not cover

Training on Shopify itself (orders, shipping rates, taxes, payments, staff permissions); Klaviyo, Google Analytics, Meta, review and chat tools; Extend claims; writing the copy itself (EXC-10); anything about the site after a design change.
