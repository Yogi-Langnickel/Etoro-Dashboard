import { createServer as createHttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BotConfigValidationError,
  loadBotConfig,
  publicBotConfigPayload,
  saveBotConfig,
} from "./bot-config-store.mjs";
import { fetchReadOnlyEndpoint } from "./etoro-client.mjs";
import { DEFAULT_READ_CACHE_TTL_MS, loadEtoroConfig, publicCredentialStatus } from "./etoro-config.mjs";
import {
  defaultWatchlistView,
  marketChartView,
  marketInputError,
  marketRatesView,
  MARKET_PERIODS,
  normalizeRequestedSymbol,
  requestedSymbols,
} from "./market-views.mjs";
import {
  createReadOnlyProviderCache,
  DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
  publicProviderErrorMessage,
} from "./provider-read-cache.mjs";
import {
  BOT_CONFIG_CSRF_HEADER,
  botAuditEvents,
  botEventFeed,
  botMonitoringStatus,
  botSimulationRuns,
  botSnapshot,
  botStrategyRegistry,
  botTradeLog,
  researchDeskStatus,
  riskRadarStatus,
} from "./planning-status.mjs";
import {
  buildTradePreview,
  tradingPermissionMatrix,
  tradingRateBudget,
} from "./trade-preview.mjs";

export { createReadOnlyProviderCache } from "./provider-read-cache.mjs";

const STATIC_ROOT = fileURLToPath(new URL("./", import.meta.url));
const DEFAULT_PORT = 4173;

export const INTERNAL_API_ROUTES = Object.freeze([
  "/api/health",
  "/api/etoro/status",
  "/api/etoro/identity",
  "/api/etoro/demo/pnl",
  "/api/etoro/demo/portfolio",
  "/api/etoro/watchlist/default",
  "/api/etoro/market/resolve",
  "/api/etoro/market/rates",
  "/api/etoro/market/chart",
  "/api/etoro/demo/trading/status",
  "/api/etoro/demo/trading/preview",
  "/api/etoro/bot/status",
  "/api/etoro/bot/strategies",
  "/api/etoro/bot/runs",
  "/api/etoro/bot/audit",
  "/api/etoro/bot/events",
  "/api/etoro/bot/trade-log",
  "/api/etoro/bot/config",
  "/api/etoro/bot/snapshot",
  "/api/etoro/risk/status",
  "/api/etoro/research/status",
]);

const DEMO_TRADE_PREVIEW_ROUTE = "/api/etoro/demo/trading/preview";
const BOT_CONFIG_ROUTE = "/api/etoro/bot/config";
const BOT_CONFIG_CSRF_RESPONSE_HEADER = "x-etoro-dashboard-config-token";
const botConfigCsrfToken = randomBytes(32).toString("base64url");
const MAX_API_BODY_BYTES = 16 * 1024;
export { DEFAULT_PROVIDER_FAILURE_BACKOFF_MS } from "./provider-read-cache.mjs";

export function resolveDashboardHost(value) {
  const host = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    const error = new Error("Dashboard host must remain loopback-only until authentication and secure sessions are implemented.");
    error.code = "ETORO_NON_LOOPBACK_HOST_BLOCKED";
    throw error;
  }
  return host === "[::1]" ? "::1" : host;
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const JSON_SECURITY_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
});

const STATIC_SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
});

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/browser-fixtures.js", "browser-fixtures.js"],
  ["/browser-contracts.js", "browser-contracts.js"],
  ["/app.js", "app.js"],
]);


function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    ...JSON_SECURITY_HEADERS,
    ...headers,
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getRequestHeader(request, name) {
  const headers = request?.headers ?? {};
  const expected = name.toLowerCase();

  if (typeof headers.get === "function") {
    return headers.get(name);
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expected) {
      continue;
    }

    return Array.isArray(value) ? value[0] : value;
  }

  return undefined;
}

function normalizeHostname(hostname) {
  const value = String(hostname ?? "").trim().toLowerCase();

  if (value.startsWith("[") && value.includes("]")) {
    return value.slice(1, value.indexOf("]"));
  }

  return value.split(":")[0];
}

function isLocalHostname(hostname) {
  return ["127.0.0.1", "localhost", "::1"].includes(normalizeHostname(hostname));
}

function parseOriginHeader(origin) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function validateBotConfigMutationRequest(request) {
  const baseValidation = validateLocalJsonMutationRequest(request, "Bot config updates");

  if (!baseValidation.ok) {
    return baseValidation;
  }

  const csrfToken = getRequestHeader(request, BOT_CONFIG_CSRF_HEADER);

  if (csrfToken !== botConfigCsrfToken) {
    return {
      ok: false,
      status: 403,
      message: "Bot config update token is missing or invalid.",
    };
  }

  return { ok: true };
}

function validateLocalJsonMutationRequest(request, label) {
  const contentType = String(getRequestHeader(request, "content-type") ?? "").toLowerCase();
  const origin = getRequestHeader(request, "origin");
  const host = getRequestHeader(request, "host");

  if (!contentType.startsWith("application/json")) {
    return {
      ok: false,
      status: 415,
      message: `${label} require application/json.`,
    };
  }

  if (!host || !isLocalHostname(host)) {
    return {
      ok: false,
      status: 403,
      message: `${label} require a local dashboard host.`,
    };
  }

  const originUrl = origin ? parseOriginHeader(origin) : null;
  if (!originUrl || !isLocalHostname(originUrl.hostname)) {
    return {
      ok: false,
      status: 403,
      message: `${label} are restricted to the local dashboard origin.`,
    };
  }

  return { ok: true };
}

function safeErrorCode(error) {
  const code = String(error?.code ?? "UNEXPECTED_ERROR");
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNEXPECTED_ERROR";
}

const PUBLIC_CONFIG_ERROR_MESSAGES = Object.freeze({
  ETORO_CONFIG_ERROR: "eToro server configuration is invalid.",
  ETORO_INVALID_BASE_URL: "Invalid eToro API base URL.",
  ETORO_INVALID_CACHE_TTL: "Read cache TTL must be a positive integer.",
  ETORO_INVALID_CREDENTIAL_FILE: "Credential file must contain a JSON object.",
  ETORO_INVALID_CREDENTIAL_JSON: "Credential file contains invalid JSON.",
  ETORO_CREDENTIAL_FILE_READ_FAILED: "Unable to read eToro credential file.",
  ETORO_CREDENTIALS_MISSING: "eToro credentials are not configured on the server.",
  ETORO_ENDPOINT_NOT_ALLOWED: "Requested eToro endpoint is not in the read-only allow-list.",
  ETORO_INVALID_MARKET_QUERY: "Market data query is invalid.",
  ETORO_INVALID_SYMBOL: "Instrument symbol is invalid.",
  ETORO_SYMBOL_NOT_FOUND: "Instrument symbol was not found.",
  ETORO_SYMBOL_AMBIGUOUS: "Instrument symbol resolution was ambiguous.",
});

function safePublicErrorMessage(error) {
  if (error?.code === "ETORO_TIMEOUT" || error?.code === "ETORO_PROVIDER_ERROR") {
    return publicProviderErrorMessage(error);
  }

  if (PUBLIC_CONFIG_ERROR_MESSAGES[error?.code]) {
    return PUBLIC_CONFIG_ERROR_MESSAGES[error.code];
  }

  return "Unexpected server error";
}

function safeErrorPayload(error) {
  return {
    code: safeErrorCode(error),
    message: safePublicErrorMessage(error),
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
      ...STATIC_SECURITY_HEADERS,
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
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

function readOnlyCachePolicy(config) {
  return {
    readOnlyTtlMs: config.readCacheTtlMs ?? DEFAULT_READ_CACHE_TTL_MS,
    failureBackoffMs: DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
    requestCoalescing: true,
    storage: "server-memory",
  };
}

function publicProviderMetadata(provider = {}) {
  return {
    endpoint: provider.endpoint,
    method: provider.method,
    status: provider.status,
    requestId: provider.requestId,
    receivedAt: provider.receivedAt,
    durationMs: provider.durationMs,
    endpointDetails: "server-only",
    baseUrlDetails: "server-only",
  };
}




async function readJsonBody(request) {
  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body, "utf8") > MAX_API_BODY_BYTES) {
      throw new Error(`Request body must be ${MAX_API_BODY_BYTES} bytes or smaller`);
    }

    return request.body ? JSON.parse(request.body) : {};
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > MAX_API_BODY_BYTES) {
      throw new Error(`Request body must be ${MAX_API_BODY_BYTES} bytes or smaller`);
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}


async function handleTradePreview(request, response, config) {
  const mutationRequest = validateLocalJsonMutationRequest(request, "Demo trade previews");

  if (!mutationRequest.ok) {
    sendJson(response, mutationRequest.status, {
      ok: false,
      mode: "demo-trade-preview",
      mutationRoutesEnabled: false,
      executionBlocked: true,
      error: {
        code: "DEMO_TRADE_PREVIEW_FORBIDDEN",
        message: mutationRequest.message,
      },
    });
    return;
  }

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

async function handleBotConfigRead(response, options) {
  const loadStoredBotConfig = options.loadBotConfig ?? loadBotConfig;
  const loaded = await loadStoredBotConfig({
    configFile: options.botConfigFile,
  });

  sendJson(
    response,
    200,
    {
      ...publicBotConfigPayload(loaded.config, loaded),
      mutationProtection: {
        csrfHeader: BOT_CONFIG_CSRF_HEADER,
        csrfTokenDelivery: "config-read-response-header",
        localOriginOnly: true,
        contentType: "application/json",
      },
    },
    {
      [BOT_CONFIG_CSRF_RESPONSE_HEADER]: botConfigCsrfToken,
    },
  );
}

async function handleBotConfigUpdate(request, response, options) {
  const saveStoredBotConfig = options.saveBotConfig ?? saveBotConfig;
  const mutationRequest = validateBotConfigMutationRequest(request);

  if (!mutationRequest.ok) {
    sendJson(response, mutationRequest.status, {
      ok: false,
      mode: "bot-config",
      mutationRoutesEnabled: false,
      executionBlocked: true,
      error: {
        code: "BOT_CONFIG_MUTATION_FORBIDDEN",
        message: mutationRequest.message,
      },
    });
    return;
  }

  try {
    const saved = await saveStoredBotConfig(await readJsonBody(request), {
      configFile: options.botConfigFile,
    });

    sendJson(response, 200, {
      ...publicBotConfigPayload(saved.config, saved),
      audit: {
        action: "bot_config_updated",
        outcome: "persisted-server-side",
        redacted: true,
      },
    });
  } catch (error) {
    const validationError = error instanceof BotConfigValidationError ||
      error instanceof SyntaxError ||
      String(error?.message ?? "").includes("Request body must be");

    sendJson(response, validationError ? 400 : 500, {
      ok: false,
      mode: "bot-config",
      mutationRoutesEnabled: false,
      executionBlocked: true,
      error: {
        code: validationError ? (error.code ?? "BOT_CONFIG_INVALID") : "BOT_CONFIG_SAVE_FAILED",
        message: validationError ? (error?.message ?? "Invalid bot config") : "Unable to save bot config.",
        fields: validationError ? error.errors : undefined,
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
        cachePolicy: readOnlyCachePolicy(config),
        provider: {
          endpointDetails: "server-only",
          baseUrlDetails: "server-only",
          allowedHostPolicy: "official-host-allow-list",
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
        permissionMatrix: tradingPermissionMatrix(config),
        rateBudget: tradingRateBudget(),
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

    if (pathname === BOT_CONFIG_ROUTE) {
      if (options.request?.method === "PUT") {
        await handleBotConfigUpdate(options.request, response, options);
        return;
      }

      await handleBotConfigRead(response, options);
      return;
    }

    if (pathname === "/api/etoro/bot/strategies") {
      sendJson(response, 200, botStrategyRegistry(config));
      return;
    }

    if (pathname === "/api/etoro/bot/runs") {
      sendJson(response, 200, botSimulationRuns(config));
      return;
    }

    if (pathname === "/api/etoro/bot/audit") {
      sendJson(response, 200, botAuditEvents(config));
      return;
    }

    if (pathname === "/api/etoro/bot/events") {
      sendJson(response, 200, botEventFeed(config));
      return;
    }

    if (pathname === "/api/etoro/bot/trade-log") {
      sendJson(response, 200, botTradeLog(config));
      return;
    }

    if (pathname === "/api/etoro/bot/snapshot") {
      sendJson(
        response,
        200,
        await botSnapshot(config, options),
        {
          [BOT_CONFIG_CSRF_RESPONSE_HEADER]: botConfigCsrfToken,
        },
      );
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

    if (pathname === "/api/etoro/watchlist/default") {
      const result = await providerCache.fetch(
        "defaultWatchlistView",
        config,
        () => defaultWatchlistView(config, fetchEndpoint),
      );
      sendJson(response, 200, {
        ok: true,
        mode: "read-only",
        ...result,
        provider: publicProviderMetadata(result.provider),
      });
      return;
    }

    if (pathname === "/api/etoro/market/resolve") {
      const symbol = normalizeRequestedSymbol(options.searchParams?.get("symbol"));
      const result = await providerCache.fetch(
        `marketResolve:${symbol}`,
        config,
        async () => {
          const resolution = await resolveExactSymbol(fetchEndpoint, config, symbol);
          return {
            data: {
              symbol: resolution.data.symbol,
              displayName: resolution.data.displayName,
              resolution: "exact",
            },
            provider: combinedProviderMetadata("marketResolve", [resolution]),
          };
        },
      );
      sendJson(response, 200, { ok: true, mode: "read-only", ...result, provider: publicProviderMetadata(result.provider) });
      return;
    }

    if (pathname === "/api/etoro/market/rates") {
      const symbols = requestedSymbols(options.searchParams);
      const result = await providerCache.fetch(
        `marketRatesView:${symbols.join(",")}`,
        config,
        () => marketRatesView(config, fetchEndpoint, symbols),
      );
      sendJson(response, 200, { ok: true, mode: "read-only", ...result, provider: publicProviderMetadata(result.provider) });
      return;
    }

    if (pathname === "/api/etoro/market/chart") {
      const symbol = normalizeRequestedSymbol(options.searchParams?.get("symbol"));
      const period = options.searchParams?.get("period") ?? "";
      if (!MARKET_PERIODS[period]) throw marketInputError();
      const result = await providerCache.fetch(
        `marketChartView:${symbol}:${period}`,
        config,
        () => marketChartView(config, fetchEndpoint, symbol, period),
      );
      sendJson(response, 200, { ok: true, mode: "read-only", ...result, provider: publicProviderMetadata(result.provider) });
      return;
    }

    const endpointName = {
      "/api/etoro/identity": "identity",
      "/api/etoro/demo/pnl": "demoPnl",
      "/api/etoro/demo/portfolio": "demoPortfolio",
    }[pathname];
    const result = await providerCache.fetch(endpointName, config, fetchEndpoint);
    sendJson(response, 200, {
      ok: true,
      mode: "read-only",
      ...result,
      provider: publicProviderMetadata(result.provider),
    });
  } catch (error) {
    sendJson(response, error?.status && error.status >= 400 ? error.status : 500, {
      ok: false,
      mode: "read-only",
      error: safeErrorPayload(error),
      cache: error?.cache,
    });
  }
}

export function createRequestHandler(options = {}) {
  const providerCache = options.providerCache ?? createReadOnlyProviderCache({
    ttlMs: (config) => config.readCacheTtlMs ?? DEFAULT_READ_CACHE_TTL_MS,
  });

  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      if (pathname === BOT_CONFIG_ROUTE) {
        if (!["GET", "PUT"].includes(request.method)) {
          sendJson(response, 405, {
            ok: false,
            mode: "bot-config",
            error: { code: "METHOD_NOT_ALLOWED", message: "Bot config supports GET and PUT only" },
          });
          return;
        }

        await handleApiRoute(pathname, response, { ...options, providerCache, request });
        return;
      }

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

      await handleApiRoute(pathname, response, { ...options, providerCache, searchParams: url.searchParams });
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
  const host = resolveDashboardHost(process.env.HOST);
  const server = createServer();

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`eToro dashboard listening on http://${host}:${actualPort}`);
  });
}
