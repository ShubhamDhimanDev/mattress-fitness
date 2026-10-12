---
name: phase-planning
description: "Creates or refreshes the plan for one project phase in plans/phases/ using the required sections (objective, scope, prerequisites, requirement IDs, decisions, ordered tasks, blockers, security, tests, acceptance, definition of done, sign-off, rollback), and moves the right tasks into the backlog. Use when a phase is about to start, when its prerequisites or scope change, or when a phase gate needs its plan updated."
argument-hint: "[phase id, e.g. 3B]"
---

# Phase planning

## When to use

Before starting a phase, after a decision or answer changes a phase, or when a gate review finds the plan out of date. Phase: $ARGUMENTS

## Steps

1. Read `plans/MASTER_PLAN.md` (gates G1 to G8, status vocabulary), `plans/ROADMAP.md` (dependencies, critical path), the existing plan in `plans/phases/`, `plans/CURRENT_PHASE.md` and `plans/BACKLOG.md`.
2. List the phase's requirement IDs from the source of truth: `node scripts/validate-framework.mjs --ids-by-phase`. Read each requirement's acceptance criteria and dependencies in `docs/requirements/REQUIREMENTS.md`.
3. **Prerequisites.** Check every dependency (`Q-`, `CLR-`, `G-`, earlier-phase tasks) against `progress/BLOCKERS.md` and `docs/integrations/READINESS_CHECKLIST.md`. Mark what is missing; if a dependency is a verification (`V-xx`), schedule it as a task first.
4. **Tasks.** Write ordered tasks with IDs `P<phase>-NN`, an owner agent, `Depends on`, and expected output files. Make each task the smallest unit that can be implemented, tested and reviewed. Keep file ownership disjoint between parallel tasks. Include the test-writing and review tasks and a final gate-review task.
5. Fill the remaining sections: architecture decisions (link ADRs), security considerations (threat IDs), testing (unit, integration, e2e, accessibility, performance), acceptance criteria (point to requirement IDs), definition of done (gates G1 to G8 plus phase-specific items), review and sign-off (who, including client approvals), rollback and recovery.
6. Add the tasks that are about to start to `plans/BACKLOG.md` with status, priority and notes (BLOCKED names who can clear it). Update `plans/CURRENT_PHASE.md`.
7. Update `plans/MASTER_PLAN.md` if the phase status changed. Run `node scripts/validate-framework.mjs`.

## Outputs

An updated phase plan, backlog rows, current-phase file, and a note of any decision or approval needed before the phase can start.

## Validation

The validator passes (all sections present, task IDs unique and well-formed, every requirement of the phase listed, backlog dependencies resolve); every blocked item names its unblocker; no task lacks an owner or a requirement link; the plan does not remove or silently defer in-scope features.
