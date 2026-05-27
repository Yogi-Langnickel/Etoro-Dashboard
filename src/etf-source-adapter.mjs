export const ETF_SOURCE_ADAPTER_CONTRACT = Object.freeze({
  id: "etf-source-records",
  mode: "fixture-normalization-only",
  liveFetchEnabled: false,
  rawPayloadPersistence: "blocked",
  contextOnly: true,
  noAdvice: true,
  requiredBeforeLiveFetch: [
    "issuer and SEC source allowlist",
    "server-side cache and rate limit",
    "issuer factsheet and SEC N-PORT terms review",
  ],
  blockedUses: [
    "trading signal",
    "order parameter",
    "bot strategy input",
    "browser-side provider fetch",
  ],
});

const ETF_FIGURE_DEFINITIONS = Object.freeze([
  Object.freeze({ label: "Expense ratio", key: "expenseRatio", source: "issuer factsheet" }),
  Object.freeze({ label: "Top holdings", key: "topHoldings", source: "issuer or N-PORT" }),
  Object.freeze({ label: "Sector exposure", key: "sectorExposure", source: "issuer or N-PORT" }),
  Object.freeze({ label: "Distribution yield", key: "distributionYield", source: "issuer factsheet" }),
]);

export function normalizeEtfSourceRecord({
  symbol,
  fundName,
  issuer,
  sourceUrl = null,
  retrievedAt = null,
  factsheet = {},
  nport = {},
} = {}) {
  const normalizedSymbol = safePublicString(symbol) ?? "UNKNOWN";
  const normalizedFactsheet = factsheet && typeof factsheet === "object" ? factsheet : {};
  const normalizedNport = nport && typeof nport === "object" ? nport : {};
  const keyFigures = ETF_FIGURE_DEFINITIONS.map((definition) => {
    const value = etfFigureValue(definition.key, normalizedFactsheet, normalizedNport);

    return {
      label: definition.label,
      value: value ?? "missing",
      source: definition.source,
    };
  });
  const availableFigureCount = keyFigures.filter((figure) => figure.value !== "missing").length;

  return {
    symbol: normalizedSymbol,
    assetClass: "ETF",
    fundName: safePublicString(fundName) ?? normalizedSymbol,
    issuer: safePublicString(issuer) ?? "Unknown issuer",
    sourceState: "fixture-etf-source-records-normalized",
    coverageState: coverageStateForCount(availableFigureCount),
    coverageBasis: [
      `${availableFigureCount} of ${ETF_FIGURE_DEFINITIONS.length} ETF source fields available`,
      "normalized from fixture payload only",
      "context-only; not a trading signal",
    ],
    keyFigures,
    provider: {
      id: ETF_SOURCE_ADAPTER_CONTRACT.id,
      liveNetworkConnected: false,
      rawPayloadIncluded: false,
      sourceUrl: safePublicString(sourceUrl),
      retrievedAt: safePublicString(retrievedAt),
    },
    safeguards: {
      contextOnly: true,
      noAdvice: true,
      noExecutionUse: true,
      rawPayloadPersistence: ETF_SOURCE_ADAPTER_CONTRACT.rawPayloadPersistence,
    },
  };
}

function etfFigureValue(key, factsheet, nport) {
  if (key === "expenseRatio") {
    return formatPercent(factsheet.expenseRatio);
  }

  if (key === "distributionYield") {
    return formatPercent(factsheet.distributionYield);
  }

  if (key === "topHoldings") {
    return formatNamedWeights(firstNonEmptyArray(factsheet.topHoldings, nport.holdings));
  }

  if (key === "sectorExposure") {
    return formatNamedWeights(firstNonEmptyArray(factsheet.sectorExposure, nport.sectorExposure));
  }

  return null;
}

function firstNonEmptyArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0) ?? [];
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return `${Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatNamedWeights(values) {
  const normalized = values
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const name = safePublicString(item.name);
      const weight = typeof item.weightPct === "number" && Number.isFinite(item.weightPct)
        ? formatPercent(item.weightPct)
        : null;

      return name && weight ? `${name} ${weight}` : name;
    })
    .filter(Boolean)
    .slice(0, 5);

  return normalized.length > 0 ? normalized.join("; ") : null;
}

function coverageStateForCount(count) {
  if (count >= 4) {
    return "sufficient-data";
  }

  if (count >= 2) {
    return "mixed-records";
  }

  if (count >= 1) {
    return "needs-review";
  }

  return "insufficient-data";
}

function safePublicString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
