# Review record template

Copy once per review round. Keep the task ledger private to its PR/task.

```yaml
review_stage: <fast | final>
verdict: <PROCEED | REWORK | ESCALATE | PASS | BLOCKED>
base_sha: <40-character SHA>
head_sha: <40-character SHA>
worktree_state: <clean | dirty; list uncommitted diff if dirty>
task_id: <issue-or-task-id>
brief_and_acceptance: <brief reference and criteria considered>
checked:
  - <diff/call path/command checked, with outcome>
not_checked:
  - <item not checked, with reason>
blockers:
  - path_line: <file:line>
    failure_mechanism: <how acceptance or a contract fails>
    minimal_reproduction_or_check: <smallest useful confirmation>
    corrective_action: <smallest concrete change>
advisories:
  - <non-blocking suggestion, or none>
required_next_checks:
  - <check and owner; include full CI/real-path gate when required>
rework_round: <integer or not applicable>
rereview_scope: <blocker and affected call paths, or not applicable>
escalation_owner_and_decision: <owner/decision or not applicable>
```

For Fast Review, `not_checked` must explicitly state that tests, typechecks, builds, E2E, benchmarks, and full CI were not run by the reviewer. For every stage, distinguish commands actually executed from checks merely required or pending. Final CI evidence must include the exact head SHA it validated.
