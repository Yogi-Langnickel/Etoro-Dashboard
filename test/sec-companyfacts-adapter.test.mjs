import assert from "node:assert/strict";
import test from "node:test";
import {
  SEC_COMPANYFACTS_ADAPTER_CONTRACT,
  normalizeSecCompanyFacts,
} from "../src/sec-companyfacts-adapter.mjs";

const fixtureCompanyFacts = {
  cik: 320193,
  entityName: "Apple Inc.",
  tickers: ["AAPL"],
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            { val: 100, fy: 2023, fp: "FY", form: "10-K", filed: "2023-11-01", end: "2023-09-30" },
            { val: 120, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [
            { val: 40, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      Assets: {
        units: {
          USD: [
            { val: 220, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      Liabilities: {
        units: {
          USD: [
            { val: 160, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      StockholdersEquity: {
        units: {
          USD: [
            { val: 60, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
    },
    dei: {
      EntityCommonStockSharesOutstanding: {
        units: {
          shares: [
            { val: 15000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-10-18" },
          ],
        },
      },
    },
  },
};

test("SEC companyfacts adapter normalizes fixture data without exposing raw payloads", () => {
  const normalized = normalizeSecCompanyFacts({
    companyFacts: fixtureCompanyFacts,
    sourceUrl: "fixture://sec/companyfacts/CIK0000320193.json",
    retrievedAt: "2026-05-17T00:00:00.000Z",
  });
  const serialized = JSON.stringify(normalized);

  assert.equal(normalized.symbol, "AAPL");
  assert.equal(normalized.entityName, "Apple Inc.");
  assert.equal(normalized.coverageState, "sufficient-data");
  assert.equal(normalized.safeguards.contextOnly, true);
  assert.equal(normalized.safeguards.noExecutionUse, true);
  assert.equal(normalized.provider.liveNetworkConnected, false);
  assert.equal(normalized.provider.rawPayloadIncluded, false);
  assert.equal(normalized.keyFigures.find((figure) => figure.label === "Revenue").value, "120 USD");
  assert.equal(normalized.keyFigures.find((figure) => figure.label === "Shares").value, "15,000 shares");
  assert.equal(serialized.includes('"facts"'), false);
  assert.equal(serialized.includes('"units"'), false);
  assert.equal(serialized.includes('"server-api-secret"'), false);
});

test("SEC companyfacts adapter contract keeps live fetching blocked by default", () => {
  assert.equal(SEC_COMPANYFACTS_ADAPTER_CONTRACT.liveFetchEnabled, false);
  assert.equal(SEC_COMPANYFACTS_ADAPTER_CONTRACT.rawPayloadPersistence, "blocked");
  assert.equal(SEC_COMPANYFACTS_ADAPTER_CONTRACT.contextOnly, true);
  assert.equal(
    SEC_COMPANYFACTS_ADAPTER_CONTRACT.requiredBeforeLiveFetch.includes("SEC User-Agent contact value"),
    true,
  );
  assert.equal(SEC_COMPANYFACTS_ADAPTER_CONTRACT.blockedUses.includes("bot strategy input"), true);
});
