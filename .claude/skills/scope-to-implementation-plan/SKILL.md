---
name: scope-to-implementation-plan
description: "Turns a section of the Scope of Work into traceable requirements and plan tasks: assigns IDs, status, phase, dependencies and testable acceptance criteria, records ambiguities as open questions, checks the exclusions list and keeps the traceability matrix and phase plans in sync. Use when the SOW is clarified or amended, when a new request must be assessed, or when a feature area needs breaking down."
argument-hint: "[SOW section or feature area]"
---

# Scope to implementation plan

## When to use

A SOW section is being (re)analysed, a change request arrives, an answer to an open question changes a requirement, or a requirement is too vague to build. Target: $ARGUMENTS

## Steps

1. Read the exact SOW text in `docs/requirements/SCOPE_OF_WORK.md` for the target (the PDF wins if they differ). Read `docs/requirements/REQUIREMENTS.md` (legend, existing IDs, exclusions EXC-01 to EXC-13) and `OPEN_QUESTIONS.md`.
2. Extract each distinct, testable statement. One requirement per behaviour; never merge two behaviours that could pass or fail independently. Quote or cite the SOW section.
3. Check the exclusions. If the statement matches an exclusion or is not in the SOW, it is **not** a requirement: add it to `plans/BACKLOG.md` under change-request candidates and stop.
4. Assign: ID (`REQ-<AREA>-NNN`, never reuse), phase (the phase where it is completed and accepted), status (`Confirmed` only if the SOW states it; `Assumed` for inference; `Blocked` when an external input or eligibility is missing; `Pending approval` when a client decision is required), and dependencies (`REQ`, `CLR`, `Q`, `G`).
5. Write acceptance criteria a tester could execute without asking you: observable behaviour, boundaries and failure cases, including the hostile case for anything involving money or limits.
6. Record ambiguities as `Q-NNN` in `OPEN_QUESTIONS.md` with why it matters, who answers, a working default and the priority. Do not resolve them by guessing in the requirement.
7. Add the row to `docs/requirements/TRACEABILITY.md` with planned test layers; add the ID to the phase plan's *Requirement IDs* and create or update the plan's tasks (IDs `P<phase>-NN`).
8. Verify facts the requirement depends on against official sources; add what is verified or unverified to `docs/research/TECH_FEASIBILITY.md`.
9. Run `node scripts/validate-framework.mjs`.

## Outputs

New or updated requirement rows, traceability rows, phase-plan task rows, open questions, and a short summary of what changed and which decisions are needed from whom.

## Validation

The validator passes (every requirement is in exactly one phase plan and the matrix; no unknown IDs); each new acceptance criterion is testable; nothing was added that is excluded or untraceable; ambiguity was recorded, not guessed.
