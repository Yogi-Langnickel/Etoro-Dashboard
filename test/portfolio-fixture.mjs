// Synthetic documented provider shapes, never captured account data.
import { normalizeAggregatePortfolio, normalizeInstrumentBreakdown } from "../src/portfolio-contract.mjs";
export function syntheticAggregate(patch = {}) {
  return { cid: 2, timestamp: "2026-01-01T00:00:00Z", accountCurrency: "USD", accountTotals: { accountAvailableCash: 900, accountFrozenCash: 0, accountCurrentPnl: 10, accountTotalValue: 1010, accountTotalUsedMargin: 100, accountBalance: 900 }, instrumentAggregates: [{ instrumentId: 1, assetCurrency: "USD", totalMarginAccountCurrency: 100, accountCurrencyReturn: 10, liquidationValueAccountCurrency: 110, netUnits: 1, netContracts: 1, netCurrentExposureAccountCurrency: 110, netAvgOpenRate: 100 }], mirrors: [], ...patch };
}
export function syntheticBreakdown(patch = {}) {
  return { timestamp: "2026-01-01T00:00:01Z", accountCurrency: "USD", instruments: [{ instrumentId: 1, symbol: "AAA", positions: [{ positionId: 1, instrumentId: 1, assetCurrency: "USD", direction: "long", settlementType: "real", leverage: 1, units: 1, contracts: 1, openRate: 100, currentRate: 110, rateTimestamp: "2026-01-01T00:00:00Z" }], orders: [] }], mirrors: [], ...patch };
}
export function syntheticSnapshotEndpoint(endpoint) {
  if (endpoint === "privateIdentity") return { data: { realCid: 2, demoCid: 2, scopes: ["etoro-public:trade.real:read", "etoro-public:trade.demo:read"] }, provider: {} };
  if (endpoint.endsWith("AggregatePortfolio")) return { data: normalizeAggregatePortfolio(syntheticAggregate()), provider: {} };
  if (endpoint.endsWith("InstrumentBreakdown")) return { data: normalizeInstrumentBreakdown(syntheticBreakdown()), provider: {} };
  if (endpoint === "portfolioMetadata") return { data: { instruments: [{ instrumentId: 1, symbol: "AAA", displayName: "Synthetic A" }] }, provider: {} };
  return null;
}
