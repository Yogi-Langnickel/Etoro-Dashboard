# Free API Options

Status: active plan
Created: 2026-05-15

This dashboard should prefer first-party eToro reads and free official public
records before optional third-party enrichment. Every external source stays
server-side, cached, normalized, redacted, and read-only until a separate review
approves broader behavior.

## Recommended Order

1. eToro Public API
   - Primary source for eToro portfolio, demo PnL, watchlists, market lookup,
     social/read-only research, and future demo-trade review flows.
   - Requires verified account/API access and server-side API/user keys.
   - Already represented by the read-only server client and normalized DTOs.

2. SEC companyfacts/submissions
   - Free official API for US company facts, filing history, ticker/exchange
     metadata, and nightly bulk archives.
   - Best first implementation for Research Desk financial-record coverage states.

3. SEC ownership filing RSS/search feeds
   - Free official path for recent Forms 3, 4, and 5 insider activity.
   - Use before any Finviz or scraped insider fallback.

4. SEC N-PORT data sets and issuer factsheets
   - Use for ETF/fund holdings, fees, and exposure context where practical.
   - Treat issuer pages as allowlisted public-page fetches, not as guaranteed
     APIs.

5. Alpha Vantage
   - Optional key-based enrichment for stocks, forex, crypto, commodities,
     economic indicators, and technical indicators.
   - Free quotas are tight; use cache and background refresh only.

6. Twelve Data
   - Optional key-based quote/time-series fallback for equities, forex, crypto,
     and reference data.
   - Free Basic plan has per-minute/day credits; use cache and explicit opt-in.

## Implementation Plan

1. Keep eToro reads as the only live first-party provider connected by default.
2. Implement SEC companyfacts as the first non-eToro adapter for Research Desk
   financial-record coverage states.
3. Add SEC ownership RSS ingestion for insider activity before any scraping
   fallback.
4. Keep Alpha Vantage and Twelve Data as optional adapters behind server config,
   no browser-exposed keys, cache limits, and provider quota docs.
5. Keep all provider output context-only. Market/news/fundamental data cannot
   create Money-maker-3000 signals or order parameters without a separate
   simulation-only signal-contract review.

## 2026-05-16 Review Follow-Ups

Large improvements to plan before connecting additional providers:

- Document source terms, rate limits, User-Agent requirements, cache TTLs, and
  normalized DTO shape for each free source before live fetch code lands.
- Add source-specific redaction tests proving no raw provider payloads, account
  identifiers, optional API keys, or full article text reach browser responses.
- Add a small provider-readiness matrix to tests so optional key-based sources
  remain disabled until server configuration, quota handling, and terms review
  are complete.
- Keep all financial-record coverage states neutral and no-advice; do not map
  them into bot strategy fields or order parameters without a separate
  simulation-only signal-contract review.

## First Slice Implemented

- `researchIntelligenceStatus()` now exposes `freeApiOptions` so the internal
  Research Desk status route can display the provider plan without connecting
  new live providers.
- `/api/etoro/research/status` also exposes provider fallback/readiness
  metadata. It documents default providers, disabled optional key-based
  enrichers, server-side credential handling, cache/rate-limit prerequisites,
  and the rule that provider output remains context-only and cannot create bot
  signals or order parameters.
