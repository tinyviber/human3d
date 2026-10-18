# Example task briefs

These are fully populated examples of task slicing. They demonstrate what to record before implementation; they are not claims that either task has been executed.

## Example A: local documentation correction

```yaml
task_id: example-docs-validation-reference
goal: Correct a stale validation command reference in one documentation page.
owner: docs-owner
base_sha: <record the actual base SHA when creating this task>
allowed_scope:
  - docs/validation.md
contracts:
  inputs: Current root AGENTS.md and package scripts.
  outputs: The page points to commands that exist and describes their purpose accurately.
acceptance:
  - Every command changed in the page exists in package.json or is explicitly identified as a standalone script.
  - Markdown links introduced by the change resolve within the repository.
prohibited_changes:
  - Runtime source, workflow configuration, package scripts, or validation thresholds.
dependencies: []
integration_owner: none; this task changes no shared interface.
implementation_checks:
  - Inspect the referenced package scripts and changed links; docs-owner.
integration_checks:
  - None beyond the documentation consistency check; docs-owner.
risks:
  - A renamed script could make the documentation inconsistent if package.json changes concurrently.
escalation_owner: maintainer
scope_overrun_action: Stop and re-slice if a script or runtime change appears necessary.
```

## Example B: high-risk protocol/solver contract change

```yaml
task_id: example-protocol-solver-endpoint-semantics
goal: Change a hypothetical pose-package endpoint sampling rule while preserving the declared duration boundary.
owner: motion-core-owner
base_sha: <record the actual base SHA when creating this task>
allowed_scope:
  - packages/motion-core/src/document.ts
  - packages/motion-core/src/quality-probe.ts
  - packages/motion-core test files directly covering document sampling
contracts:
  inputs: A normalized document with explicit duration and sample rate.
  outputs: Samples remain deterministic and the final timestamp equals duration exactly; protocol identity/version changes are coordinated if output semantics change.
acceptance:
  - timestamps.at(-1) === duration for integer and non-integer duration-times-rate cases.
  - The changed real sampling path is covered by regression tests; a protocol/package fixture is regenerated only if the contract requires it.
  - Any solver semantic change updates the service/solver revision and confirms the expected artifact identity behavior.
prohibited_changes:
  - Web UI, server transport, unrelated solver optimization, or weakening existing semantic checks.
dependencies:
  - Freeze the endpoint contract with the protocol integration owner before parallel implementation.
integration_owner: protocol-integration-owner
implementation_checks:
  - Targeted document sampling tests and affected typecheck; motion-core-owner.
integration_checks:
  - Real package/service path, protocol contract/golden checks, and required CI on the final head SHA; integration-owner.
risks:
  - Endpoint truncation, artifact identity drift, or browser/server output divergence.
escalation_owner: maintainer plus protocol-integration-owner
scope_overrun_action: Stop if the change requires an unplanned schema, identity, or cross-package interface migration; agree a new brief first.
```

This second example is hypothetical and does not authorize modifying current solver or protocol behavior.
