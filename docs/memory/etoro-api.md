# eToro API Notes

Status: active
Last updated: 2026-05-14

## Current Source Of Truth

Use official eToro documentation before implementing or changing API behavior:

- eToro Developer Portal: `https://api-portal.etoro.com/`
- eToro Builders Portal: `https://builders.etoro.com/`

Public material currently describes API access for market data, portfolios, watchlists, feeds, and trading functions. It also indicates API access may require account verification and developer/API keys.

## Verified Integration Notes

- Current official REST base URL: `https://public-api.etoro.com`.
- Required request headers: `x-request-id` with a UUID, `x-api-key` for the public API key, and `x-user-key` for the user-specific key.
- Identity smoke endpoint: `GET /api/v1/me`.
- First portfolio endpoint for the local demo slice: `GET /api/v1/trading/info/demo/pnl`.
- Verified demo trading reference endpoints:
  - `POST /api/v1/trading/execution/demo/market-open-orders/by-amount`.
  - `POST /api/v1/trading/execution/demo/market-open-orders/by-units`.
  - `POST /api/v1/trading/execution/demo/market-close-orders/positions/{positionId}`.
  - `GET /api/v1/trading/info/demo/orders/{orderId}`.
- Credentials for local development live outside the repo at `${HOME}/.config/etoro/credentials.json` by default.
- Do not expose provider headers, keys, raw credentials, or raw provider errors to browser code.

## Implementation Rules

- Do not infer endpoints from unofficial SDKs or examples when official docs are available.
- Do not hard-code API keys, user keys, account ids, or instrument ids as private user data.
- Treat OpenAPI/spec changes as contract changes and update tests.
- Prefer read-only endpoints first.
- Respect rate limits and request-id requirements when documented.
- Treat demo and real keys as separate credentials. Use demo/read permissions for the first integration slice.
- Keep all local integration endpoints read-only until mutation flows have a separate threat model, feature flag, audit path, and review gate.
- When provider payloads omit display-ready balance fields, derive user-facing financial KPIs only from documented formulas and cover those formulas with regression tests.
- Demo trading UI may be introduced before execution routes, but write endpoints stay absent until the feature flag, confirmation UX, order audit, and result-polling contract are implemented.
- `ENABLE_DEMO_TRADE_PREVIEW=true` enables local ticket validation/preview only. Preview routes must not call provider execution endpoints or echo raw instrument, position, account, key, or order identifiers.
- Bot monitor DTOs are synthetic and internal-only. `/api/etoro/bot/trade-log`
  is a redacted simulation ledger route, not a provider trade-history route.
  It must not expose account IDs, provider order IDs, position IDs, raw payloads,
  or replayable order details.
- Market/news context attached to positions is display-only. It must not be
  converted into eToro order parameters or strategy signals without a separate
  provider contract review and compliance/security gate.

## Questions To Confirm

- Is API access already enabled on the user's eToro account?
- Which scopes are needed for the first read-only dashboard milestone?
- Which first demo trading execution should be implemented: open by amount, open by units, close position, or order-status polling?
