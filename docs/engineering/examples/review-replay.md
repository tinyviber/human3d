# Review replay fixture: protocol endpoint change

**Status: procedure fixture only; not executed evidence.** This walkthrough demonstrates the required records for a future real task. The placeholder SHAs below are intentionally not presented as real revisions. No test, build, reviewer verdict, or CI run is claimed here. The umbrella issue's replay acceptance remains pending until a real task records actual SHAs and outcomes through the final CI stage.

## Task contract

- `task_id`: `example-protocol-solver-endpoint-semantics` (hypothetical; see [task briefs](task-slices.md#example-b-high-risk-protocolsolver-contract-change)).
- Base SHA: `<actual 40-character base SHA required>`.
- Initial head SHA: `<actual 40-character implementation SHA required>`.
- Final head SHA: `<actual 40-character repaired SHA required>`.
- Acceptance: `timestamps.at(-1) === duration`; deterministic real sampling path; any solver/protocol identity changes coordinated and checked; browser/server package agreement preserved where affected.
- Scope: explicitly hypothetical. It does not describe a change made to this repository.

## Phase trace

| Phase | Checked | Not checked / status | Result and next action |
|---|---|---|---|
| Fast Review, initial diff | Once populated, inspect task brief, base-to-head diff, sampling call chain, endpoint contract, and regression coverage. Record exact paths/lines and actual SHA. | Reviewer runs no tests, typecheck, build, E2E, benchmark, or full CI. In this fixture, no diff was reviewed. | **REWORK example only**: hypothetical blocker: a non-integer `duration × fps` grid ends before `duration`, so the exact endpoint acceptance fails. In a real record, cite the changed file/line and a minimal failing example. |
| Repair | Implementer changes only the endpoint grid behavior and adds/updates its targeted regression test. Record repaired diff and new head SHA. | Do not claim the fix works until its targeted check is executed. No full validation in this fixture. | Handoff the blocker, repair, command, outcome, and new SHA to the reviewer. |
| Affected checks | Run the brief's targeted sampler test and applicable typecheck; add protocol/golden or real service path checks when identity or package behavior is affected. Record exact commands, outcomes, and durations. | This fixture ran none; every outcome is `PENDING`. Do not infer success from the described command list. | **PENDING** until a real task records results. A failure returns to the responsible owner before Final Review. |
| Scoped re-review | Reviewer compares blocker repair and affected call chain, then checks added regression coverage and any repair risk. Record paths and the exact new SHA. | Do not repeat review of unchanged areas without a new risk. No re-review occurred in this fixture. | Example verdict: **PROCEED**, only after evidence confirms the specific blocker is fixed; otherwise **REWORK** or **ESCALATE**. Actual verdict: `PENDING`. |
| Final Review | Review complete final diff, brief, targeted evidence, package/identity impacts, test quality, real-path evidence, and residual risk. Record checked/not-checked items. | This fixture has no final diff and no review verdict. | Actual verdict: `PENDING`; Final Review cannot waive full CI or high-risk real-path acceptance. |
| Required full CI and real-path acceptance | Run the repository's required CI for the final repaired head SHA and any required high-risk real-path checks. Record run URL/status and SHA. | Not run for this documentation fixture; final SHA is not assigned. | **PENDING — acceptance gate not satisfied.** A stale SHA, skipped/cancelled job, or unrun check is not a pass. |

## Real replay completion fields

Replace this fixture with an evidence-backed record for a real task before claiming the umbrella replay acceptance:

- issue/PR and task brief link;
- actual base, initial head, repaired head, and final validated head SHAs;
- Fast Review REWORK finding with path/line, failure mechanism, and minimal reproduction;
- repair commit and targeted affected-check commands with actual outcomes;
- scoped re-review and Final Review verdicts with checked/not-checked evidence;
- required CI run reference bound to the final validated head SHA, plus required real-path results;
- remaining risks and checks not run.
