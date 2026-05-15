# Architecture Notes

Status: active
Last updated: 2026-05-16

## Current Direction

The active implementation is a dependency-free Node/static read-only dashboard
spike until contracts, safety states, authentication, and hosting needs justify
a framework migration.

Current architecture:

- Dependency-free Node/static application with server-side routes for eToro API calls.
- UI consumes typed internal DTOs, not raw eToro responses.
- eToro client is isolated behind a server-only module.
- All API responses are validated and normalized before rendering.
- Mutation-capable API calls are separated from read-only calls and feature-gated.
- Local static servers expose only explicit public assets; backend modules and source files are not static content.
- Server-side read cache/coalescing and freshness metadata protect provider
  calls from duplicate tab refreshes.
- Read-only provider 429, timeout, and 5xx failures use short server-side
  negative-cache/backoff metadata so repeated refreshes do not storm the
  provider. Browser-facing provider errors are fixed public messages and must
  not echo raw provider text, credential header names, or credential values.
- Bot config persistence is local simulation-only state and uses serialized
  atomic temp-file rename with fsync where practical.
- Research, risk, and bot-monitoring surfaces are synthetic/read-only unless a
  separate review gate approves broader behavior.

## Milestones

1. Keep read-only eToro route/client hardening, validation, redaction,
   cache/coalescing, and provider-failure backoff in place.
1. Expand fixture watermarks and status explanations across overview, risk,
   research, and bot-monitoring surfaces.
1. Add SEC companyfacts and ownership metadata as server-side context-only
   adapters after source terms and rate limits are documented.
1. Add durable local audit/backtest storage for simulation outputs before any
   provider-backed execution preview.
1. Only then evaluate demo trading preview; execution routes remain absent until
   feature flag, confirmation UX, order audit, and result-polling contracts are
   reviewed.
