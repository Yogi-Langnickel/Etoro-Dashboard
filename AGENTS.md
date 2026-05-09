# Etoro Dashboard Agent Instructions

Read this file first before inspecting or changing the project. Then read `docs/agent-memory.md`, which is the compact project memory. Only lazy-load focused files in `docs/memory/` when relevant.

## Project Security Classification

This is a financial dashboard that may read portfolio data and may eventually place orders through the eToro API. Treat the project as security-sensitive even when the GitHub repository is public.

Read `SECURITY.md` before changing authentication, API credentials, eToro integration, persistence, exports, logging, or trading/order behavior.

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
- Developer agents must not merge substantial work into `develop` until two complete persona review iterations have run, required feedback has been addressed, and remaining feedback has been classified with rationale.
- The orchestrating assistant owns final integration quality: maintain a touched-repository inventory, review each agent's diff, run appropriate validation, commit scoped completed work, and verify every touched worktree is clean before ending the task.
- End every task with a free, clean workstation: `git status --short --branch` must be clean in each touched repository. Exceptions are allowed only for explicit user clarifications or genuine user-resolved blockers, and the final report must state the exact question or action needed.

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

- Threat model updated in `docs/memory/security.md`.
- API contract notes updated in `docs/memory/etoro-api.md`.
- Validation commands documented in `docs/agent-memory.md`.
- No secret material appears in `git diff`, fixtures, docs, tests, or screenshots.
- Public repo suitability reviewed before pushing.
