# Incident Reviews

Status: active
Last updated: 2026-05-09

## Policy

Every incident gets an incident review in this directory. Production, security, data-integrity, workflow, and QA/test failures are common examples, not limits on the rule.

Any bug or defect that reaches `develop` is a QA/test incident. It requires an incident review plus durable learning unless explicitly waived with rationale.

Durable learning for incidents can live in the incident review plus relevant focused memory files, TODOs, or tests. Do not require `docs/memory/bug-learning.md` for incident durable learning when that file is scoped to non-incident bug lessons.

Every incident review must include a transferability assessment so the orchestrator can decide whether the learning should propagate beyond this repository:

- `local-only`: specific to this repository's current code, docs, or workflow.
- `workspace-general`: useful across the local workspace, regardless of project domain.
- `family/cross-repo`: reusable for public repositories, financial apps, credential handling, privacy, or security-sensitive workflows.
- `named repo targets`: likely applies to one or more specific repositories; name the candidate repositories when known.

## Incident Examples

Create an incident review for every incident. Events that commonly require review include:

- Secret, credential, account, portfolio, export, logging, or screenshot exposure risk.
- Incorrect financial data display, persistence, validation, or normalization that could mislead a user.
- Unintended trading, order, account mutation, or feature-flag bypass behavior.
- Build, deployment, release, or workflow failure that reaches or blocks `develop`.
- A defect merged to `develop`, even if caught before release.
- Repeated agent workflow failure, missed review gate, or unclean handoff that creates integration risk.

## Workflow

Before fixing:

- Search this directory and relevant focused memory files for similar incidents or lessons. Search `docs/memory/bug-learning.md` only when the bug is not an incident.
- Classify whether this is security-sensitive, financial-data-sensitive, trading-related, or a QA/test incident.
- Decide what validation would have caught the failure earlier.

After fixing:

- Add an incident review file named `YYYY-MM-DD-short-title.md`.
- Capture durable learning in the incident review and, when relevant, focused memory files, TODOs, or tests.
- Record the transferability category and suggested propagation targets.
- Update focused memory files when the incident changes a project rule, security control, API assumption, architecture decision, or reusable workflow lesson.
- Leave the worktree clean at handoff, or clearly report the blocker and any unrelated user changes.

Orchestrator follow-up:

- Review new incident learnings after agent closeout.
- Promote transferable items to workspace-level memory, family/cross-repo guidance, or affected repository docs when applicable.
- Leave `local-only` items in this repository unless a later pattern shows broader reuse.

## Review Template

```markdown
# Incident Review: Short Title

Date: YYYY-MM-DD
Status: draft | reviewed | closed
Severity: low | medium | high | critical
Type: security | financial-data | trading | QA/test | workflow | other

## Summary

Briefly state what happened and who or what was affected.

## Impact

Describe user, data, security, financial, workflow, or release impact. State "none confirmed" only when checked.

## Timeline

- YYYY-MM-DD HH:MM TZ: Detection or report.
- YYYY-MM-DD HH:MM TZ: Fix or mitigation.

## Root Cause

Explain the durable cause, including missed assumptions, tests, validation, review gates, or documentation gaps.

## Resolution

Describe the fix and validation performed.

## Prevention

- Tests or checks added:
- Memory or docs updated:
- Follow-up owner and due date:

## Transferability

- Category: local-only | workspace-general | family/cross-repo | named repo targets
- Suggested propagation targets:
- Orchestrator action:

## Waiver

If durable learning is waived for a defect that reached `develop`, record the rationale here.
```
