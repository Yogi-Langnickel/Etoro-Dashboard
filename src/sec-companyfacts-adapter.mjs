const DEFAULT_ALLOWED_UNITS = Object.freeze(["USD", "shares", "USD/shares"]);

export const SEC_COMPANYFACTS_ADAPTER_CONTRACT = Object.freeze({
  id: "sec-companyfacts",
  mode: "fixture-normalization-only",
  liveFetchEnabled: false,
  rawPayloadPersistence: "blocked",
  contextOnly: true,
  noAdvice: true,
  requiredBeforeLiveFetch: [
    "SEC User-Agent contact value",
    "server-side cache and rate limit",
    "official fair-access policy review",
  ],
  blockedUses: [
    "trading signal",
    "order parameter",
    "bot strategy input",
    "browser-side provider fetch",
  ],
});

const SEC_CONCEPTS = Object.freeze([
  Object.freeze({
    label: "Revenue",
    concept: "Revenues",
    units: ["USD"],
  }),
  Object.freeze({
    label: "Net income",
    concept: "NetIncomeLoss",
    units: ["USD"],
  }),
  Object.freeze({
    label: "Assets",
    concept: "Assets",
    units: ["USD"],
  }),
  Object.freeze({
    label: "Liabilities",
    concept: "Liabilities",
    units: ["USD"],
  }),
  Object.freeze({
    label: "Equity",
    concept: "StockholdersEquity",
    units: ["USD"],
  }),
  Object.freeze({
    label: "Shares",
    concept: "EntityCommonStockSharesOutstanding",
    taxonomy: "dei",
    units: ["shares"],
  }),
]);

export function normalizeSecCompanyFacts({
  companyFacts,
  symbol,
  assetClass = "Equity",
  sourceUrl = null,
  retrievedAt = null,
} = {}) {
  if (!companyFacts || typeof companyFacts !== "object") {
    throw new TypeError("companyFacts must be a SEC companyfacts object.");
  }

  const normalizedSymbol = safePublicString(symbol ?? companyFacts.tickers?.[0] ?? companyFacts.tradingSymbol) ?? "UNKNOWN";
  const entityName = safePublicString(companyFacts.entityName) ?? normalizedSymbol;
  const cik = normalizeCik(companyFacts.cik);
  const keyFigures = SEC_CONCEPTS.map((definition) => {
    const fact = latestFactForConcept(companyFacts, definition);

    return {
      label: definition.label,
      value: fact ? formatPublicFactValue(fact) : "missing",
      source: "SEC companyfacts",
      period: fact?.period ?? null,
      form: fact?.form ?? null,
    };
  });
  const availableFigureCount = keyFigures.filter((figure) => figure.value !== "missing").length;

  return {
    symbol: normalizedSymbol,
    assetClass,
    entityName,
    sourceState: "fixture-sec-companyfacts-normalized",
    coverageState: coverageStateForCount(availableFigureCount),
    coverageBasis: [
      `${availableFigureCount} of ${SEC_CONCEPTS.length} mapped SEC concepts available`,
      "normalized from fixture payload only",
      "context-only; not a trading signal",
    ],
    keyFigures,
    provider: {
      id: SEC_COMPANYFACTS_ADAPTER_CONTRACT.id,
      liveNetworkConnected: false,
      rawPayloadIncluded: false,
      sourceUrl: safePublicString(sourceUrl),
      retrievedAt: safePublicString(retrievedAt),
      cik,
    },
    safeguards: {
      contextOnly: true,
      noAdvice: true,
      noExecutionUse: true,
      rawPayloadPersistence: SEC_COMPANYFACTS_ADAPTER_CONTRACT.rawPayloadPersistence,
    },
  };
}

export function latestFactForConcept(companyFacts, definition) {
  const taxonomy = definition.taxonomy ?? "us-gaap";
  const units = definition.units ?? DEFAULT_ALLOWED_UNITS;
  const concept = companyFacts.facts?.[taxonomy]?.[definition.concept];

  if (!concept || typeof concept !== "object") {
    return null;
  }

  const candidates = units.flatMap((unit) =>
    (concept.units?.[unit] ?? []).map((fact) => ({
      ...fact,
      unit,
    })),
  )
    .filter((fact) => typeof fact?.val === "number")
    .map((fact) => ({
      value: fact.val,
      unit: fact.unit,
      period: safePublicString([fact.fy, fact.fp].filter(Boolean).join(" ")) ?? safePublicString(fact.end),
      form: safePublicString(fact.form),
      filed: safePublicString(fact.filed),
      end: safePublicString(fact.end),
    }));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort(compareFactsByFreshness)[0];
}

function compareFactsByFreshness(left, right) {
  const leftTime = Date.parse(left.filed ?? left.end ?? "");
  const rightTime = Date.parse(right.filed ?? right.end ?? "");

  return safeTime(rightTime) - safeTime(leftTime);
}

function safeTime(value) {
  return Number.isFinite(value) ? value : 0;
}

function coverageStateForCount(count) {
  if (count >= 5) {
    return "sufficient-data";
  }

  if (count >= 3) {
    return "mixed-records";
  }

  if (count >= 1) {
    return "needs-review";
  }

  return "insufficient-data";
}

function formatPublicFactValue(fact) {
  const absoluteValue = Math.abs(fact.value);
  const formatted = absoluteValue >= 1_000_000
    ? Intl.NumberFormat("en-US", {
        maximumFractionDigits: 1,
        notation: "compact",
      }).format(fact.value)
    : Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
      }).format(fact.value);

  return fact.unit ? `${formatted} ${fact.unit}` : formatted;
}

function normalizeCik(value) {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  const digits = String(value).replace(/\D/g, "");

  return digits ? digits.padStart(10, "0") : null;
}

function safePublicString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
