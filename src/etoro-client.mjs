import { randomUUID } from "node:crypto";

const SENSITIVE_HEADER_NAMES = new Set(["x-api-key", "x-user-key", "authorization"]);
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 60_000;
const ALLOWED_ETORO_PROVIDER_ORIGIN = "https://public-api.etoro.com";
const SAFE_INSTRUMENT_SYMBOL = /^[A-Z0-9][A-Z0-9._:/-]{0,31}$/;

export class EtoroApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EtoroApiError";
    this.code = options.code ?? "ETORO_API_ERROR";
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export const READ_ONLY_ENDPOINTS = Object.freeze({
  identity: Object.freeze({
    method: "GET",
    path: "/api/v1/me",
    normalize: normalizeIdentity,
  }),
  demoPnl: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/demo/pnl",
    normalize: normalizeDemoPnl,
  }),
  realPnl: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/real/pnl",
    normalize: normalizeDemoPnl,
  }),
  demoPortfolio: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/demo/portfolio",
    normalize: normalizeDemoPortfolio,
  }),
  realPortfolio: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/portfolio",
    normalize: normalizeDemoPortfolio,
  }),
  defaultWatchlist: Object.freeze({
    method: "GET",
    path: "/api/v1/watchlists/default-watchlists/items?itemsLimit=100&itemsPerPage=100",
    normalize: normalizeDefaultWatchlist,
  }),
  instrumentSearch: Object.freeze({
    method: "GET",
    path: ({ symbol: rawSymbol }) => {
      const symbol = requireSafeSymbol(rawSymbol);
      const query = new URLSearchParams({
        fields: "instrumentId,internalSymbolFull,displayname,marketId",
        internalSymbolFull: symbol,
        pageSize: "10",
      });
      return `/api/v1/market-data/search?${query}`;
    },
    normalize: normalizeInstrumentSearch,
  }),
  marketRates: Object.freeze({
    method: "GET",
    path: ({ instrumentIds }) =>
      `/api/v1/market-data/instruments/rates?instrumentIds=${validatedInstrumentIds(instrumentIds).join(",")}`,
    normalize: normalizeMarketRates,
  }),
  marketCandles: Object.freeze({
    method: "GET",
    path: (params) => {
      const instrumentId = positiveInstrumentId(params.instrumentId);
      const allowedIntervals = new Set(["OneMinute", "FiveMinutes", "TenMinutes", "FifteenMinutes", "ThirtyMinutes", "OneHour", "FourHours", "OneDay", "OneWeek"]);
      if (instrumentId === null || !["asc", "desc"].includes(params.direction) || !allowedIntervals.has(params.interval) ||
        !Number.isInteger(params.candlesCount) || params.candlesCount < 1 || params.candlesCount > 1000) {
        throw new EtoroApiError("Market candle request parameters are invalid", { code: "ETORO_INVALID_MARKET_QUERY", status: 400 });
      }
      return `/api/v1/market-data/instruments/${instrumentId}/history/candles/${params.direction}/${params.interval}/${params.candlesCount}`;
    },
    normalize: normalizeMarketCandles,
  }),
});

export function redactSecrets(input, secrets = []) {
  const secretValues = secrets.filter((value) => typeof value === "string" && value.length > 0);
  let output = typeof input === "string" ? input : JSON.stringify(input);

  for (const secret of secretValues) {
    output = output.split(secret).join("[REDACTED]");
  }

  output = output.replace(
    /\b(x-api-key|x-user-key|authorization)\b\s*[:=]\s*["']?[^"',\s}]+/gi,
    (_, name) => `${name}: [REDACTED]`,
  );

  return output;
}

export function buildEtoroHeaders(credentials, requestId = randomUUID()) {
  if (!credentials?.apiKey || !credentials?.userKey) {
    throw new EtoroApiError("eToro credentials are not configured", {
      code: "ETORO_CREDENTIALS_MISSING",
    });
  }

  return {
    accept: "application/json",
    "x-request-id": requestId,
    "x-api-key": credentials.apiKey,
    "x-user-key": credentials.userKey,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function requiredArray(value) {
  return Array.isArray(value) ? value : null;
}

function optionalArray(value) {
  return value === undefined ? [] : requiredArray(value);
}

function flattenRequiredCollections(items, field) {
  if (!Array.isArray(items)) return null;
  const flattened = [];
  for (const item of items) {
    const nested = requiredArray(item?.[field]);
    if (nested === null) return null;
    flattened.push(...nested);
  }
  return flattened;
}

function flattenOptionalCollections(items, field) {
  if (!Array.isArray(items)) return null;
  const flattened = [];
  for (const item of items) {
    const nested = optionalArray(item?.[field]);
    if (nested === null) return null;
    flattened.push(...nested);
  }
  return flattened;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function sumRequired(items, valueForItem) {
  if (!Array.isArray(items)) return null;
  let total = 0;
  for (const item of items) {
    const value = valueForItem(item);
    if (value === null || !Number.isFinite(value)) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function sumAmounts(items) {
  return sumRequired(items, (item) => firstNumber(item?.amount, item?.invested, item?.currentInvestment));
}

function sumExternalCosts(items) {
  return sumRequired(items, (item) => firstNumber(item?.totalExternalCosts, item?.totalExternalCost));
}

function pnlAmount(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return firstNumber(value.pnL, value.pnl, value.value, value.amount);
  }

  return firstNumber(value);
}

function sumPositionPnl(items) {
  return sumRequired(items, (item) => pnlAmount(item?.unrealizedPnL ?? item?.unrealizedPnl ?? item?.pnL));
}

function roundCurrency(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeIdentity(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new EtoroApiError("Identity response did not match expected shape", {
      code: "ETORO_INVALID_IDENTITY_RESPONSE",
    });
  }

  const gcid = numberOrNull(payload.gcid);
  const realCid = numberOrNull(payload.realCid);
  const demoCid = numberOrNull(payload.demoCid);

  if (gcid === null || realCid === null || demoCid === null) {
    throw new EtoroApiError("Identity response did not include documented account references", {
      code: "ETORO_INVALID_IDENTITY_RESPONSE",
    });
  }

  return {
    authenticated: true,
    accountRefs: {
      hasGcid: true,
      hasRealCid: true,
      hasDemoCid: true,
    },
  };
}

function normalizeDemoPnl(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new EtoroApiError("Demo PnL response did not match expected shape", {
      code: "ETORO_INVALID_DEMO_PNL_RESPONSE",
    });
  }

  const portfolio = payload.clientPortfolio ?? payload;
  if (!portfolio || typeof portfolio !== "object" || Array.isArray(portfolio)) {
    throw new EtoroApiError("Demo PnL response did not include a supported portfolio shape", {
      code: "ETORO_INVALID_DEMO_PNL_RESPONSE",
    });
  }
  if (portfolio !== payload.clientPortfolio &&
    firstNumber(portfolio.credits, portfolio.credit, portfolio.cash, portfolio.balance, portfolio.availableBalance) === null &&
    !Array.isArray(portfolio.positions)) {
    throw new EtoroApiError("Demo PnL response did not include documented portfolio fields", {
      code: "ETORO_INVALID_DEMO_PNL_RESPONSE",
    });
  }
  const positions = requiredArray(
    portfolio.positions ??
      portfolio.openPositions ??
      portfolio.instrumentPositions ??
      portfolio.trades,
  );
  const mirrors = requiredArray(portfolio.mirrors);
  const mirrorPositions = flattenRequiredCollections(mirrors, "positions");
  const orders = requiredArray(portfolio.orders);
  const ordersForOpen = requiredArray(portfolio.ordersForOpen);
  const ordersForClose = optionalArray(portfolio.ordersForClose);
  const ordersForCloseMultiple = optionalArray(portfolio.ordersForCloseMultiple);
  const mirrorOrdersForOpen = flattenRequiredCollections(mirrors, "ordersForOpen");
  const mirrorOrdersForClose = flattenOptionalCollections(mirrors, "ordersForClose");
  const mirrorOrdersForCloseMultiple = flattenOptionalCollections(mirrors, "ordersForCloseMultiple");
  const allOrdersForOpen = ordersForOpen && mirrorOrdersForOpen ? [...ordersForOpen, ...mirrorOrdersForOpen] : null;
  const allOrdersForClose = ordersForClose && ordersForCloseMultiple && mirrorOrdersForClose && mirrorOrdersForCloseMultiple
    ? [...ordersForClose, ...ordersForCloseMultiple, ...mirrorOrdersForClose, ...mirrorOrdersForCloseMultiple]
    : null;
  const manualOrdersForOpen = ordersForOpen?.filter((order) => {
    const mirrorId = firstNumber(order?.mirrorID, order?.mirrorId, order?.mirrorid);
    return mirrorId === 0;
  });
  const credit = firstNumber(
    portfolio.credits,
    portfolio.credit,
    portfolio.cash,
    portfolio.balance,
    portfolio.availableBalance,
  );
  const pendingManualAmount = sumAmounts(manualOrdersForOpen);
  const pendingOrderAmount = sumAmounts(orders);
  const availableCash = credit !== null && pendingManualAmount !== null && pendingOrderAmount !== null
    ? roundCurrency(credit - pendingManualAmount - pendingOrderAmount)
    : null;
  const mirrorAvailableNet = sumRequired(mirrors, (mirror) => {
    const availableAmount = firstNumber(mirror?.availableAmount);
    const closedProfit = firstNumber(mirror?.closedPositionsNetProfit);
    return availableAmount === null || closedProfit === null ? null : availableAmount - closedProfit;
  });
  const totalInvestedComponents = [
    sumAmounts(positions),
    sumAmounts(mirrorPositions),
    mirrorAvailableNet,
    pendingManualAmount,
    pendingOrderAmount,
    sumExternalCosts(manualOrdersForOpen),
  ];
  const totalInvested = totalInvestedComponents.every((value) => value !== null)
    ? roundCurrency(totalInvestedComponents.reduce((total, value) => total + value, 0))
    : null;
  const calculatedUnrealizedComponents = [
    sumPositionPnl(positions),
    sumPositionPnl(mirrorPositions),
    sumRequired(mirrors, (mirror) => firstNumber(mirror?.closedPositionsNetProfit)),
  ];
  const calculatedUnrealizedPnL = calculatedUnrealizedComponents.every((value) => value !== null)
    ? roundCurrency(calculatedUnrealizedComponents.reduce((total, value) => total + value, 0))
    : null;
  const unrealizedPnL = firstNumber(
    portfolio.unrealizedPnL,
    portfolio.unrealizedPnl,
    portfolio.netProfit,
    calculatedUnrealizedPnL,
  );
  const equity = firstNumber(
    portfolio.equity,
    portfolio.netLiq,
    portfolio.netLiquidation,
    availableCash !== null && totalInvested !== null && unrealizedPnL !== null
      ? roundCurrency(availableCash + totalInvested + unrealizedPnL)
      : null,
  );

  return {
    currency: "USD",
    credit,
    equity,
    realizedPnL: firstNumber(
      portfolio.realizedPnL,
      portfolio.realizedPnl,
      portfolio.realizedProfit,
    ),
    unrealizedPnL,
    availableCash,
    totalInvested,
    calculatedUnrealizedPnL,
    positionCount: positions !== null && mirrorPositions !== null ? positions.length + mirrorPositions.length : null,
    mirrorCount: mirrors?.length ?? null,
    pendingOrderCount: orders !== null && allOrdersForOpen !== null && allOrdersForClose !== null
      ? orders.length + allOrdersForOpen.length + allOrdersForClose.length
      : null,
    manualPendingOrderCount: manualOrdersForOpen?.length ?? null,
    providerUpdatedAt: normalizeTimestamp(
      portfolio.updatedAt ??
        portfolio.lastUpdatedAt ??
        portfolio.lastUpdate ??
        portfolio.serverTime,
    ),
  };
}

function normalizeDemoPortfolio(payload) {
  const portfolio = payload?.clientPortfolio;

  if (!portfolio || typeof portfolio !== "object" || Array.isArray(portfolio)) {
    throw new EtoroApiError("Demo portfolio response did not include clientPortfolio", {
      code: "ETORO_INVALID_DEMO_PORTFOLIO_RESPONSE",
    });
  }

  const rawPositions = portfolio.positions ?? portfolio.openPositions ?? portfolio.instrumentPositions;

  if (!Array.isArray(rawPositions)) {
    throw new EtoroApiError("Demo portfolio response did not include a positions array", {
      code: "ETORO_INVALID_DEMO_PORTFOLIO_RESPONSE",
    });
  }

  const positions = rawPositions;
  const instruments = new Map();
  let omittedPositionCount = 0;
  let incompleteValuePositionCount = 0;

  for (const position of positions) {
    const rawSymbol =
      position?.instrumentSymbol ?? position?.symbol ?? position?.internalSymbolFull;
    const symbol = typeof rawSymbol === "string" ? rawSymbol.trim().toUpperCase() : "";

    if (!SAFE_INSTRUMENT_SYMBOL.test(symbol)) {
      omittedPositionCount += 1;
      continue;
    }

    const investedUsd = firstNumber(
      position?.amount,
      position?.invested,
      position?.currentInvestment,
    );
    const units = firstNumber(position?.units, position?.amountInUnits, position?.unitsAmount);
    const averageOpenPrice = firstNumber(position?.openRate, position?.averageOpenPrice, position?.openPrice);
    const currentPrice = firstNumber(position?.currentRate, position?.currentPrice, position?.rate);
    const displayName = safeDisplayText(position?.displayName ?? position?.instrumentDisplayName ?? position?.name, symbol);
    const unrealizedPnlUsd = pnlAmount(
      position?.unrealizedPnL ?? position?.unrealizedPnl ?? position?.pnL,
    );
    const hasCompleteValues = investedUsd !== null && investedUsd >= 0 && unrealizedPnlUsd !== null;

    if (!hasCompleteValues) {
      incompleteValuePositionCount += 1;
    }

    const current = instruments.get(symbol) ?? {
      symbol,
      positionCount: 0,
      investedUsd: 0,
      unrealizedPnlUsd: 0,
      units: 0,
      averageOpenPrice: null,
      currentPrice: null,
      weightedOpenTotal: 0,
      weightedOpenUnits: 0,
      displayName,
      marketValuesComplete: true,
      valuesComplete: true,
    };
    const nextInvestedUsd = current.investedUsd + (
      investedUsd !== null && investedUsd >= 0 ? investedUsd : 0
    );
    const nextUnrealizedPnlUsd = current.unrealizedPnlUsd + (unrealizedPnlUsd ?? 0);
    const totalsComplete = Number.isFinite(nextInvestedUsd) && Number.isFinite(nextUnrealizedPnlUsd);

    if (hasCompleteValues && !totalsComplete) {
      incompleteValuePositionCount += 1;
    }

    current.positionCount += 1;
    current.valuesComplete &&= hasCompleteValues && totalsComplete;
    const usableMarketValues = units !== null && units > 0 && averageOpenPrice !== null && averageOpenPrice >= 0 && currentPrice !== null && currentPrice >= 0;
    current.marketValuesComplete &&= usableMarketValues;
    current.investedUsd = Number.isFinite(nextInvestedUsd) ? nextInvestedUsd : 0;
    current.unrealizedPnlUsd = Number.isFinite(nextUnrealizedPnlUsd)
      ? nextUnrealizedPnlUsd
      : 0;
    if (usableMarketValues) {
      current.units = Number.isFinite(current.units + units) ? current.units + units : 0;
      current.weightedOpenTotal += units * averageOpenPrice;
      current.weightedOpenUnits += units;
      if (current.currentPrice === null) current.currentPrice = currentPrice;
      else if (current.currentPrice !== currentPrice) current.marketValuesComplete = false;
    }
    instruments.set(symbol, current);
  }

  return {
    currency: "USD",
    positionCount: positions.length,
    instrumentCount: instruments.size,
    omittedPositionCount,
    incompleteValuePositionCount,
    instruments: [...instruments.values()]
      .map(({ valuesComplete, marketValuesComplete, weightedOpenTotal, weightedOpenUnits, ...instrument }) => ({
        ...instrument,
        investedUsd: valuesComplete ? roundCurrency(instrument.investedUsd) : null,
        unrealizedPnlUsd: valuesComplete ? roundCurrency(instrument.unrealizedPnlUsd) : null,
        units: marketValuesComplete && weightedOpenUnits > 0 ? instrument.units : null,
        averageOpenPrice: marketValuesComplete && weightedOpenUnits > 0 ? roundCurrency(weightedOpenTotal / weightedOpenUnits) : null,
        currentPrice: marketValuesComplete ? instrument.currentPrice : null,
        valueStatus: valuesComplete ? "complete" : "incomplete",
      }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol)),
    providerUpdatedAt: normalizeTimestamp(
      portfolio.updatedAt ?? portfolio.lastUpdatedAt ?? portfolio.serverTime,
    ),
  };
}

function positiveInstrumentId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : null;
}

function requireSafeSymbol(value) {
  const symbol = normalizedSymbol(value);
  if (!symbol) throw new EtoroApiError("Instrument symbol is invalid", { code: "ETORO_INVALID_SYMBOL", status: 400 });
  return symbol;
}

function validatedInstrumentIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new EtoroApiError("Market rate request parameters are invalid", { code: "ETORO_INVALID_MARKET_QUERY", status: 400 });
  }
  const ids = values.map(positiveInstrumentId);
  if (ids.includes(null) || new Set(ids).size !== ids.length) {
    throw new EtoroApiError("Market rate request parameters are invalid", { code: "ETORO_INVALID_MARKET_QUERY", status: 400 });
  }
  return ids;
}

function marketNumberOrNull(value) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeDisplayText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized && normalized.length <= 120 && !/[\u0000-\u001F\u007F]/.test(normalized)
    ? normalized
    : fallback;
}

function normalizedSymbol(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SAFE_INSTRUMENT_SYMBOL.test(symbol) ? symbol : null;
}

function normalizeDefaultWatchlist(payload) {
  if (!Array.isArray(payload)) {
    throw new EtoroApiError("Default watchlist response did not match expected shape", {
      code: "ETORO_INVALID_WATCHLIST_RESPONSE",
    });
  }

  const items = [];
  let omittedItemCount = 0;
  const seenSymbols = new Set();

  for (const item of payload.slice(0, 100)) {
    const instrumentId = positiveInstrumentId(item?.itemId ?? item?.ItemId);
    const itemType = item?.itemType ?? item?.ItemType;
    const symbol = normalizedSymbol(item?.market?.symbolName ?? item?.market?.internalSymbolFull);
    const rank = Number(item?.itemRank ?? item?.ItemRank ?? 0);

    if (itemType !== "Instrument" || instrumentId === null || !symbol || seenSymbols.has(symbol) ||
      !Number.isInteger(rank) || rank < 0) {
      omittedItemCount += 1;
      continue;
    }

    seenSymbols.add(symbol);
    items.push({
      instrumentId,
      symbol,
      displayName: safeDisplayText(item?.market?.displayName, symbol),
      rank,
    });
  }

  omittedItemCount += Math.max(0, payload.length - 100);
  items.sort((left, right) => left.rank - right.rank || left.symbol.localeCompare(right.symbol));
  return { items, omittedItemCount };
}

function normalizeInstrumentSearch(payload, params) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.items)) {
    throw new EtoroApiError("Instrument search response did not match expected shape", {
      code: "ETORO_INVALID_INSTRUMENT_SEARCH_RESPONSE",
    });
  }

  const requestedSymbol = normalizedSymbol(params?.symbol);
  if (!requestedSymbol) {
    throw new EtoroApiError("Instrument symbol is invalid", { code: "ETORO_INVALID_SYMBOL", status: 400 });
  }

  const matches = payload.items.flatMap((item) => {
    const symbol = normalizedSymbol(item?.internalSymbolFull);
    const instrumentId = positiveInstrumentId(item?.instrumentId ?? item?.InstrumentID);
    if (symbol !== requestedSymbol || instrumentId === null) return [];
    return [{ instrumentId, symbol, displayName: safeDisplayText(item?.displayname, symbol) }];
  });

  if (matches.length === 0) {
    throw new EtoroApiError("Instrument symbol was not resolved", {
      code: "ETORO_SYMBOL_NOT_FOUND",
      status: 404,
    });
  }

  if (matches.length !== 1 || new Set(matches.map(({ instrumentId }) => instrumentId)).size !== 1) {
    throw new EtoroApiError("Instrument symbol resolution was ambiguous", {
      code: "ETORO_SYMBOL_AMBIGUOUS",
      status: 502,
    });
  }

  return matches[0];
}

function normalizeMarketRates(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.rates)) {
    throw new EtoroApiError("Market rates response did not match expected shape", {
      code: "ETORO_INVALID_MARKET_RATES_RESPONSE",
    });
  }

  const rates = [];
  const seenIds = new Set();
  for (const rate of payload.rates) {
      const instrumentId = positiveInstrumentId(rate?.instrumentID ?? rate?.instrumentId);
      const bid = marketNumberOrNull(rate?.bid);
      const ask = marketNumberOrNull(rate?.ask);
      const lastExecution = marketNumberOrNull(rate?.lastExecution);
      const updatedAt = normalizeTimestamp(rate?.date);
      if (instrumentId === null || seenIds.has(instrumentId) || bid === null || ask === null || bid < 0 || ask < 0 ||
        (lastExecution !== null && lastExecution < 0) || !updatedAt) continue;
      seenIds.add(instrumentId);
      rates.push({ instrumentId, bid, ask, lastExecution, updatedAt });
  }
  return { rates };
}

function normalizeMarketCandles(payload, params) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    payload.interval !== params?.interval || !Array.isArray(payload.candles)) {
    throw new EtoroApiError("Market candle response did not match expected shape", {
      code: "ETORO_INVALID_MARKET_CANDLES_RESPONSE",
    });
  }

  const groups = payload.candles.filter((candidate) =>
    positiveInstrumentId(candidate?.instrumentId ?? candidate?.InstrumentID) === params.instrumentId);
  const group = groups[0];
  if (groups.length !== 1 || !group || !Array.isArray(group.candles) ||
    group.candles.length < 1 || group.candles.length > params.candlesCount) {
    throw new EtoroApiError("Market candle response omitted the requested instrument", {
      code: "ETORO_INVALID_MARKET_CANDLES_RESPONSE",
    });
  }

  const points = group.candles.flatMap((candle) => {
    const at = normalizeTimestamp(candle?.fromDate);
    const close = marketNumberOrNull(candle?.close);
    const candleInstrumentId = positiveInstrumentId(candle?.instrumentID ?? candle?.instrumentId);
    return at && close !== null && close >= 0 && candleInstrumentId === params.instrumentId ? [{ at, close }] : [];
  });
  if (points.length === 0 || points.length !== group.candles.length ||
    points.some((point, index) => index > 0 && point.at <= points[index - 1].at)) {
    throw new EtoroApiError("Market candle response contained invalid points", {
      code: "ETORO_INVALID_MARKET_CANDLES_RESPONSE",
    });
  }

  return { interval: payload.interval, points };
}

function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const seconds = Number(value);
  const parsedMs = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - nowMs;

  if (!Number.isFinite(parsedMs) || parsedMs <= 0) {
    return null;
  }

  return Math.min(Math.ceil(parsedMs), MAX_RETRY_AFTER_MS);
}

async function parseProviderJson(response, requestId, secrets) {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new EtoroApiError("eToro returned invalid JSON", {
      code: "ETORO_INVALID_JSON",
      status: response.status,
      requestId,
      details: redactSecrets(text.slice(0, 300), secrets),
    });
  }
}

function assertNoSensitiveHeaders(headers) {
  for (const headerName of Object.keys(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(headerName.toLowerCase()) && !headers[headerName]) {
      throw new EtoroApiError(`Missing required ${headerName} header`, {
        code: "ETORO_HEADER_MISSING",
      });
    }
  }
}

function assertAllowedProviderBaseUrl(baseUrl) {
  let parsed;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new EtoroApiError("Invalid eToro API base URL", {
      code: "ETORO_INVALID_BASE_URL",
    });
  }

  if (
    parsed.origin !== ALLOWED_ETORO_PROVIDER_ORIGIN ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new EtoroApiError("Invalid eToro API base URL", {
      code: "ETORO_INVALID_BASE_URL",
    });
  }
}

export async function fetchReadOnlyEndpoint(endpointName, options = {}) {
  const endpoint = READ_ONLY_ENDPOINTS[endpointName];

  if (!endpoint || endpoint.method !== "GET") {
    throw new EtoroApiError("Requested eToro endpoint is not in the read-only allow-list", {
      code: "ETORO_ENDPOINT_NOT_ALLOWED",
    });
  }

  const credentials = options.credentials;
  const requestId = options.requestId ?? randomUUID();
  const headers = buildEtoroHeaders(credentials, requestId);
  assertNoSensitiveHeaders(headers);
  assertAllowedProviderBaseUrl(credentials.baseUrl);

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const params = options.params ?? {};
  const path = typeof endpoint.path === "function" ? endpoint.path(params) : endpoint.path;
  const url = new URL(path, `${credentials.baseUrl}/`);
  const secrets = [credentials.apiKey, credentials.userKey];
  const startedAtMs = now();

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const receivedAtMs = now();

    if (!response.ok) {
      throw new EtoroApiError(`eToro request failed with HTTP ${response.status}`, {
        code: "ETORO_PROVIDER_ERROR",
        status: response.status,
        requestId,
        retryAfterMs: response.status === 429
          ? parseRetryAfterMs(response.headers.get("retry-after"), receivedAtMs)
          : null,
      });
    }

    const payload = await parseProviderJson(response, requestId, secrets);

    return {
      data: endpoint.normalize(payload, params),
      provider: {
        endpoint: endpointName,
        method: endpoint.method,
        path,
        baseUrl: credentials.baseUrl,
        status: response.status,
        requestId,
        receivedAt: new Date(receivedAtMs).toISOString(),
        durationMs: Math.max(0, receivedAtMs - startedAtMs),
      },
    };
  } catch (error) {
    if (error instanceof EtoroApiError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new EtoroApiError("eToro request timed out", {
        code: "ETORO_TIMEOUT",
        requestId,
      });
    }

    throw new EtoroApiError(redactSecrets(error?.message ?? "eToro request failed", secrets), {
      code: "ETORO_FETCH_FAILED",
      requestId,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function finiteDisplayNumber(value, allowNegative = false) {
  const number = numberOrNull(value);
  return number !== null && (allowNegative || number >= 0) && Math.abs(number) <= 1_000_000_000_000 ? roundCurrency(number) : null;
}

/** Compose the only account-linked DTO permitted to cross the browser boundary. */
export async function fetchPortfolioSnapshot(environment, options = {}) {
  if (!["real", "demo"].includes(environment)) {
    throw new EtoroApiError("Requested eToro environment is invalid", { code: "ETORO_INVALID_ENVIRONMENT", status: 400 });
  }
  const endpointPrefix = environment === "real" ? "real" : "demo";
  const read = options.fetchEndpoint
    ? (endpointName) => options.fetchEndpoint(endpointName, { credentials: options.credentials })
    : (endpointName) => fetchReadOnlyEndpoint(endpointName, options);
  const [identity, pnl, portfolio] = await Promise.all([
    read("identity"), read(`${endpointPrefix}Pnl`), read(`${endpointPrefix}Portfolio`),
  ]);
  if (!identity.data?.authenticated) throw new EtoroApiError("Identity response was not authenticated", { code: "ETORO_INVALID_IDENTITY_RESPONSE" });
  const normalizedInstruments = portfolio.data.instruments.map((instrument) => {
    const investedValue = finiteDisplayNumber(instrument.investedUsd);
    const unrealizedPnl = finiteDisplayNumber(instrument.unrealizedPnlUsd, true);
    const netValue = investedValue !== null && unrealizedPnl !== null ? finiteDisplayNumber(investedValue + unrealizedPnl, true) : null;
    const allocationPercent = pnl.data.totalInvested !== null && pnl.data.totalInvested > 0 && investedValue !== null
      ? finiteDisplayNumber((investedValue / pnl.data.totalInvested) * 100)
      : null;
    return {
      symbol: instrument.symbol,
      displayName: safeDisplayText(instrument.displayName, instrument.symbol),
      positionCount: instrument.positionCount,
      units: finiteDisplayNumber(instrument.units),
      averageOpenPrice: finiteDisplayNumber(instrument.averageOpenPrice),
      currentPrice: finiteDisplayNumber(instrument.currentPrice),
      investedValue,
      netValue,
      unrealizedPnl,
      unrealizedPnlPercent: investedValue && unrealizedPnl !== null ? finiteDisplayNumber((unrealizedPnl / investedValue) * 100, true) : null,
      allocationPercent,
      completeness: instrument.valueStatus === "complete" ? "complete" : "partial",
    };
  });
  return {
    data: {
      environment,
      currency: "USD",
      equity: finiteDisplayNumber(pnl.data.equity),
      availableCash: finiteDisplayNumber(pnl.data.availableCash),
      totalInvested: finiteDisplayNumber(pnl.data.totalInvested),
      unrealizedPnl: finiteDisplayNumber(pnl.data.unrealizedPnL, true),
      realizedPnl: finiteDisplayNumber(pnl.data.realizedPnL, true),
      openPositionCount: portfolio.data.positionCount,
      instrumentCount: portfolio.data.instrumentCount,
      mirrorCount: pnl.data.mirrorCount,
      pendingOrderCount: pnl.data.pendingOrderCount,
      providerUpdatedAt: portfolio.data.providerUpdatedAt ?? pnl.data.providerUpdatedAt,
      omittedRowCount: portfolio.data.omittedPositionCount,
      incompleteRowCount: portfolio.data.incompleteValuePositionCount,
      instruments: normalizedInstruments,
    },
    provider: { endpoint: "portfolioSnapshot", method: "GET", status: 200, receivedAt: new Date().toISOString(), durationMs: 0 },
  };
}

export function readOnlyEndpointSummary() {
  return Object.fromEntries(
    Object.entries(READ_ONLY_ENDPOINTS).map(([name, endpoint]) => [
      name,
      { method: endpoint.method, path: endpoint.path },
    ]),
  );
}
