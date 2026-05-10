# Incident Review: Demo PnL Equity Normalization

Date: 2026-05-10
Status: closed
Severity: medium
Type: financial-data, QA/test

## Summary

After the read-only eToro integration reached `develop`, the provider and demo account indicators showed green, but the dashboard did not display the user's high demo balance despite many open positions.

## Impact

The local dashboard could mislead the user by showing only raw cash/credit as the main demo equity metric when eToro's demo PnL payload omitted an explicit `equity` field. No credentials, private account identifiers, raw portfolio payloads, or trading actions were exposed. Trading routes remained absent.

## Timeline

- 2026-05-10: User reported that the demo account had many positions and a high balance, but those values were not showing in the dashboard.
- 2026-05-10: Live response shape was inspected with redacted shape-only scripts.
- 2026-05-10: Normalization was updated to derive equity, total invested, available cash, and unrealized P/L from the documented PnL payload.

## Root Cause

The initial normalizer handled `clientPortfolio`, `credit`, and `unrealizedPnL`, but it treated `equity` as available only when eToro supplied an explicit `equity`, `netLiq`, or `netLiquidation` field. The live demo payload instead provides position-level `amount` and `unrealizedPnL` fields plus mirror data. Tests covered wrapper validation and pending-order counts, but not the derived balance/equity formula needed when `equity` is omitted.

## Resolution

The eToro PnL DTO now derives:

- `availableCash` from `credit`, manual open orders, and general orders.
- `totalInvested` from direct positions, mirror positions, mirror available amounts, pending order amounts, and external costs.
- `unrealizedPnL` from provider portfolio P/L when present, or calculated position/mirror P/L as fallback.
- `equity` from provider equity when present, or `availableCash + totalInvested + unrealizedPnL` as fallback.

The UI now shows demo equity, available cash, unrealized P/L, total invested, and position count from the normalized DTO.

## Prevention

- Tests or checks added: DTO tests now cover derived equity, total invested, nested `unrealizedPnL.pnL`, mirror available amounts, and position counts.
- Memory or docs updated: eToro API notes now require derived metric tests when provider payloads omit display-ready balance fields.
- Follow-up owner and due date: Orchestrator, immediate with this fix branch.

## Transferability

- Category: family/cross-repo
- Suggested propagation targets: Workspace security/API baseline for third-party financial/provider integrations.
- Orchestrator action: Review whether workspace guidance should mention deriving user-facing financial KPIs only from documented formulas plus regression tests.

## Waiver

Not waived.
