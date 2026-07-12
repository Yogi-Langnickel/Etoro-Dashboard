const formatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const portfolioTabId = "portfolio-view";
const botConfigCsrfResponseHeader = "x-etoro-dashboard-config-token";
const loadedTabIds = new Set();
let botConfigMutationProtection = null;
let botConfigOptionsPayload = null;
let selectedPortfolioSymbol = "SPY";
let selectedPortfolioPeriod = "24h";
let portfolioDataSource = "fixture";
let selectedWatchlistSymbol = "AAPL";
let selectedWatchlistPeriod = "24h";
let watchlistDataSource = "fixture";
let watchlistChartRequestSequence = 0;
const watchlistItemsBySymbol = new Map();

const portfolioPeriodChanges = {
  BTC: {
    "1m": "+8.8%",
    "1w": "+4.1%",
    "1y": "+42.0%",
    "5y": "+338.0%",
    "24h": "-0.6%",
    max: "+516.0%",
  },
  EURUSD: {
    "1m": "-0.8%",
    "1w": "-0.4%",
    "1y": "-2.6%",
    "5y": "+1.8%",
    "24h": "-0.2%",
    max: "+3.4%",
  },
  NVDA: {
    "1m": "+12.2%",
    "1w": "+5.3%",
    "1y": "+86.0%",
    "5y": "+1,041.0%",
    "24h": "+1.9%",
    max: "+2,240.0%",
  },
  SPY: {
    "1m": "+3.7%",
    "1w": "+1.4%",
    "1y": "+14.8%",
    "5y": "+82.0%",
    "24h": "+0.8%",
    max: "+344.0%",
  },
};

const portfolioChartPoints = {
  BTC: {
    "1m": "0,196 64,178 128,206 192,148 256,170 320,98 384,126 448,86 512,118 576,64 640,78",
    "1w": "0,214 64,198 128,172 192,186 256,132 320,104 384,136 448,92 512,66 576,74 640,52",
    "1y": "0,230 64,216 128,188 192,204 256,154 320,118 384,96 448,70 512,82 576,48 640,40",
    "5y": "0,246 64,228 128,214 192,186 256,156 320,166 384,108 448,92 512,62 576,46 640,24",
    "24h": "0,184 64,202 128,168 192,178 256,142 320,164 384,112 448,132 512,96 576,120 640,104",
    max: "0,248 64,232 128,222 192,206 256,172 320,148 384,118 448,94 512,58 576,42 640,26",
  },
  EURUSD: {
    "1m": "0,146 64,156 128,150 192,162 256,170 320,166 384,178 448,172 512,186 576,182 640,194",
    "1w": "0,142 64,148 128,158 192,152 256,164 320,170 384,166 448,176 512,184 576,180 640,188",
    "1y": "0,114 64,122 128,136 192,128 256,148 320,158 384,168 448,176 512,184 576,192 640,204",
    "5y": "0,188 64,176 128,162 192,170 256,156 320,144 384,152 448,136 512,128 576,118 640,126",
    "24h": "0,132 64,140 128,136 192,148 256,152 320,146 384,158 448,164 512,160 576,172 640,176",
    max: "0,176 64,164 128,172 192,152 256,158 320,142 384,134 448,128 512,120 576,112 640,106",
  },
  NVDA: {
    "1m": "0,218 64,202 128,182 192,192 256,144 320,132 384,108 448,86 512,92 576,58 640,42",
    "1w": "0,204 64,180 128,188 192,150 256,126 320,136 384,98 448,82 512,54 576,62 640,38",
    "1y": "0,238 64,222 128,206 192,178 256,148 320,128 384,92 448,78 512,56 576,36 640,22",
    "5y": "0,248 64,238 128,220 192,196 256,164 320,132 384,102 448,78 512,54 576,34 640,18",
    "24h": "0,214 64,196 128,184 192,164 256,170 320,128 384,110 448,92 512,76 576,66 640,48",
    max: "0,250 64,242 128,226 192,210 256,176 320,142 384,104 448,78 512,48 576,28 640,16",
  },
  SPY: {
    "1m": "0,214 64,204 128,188 192,194 256,162 320,150 384,128 448,104 512,112 576,78 640,68",
    "1w": "0,192 64,176 128,184 192,148 256,154 320,126 384,104 448,118 512,86 576,72 640,82",
    "1y": "0,220 64,208 128,196 192,164 256,174 320,138 384,110 448,96 512,76 576,54 640,44",
    "5y": "0,238 64,224 128,206 192,188 256,146 320,160 384,116 448,92 512,70 576,48 640,30",
    "24h": "0,205 64,190 128,198 192,154 256,168 320,118 384,132 448,86 512,102 576,62 640,78",
    max: "0,242 64,226 128,218 192,198 256,184 320,142 384,130 448,94 512,76 576,42 640,28",
  },
};

const portfolioEnrichmentReceipts = {
  BTC: {
    financial: ["Protocol and liquidity context", "Market cap, volume, and custody notes are neutral context only."],
    insider: ["Issuer ownership unavailable", "Crypto assets use source coverage receipts instead of insider filings."],
    news: ["Digital asset market context", "Read-only headlines remain detached from bot signals and trade triggers."],
  },
  EURUSD: {
    financial: ["Macro record context", "Rate, inflation, and central-bank source receipts are informational only."],
    insider: ["Issuer filings not applicable", "FX pairs do not expose corporate insider ownership records."],
    news: ["Currency market context", "Read-only macro headlines cannot trigger orders or bot decisions."],
  },
  NVDA: {
    financial: ["Revenue, margin, inventory", "Official filings and companyfacts coverage stay source receipts only."],
    insider: ["SEC ownership filings", "Forms 3/4/5 context is neutral and never a trade signal."],
    news: ["Semiconductor headlines", "News receipts attach context without recommendations or execution."],
  },
  SPY: {
    financial: ["Holdings, fees, distribution", "Issuer factsheet and ETF datasets are context-only receipts, not advice."],
    insider: ["Fund ownership context", "ETF ownership records are neutral coverage notes only."],
    news: ["Broad market headlines", "Read-only market context; no bot signal or trade trigger."],
  },
};

const watchlistPeriodChanges = {
  AAPL: { "1m": "+4.6%", "1w": "+1.6%", "1y": "+18.4%", "5y": "+312.0%", "24h": "+0.8%", max: "+988.0%" },
  GLD: { "1m": "+2.1%", "1w": "+0.4%", "1y": "+12.8%", "5y": "+68.0%", "24h": "0.0%", max: "+248.0%" },
  QQQ: { "1m": "+5.8%", "1w": "+2.2%", "1y": "+21.6%", "5y": "+118.0%", "24h": "+1.1%", max: "+624.0%" },
  USOIL: { "1m": "-6.4%", "1w": "-2.9%", "1y": "-10.2%", "5y": "+36.0%", "24h": "-1.1%", max: "+52.0%" },
};

const watchlistChartPoints = {
  AAPL: {
    "1m": "0,210 64,196 128,182 192,190 256,154 320,138 384,126 448,96 512,104 576,74 640,62",
    "1w": "0,198 64,184 128,176 192,154 256,162 320,132 384,120 448,104 512,86 576,78 640,70",
    "1y": "0,226 64,210 128,198 192,176 256,148 320,130 384,108 448,92 512,74 576,58 640,46",
    "5y": "0,240 64,226 128,212 192,186 256,158 320,130 384,102 448,80 512,58 576,38 640,24",
    "24h": "0,204 64,190 128,198 192,166 256,174 320,140 384,128 448,102 512,112 576,84 640,74",
    max: "0,246 64,232 128,218 192,198 256,162 320,132 384,96 448,72 512,52 576,32 640,20",
  },
  GLD: {
    "1m": "0,176 64,168 128,172 192,160 256,154 320,148 384,142 448,136 512,130 576,126 640,120",
    "1w": "0,154 64,156 128,150 192,152 256,148 320,146 384,148 448,144 512,142 576,140 640,138",
    "1y": "0,198 64,188 128,180 192,170 256,158 320,146 384,136 448,126 512,116 576,104 640,94",
    "5y": "0,230 64,218 128,204 192,190 256,176 320,162 384,146 448,128 512,112 576,96 640,80",
    "24h": "0,152 64,150 128,154 192,152 256,150 320,151 384,149 448,150 512,148 576,150 640,149",
    max: "0,238 64,226 128,210 192,196 256,178 320,160 384,142 448,124 512,104 576,88 640,70",
  },
  QQQ: {
    "1m": "0,220 64,206 128,188 192,170 256,156 320,132 384,114 448,96 512,82 576,62 640,48",
    "1w": "0,206 64,192 128,180 192,158 256,146 320,126 384,106 448,92 512,72 576,64 640,50",
    "1y": "0,232 64,216 128,204 192,180 256,154 320,130 384,104 448,88 512,66 576,46 640,34",
    "5y": "0,244 64,230 128,216 192,194 256,164 320,134 384,104 448,78 512,54 576,36 640,22",
    "24h": "0,214 64,202 128,188 192,174 256,160 320,146 384,122 448,108 512,92 576,76 640,60",
    max: "0,248 64,234 128,220 192,202 256,172 320,138 384,102 448,78 512,50 576,30 640,18",
  },
  USOIL: {
    "1m": "0,102 64,112 128,128 192,120 256,146 320,158 384,170 448,182 512,174 576,198 640,210",
    "1w": "0,118 64,130 128,126 192,146 256,154 320,166 384,158 448,178 512,186 576,194 640,202",
    "1y": "0,92 64,110 128,104 192,126 256,142 320,136 384,158 448,176 512,168 576,190 640,214",
    "5y": "0,210 64,190 128,202 192,174 256,160 320,142 384,154 448,132 512,118 576,102 640,94",
    "24h": "0,106 64,118 128,112 192,132 256,144 320,138 384,160 448,170 512,164 576,186 640,196",
    max: "0,198 64,184 128,174 192,162 256,146 320,136 384,122 448,112 512,104 576,94 640,86",
  },
};

const watchlistContextReceipts = {
  AAPL: ["Equity watch", "Nasdaq quote fixture", "Fresh synthetic", "Companyfacts and news receipts are context only."],
  GLD: ["ETF watch", "Issuer factsheet fixture", "Fresh synthetic", "ETF holdings and distribution context are read-only."],
  QQQ: ["ETF watch", "Delayed quote fixture", "Stale synthetic", "Technology exposure context is informational only."],
  USOIL: ["Commodity CFD watch", "Market data fixture", "Fresh synthetic", "Commodity headlines cannot trigger trades."],
};

function chartPointsFor(pointsBySymbol, symbol, period, fallbackSymbol) {
  return pointsBySymbol[symbol]?.[period] ?? pointsBySymbol[fallbackSymbol]?.[period] ?? "";
}

function portfolioChartFor(symbol, period) {
  return chartPointsFor(portfolioChartPoints, symbol, period, "SPY");
}

const portfolioForbiddenKeys = /^(?:account|position|order|instrument|cid|gcId|rawPayload|providerPayload)(?:Id|Ids|ID|IDs)?$/i;
const portfolioCacheStates = new Set(["miss", "hit", "coalesced"]);

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  return actual.length === expectedKeys.length && actual.every((key, index) => key === [...expectedKeys].sort()[index]);
}

function containsForbiddenPortfolioKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenPortfolioKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    portfolioForbiddenKeys.test(key) || containsForbiddenPortfolioKey(child));
}

function isIsoInstant(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function normalizePortfolioViewPayload(payload) {
  const data = payload?.data;

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    containsForbiddenPortfolioKey(payload) ||
    !data ||
    !hasExactKeys(data, [
      "currency",
      "positionCount",
      "instrumentCount",
      "omittedPositionCount",
      "incompleteValuePositionCount",
      "instruments",
      "providerUpdatedAt",
    ]) ||
    data.currency !== "USD" ||
    !Array.isArray(data.instruments) ||
    data.instruments.length > 500 ||
    !Number.isInteger(data.positionCount) ||
    data.positionCount < 0 ||
    !Number.isInteger(data.instrumentCount) ||
    data.instrumentCount < 0 ||
    !Number.isInteger(data.omittedPositionCount) ||
    data.omittedPositionCount < 0 ||
    !Number.isInteger(data.incompleteValuePositionCount)
    || data.incompleteValuePositionCount < 0
    || (data.providerUpdatedAt !== null && !isIsoInstant(data.providerUpdatedAt))
  ) {
    throw new Error("Portfolio data is unavailable.");
  }

  const symbols = new Set();
  const instruments = data.instruments.map((instrument) => {
    if (
      !instrument ||
      !hasExactKeys(instrument, [
        "symbol",
        "positionCount",
        "investedUsd",
        "unrealizedPnlUsd",
        "valueStatus",
      ]) ||
      typeof instrument.symbol !== "string" ||
      !/^[A-Z0-9._-]{1,24}$/.test(instrument.symbol) ||
      symbols.has(instrument.symbol) ||
      !Number.isInteger(instrument.positionCount) ||
      instrument.positionCount < 1 ||
      !["complete", "incomplete"].includes(instrument.valueStatus)
    ) {
      throw new Error("Portfolio data is unavailable.");
    }
    symbols.add(instrument.symbol);

    const complete = instrument.valueStatus === "complete";
    if (
      (complete && (
        !Number.isFinite(instrument.investedUsd) ||
        instrument.investedUsd < 0 ||
        !Number.isFinite(instrument.unrealizedPnlUsd)
      )) ||
      (!complete && (instrument.investedUsd !== null || instrument.unrealizedPnlUsd !== null))
    ) {
      throw new Error("Portfolio data is unavailable.");
    }

    const netValueUsd = complete ? instrument.investedUsd + instrument.unrealizedPnlUsd : null;
    const pnlPercent = complete && instrument.investedUsd > 0
      ? (instrument.unrealizedPnlUsd / instrument.investedUsd) * 100
      : null;
    if ((netValueUsd !== null && !Number.isFinite(netValueUsd)) || (pnlPercent !== null && !Number.isFinite(pnlPercent))) {
      throw new Error("Portfolio data is unavailable.");
    }

    return {
      symbol: instrument.symbol,
      positionCount: instrument.positionCount,
      investedUsd: instrument.investedUsd,
      unrealizedPnlUsd: instrument.unrealizedPnlUsd,
      netValueUsd,
      pnlPercent,
      valueStatus: instrument.valueStatus,
    };
  });

  const includedPositionCount = instruments.reduce((total, instrument) => total + instrument.positionCount, 0);
  const incompleteInstrumentCount = instruments.filter(({ valueStatus }) => valueStatus === "incomplete").length;
  if (
    instruments.length !== data.instrumentCount ||
    includedPositionCount + data.omittedPositionCount !== data.positionCount ||
    data.incompleteValuePositionCount < incompleteInstrumentCount ||
    data.incompleteValuePositionCount > includedPositionCount
  ) {
    throw new Error("Portfolio data is unavailable.");
  }

  const cache = payload.cache;
  if (
    !cache ||
    !hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs"]) ||
    !portfolioCacheStates.has(cache.state) ||
    !isIsoInstant(cache.cachedAt) ||
    !isIsoInstant(cache.expiresAt) ||
    !Number.isInteger(cache.ttlMs) ||
    cache.ttlMs <= 0 ||
    cache.ttlMs > 300_000 ||
    Date.parse(cache.expiresAt) - Date.parse(cache.cachedAt) !== cache.ttlMs
  ) {
    throw new Error("Portfolio data is unavailable.");
  }

  return {
    instruments,
    positionCount: data.positionCount,
    omittedPositionCount: data.omittedPositionCount,
    incompleteValuePositionCount: data.incompleteValuePositionCount,
    providerUpdatedAt: data.providerUpdatedAt,
    cache: {
      state: cache.state,
      cachedAt: cache.cachedAt,
      expiresAt: cache.expiresAt,
      ttlMs: cache.ttlMs,
    },
  };
}

const watchlistForbiddenKeys = /^(?:account|position|order|instrument|cid|gcId|item|priceRate|rawPayload|providerPayload)(?:Id|Ids|ID|IDs)?$/i;

function containsForbiddenWatchlistKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenWatchlistKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    watchlistForbiddenKeys.test(key) || containsForbiddenWatchlistKey(child));
}

function normalizeReadCache(cache, message) {
  if (!cache || !hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs"]) ||
    !portfolioCacheStates.has(cache.state) || !isIsoInstant(cache.cachedAt) || !isIsoInstant(cache.expiresAt) ||
    !Number.isInteger(cache.ttlMs) || cache.ttlMs <= 0 || cache.ttlMs > 300_000 ||
    Date.parse(cache.expiresAt) - Date.parse(cache.cachedAt) !== cache.ttlMs) {
    throw new Error(message);
  }
  return { state: cache.state, cachedAt: cache.cachedAt, expiresAt: cache.expiresAt, ttlMs: cache.ttlMs };
}

function normalizeWatchlistViewPayload(payload) {
  const data = payload?.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || containsForbiddenWatchlistKey(payload) ||
    !data || !hasExactKeys(data, [
      "source", "itemCount", "omittedItemCount", "unavailableRateCount", "providerState", "partialFailure", "items",
    ]) || data.source !== "provider-default-watchlist" || !["complete", "partial"].includes(data.providerState) ||
    !Array.isArray(data.items) || data.items.length > 100 || !Number.isInteger(data.itemCount) || data.itemCount < 0 ||
    !Number.isInteger(data.omittedItemCount) || data.omittedItemCount < 0 ||
    !Number.isInteger(data.unavailableRateCount) || data.unavailableRateCount < 0 ||
    (data.partialFailure !== null && (!hasExactKeys(data.partialFailure, ["component", "state"]) ||
      data.partialFailure.component !== "rates" || data.partialFailure.state !== "unavailable"))) {
    throw new Error("Watchlist data is unavailable.");
  }

  const symbols = new Set();
  const items = data.items.map((item) => {
    if (!item || !hasExactKeys(item, [
      "symbol", "displayName", "rank", "bid", "ask", "lastExecution", "rateUpdatedAt", "rateStatus",
    ]) || typeof item.symbol !== "string" || !/^[A-Z0-9][A-Z0-9._:/-]{0,31}$/.test(item.symbol) ||
      symbols.has(item.symbol) || typeof item.displayName !== "string" || !item.displayName.trim() ||
      item.displayName.length > 120 || !Number.isInteger(item.rank) || item.rank < 0 ||
      !["available", "unavailable"].includes(item.rateStatus)) {
      throw new Error("Watchlist data is unavailable.");
    }
    symbols.add(item.symbol);
    const available = item.rateStatus === "available";
    const numericValues = [item.bid, item.ask];
    if ((available && (!numericValues.every((value) => Number.isFinite(value) && value >= 0) ||
      (item.lastExecution !== null && (!Number.isFinite(item.lastExecution) || item.lastExecution < 0)) ||
      !isIsoInstant(item.rateUpdatedAt))) ||
      (!available && (item.bid !== null || item.ask !== null || item.lastExecution !== null || item.rateUpdatedAt !== null))) {
      throw new Error("Watchlist data is unavailable.");
    }
    return { ...item, displayName: item.displayName.trim() };
  });
  const unavailable = items.filter(({ rateStatus }) => rateStatus === "unavailable").length;
  if (items.length !== data.itemCount || unavailable !== data.unavailableRateCount ||
    (data.providerState === "complete" && (unavailable > 0 || data.partialFailure !== null))) {
    throw new Error("Watchlist data is unavailable.");
  }
  return {
    items,
    omittedItemCount: data.omittedItemCount,
    unavailableRateCount: data.unavailableRateCount,
    providerState: data.providerState,
    partialFailure: data.partialFailure,
    cache: normalizeReadCache(payload.cache, "Watchlist data is unavailable."),
  };
}

function normalizeMarketChartPayload(payload, expectedSymbol, expectedPeriod) {
  const data = payload?.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || containsForbiddenWatchlistKey(payload) ||
    !data || !hasExactKeys(data, [
      "symbol", "displayName", "resolution", "period", "interval", "pointCount", "changePercent", "providerUpdatedAt", "points",
    ]) || data.symbol !== expectedSymbol || data.period !== expectedPeriod || data.resolution !== "exact" ||
    typeof data.displayName !== "string" || !data.displayName.trim() || data.displayName.length > 120 ||
    typeof data.interval !== "string" || !Array.isArray(data.points) || data.points.length < 1 || data.points.length > 1000 ||
    data.pointCount !== data.points.length || (data.changePercent !== null && !Number.isFinite(data.changePercent)) ||
    !isIsoInstant(data.providerUpdatedAt)) {
    throw new Error("Market chart data is unavailable.");
  }
  const points = data.points.map((point, index) => {
    if (!point || !hasExactKeys(point, ["at", "close"]) || !isIsoInstant(point.at) ||
      !Number.isFinite(point.close) || point.close < 0 || (index > 0 && point.at <= data.points[index - 1].at)) {
      throw new Error("Market chart data is unavailable.");
    }
    return { at: point.at, close: point.close };
  });
  return { ...data, displayName: data.displayName.trim(), points, cache: normalizeReadCache(payload.cache, "Market chart data is unavailable.") };
}

function portfolioTotalsFor(instruments) {
  const complete = instruments.filter(({ valueStatus }) => valueStatus === "complete");
  if (complete.length === 0) return { investedUsd: null, unrealizedPnlUsd: null, netValueUsd: null };
  const investedUsd = complete.reduce((total, instrument) => total + instrument.investedUsd, 0);
  const unrealizedPnlUsd = complete.reduce((total, instrument) => total + instrument.unrealizedPnlUsd, 0);
  const netValueUsd = investedUsd + unrealizedPnlUsd;
  if (![investedUsd, unrealizedPnlUsd, netValueUsd].every(Number.isFinite)) {
    throw new Error("Portfolio data is unavailable.");
  }
  return { investedUsd, unrealizedPnlUsd, netValueUsd };
}

function portfolioPeriodValue(source, symbol, period) {
  return source === "provider-normalized"
    ? "Unavailable"
    : portfolioPeriodChanges[symbol]?.[period] ?? "Unavailable";
}

function watchlistChartFor(symbol, period) {
  return chartPointsFor(watchlistChartPoints, symbol, period, "AAPL");
}

function text(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function setTile(id, state, title, detail) {
  const tile = document.getElementById(id);

  if (!tile) {
    return;
  }

  tile.classList.remove("ok", "warn", "neutral", "danger");
  tile.classList.add(state);
  tile.querySelector("strong").textContent = title;
  tile.querySelector("small").textContent = detail;
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? formatter.format(value) : "Unavailable";
}

function signedMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value >= 0 ? "+" : "-"}${formatter.format(Math.abs(value))}`;
}

function signedPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCacheDuration(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "read cache unavailable";
  }

  if (milliseconds >= 1000 && milliseconds % 1000 === 0) {
    return `${milliseconds / 1000}s read cache`;
  }

  return `${milliseconds} ms read cache`;
}

function formatProviderDuration(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return "Latency unavailable";
  }

  return `Latency: ${Math.round(milliseconds)} ms`;
}

async function getJson(path) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message ?? `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }

  if (payload?.mutationProtection?.csrfHeader) {
    const csrfToken = response.headers.get(botConfigCsrfResponseHeader);
    payload.mutationProtection = {
      ...payload.mutationProtection,
      ...(csrfToken ? { csrfToken } : {}),
    };
  }
  if (payload?.config?.mutationProtection?.csrfHeader) {
    const csrfToken = response.headers.get(botConfigCsrfResponseHeader);
    payload.config.mutationProtection = {
      ...payload.config.mutationProtection,
      ...(csrfToken ? { csrfToken } : {}),
    };
  }

  return payload;
}

async function postJson(path, body) {
  return sendJsonWithMethod("POST", path, body);
}

async function putJson(path, body) {
  const headers = {};

  if (path === "/api/etoro/bot/config" && botConfigMutationProtection?.csrfHeader) {
    headers[botConfigMutationProtection.csrfHeader] = botConfigMutationProtection.csrfToken;
  }

  return sendJsonWithMethod("PUT", path, body, headers);
}

async function sendJsonWithMethod(method, path, body, extraHeaders = {}) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...extraHeaders,
    },
    method,
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message ?? `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function renderStatus(payload) {
  const status = payload.credentialStatus;
  const configured = Boolean(status?.configured);
  const cacheTtlMs = payload.cachePolicy?.readOnlyTtlMs ?? status?.readCacheTtlMs;

  setTile(
    "provider-status",
    configured ? "ok" : "warn",
    configured ? "Provider configured" : "Provider offline",
    configured ? "Server-side provider boundary" : "Using synthetic fixtures",
  );
  text(
    "source-detail",
    configured
      ? `Server configured; ${formatCacheDuration(cacheTtlMs)}`
      : `No server credentials; ${formatCacheDuration(cacheTtlMs)}`,
  );
  text("chart-provider", configured ? "Provider boundary: server-side only" : "Provider timestamp: unavailable");
}

function renderIdentity(payload) {
  const refs = payload.data?.accountRefs;
  const demoAvailable = Boolean(refs?.hasDemoCid);

  setTile(
    "demo-status",
    demoAvailable ? "ok" : "warn",
    demoAvailable ? "Demo account" : "Demo not verified",
    refs?.hasRealCid ? "Real account also present" : "Read-only demo route",
  );
}

function renderPnl(payload) {
  const data = payload.data;

  text("mock-equity-label", "Demo equity");
  text("mock-equity", money(data.equity ?? data.credit));
  text("cash-buffer", money(data.availableCash));
  text("unrealized-pnl", signedMoney(data.unrealizedPnL));
  text("exposure", money(data.totalInvested));
  text("stale-data", `${data.positionCount} positions`);
  text("chart-provider", data.providerUpdatedAt ? `Provider timestamp: ${data.providerUpdatedAt}` : "Provider timestamp: unavailable");
  text("chart-request", `Request ID: ${payload.provider.requestId} | ${formatProviderDuration(payload.provider.durationMs)}`);
  text("chart-cache", `Cache: ${labelize(payload.cache?.state)} (${payload.cache?.ttlMs ?? 0} ms)`);
  setTile("last-sync", "ok", "Last sync", new Date(payload.provider.receivedAt).toLocaleTimeString());
}

function renderAudit(message, detail, listId = "audit-list") {
  const list = document.getElementById(listId);

  if (!list) {
    return;
  }

  const item = document.createElement("li");
  const time = document.createElement("span");
  const body = document.createElement("span");
  const title = document.createElement("strong");
  const small = document.createElement("small");

  time.className = "event-time";
  time.textContent = new Date().toLocaleTimeString();
  title.textContent = message;
  small.textContent = detail;
  body.append(title, small);
  item.append(time, body);
  list.prepend(item);

  while (list.children.length > 5) {
    list.lastElementChild.remove();
  }
}

function renderTradingStatus(payload) {
  const configured = Boolean(payload.credentialStatus?.configured);
  const mutationsEnabled = Boolean(payload.mutationRoutesEnabled);
  const matrix = payload.permissionMatrix ?? [];
  const rateBudget = payload.rateBudget ?? {};
  const endpointTarget = document.getElementById("trading-endpoints");

  text("trading-credential-state", configured ? "Configured" : "Missing");
  text("trading-mutation-state", mutationsEnabled ? "Enabled" : "Disabled");
  text("trading-provider-scope", payload.demoOnly ? "Demo only" : "Unknown");
  text("trade-route-status", payload.demoTradePreviewEnabled ? "Preview enabled" : "Planning only");

  if (endpointTarget) {
    endpointTarget.textContent = "";

    for (const item of matrix) {
      const card = document.createElement("article");
      const label = document.createElement("span");
      const state = document.createElement("strong");
      const detail = document.createElement("small");

      card.className = "endpoint-card";
      label.textContent = item.label;
      state.textContent = labelize(item.state);
      detail.textContent = item.detail;
      card.append(label, state, detail);
      endpointTarget.append(card);
    }

    const rateCard = document.createElement("article");
    const rateLabel = document.createElement("span");
    const rateState = document.createElement("strong");
    const rateDetail = document.createElement("small");

    rateCard.className = "endpoint-card";
    rateLabel.textContent = "Rate budget";
    rateState.textContent = labelize(rateBudget.currentPressure);
    rateDetail.textContent = `${rateBudget.window ?? "unknown window"}; reserve: ${
      rateBudget.reservedHeadroom ?? "not set"
    }`;
    rateCard.append(rateLabel, rateState, rateDetail);
    endpointTarget.append(rateCard);
  }

  renderAudit(
    payload.demoTradePreviewEnabled ? "Demo preview route enabled" : "Demo execution route disabled",
    "Trade ticket preview never places orders; execution remains absent",
    "trading-audit-list",
  );
}

function labelize(value) {
  return String(value ?? "unknown")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function periodLabel(value) {
  return value === "max" ? "Max" : value;
}

function signedClass(value) {
  if (String(value).startsWith("+")) {
    return "good-text";
  }

  if (String(value).startsWith("-")) {
    return "bad-text";
  }

  return "neutral-text";
}

function setPerformanceChart(points) {
  const line = document.getElementById("performance-line");
  const area = document.getElementById("performance-area");

  if (!points) {
    return;
  }

  line?.setAttribute("points", points);
  area?.setAttribute("d", `M${points.replaceAll(" ", " L")} L640 260 L0 260 Z`);
}

function setChartPath(lineId, areaId, points) {
  const line = document.getElementById(lineId);
  const area = document.getElementById(areaId);

  if (!points) {
    return;
  }

  line?.setAttribute("points", points);
  area?.setAttribute("d", `M${points.replaceAll(" ", " L")} L640 260 L0 260 Z`);
}

function appendPortfolioCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function renderProviderPortfolio(payload) {
  const view = normalizePortfolioViewPayload(payload);
  const body = document.getElementById("portfolio-table-body");

  if (!body) return view;

  portfolioDataSource = "provider-normalized";
  body.replaceChildren();
  for (const instrument of view.instruments) {
    const row = document.createElement("tr");
    row.className = "instrument-row";
    row.tabIndex = 0;
    row.dataset.instrumentRow = "";
    row.dataset.symbol = instrument.symbol;
    row.dataset.source = "provider-normalized";

    const assetCell = document.createElement("td");
    const symbol = document.createElement("strong");
    const detail = document.createElement("span");
    symbol.textContent = instrument.symbol;
    detail.textContent = `${instrument.positionCount} aggregated position${instrument.positionCount === 1 ? "" : "s"}`;
    assetCell.append(symbol, detail);
    row.append(assetCell);

    appendPortfolioCell(row, "Unavailable");
    const periodCell = appendPortfolioCell(row, "Unavailable", "neutral-text");
    periodCell.dataset.periodValue = "";
    appendPortfolioCell(row, "Unavailable");
    appendPortfolioCell(row, "Unavailable");
    appendPortfolioCell(row, signedMoney(instrument.unrealizedPnlUsd), signedClass(signedMoney(instrument.unrealizedPnlUsd)));
    appendPortfolioCell(row, signedPercent(instrument.pnlPercent), signedClass(signedPercent(instrument.pnlPercent)));
    appendPortfolioCell(row, money(instrument.investedUsd));
    appendPortfolioCell(row, money(instrument.netValueUsd));
    appendPortfolioCell(row, instrument.valueStatus === "complete" ? "Normalized" : "Incomplete", instrument.valueStatus === "complete" ? "good-text" : "warn-text");
    bindPortfolioRow(row);
    body.append(row);
  }

  const rows = [...body.querySelectorAll("[data-instrument-row]")];
  const selected = rows.find((row) => row.dataset.symbol === selectedPortfolioSymbol) ?? rows[0];
  if (selected) {
    selectedPortfolioSymbol = selected.dataset.symbol;
    selected.classList.add("active");
  }

  const completeRows = view.instruments.filter((instrument) => instrument.valueStatus === "complete");
  const totals = portfolioTotalsFor(view.instruments);
  text("mock-equity-label", "Normalized demo net value");
  text("mock-equity", money(totals.netValueUsd));
  text("equity-detail", completeRows.length > 0 ? "Complete normalized instrument values only" : "No complete instrument values");
  text("cash-buffer", "Unavailable");
  text("cash-buffer-detail", "Not included in the portfolio aggregate");
  text("unrealized-pnl", signedMoney(totals.unrealizedPnlUsd));
  text("unrealized-pnl-detail", completeRows.length > 0 ? "Complete normalized rows only" : "No complete instrument values");
  text("exposure", "Unavailable");
  text("exposure-detail", "Not included in the portfolio aggregate");
  text("stale-data-label", "Provider timestamp");
  text("stale-data", view.providerUpdatedAt ? "Available" : "Unavailable");
  text("stale-data-detail", view.providerUpdatedAt ? "Exact time shown in portfolio freshness" : "Provider timestamp missing");
  text("portfolio-source-watermark", "Provider normalized");
  text("portfolio-source-detail", "Read-only aggregate; no account, position, or order identifiers");

  const cacheState = view.cache?.state ?? "unknown";
  const cacheAge = view.cache?.cachedAt ? ` · cached ${view.cache.cachedAt}` : "";
  text("portfolio-read-state", `Portfolio: provider ${labelize(cacheState)}${cacheAge}`);
  text("portfolio-freshness", `Provider updated: ${view.providerUpdatedAt ?? "unavailable"}`);
  text("portfolio-omitted", `Omitted rows: ${view.omittedPositionCount}`);
  text(
    "portfolio-partial",
    view.incompleteValuePositionCount > 0
      ? `Partial values: ${view.incompleteValuePositionCount} position${view.incompleteValuePositionCount === 1 ? "" : "s"}`
      : "Value coverage: complete",
  );
  text("chart-provider", `Provider timestamp: ${view.providerUpdatedAt ?? "unavailable"}`);
  text("chart-request", "Provider request ID: hidden");
  text("chart-cache", `Cache: ${labelize(cacheState)} (${view.cache?.ttlMs ?? 0} ms)`);
  text("source-detail", view.incompleteValuePositionCount > 0 ? "Partial normalized provider values" : "Normalized provider portfolio");
  updatePortfolioPeriod(selectedPortfolioPeriod);
  return view;
}

function renderPortfolioReadFailure(error) {
  const cache = error?.payload?.cache;
  const validCache = cache &&
    hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs", "reason"]) &&
    new Set(["error", "backoff"]).has(cache.state) &&
    isIsoInstant(cache.cachedAt) &&
    isIsoInstant(cache.expiresAt) &&
    Number.isInteger(cache.ttlMs) &&
    cache.ttlMs > 0 &&
    cache.ttlMs <= 300_000 &&
    Date.parse(cache.expiresAt) - Date.parse(cache.cachedAt) === cache.ttlMs &&
    typeof cache.reason === "string" &&
    /^[A-Z0-9_]{1,80}$/.test(cache.reason);
  text("portfolio-read-state", validCache ? `Portfolio: ${labelize(cache.state)}` : "Portfolio: unavailable");
  text("portfolio-freshness", "Freshness: unavailable; existing in-memory rows retained");
  text("portfolio-omitted", "Omitted rows: unavailable");
  text("portfolio-partial", validCache ? `Provider read failed; retry window ${cache.ttlMs} ms` : "Provider read failed; retry window unavailable");
}

function renderFulfilledProviderPortfolio(payload) {
  try {
    const view = renderProviderPortfolio(payload);
    renderAudit(
      "Provider portfolio loaded",
      `${view.instruments.length} instrument aggregates; ${view.omittedPositionCount} unsafe rows omitted; no account or position IDs returned`,
    );
    return true;
  } catch (error) {
    renderPortfolioReadFailure(error);
    renderAudit(
      "Partial provider read",
      "Provider status loaded, but the portfolio response was invalid; existing rows are retained in memory only",
    );
    return false;
  }
}

function renderSelectedPortfolioInstrument() {
  if (portfolioDataSource === "provider-normalized") {
    text("chart-title", `${selectedPortfolioSymbol} market chart unavailable`);
    text("selected-period-pill", periodLabel(selectedPortfolioPeriod));
    text("chart-period-label", "Selected-period market DTO not connected");
    text("portfolio-financial-title", "Market context deferred");
    text("portfolio-financial-detail", "Portfolio holdings do not supply chart or financial-record data.");
    text("portfolio-news-title", "News context deferred");
    text("portfolio-news-detail", "Read-only portfolio values cannot be reused as news or a trading signal.");
    text("portfolio-insider-title", "Ownership context deferred");
    text("portfolio-insider-detail", "Exact-symbol market contracts are the next separate read-only slice.");
    document.getElementById("performance-line")?.setAttribute("points", "");
    document.getElementById("performance-area")?.setAttribute("d", "");
    return;
  }

  const receipts = portfolioEnrichmentReceipts[selectedPortfolioSymbol] ?? portfolioEnrichmentReceipts.SPY;

  text("chart-title", `${selectedPortfolioSymbol} selected-period chart`);
  text("selected-period-pill", periodLabel(selectedPortfolioPeriod));
  text("chart-period-label", `Selected period: ${periodLabel(selectedPortfolioPeriod)}`);
  text("portfolio-financial-title", receipts.financial[0]);
  text("portfolio-financial-detail", receipts.financial[1]);
  text("portfolio-news-title", receipts.news[0]);
  text("portfolio-news-detail", receipts.news[1]);
  text("portfolio-insider-title", receipts.insider[0]);
  text("portfolio-insider-detail", receipts.insider[1]);
  setPerformanceChart(portfolioChartFor(selectedPortfolioSymbol, selectedPortfolioPeriod));
}

function updatePortfolioPeriod(period) {
  selectedPortfolioPeriod = period;

  document.querySelectorAll("[data-period]").forEach((button) => {
    const active = button.dataset.period === period;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-instrument-row]").forEach((row) => {
    const symbol = row.dataset.symbol;
    const value = portfolioPeriodValue(row.dataset.source, symbol, period);
    const target = row.querySelector("[data-period-value]");

    if (target) {
      target.textContent = value;
      target.classList.remove("good-text", "bad-text", "neutral-text");
      target.classList.add(signedClass(value));
    }
  });

  renderSelectedPortfolioInstrument();
}

function selectPortfolioInstrument(row) {
  if (!row) {
    return;
  }

  selectedPortfolioSymbol = row.dataset.symbol ?? selectedPortfolioSymbol;

  document.querySelectorAll("[data-instrument-row]").forEach((candidate) => {
    candidate.classList.toggle("active", candidate === row);
  });

  renderSelectedPortfolioInstrument();
  renderAudit(
    `${selectedPortfolioSymbol} selected`,
    "Instrument summary row selected locally; enrichment receipts remain context-only",
  );
}

function bindPortfolioRow(row) {
  row.addEventListener("click", () => selectPortfolioInstrument(row));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPortfolioInstrument(row);
    }
  });
}

function bindWatchlistRow(row) {
  row.addEventListener("click", () => selectWatchlistInstrument(row));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectWatchlistInstrument(row);
    }
  });
}

function watchlistPrice(item) {
  if (item.rateStatus !== "available") return "Unavailable";
  const value = item.lastExecution ?? ((item.bid + item.ask) / 2);
  return money(value);
}

function appendWatchlistCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function marketChartSvgPoints(points) {
  const values = points.map(({ close }) => close);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low;
  return points.map(({ close }, index) => {
    const x = points.length === 1 ? 320 : (index / (points.length - 1)) * 640;
    const y = range === 0 ? 130 : 20 + ((high - close) / range) * 220;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function renderProviderWatchlist(payload, { refreshChart = true } = {}) {
  const view = normalizeWatchlistViewPayload(payload);
  const body = document.getElementById("watchlist-table-body");
  if (!body) return view;

  watchlistDataSource = "provider-normalized";
  watchlistItemsBySymbol.clear();
  body.replaceChildren();
  for (const item of view.items) {
    watchlistItemsBySymbol.set(item.symbol, item);
    const row = document.createElement("tr");
    row.className = "watchlist-row";
    row.tabIndex = 0;
    row.dataset.watchlistRow = "";
    row.dataset.watchlistSymbol = item.symbol;

    const symbolCell = document.createElement("td");
    const symbol = document.createElement("strong");
    symbol.textContent = item.symbol;
    symbolCell.append(symbol);
    row.append(symbolCell);
    appendWatchlistCell(row, item.displayName);
    appendWatchlistCell(row, watchlistPrice(item));
    const periodCell = appendWatchlistCell(row, "Unavailable", "neutral-text");
    periodCell.dataset.watchlistPeriodValue = "";
    const freshnessCell = document.createElement("td");
    const freshness = document.createElement("span");
    freshness.className = item.rateStatus === "available" ? "pill ok" : "pill warn";
    freshness.textContent = item.rateUpdatedAt ?? "Rate unavailable";
    freshnessCell.append(freshness);
    row.append(freshnessCell);
    appendWatchlistCell(row, item.rateStatus === "available" ? "Provider normalized" : "Partial provider read");
    bindWatchlistRow(row);
    body.append(row);
  }

  if (view.items.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.setAttribute("colspan", "6");
    cell.textContent = "No instrument items were returned by the default watchlist.";
    row.append(cell);
    body.append(row);
  }

  const rows = [...body.querySelectorAll("[data-watchlist-row]")];
  const selected = rows.find((row) => row.dataset.watchlistSymbol === selectedWatchlistSymbol) ?? rows[0];
  if (selected) {
    selectedWatchlistSymbol = selected.dataset.watchlistSymbol;
    selected.classList.add("active");
  }
  const state = document.getElementById("watchlist-provider-state");
  if (state) {
    state.textContent = view.providerState === "complete" ? "Provider complete" : "Provider partial";
    state.classList.toggle("lock", false);
    state.classList.toggle("warn", view.providerState === "partial");
    state.classList.toggle("ok", view.providerState === "complete");
  }
  text("watchlist-chart-source", `Source: provider ${labelize(view.cache.state)}`);
  text("watchlist-chart-freshness", `Cached: ${view.cache.cachedAt}`);
  text("research-watchlists-state", "Provider default watchlist");
  text("research-instruments-state", "Exact-symbol provider lookup");
  text("watchlist-source-policy", "Read-only provider fetch");
  renderAudit(
    "Default watchlist loaded",
    `${view.items.length} normalized instruments; ${view.omittedItemCount} omitted; ${view.unavailableRateCount} rates unavailable`,
    "research-audit-list",
  );
  if (refreshChart) updateWatchlistPeriod(selectedWatchlistPeriod);
  return view;
}

function renderWatchlistReadFailure() {
  const retained = watchlistDataSource === "provider-normalized";
  const state = document.getElementById("watchlist-provider-state");
  if (state) {
    state.textContent = retained ? "Provider rows stale" : "Watchlist unavailable";
    state.classList.add("warn");
    state.classList.remove("ok");
  }
  text("watchlist-chart-freshness", retained ? "Freshness: stale; in-memory rows retained" : "Freshness: unavailable");
  text("watchlist-source-policy", retained ? "Provider read stale" : "Provider unavailable");
  renderAudit(
    "Watchlist read unavailable",
    retained ? "Existing normalized rows remain in memory only" : "No account-linked watchlist data was retained",
    "research-audit-list",
  );
}

function renderMarketChart(payload, expectedSymbol, expectedPeriod) {
  const chart = normalizeMarketChartPayload(payload, expectedSymbol, expectedPeriod);
  const svgPoints = marketChartSvgPoints(chart.points);
  setChartPath("watchlist-performance-line", "watchlist-performance-area", svgPoints);
  text("watchlist-chart-title", `${chart.symbol} selected-period market chart`);
  text("watchlist-chart-period-label", `${periodLabel(chart.period)} · ${chart.interval} · ${chart.pointCount} points`);
  text("watchlist-chart-source", `Source: provider normalized · ${signedPercent(chart.changePercent)}`);
  text("watchlist-chart-freshness", `Provider updated: ${chart.providerUpdatedAt}`);
  text("watchlist-context-title", chart.displayName);
  text("watchlist-context-source", "Exact-symbol eToro market data");
  text("watchlist-context-freshness", chart.providerUpdatedAt);
  text("watchlist-context-detail", "Selected-period close prices are informational only and cannot trigger orders.");
  document.getElementById("watchlist-chart-shell")?.setAttribute(
    "aria-label",
    `${chart.symbol} ${periodLabel(chart.period)} normalized provider close-price chart`,
  );
  const selectedRow = [...document.querySelectorAll("[data-watchlist-row]")]
    .find((row) => row.dataset.watchlistSymbol === chart.symbol);
  const periodCell = selectedRow?.querySelector("[data-watchlist-period-value]");
  if (periodCell) {
    const value = signedPercent(chart.changePercent);
    periodCell.textContent = value;
    periodCell.classList.remove("good-text", "bad-text", "neutral-text");
    periodCell.classList.add(signedClass(value));
  }
  return chart;
}

async function refreshSelectedWatchlistMarket() {
  const requestSequence = ++watchlistChartRequestSequence;
  const symbol = selectedWatchlistSymbol;
  const period = selectedWatchlistPeriod;
  text("watchlist-chart-title", `${symbol} market chart loading`);
  text("watchlist-chart-period-label", `Selected period: ${periodLabel(period)} · loading`);
  document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
  document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
  try {
    const payload = await getJson(`/api/etoro/market/chart?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`);
    if (requestSequence !== watchlistChartRequestSequence || symbol !== selectedWatchlistSymbol || period !== selectedWatchlistPeriod) return;
    renderMarketChart(payload, symbol, period);
  } catch {
    if (requestSequence !== watchlistChartRequestSequence) return;
    text("watchlist-chart-title", `${symbol} market chart unavailable`);
    text("watchlist-chart-period-label", `Selected period: ${periodLabel(period)} · unavailable`);
    text("watchlist-chart-freshness", "Freshness: unavailable; no fixture substitution");
    text("watchlist-context-source", "Provider market read unavailable");
  }
}

function renderSelectedWatchlistInstrument() {
  if (watchlistDataSource === "provider-normalized") {
    if (!watchlistItemsBySymbol.has(selectedWatchlistSymbol)) {
      watchlistChartRequestSequence += 1;
      text("watchlist-chart-title", "No watchlist instrument selected");
      text("watchlist-chart-period-label", "Selected-period market data unavailable");
      document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
      document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
      return;
    }
    void refreshSelectedWatchlistMarket();
    return;
  }
  const context = watchlistContextReceipts[selectedWatchlistSymbol] ?? watchlistContextReceipts.AAPL;

  text("watchlist-chart-title", `${selectedWatchlistSymbol} watchlist chart`);
  text("watchlist-selected-period-pill", periodLabel(selectedWatchlistPeriod));
  text("watchlist-chart-period-label", `Selected period: ${periodLabel(selectedWatchlistPeriod)}`);
  text("watchlist-context-title", context[0]);
  text("watchlist-context-source", context[1]);
  text("watchlist-context-freshness", context[2]);
  text("watchlist-context-detail", context[3]);
  setChartPath(
    "watchlist-performance-line",
    "watchlist-performance-area",
    watchlistChartFor(selectedWatchlistSymbol, selectedWatchlistPeriod),
  );
}

function updateWatchlistPeriod(period) {
  selectedWatchlistPeriod = period;

  document.querySelectorAll("[data-watchlist-period]").forEach((button) => {
    const active = button.dataset.watchlistPeriod === period;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-watchlist-row]").forEach((row) => {
    const symbol = row.dataset.watchlistSymbol;
    const value = watchlistDataSource === "provider-normalized"
      ? "Unavailable"
      : watchlistPeriodChanges[symbol]?.[period] ?? "0.0%";
    const target = row.querySelector("[data-watchlist-period-value]");

    if (target) {
      target.textContent = value;
      target.classList.remove("good-text", "bad-text", "neutral-text");
      target.classList.add(signedClass(value));
    }
  });

  renderSelectedWatchlistInstrument();
}

function selectWatchlistInstrument(row) {
  if (!row) {
    return;
  }

  selectedWatchlistSymbol = row.dataset.watchlistSymbol ?? selectedWatchlistSymbol;

  document.querySelectorAll("[data-watchlist-row]").forEach((candidate) => {
    candidate.classList.toggle("active", candidate === row);
  });

  renderSelectedWatchlistInstrument();
  renderAudit(
    `${selectedWatchlistSymbol} watchlist item selected`,
    "Watchlist row selected locally; context remains read-only and non-advisory",
    "research-audit-list",
  );
}

function renderFixtureWatermark(id, watermark) {
  const element = document.getElementById(id);

  if (!element || !watermark) {
    return;
  }

  element.textContent = watermark.safeForPublicDemo ? watermark.label : "Source review needed";
  element.title = watermark.detail ?? "";
  element.classList.toggle("warn", !watermark.safeForPublicDemo);
  element.classList.toggle("lock", Boolean(watermark.safeForPublicDemo));
}

function renderBotStatus(payload) {
  const telemetry = payload.telemetry ?? {};
  const safeguards = payload.safeguards ?? {};

  renderFixtureWatermark("bot-watermark-state", payload.fixtureWatermark);
  text("bot-enabled-state", payload.botEnabled ? "Enabled" : "Disabled");
  text("bot-freshness-state", labelize(telemetry.freshness));
  text("bot-telemetry-source", labelize(telemetry.source));
  text("bot-pending-count", String(telemetry.pendingExecutionCount ?? 0));
  text("bot-kill-switch", labelize(safeguards.killSwitch));
  text("bot-execution-state", labelize(safeguards.executionRoutes));
  text("bot-account-id-state", labelize(safeguards.accountIdentifiers));
  text("bot-payload-state", labelize(safeguards.rawProviderPayloads));
  text("bot-strategy-control-state", labelize(payload.controlPolicy?.strategySelection));
  text("bot-budget-state", money(payload.budgetPolicy?.baseBudgetUsd));
  text("bot-profit-state", labelize(payload.budgetPolicy?.profitReuse));
  text("bot-universe-state", (payload.instrumentUniverse?.defaultAllowed ?? []).map(labelize).join(", "));
  text("bot-sheets-state", labelize(payload.auditExport?.googleSheets));
  text("bot-daily-loss-state", money(payload.budgetPolicy?.hardStops?.dailyLossUsd));
  text("bot-weekly-loss-state", money(payload.budgetPolicy?.hardStops?.weeklyLossUsd));
  text("bot-open-position-state", String(payload.budgetPolicy?.hardStops?.maxOpenPositions ?? "Unavailable"));
  text("bot-cadence-state", labelize(payload.schedulePolicy?.minimumCadence));
  text("bot-hft-state", labelize(payload.schedulePolicy?.highFrequencyTrading));

  const modePill = document.getElementById("bot-mode-pill");

  if (modePill) {
    modePill.textContent = payload.simulatedTelemetryOnly ? "Synthetic only" : "Live telemetry";
    modePill.classList.toggle("warn", !payload.simulatedTelemetryOnly);
    modePill.classList.toggle("lock", payload.simulatedTelemetryOnly);
  }

  renderAudit(
    payload.botEnabled ? "Bot telemetry enabled" : "Bot monitor disabled",
    "Read-only DTO loaded; execution, account mutation, and raw payloads remain blocked",
    "bot-audit-list",
  );
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function renderBotStrategies(payload) {
  const target = document.getElementById("bot-strategies");

  if (!target) {
    return;
  }

  target.textContent = "";

  for (const strategy of payload.strategies ?? []) {
    const card = document.createElement("article");
    const header = document.createElement("header");
    const titleWrap = document.createElement("span");
    const title = document.createElement("strong");
    const version = document.createElement("small");
    const status = document.createElement("span");
    const detail = document.createElement("p");
    const meta = document.createElement("div");

    card.className = "strategy-card";
    status.className = "pill lock";
    meta.className = "strategy-meta";
    title.textContent = strategy.name;
    version.textContent = strategy.version;
    status.textContent = labelize(strategy.status);
    detail.textContent = strategy.lastValidation?.detail ?? "Synthetic strategy only.";

    for (const [label, value] of Object.entries(strategy.riskBudget ?? {})) {
      const chip = document.createElement("span");
      chip.className = "pill";
      chip.textContent = `${labelize(label)}: ${value}`;
      meta.append(chip);
    }

    titleWrap.append(title, version);
    header.append(titleWrap, status);
    card.append(header, detail, meta);
    target.append(card);
  }
}

function setCheckboxGroup(name, values) {
  const selected = new Set(values ?? []);

  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function renderBotConfig(configPayload) {
  const config = configPayload.config ?? {};
  const source = configPayload.persistence?.persisted ? "Persisted server-side" : "Default server config";
  botConfigMutationProtection = configPayload.mutationProtection ?? botConfigMutationProtection;

  text("bot-config-source-state", source);
  text("bot-budget-state", money(config.budgetUsd));
  text("bot-cadence-state", labelize(config.cadence));
  text("bot-universe-state", (config.allowedMarkets ?? []).map(labelize).join(", "));
  text("bot-instrument-class-state", (config.allowedInstrumentClasses ?? []).map(labelize).join(", "));

  const runModeSelect = document.getElementById("bot-run-mode-select");
  const strategySelect = document.getElementById("bot-strategy-select");
  const budgetSelect = document.getElementById("bot-budget-select");
  const cadenceSelect = document.getElementById("bot-cadence-select");

  if (runModeSelect) {
    runModeSelect.value = config.runMode ?? "backtest";
  }

  if (strategySelect) {
    strategySelect.value = config.strategyId ?? "";
  }

  if (budgetSelect) {
    budgetSelect.value = String(config.budgetUsd ?? "");
  }

  if (cadenceSelect) {
    cadenceSelect.value = config.cadence ?? "";
  }

  setCheckboxGroup("bot-allowed-markets", config.allowedMarkets);
  setCheckboxGroup("bot-instrument-classes", config.allowedInstrumentClasses);
  applyBotStrategyRuleControls(configPayload);
}

function applyBotStrategyRuleControls(configPayload = botConfigOptionsPayload) {
  const strategyId = ticketValue("bot-strategy-select");
  const rule = configPayload?.options?.strategyRules?.[strategyId];

  if (!rule) {
    return;
  }

  document.querySelectorAll('input[name="bot-allowed-markets"]').forEach((input) => {
    input.disabled = !(rule.allowedMarkets ?? []).includes(input.value);

    if (input.disabled) {
      input.checked = false;
    }
  });

  document.querySelectorAll('input[name="bot-instrument-classes"]').forEach((input) => {
    input.disabled = !(rule.allowedInstrumentClasses ?? []).includes(input.value);

    if (input.disabled) {
      input.checked = false;
    }
  });

  const cadenceSelect = document.getElementById("bot-cadence-select");

  if (cadenceSelect) {
    for (const option of cadenceSelect.options) {
      option.disabled = option.value !== rule.cadence;
    }

    cadenceSelect.value = rule.cadence;
  }
}

function renderBotControlSelects(statusPayload, strategiesPayload, configPayload) {
  const runModeSelect = document.getElementById("bot-run-mode-select");
  const select = document.getElementById("bot-strategy-select");
  const budgetSelect = document.getElementById("bot-budget-select");
  const cadenceSelect = document.getElementById("bot-cadence-select");
  const marketTarget = document.getElementById("bot-market-options");
  const classTarget = document.getElementById("bot-instrument-class-options");
  const strategyById = new Map((strategiesPayload.strategies ?? []).map((strategy) => [strategy.strategyId, strategy]));
  botConfigOptionsPayload = configPayload;

  if (runModeSelect) {
    runModeSelect.textContent = "";

    for (const runMode of configPayload.options?.runModes ?? []) {
      const option = document.createElement("option");
      const policy = configPayload.options?.runModePolicy?.[runMode];
      option.value = runMode;
      option.textContent = policy?.enabled ? labelize(runMode) : `${labelize(runMode)} (disabled)`;
      option.disabled = !policy?.enabled;
      option.title = policy?.reason ?? "";
      runModeSelect.append(option);
    }

    runModeSelect.disabled = false;
  }

  if (select) {
    select.textContent = "";

    for (const strategyId of statusPayload.controlPolicy?.allowedStrategyIds ?? []) {
      const strategy = strategyById.get(strategyId);
      const option = document.createElement("option");
      option.value = strategyId;
      option.textContent = strategy?.name ?? labelize(strategyId);
      select.append(option);
    }

    select.disabled = false;
  }

  if (budgetSelect) {
    budgetSelect.textContent = "";

    for (const budget of statusPayload.budgetPolicy?.selectableBudgetsUsd ?? []) {
      const option = document.createElement("option");
      option.value = String(budget);
      option.textContent = money(budget);
      budgetSelect.append(option);
    }

    budgetSelect.disabled = false;
  }

  if (cadenceSelect) {
    cadenceSelect.textContent = "";

    for (const cadence of configPayload.options?.cadences ?? []) {
      const option = document.createElement("option");
      option.value = cadence;
      option.textContent = labelize(cadence);
      cadenceSelect.append(option);
    }

    cadenceSelect.disabled = false;
  }

  if (marketTarget) {
    marketTarget.textContent = "";

    for (const market of configPayload.options?.markets ?? []) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const span = document.createElement("span");

      input.type = "checkbox";
      input.name = "bot-allowed-markets";
      input.value = market;
      span.textContent = labelize(market);
      label.append(input, span);
      marketTarget.append(label);
    }
  }

  if (classTarget) {
    classTarget.textContent = "";

    for (const instrumentClass of configPayload.options?.instrumentClasses ?? []) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const span = document.createElement("span");

      input.type = "checkbox";
      input.name = "bot-instrument-classes";
      input.value = instrumentClass;
      span.textContent = labelize(instrumentClass);
      label.append(input, span);
      classTarget.append(label);
    }
  }

  renderBotConfig(configPayload);
}

function renderBotRuns(payload) {
  const target = document.getElementById("bot-runs");

  if (!target) {
    return;
  }

  target.textContent = "";

  for (const run of payload.runs ?? []) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    state.className = run.riskResult === "blocked" ? "pill warn" : "pill ok";
    title.textContent = `${run.strategyId} / ${labelize(run.decision)}`;
    state.textContent = labelize(run.riskResult);
    detail.textContent = `${labelize(run.reasonCode)} at ${new Date(run.evaluatedAt).toLocaleTimeString()}; orders: ${
      run.hypotheticalOrderCount ?? 0
    }`;
    top.append(title, state);
    row.append(top, detail);
    target.append(row);
  }
}

function renderBotEvents(payload) {
  const target = document.getElementById("bot-events");

  if (!target) {
    return;
  }

  target.textContent = "";

  for (const event of payload.events ?? []) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const severity = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    severity.className = event.severity === "warn" ? "pill warn" : "pill ok";
    title.textContent = event.title;
    severity.textContent = labelize(event.type);
    detail.textContent = event.detail;
    top.append(title, severity);
    row.append(top, detail);
    target.append(row);
  }
}

function renderBotTradeLog(payload) {
  const target = document.getElementById("bot-trade-log");

  if (!target) {
    return;
  }

  target.textContent = "";

  if (payload.reportContract) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    state.className = "pill lock";
    title.textContent = "Report contract";
    state.textContent = labelize(payload.reportContract.version);
    detail.textContent = `${labelize(payload.reportContract.ledgerType)}; ${
      labelize(payload.reportContract.executionCapability)
    } execution; ${labelize(payload.reportContract.exportState)}`;
    top.append(title, state);
    row.append(top, detail);
    target.append(row);
  }

  for (const entry of payload.entries ?? []) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    state.className = entry.decision === "blocked" ? "pill warn" : "pill ok";
    title.textContent = `${entry.instrument?.symbol ?? "Synthetic"} / ${labelize(entry.action)}`;
    state.textContent = labelize(entry.reasonCode);
    detail.textContent = `${entry.strategyId}; allocated ${money(entry.budget?.allocatedUsd)}; remaining ${
      money(entry.budget?.remainingUsd)
    }`;
    top.append(title, state);
    row.append(top, detail);
    target.append(row);
  }

  text("bot-trade-log-state", labelize(payload.summary?.source));
}

function renderBotAuditFeed(payload) {
  const list = document.getElementById("bot-audit-list");

  if (!list) {
    return;
  }

  list.textContent = "";

  for (const event of payload.auditEvents ?? []) {
    const item = document.createElement("li");
    const time = document.createElement("span");
    const body = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("small");

    time.className = "event-time";
    time.textContent = new Date(event.createdAt).toLocaleTimeString();
    title.textContent = labelize(event.action);
    detail.textContent = `${labelize(event.outcome)} / ${event.entityRef}`;
    body.append(title, detail);
    item.append(time, body);
    list.append(item);
  }
}

function renderRiskStatus(payload) {
  const risk = payload.portfolioRisk ?? {};
  const safeguards = payload.safeguards ?? {};
  const checks = payload.checks ?? [];
  const checkTarget = document.getElementById("risk-checks");

  renderFixtureWatermark("risk-watermark-state", payload.fixtureWatermark);
  text("risk-source-state", labelize(risk.source));
  text("risk-freshness-state", labelize(risk.freshness));
  text("risk-exposure-state", risk.grossExposurePct === null ? "Unavailable" : `${risk.grossExposurePct}%`);
  text("risk-cash-state", risk.cashBufferPct === null ? "Unavailable" : `${risk.cashBufferPct}%`);
  text("risk-position-state", risk.largestPositionPct === null ? "Unavailable" : `${risk.largestPositionPct}%`);
  text("risk-stale-state", String(risk.stalePositionCount ?? 0));
  text("risk-execution-state", labelize(safeguards.executionRoutes));
  text("risk-payload-state", labelize(safeguards.rawProviderPayloads));
  text("risk-account-state", labelize(safeguards.accountIdentifiers));

  const modePill = document.getElementById("risk-mode-pill");

  if (modePill) {
    modePill.textContent = payload.livePortfolioConnected ? "Live reads" : "Synthetic only";
    modePill.classList.toggle("warn", !payload.livePortfolioConnected);
    modePill.classList.toggle("lock", !payload.livePortfolioConnected);
  }

  if (checkTarget) {
    checkTarget.textContent = "";

    for (const check of checks) {
      const item = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      pill.className = `pill ${check.state === "ok" ? "ok" : check.state === "warn" ? "warn" : "lock"}`;
      pill.textContent = labelize(check.state);
      title.textContent = check.label;
      detail.textContent = check.detail;
      body.append(title, detail);
      item.append(body, pill);
      checkTarget.append(item);
    }
  }

  renderAudit(
    "Risk radar loaded",
    "Read-only DTO loaded; portfolio IDs, raw provider payloads, and execution routes remain absent",
    "risk-audit-list",
  );
}

function renderResearchStatus(payload) {
  const sources = payload.dataSources ?? {};
  const lookup = payload.instrumentLookup ?? {};
  const safeguards = payload.safeguards ?? {};
  const marketNews = payload.marketNews ?? {};
  const intelligence = payload.intelligence ?? {};
  const preview = payload.watchlistPreview ?? [];
  const previewTarget = document.getElementById("research-watchlist");
  const newsTarget = document.getElementById("research-news");
  const positionNewsTarget = document.getElementById("research-position-news");
  const sourceTarget = document.getElementById("research-sources");
  const financialTarget = document.getElementById("research-financial-records");
  const insiderTarget = document.getElementById("research-insider-activity");
  const fieldsTarget = document.getElementById("research-fields");
  const providerTarget = document.getElementById("research-provider-readiness");

  text("research-watchlists-state", labelize(sources.watchlists));
  text("research-instruments-state", labelize(sources.instruments));
  text("research-news-state", labelize(sources.marketNews));
  text("research-records-state", labelize(sources.financialRecords));
  text("research-insider-state", labelize(sources.insiderTransactions));
  text("research-feed-state", labelize(sources.socialFeed));
  text("research-recommendations-state", labelize(sources.recommendations));
  text("research-lookup-state", lookup.enabled ? "Enabled" : "Disabled");
  text("research-symbol-state", labelize(lookup.exactSymbolLookup));
  text("research-watchlist-write-state", labelize(safeguards.watchlistMutation));
  text("research-feed-write-state", labelize(safeguards.feedPosting));
  text("research-account-state", labelize(safeguards.accountIdentifiers));

  if (previewTarget) {
    previewTarget.textContent = "";

    for (const item of preview) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const symbol = document.createElement("strong");
      const note = document.createElement("small");
      const pill = document.createElement("span");

      symbol.textContent = item.symbol;
      note.textContent = `${item.assetClass} - ${item.note}`;
      pill.className = "pill lock";
      pill.textContent = labelize(item.state);
      body.append(symbol, note);
      row.append(body, pill);
      previewTarget.append(row);
    }
  }

  if (fieldsTarget) {
    fieldsTarget.textContent = "";
    fieldsTarget.textContent = (lookup.requiredFields ?? []).join(", ");
  }

  if (newsTarget) {
    newsTarget.textContent = "";

    for (const item of marketNews.rowPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = `${item.symbol} - ${item.headline}`;
      detail.textContent = `Source: ${item.source}; attached to ${item.attachedTo}`;
      pill.className = "pill lock";
      pill.textContent = labelize(item.state);
      body.append(title, detail);
      row.append(body, pill);
      newsTarget.append(row);
    }
  }

  if (sourceTarget) {
    sourceTarget.textContent = "";

    for (const item of intelligence.sourcePriority ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = item.label;
      detail.textContent = `${item.coverage}; ${item.use}`;
      pill.className = item.access?.includes("official") ? "pill ok" : "pill warn";
      pill.textContent = labelize(item.access);
      body.append(title, detail);
      row.append(body, pill);
      sourceTarget.append(row);
    }
  }

  if (providerTarget) {
    providerTarget.textContent = "";

    for (const item of intelligence.providerReadiness ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = item.label;
      detail.textContent = `${labelize(item.defaultState)}; ${item.credentialHandling}`;
      pill.className = item.defaultState?.includes("disabled") ? "pill warn" : "pill lock";
      pill.textContent = item.liveNetworkConnected ? "Live" : "Metadata only";
      body.append(title, detail);
      row.append(body, pill);
      providerTarget.append(row);
    }
  }

  if (financialTarget) {
    financialTarget.textContent = "";

    for (const item of intelligence.financialRecordsPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");
      const figures = (item.keyFigures ?? [])
        .map((figure) => `${figure.label}: ${figure.value}`)
        .join("; ");

      title.textContent = `${item.symbol} - ${labelize(item.coverageState)}`;
      detail.textContent = `${item.assetClass}; ${figures}`;
      pill.className = `pill ${item.coverageState === "sufficient-data" ? "ok" : item.coverageState === "needs-review" ? "warn" : "lock"}`;
      pill.textContent = "Coverage";
      body.append(title, detail);
      row.append(body, pill);
      financialTarget.append(row);
    }
  }

  if (insiderTarget) {
    insiderTarget.textContent = "";

    for (const item of intelligence.insiderActivityPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = `${item.symbol} - ${labelize(item.netDirection)}`;
      detail.textContent = `${item.latestWindow}; ${item.notableActivity}`;
      pill.className = "pill lock";
      pill.textContent = labelize(item.sourceState);
      body.append(title, detail);
      row.append(body, pill);
      insiderTarget.append(row);
    }
  }

  if (positionNewsTarget) {
    positionNewsTarget.textContent = "";

    for (const item of payload.positionContextPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");
      const firstNews = item.news?.[0];

      title.textContent = `${item.symbol} - ${firstNews?.headline ?? "No context"}`;
      detail.textContent = `${item.assetClass}; ${firstNews?.summary ?? "Context unavailable"}`;
      pill.className = "pill lock";
      pill.textContent = item.contextOnly ? "Context only" : labelize(item.positionState);
      body.append(title, detail);
      row.append(body, pill);
      positionNewsTarget.append(row);
    }
  }

  renderAudit(
    "Research desk loaded",
    marketNews.enabled
      ? "Server-side market news summaries loaded for portfolio context"
      : "Official/free APIs are preferred; scraping is fallback only and cannot trigger trades",
    "research-audit-list",
  );
}

async function refreshResearchStatus() {
  const [researchResult, watchlistResult] = await Promise.allSettled([
    getJson("/api/etoro/research/status"),
    getJson("/api/etoro/watchlist/default"),
  ]);
  if (researchResult.status === "fulfilled") {
    renderResearchStatus(researchResult.value);
  } else {
    text("research-watchlists-state", "Unavailable");
    text("research-instruments-state", "Unavailable");
    renderAudit("Research desk failed", "Research status is unavailable", "research-audit-list");
  }
  if (watchlistResult.status === "fulfilled") {
    try {
      renderProviderWatchlist(watchlistResult.value);
    } catch {
      renderWatchlistReadFailure();
    }
  } else {
    renderWatchlistReadFailure();
  }
}

async function refreshRiskStatus() {
  try {
    const status = await getJson("/api/etoro/risk/status");
    renderRiskStatus(status);
  } catch (error) {
    text("risk-source-state", "Unavailable");
    text("risk-freshness-state", "Unavailable");
    renderAudit("Risk radar failed", error.message, "risk-audit-list");
  }
}

async function refreshBotStatus() {
  try {
    const { status, strategies, config, runs, audit, events, tradeLog } = await getJson("/api/etoro/bot/snapshot");
    renderBotStatus(status);
    renderBotControlSelects(status, strategies, config);
    renderBotStrategies(strategies);
    renderBotRuns(runs);
    renderBotAuditFeed(audit);
    renderBotEvents(events);
    renderBotTradeLog(tradeLog);
  } catch (error) {
    text("bot-enabled-state", "Unavailable");
    text("bot-freshness-state", "Unavailable");
    renderAudit("Bot status failed", error.message, "bot-audit-list");
  }
}

async function refreshTradingStatus() {
  try {
    const status = await getJson("/api/etoro/demo/trading/status");
    renderTradingStatus(status);
  } catch (error) {
    text("trading-credential-state", "Unavailable");
    renderAudit("Trading status failed", error.message, "trading-audit-list");
  }
}

async function refreshTabStatus(targetId, { force = false } = {}) {
  if (!targetId) {
    return;
  }

  if (!force && loadedTabIds.has(targetId)) {
    return;
  }

  const refreshers = {
    "bot-view": async () => {
      await refreshBotStatus();
      await refreshTradingStatus();
    },
    "portfolio-view": refreshRiskStatus,
    "watchlist-view": refreshResearchStatus,
  };
  const refresher = refreshers[targetId];

  if (!refresher) {
    return;
  }

  await refresher();
  loadedTabIds.add(targetId);
}

function activeTabId() {
  return document.querySelector("[data-tab-target].active")?.dataset.tabTarget ?? portfolioTabId;
}

function activateTab(targetId) {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === targetId;

    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== targetId;
  });

  void refreshTabStatus(targetId);
}

async function refreshEtoro() {
  const button = document.getElementById("refresh-etoro");

  if (button) {
    button.disabled = true;
  }

  try {
    await getJson("/api/health");
    const status = await getJson("/api/etoro/status");
    renderStatus(status);
    const portfolioRead = status.credentialStatus.configured
      ? getJson("/api/etoro/demo/portfolio")
      : Promise.resolve(null);
    const [portfolioResult] = await Promise.allSettled([
      portfolioRead,
      refreshTabStatus(activeTabId(), { force: true }),
    ]);

    if (!status.credentialStatus.configured) {
      const retainedProviderRows = portfolioDataSource === "provider-normalized";
      text(
        "portfolio-read-state",
        retainedProviderRows ? "Portfolio: prior provider rows retained in memory" : "Portfolio: synthetic fixture",
      );
      text(
        "portfolio-freshness",
        retainedProviderRows ? "Freshness: stale; provider is no longer configured" : "Freshness: provider not configured",
      );
      if (!retainedProviderRows) {
        text("portfolio-omitted", "Omitted rows: unavailable until provider read");
        text("portfolio-partial", "Value coverage: synthetic fixture");
      }
      renderAudit(
        retainedProviderRows ? "Provider rows retained in memory" : "Portfolio fixture retained",
        retainedProviderRows
          ? "Provider access is no longer configured; no refresh was attempted and prior rows are marked stale"
          : "No credential values are present in the browser; provider portfolio reads remain server-only",
      );
    } else if (portfolioResult.status === "fulfilled") {
      renderFulfilledProviderPortfolio(portfolioResult.value);
    } else {
      renderPortfolioReadFailure(portfolioResult.reason);
      renderAudit(
        "Partial provider read",
        "Provider status loaded, but portfolio data is unavailable; existing rows are retained in memory only",
      );
    }
  } catch (error) {
    setTile("provider-status", "warn", "Provider offline", "Using synthetic fixtures");
    await refreshTabStatus(activeTabId(), { force: true });
    renderPortfolioReadFailure(error);
    renderAudit("Provider read failed", "Provider status is unavailable; no account-linked data was stored");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function ticketValue(id) {
  return document.getElementById(id)?.value?.trim() ?? "";
}

function collectTradeTicket() {
  return {
    orderType: ticketValue("trade-order-type"),
    instrumentId: ticketValue("trade-instrument-id"),
    side: ticketValue("trade-side"),
    amount: ticketValue("trade-amount"),
    units: ticketValue("trade-units"),
    leverage: ticketValue("trade-leverage"),
    stopLoss: ticketValue("trade-stop-loss"),
    takeProfit: ticketValue("trade-take-profit"),
    positionId: ticketValue("trade-position-id"),
  };
}

function collectBotConfig() {
  return {
    runMode: ticketValue("bot-run-mode-select"),
    strategyId: ticketValue("bot-strategy-select"),
    budgetUsd: Number(ticketValue("bot-budget-select")),
    allowedMarkets: checkedValues("bot-allowed-markets"),
    allowedInstrumentClasses: checkedValues("bot-instrument-classes"),
    cadence: ticketValue("bot-cadence-select"),
  };
}

document.getElementById("refresh-etoro")?.addEventListener("click", refreshEtoro);
document.getElementById("trade-ticket")?.addEventListener("submit", (event) => {
  event.preventDefault();
  renderAudit("Trade submit blocked", "No local execution route exists in this slice", "trading-audit-list");
});
document.getElementById("trade-preview-blocked")?.addEventListener("click", async () => {
  try {
    const preview = await postJson("/api/etoro/demo/trading/preview", collectTradeTicket());
    renderAudit(
      "Trade preview generated",
      `${preview.ticket.orderType} validation passed; execution blocked`,
      "trading-audit-list",
    );
  } catch (error) {
    renderAudit("Trade preview blocked", error.message, "trading-audit-list");
  }
});
document.getElementById("bot-strategy-select")?.addEventListener("change", (event) => {
  applyBotStrategyRuleControls();
  renderAudit(
    "Strategy preview changed",
    `${labelize(event.target.value)} selected locally; save to persist on the server`,
    "bot-audit-list",
  );
});
document.getElementById("bot-budget-select")?.addEventListener("change", (event) => {
  renderAudit(
    "Budget preview changed",
    `${money(Number(event.target.value))} selected locally; save to persist on the server`,
    "bot-audit-list",
  );
});
document.getElementById("bot-config-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const saved = await putJson("/api/etoro/bot/config", collectBotConfig());
    renderBotConfig(saved);
    renderAudit(
      "Bot config persisted",
      "Server-side simulation config saved; execution remains absent",
      "bot-audit-list",
    );
  } catch (error) {
    renderAudit("Bot config rejected", error.message, "bot-audit-list");
  }
});
document.querySelectorAll("[data-tab-target]").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
});
document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => updatePortfolioPeriod(button.dataset.period));
});
document.querySelectorAll("[data-watchlist-period]").forEach((button) => {
  button.addEventListener("click", () => updateWatchlistPeriod(button.dataset.watchlistPeriod));
});
document.querySelectorAll("[data-instrument-row]").forEach((row) => {
  bindPortfolioRow(row);
});
document.querySelectorAll("[data-watchlist-row]").forEach((row) => {
  bindWatchlistRow(row);
});
updatePortfolioPeriod("24h");
updateWatchlistPeriod("24h");
refreshEtoro();
