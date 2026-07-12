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
  demoPortfolio: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/demo/portfolio",
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

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);

    if (number !== null) {
      return number;
    }
  }

  return null;
}

function sumAmounts(items) {
  return items.reduce((total, item) => {
    const amount = firstNumber(item?.amount, item?.invested, item?.currentInvestment);
    return total + (amount ?? 0);
  }, 0);
}

function sumExternalCosts(items) {
  return items.reduce((total, item) => {
    const amount = firstNumber(item?.totalExternalCosts, item?.totalExternalCost);
    return total + (amount ?? 0);
  }, 0);
}

function pnlAmount(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return firstNumber(value.pnL, value.pnl, value.value, value.amount);
  }

  return firstNumber(value);
}

function sumPositionPnl(items) {
  return items.reduce((total, item) => {
    const amount = pnlAmount(item?.unrealizedPnL ?? item?.unrealizedPnl ?? item?.pnL);
    return total + (amount ?? 0);
  }, 0);
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

  if (
    !payload.clientPortfolio ||
    typeof payload.clientPortfolio !== "object" ||
    Array.isArray(payload.clientPortfolio)
  ) {
    throw new EtoroApiError("Demo PnL response did not include clientPortfolio", {
      code: "ETORO_INVALID_DEMO_PNL_RESPONSE",
    });
  }

  const portfolio = payload.clientPortfolio;
  const positions = arrayOrEmpty(
    portfolio.positions ??
      portfolio.openPositions ??
      portfolio.instrumentPositions ??
      portfolio.trades,
  );
  const mirrors = arrayOrEmpty(portfolio.mirrors);
  const mirrorPositions = mirrors.flatMap((mirror) => arrayOrEmpty(mirror?.positions));
  const orders = arrayOrEmpty(portfolio.orders);
  const ordersForOpen = arrayOrEmpty(portfolio.ordersForOpen);
  const ordersForClose = arrayOrEmpty(portfolio.ordersForClose);
  const ordersForCloseMultiple = arrayOrEmpty(portfolio.ordersForCloseMultiple);
  const mirrorOrdersForOpen = mirrors.flatMap((mirror) => arrayOrEmpty(mirror?.ordersForOpen));
  const mirrorOrdersForClose = mirrors.flatMap((mirror) => arrayOrEmpty(mirror?.ordersForClose));
  const mirrorOrdersForCloseMultiple = mirrors.flatMap((mirror) =>
    arrayOrEmpty(mirror?.ordersForCloseMultiple),
  );
  const allOrdersForOpen = [...ordersForOpen, ...mirrorOrdersForOpen];
  const allOrdersForClose = [
    ...ordersForClose,
    ...ordersForCloseMultiple,
    ...mirrorOrdersForClose,
    ...mirrorOrdersForCloseMultiple,
  ];
  const manualOrdersForOpen = ordersForOpen.filter((order) => {
    const mirrorId = firstNumber(order?.mirrorID, order?.mirrorId, order?.mirrorid);
    return mirrorId === 0;
  });
  const credit = firstNumber(
    portfolio.credit,
    portfolio.cash,
    portfolio.balance,
    portfolio.availableBalance,
  );
  const pendingManualAmount = sumAmounts(manualOrdersForOpen);
  const pendingOrderAmount = sumAmounts(orders);
  const availableCash =
    credit === null ? null : Number((credit - pendingManualAmount - pendingOrderAmount).toFixed(2));
  const mirrorAvailableNet = mirrors.reduce((total, mirror) => {
    const availableAmount = firstNumber(mirror?.availableAmount) ?? 0;
    const closedProfit = firstNumber(mirror?.closedPositionsNetProfit) ?? 0;
    return total + availableAmount - closedProfit;
  }, 0);
  const totalInvested = roundCurrency(
    sumAmounts(positions) +
      sumAmounts(mirrorPositions) +
      mirrorAvailableNet +
      pendingManualAmount +
      pendingOrderAmount +
      sumExternalCosts(manualOrdersForOpen),
  );
  const calculatedUnrealizedPnL = roundCurrency(
    sumPositionPnl(positions) +
      sumPositionPnl(mirrorPositions) +
      mirrors.reduce((total, mirror) => total + (firstNumber(mirror?.closedPositionsNetProfit) ?? 0), 0),
  );
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
    positionCount: positions.length + mirrorPositions.length,
    mirrorCount: mirrors.length,
    pendingOrderCount: orders.length + allOrdersForOpen.length + allOrdersForClose.length,
    manualPendingOrderCount: manualOrdersForOpen.length,
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
    current.investedUsd = Number.isFinite(nextInvestedUsd) ? nextInvestedUsd : 0;
    current.unrealizedPnlUsd = Number.isFinite(nextUnrealizedPnlUsd)
      ? nextUnrealizedPnlUsd
      : 0;
    instruments.set(symbol, current);
  }

  return {
    currency: "USD",
    positionCount: positions.length,
    instrumentCount: instruments.size,
    omittedPositionCount,
    incompleteValuePositionCount,
    instruments: [...instruments.values()]
      .map(({ valuesComplete, ...instrument }) => ({
        ...instrument,
        investedUsd: valuesComplete ? roundCurrency(instrument.investedUsd) : null,
        unrealizedPnlUsd: valuesComplete ? roundCurrency(instrument.unrealizedPnlUsd) : null,
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

export function readOnlyEndpointSummary() {
  return Object.fromEntries(
    Object.entries(READ_ONLY_ENDPOINTS).map(([name, endpoint]) => [
      name,
      { method: endpoint.method, path: endpoint.path },
    ]),
  );
}
