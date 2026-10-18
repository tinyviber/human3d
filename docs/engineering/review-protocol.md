# Task slicing, review gates, and handoff

This document defines a cross-harness Markdown protocol for work in this repository. It is designed to be readable without a particular agent CLI or orchestration tool.

## Authority and scope

- Root [`AGENTS.md`](../../AGENTS.md) remains authoritative for repository architecture, domain invariants, available commands, and validation policy. This document does not replace those rules or define a second CI matrix.
- The issue or maintainer defines task-specific acceptance criteria. If this protocol conflicts with `AGENTS.md` or an explicit maintainer instruction, stop and resolve the conflict before implementation.
- Keep each task independently reviewable, with one owner and a bounded file/module scope. Split broad issues into separately reviewable tasks and PRs. Do not make concurrent changes to a hot file without an agreed owner and interface.
- A task brief is the contract for implementation, review, and handoff. Record it in the PR description or a task-private Markdown file; do not grow a shared history log for routine progress.

## Task slice and brief

Before implementation, fill the template in [`task-brief-template.md`](task-brief-template.md). A useful slice names:

- `task_id`, goal, owner, base SHA, and allowed files/modules;
- inputs, outputs, public contracts, acceptance examples, and prohibited changes;
- dependencies and any interface decision that must be frozen by an integration owner first;
- targeted checks for implementation, high-risk real-path checks for integration, and who owns each;
- risks, escalation owner, and the action when the task exceeds its scope.

Keep implementation and test ownership explicit when work is parallel. A cross-package contract change needs an agreed contract and integration owner before parallel implementation starts.

## Fast Review: early blocker finding

Fast Review is an independent, read-only review of the task brief and actual changes. Reviewers need the exact base and head SHA, `git diff <base>...<head>`, and any uncommitted diff (with working-tree state stated). Trace relevant callers and callees when a file-level reading is not enough.

Check, in this order:

1. acceptance criteria and requested behavior are covered;
2. package boundaries, dependencies, public API compatibility, and data identity/versioning;
3. domain contracts that apply (including coordinates, contact semantics, persistence, and protocol shape);
4. the real user/service path reaches the changed behavior;
5. tests have not been weakened or replaced with a bypass that misses the defect;
6. whether the task has expanded beyond its brief.

Fast Review does not run tests, typechecks, builds, browser E2E, benchmarks, or full CI. Authors may run targeted checks while implementing; reviewers record those results as evidence, not as a substitute for examining the diff. Stop after establishing a credible blocker. Do not turn style preferences or optional refactors into blockers.

Return exactly one verdict:

- **PROCEED** — no confirmed blocker; run the affected checks named in the brief, then request Final Review.
- **REWORK** — at least one concrete blocker; list the smallest corrective change and a targeted way to confirm it. Do not run full validation as part of this review stage. After repair, re-review the blocker and affected call chain only; include new risks introduced by the repair.
- **ESCALATE** — the brief, interface, ownership, or architecture is unresolved; stop implementation and route the decision to the named design/integration owner. Do not guess and continue.

Record the verdict fields from [`review-record-template.md`](review-record-template.md): base/head SHA, worktree state, brief context, findings with path/line and failure mechanism, minimal reproduction/check, advisory items, checks required, not checked, repair/re-review round and scope, and escalation owner where applicable. A finding must be actionable and evidence-based.

If the same architecture-level blocker recurs, or the agreed rework-round limit is reached, return to planning or escalate to the maintainer; do not repeat an unbounded repair loop.

## Affected checks and Final Review

After Fast Review proceeds (or the scoped REWORK repair is accepted), run the checks required by the brief and applicable `AGENTS.md` validation level. Expand checks when a shared interface, package boundary, build configuration, protocol, persistence, solver, or real interaction path is affected. Unknown impact must broaden validation, not narrow it.

Final Review is independent of implementation and examines the complete final diff, task contract, affected-check evidence, test quality, integration paths, and residual risk. It returns blockers, advisories, and any remaining required acceptance checks. Final Review does not replace tests, real-path validation, or required CI.

The required full CI and any required real-path acceptance must pass for the exact final head SHA before merge. A new commit invalidates evidence tied to an older SHA. A skipped, cancelled, stale, or unrun check is not a pass. Report browser QA separately when CI does not cover it. Use `review-record-template.md` for checked/not-checked items and honest `PENDING` status.

## Rework and handoff

A handoff carries the task brief, exact base/head SHA, working-tree state, diff or PR link, current review verdict, findings and dispositions, commands with outcomes, checks not run and reasons, unresolved risks, and the next owner's concrete action. On repair, state which blocker changed, which call paths were re-reviewed, and what remains outside the review scope.

Keep the ledger task-private (for example, in the PR description or a task-specific file). At completion, retain durable decisions in the appropriate domain/architecture document only when they will help future tasks; do not copy the full review transcript into a global history file.

## Worked examples and current rollout status

[`examples/task-slices.md`](examples/task-slices.md) contains populated low-risk and high-risk briefs. [`examples/review-replay.md`](examples/review-replay.md) records a real protocol rollout trace when one has been performed. Its current entry is explicitly a **procedure fixture, not executed evidence**; final CI and real-path outcomes remain `PENDING` until a maintainer runs them against a recorded final head SHA. This protocol slice therefore does not claim the umbrella issue's full replay/CI acceptance is complete.
