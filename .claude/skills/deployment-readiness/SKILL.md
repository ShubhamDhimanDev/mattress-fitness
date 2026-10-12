---
name: deployment-readiness
description: "Read-only go or no-go check before any staging promotion beyond routine or any production deployment: CI and tests, gates, security, environment variables and secrets, provider approvals, hosting option setup, domain, monitoring, rollback rehearsal, test-order plan and recorded approvals. Use at Phase 8 exit, before cutover and before each production release. It never deploys."
---

# Deployment readiness

## When to use

Phase 8 go-live readiness (P8-09), Phase 9 (P9-04, P9-05), and before every production release. Strategy: `docs/deployment/DEPLOYMENT.md`; acceptance: `plans/ACCEPTANCE_CRITERIA.md`.

## Steps

1. **Release candidate.** Identify the exact commit and tag; confirm CI is green on it and the same artefact is what will be deployed.
2. **Quality gates.** All phases' gates G1 to G8 passed; traceability shows every in-scope requirement `PASSING` or with a signed deferral; zero open Blockers; Majors fixed or deferred in writing; the browser and device matrix run is recorded.
3. **Security.** Latest security review has no unresolved High; dependency audit and secret scan clean or accepted in writing; CSP and headers active; history scanned before repository transfer.
4. **Environment and secrets.** Production variables set per the inventory (`docs/deployment/DEPLOYMENT.md`); no staging secret reused; private values only in the platform's secret store; webhook endpoints and secrets configured for production.
5. **Providers.** Shopify channel and API tokens for the client's store; Extend production credentials and Extend's written approval; payments (Shopify Payments, PayPal, Affirm) activated; analytics IDs; features waiting on provider approval are listed as not live (SOW section 13).
6. **Hosting.** Option A: Oxygen environment, pipeline, domain assignment. Option B: hardening, TLS with renewal, process manager, caching, monitoring and alert test, backups documented, Extend sync service running.
7. **Cutover and rollback.** Runbook exists; rollback rehearsed on staging within the last release cycle; triggers and owners named; DNS TTL lowered in advance; old site retained.
8. **Verification plan.** Read-only smoke checks defined; the single authorised live test order, observer and refund plan agreed in writing.
9. **Approvals and people.** Recorded approval from the project owner and the client decision-maker for this release; launch-day support named.
10. **Verdict.** `GO`, `GO WITH CONDITIONS` (list them, each with an owner), or `NO-GO`, with the failing items and evidence links.

## Outputs

A readiness report (checklist with evidence links and a verdict) recorded in `progress/DECISIONS.md`, and a list of any conditions or follow-ups.

## Validation

Every checklist line has evidence or an explicit "not applicable" reason; the verdict follows from the evidence; nothing was deployed, pushed or changed by this skill; any waived item has the approver and date.
