# Client deliverables and handover

What the SOW promises to hand over (§8, §11), how we will prove each item, and what the client must be told about life after handover. Completion of each item is evidenced in [TEST_RESULTS](../../progress/TEST_RESULTS.md) and [DECISIONS](../../progress/DECISIONS.md). Skill: [release-and-handover](../../.claude/skills/release-and-handover/SKILL.md). Phase: [phase-09](../../plans/phases/phase-09-launch-and-handover.md).

## Status of the handover documents (2026-10-15; rows added 2026-10-23)

| Document                                                                          | State                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADMIN_GUIDE](ADMIN_GUIDE.md) (H-03)                                              | Draft 2, matched to the code on 2026-10-15. Marks each item `BUILT, AWAITING DEV-STORE VERIFICATION`, `NOT CONNECTED YET` or `DEVELOPER-MANAGED`. No screenshots; not tested by a non-developer                                                                  |
| [RUNBOOKS](RUNBOOKS.md) (H-07)                                                    | Draft 2: setup, env, deploy and rollback outline, failed sync and reconcile script, secret rotation, add a store, catalog refresh, flagged-order investigation (detective check and report, exit codes 0 to 4), Hydrogen upgrade, alert table. Nothing rehearsed |
| [DEPLOYMENT](../deployment/DEPLOYMENT.md)                                         | Every environment variable with exposure and what fails closed (analytics, consent and guest-tracking variables added 2026-10-23); host-dependent items waiting on Q-003 (interim answer: hand-deployed VPS, [VPS_RUNBOOK](../deployment/VPS_RUNBOOK.md))                                                                                                                                                            |
| ADMIN_GUIDE sections 12 and 13, RUNBOOKS sections 12 and 13 (2026-10-23)          | Order tracking page and privacy choices link for the client team; guest-lookup log events, troubleshooting, GA4 checklist pointer, consent mode and consent-complaint procedure for developers. Written from the code and tests; **no screenshot, nothing rehearsed, never run on a store or a provider account**                                                |
| [CLIENT_QUESTION_PACK](../requirements/CLIENT_QUESTION_PACK.md) Part 5 (2026-10-23) | Draft questions on carriers, consent mode and policy wording, analytics accounts, guest tracking acceptance, the CR-18 to CR-30 candidates, hosting and the design deferral. **Not sent**; the owner decides                                                    |
| [scripts/catalog/README.md](../../scripts/catalog/README.md) (H-02)               | Product sheet, validator and importer; tested on a simulated Shopify only                                                                                                                                                                                        |
| Release notes (H-08), training (H-04), access inventory (H-06), provenance (H-09) | Not started                                                                                                                                                                                                                                                      |

**What exists today versus the outline below.** The admin guide outline lists tasks as the SOW describes them. Three of them depend on features that are not yet connected to Shopify admin: stores and pickup (the locator uses sample stores), quiz questions (a built-in default quiz), and offer rules, the haul-away maximum and the delivery zone (held in a developer-managed setting, `OFFER_CONFIG_JSON`, until P4-12). The admin guide says so item by item. No SOW deviation (SD-01 to SD-05, SD-07) may be described to the client as delivered until the client acknowledges it.

## Deliverables

| #    | Deliverable                                            | Requirement               | Content                                                                                                                                                                                              | Acceptance evidence                              |
| ---- | ------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| H-01 | Source code in a GitHub repository owned by the client | REQ-HAND-001              | full history without secrets, README, setup and deploy docs, CI                                                                                                                                      | repo ownership screenshot, secret scan result    |
| H-02 | Product import tool and the completed product sheet    | REQ-HAND-002, REQ-CAT-009 | tool, sheet template, validation report format, instructions                                                                                                                                         | client-side clean run                            |
| H-03 | Written admin guide                                    | REQ-HAND-003              | products, prices and sales, promotions and gift or bundle rules, offers (haul-away, protectors, add-ons), stores, homepage sections, quiz questions, FAQs, navigation, how long edits take to appear | non-developer completes each task from the guide |
| H-04 | Training session                                       | REQ-HAND-004              | recorded or noted session for the client's team                                                                                                                                                      | attendance and notes                             |
| H-05 | Go-live support on launch day                          | REQ-HAND-005              | named engineer and channel, triage by SOW grades                                                                                                                                                     | launch-day log                                   |
| H-06 | Access and accounts inventory                          | supports H-01 to H-05     | every account, who owns it, which secrets exist and where (no values), renewal dates                                                                                                                 | signed inventory                                 |
| H-07 | Runbooks                                               | REQ-HOST-002/003          | deploy, rollback, failed-sync handling and reconciliation, adding a store, rotating a secret                                                                                                         | rehearsal evidence                               |
| H-08 | Release notes and known limitations                    | all                       | what is live, what is not (provider approvals pending, deferred Majors), residual risks                                                                                                              | client acknowledgement                           |
| H-09 | Asset and licence provenance                           | NFR-007, ASM-04           | source of every image and text; confirmation of rights                                                                                                                                               | provenance list                                  |

## Admin guide outline

1. Where things live in Shopify admin (products, collections, metaobjects, discounts, menus, pages).
2. Update prices, sales and products by editing the sheet and re-running the import, or in admin.
3. Create and end promotions (gift with purchase, bundles) and how to check cart equals checkout.
4. Manage add-on and service offers (haul-away price and maximum, comfort-guarantee protectors, matching add-ons).
5. Manage stores and hours; set pickup locations.
6. Edit homepage sections, promo tiles, collection FAQs and menus.
7. Edit quiz questions and answer mappings; what a bad mapping does.
8. Delivery zones and fees (per the decision in Q-008).
9. Extend: what the client sees, claims are Extend's, how to read the reconciliation report.
10. Troubleshooting: where to look first, what is cached and for how long, who to call.

## What the client must understand about after handover

Maintenance, hosting upkeep and new features are not included (EXC-13). Hydrogen is released on a calendar-versioned schedule (about quarterly) and needs periodic upgrades; under Option B the client or a maintenance agreement owns OS updates, security patches, backups and scaling (SOW §3). Third-party fees continue (Shopify, apps, Extend, Affirm, payment processing, Option B server). Provider-dependent features (Extend, Affirm, post-purchase) are live only once approved by those providers (SOW §13).

## Exit checklist

All H-items evidenced; all Blockers closed and Majors fixed or deferred in writing; secrets rotated from staging values; repository transferred; access inventory signed; client decision-maker signs handover.
