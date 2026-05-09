# Bug Learning Notes

Status: active
Last updated: 2026-05-09

## Purpose

Use this file for lightweight durable lessons from qualifying bugs that are not incidents and did not reach `develop`. The goal is to help future assistants and subagents avoid repeating the same root cause without creating heavyweight process for every small defect.

## When To Record A Lesson

For a bug that is not an incident and did not reach `develop`, record a lightweight bug lesson when any of these are true:

- The root cause is likely to recur.
- The failure mode was confusing or non-obvious.
- The bug touched authentication, credentials, financial data, trading behavior, logging, exports, or other security-sensitive areas.
- The bug exposed a missing, weak, or misleading test.
- The bug affected shared architecture, contracts, validation, or agent workflow.

If a bug or defect reached `develop`, do not handle it here. Treat it as a QA/test incident requiring an incident review in `docs/incidents/` plus durable learning unless explicitly waived with rationale. Incident durable learning belongs in the incident review plus relevant focused memory files, TODOs, or tests, not in this non-incident file.

## Before Fixing A Bug

- Search this file, `docs/incidents/`, and relevant `docs/memory/` files for similar prior failures.
- Check whether the likely fix changes security posture, eToro API behavior, validation, persistence, exports, logging, or trading/account mutation behavior.
- Identify the test gap before changing code when the bug reached `develop` or escaped prior validation.

## After Fixing A Bug

Add a short dated entry when the lesson qualifies. Keep entries factual and reusable:

```markdown
### YYYY-MM-DD: Short lesson title

- Symptom: What failed or surprised users.
- Root cause: The durable cause, not only the local code mistake.
- Prevention: Test, validation, workflow, or design rule that would catch it next time.
- Links: PR, issue, incident review, or touched docs when available.
```

Do not include secrets, private account identifiers, private portfolio data, screenshots with balances, or raw third-party payloads.

## Current Lessons

- None yet.
