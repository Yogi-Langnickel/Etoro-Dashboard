# Etoro Dashboard

Security-first dashboard for viewing and interacting with eToro API data.

## Status

First local integration slice is in progress. The dashboard can run through a local Node server that keeps eToro credentials server-side, exposes normalized demo/account summaries to the browser, includes a gated demo trading tab with no execution routes yet, caches read-only provider responses briefly, and lazy-loads inactive tab status data to avoid duplicate refresh calls.

## Local Demo Credentials

Do not paste eToro keys into chat or commit them to the repo. Store your demo/read credentials at `${HOME}/.config/etoro/credentials.json`:

```json
{
  "baseUrl": "https://public-api.etoro.com",
  "publicApiKey": "YOUR_PUBLIC_API_KEY",
  "userKey": "YOUR_DEMO_READ_USER_KEY"
}
```

Set user-only permissions:

```sh
mkdir -p "${HOME}/.config/etoro"
chmod 700 "${HOME}/.config/etoro"
chmod 600 "${HOME}/.config/etoro/credentials.json"
```

Run locally:

```sh
npm run start
```

Then open `http://localhost:4173`. The app also accepts `ETORO_CREDENTIALS_FILE` if you want a different credential path.

Set `ENABLE_DEMO_TRADE_PREVIEW=true` only when you want the local server to validate and preview demo tickets. Preview responses are redacted and still do not place orders.

Set `ETORO_READ_CACHE_TTL_MS` if local read-only provider calls need a different short cache window. The default is `15000` milliseconds.

## Goals

- View portfolio, watchlist, market, and social-trading data through official eToro API endpoints.
- Keep credentials and privileged API calls server-side.
- Treat trading actions as opt-in, audited, and feature-gated.
- Keep demo trade execution disabled until the ticket, confirmation, audit, and order-status flow are implemented.
- Keep the repository safe to publish publicly by never committing secrets or private financial data.

## Current Recommendation

Start with a read-only dashboard:

1. API health and credential validation.
1. Watchlists and instrument lookup.
1. Portfolio snapshot and P/L views.
1. Market data charts.
1. Audit-safe export/reporting.
1. Trading actions only after read-only flows, security checks, and confirmation UX are stable.

## Security

Prefer `${HOME}/.config/etoro/credentials.json` for local credentials. `.env.local` is still ignored if environment overrides are needed. Do not commit real `.env` files or credential JSON files.

Credential rules and AI coding instructions live in `AGENTS.md`. Repository security policy lives in `SECURITY.md`.

Incident review and durable bug-learning workflow lives in `docs/incidents/README.md` and `docs/memory/bug-learning.md`. New incident and qualifying bug lessons include transferability notes so the orchestrator can promote broadly useful learnings to workspace memory or affected repositories.
