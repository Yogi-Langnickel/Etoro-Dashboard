# Security Notes

Status: active
Last updated: 2026-05-14

## Threat Model

High-impact risks:

- Exposure of eToro API credentials, user keys, OAuth tokens, cookies, or private account data.
- Browser-side leakage of privileged API credentials.
- Accidental live trading, order cancellation, copy-trading, or account mutation.
- Prompt-injection or malicious content from third-party API fields influencing trading actions.
- Market/news context being misread as trading advice or an automated order signal.
- Browser-local strategy or budget preview controls being mistaken for persisted
  worker configuration.
- Logging, screenshots, fixtures, or exports that disclose balances, account ids, holdings, or trade history.
- Public repository commits containing secrets or private financial data.

## Controls

- Server-side API boundary for all eToro requests.
- `.env.local` or deployment secret store for credentials; `.env*` ignored except `.env.example`.
- Local eToro demo credentials may also be stored outside the repo at `${HOME}/.config/etoro/credentials.json` with user-only permissions.
- Credentialed provider clients must pin allowed hosts before sending API keys or user keys.
- Trading feature flags default to false: `ENABLE_TRADING_ACTIONS=false`, `ENABLE_LIVE_ORDERS=false`.
- Bot controls remain simulation/local-preview only until a worker control API,
  authentication, CSRF/origin policy, durable audit, and review gate exist.
- Bot market/news context is display-only; it cannot trigger strategy decisions,
  order previews, demo execution, or live execution.
- Validate all external API responses before use.
- Redact sensitive fields in logs and errors.
- Use least-privilege API scopes where eToro supports them.
- Require explicit user confirmation before any mutation-capable endpoint is implemented or enabled.
- Keep test fixtures synthetic.

## Pre-Push Checklist

- Run secret scan when tooling is added.
- Review `git diff` for credential-like values, account data, screenshots, and private exports.
- Confirm no `.env.local`, private fixtures, or reports are staged.
- Confirm README and docs do not include real keys or private account identifiers.
- Confirm browser responses do not include `x-api-key`, `x-user-key`, credential file contents, or provider authorization headers.

## Current Audit Notes

- 2026-05-07: `npm install --package-lock-only` created the initial lockfile and `npm audit --audit-level=moderate` passed with no vulnerabilities.
- 2026-05-08: Branch integration rule recorded. Do not work directly on `master` or `main`; create/use a scoped branch and merge completed deliverables into `develop`.
