export const SEC_OWNERSHIP_ADAPTER_CONTRACT = Object.freeze({
  id: "sec-ownership-filings",
  mode: "fixture-normalization-only",
  liveFetchEnabled: false,
  rawPayloadPersistence: "blocked",
  contextOnly: true,
  noAdvice: true,
  requiredBeforeLiveFetch: [
    "SEC User-Agent contact value",
    "server-side cache and rate limit",
    "official ownership feed and dataset cadence review",
  ],
  blockedUses: [
    "trading signal",
    "order parameter",
    "bot strategy input",
    "browser-side provider fetch",
  ],
});

const BUY_CODES = new Set(["P", "A"]);
const SELL_CODES = new Set(["S", "D"]);

export function normalizeSecOwnershipFilings({ symbol, issuerName, filings = [], sourceUrl = null } = {}) {
  const normalizedSymbol = safePublicString(symbol) ?? "UNKNOWN";
  const normalizedFilings = filings
    .map(normalizeFiling)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.filedAt) - Date.parse(left.filedAt));
  const recentFilings = normalizedFilings.slice(0, 5);
  const buys = recentFilings.filter((filing) => BUY_CODES.has(filing.transactionCode));
  const sells = recentFilings.filter((filing) => SELL_CODES.has(filing.transactionCode));

  return {
    symbol: normalizedSymbol,
    issuerName: safePublicString(issuerName) ?? normalizedSymbol,
    sourceState: "fixture-sec-ownership-normalized",
    latestWindow: latestWindowLabel(recentFilings),
    netDirection: directionLabel(buys.length, sells.length),
    notableActivity: notableActivityLabel({ buys, sells, recentFilings }),
    recentFilings: recentFilings.map((filing) => ({
      formType: filing.formType,
      filedAt: filing.filedAt,
      reportingOwner: filing.reportingOwner,
      relationship: filing.relationship,
      transactionCode: filing.transactionCode,
      transactionDirection: transactionDirection(filing.transactionCode),
      shares: filing.shares,
    })),
    provider: {
      id: SEC_OWNERSHIP_ADAPTER_CONTRACT.id,
      liveNetworkConnected: false,
      rawPayloadIncluded: false,
      sourceUrl: safePublicString(sourceUrl),
    },
    safeguards: {
      contextOnly: true,
      noAdvice: true,
      noExecutionUse: true,
      rawPayloadPersistence: SEC_OWNERSHIP_ADAPTER_CONTRACT.rawPayloadPersistence,
    },
  };
}

function normalizeFiling(filing) {
  if (!filing || typeof filing !== "object") {
    return null;
  }

  const formType = safePublicString(filing.formType);
  const filedAt = safePublicString(filing.filedAt);
  const transactionCode = safePublicString(filing.transactionCode)?.toUpperCase() ?? null;

  if (!formType || !filedAt || !transactionCode || Number.isNaN(Date.parse(filedAt))) {
    return null;
  }

  return {
    formType,
    filedAt,
    reportingOwner: safePublicString(filing.reportingOwner) ?? "Unknown owner",
    relationship: safePublicString(filing.relationship) ?? "unknown relationship",
    transactionCode,
    shares: typeof filing.shares === "number" && Number.isFinite(filing.shares)
      ? Math.round(filing.shares)
      : null,
  };
}

function latestWindowLabel(filings) {
  if (filings.length === 0) {
    return "no fixture filings";
  }

  const newest = filings[0].filedAt.slice(0, 10);
  const oldest = filings[filings.length - 1].filedAt.slice(0, 10);

  return newest === oldest ? newest : `${oldest} to ${newest}`;
}

function directionLabel(buyCount, sellCount) {
  if (buyCount > sellCount) {
    return "net-buying-context";
  }

  if (sellCount > buyCount) {
    return "net-selling-context";
  }

  if (buyCount > 0) {
    return "mixed-context";
  }

  return "not-connected";
}

function notableActivityLabel({ buys, sells, recentFilings }) {
  if (recentFilings.length === 0) {
    return "No fixture ownership filings are connected.";
  }

  if (buys.length > sells.length) {
    return `${buys.length} fixture purchase/acquisition filings normalized for context only.`;
  }

  if (sells.length > buys.length) {
    return `${sells.length} fixture sale/disposition filings normalized for context only.`;
  }

  return `${recentFilings.length} fixture ownership filings normalized for context only.`;
}

function transactionDirection(code) {
  if (BUY_CODES.has(code)) {
    return "purchase-or-acquisition";
  }

  if (SELL_CODES.has(code)) {
    return "sale-or-disposition";
  }

  return "other";
}

function safePublicString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
