# Bug Learning Notes

Status: active
Last updated: 2026-05-16

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

## Transferability Assessment

Every qualifying non-incident bug lesson must state whether the learning should stay local or be considered for propagation:

- `local-only`: specific to this repository's current code, docs, or workflow.
- `workspace-general`: useful across the local workspace, regardless of project domain.
- `family/cross-repo`: reusable for public repositories, financial apps, credential handling, privacy, or security-sensitive workflows.
- `named repo targets`: likely applies to one or more specific repositories; name the candidate repositories when known.

The fixing agent records the category and suggested propagation targets. The orchestrator reviews new lessons after closeout and promotes transferable items to workspace-level memory or affected repositories when applicable.

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
- Transferability: local-only | workspace-general | family/cross-repo | named repo targets.
- Suggested propagation targets: Workspace memory, affected repos, or none.
- Links: PR, issue, incident review, or touched docs when available.
```

Do not include secrets, private account identifiers, private portfolio data, screenshots with balances, or raw third-party payloads.

## Current Lessons

### 2026-05-16: Refresh Loops Need Provider Backoff And Atomic Local State

- Symptom: Pre-merge review found repeated dashboard refreshes could retry every read-only provider 429, timeout, or 5xx failure immediately, and concurrent bot config PUTs used direct file writes.
- Root cause: The first cache only stored successful reads and the local simulation config store did not treat file replacement as a reliability-sensitive mutation.
- Prevention: Cache short redacted backoff metadata for transient provider failures, leave non-transient 4xx responses uncached, and write local config through serialized temp-file rename with fsync where practical.
- Transferability: family/cross-repo.
- Suggested propagation targets: Workspace memory for external-provider dashboards and local state persistence patterns.
- Links: `src/server.mjs`, `src/bot-config-store.mjs`, `test/server.test.mjs`.

### 2026-05-10: Credentialed Provider Clients Need Host-Pinning And Strict Contracts

- Symptom: Pre-merge review found the draft eToro client would send credential headers to any configured HTTPS host and could mark malformed provider responses as successful reads.
- Root cause: The first implementation validated transport security but not provider identity, and it treated optional-looking response fields as acceptable despite official contract requirements.
- Prevention: Pin credentialed provider base URLs to an allow-list, validate documented required response wrappers/fields, and add regression tests for poisoned base URLs and malformed successful responses before merge.
- Transferability: family/cross-repo.
- Suggested propagation targets: Workspace memory for credentialed API integrations; other finance or external-provider repos.
- Links: `src/etoro-config.mjs`, `src/etoro-client.mjs`, `test/etoro-config.test.mjs`, `test/etoro-client.test.mjs`.

### 2026-05-10: Local Static Servers Must Not Serve Server Modules

- Symptom: Pre-merge review found the local server could serve backend modules from `src/` as browser assets.
- Root cause: Static serving used the source directory as its root without a public asset allow-list.
- Prevention: Serve only known public assets, return controlled 404s for malformed or private paths, and cover server-module requests in tests.
- Transferability: family/cross-repo.
- Suggested propagation targets: Workspace memory for local web app scaffolds.
- Links: `src/server.mjs`, `test/server.test.mjs`.
