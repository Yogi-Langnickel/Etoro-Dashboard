# Etoro Dashboard Agent Instructions

Read this file first before inspecting or changing the project.

Canonical memory and durable docs now live in the central workspace memory repo:

- Workspace memory: `/Users/yogi/Coding/docs/workspace/agent-memory.md`
- eToro Dashboard memory: `/Users/yogi/Coding/docs/projects/etoro-dashboard/agent-memory.md`

Repo-local `docs/` files are compatibility references for existing scripts and
historical links. Prefer the central docs above for new durable memory; update
repo-local content only when a repo script, CI check, or in-repo reference still
requires a local file.

## Project Security Classification

This is a financial dashboard that may read portfolio data and may eventually place orders through the eToro API. Treat the project as security-sensitive even when the GitHub repository is public.

Read `SECURITY.md` before changing authentication, API credentials, eToro integration, persistence, exports, logging, or trading/order behavior.

These repo-local financial rules are hard overrides over workspace-level general security guidance. Workspace baselines are minimums only; never downgrade this repo to generic web-app security, validation, logging, or UX-copy assumptions.

## Non-Negotiable Rules

- Never commit secrets, API keys, user keys, OAuth tokens, refresh tokens, cookies, private account identifiers, real portfolio exports, brokerage statements, screenshots with private balances, or production `.env` files.
- Never print secrets or full authorization headers in logs, tests, screenshots, status reports, or error messages.
- Keep all eToro credentials server-side. Browser code must not receive API keys, user keys, signing secrets, or privileged tokens.
- Default to read-only behavior. Any trading, order placement, order cancellation, copy-trading, or account mutation must be behind an explicit feature flag, confirmation UI, audit logging, and test/sandbox validation.
- Do not add investment advice, recommendations, autonomous trading, or portfolio management claims unless the user explicitly defines the compliance requirements.
- Use official eToro API documentation as the source of truth for endpoints, authentication, scopes, rate limits, and terms. Verify docs before implementing live API behavior.
- Validate and normalize every external API response before it reaches UI or persistence.
- Redact sensitive data in telemetry and error reporting.
- Do not add dependencies that handle credentials, auth, finance, or cryptography without checking maintenance status and security posture.
- Do not disable type checking, linting, security checks, CSRF protection, auth checks, or TLS verification.
- Do not edit generated, dependency, vendor, or build-output files unless explicitly required.
- Do not make code, documentation, memory, dependency, or configuration changes directly on `master` or `main`.
- If a session starts on `master` or `main`, create or switch to a scoped `feature/`, `fix/`, `chore/`, or `docs/` branch before editing.
- Completed deliverables target `develop`; `master` is release/promotion only and requires explicit user direction.
- Treat work as substantial when it changes or plans behavior, architecture, API contracts, provider integration, auth, credential handling, persistence, logging, exports, financial data, trading/order behavior, UI-copy that could imply advice, dependencies, CI/release gates, or reusable workflow rules. If unsure, use the two-pass review gate.
- Developer agents must not merge substantial work into `develop` until two complete persona review iterations have run, required feedback has been addressed, and remaining feedback has been classified with rationale.
- Every incident must get an incident review in `/Users/yogi/Coding/docs/projects/etoro-dashboard/incidents/`; production, security, data-integrity, workflow, and QA/test failures are examples, not limits on the rule.
- Any bug or defect that reaches `develop` is a QA/test incident and requires an incident review plus durable learning unless explicitly waived with rationale.
- Non-incident bugs that did not reach `develop` require lightweight durable learning when the root cause is likely to recur, confusing, security-sensitive, caused by or revealed a test gap, or affected shared behavior.
- Every incident review and every qualifying non-incident bug lesson must include a transferability assessment: `local-only`, `workspace-general`, `family/cross-repo`, or `named repo targets`.
- The orchestrating assistant owns final integration quality: maintain a touched-repository inventory, review each agent's diff, run appropriate validation, commit scoped completed work, complete the two-pass review gate, merge reviewed implementation work into `develop`, review new incident and bug learnings after agent closeout, promote transferable learnings to workspace memory or affected repositories, and verify every touched worktree is clean before ending the task.
- End every task with a free, clean workstation: `git status --short --branch` must be clean in each touched repository. Exceptions are allowed only for explicit user clarifications or genuine user-resolved blockers, and the final report must state the exact question or action needed.

## Official eToro Contract References

Use the [Developer Portal](https://api-portal.etoro.com/), its
[documentation index](https://api-portal.etoro.com/llms.txt), and the official
[Agent Skill landing page](https://api-portal.etoro.com/core/ai-agents/etoro-skill)
as the current source of truth. As checked through the official MCP catalog
on 2026-10-03, the API identifies version `v1.383.0` and Agent Skill version
`1.21.0`.
Its MCP server is `https://mcp.public-api.etoro.com`.

The reference does not authorize installing the MCP server, making provider
requests, handling credentials, persisting data, or trading. Never ask a user
to paste credentials into chat. For a separately authorized integration,
dynamically discover the operation's tags, route, specification, scopes,
rate-limit group, and deprecation/replacement. Authenticate with either the
`x-api-key`/`x-user-key` pair or OAuth Bearer authentication, never both.

Treat the repository's existing `/api/v1` endpoint references as dated local
implementation contracts. They are not authority to select a current route;
the official replacement may be `v2`.

The support clarification received 2026-10-03 is paraphrased in the root README.
Search type fields may be absent; obtain instrument type IDs from the instruments
endpoint and map them through instrument-types when classification is needed.
Require an exact returned `internalSymbolFull` for symbol resolution. Equal
repeated `instrumentId` JSON properties are not additional instruments. Rates
provide ISO 8601 UTC `date`; candle `fromDate` is an ISO 8601 start timestamp.
Neither format establishes sessions or listing currency. Keep price basis,
corporate-action methodology, retention periods and model-use rights unresolved
without separate evidence; successful transport or type lookup cannot establish
those semantics or permissions.

## Recommended Architecture

- Use a server-side API boundary for all eToro requests.
- Store secrets in local `.env` files, deployment secret stores, or OS keychain tooling, never in source.
- Keep UI components data-only and side-effect-free where possible.
- Separate read-only dashboard features from mutation-capable trading features.
- Add tests for authentication failures, rate limits, malformed API responses, and redaction behavior before adding trading actions.

## Markdown Quality

- Keep Markdown files clean for markdownlint.
- Surround lists with blank lines (`MD032`).
- Use `1.` for each ordered-list item unless the repository lint config explicitly requires sequential numbering (`MD029`).

## Required Checks Before Shipping Financial Features

- Threat model updated in `/Users/yogi/Coding/docs/projects/etoro-dashboard/memory/security.md`.
- API contract notes updated in `/Users/yogi/Coding/docs/projects/etoro-dashboard/memory/etoro-api.md`.
- Validation commands documented in `/Users/yogi/Coding/docs/projects/etoro-dashboard/agent-memory.md`.
- No secret material appears in `git diff`, fixtures, docs, tests, or screenshots.
- Public repo suitability reviewed before pushing.

## Worker And Subagent Closeout

- Before fixing a defect or incident, check `/Users/yogi/Coding/docs/projects/etoro-dashboard/incidents/`, `/Users/yogi/Coding/docs/projects/etoro-dashboard/memory/bug-learning.md`, and relevant project memory notes for similar prior history.
- After fixing, record what changed in the durable location that future agents will read: incident review for incidents, `/Users/yogi/Coding/docs/projects/etoro-dashboard/memory/bug-learning.md` for recurring non-incident bugs, and focused memory files for domain-specific rules.
- In closeout, state whether any new learning is transferable and list suggested propagation targets, even when the answer is `local-only`.
- Keep the worktree clean at handoff. If unrelated user changes remain, identify them clearly instead of reverting them.

## Workspace Agent Bootstrap

This project participates in the Coding workspace orchestration policy.
Read `/Users/yogi/Coding/AGENTS.md` to resolve the accepted local `develop`
version of `codex-workspace-orchestration/AGENTS.md` and its compact workspace
memory, then apply this file and task-relevant project memory and skills.
Do not treat the branch occupying the named orchestration directory as accepted
policy without verifying its Git identity and selected authority.

Preserve the assigned role: the main assistant coordinates and delegates;
a named developer mutates only its explicitly assigned authorized surface;
a reviewer stays read-only. Opening workspace instructions does not change a
worker's role. The handoff must supply the checkout, baseline, file scope,
relevant context paths, delivery authority, validation, and stop conditions.

For a linked or relocated checkout, use `git rev-parse --git-common-dir` to
identify the primary repository and workspace. If the workspace adapter or
required context is unavailable, report that gap to the parent/user before
dependent changes. Never guess missing policy or broaden your own authority.
