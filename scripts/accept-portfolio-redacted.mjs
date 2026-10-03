// Bounded owner-authorized read-only acceptance. Emits only assertions and
// counts. No values, symbols, IDs, provider errors, credentials or raw payloads.
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { loadEtoroConfig, credentialsForEnvironment } from "../src/etoro-config.mjs";
import { fetchPortfolioSnapshot, fetchReadOnlyEndpoint } from "../src/etoro-client.mjs";
import { createEcbReferenceAdapter, fxCrossRate } from "../src/ecb-fx.mjs";

const browserContext = {};
runInNewContext(await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8"), browserContext);
const normalizeBrowserPortfolio = browserContext.EtoroBrowserContracts.normalizeLivePortfolioPayload;
const coverageCategory = (values) => values.length === 0 ? "no-rows" : values.every(Boolean) ? "all" : values.some(Boolean) ? "partial" : "none";
const monetaryFields = ["equity", "availableCash", "usedMargin", "unrealizedPnl", "frozenCash", "mirrorCash", "accountBalance"];
const instrumentFields = ["investedValue", "netValue", "unrealizedPnl", "unrealizedPnlPercent", "units", "netContracts", "averageOpenPrice", "currentPrice", "currentExposure", "positionCount", "assetCurrency"];
const category = (error) => error?.status === 401 ? "unauthorized" : error?.status === 403 ? "scope-rejected" : error?.status === 429 ? "rate-limited" : error?.code === "ETORO_TIMEOUT" ? "timeout" : /^ETORO_INVALID_/.test(error?.code ?? "") ? "invalid-contract" : error?.code === "ETORO_ACCOUNT_CONTEXT_MISMATCH" ? "account-context-mismatch" : error?.code === "ETORO_SCOPE_MISSING" ? "missing-scope" : "unavailable";
const results = { mode: "read-only", retainedData: "assertions-only", budget: { maximumEtoroReadsPerProfile: 8, aggregatePoolReadsPerProfile: 1, breakdownPoolReadsPerProfile: 1, metadataPoolReadsPerProfile: 5, publicFxReads: 1 }, profiles: {} };
try {
  const config = await loadEtoroConfig();
  for (const environment of ["real", "demo"]) {
    let reads = 0;
    const assertions = { configured: false, matchingReadScope: false, aggregateAlternativeWriteScope: false, aggregateReceived: false, breakdownReceived: false, breakdownFailure: null };
    try {
      const credentials = credentialsForEnvironment(config, environment);
      assertions.configured = true;
      const { data } = await fetchPortfolioSnapshot(environment, { credentials, fetchEndpoint: async (endpoint, options) => {
        reads++;
        if (reads > 8) throw new Error("Bounded read budget exceeded");
        try {
          const response = await fetchReadOnlyEndpoint(endpoint, options);
          if (endpoint === "privateIdentity") {
            assertions.matchingReadScope = response.data.scopes.includes(`etoro-public:trade.${environment}:read`);
            assertions.aggregateAlternativeWriteScope = environment === "real" && response.data.scopes.includes(`etoro-public:trade.${environment}:write`);
          }
          if (endpoint.endsWith("AggregatePortfolio")) assertions.aggregateReceived = true;
          if (endpoint.endsWith("InstrumentBreakdown")) assertions.breakdownReceived = true;
          return response;
        } catch (error) {
          if (endpoint.endsWith("InstrumentBreakdown")) assertions.breakdownFailure = category(error);
          throw error;
        }
      } });
      let browserContractAccepted = false;
      try {
        const cachedAt = new Date().toISOString();
        normalizeBrowserPortfolio({ ok: true, mode: "read-only", data, cache: { state: "miss", cachedAt, expiresAt: new Date(Date.parse(cachedAt) + 15000).toISOString(), ttlMs: 15000 } });
        browserContractAccepted = true;
      } catch { /* Report only the assertion, never the private DTO. */ }
      const liquidationArithmetic = data.instruments.map((row) => row.investedValue !== null && row.unrealizedPnl !== null && row.netValue !== null ? Math.abs(row.investedValue + row.unrealizedPnl - row.netValue) <= 0.02 : null);
      results.profiles[environment] = {
        state: "verified-read", reads, assertions, browserContractAccepted,
        accountFieldsAvailable: Object.fromEntries(monetaryFields.map((field) => [field, data[field] !== null])),
        instrumentFieldCoverage: Object.fromEntries(instrumentFields.map((field) => [field, coverageCategory(data.instruments.map((row) => row[field] !== null))])),
        metadataCoverageComplete: data.coverage.metadataUnresolvedCount === 0,
        unresolvedMetadataPresent: data.coverage.metadataUnresolvedCount > 0,
        unsupportedSnapshotPresent: data.coverage.unsupportedInstrumentCount > 0,
        directHoldingsPresent: data.coverage.directInstrumentCount > 0,
        copyHoldingsPresent: data.coverage.copyInstrumentCount > 0,
        arithmetic: data.arithmetic,
        liquidationArithmeticCoverage: coverageCategory(liquidationArithmetic.map((result) => result !== null)),
        liquidationArithmeticAllVerified: liquidationArithmetic.every((result) => result !== false),
        copyHoldingsStatus: data.coverage.copyHoldingsStatus,
        manualHoldingsStatus: data.coverage.manualHoldingsStatus,
        metadataStatus: data.coverage.metadataStatus,
        providerSourceTimeVerified: data.providerUpdatedAt !== null,
        breakdownSourceTimeVerified: data.breakdownUpdatedAt !== null,
        sourceTimeReason: data.providerUpdatedAt !== null ? "verified" : data.fieldReasons.providerUpdatedAt?.includes("timezone") ? "timezone-unverified" : "invalid-or-missing",
        detailsOmittedPresent: data.instruments.some((row) => row.positionsOmittedCount > 0),
        independentSourceTimes: data.providerUpdatedAt !== data.breakdownUpdatedAt,
        breakdownAvailable: data.coverage.breakdownStatus === "available",
        nativeCurrencyCoverage: coverageCategory(data.instruments.map((row) => row.assetCurrency !== null)),
        detailsIdentifierFree: data.instruments.every((row) => row.positions.every((position) => !Object.keys(position).some((key) => /id$|order|stopLoss|takeProfit/i.test(key)))),
      };
    } catch (error) {
      results.profiles[environment] = { state: "unverified", category: category(error), reads, assertions };
    }
  }
} catch { results.configuration = "unavailable"; }
try {
  const fx = await createEcbReferenceAdapter()();
  results.fx = { state: fx.freshness === "current" ? "verified-public-reference" : "stale-reference", euroBasis: fx.basis === "units-per-EUR" && fx.rates.EUR === 1, currenciesAvailable: ["USD", "AUD", "EUR", "GBP", "JPY", "CHF", "CAD", "NZD"].every((currency) => typeof fx.rates[currency] === "number" && fx.rates[currency] > 0), usdAudCrossRateVerified: fxCrossRate(fx, "USD", "AUD") !== null };
} catch { results.fx = { state: "unverified", category: "unavailable" }; }
console.log(JSON.stringify(results, null, 2));
