# eToro Dashboard Design Concepts

Status: review draft  
Created: 2026-05-28

These are three deliberately different read-only dashboard directions for the
local eToro Dashboard. All options keep credentials server-side, avoid trading
actions, avoid investment advice, and treat enrichment as context only.

## Option 1: Loss Lab

Anti-PnL risk laboratory. The first screen asks what can hurt the account,
how fast, and whether the process is improving.

- First screen: source strip, Drawdown Map, Exposure Stack, Decision Quality
  Docket, and Position Autopsy table.
- Visual language: forensic, high contrast, matte charcoal, off-white panels,
  amber for caution, red only for true breach states, minimal green.
- Financial model: server-normalized risk contribution, gross/net exposure,
  concentration, leverage, stale-data count, drawdown from synthetic snapshots,
  and enrichment coverage.
- Enrichment: SEC companyfacts, ownership filings, ETF holdings/factsheets,
  issuer context, RSS/news context, and provider freshness.
- Interactions: filter by breaches, stale data, no thesis, concentration,
  weak enrichment, leverage, or missing ETF look-through.

## Option 2: Narrative Ledger

Editorial intelligence desk. Positions and watchlist items become evolving
stories: what changed, what is known, what is missing, and why it surfaced.

- First screen: Market Brief strip, Today Stories feed, position story index,
  confidence/risk rail, catalyst ticker, and research queue.
- Visual language: newsroom layout, graphite background, off-white text,
  verified-source blue, risk amber, data-quality green, uncertainty gray.
- Financial model: `NarrativeStory` objects composed from read-only positions,
  watchlist items, provider readiness, risk checks, SEC/ETF/news enrichment,
  and source coverage.
- Enrichment: Stock-Analyst-style evidence cards with source, retrieved time,
  freshness, record completeness, conflict state, and neutral context.
- Interactions: expand stories, inspect timelines, pin items to review, filter
  by catalyst, stale data, high exposure, missing records, or review state.

## Option 3: Triage Control

Clinical mission control. The dashboard treats each holding, source gap, and
provider anomaly as a case in a triage queue.

- First screen: command strip, Portfolio Triage Queue, Active Case Bay,
  Anomaly Stack, Action Queue, and Audit Timeline.
- Visual language: operating-room density, thin grid lines, compact panels,
  sparse severity colors, and explicit read-only/blocked labels.
- Financial model: `Case = portfolio observation + anomaly classification +
  evidence bundle + allowed review actions`.
- Enrichment: eToro status, demo PnL, risk radar, research desk, bot telemetry,
  SEC/companyfacts, ETF/issuer records, news context, and simulation vetoes.
- Interactions: keyboard-first case review, severity/source/freshness filters,
  session-only acknowledgements, and drilldowns to existing tabs.

## Recommended Review Path

1. Choose the primary operating metaphor: risk lab, narrative desk, or triage
   control.
2. Decide whether the selected design becomes the default first screen or a new
   tab beside the existing Overview/Risk/Research/Bot surfaces.
3. Build the first version with synthetic/read-only DTOs only.
4. Add server-side redaction tests before exposing any live provider fields.

The accompanying static design board is at
`docs/designs/etoro-dashboard-concepts.html`.
