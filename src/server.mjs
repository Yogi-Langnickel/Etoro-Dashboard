import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchReadOnlyEndpoint, readOnlyEndpointSummary } from "./etoro-client.mjs";
import { loadEtoroConfig, publicCredentialStatus } from "./etoro-config.mjs";

const STATIC_ROOT = fileURLToPath(new URL("./", import.meta.url));
const DEFAULT_PORT = 4173;
const DEFAULT_READ_CACHE_TTL_MS = 15_000;

export const INTERNAL_API_ROUTES = Object.freeze([
  "/api/health",
  "/api/etoro/status",
  "/api/etoro/identity",
  "/api/etoro/demo/pnl",
  "/api/etoro/demo/trading/status",
  "/api/etoro/demo/trading/preview",
  "/api/etoro/bot/status",
  "/api/etoro/risk/status",
  "/api/etoro/research/status",
]);

const DEMO_TRADE_PREVIEW_ROUTE = "/api/etoro/demo/trading/preview";

const PLANNED_DEMO_TRADING_ENDPOINTS = Object.freeze({
  marketOpenByAmount: Object.freeze({
    method: "POST",
    path: "/api/v1/trading/execution/demo/market-open-orders/by-amount",
  }),
  marketOpenByUnits: Object.freeze({
    method: "POST",
    path: "/api/v1/trading/execution/demo/market-open-orders/by-units",
  }),
  marketClosePosition: Object.freeze({
    method: "POST",
    path: "/api/v1/trading/execution/demo/market-close-orders/positions/{positionId}",
  }),
  orderInfo: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/demo/orders/{orderId}",
  }),
});

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function safeErrorPayload(error) {
  return {
    code: error?.code ?? "UNEXPECTED_ERROR",
    message: error?.message ?? "Unexpected server error",
    status: error?.status ?? undefined,
    requestId: error?.requestId ?? undefined,
  };
}

function assertSafeStaticPath(pathname) {
  let decoded = "/";

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const assetName = STATIC_FILES.get(decoded);

  if (!assetName) {
    return null;
  }

  const resolved = resolve(STATIC_ROOT, assetName);
  const normalizedRoot = normalize(STATIC_ROOT.endsWith(sep) ? STATIC_ROOT : `${STATIC_ROOT}${sep}`);

  if (!resolved.startsWith(normalizedRoot)) {
    return null;
  }

  return resolved;
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Only GET routes are available" },
    });
    return;
  }

  const filePath = assertSafeStaticPath(pathname);

  if (!filePath) {
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Static asset not found" },
    });
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Static asset not found" },
    });
  }
}

async function getConfig(loadConfig) {
  return loadConfig();
}

function credentialsMissingResponse(config) {
  return {
    ok: false,
    mode: "read-only",
    credentialStatus: publicCredentialStatus(config),
    error: {
      code: "ETORO_CREDENTIALS_MISSING",
      message: "eToro credentials are not configured on the server",
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readOnlyCacheKey(endpointName, config) {
  const credentialFingerprint = createHash("sha256")
    .update(config.apiKey ?? "")
    .update("\0")
    .update(config.userKey ?? "")
    .digest("hex");

  return [
    endpointName,
    config.baseUrl,
    config.credentialSource,
    config.credentialFileLoaded ? "file" : "no-file",
    credentialFingerprint,
  ].join("|");
}

function withCacheMetadata(result, cacheState, entry) {
  return {
    ...cloneJson(result),
    cache: {
      state: cacheState,
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt,
      ttlMs: entry.ttlMs,
    },
  };
}

export function createReadOnlyProviderCache({ ttlMs = DEFAULT_READ_CACHE_TTL_MS } = {}) {
  const entries = new Map();

  return {
    async fetch(endpointName, config, fetchEndpoint) {
      const key = readOnlyCacheKey(endpointName, config);
      const now = Date.now();
      const existing = entries.get(key);

      if (existing?.value && existing.expiresAtMs > now) {
        return withCacheMetadata(existing.value, "hit", existing);
      }

      if (existing?.inflight) {
        const value = await existing.inflight;
        const updated = entries.get(key);
        return withCacheMetadata(value, "coalesced", updated);
      }

      const entry = {
        cachedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlMs).toISOString(),
        expiresAtMs: now + ttlMs,
        ttlMs,
      };

      entry.inflight = fetchEndpoint(endpointName, { credentials: config })
        .then((value) => {
          entry.value = cloneJson(value);
          entry.cachedAt = new Date().toISOString();
          entry.expiresAtMs = Date.now() + ttlMs;
          entry.expiresAt = new Date(entry.expiresAtMs).toISOString();
          delete entry.inflight;
          entries.set(key, entry);
          return entry.value;
        })
        .catch((error) => {
          entries.delete(key);
          throw error;
        });

      entries.set(key, entry);
      const value = await entry.inflight;
      return withCacheMetadata(value, "miss", entry);
    },
  };
}

function botMonitoringStatus(config) {
  return {
    ok: true,
    mode: "bot-monitoring-planning",
    readOnly: true,
    demoOnly: true,
    botEnabled: false,
    simulatedTelemetryOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    telemetry: {
      source: "synthetic-disabled",
      freshness: "not-connected",
      lastDecisionAt: null,
      lastProviderReadAt: null,
      openActionCount: 0,
      pendingExecutionCount: 0,
    },
    safeguards: {
      killSwitch: "locked-disabled",
      executionRoutes: "absent",
      accountMutation: "blocked",
      rawProviderPayloads: "hidden",
      accountIdentifiers: "redacted",
    },
  };
}

function riskRadarStatus(config) {
  return {
    ok: true,
    mode: "risk-radar-planning",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    livePortfolioConnected: false,
    credentialStatus: publicCredentialStatus(config),
    portfolioRisk: {
      source: "synthetic-placeholder",
      freshness: "not-connected",
      grossExposurePct: null,
      cashBufferPct: null,
      largestPositionPct: null,
      leveragedPositionCount: 0,
      stalePositionCount: 0,
    },
    thresholds: {
      grossExposurePct: 125,
      largestPositionPct: 25,
      cashBufferPct: 10,
      staleDataMinutes: 15,
    },
    checks: [
      {
        id: "exposure",
        label: "Gross exposure",
        state: "unknown",
        detail: "Connect a read-only demo portfolio before evaluating exposure.",
      },
      {
        id: "concentration",
        label: "Concentration",
        state: "unknown",
        detail: "Largest position is unavailable without portfolio reads.",
      },
      {
        id: "stale-data",
        label: "Data freshness",
        state: "warn",
        detail: "No provider timestamp is connected to this radar yet.",
      },
      {
        id: "execution",
        label: "Execution lock",
        state: "ok",
        detail: "Risk radar has no trade, close, copy, or watchlist mutation routes.",
      },
    ],
    safeguards: {
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      executionRoutes: "absent",
      alerting: "local-only",
    },
  };
}

function researchDeskStatus(config) {
  return {
    ok: true,
    mode: "research-desk-planning",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    dataSources: {
      watchlists: "synthetic-placeholder",
      instruments: "synthetic-placeholder",
      socialFeed: "disabled",
      recommendations: "disabled",
    },
    watchlistPreview: [
      { symbol: "SPY", assetClass: "ETF", state: "fixture", note: "Synthetic ETF row placeholder" },
      { symbol: "AAPL", assetClass: "Equity", state: "fixture", note: "Synthetic equity row placeholder" },
      { symbol: "GLD", assetClass: "ETF", state: "fixture", note: "Synthetic ETF row placeholder" },
    ],
    instrumentLookup: {
      enabled: false,
      requiredFields: ["instrumentId", "internalSymbolFull", "displayname", "marketId"],
      exactSymbolLookup: "planned-server-only",
    },
    safeguards: {
      watchlistMutation: "blocked",
      feedPosting: "blocked",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}

function parsePositiveNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }

  return parsed;
}

async function readJsonBody(request) {
  if (typeof request.body === "string") {
    return request.body ? JSON.parse(request.body) : {};
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function buildTradePreview(payload) {
  const orderType = String(payload?.orderType ?? "");
  const side = String(payload?.side ?? "").toUpperCase();
  const instrumentId = String(payload?.instrumentId ?? "").trim();
  const positionId = String(payload?.positionId ?? "").trim();
  const amount = parsePositiveNumber(payload?.amount, "Amount");
  const units = parsePositiveNumber(payload?.units, "Units");
  const leverage = parsePositiveNumber(payload?.leverage, "Leverage") ?? 1;
  const stopLoss = parsePositiveNumber(payload?.stopLoss, "Stop loss");
  const takeProfit = parsePositiveNumber(payload?.takeProfit, "Take profit");

  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("Side must be BUY or SELL");
  }

  if (orderType === "marketOpenByAmount") {
    if (!instrumentId || amount === null) {
      throw new Error("Market open by amount requires an instrument ID and amount");
    }

    return {
      providerEndpoint: PLANNED_DEMO_TRADING_ENDPOINTS.marketOpenByAmount,
      ticket: {
        orderType,
        side,
        sizingMode: "amount",
        hasInstrumentId: true,
        amount,
        leverage,
        stopLossSet: stopLoss !== null,
        takeProfitSet: takeProfit !== null,
      },
    };
  }

  if (orderType === "marketOpenByUnits") {
    if (!instrumentId || units === null) {
      throw new Error("Market open by units requires an instrument ID and units");
    }

    return {
      providerEndpoint: PLANNED_DEMO_TRADING_ENDPOINTS.marketOpenByUnits,
      ticket: {
        orderType,
        side,
        sizingMode: "units",
        hasInstrumentId: true,
        units,
        leverage,
        stopLossSet: stopLoss !== null,
        takeProfitSet: takeProfit !== null,
      },
    };
  }

  if (orderType === "marketClosePosition") {
    if (!positionId) {
      throw new Error("Market close position requires a position ID");
    }

    return {
      providerEndpoint: PLANNED_DEMO_TRADING_ENDPOINTS.marketClosePosition,
      ticket: {
        orderType,
        side,
        sizingMode: "position",
        hasPositionId: true,
      },
    };
  }

  throw new Error("Unsupported demo order type");
}

async function handleTradePreview(request, response, config) {
  if (!config.demoTradePreviewEnabled) {
    sendJson(response, 403, {
      ok: false,
      mode: "demo-trade-preview",
      mutationRoutesEnabled: false,
      executionBlocked: true,
      error: {
        code: "DEMO_TRADE_PREVIEW_DISABLED",
        message: "Demo trade preview is disabled by server configuration",
      },
    });
    return;
  }

  try {
    const preview = buildTradePreview(await readJsonBody(request));

    sendJson(response, 200, {
      ok: true,
      mode: "demo-trade-preview",
      demoOnly: true,
      mutationRoutesEnabled: false,
      executionBlocked: true,
      ...preview,
      requiredNextStep: "Enable the audited execution route in a separate implementation step.",
    });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      mode: "demo-trade-preview",
      mutationRoutesEnabled: false,
      executionBlocked: true,
      error: {
        code: "INVALID_DEMO_TRADE_PREVIEW",
        message: error?.message ?? "Demo trade preview is invalid",
      },
    });
  }
}

async function handleApiRoute(pathname, response, options) {
  const loadConfig = options.loadConfig ?? loadEtoroConfig;
  const fetchEndpoint = options.fetchEndpoint ?? fetchReadOnlyEndpoint;
  const providerCache = options.providerCache ?? createReadOnlyProviderCache();

  if (!INTERNAL_API_ROUTES.includes(pathname)) {
    sendJson(response, 404, {
      ok: false,
      mode: "read-only",
      error: { code: "ROUTE_NOT_ALLOWED", message: "Route is not in the read-only allow-list" },
    });
    return;
  }

  if (pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      mode: "read-only",
      mutationRoutesEnabled: false,
      routes: INTERNAL_API_ROUTES,
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const config = await getConfig(loadConfig);

    if (pathname === "/api/etoro/status") {
      sendJson(response, 200, {
        ok: true,
        mode: "read-only",
        credentialStatus: publicCredentialStatus(config),
        provider: {
          baseUrl: config.baseUrl,
          endpoints: readOnlyEndpointSummary(),
        },
      });
      return;
    }

    if (pathname === "/api/etoro/demo/trading/status") {
      sendJson(response, 200, {
        ok: true,
        mode: "demo-trading-planning",
        demoOnly: true,
        mutationRoutesEnabled: false,
        demoTradePreviewEnabled: Boolean(config.demoTradePreviewEnabled),
        credentialStatus: publicCredentialStatus(config),
        plannedProviderEndpoints: PLANNED_DEMO_TRADING_ENDPOINTS,
        requiredControls: [
          "demo-only route namespace",
          "explicit feature flag",
          "confirmation step",
          "request id audit",
          "order result polling",
          "raw payload redaction",
        ],
      });
      return;
    }

    if (pathname === "/api/etoro/bot/status") {
      sendJson(response, 200, botMonitoringStatus(config));
      return;
    }

    if (pathname === "/api/etoro/risk/status") {
      sendJson(response, 200, riskRadarStatus(config));
      return;
    }

    if (pathname === "/api/etoro/research/status") {
      sendJson(response, 200, researchDeskStatus(config));
      return;
    }

    if (pathname === DEMO_TRADE_PREVIEW_ROUTE) {
      await handleTradePreview(options.request, response, config);
      return;
    }

    if (!config.configured) {
      sendJson(response, 503, credentialsMissingResponse(config));
      return;
    }

    const endpointName = pathname === "/api/etoro/identity" ? "identity" : "demoPnl";
    const result = await providerCache.fetch(endpointName, config, fetchEndpoint);
    sendJson(response, 200, {
      ok: true,
      mode: "read-only",
      ...result,
    });
  } catch (error) {
    sendJson(response, error?.status && error.status >= 400 ? error.status : 500, {
      ok: false,
      mode: "read-only",
      error: safeErrorPayload(error),
    });
  }
}

export function createRequestHandler(options = {}) {
  const providerCache = options.providerCache ?? createReadOnlyProviderCache();

  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      if (pathname === DEMO_TRADE_PREVIEW_ROUTE) {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            ok: false,
            mode: "demo-trade-preview",
            error: { code: "METHOD_NOT_ALLOWED", message: "Demo trade preview requires POST" },
          });
          return;
        }

        await handleApiRoute(pathname, response, { ...options, providerCache, request });
        return;
      }

      if (request.method !== "GET") {
        sendJson(response, 405, {
          ok: false,
          mode: "read-only",
          error: { code: "METHOD_NOT_ALLOWED", message: "Only GET routes are available" },
        });
        return;
      }

      await handleApiRoute(pathname, response, { ...options, providerCache });
      return;
    }

    await serveStatic(request, response, pathname);
  };
}

export function createServer(options = {}) {
  return createHttpServer(createRequestHandler(options));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`eToro dashboard listening on http://${host}:${actualPort}`);
  });
}
