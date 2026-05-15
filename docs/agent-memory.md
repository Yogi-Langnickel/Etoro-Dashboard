# Etoro Dashboard Agent Memory

Status: active
Last updated: 2026-05-16

## Current Truth

- Project name: `Etoro-Dashboard`.
- Location: `/Users/yogi/Coding/projects/Etoro-Dashboard`.
- Intended repository visibility: public is acceptable only if no secrets, private financial data, screenshots, or account identifiers are committed.
- Product: security-first financial dashboard for viewing and interacting with eToro API data.
- Repo-local financial compliance instructions in `AGENTS.md` are hard overrides over workspace-general security guidance.
- Implementation has started as a static read-only cockpit mock in `src/index.html` and `src/styles.css`.
- First local live-provider slice uses a dependency-free Node server with server-only eToro credentials, read-only routes, and built-in `node:test` coverage.
- Read-only live-provider routes use a configurable short server-side cache with request coalescing, freshness metadata, and a redacted `/api/etoro/status` cache-policy summary; inactive tab status panels lazy-load on first activation so initial refreshes do not duplicate provider or planning calls.
- Planned UI direction is a switchable tab workspace: Landing / Widgets, Operational Cockpit, Risk Radar, Research Desk, and a demo-first Trading tab.
- The dashboard has a dedicated demo trading tab and non-executing preview behavior, but execution routes remain absent until a separate feature-flagged write flow is designed and reviewed. The preview/status surface hides provider endpoint paths from normal UI, exposes a permission/rate posture matrix, rejects sell-side and leverage-above-1 concepts, and bounds preview request bodies.
- The dashboard has a Bot Monitor tab backed by `/api/etoro/bot/status`, `/api/etoro/bot/strategies`, `/api/etoro/bot/runs`, `/api/etoro/bot/audit`, `/api/etoro/bot/events`, `/api/etoro/bot/trade-log`, and `/api/etoro/bot/config`; it renders synthetic strategy cards, server-persisted simulation strategy/budget/market/instrument-class/cadence controls, hard budget stops, low-frequency/no-HFT posture, simulation ledger rows, event/audit feeds, and trade-log posture. Bot config is stored as a local server file outside the repo by default and does not enable execution or account mutation.
- The dashboard has Risk Radar and Research Desk tabs backed by `/api/etoro/risk/status` and `/api/etoro/research/status`; both are synthetic/read-only, hide account identifiers/raw payloads, and expose no write routes. Research Desk now includes server-side market/news context, financial-record source priority, SEC insider transaction planning, portfolio-position context, and data-only buy/hold/sell indicators; research output cannot trigger trades.
- Overview, Risk Radar, and Research Desk surfaces now show explicit fixture/source watermarks. Risk and Research status DTOs expose a `fixtureWatermark` object stating that synthetic payloads contain no live provider responses, private account data, or raw provider payloads.
- Research Desk now exposes provider fallback/readiness metadata through `/api/etoro/research/status` and renders it in the dashboard. The metadata is synthetic and read-only: no live provider fetches, no credential values, no account identifiers, no raw payloads, and no trade or bot signal output.
- Research intelligence should prefer free official APIs/datasets first: SEC companyfacts for US stock fundamentals, SEC Forms 3/4/5 insider transaction datasets/RSS for insiders, SEC N-PORT datasets and issuer factsheets for ETFs, and RSS/free APIs for news. Scrapling is fallback only after API/RSS options are checked. Use source allowlists, robots/terms review, caching, and no trade triggers; do not use anti-bot bypass/proxy/stealth modes for finance news without explicit terms/compliance approval.
- Treat the app backend boundary as mandatory: all provider calls, credential handling, DTO normalization, caching/freshness metadata, rate-limit handling, and audit persistence belong server-side.
- A trading bot, if approved later, should be a separate worker/service with kill switch, hard limits, durable audit, monitoring, and compliance review, not code running in browser UI or request/response routes.
- Trading-bot planning lives in `docs/trading-bot-plan.md`, with the separate project plan tracked centrally as `docs/projects/money-maker-3000/README.md`: start with simulation monitor, use a separate leased worker, require durable audit/reconciliation/idempotency/risk gates, and keep demo/live execution disabled until separate review. The first local `Money-maker-3000` scaffold now exists at `/Users/yogi/Coding/projects/Money-maker-3000` with simulation contracts, budget and no-HFT guardrails, synthetic position/news context, a redacted trade-log DTO, and `node:test` coverage; it has no credential loader or provider adapter.
- Dashboard implementation plan lives in `docs/dashboard-implementation-plan.md`.
- Official eToro API documentation must be verified before implementing live API behavior.
- Default feature posture is read-only. Trading and account mutation features must stay disabled until explicitly designed, audited, and feature-gated.
- User confirmed the dashboard should not trade for now. A future trading bot may be considered, but the first acceptable direction is monitored/simulated bot telemetry in the dashboard before any execution capability.
- Every incident requires an incident review in `docs/incidents/`.
- Any bug or defect that reaches `develop` is a QA/test incident and requires incident review plus durable learning unless explicitly waived with rationale.
- Non-incident bugs still require durable learning when the root cause is likely to recur, confusing, security-sensitive, test-gap-related, or affects shared behavior.
- Incident reviews and qualifying non-incident bug lessons must include a transferability assessment: `local-only`, `workspace-general`, `family/cross-repo`, or `named repo targets`.
- Subagent closeout must report whether new learning is transferable and suggest propagation targets.
- Do not work directly on `master` or `main`; create/use a scoped branch and merge completed deliverables into `develop`.
- `master` is release/promotion only and requires explicit user direction.
- Orchestrators review new learnings after agent closeout and promote transferable items to workspace memory or affected repositories before final handoff when applicable.
- Orchestrated implementation work is done only when reviewed work is merged into `develop` and every touched repo is clean; substantial merges require two persona review iterations before merge.
- Agent/subagent implementation closeout includes review-loop notes, bug/incident-learning classification, memory/TODO updates where durable, scoped commits, push to the intended remote branch, and a clean working tree unless an explicit blocker is reported.

## Read Next

- `AGENTS.md` for non-negotiable AI coding and security rules.
- `docs/memory/security.md` for threat model and financial-app controls.
- `docs/memory/architecture.md` before choosing or changing app architecture.
- `docs/memory/etoro-api.md` before implementing eToro calls.
- `docs/memory/bug-learning.md` before fixing defects, and after fixes that teach a durable lesson.
- `docs/incidents/README.md` before classifying, fixing, or closing incidents.

## Commands

- `npm run check`: syntax check plus built-in Node tests.
- `npm run start`: serve the local read-only dashboard on `http://localhost:4173`.
- `git diff --check`: run before handoff for documentation and whitespace validation.
- Money-maker-3000: run `npm run check` from `/Users/yogi/Coding/projects/Money-maker-3000`.
- Bot simulation config defaults to `${HOME}/.config/etoro-dashboard/bot-config.json`; tests inject temporary paths. Do not commit local bot config files.

## Open Decisions

- Choose app stack later. The old Next.js-first recommendation is historical;
  the active implementation remains the dependency-free Node/static read-only
  spike until contracts and safety states are stable.
- Next bot-monitoring work should keep execution and account mutation out of scope; a future worker/backtest slice still requires separate review. Next UI hardening should start the local simulation/backtest ledger.
- Confirm authentication model for dashboard users if it will be accessible beyond the local machine.
