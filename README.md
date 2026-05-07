# Etoro Dashboard

Security-first dashboard for viewing and interacting with eToro API data.

## Status

Project scaffold only. No live eToro integration has been implemented yet.

## Goals

- View portfolio, watchlist, market, and social-trading data through official eToro API endpoints.
- Keep credentials and privileged API calls server-side.
- Treat trading actions as opt-in, audited, and feature-gated.
- Keep the repository safe to publish publicly by never committing secrets or private financial data.

## Current Recommendation

Start with a read-only dashboard:

1. API health and credential validation.
2. Watchlists and instrument lookup.
3. Portfolio snapshot and P/L views.
4. Market data charts.
5. Audit-safe export/reporting.
6. Trading actions only after read-only flows, security checks, and confirmation UX are stable.

## Security

Copy `.env.example` to `.env.local` for local development and fill values there. Do not commit real `.env` files.

Credential rules and AI coding instructions live in `AGENTS.md`.

