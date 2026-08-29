(() => {
  "use strict";

const portfolioForbiddenKeys = /^(?:account|position|order|instrument|cid|gcId|rawPayload|providerPayload)(?:Id|Ids|ID|IDs)?$/i;
const portfolioCacheStates = new Set(["miss", "hit", "coalesced", "stale"]);
const marketPeriodIntervals = Object.freeze({
  "24h": "OneHour",
  "1w": "FourHours",
  "1m": "OneDay",
  "1y": "OneDay",
  "5y": "OneWeek",
  max: "OneWeek",
});

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
      /[\u0000-\u001F\u007F]/.test(item.displayName) ||
      item.displayName.length > 120 || !Number.isInteger(item.rank) || item.rank < 0 ||
      !["available", "unavailable"].includes(item.rateStatus)) {
      throw new Error("Watchlist data is unavailable.");
    }
    symbols.add(item.symbol);
    const available = item.rateStatus === "available";
    const numericValues = [item.bid, item.ask];
    if ((available && (!numericValues.every((value) => Number.isFinite(value) && value >= 0) || item.ask < item.bid ||
      (item.lastExecution !== null && (!Number.isFinite(item.lastExecution) || item.lastExecution < 0)) ||
      !isIsoInstant(item.rateUpdatedAt))) ||
      (!available && (item.bid !== null || item.ask !== null || item.lastExecution !== null || item.rateUpdatedAt !== null))) {
      throw new Error("Watchlist data is unavailable.");
    }
    return { ...item, displayName: item.displayName.trim() };
  });
  const unavailable = items.filter(({ rateStatus }) => rateStatus === "unavailable").length;
  if (items.length !== data.itemCount || unavailable !== data.unavailableRateCount ||
    (data.providerState === "complete" && (unavailable > 0 || data.partialFailure !== null)) ||
    (data.providerState === "partial" && unavailable === 0 && data.partialFailure === null) ||
    (data.partialFailure !== null && data.providerState !== "partial")) {
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
    data.interval !== marketPeriodIntervals[expectedPeriod] || !Array.isArray(data.points) || data.points.length < 1 || data.points.length > 1000 ||
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
  const firstClose = points[0].close;
  const expectedChange = firstClose > 0
    ? Number((((points.at(-1).close - firstClose) / firstClose) * 100).toFixed(4))
    : null;
  if (data.providerUpdatedAt !== points.at(-1).at || data.changePercent !== expectedChange) {
    throw new Error("Market chart data is unavailable.");
  }
  return { ...data, displayName: data.displayName.trim(), points, cache: normalizeReadCache(payload.cache, "Market chart data is unavailable.") };
}

function portfolioNumber(value, { negative = false } = {}) {
  return value === null || (Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000 && (negative || value >= 0));
}

function normalizeLivePortfolioPayload(payload) {
  const data = payload?.data;
  const dataKeys = ["environment", "currency", "equity", "availableCash", "totalInvested", "unrealizedPnl", "realizedPnl", "openPositionCount", "instrumentCount", "mirrorCount", "pendingOrderCount", "providerUpdatedAt", "omittedRowCount", "incompleteRowCount", "instruments"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || containsForbiddenPortfolioKey(payload) ||
    !hasExactKeys(payload, ["ok", "mode", "data", "cache"]) || payload.ok !== true || payload.mode !== "read-only" || !data || !hasExactKeys(data, dataKeys) ||
    !["real", "demo"].includes(data.environment) || data.currency !== "USD" || !Array.isArray(data.instruments) || data.instruments.length > 500 ||
    ![data.equity, data.availableCash, data.totalInvested].every(portfolioNumber) || ![data.unrealizedPnl, data.realizedPnl].every((value) => portfolioNumber(value, { negative: true })) ||
    ![data.openPositionCount, data.instrumentCount, data.omittedRowCount, data.incompleteRowCount].every((value) => Number.isInteger(value) && value >= 0) ||
    (data.mirrorCount !== null && (!Number.isInteger(data.mirrorCount) || data.mirrorCount < 0)) ||
    (data.pendingOrderCount !== null && (!Number.isInteger(data.pendingOrderCount) || data.pendingOrderCount < 0)) ||
    (data.providerUpdatedAt !== null && !isIsoInstant(data.providerUpdatedAt))) throw new Error("Portfolio data is unavailable.");
  const symbols = new Set();
  const instruments = data.instruments.map((instrument) => {
    const keys = ["symbol", "displayName", "positionCount", "units", "averageOpenPrice", "currentPrice", "investedValue", "netValue", "unrealizedPnl", "unrealizedPnlPercent", "allocationPercent", "completeness"];
    if (!instrument || !hasExactKeys(instrument, keys) || typeof instrument.symbol !== "string" || !/^[A-Z0-9][A-Z0-9._:/-]{0,31}$/.test(instrument.symbol) || symbols.has(instrument.symbol) ||
      typeof instrument.displayName !== "string" || !instrument.displayName.trim() || instrument.displayName.length > 120 || /[\u0000-\u001F\u007F]/.test(instrument.displayName) ||
      !Number.isInteger(instrument.positionCount) || instrument.positionCount < 1 || !["complete", "partial"].includes(instrument.completeness) ||
      ![instrument.units, instrument.averageOpenPrice, instrument.currentPrice, instrument.investedValue, instrument.netValue, instrument.allocationPercent].every(portfolioNumber) ||
      ![instrument.unrealizedPnl, instrument.unrealizedPnlPercent].every((value) => portfolioNumber(value, { negative: true }))) throw new Error("Portfolio data is unavailable.");
    symbols.add(instrument.symbol); return { ...instrument, displayName: instrument.displayName.trim() };
  });
  if (instruments.length !== data.instrumentCount || instruments.reduce((total, item) => total + item.positionCount, 0) + data.omittedRowCount !== data.openPositionCount) throw new Error("Portfolio data is unavailable.");
  const cache = normalizeReadCache(payload.cache, "Portfolio data is unavailable.");
  return { ...data, instruments, cache };
}

  globalThis.EtoroBrowserContracts = Object.freeze({
    hasExactKeys,
    isIsoInstant,
    normalizeMarketChartPayload,
    normalizeLivePortfolioPayload,
    normalizePortfolioViewPayload,
    normalizeWatchlistViewPayload,
  });
})();
