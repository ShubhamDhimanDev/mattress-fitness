# Phase 9: Production deployment, launch verification and handover

## Objective

Move the accepted storefront to the client's hosting and domain safely, verify it, and hand over everything the client needs to run it. **Business outcome:** the client launches without surprises and owns the code, the tools and the knowledge.

## Scope

In: final hosting implementation (Option A or B per Q-003), production configuration and secrets, domain and DNS, cutover runbook and rehearsal, production deployment **on explicit approval only**, launch verification, repository transfer, import tool and sheet, admin guide, training, launch-day support, release notes.
Out: ongoing maintenance and new features after handover (EXC-13), which are quoted separately.

## Prerequisites

Phase 8 acceptance recorded and go decision made; Q-003 answered; for Option B, the client's server with admin access (CLR-003); domain registrar access (CLR-004); production Extend approval where applicable; the client's GitHub organisation exists (Q-014).

## Requirement IDs

REQ-HOST-002, REQ-HOST-003, REQ-HOST-004, REQ-HAND-001, REQ-HAND-002, REQ-HAND-003, REQ-HAND-004, REQ-HAND-005

## Architecture and design decisions

- Only the chosen option is built, but the runbook records why the other was not chosen. Option A: Oxygen deployment from the client's repository with environment variables set per environment. Option B: hardened Linux server, Nginx, TLS, process manager, page caching, staging site, uptime monitoring, with the Extend sync as a service (SOW §3).
- Production deploys are **never automatic**: a human approves each deployment; the pipeline stops at a manual approval step. Rollback is rehearsed before cutover.
- Cutover keeps the old (staging) site available, uses a low DNS TTL set in advance, and has a defined point of no return and a defined abort.
- Secrets live in the hosting platform's secret store and in the client's accounts, never in the repository; the history is scanned before transfer.

## Tasks

| ID | Task | Owner | Depends on | Output and expected files |
|---|---|---|---|---|
| P9-01 | Implement the chosen hosting option (pipeline and environments; hardening and monitoring for Option B) | devops-engineer | Q-003, CLR-003 | `docs/deployment/DEPLOYMENT.md`, pipeline files |
| P9-02 | Production environment variables and secrets; verify nothing sensitive is client-exposed | devops-engineer | P9-01 | environment checklist (no values) |
| P9-03 | Domain and DNS plan: records, TTL, redirects from any old URLs | devops-engineer | CLR-004 | DNS plan in the runbook |
| P9-04 | Cutover and rollback runbook; rehearse on staging, including rollback | devops-engineer | P9-01 to P9-03 | `docs/deployment/RUNBOOK.md` |
| P9-05 | Production deployment, only after the owner and client approve the specific release | devops-engineer | P9-04, go decision | release record |
| P9-06 | Launch verification: read-only smoke checks, then one authorised live test order, refunded; Extend and analytics checks | qa-engineer | P9-05 | evidence in `progress/TEST_RESULTS.md` |
| P9-07 | Transfer the repository to the client's GitHub with clean history; confirm client admins | project-manager | Q-014 | transfer confirmation |
| P9-08 | Handover pack: import tool and completed sheet, admin guide, access inventory | technical-writer | P3A-05 | `docs/handover/*` |
| P9-09 | Training session for the client's team | technical-writer | P9-08 | session record |
| P9-10 | Launch-day support and first-week issue log | project-manager | P9-05 | support log |
| P9-11 | Release notes and project close-out report (release-and-handover skill) | technical-writer | P9-06 | release notes, close-out |

## Dependencies and blockers

Blocked until acceptance and a go decision. Option B additionally needs the client's server before P9-01 can complete. Production Extend approval and payment activations are hard gates for the features that depend on them (SOW §13).

## Security considerations

Production secrets are rotated from any value that touched staging; least-privilege tokens for the client's store; branch protection and required reviews on the client's repo; for Option B, SSH key-only access, firewall, unattended security updates policy agreed with the client or covered by a separate maintenance agreement (SOW §3), TLS with automatic renewal, backups documented. Live test orders are authorised and refunded.

## Testing

Pre-cutover rehearsal on staging; post-cutover smoke (home, collection, product, cart to checkout hand-off, account sign-in, webhook delivery, sync status, TLS, redirects); one authorised live test order; monitoring alert test (Option B). Evidence is archived.

## Acceptance criteria

REQ-HOST and REQ-HAND criteria met; the client confirms they can run the import tool and perform each admin task from the guide; launch-day issue log has no open Blockers.

## Definition of done

Gates G1 to G8 ([MASTER_PLAN](../MASTER_PLAN.md#phase-gates)) plus: release notes published, access inventory delivered, repository owned by the client, and a recorded statement of what happens after handover (maintenance is separate, EXC-13).

## Review and sign-off

`devops-engineer` and `security-engineer` sign production readiness; `qa-engineer` signs launch verification; the client's decision-maker signs launch and handover.

## Rollback and recovery

Documented and rehearsed before cutover: Option A, redeploy the previous Oxygen deployment (or restore the previous domain assignment); Option B, switch the process manager to the previous release directory and reload Nginx. DNS rollback uses the prepared low TTL. Rollback triggers (for example checkout hand-off failing, sync failing for more than a defined time) are written in the runbook before launch.
