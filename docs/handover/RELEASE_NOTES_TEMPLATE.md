# Release notes (template, pre-filled with the state of 2026-10-26)

Deliverable H-08 (task P9-11; the release-and-handover skill, step 2). For the client's team: plain language, no jargon without an explanation. **Copy this file to `docs/handover/RELEASE_NOTES_<version>.md` at release, then fill every `[to fill]`.** Never publish or send release notes outside the repository without the owner's approval.

**How the pre-fill was made.** From `progress/STATUS.md` (seventh records pass, 2026-10-26), `progress/BLOCKERS.md`, `plans/ACCEPTANCE_CRITERIA.md`, `docs/requirements/SOW_DEVIATIONS.md` and the merge message of `335dc3e` on this branch. `STATUS.md` was last updated before the final commits of this branch (`c368ea4` and `335dc3e`: reviews layer with a Judge.me adapter, pickup availability, store hours read from Shopify, quiz persistence in the account, admin-editable quiz scoring rules). Those commits state that **tests and QA were deferred by the owner and nothing was verified against a store**; rows that depend on them are marked accordingly and the records must be brought up to date before this is issued. **As of 2026-10-26 nothing is live: no release exists, no store holds the client's catalog, and no gate has been passed (0 requirements are `PASSING`).** Rule for every row: nothing is described as delivered unless it was verified on the client's store; a feature waiting on a provider is "not live", with the reason, never faked or silently removed (SOW section 13); a deviated SOW item is described as agreed only after the client acknowledged it.

---

## Release `<version / tag>` of `<date>`

| Field | Entry |
|---|---|
| Release commit and tag | `[to fill]` (from `RELEASE.txt` in the deployed release folder) |
| Node and Hydrogen versions | Node 22 LTS; Hydrogen 2026.4.7 and react-router 7.16.0 are held (ADR-0008) unless P1-12 has changed them: `[to fill]` |
| Hosting | Hand-deployed VPS on our own Node server (owner's interim answer, DEC-079) `[confirm with the client, Q-003]` |
| Store | `[client's store domain]` |
| Date live and who approved | `[to fill]` (approvals AP-1 to AP-8, [CUTOVER_AND_DNS](../deployment/CUTOVER_AND_DNS.md) section 4) |
| Previous release | `[to fill]` |

### 1. What is live

`[to fill at release. Today: nothing is live.]` List only what was verified on the client's store in production or on the acceptance environment, with the evidence link and date. For each row use this format:

| Area | What shoppers and staff can do | Verified (date, who, evidence) |
|---|---|---|
| `[to fill]` | | |

### 2. Built, not yet verified on your store

These exist in the website and pass automated tests on **test data, simulated Shopify answers or public demo stores**. They have not been seen working on your store. They stay here until verified; on release day each one is either moved to section 1 with evidence or reported as not live.

| Area | State (2026-10-26) | What verifies it |
|---|---|---|
| Home page, menus, header and footer (promo bar and phone are hidden until you supply them) | Built | Your store and your content |
| Collections, brand pages, filters (size, brand, comfort, type, price), search with suggestions | Built | Products imported; Search and Discovery filters set up (V-04) |
| Product pages: sizes, prices, sale prices, gallery, specifications, brand section, delivery promise | Built | Your products |
| Compare, sleep quiz (built-in questions and scoring until you approve yours; scoring rules readable from Shopify admin per the latest commit) | Built | Your approval of questions and rules (CLR-012) |
| Cart and cart drawer; size swap; free-delivery progress | Built | Store; cart equals checkout check (blocked by the Online Store password on the test store) |
| Add-on, bundle pickers; product-page add-ons box; comfort-guarantee protector step | Built | Your launch rules (CLR-011); discounts on a store (V-03, V-27) |
| Gift-with-purchase picker | Built, **switched off** until the gift discount is proved on a store | V-03, then `PUBLIC_GIFT_PICKER_ENABLED` |
| Delivery ZIP check; delivery promise; delivery choice; haul-away (blocked until a ZIP is saved) | Built; one delivery zone | Your ZIP list, fee, threshold and haul-away rules; Local delivery configured on the store |
| Hand-off to Shopify's secure checkout | Built | Store with the password removed |
| Customer accounts (sign in, orders, name, addresses) | Built | Store with new customer accounts (V-08) |
| Order tracking page for guests (orders from the last 60 days) | Built, **footer links hidden** until verified | A real test order; your acknowledgement of SD-05 |
| Store locator and store pages; store hours with time zone; "my store" | Built; reads Shopify per the latest commit, sample stores as fallback | Your stores entered in Shopify |
| Pickup availability and "try in store" | Built per the latest commit; hidden when there is no data | Locations and stock in Shopify (V-07) |
| Product reviews | Built per the latest commit with a Judge.me adapter; **no provider chosen, so nothing shows**; no invented ratings | Your chosen reviews app (Q-011, V-23) |
| Content pages (15), policies and blog layouts | Built; **no store holds your text**; links appear only when a page has text | Your text and approval (CLR-016) |
| Privacy-choices banner and footer link; GA4 and Meta tags | Built; **nothing loads until you supply the ids** and counsel has approved the wording | Your GA4 and Meta accounts; counsel (Q-012) |
| Email signup form | Built; **hidden until a double-opt-in Klaviyo list and a restricted key exist**; SMS off | Your Klaviyo account (SU-M1 gate) |
| Search-engine files: sitemap, robots, structured data, canonical links | Built | `PUBLIC_SITE_URL` set on the live host |
| Security headers, request limits (proxy), redacted logging | Built; proxy never run | A server (VPS runbook rehearsal) |
| Product import tool and checker, definitions tool | Built and tested on a simulated Shopify | Your sheet and a development store ([CATALOG_IMPORT_GUIDE](CATALOG_IMPORT_GUIDE.md)) |
| Accessibility target (WCAG 2.2 AA, pending your approval) | Automated checks pass on test stores | Screen-reader and device passes (a person with devices) |

### 3. Not live, and why

| Feature | Why | What unblocks it | SOW reference |
|---|---|---|---|
| Extend accident protection | Built against a local practice copy of Extend's documented system and **switched off**. Needs your approved Extend merchant account, store ID and Extend's written answers; Extend decides whether to approve a custom headless layout | Extend account (B-03, Q-005, CLR-006) | SOW 6, 13; REQ-EXT-004 `Blocked` |
| Post-purchase and thank-you offers | **Not built by us.** An App Store app you would choose, install and pay for; Shopify decides access | Your decision (Q-007, CR-09) | SOW 5; SD-02, SD-03 |
| Affirm and store-credit-card monthly messages | A message slot exists, hidden until the provider is active and approved wording exists | Activation (CLR-007, CLR-008) | SOW 7; SD-11 |
| Shopify Payments, PayPal, Apple Pay, Google Pay, Shop Pay | Activated on **your** accounts; we do not control them | Your activation (CLR-007) | SOW 7, 13 |
| Live chat | No provider can run. Shopify Inbox, the default, is not documented for headless storefronts on the version we use. A development-only fake exists | You choose a provider with a browser interface (CLR-005, Q-011, B-34) | SOW 4; REQ-ANL-004 |
| Reviews, email signup, analytics | See section 2: off until you supply accounts | Accounts and approvals | SOW 4, 10 |
| White-glove delivery limit enforced inside Shopify's checkout | Not possible on the Basic plan; see section 4 | Your acknowledgement | SOW 5; SD-01 |
| Anything on the exclusion list (SOW section 9) | Out of scope | A change request | SOW 9; EXC-01 to EXC-13 |

### 4. Changes to what the scope of work says (Basic plan and owner decisions)

Not described as delivered until you acknowledge them. Source: [SOW_DEVIATIONS](../requirements/SOW_DEVIATIONS.md). Status as of 2026-10-26: the question pack has not been sent; **no acknowledgement has been received**.

| ID | What the SOW said | What you get | Acknowledged (date, by) |
|---|---|---|---|
| SD-01 | Haul-away maximum "also enforced inside checkout by a Shopify Function" | Limits enforced on our pages and server before checkout, plus a check **after the order** (a report and a log; orders made directly against Shopify's public API are detected, not prevented). Owner's written acceptance of the limit is also owed (B-17, B-18) | `[client input needed]` |
| SD-02, SD-03 | One-click offer between payment and confirmation; follow-up offer on the confirmation page | An App Store app, if you choose one | `[client input needed]` |
| SD-04 | White-glove delivery by ZIP list and express wallet buttons | White-glove through Shopify's Local delivery with the same ZIP list; wallet behaviour with Local delivery unverified | `[client input needed]` |
| SD-05 | Guest order tracking by order number and email | Works for orders from the last 60 days; older orders need an account or the link in the confirmation e-mail | `[client input needed]` |
| SD-07 | ZIP list with fee rules | **One delivery zone**; Shopify's postal-code list is limited to 3,000 characters per zone; more zones are a change request | `[client input needed]` |
| SD-08 | Extend live once approved | See section 3 | `[client input needed]` |
| SD-09 | Gift and bundle prices by Shopify discounts | Same; capacity note of 25 active automatic discounts (to verify) | `[client input needed]` |
| SD-11 | Store-card and Affirm messages | Hidden slot until active | `[client input needed]` |
| UXD-01 to UXD-28 | The look follows the reference site's patterns in your brand | Design deviations listed in [DEVIATIONS](../design/DEVIATIONS.md); the design is frozen (DEC-081); none acknowledged | `[client input needed]` |

SD-06 and SD-10 are clarifications and need no acknowledgement.

### 5. Known issues and deferred problems

From the defect log (`plans/UAT_ISSUES.md`) at release. Blockers: none may be open. Majors: each needs a signed deferral. Minors: scheduled.

| ID | Grade | Description | Deferral reference or fix date | Owner |
|---|---|---|---|---|
| `[to fill]` | | | | |

Known limits that are not defects (carried from the records on 2026-10-26; confirm each at release):

- The gift in the placeholder rules is product-level; a bundle minimum of three items cannot require one of each; the gift size is not tied to the mattress size (Basic-plan limits; the real rules are yours, CLR-011).
- Offer rules, the haul-away maximum and the delivery ZIP list are changed by a developer today (`OFFER_CONFIG_JSON`), not in Shopify admin, until the metaobject version (P4-12) ships `[confirm at release]`.
- Counters that limit order lookups and email signup are kept in the server's memory per process and reset on restart; anyone can hold one email or order lookup shut for a short time (accepted-or-not by the owner: B-33 item 1).
- Page changes take time to show (listing prices about 6 minutes, menus about an hour; confirm in ADMIN_GUIDE section 10.2).
- Dependencies: react-router below 7.18 has open high-severity advisories in the version we hold (B-12). `[state the resolution or the written acceptance at release]`

### 6. Risks that remain after release

| Risk | Plain explanation | Owner |
|---|---|---|
| Direct Storefront API carts | Someone who builds a cart straight against Shopify's public API can bypass our rules; we find it after the order (ADR-0006, B-18) | Owner accepts in writing |
| Delivery ZIP the shopper types | Haul-away eligibility rests on the ZIP typed on our site; the address typed later in Shopify's checkout is invisible to us (B-17) | Owner accepts in writing; Shopify delivery zone setting reduces it |
| Provider behaviour not yet seen | Extend, Klaviyo, GA4, Meta, reviews and chat have not been tested against real accounts (verification debt register in [RELEASE_TEST_PLAN](../testing/RELEASE_TEST_PLAN.md)) | Owner, client |
| Hand-run hosting | One server, no CI, rollback by hand; a server failure means downtime until rebuilt | Server owner |
| Legal wording | Consent, privacy policy, SMS and email wording are drafts until your counsel approves | Client |

### 7. What we need from you

`[to fill at release]`. At the start of the project this list is: named decision-maker (Q-013); acknowledgements in section 4; accounts and access (domain, Klaviyo, GA4, Meta, reviews and chat providers, Extend, payment activations); delivery ZIP list, fees and threshold; haul-away price and maximum; gift and bundle rules; quiz approval; store list; brand kit; the completed product sheet and images; final page text and approval of drafted product copy (SOW section 10).

### 8. Costs and responsibilities after release

Third-party fees continue and are yours: Shopify, apps, Extend, Affirm, payment processing, and the server under Option B (SOW sections 9, 12; EXC-12). Maintenance, hosting upkeep and new features after handover are not included (EXC-13). Hydrogen is released about four times a year and needs periodic upgrades; under Option B the operating-system updates, security patches, backups and scaling are the server owner's, or a separate maintenance agreement's. Someone must also keep an eye on certificate renewal, domain expiry and the access inventory ([ACCESS_INVENTORY](ACCESS_INVENTORY.md)). A change to a delivered feature starts with a written change request (SOW section 11).

### 9. How to get help

| Situation | Contact |
|---|---|
| Shoppers cannot find, buy or pay (Blocker) | `[name, phone, email: to fill at handover]` |
| A listed deliverable does not work as described (Major) | `[name, email]` |
| Wording or cosmetic (Minor) | `[shared issue list]` |
| Shopify account or billing | Shopify support |
| Extend claims or contract | Extend |

Launch-day support: `[named engineer and channel]` (REQ-HAND-005). After that period, requests are quoted separately.

### 10. Version history

| Version | Date | Commit | Summary |
|---|---|---|---|
| `[to fill]` | | | |

Client acknowledgement of these release notes (H-08): `[name, role, date: client input needed]`.

## What these notes do not cover

Anything in Shopify itself that the client's team changes after release; provider changes after release; the internal build history (see the git log and `progress/DECISIONS.md`).
