# eToro Dashboard Design Reset

Status: second review draft
Created: 2026-05-28
Supersedes: first draft with `Loss Lab`, `Narrative Ledger`, and `Triage Control`

The first design round was rejected because the concepts felt too similar and
too much like professional finance workstations. This reset deliberately moves
away from dark terminals, dense queues, KPI cards, and risk-lab framing.

All concepts remain read-only. They avoid trading actions, investment advice,
account identifiers, exact balances, screenshots, raw provider payloads, private
exports, and browser-side credentials. Enrichment is treated as source context,
similar to Stock Analyst receipts, not as a signal or recommendation.

## Designer Concepts

### Option 1: Glasshouse Atlas

A bright observatory for source conditions. Markets, research coverage,
provider health, and simulated bot telemetry appear as transparent climate
layers inside a glasshouse.

- First screen: a full-screen atlas with zones for portfolio shape, research
  coverage, market context, provider health, and simulation monitor.
- Visual language: daylight, frosted panes, fine grid etching, organic contour
  lines, coverage blooms, and explicit source badges.
- Interactions: lens toggles for freshness, coverage, provider posture, and
  simulation state; click any zone to inspect receipts and redaction posture.
- Strength: most transparent and source-aware.
- Risk: can become abstract if the map metaphor hides plain personal status.

### Option 2: Portfolio Planetarium

A private financial observatory. Holdings and watchlist names appear as bodies
in an orbital model, with evidence records as small moons.

- First screen: an interactive orrery where orbit bands represent asset class
  or theme, ring clarity represents enrichment completeness, and glow indicates
  recent context changes.
- Visual language: calm observatory canvas, muted starfield grid, ivory labels,
  teal source rings, and amber freshness warnings.
- Interactions: zoom from the whole system into one instrument, compare two
  bodies by normalized attributes, and open evidence moons as receipts.
- Strength: most visually memorable.
- Risk: may be too decorative or abstract for a personal account front door.

### Option 3: Soundings

A portfolio as a nautical depth chart. Holdings are islands and shoals;
concentration is a reef line; stale data is fog; freshness is a tide ruler.

- First screen: one large sea map using CSS/SVG-style shapes, not cards or
  tables. Holdings are sized by relative exposure bucket, not exact balance.
- Visual language: off-white chart paper, muted sea blue, ink labels, rust risk
  boundaries, pale green verified-source marks, and gray fog for stale data.
- Interactions: hover an island for plain status, click into a harbor view,
  scrub freshness with a tide ruler, and toggle source overlays.
- Strength: clearest creative break from the rejected finance-terminal feel.
- Risk: needs plain labels so it remains useful and not just a metaphor.

## Non-Specialist Review

A reviewer who is not a designer or finance professional evaluated the reset
brief. Their acceptance rubric:

| Area | Weight | What must be true |
| --- | ---: | --- |
| Immediate understanding | 25% | In 10 seconds, the user can tell whether the dashboard is demo or real, read-only, fresh or stale, and what needs attention. |
| Trust and restraint | 25% | No trading nudges, no hidden scores, visible sources, timestamps, fixture/live state, missing data, and privacy posture. |
| Creative distance | 20% | It must not feel like another dark, dense risk command center with renamed panels. |
| Plain language | 15% | Normal-person labels first. Expert terms only in drilldown. |
| Enrichment handling | 15% | Enrichment appears as receipts, never advice, prediction, signal, or recommendation. |

Automatic rejects: buy/sell/hold implications, unclear demo/real mode, unclear
read-only status, unexplained account numbers, stale data presented as current,
or enrichment framed as what the user should do.

## Council Proposal

Recommended direction: **Personal Soundings**.

Use `Soundings` as the base because it is calm, plain, personal, and readable
as observation rather than action. Borrow only the useful parts of `Glasshouse
Atlas`: transparent source visibility, clear receipts, and redaction posture.
Do not use `Portfolio Planetarium` as the primary direction; it is memorable,
but risks feeling abstract and less useful as the first screen.

The product should feel like a private read-only account log:

- What changed?
- What source says it?
- How fresh is it?
- What context is attached?
- What is missing?

It should not feel like a trading terminal, signal engine, command center, or
advice product.

## Council Review Options

### 1. Personal Soundings Recommended

A calm dashboard journal with a map-like account surface. First screen shows
read-only status, demo/real mode, freshness, plain observations, and
receipt-backed context.

Use for the next implementation if the goal is a personal, non-intimidating
dashboard.

### 2. Glasshouse Ledger

A transparency-first view focused on provenance, cache state, provider status,
redaction, and how each displayed fact is known.

Use if compliance clarity and auditability should dominate the first screen.

### 3. Plain Atlas

A simple map of account areas: portfolio, sources, research, risk, bot monitor,
and provider health. Less metaphor, more navigation.

Use if the dashboard needs a clear front door before adopting a stronger visual
metaphor.

## Implementation Acceptance Criteria

- Global header always shows `Read-only`, `Demo` or `Real`, provider connection
  state, last successful refresh, and stale/cache state.
- No UI affordance implies trading: no buy, sell, close, copy, rebalance,
  recommend, execute, optimize, or best-move language.
- Every metric, row, map item, chart, and enrichment card shows source and
  freshness: fixture/live, provider/public-record/RSS/synthetic, retrieved time,
  or unavailable state.
- Enrichment appears as receipts: source name, record type, retrieved time,
  coverage state, conflict/missing-data state, and context-only framing.
- Demo/real visibility never exposes account IDs, position IDs, exact balances,
  raw provider payloads, credentials, screenshots, or private exports.
- Empty, stale, rate-limited, fixture, provider-offline, and partial-data states
  are explicitly designed.
- Copy stays plain and personal: `Needs review`, `Source missing`, `Fresh`,
  `Stale`, `Fixture`, `Read-only`. Avoid finance-insider language on the first
  screen.
- Existing tabs can remain, but the first screen should become a calmer
  overview/log rather than a dense trading cockpit.
- Validation should include `npm run check` plus UI review for read-only
  labeling, fixture/source labels, stale states, absent trading controls, and no
  advice copy.

The accompanying static design board is at
`docs/designs/etoro-dashboard-concepts.html`.

Additional visually distinct option mocks are at
`docs/designs/etoro-dashboard-six-directions.html`.

## 2026-05-31 Requirement Refinement

The next design pass should stop treating the first screen as an abstract
metaphor. The user needs a practical portfolio dashboard first:

- Default portfolio view aggregates positions by instrument. Multiple positions
  in the same stock or asset appear as one summarized instrument row, with raw
  positions available through drilldown.
- The row model should include asset, price, selected-period change, units,
  weighted average open price, P/L, P/L percentage, invested amount, net value,
  and a selected-period chart.
- Period controls must support 24 hours, 1 week, 1 month, 1 year, 5 years, and
  max. The selected period drives both the row change value and chart.
- Enrichment belongs beside each instrument as context-only receipts or links:
  insider trades, financial information, and related news.
- A statistics view is required for performance breakdowns, portfolio risk
  analysis, and dividend expectations. Dividend analysis should break down by
  market, payout frequency, portfolio weight, yield, expected income, source,
  and coverage/confidence.
- A Money-maker 3000 bot section is required for simulation/backtest controls,
  strategy/config, risk limits, run history, audit events, and kill-switch
  posture. Execution controls remain disabled unless a separate reviewed
  execution design approves them.

Future design options should be visually inspectable mocks under
`docs/designs/`. They should differ structurally, not just by color palette.

## 2026-06-03 Selected Direction

The design board in `docs/designs/2026-06-02-portfolio-bot-tabs/` is rejected
as an implementation baseline. Keep it only as an archive of explored
directions.

The current preferred direction is Option 1 in a dark theme, captured as
`docs/designs/etoro-dashboard-concepts.html`. Treat it as the active visual
baseline for the next design/implementation pass:

- The primary navigation has three top-level tabs:
  - `Portfolio View`
  - `Watchlist Items`
  - `Bot Control`
- `Portfolio View` keeps the left portfolio tree/list and right context/action
  rail, but the central workspace must be split vertically:
  - Top half: selected instrument performance graph with period controls.
  - Bottom half: enrichments for the selected instrument, such as key financial
    information, related news, and insider trading records.
- Portfolio enrichments remain context-only receipts. They must not become
  advice, recommendations, bot signals, rebalance triggers, or trade triggers.
- `Watchlist Items` is a separate first-class tab, not a subsection of the
  portfolio tab. Use `docs/designs/terminal_prime.html` as the current visual
  reference for this tab: ticker tape, compact watchlist table, large selected
  instrument chart, and right-side read-only/status/log panes. Treat it as a
  mockup reference, not production code or an approved dependency model.
- `Bot Control` remains separate from portfolio and watchlist workflows. It
  should show Money-maker mode, strategy, budgets, risk stops, cadence, audit,
  run history, and locked execution posture.
- The visual style is dark, dense, and operational, but must keep the
  Glasshouse/receipt posture: source freshness, read-only mode, redaction, and
  absent execution routes are first-class.

## 2026-06-07 Composite Direction

The selected direction is now a **dark Ledger Inspector plus Bot Operations
Bay** composite:

- `Portfolio View` should use Option 2, `Ledger Inspector`, as the structural
  model, but in a darker operational theme. The instrument ledger is the first
  visual priority: aggregated rows, compact period cells, weighted average open
  price, P/L, invested amount, net value, and small selected-period charts.
- The selected-instrument inspector should keep the Ledger Inspector density:
  one large chart, a source/freshness strip, position drilldown, and receipt
  panels for filings, insider records, news, dividend context, and missing-data
  states.
- `Bot Control` should use Option 5, `Bot Operations Bay`, as the structural
  model, also in a darker theme. Money-maker controls, run-mode posture, budget
  stops, allowed universe, cadence, audit feed, and simulation ledger should
  dominate the tab.
- Portfolio data inside Bot Control remains an input-review surface only. It
  can show eligibility, exclusions, stale data, missing reconciliation, and
  blocked assets, but it must not present rebalance instructions, advice, or
  execution intent.
- The dark palette should be purposeful, not generic terminal styling: deep
  graphite background, low-glare panels, green only for positive/read-only
  status, amber for review/stale/missing data, red only for blocked/error
  states, and neutral blue or cyan for source receipts.
- This supersedes the prior `Option 1 dark` preference in this document.

Implementation note: do not change provider posture while applying this visual
direction. The design remains synthetic/read-only unless a later feature
explicitly adds server-side DTOs, validation, and tests.

### Financial Analyst Review Notes

The financial analyst review supports the dark Ledger Inspector plus Bot
Operations Bay composite, with one guardrail: every added analysis surface must
frame information as **context, confidence, freshness, and diagnostics**. Avoid
`buy`, `sell`, `hold`, `best`, `opportunity`, `rebalance`, `execute`, or any
copy that implies portfolio management advice or autonomous trading.

Portfolio View should emphasize:

- Aggregated instrument-ledger rows with selected-period contribution, exposure
  weight, source badges, stale/partial states, and row-level receipt drawers.
- Performance attribution by instrument, asset class, sector, currency,
  dividend income, FX effect, and fees placeholder, using synthetic values in
  design mocks until provider-backed DTOs exist.
- Concentration and observed-risk context for single-name, sector, country,
  currency, crypto/CFD separation, and drawdown bands. Label this as observed
  context only.
- Dividend intelligence with ex-date, pay-date, payout frequency, portfolio
  weight, yield, estimated income, source/confidence, and explicit not-modeled
  states for withholding/tax where unsupported.
- A top completeness strip for positions aggregated, prices fresh, dividend
  coverage mixed, insider data unavailable, and reconciliation missing.

Bot Control should emphasize:

- Money-maker mode, strategy configuration, simulation budget, cadence, run
  history, audit events, kill-switch posture, and provider-write absence.
- Input-readiness diagnostics such as missing data, excluded classes, stale
  inputs, unresolved symbols, or simulation-contract mismatch. Use
  `simulation coverage` or `readiness checks`, not `bot eligible`.
- Append-only audit explainability for configuration changes, fixture batches,
  provider writes absent, reconciliation gaps, and execution locked states.

## Financial Analyst Enrichment Backlog

Keep these proposals as later feature candidates. They are context and analysis
features, not advice, recommendation, or trading triggers.

### Safe For Static Or Synthetic Design Now

- Portfolio exposure attribution by asset class, market, currency, and sector
  bucket, with source labels and fixture/live watermarks.
- Period contribution view that explains which instruments drove the selected
  24h, 1w, 1m, 1y, 5y, or max portfolio movement.
- Dividend calendar preview with payout frequency, expected income range,
  source confidence, and missing-data state.
- Source-confidence matrix per instrument covering provider portfolio data,
  SEC/company filings, insider records, news/RSS, and manual notes.
- Enrichment receipt drawer for source URL/type, timestamp, provider/cache
  state, unavailable coverage, and conflict detection.
- Portfolio quality/completeness strip summarizing aggregation, freshness,
  coverage, provider fallback, and missing reconciliation states.
- Bot readiness checklist showing data freshness, simulation contract match,
  allowed universe, risk-limit completeness, reconciliation availability, and
  execution absence.
- Bot audit explainability feed showing fixture batch used, config changed,
  reconciliation missing, provider writes absent, and execution locked.
- Excluded-assets table for assets that Money-maker must ignore, such as crypto,
  CFDs, shorts, derivatives, unresolved symbols, stale rows, or missing source
  mappings.

### Later Provider-Backed Or Integration Features

- Real portfolio aggregation by instrument with position drilldown, still
  redacting account IDs, position IDs, raw payloads, and exact provider
  endpoint details from browser DTOs.
- Market price enrichment with cache age, provider fallback, stale-state
  handling, and explicit no-advice labeling.
- Company fundamentals from official/free sources such as SEC companyfacts for
  US equities and issuer factsheets or official datasets for ETFs.
- Insider activity receipts from SEC Forms 3/4/5 for US-listed instruments,
  plus clear not-covered states for non-US or unresolved instruments.
- Dividend expectation model that separates declared dividends, historical
  trailing yield, analyst/estimate-derived values if ever approved, and
  confidence/coverage state.
- Portfolio risk analytics such as concentration, currency exposure, sector
  exposure, drawdown since selected period start, and sensitivity buckets.
- Provider-backed completeness scoring from normalized server DTO fields,
  provider freshness, cache age, request timing, public-source coverage, and
  conflict detection.
- Money-maker simulation reconciliation against read-only portfolio snapshots,
  with durable audit in the worker/service, not browser state.
