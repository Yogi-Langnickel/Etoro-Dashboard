# eToro API Notes

Status: active
Last updated: 2026-05-07

## Current Source Of Truth

Use official eToro documentation before implementing or changing API behavior:

- eToro Developer Portal: `https://api-portal.etoro.com/`
- eToro Builders Portal: `https://builders.etoro.com/`

Public material currently describes API access for market data, portfolios, watchlists, feeds, and trading functions. It also indicates API access may require account verification and developer/API keys.

## Implementation Rules

- Do not infer endpoints from unofficial SDKs or examples when official docs are available.
- Do not hard-code API keys, user keys, account ids, or instrument ids as private user data.
- Treat OpenAPI/spec changes as contract changes and update tests.
- Prefer read-only endpoints first.
- Respect rate limits and request-id requirements when documented.

## Questions To Confirm

- Is API access already enabled on the user's eToro account?
- Is there a sandbox/demo environment available for this account?
- Which scopes are needed for the first read-only dashboard milestone?
- Are trading/order endpoints in scope for this project, or only viewing/reporting?

