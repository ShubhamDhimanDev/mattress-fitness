# Git practices

- Check `git status` before changing anything; never overwrite or discard existing work you did not make. Never run `git reset --hard`, `git clean`, `git push --force`, `rm -rf` or history rewrites without explaining the impact and getting approval (settings ask or deny push, force-push, `reset --hard`, `clean` and `rm -rf`; other history rewrites such as `rebase`, `commit --amend`, `branch -D` and `checkout --` are governed by this rule only).
- **Commit and push only when the project owner asks.** Do not commit generated secrets, `.env` files, tokens, customer data, test output or build artefacts.
- Branches: `main` is always releasable. Work on `feat/<req-or-task-id>-<slug>`, `fix/<id>-<slug>`, `docs/<slug>`, `chore/<slug>`. One coherent change per branch; rebase or merge `main` before review.
- Commits: imperative subject under 72 characters, with the requirement or task ID (for example `feat(cart): enforce haul-away maximum server-side (REQ-PRE-003, P5B-03)`), and a body explaining *why* when it is not obvious. Keep generated-code commits separate from hand edits where practical.
- Pull requests: link the requirement IDs and phase task; describe behaviour and risks; list tests run and evidence; note any security, accessibility or performance impact; tick the phase-gate items the change affects. Request independent review before merge.
- Dependency changes (framework, packages, lockfile) go in their own commit with the reason and compatibility check, and an ADR when they change a framework version or the package manager.
- The lockfile is committed and never hand-edited. CI must pass before merge; never skip hooks or bypass failing checks.
- Never publish or deploy from a feature branch to production. Tag releases from `main`.
- Co-author and attribution lines follow the harness configuration for this session.
- The client owns the final repository (SOW §2): keep history clean, no secrets ever (history is scanned before transfer, REQ-HAND-001).
