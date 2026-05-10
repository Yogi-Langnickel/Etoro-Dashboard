# eToro Dashboard Implementation Plan

Status: draft
Created: 2026-05-09

## Persona Review Summary

- Senior UX/UI Designer: build a dense operational dashboard, not a landing page. Prioritize data freshness, account state, exposure, and table scanning.
- Product And Operations Reviewer: ship read-only flows first. Make real/demo mode, stale data, and provider failures visible.
- Security And Privacy Engineer: keep eToro credentials server-side, redact logs, avoid storing private portfolio data by default, and do not add trading routes in the first milestone.
- Data Model And API Contract Reviewer: normalize eToro responses into internal DTOs before UI use. Treat provider schema drift as a contract event.
- QA And Test Architect: cover auth failures, rate limits, malformed responses, stale data, redaction, and disabled trading behavior before live credentials are used.

## Recommended Stack

Use TypeScript with Next.js App Router for the first implementation. The server route boundary keeps eToro API keys, user keys, request IDs, and provider errors out of browser code while avoiding a separate backend too early.

Initial libraries:

- `zod` for environment, provider response, and DTO validation.
- `@tanstack/react-query` for client-side read caching of internal API responses.
- `recharts` or `visx` for charts after table and summary contracts are stable.
- `pino` with redaction for server logs.
- `vitest`, Testing Library, MSW, and Playwright for unit, integration, and smoke coverage.
- ESLint, Prettier, `tsc --noEmit`, `npm audit`, and a secret scanner such as `gitleaks`.

## Product Shape

First screen sections:

1. Connection and safety bar: API health, credential presence, environment, read-only mode, real/demo mode, last successful sync, and rate-limit warnings.
1. Portfolio overview: equity, cash, unrealized P/L, allocation, exposure, leverage, and margin indicators when available from official endpoints.
1. Positions table: instrument, side, units, open rate, current value, unrealized P/L, fees, leverage, stop loss, and take profit metadata.
1. Watchlists: user/default watchlists, curated lists, instrument IDs, and quick lookup. No write actions in phase one.
1. Market data: instrument lookup, price tiles, historical chart, stale-data badge, and provider timestamp.
1. Read audit: endpoint category, request ID, status, latency, and redacted error code. Do not show account identifiers or raw provider payloads.
1. Settings: credential validation status and feature flags only. Never display credential values.

## Data And API Boundary

Proposed structure:

- `src/server/env.ts`: validates environment variables and is never imported by client components.
- `src/server/etoro/client.ts`: the only module allowed to call eToro APIs.
- `src/server/etoro/schemas/*`: Zod schemas for raw provider responses.
- `src/server/etoro/dto/*`: normalized internal DTO mappers.
- `src/app/api/*/route.ts`: internal read-only API routes.
- `src/features/*`: UI features consuming internal DTOs only.
- `src/lib/redaction.ts`: shared redaction for logs, errors, and tests.

Initial internal routes:

- `GET /api/health/etoro`
- `GET /api/watchlists`
- `GET /api/watchlists/:id`
- `GET /api/instruments/search`
- `GET /api/portfolio/summary`
- `GET /api/portfolio/positions`
- `GET /api/market/:instrumentId/candles`

Do not add `/api/trading/*` routes in the first milestone.

## Implementation Phases

### Phase 0.5: Local Read-Only API Spike

- Add a dependency-free Node server before selecting the final app framework.
- Load local demo credentials from `${HOME}/.config/etoro/credentials.json` or `ETORO_CREDENTIALS_FILE`.
- Implement server-only eToro calls for identity and demo P/L using official headers.
- Keep browser responses normalized and redacted.
- Use this slice to validate credential handling, provider reachability, and response shape before broader stack selection.

### Phase 0: Decisions

- Confirm read-only milestone scope.
- Confirm local-only versus authenticated hosted dashboard.
- Confirm eToro account API access, demo availability, scopes, and official endpoint contracts.
- Add threat-model acceptance criteria before scaffolding live API calls.

### Phase 1: App Scaffold

- Create the Next.js TypeScript app on a scoped branch targeting `develop`.
- Replace placeholder scripts with lint, typecheck, unit test, and check commands.
- Add env validation and `.env.local` setup guidance.
- Add client/server import guards and secret-scanning guidance.

### Phase 2: Secure API Shell

- Implement a server-only eToro client using official authentication headers.
- Generate per-request IDs.
- Add redacted error handling.
- Add safe read-only retry and rate-limit behavior.
- Implement `GET /api/health/etoro`.

### Phase 3: Contracts And Read Data

- Add schemas and DTOs for watchlists, instrument lookup, portfolio summary, and positions.
- Use synthetic MSW fixtures only.
- Add contract tests for missing fields, wrong casing, nulls, partial failures, unexpected fields, 401/403, 429, and 5xx responses.

### Phase 4: Dashboard UI

- Build the dashboard shell, safety bar, overview metrics, positions table, watchlists, and market chart.
- Add loading, empty, stale, partial-error, unauthorized, and rate-limited states.
- Add responsive and accessibility checks.

### Phase 5: Audit And Export Controls

- Add a read-request audit trail.
- Add exports only after redaction controls exist.
- Test that exports exclude credentials, request headers, account IDs where possible, and raw provider responses.

### Phase 6: Trading Evaluation

- Add a dedicated demo trading tab before execution routes.
- Design demo trading execution separately before enabling submissions.
- Keep `ENABLE_TRADING_ACTIONS=false` by default.
- Require confirmation UX, idempotency, request IDs, audit logs, sandbox tests, and a dedicated review gate before any mutation route exists.

## Required Checks

Run these before using real credentials:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm audit --audit-level=moderate`
- Secret scan against the repository and staged diff.
- Playwright smoke coverage for dashboard states.
- Redaction tests proving headers, keys, account IDs, balances, and raw errors do not leak.

## TODO Backlog

- [ ] Replace placeholder package scripts with real lint, typecheck, unit test, audit, and check commands before implementation begins.
- [ ] Confirm official eToro API access mode, scopes, demo availability, endpoint contracts, and permitted use before broad live-provider implementation.
- [ ] Validate the local read-only API spike against a demo/read eToro key.
- [ ] Add server-only environment validation and import guards so credentials cannot enter browser bundles.
- [ ] Create synthetic fixtures and DTO contract tests before rendering real portfolio, watchlist, or market data.
- [ ] Build the first dashboard slice as read-only: health/safety bar, portfolio summary placeholder, positions table, stale-data state, and redacted audit trail.
- [ ] Add persona review after the first dashboard slice, incorporate appropriate feedback, run a second review, then complete checks before merging to `develop`.
- [ ] Update `docs/agent-memory.md` after each implementation slice with decisions, changed files, provider assumptions, and checks run.
- [ ] Keep trading execution routes and enabled mutation controls out of scope until a separate threat model, demo-mode proof, confirmation UX, and review gate are complete.

## Primary Risks

- Credentials leaking into browser bundles, logs, screenshots, exports, test fixtures, or git history.
- Private account identifiers, balances, positions, and P/L entering a public repository.
- Accidental live trading due to route or feature-flag confusion.
- Stale or partial market data being interpreted as current financial truth.
- UI copy drifting into investment advice or recommendations without compliance requirements.
