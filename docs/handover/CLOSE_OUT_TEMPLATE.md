# Project close-out report (template, pre-filled with the state of 2026-10-26)

Task P9-11 (release-and-handover skill, step 9); supports REQ-HAND-001 to REQ-HAND-005 and REQ-ACPT-003. **Copy to `docs/handover/CLOSE_OUT_<date>.md` at the end of Phase 9 and fill every `[to fill]`.** Internal-and-client document: no secrets, no personal data, no real order details. **As of 2026-10-26 the project is not closing: no gate has been passed, nothing is `DONE`, 0 of 104 requirements are `PASSING`, and nothing has run against a client store or a provider account.** Pre-filled cells are labelled with their source; counts in the records are derived and were not re-verified by the writer (STATUS: "derived, not verified"; run `node scripts/validate-framework.mjs --ids-by-phase` before filling).

Related: [RELEASE_NOTES_TEMPLATE](RELEASE_NOTES_TEMPLATE.md), [ACCESS_INVENTORY](ACCESS_INVENTORY.md), [HANDOVER](HANDOVER.md), [UAT_PLAN](../../plans/UAT_PLAN.md), [RELEASE_TEST_PLAN](../testing/RELEASE_TEST_PLAN.md), [CUTOVER_AND_DNS](../deployment/CUTOVER_AND_DNS.md).

## 1. Summary

| Field | Entry |
|---|---|
| Project | Headless Shopify storefront for the client's mattress and bedding store (Hydrogen, TypeScript, Tailwind; US, English, USD) |
| Client decision-maker | `[client input needed]` (Q-013) |
| Project owner | `[to fill]` |
| Scope of work | SOW (a transcription; the PDF wins; its signed status is unconfirmed, Q-001; the owner confirmed it as final 2026-10-12) |
| Start and go-live dates | `[to fill]` |
| Final release (tag, commit) | `[to fill]` |
| Hosting | `[to fill]` (interim plan: hand-deployed VPS, DEC-079; the client has not confirmed, Q-003) |
| Outcome in one paragraph | `[to fill]` |

## 2. Scope delivered against the SOW

One row per SOW section and deliverable. "State 2026-10-26" is the build state from the records; **final result needs the evidence column**.

| SOW section | Deliverable | State 2026-10-26 (from STATUS) | Final result (Accepted, Accepted with deferral, Not live with reason, Deviated and acknowledged, Not delivered) | Evidence |
|---|---|---|---|---|
| 4 | Home, collections and filters, brand pages, search, product pages, compare, sleep quiz, account, content pages and blog (the store locator was removed 2026-10-28, SD-12: record the client's acknowledgement) | Built on mocks and fixtures; none verified on a store | `[to fill]` | `[UAT sign-off, TRACEABILITY]` |
| 4 | Navigation, header, footer, promo bar, delivery ZIP | Built; promo text, phone and guarantee strip wait for client content | `[to fill]` | |
| 4 | Reviews | Adapter and placeholder built per the latest commits; no provider; hidden when no data (per-store pickup availability removed 2026-10-28, SD-12) | `[to fill]` | |
| 4 / 10 | Analytics (GA4, Meta) with consent; email signup; live chat | Built on fakes; ids and accounts not supplied; chat has no provider | `[to fill]` | |
| 5 | Cart, add-on, bundle and gift offers, comfort-guarantee protector, haul-away, free-delivery progress | Built; gift picker off; haul-away limit not enforced in checkout (SD-01) | `[to fill]` | |
| 5 | Post-purchase and thank-you offers | Not built by us (SD-02, SD-03); client decision | `[to fill]` | |
| 6 | Accident protection (Extend) | Built against a local mock; switched off; REQ-EXT-004 `Blocked` | `[to fill]` | |
| 7 | Checkout hand-off, delivery methods (white-glove, pickup, parcel), payment options, customer emails | Hand-off and delivery steps built; payment activation and emails are the client's (CLR-007); one delivery zone (SD-07) | `[to fill]` | |
| 8 | Product catalog import (up to 400 products), images, collections and filters, brands, stores, add-on services, content pages, promotions | Importer and validator built and tested on a simulated Shopify; the client's sheet not supplied; nothing imported | `[to fill]` | |
| 11 | Reviews during the build (daily link and note, weekly demo, consolidated rounds) | No staging exists, so none delivered | `[to fill]` | |
| 11 | Test order per delivery method, add-on and payment type, cancelled and refunded | Not possible yet (no store, no payment activation) | `[to fill]` | |
| 11 | Handover: repository, import tool and sheet, admin guide, training, launch-day support | Drafts exist (this folder); nothing handed over | `[to fill]` | |

## 3. Requirements and traceability

| Measure | At 2026-10-26 (derived) | At close |
|---|---|---|
| Requirements (functional + non-functional) | 104 | `[to fill]` |
| `PASSING` | 0 | `[to fill]` |
| `IN_PROGRESS` | 75 | `[to fill]` |
| `NOT_STARTED` | 29 | `[to fill]` |
| Rows with a signed deferral or declared "not live" | 0 | `[to fill]` |
| Phase-plan tasks (backlog rows: 69 `IN_REVIEW`, 19 `IN_PROGRESS`, 3 `DONE`, 4 `BLOCKED`, 6 `TODO`; 46 not yet in backlog) | 147 | `[to fill]` |
| Phase gates G1 to G8 passed | none | `[to fill]` |

List every requirement not `PASSING` at close with its reason (provider approval, client decision, deferral) in an appendix table: `[to fill]`.

## 4. Acceptance record (REQ-ACPT-001 to REQ-ACPT-003)

| Item | Entry |
|---|---|
| Review cadence delivered (staging link and note each working day, weekly demo, one consolidated round per page type) | `[to fill]` (nothing delivered by 2026-10-26: no staging, B-07) |
| UAT rounds R1 to R10: dates and issue counts | `[to fill]` ([UAT_PLAN](../../plans/UAT_PLAN.md) section 7) |
| Defects by grade (opened, fixed, deferred, open) | Blocker `[ ]` Major `[ ]` Minor `[ ]` |
| **Open Blockers at go-live** | must be 0: `[to fill]` |
| Majors deferred, each with a signed deferral | `[to fill]` |
| Test orders: matrix rows run, passed, refused as designed, not live, cancelled and refunded | `[to fill]` ([RELEASE_TEST_PLAN](../testing/RELEASE_TEST_PLAN.md) section 4) |
| Browser and device matrix approved (NFR-009) and run | `[to fill]` |
| Final accessibility and security re-check without a new High | `[to fill]` |
| Client acceptance signed | `[client input needed]` |

Items that would grade as Blocker if still open (from ACCEPTANCE_CRITERIA, 2026-10-15; update): gift-not-free gate unverified (B-21), react-router advisories (B-12), host rate limiting and production configuration (B-19), haul-away ZIP residual risk and the ADR-0006 limit without the owner's acceptance (B-17, B-18).

## 5. Handover deliverables (HANDOVER.md H-01 to H-09)

| # | Deliverable | Requirement | Document | State 2026-10-26 | Evidence at close |
|---|---|---|---|---|---|
| H-01 | Source in a GitHub repository owned by the client, history without secrets | REQ-HAND-001 | transfer record | Not started; the client's organisation is unknown (Q-014); local commits only; pushes are owner-only | Ownership screenshot, scan result, admins confirmed `[to fill]` |
| H-02 | Import tool and completed product sheet | REQ-HAND-002, REQ-CAT-009 | [CATALOG_IMPORT_GUIDE](CATALOG_IMPORT_GUIDE.md), `scripts/catalog/README.md` | Tool built; guide drafted; never run on a store; sheet not supplied | Client-side clean run `[to fill]` |
| H-03 | Written admin guide | REQ-HAND-003 | [ADMIN_GUIDE](ADMIN_GUIDE.md), [CONTENT_PAGES](CONTENT_PAGES.md) | Draft 2; no real screenshots; not tested by a non-developer | A non-developer completed each task `[to fill]` |
| H-04 | Training session | REQ-HAND-004 | [TRAINING_OUTLINE](TRAINING_OUTLINE.md) | Outline only | Attendance, recording or notes `[to fill]` |
| H-05 | Go-live support on launch day | REQ-HAND-005 | launch-day log | Not started | Named engineer, channel, log `[to fill]` |
| H-06 | Access and accounts inventory | supports H-01 to H-05 | [ACCESS_INVENTORY](ACCESS_INVENTORY.md) | Draft 1 | Signed inventory `[client input needed]` |
| H-07 | Runbooks | REQ-HOST-002/003 | [RUNBOOKS](RUNBOOKS.md), [VPS_RUNBOOK](../deployment/VPS_RUNBOOK.md), [CUTOVER_AND_DNS](../deployment/CUTOVER_AND_DNS.md) | Drafts; **nothing rehearsed; the VPS steps never ran** | Rehearsal evidence `[to fill]` |
| H-08 | Release notes and known limitations | all | [RELEASE_NOTES_TEMPLATE](RELEASE_NOTES_TEMPLATE.md) | Template | Client acknowledgement `[client input needed]` |
| H-09 | Asset and licence provenance | NFR-007, ASM-04 | [ASSET_PROVENANCE](ASSET_PROVENANCE.md) | Draft 1; independent review pending | Provenance list signed `[to fill]` |

## 6. Launch record

| Item | Entry |
|---|---|
| Go or no-go verdict and conditions | `[to fill]` (the honest verdict on 2026-10-26 is NO-GO, CUTOVER_AND_DNS section 5) |
| Approvals AP-1 to AP-8 | `[to fill]` |
| Cutover time and DNS change | `[to fill]` |
| Smoke checks (read-only) result | `[to fill]` |
| Authorised live test order: ID, observer, refund confirmation | `[to fill]` |
| Rollbacks or incidents on launch day and the first week (support log P9-10) | `[to fill]` |
| Open Blockers at the end of launch support | must be 0: `[to fill]` |

## 7. Change requests and scope movement

| ID | Description | Effort and cost effect | Client approval (date) | State |
|---|---|---|---|---|
| CR-08 | Haul-away over-limit check after the order instead of a Function (SD-01) | | `[client input needed]` | |
| CR-09 | Post-purchase and thank-you offers via an App Store app | | | |
| CR-17 | Cross-browser and pixel baselines without CI | | | |
| CR-18 to CR-30 | Candidates from the reference-site analysis (DEC-085); proposed, not approved | | | |
| `[to fill]` | Others from `plans/BACKLOG.md` | | | |

Exclusions that came up during the project and were left out: `[to fill]` (SOW section 9, EXC-01 to EXC-13).

## 8. SOW deviations and their acknowledgements

| ID | Subject | Acknowledged (date, by) |
|---|---|---|
| SD-01 to SD-05, SD-07, SD-11 | See [SOW_DEVIATIONS](../requirements/SOW_DEVIATIONS.md) and the release notes section 4 | `[client input needed]` |
| UXD-01 to UXD-28 | Design deviations | `[client input needed]` |

## 9. Decisions, risks and open items at close

| Record | Pointer | At close |
|---|---|---|
| Decisions | `progress/DECISIONS.md` (DEC-001 to DEC-125 on 2026-10-26) | `[to fill]` |
| Owner written acceptances: ADR-0006 limit (B-18), haul-away ZIP residual (B-17), CSP wildcards (DEC-093), no SRI (DEC-094), lock-out and per-process counters (DEC-096, DEC-116), unsigned consent cookie, junk-handle pattern, ADR-0008 / react-router route (B-12) | `progress/BLOCKERS.md` B-17, B-18, B-32, B-33 | Each: accepted / fixed, date `[to fill]` |
| Risk register | `plans/RISKS_AND_DEPENDENCIES.md` | Closed / open / transferred `[to fill]` |
| Blockers | `progress/BLOCKERS.md` | Cleared with evidence; remaining with owner `[to fill]` |
| Verification debt (V-xx, VD-xx) | [RELEASE_TEST_PLAN](../testing/RELEASE_TEST_PLAN.md) section 6 | Each row: verified (evidence) / accepted / carried `[to fill]` |
| Independent reviews outstanding at close (code, security) | RELEASE_TEST_PLAN VD-20 | `[to fill]` |
| Dependency audit | B-12 | `[to fill]` |

## 10. What is delivered to the client (transfer checklist)

Tick each only with evidence. Transfer needs the owner's explicit approval; nothing is pushed by this document.

- [ ] Repository transferred, history intact, secret scan clean, client admins confirmed, branch protection set (REQ-HAND-001)
- [ ] README and setup instructions work from a clean checkout (tested by someone other than the author)
- [ ] Product import tool, sheet template, validation report format, completed sheet
- [ ] Admin guide with real screenshots (synthetic data) and the content guide; tested by a non-developer
- [ ] Runbooks and the access inventory; every secret rotated away from staging values; no value in any document
- [ ] Training held; attendance and recording or notes archived
- [ ] Release notes acknowledged
- [ ] Provenance list signed
- [ ] Old (staging) site and the DNS zone copy kept for the agreed period
- [ ] Our access to the client's accounts removed or reduced; recorded in the inventory

## 11. After handover (post-handover responsibilities, EXC-13)

Stated to the client in writing at close:

1. **Not included:** maintenance, hosting upkeep and new features after handover; they are quoted separately (SOW sections 9 and 12; EXC-13).
2. **Third-party fees** are the client's: Shopify, apps, Extend, Affirm, payment processing and the server (EXC-12).
3. **Hydrogen upgrades:** released about quarterly; periodic upgrades are needed; the project holds exact versions (ADR-0008) and a dependency advisory (B-12) must be resolved or accepted before any public traffic.
4. **Server upkeep** (if the client's server or a VPS): OS updates and security patches, backups, scaling, certificate renewal, monitoring and alerts belong to the server owner or a maintenance agreement (SOW section 3). Nothing is wired for monitoring today.
5. **Providers:** Extend, Klaviyo, GA4, Meta, reviews, chat and payments are the client's accounts; their approvals and terms are theirs.
6. **Content and legal text** (privacy policy, terms, consent, SMS wording) are the client's responsibility with counsel.
7. **Who owns what:** [ACCESS_INVENTORY](ACCESS_INVENTORY.md).
8. A maintenance agreement, if wanted, would cover: `[to fill]` (separately priced; not part of this project).

## 12. Financial record

Fixed price and payment terms are in SOW section 12 (the price, 50 percent on signing and 50 percent on go-live). Record only: invoices issued and dates `[to fill]`; change requests approved and their price `[to fill]`. No amounts are copied here.

## 13. Lessons learned and follow-ups

| What went well | What did not | Follow-up (owner, date) |
|---|---|---|
| `[to fill]` | `[to fill]` | `[to fill]` |

Notes from the record that bear on lessons (2026-10-26): the verification pass was deliberately concentrated at the end (DEC-076, R-40); features were built in functionality-first order on mocks; testing and QA were deferred by the owner on 2026-10-26; hosting stayed unconfirmed with the client (Q-003); the question pack was not sent for the whole build (B-08).

## 14. Sign-off

| | Name | Role | Date | Signature |
|---|---|---|---|---|
| Client decision-maker | `[client input needed]` | | | |
| Project owner | | | | |
| qa-engineer (launch verification) | | | | |
| devops-engineer and security-engineer (production readiness) | | | | |
| project-manager (records updated: STATUS, requirement statuses, risk register, BLOCKERS) | | | | |

## What this report does not cover

Day-to-day operation after handover; the client's own business results; provider incidents; anything not recorded in the repository.
