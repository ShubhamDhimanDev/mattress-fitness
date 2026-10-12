---
name: release-and-handover
description: "Assembles release notes and the client handover pack: client-owned repository transfer, product import tool and sheet, admin guide, runbooks, access inventory, training record, known limitations and post-handover responsibilities. Run manually in Phase 9 after launch verification. It prepares material and checklists; publishing, tagging or transferring anything needs explicit approval."
disable-model-invocation: true
---

# Release and handover

## When to use

Phase 9 (P9-07 to P9-11), after acceptance and the approved production deployment. Deliverables list: `docs/handover/HANDOVER.md`; requirements REQ-HAND-001 to REQ-HAND-005.

## Steps

1. **Confirm preconditions.** Phase 8 acceptance recorded; production launch verified; the client's GitHub organisation exists and our access is confirmed (Q-014).
2. **Release notes.** From `progress/DECISIONS.md`, the traceability matrix and the defect log: what is live, what is not and why (provider approvals pending, deferred Majors), known limitations, residual risks, and how to get help. Date it; state the release commit.
3. **Repository.** Scan the history for secrets (tokens, keys, `.env` content); confirm the lockfile, README, setup and deploy docs, CI; prepare the transfer plan (new remote, history intact, branch protection, required reviews). **Do not push or transfer without the owner's explicit approval.**
4. **Import tool and sheet.** Run the tool from a clean checkout following the guide; hand over the completed product sheet and the validation report format.
5. **Admin guide.** Complete the outline in `HANDOVER.md`; test each task with a non-developer; use real screenshots from a development store with synthetic data.
6. **Runbooks and inventory.** Deploy, rollback, failed-sync handling, rotating a secret, adding a store; an access inventory listing every account, owner, and where secrets live (never the values); secret rotation from staging values done.
7. **Training.** Plan and hold the session; record attendance and notes (REQ-HAND-004).
8. **Post-handover statement.** Spell out what is not included (EXC-13), Hydrogen's upgrade cadence, third-party fees and the Option B upkeep responsibilities (SOW section 3), and what a maintenance agreement would cover.
9. **Close-out.** Update `progress/STATUS.md`, requirement statuses and the risk register; obtain the client's sign-off on handover.

## Outputs

Release notes, handover pack documents, access inventory, training record, transfer checklist, close-out report.

## Validation

Every handover item (H-01 to H-09) has evidence; a non-developer completed each admin task from the guide; the secret scan of history is clean; the repository is owned by the client and the client's admins are confirmed; no secret or personal data is in any delivered document; the client signed handover.
