# Task brief template

Copy this into the PR description or a task-private file before implementation.

```yaml
task_id: <issue-or-task-id>
goal: <observable outcome>
owner: <implementer or lane owner>
base_sha: <40-character SHA>
allowed_scope:
  - <files/modules owned by this task>
contracts:
  inputs: <input assumptions and format>
  outputs: <observable result and compatibility requirements>
acceptance:
  - <specific example or invariant>
prohibited_changes:
  - <explicitly out of scope>
dependencies:
  - <task/interface dependency, or none>
integration_owner: <name/role for shared interface decisions, or none>
implementation_checks:
  - <targeted checks and owner>
integration_checks:
  - <real-path/high-risk checks and owner>
risks:
  - <known risk, or none identified>
escalation_owner: <person/role who resolves scope or design conflicts>
scope_overrun_action: <stop and request re-slice / interface decision>
```

Before starting, confirm that the acceptance criteria are observable, the base SHA exists, and ownership does not conflict with another active task. Repository-specific validation requirements come from [`../../AGENTS.md`](../../AGENTS.md).
