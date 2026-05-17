import assert from "node:assert/strict";
import test from "node:test";
import {
  SEC_OWNERSHIP_ADAPTER_CONTRACT,
  normalizeSecOwnershipFilings,
} from "../src/sec-ownership-adapter.mjs";

test("SEC ownership adapter normalizes fixture filings without raw payloads", () => {
  const normalized = normalizeSecOwnershipFilings({
    symbol: "AAPL",
    issuerName: "Apple Inc.",
    sourceUrl: "fixture://sec/ownership/AAPL/forms-3-4-5.json",
    filings: [
      {
        formType: "4",
        filedAt: "2026-01-08T00:00:00.000Z",
        reportingOwner: "Example Director",
        relationship: "Director",
        transactionCode: "P",
        shares: 1200.4,
        rawXml: "<ownershipDocument>secret raw fixture</ownershipDocument>",
      },
      {
        formType: "4",
        filedAt: "2026-01-02T00:00:00.000Z",
        reportingOwner: "Example Officer",
        relationship: "Officer",
        transactionCode: "S",
        shares: 500,
      },
    ],
  });
  const serialized = JSON.stringify(normalized);

  assert.equal(normalized.symbol, "AAPL");
  assert.equal(normalized.sourceState, "fixture-sec-ownership-normalized");
  assert.equal(normalized.netDirection, "mixed-context");
  assert.equal(normalized.provider.liveNetworkConnected, false);
  assert.equal(normalized.provider.rawPayloadIncluded, false);
  assert.equal(normalized.safeguards.noExecutionUse, true);
  assert.equal(normalized.recentFilings[0].transactionDirection, "purchase-or-acquisition");
  assert.equal(normalized.recentFilings[0].shares, 1200);
  assert.equal(serialized.includes("rawXml"), false);
  assert.equal(serialized.includes("ownershipDocument"), false);
  assert.equal(serialized.includes("server-api-secret"), false);
});

test("SEC ownership adapter contract keeps live fetching blocked by default", () => {
  assert.equal(SEC_OWNERSHIP_ADAPTER_CONTRACT.liveFetchEnabled, false);
  assert.equal(SEC_OWNERSHIP_ADAPTER_CONTRACT.rawPayloadPersistence, "blocked");
  assert.equal(SEC_OWNERSHIP_ADAPTER_CONTRACT.contextOnly, true);
  assert.equal(
    SEC_OWNERSHIP_ADAPTER_CONTRACT.requiredBeforeLiveFetch.includes("SEC User-Agent contact value"),
    true,
  );
  assert.equal(SEC_OWNERSHIP_ADAPTER_CONTRACT.blockedUses.includes("bot strategy input"), true);
});
