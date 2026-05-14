# eToro Trading Bot Planning

Status: scaffold started
Created: 2026-05-12
Last updated: 2026-05-14

This document plans a future eToro trading bot, now working-named
Money-maker-3000, that is controlled and monitored through the eToro Dashboard.
It is not approval to implement execution routes. The current dashboard remains
read-only and simulation-first.

## Current Decision

- Build the bot as a separate worker/service, not browser code and not a request/response route.
- Start with simulation and monitoring only. No orders are placed in Phase 1.
- The first `Money-maker-3000` worker scaffold is local, dependency-free, and
  simulation-only. It emits redacted DTOs and does not load credentials or call
  eToro.
- Use demo-only execution before any real-money path is designed.
- Keep live trading unavailable until there is explicit user approval, eToro terms review, compliance review, strategy proof, audited controls, and a second persona review.
- Keep all credentials server-side. Browser responses must never include keys, account identifiers, raw provider payloads, or order payloads that can be replayed.
- Treat dashboard UI text as operational status, not investment advice.

## Source Checks

- eToro API authentication requires a public API key, user key, and `x-request-id`; each user key is tied to Real or Demo and to Read or Write permissions.
- eToro rate limits are currently documented as 60 requests/minute for most read endpoints and 20 requests/minute for write/execution endpoints.
- eToro demo trading endpoints exist for market open, market close, limit order, and cancellation flows. Demo endpoints must be used for all execution testing.
- eToro market orders require resolving `instrumentId` first; position close flows require `positionId`, not just a symbol.
- FINRA/SEC materials warn that auto-trading can be risky, that automated tools depend on assumptions and user inputs, and that claims of guaranteed or high consistent returns are red flags.
- U.S. day trading and margin rules can apply depending on account type, broker classification, product, and timing. The bot must avoid strategy designs that depend on frequent intraday securities trading until broker/jurisdiction constraints are explicitly reviewed.
- eToro terms and account-specific API permissions must be reviewed before any automation is enabled; API availability alone is not approval for autonomous trading.
- Any hosted dashboard adds web-app risks that are out of scope for the current local dashboard: authenticated admin sessions, CSRF protection, origin checks, request/body limits, retention policy, encrypted persistence, and breach/incident workflow.

References:

- <https://api-portal.etoro.com/getting-started/authentication>
- <https://api-portal.etoro.com/getting-started/rate-limits>
- <https://api-portal.etoro.com/guides/market-orders>
- <https://api-portal.etoro.com/api-reference/trading--demo/create-a-market-order-to-open-a-position-by-specifying-the-amount-of-cash-you-would-like-to-use-in-the-trade>
- <https://api-portal.etoro.com/api-reference/trading--demo/places-a-market-if-touched-order-similar-to-limit-order-to-open-a-position-when-a-threshold-price-is-reached>
- <https://api-portal.etoro.com/api-reference/market-data/retrieve-current-market-rates-and-pricing-information-for-specified-instruments>
- <https://api-portal.etoro.com/api-reference/agent-portfolios/get-agent-portfolios>
- <https://www.finra.org/investors/alerts/automated-investment-tools>
- <https://www.finra.org/investors/insights/auto-trading-unregistered-entities>
- <https://www.finra.org/rules-guidance/key-topics/algorithmic-trading>
- <https://www.sec.gov/investor/pubs/autotrading.htm>
- <https://www.finra.org/investors/investing/investment-products/stocks/day-trading>
- <https://www.investor.gov/introduction-investing/investing-basics/glossary/pattern-day-trader>
- <https://www.etoro.com/customer-service/terms-conditions/>

## Persona Feedback

### Financial And Stock-Trading Strategy

- Prefer simple, explainable, low-turnover strategies first. The first bot should prove process discipline, not attempt to beat markets through complexity.
- Candidate strategy families:
  - Cash-reserved dollar-cost averaging into an allowlisted instrument set.
  - Threshold rebalancing toward fixed target weights with maximum drift bands.
  - Long-only trend following using slow moving averages and strict cash fallback.
  - Volatility-targeted allocation that reduces position size when realized volatility rises.
  - Paper-only mean-reversion experiments for liquid instruments after spread/slippage modelling is in place.
- Avoid high-frequency trading, scalping, leveraged martingale/grids, revenge-trading loops, opaque AI-generated signals, social-feed-driven orders, and strategies that require continuous intraday securities trading.
- Require historical backtests, out-of-sample validation, walk-forward checks, fee/spread/slippage assumptions, and a paper-trading burn-in before demo execution.
- Require strategy-level risk budgets: max position size, max daily loss, max weekly loss, max drawdown, max turnover, max open positions, max correlated exposure, allowed instruments, allowed order types, and cooldown periods.

### Security, Privacy, And Compliance

- Keep read keys and write keys separate. Write keys must be demo-only until live execution is explicitly approved.
- Store bot credentials outside the repo, preferably in a secret store or OS keychain for local development; never expose them to browser code.
- Use a host allowlist before sending any credentialed request.
- Add a bot-specific kill switch that blocks strategy evaluation, order preview, and execution.
- Require immutable audit events for every signal, decision, skipped trade, previewed order, submitted order, order result, reconciliation result, operator override, and kill-switch change.
- Do not persist raw provider payloads by default. Persist normalized, redacted DTOs and provider correlation IDs.
- Add explicit jurisdiction/account-mode review before any real-money strategy or product scope is enabled.
- UI copy must not promise performance, recommend instruments, or frame bot output as personalized financial advice.
- Add threat-model coverage for CSRF/cross-origin POST abuse, hosted-dashboard auth bypass, status-route information leakage, JSON/body parsing denial of service, demo/real key confusion, feature-flag drift, stale-price execution, idempotency replay, duplicate submit, provider schema drift, prompt injection from social/feed/research data, compromised bot worker, and public-repo leakage through screenshots, exports, fixtures, or reports.
- Add privacy controls before persistence or hosting: retention limits, encryption at rest for audit records, role-based access to bot logs, export redaction tests, and incident workflow for private financial data exposure.
- Do not ship advice, signals, recommendations, copy-trading, public performance claims, or autonomous portfolio management without legal/compliance review. U.S., Australian, forex/commodity, derivative, CFD, and crypto rules may differ and must be mapped before live use.

### Architecture And Operations

- Build three runtime components:
  - Dashboard server: read-only status/config API and operator controls.
  - Bot worker: scheduled signal evaluation, simulation, optional demo execution, and reconciliation.
  - Durable store: strategy configs, strategy versions, run ledger, audit log, simulated trades, execution intents, and reconciliation snapshots.
- The dashboard server must not become the executor. It can expose bot status, event, run, and control DTOs, but strategy evaluation and provider mutation belong to the worker.
- Use a durable scheduler. Do not use browser timers or request-triggered work. One active worker should hold a lease; missed heartbeats should pause scheduling rather than fail open.
- Keep the worker state machine explicit:
  - `DISABLED`
  - `SIMULATING`
  - `PAPER_READY`
  - `DEMO_ARMED`
  - `DEMO_EXECUTING`
  - `PAUSED`
  - `KILLED`
  - `ERROR`
- Execution intents should be idempotent and single-use. The worker should persist an intent before calling eToro and reconcile the outcome after provider response.
- Execution intent state must be separate from worker mode: `draft -> risk_checked -> approved_demo_allowed -> queued -> submitted -> acknowledged -> reconciled -> terminal`.
- Terminal execution states should include `filled`, `cancelled`, `rejected`, `expired`, `manual_intervention`, and `unknown_provider_state`.
- Use conservative scheduling and API budgets. The worker must reserve rate-limit headroom for dashboard reads and emergency close/cancel flows.
- Reconcile open positions and orders on startup, after every execution, and on a periodic timer.
- Fail closed on missing config, stale data, schema drift, 429 storms, unknown instrument IDs, mismatched environment, stale portfolio snapshot, or failed reconciliation.
- Add circuit breakers for 401/403, 429, repeated 5xx, schema drift, stale data, reconciliation mismatches, lease contention, and cost/rate-budget exhaustion.

### Product, UX, And Operator Workflow

- Dashboard control surface should include:
  - Bot mode and environment badge: simulation, demo, live-unavailable.
  - Kill switch and pause/resume controls.
  - Strategy registry with version, status, allowed instruments, risk budget, and last validation result.
  - Simulation ledger showing signals, skipped trades, hypothetical fills, P/L, drawdown, turnover, and reason codes.
  - Order preview panel with redacted instrument/order details and explicit "not submitted" status.
  - Audit stream for operator actions and bot decisions.
  - Reconciliation panel for positions/orders known by the bot versus provider state.
  - Alert panel for stale data, rate-limit pressure, schema drift, risk-limit blocks, and disabled write keys.
  - "Why no trade" panel that shows vetoes and skipped decisions as clearly as submitted or simulated trades.
  - Drift panels for signal distribution, paper-vs-backtest divergence, fill quality, slippage assumptions, rejected orders, turnover, exposure, concentration, and risk budget remaining.
- Use operational labels such as "signal", "candidate order", "blocked by risk limit", "simulation fill", and "demo order". Avoid words like "recommended buy" or "guaranteed".
- Never place execution controls next to research/news/social-feed content. Keep strategy monitoring separate from subjective research views.
- Require confirmation modals only for state changes, not every status read. High-friction controls belong around arming, enabling demo execution, changing risk limits, and disabling the kill switch.
- If the dashboard becomes hosted, hide planned provider endpoint details and credential-source details from normal UI. Keep environment, key permission, freshness, stale warnings, and mutation-lock status visible.

### QA, Risk, And Data Contract

- Add tests before execution code:
  - Strategy config validation.
  - Instrument allowlist enforcement.
  - Rate-limit budget enforcement.
  - Stale market data blocks.
  - Risk-limit blocks.
  - Idempotency and duplicate-intent prevention.
  - Environment mismatch blocks.
  - Provider schema drift.
  - CSRF/origin/body-size controls before any POST control route is hosted.
  - Redaction of credentials, account identifiers, raw payloads, and order tokens.
  - Startup reconciliation after partial failure.
  - Crash recovery after persisting an intent before provider submit.
  - Lease contention between two workers.
  - Duplicate submit prevention across retries and process restarts.
  - Kill-switch behavior across signal, preview, and execution stages.
- Backtesting must include fixture versioning and deterministic seed data. The same strategy version and data fixture should reproduce the same decisions.
- Add negative tests proving live execution routes are absent until the live-trading feature gate exists.

### Cost And Reliability

- Keep the first bot local or single-worker. Avoid always-on cloud resources until simulation value is proven.
- Use a low-frequency schedule first, such as hourly or daily, so API limits and operational noise stay manageable.
- Cache static metadata such as instrument IDs and exchanges. Do not repeatedly resolve symbols during every evaluation.
- Add bounded retries with exponential backoff for read requests; do not retry execution blindly.
- Persist enough audit/reconciliation data to recover after worker restart without replaying orders.

## Proposed Architecture

```text
Dashboard UI
  -> Dashboard server APIs
       -> Bot control/config APIs
       -> Read-only eToro provider APIs
       -> Audit/read model APIs

Bot worker
  -> Durable scheduler and lease/heartbeat
  -> Strategy evaluator
  -> Risk engine
  -> Execution planner
  -> Simulation ledger
  -> Demo execution adapter, disabled by default
  -> Reconciliation loop

Durable store
  -> Strategy configs and versions
  -> Instrument allowlists
  -> Risk budgets
  -> Signals and decisions
  -> Execution intents and results
  -> Audit events
  -> Reconciliation snapshots
```

## Core Contracts

- `BotRun`: `runId`, `strategyVersion`, `environment`, `mode`, `leaseOwner`, `heartbeatAt`, `state`, `startedAt`, `stoppedAt`, `stopReason`.
- `DecisionEvent`: `eventId`, `runId`, `observedAt`, `inputsRef`, `decision`, `confidenceBucket`, `riskResult`, `createdAt`.
- `ExecutionIntent`: `intentId`, `idempotencyKey`, `environment`, `instrumentRef`, `side`, `sizing`, `limits`, `state`, `expiresAt`.
- `AuditEvent`: append-only actor, action, entity refs, request id, redacted provider status, timestamp, and optional hash-chain field if tamper evidence matters.
- `ReconciliationReport`: `intentId`, `providerOrderRef`, `expectedState`, `observedState`, `difference`, `severity`, `nextAction`.
- Dashboard DTOs expose only redacted summaries: bot status, pending counts, latest safe events, circuit-breaker state, stale-data state, reconciliation alerts, and kill-switch status.

## Strategy Contract

Every strategy must define:

- `strategyId`
- `version`
- `mode`: `simulation`, `demo`, or `live-unavailable`
- `instrumentAllowlist`
- `timeframe`
- `dataRequirements`
- `entryRules`
- `exitRules`
- `positionSizingRules`
- `riskLimits`
- `cooldownRules`
- `maxTurnover`
- `expectedHoldingPeriod`
- `slippageAndFeeModel`
- `backtestDataset`
- `approvalStatus`

Every decision must produce:

- signal timestamp
- input snapshot hash
- strategy version
- intended action
- reason code
- risk-check result
- execution eligibility
- redacted order preview
- audit event id

## Risk Engine Minimums

The bot must block when any of these conditions is true:

- Global kill switch is active.
- Strategy is not approved for the current mode.
- Current environment does not match the key environment.
- Market data is stale or missing.
- Instrument is not on the allowlist.
- Position size exceeds configured cap.
- Daily, weekly, or strategy drawdown limit is breached.
- Trade count or turnover limit is breached.
- Existing open position/order conflicts with the proposed intent.
- Strategy lease is stale, duplicated, or missing.
- Provider returns 401, 403, 429, unknown schema, or ambiguous order result.
- Reconciliation is stale or failed.
- Execution intent is expired, already submitted, or missing a durable audit pre-write.

Initial hard defaults:

- Live execution: disabled.
- Demo execution: disabled until Phase 3.
- Leverage: 1 only.
- Shorts: disabled.
- Copy trading: disabled.
- Social/feed-driven signals: disabled.
- Crypto-only or single-asset strategies: allowed only in simulation until volatility-specific limits exist.
- Max open positions: strategy-defined, but default 1 for the first demo strategy.
- Max order frequency: no more than one submitted demo order per strategy per evaluation window.

## Dashboard Implementation Plan

### Phase 1: Simulation Monitor

- [x] Add `GET /api/etoro/bot/strategies` for synthetic strategy registry.
- [x] Add `GET /api/etoro/bot/runs` for recent simulated decisions.
- [x] Add `GET /api/etoro/bot/audit` for redacted bot events.
- [x] Add `GET /api/etoro/bot/events` for safe, paginated recent decision/audit summaries.
- [x] Add `GET /api/etoro/bot/trade-log` for redacted synthetic simulation ledger rows.
- [x] Extend the existing Bot Monitor tab with strategy cards, simulation ledger, event feed, redacted audit feed, and kill-switch status.
- [x] Add local-only dashboard strategy and budget selectors backed by predefined
  synthetic DTOs. Browser changes are not persisted to worker config.
- [x] Start `/Users/yogi/Coding/projects/Money-maker-3000` with simulation
  contracts, budget/cadence guardrails, position-news context, and tests.
- Keep all data synthetic or from read-only provider routes.

Acceptance:

- No execution routes exist.
- UI clearly says simulation only.
- Tests prove no account identifiers, secrets, or raw provider payloads appear in bot responses.

### Phase 2: Backtest And Paper Ledger

- Add local deterministic backtest fixtures.
- Add a strategy evaluator interface and one low-turnover sample strategy in simulation only.
- Add a paper trade ledger that models fills, spread, fee/slippage assumptions, and rejected signals.
- Show performance as educational diagnostics: drawdown, turnover, win/loss distribution, and benchmark comparison where appropriate. Do not show "recommended" language.

Acceptance:

- Strategy output is reproducible.
- Dashboard can compare backtest, paper, and current simulated state.
- Risk engine blocks are visible and test-covered.

### Phase 3: Demo Execution Gate

- Add demo-only execution adapter behind `ENABLE_DEMO_BOT_EXECUTION=false`.
- Add order preview and manual arming controls.
- Use demo endpoints only.
- Persist execution intent before provider call.
- Validate authenticated admin session, CSRF token, request origin, request body size, schema hard maximums, instrument allowlist, demo-only write key, server-side environment assertion, idempotency key, typed confirmation, and kill-switch state before any provider call.
- Reconcile order/position state after provider response.
- Add emergency stop that blocks new intents immediately.

Acceptance:

- Demo write key is required and separate from read key.
- Live endpoints are unreachable in code and tests.
- Every execution attempt has an audit event and idempotency key.

### Phase 4: Live Evaluation Gate

This phase is deliberately not implementation-ready.

Prerequisites:

- Written approval for live trading.
- Broker/eToro terms review for automation.
- Jurisdiction/account/product review.
- Real-money threat model and incident response plan.
- Independent strategy review.
- Dry-run, simulation, and demo burn-in evidence.
- External backup/restore and alerting plan.
- Broker/account jurisdiction mapping, strategy suitability review, and proof that demo/live routes cannot be confused.

## Dashboard Data Model Draft

- `bot_strategy`
  - id, name, version, status, mode, config JSON, risk limits JSON, created/approved timestamps.
- `bot_run`
  - id, strategy id/version, environment, mode, lease owner, heartbeat timestamp, state, started/finished timestamps, input hash, outcome.
- `bot_signal`
  - id, run id, instrument id, source data hash, action, reason code, confidence bucket, created timestamp.
- `bot_risk_check`
  - id, signal id, check name, state, limit, observed value, reason.
- `bot_execution_intent`
  - id, signal id, mode, idempotency key, environment, instrument ref, side, sizing, limits, expiry, redacted preview, provider endpoint category, status.
- `bot_execution_result`
  - id, intent id, provider correlation token hash, status, normalized result, reconciliation status.
- `bot_audit_event`
  - id, actor type, action, target type/id, request id, redacted provider status/details, timestamp, optional hash-chain field.
- `bot_reconciliation_snapshot`
  - id, mode, provider timestamp, normalized positions hash, normalized orders hash, state.

## Open Questions

- Which eToro products are available for the user account and jurisdiction, especially for U.S. access.
- Whether eToro terms permit the intended automation and any constraints on bot frequency, strategy type, or agent portfolios.
- Whether the bot should use normal demo keys first or an agent/sub-portfolio model later.
- Whether the first simulation strategy should use daily/hourly cadence and which educational instrument universe is acceptable.
- What local durable store to use before choosing a full app stack: JSONL/SQLite for local simulation, or Postgres if the dashboard becomes hosted.

## Do Not Build Yet

- Real-money order execution.
- Fully autonomous demo execution without manual arming.
- Leveraged, short, martingale, grid, scalping, social-copy, or AI-prompt-generated strategies.
- Browser-side strategy execution.
- Browser-side credential handling.
- Public screenshots or fixtures containing real balances, positions, account IDs, or provider payloads.
