import assert from "node:assert/strict";
import test from "node:test";
import {
  ETF_SOURCE_ADAPTER_CONTRACT,
  normalizeEtfSourceRecord,
} from "../src/etf-source-adapter.mjs";

test("ETF source adapter normalizes fixture factsheet and N-PORT context without raw payloads", () => {
  const normalized = normalizeEtfSourceRecord({
    symbol: " SPY ",
    fundName: "SPDR S&P 500 ETF Trust",
    issuer: "State Street",
    sourceUrl: "fixture://etf/spy/factsheet.json",
    retrievedAt: "2026-05-27T00:00:00.000Z",
    factsheet: {
      expenseRatio: 0.0945,
      distributionYield: 1.22,
      topHoldings: [
        { name: "Microsoft", weightPct: 7.1, providerAccountId: "private-account-001" },
        { name: "Apple", weightPct: 6.2 },
      ],
    },
    nport: {
      sectorExposure: [
        { name: "Information Technology", weightPct: 31.4 },
        { name: "Financials", weightPct: 13.2 },
      ],
      rawXml: "<nport-payload>private fixture raw</nport-payload>",
    },
  });
  const serialized = JSON.stringify(normalized);

  assert.equal(normalized.symbol, "SPY");
  assert.equal(normalized.assetClass, "ETF");
  assert.equal(normalized.coverageState, "sufficient-data");
  assert.equal(normalized.provider.liveNetworkConnected, false);
  assert.equal(normalized.provider.rawPayloadIncluded, false);
  assert.equal(normalized.safeguards.contextOnly, true);
  assert.equal(normalized.safeguards.noExecutionUse, true);
  assert.equal(normalized.keyFigures.find((figure) => figure.label === "Expense ratio").value, "0.09%");
  assert.equal(normalized.keyFigures.find((figure) => figure.label === "Top holdings").value, "Microsoft 7.1%; Apple 6.2%");
  assert.equal(serialized.includes("rawXml"), false);
  assert.equal(serialized.includes("nport-payload"), false);
  assert.equal(serialized.includes("private-account-001"), false);
});

test("ETF source adapter reports missing fixture coverage as review-only context", () => {
  const normalized = normalizeEtfSourceRecord({
    symbol: "GLD",
    fundName: "",
    factsheet: {
      expenseRatio: 0.4,
    },
  });

  assert.equal(normalized.symbol, "GLD");
  assert.equal(normalized.fundName, "GLD");
  assert.equal(normalized.issuer, "Unknown issuer");
  assert.equal(normalized.coverageState, "needs-review");
  assert.deepEqual(
    normalized.keyFigures.map((figure) => figure.value),
    ["0.4%", "missing", "missing", "missing"],
  );
});

test("ETF source adapter contract keeps live fetching blocked by default", () => {
  assert.equal(ETF_SOURCE_ADAPTER_CONTRACT.liveFetchEnabled, false);
  assert.equal(ETF_SOURCE_ADAPTER_CONTRACT.rawPayloadPersistence, "blocked");
  assert.equal(ETF_SOURCE_ADAPTER_CONTRACT.contextOnly, true);
  assert.equal(ETF_SOURCE_ADAPTER_CONTRACT.requiredBeforeLiveFetch.includes("issuer and SEC source allowlist"), true);
  assert.equal(ETF_SOURCE_ADAPTER_CONTRACT.blockedUses.includes("bot strategy input"), true);
});
