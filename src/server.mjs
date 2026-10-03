import { createEcbReferenceAdapter } from "./ecb-fx.mjs";
import { createMoneyMakerAdapter, BOT_CAPABILITY_REGISTRY, OfflineOperationError } from "./money-maker-adapter.mjs";
import { createServer as createHttpServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BotConfigValidationError,
  loadBotConfig,
  publicBotConfigPayload,
  saveBotConfig,
} from "./bot-config-store.mjs";
import { fetchPortfolioSnapshot, fetchReadOnlyEndpoint } from "./etoro-client.mjs";
import { DEFAULT_READ_CACHE_TTL_MS, credentialsForEnvironment, ETORO_ENVIRONMENTS, loadEtoroConfig, publicCredentialStatus } from "./etoro-config.mjs";
import {
  defaultWatchlistView,
  marketChartView,
  marketInputError,
  marketRatesView,
  marketResolveView,
  MARKET_PERIODS,
  normalizeRequestedSymbol,
  requestedSymbols,
} from "./market-views.mjs";
import {
  createReadOnlyProviderCache,
  DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
  PROVIDER_CACHE_FAILURE,
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
const publicFxReference = createEcbReferenceAdapter();

export const INTERNAL_API_ROUTES = Object.freeze([
  "/api/health",
  "/api/fx/reference",
  "/api/etoro/status",
  "/api/etoro/identity",
  "/api/etoro/demo/pnl",
  "/api/etoro/demo/portfolio",
  "/api/etoro/portfolio",
  "/api/etoro/watchlist/default",
  "/api/etoro/market/resolve",
  "/api/etoro/market/rates",
  "/api/etoro/market/chart",
  "/api/etoro/demo/trading/status",
  "/api/etoro/demo/trading/preview",
  "/api/etoro/bot/operations",
  "/api/etoro/bot/capabilities",
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

    return value;
  }

  return undefined;
}

export function validateDashboardRequestBoundary(request) {
  const host = getRequestHeader(request, "host");
  if (typeof host !== "string" || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?$/.test(host) || (host.includes(":") && !host.endsWith("]") && Number(host.slice(host.lastIndexOf(":") + 1)) > 65535)) return false;
  let base;
  try { base = new URL(`http://${host}`); } catch { return false; }
  if (request.rawHeaders) {
    const keys = request.rawHeaders.filter((_, index) => index % 2 === 0).map((key) => key.toLowerCase());
    if (keys.filter((key) => key === "host").length !== 1 || keys.filter((key) => key === "origin").length > 1) return false;
  }
  const origin = getRequestHeader(request, "origin");
  if (origin !== undefined) {
    if (typeof origin !== "string") return false;
    try { const parsed = new URL(origin); if (parsed.origin !== base.origin || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || origin !== parsed.origin) return false; } catch { return false; }
  }
  try { const url = new URL(request.url, base); if (url.origin !== base.origin) return false; } catch { return false; }
  return true;
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

  if (!/^application\/json(?:;\s*charset=utf-8)?$/.test(contentType)) {
    return {
      ok: false,
      status: 415,
      message: `${label} require application/json.`,
    };
  }

  if (!host || !validateDashboardRequestBoundary(request)) {
    return {
      ok: false,
      status: 403,
      message: `${label} require a local dashboard host.`,
    };
  }

  if (!origin) {
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
  ETORO_CREDENTIAL_PERMISSIONS: "eToro credential storage must be owner-only.",
  ETORO_INVALID_ENVIRONMENT: "Requested eToro environment is invalid.",
  ETORO_PROFILE_NOT_CONFIGURED: "Requested eToro environment is not configured on the server.",
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
    receivedAt: provider.receivedAt,
    durationMs: provider.durationMs,
    endpointDetails: "server-only",
    baseUrlDetails: "server-only",
  };
}

function requestedEnvironment(searchParams, defaultEnvironment, requiredEnvironment) {
  const environment = searchParams?.get("environment") ?? defaultEnvironment;
  if (!ETORO_ENVIRONMENTS.includes(environment) ||
    (searchParams?.getAll("environment").length ?? 0) > 1 ||
    (requiredEnvironment && environment !== requiredEnvironment)) {
    const error = new Error("Requested environment is invalid");
    error.code = "ETORO_INVALID_ENVIRONMENT";
    error.status = 400;
    throw error;
  }
  return environment;
}

function profileFailureState(error) {
  if (error?.code === "ETORO_PROFILE_NOT_CONFIGURED") return "not-configured";
  if (error?.status === 401) return "unauthorized-or-expired";
  if (error?.status === 403) return "wrong-environment";
  if (error?.status === 429) return "rate-limited";
  if (error?.code === "ETORO_TIMEOUT") return "timeout";
  if (typeof error?.code === "string" && /^ETORO_INVALID_(?:JSON|.+_RESPONSE)$/.test(error.code)) return "malformed";
  return "provider-unavailable";
}

async function profileReadiness(environment, config, providerCache, fetchEndpoint) {
  try {
    const credentials = credentialsForEnvironment(config, environment);
    const result = await providerCache.fetch(`portfolio:${environment}`, credentials, () =>
      fetchPortfolioSnapshot(environment, { credentials, fetchEndpoint }),
    );
    return { environment, state: result.cache?.state === "stale" ? profileFailureState(result[PROVIDER_CACHE_FAILURE]) : "ready" };
  } catch (error) {
    return { environment, state: profileFailureState(error) };
  }
}




async function readJsonBody(request) {
  if (typeof request.body === "string") {
    if (Buffer.byteLength(request.body, "utf8") > MAX_API_BODY_BYTES) {
      throw Object.assign(new Error(`Request body must be ${MAX_API_BODY_BYTES} bytes or smaller`), { code: "REQUEST_BODY_TOO_LARGE" });
    }

    return request.body ? JSON.parse(request.body) : {};
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > MAX_API_BODY_BYTES) {
      throw Object.assign(new Error(`Request body must be ${MAX_API_BODY_BYTES} bytes or smaller`), { code: "REQUEST_BODY_TOO_LARGE" });
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

function recordSessionEvent(options, action, outcome, observedAt = new Date().toISOString()) {
  options.sessionEvents?.push({ eventId: randomUUID(), actor: "operator", action, entityRef: "isolated-offline-controls", outcome, createdAt: observedAt });
  if (options.sessionEvents?.length > 100) options.sessionEvents.splice(0, options.sessionEvents.length - 100);
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

    recordSessionEvent(options, "bot_config_updated", "saved-draft-preferences");
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
        code: validationError ? (error.code === "REQUEST_BODY_TOO_LARGE" ? "BOT_CONFIG_INVALID" : (error.code ?? "BOT_CONFIG_INVALID")) : "BOT_CONFIG_SAVE_FAILED",
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

  if (pathname === "/api/fx/reference") {
    try { sendJson(response, 200, { ok: true, data: await (options.fetchFxReference ?? publicFxReference)() }); }
    catch { sendJson(response, 503, { ok: false, error: { code: "FX_UNAVAILABLE", message: "ECB indicative reference rates are unavailable." } }); }
    return;
  }

  try {
    if (pathname === "/api/etoro/bot/audit") { sendJson(response, 200, botAuditEvents({}, options.sessionEvents)); return; }
    if (pathname === "/api/etoro/bot/events") { sendJson(response, 200, botEventFeed({}, options.sessionEvents)); return; }
    if (pathname === "/api/etoro/bot/capabilities") { sendJson(response, 200, { ok: true, ...BOT_CAPABILITY_REGISTRY }); return; }
    if (pathname === "/api/etoro/bot/operations") {
      const adapter = options.moneyMakerAdapter;
      if (options.request?.method === "POST") {
        const mutation = validateBotConfigMutationRequest(options.request);
        if (!mutation.ok) { sendJson(response, mutation.status, { ok: false, error: { code: "OFFLINE_MUTATION_FORBIDDEN", message: mutation.message } }); return; }
      }
      try {
        const result = options.request?.method === "POST" ? await adapter.act(await readJsonBody(options.request)) : await adapter.status();
        if (result.action) recordSessionEvent(options, `diagnostic_${result.action.type.replaceAll("-", "_")}`, result.action.status, result.observedAt);
        sendJson(response, 200, result, { [BOT_CONFIG_CSRF_RESPONSE_HEADER]: botConfigCsrfToken });
      } catch (error) {
        const code = error instanceof OfflineOperationError ? error.code : (error instanceof SyntaxError || error?.code === "REQUEST_BODY_TOO_LARGE") ? "OFFLINE_ACTION_INVALID" : "OFFLINE_OPERATION_FAILED";
        sendJson(response, code === "OFFLINE_ACTION_INVALID" ? 400 : code === "OFFLINE_BUSY" ? 409 : 503, { ok: false, dtoVersion: "dashboard-offline-operations.v1", state: "failed", error: { code, message: "Isolated offline diagnostic operation is unavailable." } }, { [BOT_CONFIG_CSRF_RESPONSE_HEADER]: botConfigCsrfToken });
      }
      return;
    }
    if (pathname === BOT_CONFIG_ROUTE) {
      if (options.request?.method === "PUT") await handleBotConfigUpdate(options.request, response, options);
      else await handleBotConfigRead(response, options);
      return;
    }
    const config = await getConfig(loadConfig);

    if (pathname === "/api/etoro/status") {
      const readiness = await Promise.all(ETORO_ENVIRONMENTS.map((environment) =>
        profileReadiness(environment, config, providerCache, fetchEndpoint),
      ));
      sendJson(response, 200, {
        ok: true,
        mode: "read-only",
        credentialStatus: publicCredentialStatus(config),
        profileReadiness: Object.fromEntries(readiness.map(({ environment, state }) => [environment, state])),
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

    if (pathname === "/api/etoro/bot/strategies") {
      sendJson(response, 200, botStrategyRegistry(config));
      return;
    }

    if (pathname === "/api/etoro/bot/runs") {
      sendJson(response, 200, botSimulationRuns(config));
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

    if (pathname === "/api/etoro/portfolio") {
      const environment = requestedEnvironment(options.searchParams, config.defaultEnvironment);
      const credentials = credentialsForEnvironment(config, environment);
      const result = await providerCache.fetch(`portfolio:${environment}`, credentials, () =>
        fetchPortfolioSnapshot(environment, { credentials, fetchEndpoint }),
      );
      sendJson(response, 200, {
        ok: true,
        mode: "read-only",
        data: result.data,
        cache: result.cache,
      });
      return;
    }

    // Generic reads use only the explicitly selected profile or configured
    // default. Legacy Demo read routes remain pinned to Demo, even if Real is
    // the default. Configuration of another profile never authorizes fallback.
    const demoRoute = pathname.startsWith("/api/etoro/demo/");
    const environment = requestedEnvironment(options.searchParams,
      demoRoute ? "demo" : config.defaultEnvironment, demoRoute ? "demo" : undefined);
    const credentials = credentialsForEnvironment(config, environment);

    if (pathname === "/api/etoro/watchlist/default") {
      const result = await providerCache.fetch(
        "defaultWatchlistView",
        credentials,
        () => defaultWatchlistView(credentials, fetchEndpoint),
      );
      sendJson(response, 200, {
        ok: true,
        mode: "read-only",
        environment,
        ...result,
        provider: publicProviderMetadata(result.provider),
      });
      return;
    }

    if (pathname === "/api/etoro/market/resolve") {
      const symbol = normalizeRequestedSymbol(options.searchParams?.get("symbol"));
      const result = await providerCache.fetch(
        `marketResolve:${symbol}`,
        credentials,
        () => marketResolveView(credentials, fetchEndpoint, symbol),
      );
      sendJson(response, 200, { ok: true, mode: "read-only", environment, ...result, provider: publicProviderMetadata(result.provider) });
      return;
    }

    if (pathname === "/api/etoro/market/rates") {
      const symbols = requestedSymbols(options.searchParams);
      const result = await providerCache.fetch(
        `marketRatesView:${symbols.join(",")}`,
        credentials,
        () => marketRatesView(credentials, fetchEndpoint, symbols),
      );
      sendJson(response, 200, { ok: true, mode: "read-only", environment, ...result, provider: publicProviderMetadata(result.provider) });
      return;
    }

    if (pathname === "/api/etoro/market/chart") {
      const symbol = normalizeRequestedSymbol(options.searchParams?.get("symbol"));
      const period = options.searchParams?.get("period") ?? "";
      if (!MARKET_PERIODS[period]) throw marketInputError();
      const result = await providerCache.fetch(
        `marketChartView:${symbol}:${period}`,
        credentials,
        () => marketChartView(credentials, fetchEndpoint, symbol, period),
      );
      sendJson(response, 200, { ok: true, mode: "read-only", environment, ...result, provider: publicProviderMetadata(result.provider) });
      return;
    }

    const endpointName = {
      "/api/etoro/identity": "identity",
      "/api/etoro/demo/pnl": "demoPnl",
      "/api/etoro/demo/portfolio": "demoPortfolio",
    }[pathname];
    const result = await providerCache.fetch(endpointName, credentials, fetchEndpoint);
    sendJson(response, 200, {
      ok: true,
      mode: "read-only",
      environment,
      ...result,
      provider: publicProviderMetadata(result.provider),
    });
  } catch (error) {
    const status = error?.code === "ETORO_PROFILE_NOT_CONFIGURED" ? 503 :
      (error?.status && error.status >= 400 ? error.status : 500);
    sendJson(response, status, {
      ok: false,
      mode: "read-only",
      error: safeErrorPayload(error),
      cache: error?.cache,
    });
  }
}

export function createRequestHandler(options = {}) {
  const sessionEvents = [];
  const moneyMakerAdapter = options.moneyMakerAdapter ?? createMoneyMakerAdapter({ runtimeRoot: options.moneyMakerRuntimeRoot, stateRoot: options.moneyMakerStateRoot });
  const providerCache = options.providerCache ?? createReadOnlyProviderCache({
    ttlMs: (config) => config.readCacheTtlMs ?? DEFAULT_READ_CACHE_TTL_MS,
  });

  return async (request, response) => {
    if (!validateDashboardRequestBoundary(request)) {
      sendJson(response, 403, { ok: false, error: { code: "DASHBOARD_REQUEST_FORBIDDEN", message: "Requests require the local dashboard Host and same Origin." } });
      return;
    }
    const url = new URL(request.url, `http://${getRequestHeader(request, "host")}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/etoro/bot/operations") {
        if (!["GET", "POST"].includes(request.method)) { sendJson(response, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Offline operations support GET and POST only." } }); return; }
        await handleApiRoute(pathname, response, { ...options, sessionEvents, moneyMakerAdapter, providerCache, request });
        return;
      }
      if (pathname === BOT_CONFIG_ROUTE) {
        if (!["GET", "PUT"].includes(request.method)) {
          sendJson(response, 405, {
            ok: false,
            mode: "bot-config",
            error: { code: "METHOD_NOT_ALLOWED", message: "Bot config supports GET and PUT only" },
          });
          return;
        }

        await handleApiRoute(pathname, response, { ...options, sessionEvents, moneyMakerAdapter, providerCache, request });
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

        await handleApiRoute(pathname, response, { ...options, sessionEvents, moneyMakerAdapter, providerCache, request });
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

      await handleApiRoute(pathname, response, { ...options, sessionEvents, moneyMakerAdapter, providerCache, request, searchParams: url.searchParams });
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
