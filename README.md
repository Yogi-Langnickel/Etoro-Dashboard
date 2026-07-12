# Etoro Dashboard

Security-first dashboard for viewing and interacting with eToro API data.

## Status

The local read-only dashboard keeps eToro credentials server-side, exposes
normalized demo portfolio and default-watchlist views to the browser, resolves
market symbols by verified exact match, batches current-rate reads, and loads
selected-period close-price charts. It includes a gated demo trading tab with
no execution routes, briefly caches provider responses, applies short backoff
metadata for provider failures, and lazy-loads inactive tabs.

Browser watchlist and market DTOs never include provider instrument, watchlist,
price-rate, account, position, or order identifiers. Partial rate failures and
failed chart reads remain explicit; the browser does not silently substitute
fixture charts for failed provider market data.

The dashboard does not durably store account-linked provider data. Short
in-memory cache/backoff metadata is allowed for freshness and rate-limit
protection; account-linked history belongs in a separately reviewed
Money-maker worker store if it is needed later.

Research Desk financial-record context includes a fixture-backed SEC
companyfacts normalizer. It exposes normalized coverage fields only and keeps
live SEC fetching blocked until a server-side cache/rate-limit policy and SEC
User-Agent contact value are configured.

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

For fixture-only browser or Playwright checks, use the capability-denying
offline launcher. It ignores ambient eToro credentials and traps provider
fetches:

```sh
npm run start:offline
```

Then open `http://localhost:4173`. The app also accepts `ETORO_CREDENTIALS_FILE` if you want a different credential path.

The server is intentionally loopback-only. Setting `HOST` to a LAN or public
address fails closed because account-linked portfolio and watchlist reads do
not yet have an authentication or secure-session boundary.

Set `ENABLE_DEMO_TRADE_PREVIEW=true` only when you want the local server to validate and preview demo tickets. Preview responses are redacted and still do not place orders.

Set `ETORO_READ_CACHE_TTL_MS` if local read-only provider calls need a different short success-cache window. The default is `15000` milliseconds and the maximum is `300000` milliseconds. Provider 429, timeout, and 5xx failures are negative-cached for a short server-memory backoff so repeated local refreshes do not storm the provider.

Simulation bot controls are stored server-side at `${HOME}/.config/etoro-dashboard/bot-config.json` by default. The saved config contains only predefined strategy, budget, market-group, instrument-class, and low-frequency cadence choices; it does not contain credentials or enable trading. Config updates are local-dashboard only: the server requires JSON, local Host/Origin headers, and the mutation-protection token delivered in the `x-etoro-dashboard-config-token` response header from `GET /api/etoro/bot/config`; the JSON body names the required request header but does not contain the token. Writes use a serialized temp-file-and-rename path with fsync where the local filesystem supports it. Strategy, market-group, instrument-class, and cadence combinations mirror the Money-maker Python contract at `Money-maker-3000/src/money_maker_3000/contracts.py`; the repo-local snapshot in `test/fixtures/money-maker-simulation-contract.snapshot.json` makes intentional mirror updates explicit. Dashboard-selectable run modes are backtest-only; disabled execute policy metadata is visible but cannot be selected.

## Goals

- View portfolio, watchlist, market, and social-trading data through official eToro API endpoints.
- Keep credentials and privileged API calls server-side.
- Treat trading actions as opt-in, audited, and feature-gated.
- Keep demo trade execution disabled until the ticket, confirmation, audit, and order-status flow are implemented.
- Keep historical market-data/backtest work in Money-maker ahead of portfolio
  persistence, reconciliation records, or demo execution.
- Keep the repository safe to publish publicly by never committing secrets or private financial data.

## Current Recommendation

Start with a read-only dashboard:

1. API health and credential validation.
1. Portfolio snapshot and P/L views.
1. Read-only default watchlist, exact instrument lookup, and batched rates.
1. Selected-period market charts.
1. Audit-safe export/reporting.
1. Trading actions only after read-only flows, security checks, and confirmation UX are stable.

## Security

Prefer `${HOME}/.config/etoro/credentials.json` for local credentials. `.env.local` is still ignored if environment overrides are needed. Do not commit real `.env` files or credential JSON files.

Credential rules and AI coding instructions live in `AGENTS.md`. Repository security policy lives in `SECURITY.md`.

Incident review and durable bug-learning workflow lives in `docs/incidents/README.md` and `docs/memory/bug-learning.md`. New incident and qualifying bug lessons include transferability notes so the orchestrator can promote broadly useful learnings to workspace memory or affected repositories.
