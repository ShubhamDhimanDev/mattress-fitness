# Phase 7: Analytics, SEO, accessibility, performance and security hardening

## Objective

Turn a feature-complete storefront into a launchable one: measure it with consent, make it findable, make it accessible and fast, and close security gaps. **Business outcome:** the site meets the approved quality bars (NFR-002, NFR-003, NFR-004) before acceptance testing starts.

## Scope

In: consent management, GA4 and Meta tracking, Klaviyo signup forms with SMS consent, chat provider, SEO (metadata, sitemap, robots, structured data, canonical policy), accessibility audit and fixes, performance budgets and fixes, security hardening and threat-model verification, logging and monitoring hooks.
Out: automated email and SMS flows (EXC-03), new features (change control).

## Prerequisites

Phases 2 to 6 feature complete on staging; CLR-004 provider access (Q-015); Q-011 chat provider; Q-012 targets approved (browsers, performance, WCAG level, consent approach).

## Requirement IDs

REQ-ANL-001, REQ-ANL-002, REQ-ANL-003, REQ-ANL-004, REQ-SEO-001, NFR-002, NFR-003, NFR-004, NFR-010, NFR-011

## Architecture and design decisions

- All tracking flows through the `track()` interface from Phase 2; providers subscribe to it. No provider script loads before consent where consent is required (NFR-011); scripts load deferred.
- A Content Security Policy is introduced in report-only mode first, then enforced; third-party origins are an explicit allow list.
- Faceted URL indexing policy: index category and brand pages; `noindex` or canonicalise deep filter combinations (decision recorded).
- Performance fixes prefer fewer client scripts, image sizing and caching over micro-optimisation; budgets are enforced in CI where practical.
- Sync and integration failures emit structured logs with redaction (NFR-010).

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P7-01 | Consent layer and GA4 and Meta event mapping (page, ecommerce, quiz) | integration-engineer | Q-015, Q-012 | `storefront/app/lib/analytics/*` |
| P7-02 | Klaviyo email and SMS signup forms with recorded consent | integration-engineer | CLR-004, Q-015 | `app/routes/signup.tsx`, component |
| P7-03 | Chat provider embed and call-outs | integration-engineer | Q-011 | `app/lib/chat/*` |
| P7-04 | SEO: titles and meta, canonical URLs, sitemap, robots, Product, Breadcrumb and FAQ data (LocalBusiness withdrawn with the store locator, DEC-141), faceted-URL policy | shopify-hydrogen-developer | P3B-14 | `app/lib/seo/*`, routes |
| P7-05 | Accessibility audit: automated, keyboard and screen-reader passes; fix findings | ui-ux-designer | all UI phases | audit report and fixes |
| P7-06 | Performance: budgets, Lighthouse CI, fixes for LCP, INP and CLS on key templates | shopify-hydrogen-developer | P3B-14 | `docs/testing/PERFORMANCE.md`, config |
| P7-07 | Security hardening: headers, CSP, rate limits, dependency audit, secret scan, threat-model verification | security-engineer | all | `docs/security/REVIEW-phase7.md` |
| P7-08 | Logging redaction and monitoring hooks; failure alerts for sync | devops-engineer | P5A-09 | logger, alert definitions |
| P7-09 | Phase gate review | project-manager | all | gate record |

## Dependencies and blockers

Analytics and signup work needs account access (CLR-004). Q-012 targets must be approved before P7-05 and P7-06 can define "pass".

## Security considerations

Third-party scripts are the main new exposure (T-10): load only approved origins, pin or review versions, use subresource integrity where the vendor supports it, keep PII out of events and send no ZIP or email unhashed. Consent and SMS compliance (T-16) are legal as well as technical; client legal review of wording is requested, not assumed.

## Testing

Unit: event builders, consent gating, metadata builders. E2E: consent gating (no network call to a tracker before consent), signup submission to a test list, structured data present, sitemap and robots. Performance: Lighthouse CI on home, collection, product, cart. Accessibility: axe across every template plus manual passes. Security: header scan, CSP report review, dependency audit, abuse tests from the threat model.

## Acceptance criteria

REQ-ANL, REQ-SEO and NFR criteria met against the approved targets; no serious or critical axe findings; budgets met on staging; security review has no open High finding; consent behaviour approved by the client.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: measurement plan documented (what each event is for), and a list of accepted residual risks signed by the client.

## Review and sign-off

`security-engineer` and `qa-engineer` sign their areas; `code-reviewer` reviews tracking and SEO code; `ui-ux-designer` signs the accessibility remediation; client approves consent behaviour and measurement.

## Rollback and recovery

Tags and chat are switchable by environment variable without a code change; CSP is rolled out report-only first, so a bad policy is a header change. Performance fixes are individually revertable.
