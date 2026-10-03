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
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
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
    !(hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs"]) || hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs", "retryAt", "failureAt"])) ||
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
  if (!cache || !(hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs"]) || hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs", "retryAt", "failureAt"])) ||
    !portfolioCacheStates.has(cache.state) || !isIsoInstant(cache.cachedAt) || !isIsoInstant(cache.expiresAt) ||
    !Number.isInteger(cache.ttlMs) || cache.ttlMs <= 0 || cache.ttlMs > 300_000 ||
    Date.parse(cache.expiresAt) - Date.parse(cache.cachedAt) !== cache.ttlMs ||
    (cache.retryAt !== undefined && (cache.state !== "stale" || !isIsoInstant(cache.retryAt) || !isIsoInstant(cache.failureAt) || Date.parse(cache.retryAt) < Date.parse(cache.failureAt)))) {
    throw new Error(message);
  }
  return { state: cache.state, cachedAt: cache.cachedAt, expiresAt: cache.expiresAt, ttlMs: cache.ttlMs, ...(cache.retryAt ? { retryAt: cache.retryAt, failureAt: cache.failureAt } : {}) };
}

function normalizeWatchlistViewPayload(payload, expectedEnvironment) {
  if (expectedEnvironment && payload?.environment !== expectedEnvironment) throw new Error("Watchlist data is unavailable.");
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
    (data.providerState === "complete" && (unavailable > 0 || data.omittedItemCount > 0 || data.partialFailure !== null)) ||
    (data.providerState === "partial" && unavailable === 0 && data.omittedItemCount === 0 && data.partialFailure === null) ||
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

function normalizeMarketChartPayload(payload, expectedSymbol, expectedPeriod, expectedEnvironment) {
  if (expectedEnvironment && payload?.environment !== expectedEnvironment) throw new Error("Market chart data is unavailable.");
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
      ![instrument.units, instrument.averageOpenPrice, instrument.currentPrice, instrument.investedValue, instrument.allocationPercent].every(portfolioNumber) ||
      ![instrument.netValue, instrument.unrealizedPnl, instrument.unrealizedPnlPercent].every((value) => portfolioNumber(value, { negative: true }))) throw new Error("Portfolio data is unavailable.");
    symbols.add(instrument.symbol); return { ...instrument, displayName: instrument.displayName.trim() };
  });
  if (instruments.length !== data.instrumentCount || instruments.reduce((total, item) => total + item.positionCount, 0) + data.omittedRowCount !== data.openPositionCount) throw new Error("Portfolio data is unavailable.");
  const cache = normalizeReadCache(payload.cache, "Portfolio data is unavailable.");
  return { ...data, instruments, cache };
}

const draftStrategies = ["dca-cash-reserve", "threshold-rebalance", "volatility-band-accumulator", "slow-trend-allocation", "news-aware-watchlist"];
const operationStatuses = ["pending", "completed", "already-completed", "preflight-blocked", "lease-blocked", "completion-blocked"];
const diagnosticStates = ["not-run", "sufficient-history", "insufficient-history", "invalid-history", "evaluated", "ready", "diagnostics-only", "sufficient-sampling", "limited-sampling", "completed", "sufficient-data", "sufficient", "limited", "supported", "not-evaluated", "available", "trend-confirmed", "trend-not-confirmed", "weekday-grid-covered", "weekday-grid-gaps", "diagnostic-only", "insufficient-data"];
const vetoReasons = ["data-stale", "data-unavailable", "data-invalid", "execution-route-absent", "missing-loss-reconciliation", "missing-order-intent", "missing-reconciliation", "provider-not-connected", "unknown-provider-state", "insufficient-history", "insufficient-data", "risk-blocked", "allocation-unavailable", "allocation-invalid", "budget-exceeded", "reserved-funds", "max-order-exceeded", "strategy-context-only", "stale-data", "no-signal", "invalid-market-history", "market-not-allowed", "instrument-class-not-allowed", "strategy-not-allowed", "daily-decision-cap", "cooldown", "trend-not-confirmed", "position-cap", "turnover-cap"];
function typedAllowedArray(value, allowed) {
  return Array.isArray(value) && value.length > 0 && value.length <= allowed.length && new Set(value).size === value.length && value.every((item) => typeof item === "string" && allowed.includes(item));
}
function normalizeDraftBotConfig(config) {
  const keys = ["runMode", "strategyId", "budgetUsd", "allowedMarkets", "allowedInstrumentClasses", "cadence", "minimumEvaluationIntervalMinutes", "updatedAt"];
  if (!hasExactKeys(config, keys) || config.runMode !== "backtest" || !draftStrategies.includes(config.strategyId) ||
    typeof config.budgetUsd !== "number" || ![500, 1000, 1500, 2500].includes(config.budgetUsd) ||
    !typedAllowedArray(config.allowedMarkets, ["US_EQUITIES", "AU_EQUITIES", "FOREX", "COMMODITIES"]) ||
    !typedAllowedArray(config.allowedInstrumentClasses, ["EQUITY", "ETF", "FOREX", "COMMODITY"]) ||
    !["daily", "weekly"].includes(config.cadence) || config.minimumEvaluationIntervalMinutes !== 240 ||
    (config.updatedAt !== null && !isIsoInstant(config.updatedAt))) throw new Error("Draft configuration is unavailable.");
  const strategies = {
    "dca-cash-reserve": [["US_EQUITIES", "AU_EQUITIES"], ["EQUITY", "ETF"], "daily"],
    "threshold-rebalance": [["US_EQUITIES", "AU_EQUITIES", "COMMODITIES"], ["EQUITY", "ETF", "COMMODITY"], "weekly"],
    "volatility-band-accumulator": [["US_EQUITIES", "AU_EQUITIES"], ["EQUITY", "ETF"], "daily"],
    "slow-trend-allocation": [["US_EQUITIES", "AU_EQUITIES"], ["EQUITY", "ETF"], "weekly"],
    "news-aware-watchlist": [["US_EQUITIES", "AU_EQUITIES", "FOREX", "COMMODITIES"], ["EQUITY", "ETF", "FOREX", "COMMODITY"], "daily"],
  };
  const [markets, classes, cadence] = strategies[config.strategyId];
  if (!config.allowedMarkets.every((value) => markets.includes(value)) || !config.allowedInstrumentClasses.every((value) => classes.includes(value)) || config.cadence !== cadence) throw new Error("Draft configuration is unavailable.");
  const compatible = new Set(config.allowedMarkets.flatMap((market) => ({ US_EQUITIES: ["EQUITY", "ETF"], AU_EQUITIES: ["EQUITY", "ETF"], FOREX: ["FOREX"], COMMODITIES: ["COMMODITY", "ETF"] })[market]));
  if (!config.allowedInstrumentClasses.every((value) => compatible.has(value))) throw new Error("Draft configuration is unavailable.");
  return config;
}
function operationsInstant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
}
function normalizeOfflineOperationsPayload(payload) {
  const keys = ["ok", "dtoVersion", "adapterId", "state", "observedAt", "expiresAt", "source", "capabilities", "runtime", "lease", "ledger", "lastResult", "operation", "safety"];
  const fail = () => { throw new Error("Offline diagnostic telemetry is unavailable."); };
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!(hasExactKeys(payload, keys) || hasExactKeys(payload, [...keys, "action"])) || payload.ok !== true ||
    payload.dtoVersion !== "dashboard-offline-operations.v1" || payload.adapterId !== "money-maker-3000" ||
    !["ready", "stale", "blocked", "in-progress", "unavailable"].includes(payload.state) ||
    !operationsInstant(payload.observedAt) || !operationsInstant(payload.expiresAt) || Date.parse(payload.expiresAt) - Date.parse(payload.observedAt) !== 30_000 ||
    payload.source !== "isolated-synthetic-engine" || !hasExactKeys(payload.capabilities, ["runOnce", "block", "reenable"]) ||
    Object.values(payload.capabilities).some((value) => typeof value !== "boolean")) fail();
  const runtime = payload.runtime;
  if (!hasExactKeys(runtime, ["verified", "producerCommit", "manifestId", "fixture", "strategyId", "budgetUsd", "botAllocationUsd", "reservedUsd", "maxOrderUsd"]) ||
    runtime.verified !== true || runtime.producerCommit !== "c17248ce097c3ed03e1e262be972023f48e63636" || runtime.manifestId !== "approved-slow-trend-fixture-diagnostics" ||
    runtime.fixture !== "SPY synthetic daily" || runtime.strategyId !== "slow-trend-allocation" || runtime.budgetUsd !== 1000 || runtime.botAllocationUsd !== 1000 || runtime.reservedUsd !== 100 || runtime.maxOrderUsd !== 250) fail();
  const safety = { providerCalls: "blocked", credentials: "absent", accountData: "absent", executionRoutes: "absent", performanceClaims: "synthetic-diagnostics-no-investment-profit-evidence", blockBehavior: "fences-completion-does-not-terminate-process" };
  if (!hasExactKeys(payload.safety, Object.keys(safety)) || Object.entries(safety).some(([key, value]) => payload.safety[key] !== value)) fail();
  const lease = payload.lease, ledger = payload.ledger;
  if (!hasExactKeys(lease, ["integrity", "workerState", "completionCount", "killSwitchReason"]) ||
    !["clean", "uninitialized", "unavailable", "corrupted"].includes(lease.integrity) ||
    !["available", "busy", "kill-switch-blocked", "completion-capacity-blocked", "blocked"].includes(lease.workerState) ||
    (lease.completionCount !== null && !validCount(lease.completionCount)) || ![null, "operator-stop", "operator-reenable"].includes(lease.killSwitchReason) ||
    !hasExactKeys(ledger, ["integrity", "recordCount", "latestRecordedAt"]) ||
    !["clean", "missing", "corrupted", "recovered-with-warnings", "not-assessed"].includes(ledger.integrity) || !validCount(ledger.recordCount) ||
    (ledger.latestRecordedAt !== null && !operationsInstant(ledger.latestRecordedAt))) fail();
  if (payload.operation !== null && (!hasExactKeys(payload.operation, ["id", "action", "startedAt", "status"]) || typeof payload.operation.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.operation.id) || !["run-once", "block", "reenable"].includes(payload.operation.action) || !operationsInstant(payload.operation.startedAt) || !operationStatuses.includes(payload.operation.status))) fail();
  const result = payload.lastResult;
  if (result !== null) {
    if (!hasExactKeys(result, ["status", "startedAt", "diagnostics", "vetoReasons"]) || !operationStatuses.includes(result.status) || !operationsInstant(result.startedAt) ||
      !Array.isArray(result.vetoReasons) || result.vetoReasons.length > vetoReasons.length || new Set(result.vetoReasons).size !== result.vetoReasons.length || result.vetoReasons.some((value) => !vetoReasons.includes(value))) fail();
    const details = result.diagnostics;
    if (details !== null && (!hasExactKeys(details, ["fixtureRows", "eventCount", "blockedEventCount", "strategyHistoryState", "walkForwardState", "samplingState"]) ||
      ![details.fixtureRows, details.eventCount, details.blockedEventCount].every(validCount) || details.blockedEventCount > details.eventCount ||
      ![details.strategyHistoryState, details.walkForwardState, details.samplingState].every((value) => diagnosticStates.includes(value)))) fail();
  }
  if (payload.action !== undefined && (!hasExactKeys(payload.action, ["type", "status"]) || !["run-once", "block", "reenable"].includes(payload.action.type) || !operationStatuses.includes(payload.action.status))) fail();
  return payload;
}

  globalThis.EtoroBrowserContracts = Object.freeze({
    hasExactKeys,
    normalizeOfflineOperationsPayload,
    normalizeDraftBotConfig,
    isIsoInstant,
    normalizeMarketChartPayload,
    normalizeLivePortfolioPayload,
    normalizePortfolioViewPayload,
    normalizeWatchlistViewPayload,
  });
})();
