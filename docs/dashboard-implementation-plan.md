# eToro Dashboard Implementation Plan

Status: draft
Created: 2026-05-09

## Persona Review Summary

- Senior UX/UI Designer: build a dense operational dashboard, not a landing page. Prioritize data freshness, account state, exposure, and table scanning.
- Product And Operations Reviewer: ship read-only flows first. Make real/demo mode, stale data, and provider failures visible.
- Security And Privacy Engineer: keep eToro credentials server-side, redact logs, avoid storing private portfolio data by default, and do not add trading routes in the first milestone.
- Data Model And API Contract Reviewer: normalize eToro responses into internal DTOs before UI use. Treat provider schema drift as a contract event.
- QA And Test Architect: cover auth failures, rate limits, malformed responses, stale data, redaction, and disabled trading behavior before live credentials are used.

## 2026-05-16 Review Notes

Small safe fixes selected for this slice:

- Keep the demo ticket preview as validation-only, but block close-position
  preview tickets until a separate audited close-flow design exists.
- Cap cash amount previews at the existing simulation budget ceiling so local
  preview copy cannot imply unbounded order sizing.
- Cover both behaviors with focused route tests that prove submitted
  instrument/position identifiers are not echoed.

Large improvements to plan separately:

- Choose the long-term app stack only after current Node/static DTO contracts,
  read-cache behavior, and safety states are stable. A framework migration
  should include client/server import guards, secret scanning, browser smoke
  tests, and accessibility checks in the same branch.
- Add durable read/audit storage before any execution preview expands beyond
  local validation. Use append-only redacted events, retention rules, and export
  tests before exposing reports.
- Implement SEC companyfacts and SEC ownership adapters as server-side,
  cached, official/free-source context providers before optional key-based
  enrichers or scraping fallback.
- Replace duplicated dashboard/Money-maker simulation constants with a
  versioned shared contract or generated snapshot workflow once the separate
  worker stabilizes.
- Define the dashboard authentication and hosting model before exposing bot
  config mutation or provider status beyond localhost.
- Add Playwright smoke coverage for tab loading, fixture watermarks, disabled
  execution controls, and redacted provider-failure states.

## Recommended Stack

Historical recommendation: use TypeScript with Next.js App Router for the first
implementation. The current implementation is a dependency-free Node/static
read-only spike; keep using that path until the local API contracts and safety
states are stable enough to justify a framework migration.

Initial libraries:

- `zod` for environment, provider response, and DTO validation.
- `@tanstack/react-query` for client-side read caching of internal API responses.
- `recharts` or `visx` for charts after table and summary contracts are stable.
- `pino` with redaction for server logs.
- `vitest`, Testing Library, MSW, and Playwright for unit, integration, and smoke coverage.
- ESLint, Prettier, `tsc --noEmit`, `npm audit`, and a secret scanner such as `gitleaks`.

## Product Shape

The dashboard should grow as a tabbed workspace rather than a single fixed view. Start with the operational cockpit, then add focused views behind tabs as their API contracts stabilize.

## 2026-05-31 Portfolio Requirements Refinement

The primary dashboard job is quick portfolio understanding by instrument, not
by individual position ticket. If the same stock, ETF, crypto asset, or other
instrument has multiple open positions, the default portfolio view should show
one aggregated row for that instrument. Raw positions can be available in an
expandable drilldown, but they should not be the first scanning surface.

The portfolio view should follow the eToro-style table shape from the reference
screenshot while improving analysis and context:

- Instrument/asset identity and market/category.
- Current price.
- Change for the currently selected performance period.
- Total units across all open positions in that instrument.
- Weighted average open price across positions.
- Aggregated P/L and P/L percentage.
- Total invested amount.
- Net value.
- Selected-period performance chart for the instrument.
- Context-only enrichment links/status for insider trades, financial records,
  and related news.

Each instrument row needs a performance-period toggle shared by the view or
available per row:

- 24 hours.
- 1 week.
- 1 month.
- 1 year.
- 5 years.
- Max.

Changing the period should update both the displayed change value and the chart
for that instrument. The chart is informational only and must show source and
freshness metadata. It must not imply buy/sell/hold advice.

Portfolio enrichment is useful, but must stay contextual:

- Insider trades: source-linked records, preferably official filings first.
- Financial information: source-linked fundamentals or filings coverage.
- News: source-linked related headlines or summaries.

Enrichment should appear as availability/status, links, or receipts attached to
instrument rows and detail drawers. It must not create recommendations, bot
signals, or trade triggers.

The statistics view should be a separate first-class tab or section covering:

- Performance breakdowns by period, market, asset class, instrument, and source
  freshness where available.
- Portfolio risk analysis including concentration, allocation, exposure, stale
  data, leverage/margin indicators where available, and drawdown/volatility
  style context where supported by safe data.
- Dividend expectations with breakdown by market, payout frequency, portfolio
  weight, yield, expected income, source, and confidence/coverage state.

The Money-maker 3000 control area belongs in its own bot section. It should
show current bot mode, strategy/config, budget/risk limits, allowed universe,
cadence/no-HFT posture, run history, audit events, and kill-switch state.
Execution remains disabled until a separate reviewed execution design approves
it; current controls should stay simulation/backtest-first.

Planned tabs:

1. Landing / Widgets: modular overview with key figures and draggable widget layout later. Widget interactions can open compact detail popovers for small information or navigate to a deeper tab/page when the data volume is larger.
1. Operational Cockpit: dense first-build dashboard for scanning account state, provider status, positions, watchlists, market chart, and redacted audit events.
1. Risk Radar: exposure-first view with allocation, concentration, leverage/margin indicators, stale-data warnings, and P/L movement.
1. Research Desk: watchlist, instrument discovery, symbol cards, market chart, social/read-only research feed where legally permitted, and planning states.
1. Trading: dedicated demo-first trading workspace with preview, confirmation, status, and audit. Execution must stay gated until the write-flow review checklist is complete.

Operational cockpit sections:

1. Connection and safety bar: API health, credential presence, environment, read-only mode, real/demo mode, last successful sync, and rate-limit warnings.
1. Portfolio overview: equity, cash, unrealized P/L, allocation, exposure, leverage, and margin indicators when available from official endpoints.
1. Positions table: instrument, side, units, open rate, current value, unrealized P/L, fees, leverage, stop loss, and take profit metadata.
1. Watchlists: user/default watchlists, curated lists, instrument IDs, and quick lookup. No write actions in phase one.
1. Market data: instrument lookup, price tiles, historical chart, stale-data badge, and provider timestamp.
1. Read audit: endpoint category, request ID, status, latency, and redacted error code. Do not show account identifiers or raw provider payloads.
1. Settings: credential validation status and feature flags only. Never display credential values.

## Backend Boundary

The dashboard needs a server-side backend boundary. Near term, this can remain inside the web app as route handlers or the current Node server. It does not need a separately deployed service until hosting, bot execution, multi-user auth, or durable audit storage makes that valuable.

Backend responsibilities:

- Keep eToro credentials and provider headers server-side.
- Expose typed DTOs for portfolio, positions, watchlist, market, risk, research, trade preview, and audit views.
- Cache provider reads with freshness metadata, rate-limit handling, and request coalescing so switching tabs does not create duplicate provider calls.
- Persist audit records before any mutation route is enabled.
- Keep trading under a separate module/route namespace with feature flags, idempotency, confirmation, and reconciliation.
- Keep any trading bot out of request/response routes. A bot should run as a separate worker/service with its own credentials, kill switch, hard limits, durable audit, monitoring, and read-only fallback.

Proposed structure:

- `src/server/env.ts`: validates environment variables and is never imported by client components.
- `src/server/etoro/client.ts`: the only module allowed to call eToro APIs.
- `src/server/etoro/schemas/*`: Zod schemas for raw provider responses.
- `src/server/etoro/dto/*`: normalized internal DTO mappers.
- `src/app/api/*/route.ts`: internal API routes, or the equivalent Node server routes until the final framework is selected.
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

- Build the dashboard shell, tab navigation, safety bar, overview metrics, positions table, watchlists, and market chart.
- Add loading, empty, stale, partial-error, unauthorized, and rate-limited states.
- Add responsive and accessibility checks.

### Phase 4.5: Tabbed Views

- Add the Landing / Widgets overview with a static widget layout first.
- Add Risk Radar and Research Desk using backend DTOs and shared freshness metadata.
- Keep all tabs backed by cached server responses rather than direct client/provider calls.
- Add widget interaction rules: popovers for compact detail, deep navigation for larger datasets.

### Phase 4.7: Market News Context

- Prefer licensed/provider news APIs and RSS feeds before scraping.
- Prefer free official records/APIs before scraping: SEC companyfacts for US
  stock fundamentals, SEC Forms 3/4/5 insider transaction datasets/RSS for
  insider activity, SEC N-PORT datasets plus issuer factsheets for ETF holdings
  and fees, and RSS/free APIs for portfolio news.
- Scrapling is a candidate Python ingestion library for permitted public pages,
  especially where adaptive selectors, robots.txt handling, development cache,
  and JSON/JSONL export reduce maintenance.
- Do not use anti-bot bypass, CAPTCHA bypass, proxy rotation, or stealth modes
  for financial news unless the source terms explicitly allow automated access.
- Keep ingestion server-side, source-allowlisted, rate-limited, cached, and
  separated from trading controls.
- News summaries may attach to portfolio/watchlist rows as context only; news
  cannot directly produce bot orders or recommendations.
- Neutral coverage states such as sufficient-data, mixed-records, needs-review,
  and insufficient-data may be shown per position when derived from normalized
  public financial records. Label them as record coverage, not advice or bot
  triggers.
- Insider activity should use SEC Forms 3/4/5 sources first. Finviz insider
  pages are reference/fallback only unless an allowed automated access path is
  confirmed.

### Phase 5: Audit And Export Controls

- Add a read-request audit trail.
- Add exports only after redaction controls exist.
- Test that exports exclude credentials, request headers, account IDs where possible, and raw provider responses.

### Phase 6: Trading Evaluation

- Add a dedicated demo trading tab before execution routes.
- Design demo trading execution separately before enabling submissions.
- Keep `ENABLE_TRADING_ACTIONS=false` by default.
- Require confirmation UX, idempotency, request IDs, audit logs, sandbox tests, and a dedicated review gate before any mutation route exists.

### Phase 7: Trading Bot Evaluation

- Treat the trading bot as a separate service/worker, not a UI component or route handler.
- Confirm eToro API terms, automation permissions, account scope, and jurisdiction constraints before any implementation.
- Require user auth, CSRF protection, request limits, body limits, origin policy, durable audit, idempotency, reconciliation, kill switch, hard risk limits, monitoring, alerting, and compliance review.
- Keep bot controls disabled until sandbox proof shows live routes cannot be reached accidentally.
- Use `docs/trading-bot-plan.md` as the detailed planning brief before implementation. Initial bot work is simulation monitor only; demo execution remains gated behind a separate review and feature flag.

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

- [x] Replace placeholder package scripts with real lint, typecheck, unit test, audit, and check commands.
- [ ] Confirm official eToro API access mode, scopes, demo availability, endpoint contracts, and permitted use before broad live-provider implementation.
- [ ] Validate the local read-only API spike against a demo/read eToro key.
- [ ] Add server-only environment validation and import guards so credentials cannot enter browser bundles.
- [ ] Create synthetic fixtures and DTO contract tests before rendering real portfolio, watchlist, or market data.
- [ ] Build the first dashboard slice as read-only: health/safety bar, portfolio summary placeholder, positions table, stale-data state, and redacted audit trail.
- [ ] Build switchable tabs for Landing / Widgets, Operational Cockpit, Risk Radar, Research Desk, and Trading once backend DTOs are stable.
- [x] Add read-only synthetic Risk Radar and Research Desk tabs backed by `/api/etoro/risk/status` and `/api/etoro/research/status`, with redacted safeguards and no write routes.
- [x] Add backend caching, freshness metadata, and request coalescing before tabs independently consume live provider data.
- [x] Add local-only Bot Monitor controls for predefined strategy selection,
  hard-coded budget posture, instrument universe scope, no-HFT stance, and
  Google Sheets trade-log export planning.
- [x] Add a redacted synthetic bot trade-log route and dashboard simulation
  ledger panel.
- [x] Persist simulation bot controls server-side with a safe
  `/api/etoro/bot/config` read/update API for predefined strategy, budget,
  allowed markets, allowed instrument classes, no-HFT cadence, local JSON/CSRF
  mutation protection, and Money-maker strategy compatibility rules.
- [x] Add a Research Desk market-news ingestion plan/preview for portfolio and
  watchlist context, with server-side allowlist and no trade trigger.
- [x] Attach synthetic market/news context to portfolio-position previews for
  display only; news cannot create signals or orders.
- [x] Add synthetic Research Desk source-priority, financial-record coverage
  state, and SEC insider-activity previews.
- [x] Add explicit fixture/source watermarks across overview, Risk Radar, and
  Research Desk surfaces.
- [x] Implement a fixture-backed SEC companyfacts adapter for US stock
  fundamentals; live fetching remains blocked until SEC User-Agent,
  cache/rate-limit, and terms controls are configured.
- [x] Implement fixture-backed SEC Forms 3/4/5 insider activity normalization
  before considering Finviz scraping; live fetching remains blocked until SEC
  User-Agent, cache/rate-limit, and terms controls are configured.
- [ ] Implement ETF source adapters for issuer factsheets and SEC N-PORT
  datasets where practical.
- [x] Document free API/source options for eToro Dashboard and expose the
  Research Desk provider plan through `/api/etoro/research/status`.
- [x] Add Research Desk provider fallback/readiness metadata and dashboard
  rendering for safe defaults, disabled optional key-based providers, and
  context-only output.
- [ ] Add persona review after the first dashboard slice, incorporate appropriate feedback, run a second review, then complete checks before merging to `develop`.
- [ ] Update `docs/agent-memory.md` after each implementation slice with decisions, changed files, provider assumptions, and checks run.
- [ ] Keep trading execution routes and enabled mutation controls out of scope until a separate threat model, demo-mode proof, confirmation UX, and review gate are complete.
- [x] Draft trading-bot architecture, strategy, persona-review, and dashboard-control plan.
- [x] Start the separate `Money-maker-3000` worker scaffold as simulation-only
  contracts and tests; keep provider adapters, credentials, demo execution, and
  live execution out of scope.

## Primary Risks

- Credentials leaking into browser bundles, logs, screenshots, exports, test fixtures, or git history.
- Private account identifiers, balances, positions, and P/L entering a public repository.
- Accidental live trading due to route or feature-flag confusion.
- Stale or partial market data being interpreted as current financial truth.
- UI copy drifting into investment advice or recommendations without compliance requirements.
