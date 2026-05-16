# Provider Boundary Decisions

Status: active  
Created: 2026-05-16

## Dashboard Storage Boundary

The eToro Dashboard should not durably store account-linked data.

Allowed:

- Live read-only eToro provider responses normalized server-side.
- Short in-memory server cache/backoff metadata for rate-limit protection,
  request coalescing, and freshness display.
- Redacted browser DTOs.
- Local simulation bot config containing only strategy/budget/cadence choices.

Not allowed without a new review:

- Durable storage of account-linked dashboard data.
- Raw provider payload persistence.
- Portfolio exports, balances, holdings, position ids, order ids, transaction
  history, or reconciliation records in this repo.
- Browser-side credentials or privileged provider payloads.

If account-linked history becomes necessary, it belongs in the
Money-maker-3000 worker boundary with explicit retention, redaction,
encryption, and audit controls. The dashboard should consume redacted summaries
only.

## Provider Input Order

Use this order for the shared eToro Dashboard / Money-maker work:

1. Historical market-data inputs in Money-maker-3000.
2. Deterministic backtest fixtures and performance diagnostics.
3. Read-only portfolio-state snapshots.
4. Reconciliation records.
5. Demo execution design.

Historical market data comes first because it improves strategy validation
without account-linked persistence. Portfolio state and reconciliation are more
sensitive and should wait for a private worker-side storage design.

## Demo Execution Approval Meaning

Demo execution approval means permission to design and later run code that
sends mutation requests to eToro demo trading endpoints, such as demo order
open, close, or cancel flows.

This is not approved by read-only dashboard work, historical market-data work,
simulation ledgers, or backtest work. Until explicit demo execution approval
exists:

- Dashboard execution routes stay absent.
- Money-maker `execute` mode stays rejected/disabled.
- No eToro write credentials are loaded.
- No demo order, close, or cancel calls are made.
- Live execution remains blocked and out of scope.

Before demo execution can be implemented, define allowed strategy, environment,
instruments, amount/unit caps, leverage, order types, stop-loss/take-profit
policy, kill switch behavior, idempotency, reconciliation, audit records, and
operator confirmation.
