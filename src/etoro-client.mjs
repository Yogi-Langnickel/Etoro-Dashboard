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
  const url = new URL(endpoint.path, `${credentials.baseUrl}/`);
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
      data: endpoint.normalize(payload),
      provider: {
        endpoint: endpointName,
        method: endpoint.method,
        path: endpoint.path,
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
