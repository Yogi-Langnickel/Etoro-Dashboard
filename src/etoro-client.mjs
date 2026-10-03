import { randomUUID } from "node:crypto";
import { normalizeAggregatePortfolio, normalizeInstrumentBreakdown, composePortfolioSnapshot } from "./portfolio-contract.mjs";
import { DEFAULT_PROVIDER_FAILURE_BACKOFF_MS } from "./provider-read-cache.mjs";

const SENSITIVE_HEADER_NAMES = new Set(["x-api-key", "x-user-key", "authorization"]);
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_MS = 60_000;
// Memory-only quota deadlines use non-secret configuration generations, never
// credential object identity (the config boundary returns fresh objects).
const portfolioMetadataDeadlines = new Map();
const MAX_METADATA_DEADLINES = 32;
function metadataDeadlineKey(environment, credentials) {
  const generation = credentials?.credentialGeneration;
  return typeof generation === "string" && generation.length > 0 && generation.length <= 256 && generation !== "credential-generation-unavailable"
    ? JSON.stringify([environment, generation, credentials.credentialSource ?? null, credentials.baseUrl ?? null, Boolean(credentials.credentialFileLoaded)]) : null;
}
function deferPortfolioMetadata(key, nowMs, retryAfterMs) {
  if (!key) return;
  const delay = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(Math.ceil(retryAfterMs), MAX_RETRY_AFTER_MS) : DEFAULT_PROVIDER_FAILURE_BACKOFF_MS;
  for (const [storedKey, deadline] of portfolioMetadataDeadlines) if (deadline <= nowMs) portfolioMetadataDeadlines.delete(storedKey);
  portfolioMetadataDeadlines.delete(key);
  portfolioMetadataDeadlines.set(key, nowMs + delay);
  while (portfolioMetadataDeadlines.size > MAX_METADATA_DEADLINES) portfolioMetadataDeadlines.delete(portfolioMetadataDeadlines.keys().next().value);
}
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

function normalizePrivateIdentity(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.scopes) || payload.scopes.some((scope) => typeof scope !== "string")) {
    throw new EtoroApiError("Identity scope response did not match the documented contract", { code: "ETORO_INVALID_IDENTITY_RESPONSE" });
  }
  return { realCid: positiveInstrumentId(payload.realCid), demoCid: positiveInstrumentId(payload.demoCid), scopes: payload.scopes };
}

function breakdownPath(environment, params) {
  if (!Number.isInteger(params.cid) || params.cid <= 0) throw new EtoroApiError("Private account reference is unavailable", { code: "ETORO_INVALID_IDENTITY_RESPONSE" });
  return `/api/v2/trading/info/${environment === "demo" ? "demo/" : ""}instrument-breakdown?conversionMode=eToroApp&positionLevel=Normal&orderLevel=Normal&mirrorLevel=Details`;
}
function normalizePortfolioMetadata(payload, params) {
  if (!payload || !Array.isArray(payload.instrumentDisplayDatas)) throw new EtoroApiError("Instrument metadata response is invalid", { code: "ETORO_INVALID_INSTRUMENT_DISPLAY_RESPONSE" });
  const requested = new Set(validatedInstrumentIds(params.instrumentIds));
  return { instruments: payload.instrumentDisplayDatas.flatMap((item) => {
    const instrumentId = positiveInstrumentId(item?.instrumentID);
    const symbol = typeof item?.symbolFull === "string" && SAFE_INSTRUMENT_SYMBOL.test(item.symbolFull) ? item.symbolFull : null;
    return requested.has(instrumentId) && symbol ? [{ instrumentId, symbol, displayName: safeDisplayText(item.instrumentDisplayName, symbol) }] : [];
  }) };
}

export const READ_ONLY_ENDPOINTS = Object.freeze({
  privateIdentity: Object.freeze({ method: "GET", path: "/api/v1/me", normalize: normalizePrivateIdentity }),
  realAggregatePortfolio: Object.freeze({ method: "GET", path: "/api/v1/trading/info/aggregate-portfolio?conversionMode=eToroApp&pnlLevel=Pnl", normalize: normalizeAggregatePortfolio }),
  demoAggregatePortfolio: Object.freeze({ method: "GET", path: "/api/v1/trading/info/demo/aggregate-portfolio?conversionMode=eToroApp&pnlLevel=Pnl", normalize: normalizeAggregatePortfolio }),
  realInstrumentBreakdown: Object.freeze({ method: "GET", path: (params) => breakdownPath("real", params), privateCid: true, normalize: normalizeInstrumentBreakdown }),
  demoInstrumentBreakdown: Object.freeze({ method: "GET", path: (params) => breakdownPath("demo", params), privateCid: true, normalize: normalizeInstrumentBreakdown }),
  portfolioMetadata: Object.freeze({ method: "GET", path: ({ instrumentIds }) => `/api/v1/market-data/instruments?instrumentIds=${validatedInstrumentIds(instrumentIds).join(",")}`, normalize: normalizePortfolioMetadata }),
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
  instrumentDisplay: Object.freeze({
    method: "GET",
    path: ({ instrumentIds }) =>
      `/api/v1/market-data/instruments?instrumentIds=${validatedInstrumentIds(instrumentIds).join(",")}`,
    normalize: normalizeInstrumentDisplay,
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function hasMalformedNumber(values) {
  return values.some((value) => value !== null && value !== undefined && numberOrNull(value) === null);
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
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMarketTimestamp(value) {
  // Market timestamps must identify an instant. Date's permissive parser also
  // accepts date-only, locale and timezone-free values, which can shift charts
  // with the server timezone. ISO formatting does not establish a session.
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const leapYear = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
  if (!daysInMonth || Number(day) < 1 || Number(day) > daysInMonth ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
    Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59) return null;
  return normalizeTimestamp(value);
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
    const unitValues = [position?.units, position?.amountInUnits, position?.unitsAmount];
    const openPriceValues = [position?.openRate, position?.averageOpenPrice, position?.openPrice];
    const currentPriceValues = [position?.currentRate, position?.currentPrice, position?.rate];
    const units = firstNumber(...unitValues);
    const averageOpenPrice = firstNumber(...openPriceValues);
    const currentPrice = firstNumber(...currentPriceValues);
    const marketInputMalformed = [unitValues, openPriceValues, currentPriceValues].some(hasMalformedNumber);
    const displayName = safeDisplayText(position?.displayName ?? position?.instrumentDisplayName ?? position?.name, symbol);
    const unrealizedPnlUsd = pnlAmount(
      position?.unrealizedPnL ?? position?.unrealizedPnl ?? position?.pnL,
    );
    const hasCompleteValues = investedUsd !== null && investedUsd >= 0 && unrealizedPnlUsd !== null;

    const current = instruments.get(symbol) ?? {
      symbol,
      positionCount: 0,
      incompletePositionCount: 0,
      investedUsd: 0,
      unrealizedPnlUsd: 0,
      units: 0,
      averageOpenPrice: null,
      currentPrice: null,
      weightedOpenTotal: 0,
      weightedOpenUnits: 0,
      displayName,
      marketValuesComplete: true,
      marketValuesIncomplete: false,
      marketAggregateOverflow: false,
      valuesComplete: true,
    };
    current.positionCount += 1;
    const nextInvestedUsd = current.investedUsd + (
      investedUsd !== null && investedUsd >= 0 ? investedUsd : 0
    );
    const nextUnrealizedPnlUsd = current.unrealizedPnlUsd + (unrealizedPnlUsd ?? 0);
    const totalsComplete = Number.isFinite(nextInvestedUsd) && Number.isFinite(nextUnrealizedPnlUsd);
    const positionValuesComplete = hasCompleteValues && totalsComplete;
    if (!positionValuesComplete) {
      current.incompletePositionCount = totalsComplete
        ? current.incompletePositionCount + 1
        : current.positionCount;
    }
    current.valuesComplete &&= positionValuesComplete;
    const usableMarketValues = units !== null && units > 0 && averageOpenPrice !== null && averageOpenPrice >= 0 && currentPrice !== null && currentPrice >= 0;
    if (marketInputMalformed && positionValuesComplete) {
      current.marketValuesIncomplete = true;
      current.incompletePositionCount += 1;
    }
    current.marketValuesComplete &&= usableMarketValues;
    current.investedUsd = Number.isFinite(nextInvestedUsd) ? nextInvestedUsd : 0;
    current.unrealizedPnlUsd = Number.isFinite(nextUnrealizedPnlUsd) ? nextUnrealizedPnlUsd : 0;
    if (usableMarketValues && current.marketValuesComplete) {
      const nextUnits = current.units + units;
      const nextWeightedOpenTotal = current.weightedOpenTotal + (units * averageOpenPrice);
      const nextWeightedOpenUnits = current.weightedOpenUnits + units;
      const aggregatesFinite = Number.isFinite(nextUnits) && Number.isFinite(nextWeightedOpenTotal) &&
        Number.isFinite(nextWeightedOpenUnits) && nextWeightedOpenUnits > 0;
      current.marketValuesComplete &&= aggregatesFinite;
      current.marketAggregateOverflow ||= !aggregatesFinite;
      if (!aggregatesFinite) current.incompletePositionCount = current.positionCount;
      if (aggregatesFinite) {
        current.units = nextUnits;
        current.weightedOpenTotal = nextWeightedOpenTotal;
        current.weightedOpenUnits = nextWeightedOpenUnits;
      }
      if (current.currentPrice === null) current.currentPrice = currentPrice;
      else if (current.currentPrice !== currentPrice) {
        current.marketValuesComplete = false;
        current.marketValuesIncomplete = true;
        current.incompletePositionCount = current.positionCount;
      }
    }
    instruments.set(symbol, current);
  }

  return {
    currency: "USD",
    positionCount: positions.length,
    instrumentCount: instruments.size,
    omittedPositionCount,
    incompleteValuePositionCount: [...instruments.values()].reduce(
      (count, instrument) => count + instrument.incompletePositionCount,
      0,
    ),
    instruments: [...instruments.values()]
      .map(({ valuesComplete, marketValuesComplete, marketValuesIncomplete, marketAggregateOverflow, weightedOpenTotal, weightedOpenUnits, incompletePositionCount, ...instrument }) => ({
        ...instrument,
        investedUsd: valuesComplete ? roundCurrency(instrument.investedUsd) : null,
        unrealizedPnlUsd: valuesComplete ? roundCurrency(instrument.unrealizedPnlUsd) : null,
        units: marketValuesComplete && weightedOpenUnits > 0 ? instrument.units : null,
        // Prices and quantities are not monetary totals. Keep their provider
        // precision through the browser DTO so fractional holdings and small
        // instrument prices remain meaningful.
        averageOpenPrice: marketValuesComplete && weightedOpenUnits > 0 ? weightedOpenTotal / weightedOpenUnits : null,
        currentPrice: marketValuesComplete ? instrument.currentPrice : null,
        valueStatus: valuesComplete && !marketValuesIncomplete && !marketAggregateOverflow ? "complete" : "incomplete",
      }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol)),
    providerUpdatedAt: normalizeTimestamp(
      portfolio.updatedAt ?? portfolio.lastUpdatedAt ?? portfolio.serverTime,
    ),
  };
}

function positiveInstrumentId(value) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
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
  return numberOrNull(value);
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

function normalizeInstrumentDisplay(payload, params) {
  if (!payload || !Array.isArray(payload.instrumentDisplayDatas)) {
    throw new EtoroApiError("Instrument display response did not match expected shape", {
      code: "ETORO_INVALID_INSTRUMENT_DISPLAY_RESPONSE",
    });
  }
  const requested = new Set(validatedInstrumentIds(params.instrumentIds));
  const byId = new Map();
  const ambiguous = new Set();
  const symbols = new Map();
  const ambiguousSymbols = new Set();
  for (const item of payload.instrumentDisplayDatas) {
    const instrumentId = positiveInstrumentId(item?.instrumentID ?? item?.instrumentId);
    if (!requested.has(instrumentId)) continue;
    if (byId.has(instrumentId)) ambiguous.add(instrumentId);
    const symbol = normalizedSymbol(item?.symbolFull);
    if (symbol && symbols.has(symbol) && symbols.get(symbol) !== instrumentId) ambiguousSymbols.add(symbol);
    if (symbol) symbols.set(symbol, instrumentId);
    byId.set(instrumentId, symbol ? {
      instrumentId, symbol, displayName: safeDisplayText(item?.instrumentDisplayName, symbol),
    } : null);
  }
  return { instruments: [...byId.entries()].flatMap(([id, item]) =>
    item && !ambiguous.has(id) && !ambiguousSymbols.has(item.symbol) ? [item] : []) };
}

/** Resolve documented ID-only rows before the public normalizer discards IDs.
 * Bounded batches cover at most 500 distinct instruments. Unresolved/overflow
 * rows retain missing symbols and are counted by the normalizer as omitted.
 */
async function enrichMissingDisplaySymbols(endpointName, payload, options) {
  const watchlist = endpointName === "defaultWatchlist";
  if (!watchlist && !["realPortfolio", "demoPortfolio"].includes(endpointName)) return payload;
  const portfolio = payload?.clientPortfolio;
  const positionKey = portfolio?.positions != null ? "positions" :
    portfolio?.openPositions != null ? "openPositions" : "instrumentPositions";
  const rows = watchlist ? payload : portfolio?.[positionKey];
  if (!Array.isArray(rows)) return payload;
  const considered = watchlist ? rows.slice(0, 100) : rows;
  const idFor = (row) => positiveInstrumentId(watchlist ? row?.itemId ?? row?.ItemId :
    row?.instrumentID ?? row?.instrumentId ?? row?.InstrumentID);
  const needsSymbol = (row) => watchlist
    ? (row?.itemType ?? row?.ItemType) === "Instrument" &&
      !normalizedSymbol(row?.market?.symbolName ?? row?.market?.internalSymbolFull)
    : !normalizedSymbol(row?.instrumentSymbol ?? row?.symbol ?? row?.internalSymbolFull);
  const instrumentIds = [...new Set(considered.filter(needsSymbol).map(idFor).filter((id) => id !== null))].slice(0, watchlist ? 100 : 500);
  if (instrumentIds.length === 0) return payload;
  const candidates = [];
  for (let offset = 0; offset < instrumentIds.length; offset += 100) {
    try {
      const display = await fetchReadOnlyEndpoint("portfolioMetadata", { ...options, requestId: undefined, params: { instrumentIds: instrumentIds.slice(offset, offset + 100) } });
      candidates.push(...display.data.instruments);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) throw error;
    }
  }
  const byId = new Map(); const duplicates = new Set(); const symbolIds = new Map(); const ambiguousSymbols = new Set();
  const known = rows.filter((row) => !needsSymbol(row)).map((row) => ({ instrumentId: idFor(row), symbol: watchlist ? normalizedSymbol(row?.market?.symbolName ?? row?.market?.internalSymbolFull) : normalizedSymbol(row?.instrumentSymbol ?? row?.symbol ?? row?.internalSymbolFull) })).filter((item) => item.instrumentId !== null);
  for (const item of [...known, ...candidates]) {
    if (symbolIds.has(item.symbol) && symbolIds.get(item.symbol) !== item.instrumentId) ambiguousSymbols.add(item.symbol);
    symbolIds.set(item.symbol, item.instrumentId);
  }
  for (const item of candidates) {
    if (byId.has(item.instrumentId)) duplicates.add(item.instrumentId);
    byId.set(item.instrumentId, item);
  }
  for (const [id, item] of byId) if (duplicates.has(id) || ambiguousSymbols.has(item.symbol)) byId.delete(id);
  const enriched = rows.map((row) => {
    const item = needsSymbol(row) ? byId.get(idFor(row)) : null;
    if (!item) return row;
    return watchlist
      ? { ...row, market: { symbolName: item.symbol, displayName: item.displayName } }
      : { ...row, instrumentSymbol: item.symbol, displayName: item.displayName };
  });
  return watchlist ? enriched : { ...payload, clientPortfolio: { ...portfolio, [positionKey]: enriched } };
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
    // The search filter can return related symbols. Provider identity must be
    // exactly the requested canonical symbol, without case/whitespace repair.
    const symbol = item?.internalSymbolFull;
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
      const updatedAt = normalizeMarketTimestamp(rate?.date);
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
    const at = normalizeMarketTimestamp(candle?.fromDate);
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
  if (endpoint.privateCid) headers.CID = String(params.cid);
  const url = new URL(path, `${credentials.baseUrl}/`);
  const secrets = [credentials.apiKey, credentials.userKey, ...(endpoint.privateCid ? [String(params.cid)] : [])];
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
    const displayReadyPayload = await enrichMissingDisplaySymbols(endpointName, payload, options);

    return {
      data: endpoint.normalize(displayReadyPayload, params),
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

    throw new EtoroApiError("eToro response or transport validation failed", {
      code: typeof error?.code === "string" && /^ETORO_INVALID_[A-Z_]+_RESPONSE$/.test(error.code) ? error.code : "ETORO_FETCH_FAILED",
      requestId,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function finiteMonetaryTotal(value, allowNegative = false) {
  const number = numberOrNull(value);
  return number !== null && (allowNegative || number >= 0) && Math.abs(number) <= 1_000_000_000_000 ? roundCurrency(number) : null;
}

function finitePrecisionNumber(value, allowNegative = false) {
  const number = numberOrNull(value);
  return number !== null && (allowNegative || number >= 0) && Math.abs(number) <= 1_000_000_000_000 ? number : null;
}

/** Compose the only account-linked DTO permitted to cross the browser boundary. */
export async function fetchPortfolioSnapshot(environment, options = {}) {
  if (!["real", "demo"].includes(environment)) throw new EtoroApiError("Requested eToro environment is invalid", { code: "ETORO_INVALID_ENVIRONMENT", status: 400 });
  const read = (endpointName, params = {}) => options.fetchEndpoint
    ? options.fetchEndpoint(endpointName, { credentials: options.credentials, params })
    : fetchReadOnlyEndpoint(endpointName, { ...options, params });
  const identity = await read("privateIdentity");
  const scope = `etoro-public:trade.${environment}:read`;
  if (!identity.data.scopes.includes(scope) && !(environment === "real" && identity.data.scopes.includes("etoro-public:trade.real:write"))) {
    throw new EtoroApiError("Matching portfolio read scope is not granted", { code: "ETORO_SCOPE_MISSING", status: 403 });
  }
  const aggregate = await read(`${environment}AggregatePortfolio`);
  if (aggregate.data.cid !== identity.data[`${environment}Cid`]) throw new EtoroApiError("Portfolio account context did not match selected profile", { code: "ETORO_ACCOUNT_CONTEXT_MISMATCH" });
  if (!positiveInstrumentId(identity.data[`${environment}Cid`])) throw new EtoroApiError("Selected account reference is unavailable", { code: "ETORO_INVALID_IDENTITY_RESPONSE" });
  let breakdown = null;
  let breakdownReason = "Matching instrument-breakdown read scope is not granted.";
  if (identity.data.scopes.includes(scope)) {
    try { breakdown = (await read(`${environment}InstrumentBreakdown`, { cid: aggregate.data.cid })).data; }
    catch (error) {
      breakdownReason = error?.status === 401 || error?.status === 403 ? "Instrument-breakdown authorization was rejected." : error?.status === 429 ? "Instrument-breakdown shared quota is temporarily rate-limited." : error?.code === "ETORO_TIMEOUT" ? "Instrument-breakdown request timed out." : /^ETORO_INVALID_/.test(error?.code ?? "") ? "Instrument-breakdown response failed documented contract validation." : "Instrument-breakdown provider is unavailable.";
    }
  }
  const ids = [...new Set(aggregate.data.rows.map(({ aggregate: item }) => positiveInstrumentId(item?.instrumentId)).filter((id) => id !== null))].slice(0, 500);
  const metadata = [];
  const metadataFailures = new Map();
  const now = typeof options.now === "function" ? options.now : Date.now;
  const deadlineKey = metadataDeadlineKey(environment, options.credentials);
  for (let offset = 0; offset < ids.length; offset += 100) {
    if (deadlineKey && (portfolioMetadataDeadlines.get(deadlineKey) ?? 0) > now()) {
      for (const id of ids.slice(offset)) metadataFailures.set(id, "Instrument metadata not attempted during shared-quota rate-limit backoff; identity is unresolved.");
      break;
    }
    const requestedIds = ids.slice(offset, offset + 100);
    try { metadata.push(...(await read("portfolioMetadata", { instrumentIds: requestedIds })).data.instruments); }
    catch (error) {
      const reason = error?.status === 401 || error?.status === 403 ? "Instrument metadata authorization was rejected; identity is unresolved." : error?.status === 429 ? "Instrument metadata shared quota is rate-limited; identity is unresolved." : /^ETORO_INVALID_/.test(error?.code ?? "") ? "Instrument metadata failed contract validation; identity is unresolved." : "Instrument metadata provider is unavailable; identity is unresolved.";
      for (const id of requestedIds) metadataFailures.set(id, reason);
      if (error?.status === 429) {
        deferPortfolioMetadata(deadlineKey, now(), error.retryAfterMs);
        for (const id of ids.slice(offset + 100)) metadataFailures.set(id, "Instrument metadata not attempted after shared-quota rate limit; identity is unresolved.");
        break;
      }
    }
  }
  return { data: composePortfolioSnapshot(environment, aggregate.data, breakdown, metadata, breakdownReason, metadataFailures), provider: { endpoint: "portfolioSnapshot", method: "GET", status: 200, receivedAt: new Date().toISOString(), durationMs: 0 } };
}

export function readOnlyEndpointSummary() {
  return Object.fromEntries(
    Object.entries(READ_ONLY_ENDPOINTS).map(([name, endpoint]) => [
      name,
      { method: endpoint.method, path: endpoint.path },
    ]),
  );
}
