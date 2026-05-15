import { createServer as createHttpServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_BOT_BUDGETS_USD,
  ALLOWED_BOT_INSTRUMENT_CLASSES,
  ALLOWED_BOT_MARKETS,
  BOT_STRATEGY_CONFIG_RULES,
  BotConfigValidationError,
  loadBotConfig,
  publicBotConfigPayload,
  saveBotConfig,
} from "./bot-config-store.mjs";
import { fetchReadOnlyEndpoint, readOnlyEndpointSummary } from "./etoro-client.mjs";
import { DEFAULT_READ_CACHE_TTL_MS, loadEtoroConfig, publicCredentialStatus } from "./etoro-config.mjs";
import { researchIntelligenceStatus } from "./research-intelligence.mjs";

const STATIC_ROOT = fileURLToPath(new URL("./", import.meta.url));
const DEFAULT_PORT = 4173;

export const INTERNAL_API_ROUTES = Object.freeze([
  "/api/health",
  "/api/etoro/status",
  "/api/etoro/identity",
  "/api/etoro/demo/pnl",
  "/api/etoro/demo/trading/status",
  "/api/etoro/demo/trading/preview",
  "/api/etoro/bot/status",
  "/api/etoro/bot/strategies",
  "/api/etoro/bot/runs",
  "/api/etoro/bot/audit",
  "/api/etoro/bot/events",
  "/api/etoro/bot/trade-log",
  "/api/etoro/bot/config",
  "/api/etoro/risk/status",
  "/api/etoro/research/status",
]);

const DEMO_TRADE_PREVIEW_ROUTE = "/api/etoro/demo/trading/preview";
const BOT_CONFIG_ROUTE = "/api/etoro/bot/config";
const BOT_CONFIG_CSRF_HEADER = "x-etoro-dashboard-csrf";
const botConfigCsrfToken = randomBytes(32).toString("base64url");
const MAX_API_BODY_BYTES = 16 * 1024;
export const DEFAULT_PROVIDER_FAILURE_BACKOFF_MS = 5_000;

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

const BOT_BUDGET_POLICY = Object.freeze({
  mode: "simulation-hard-limits",
  baseBudgetUsd: 1000,
  selectableBudgetsUsd: ALLOWED_BOT_BUDGETS_USD,
  profitReuse: "allowed-after-realized-profit-ledger",
  maxConfigurableBudgetUsd: 2500,
  hardStops: Object.freeze({
    dailyLossUsd: 50,
    weeklyLossUsd: 150,
    maxOpenPositions: 3,
  }),
});

const BOT_SCHEDULE_POLICY = Object.freeze({
  mode: "low-frequency-only",
  minimumCadence: "daily",
  minimumEvaluationIntervalMinutes: 240,
  highFrequencyTrading: "blocked",
  maxSimulatedTradeDecisionsPerDay: 3,
});

function botStrategyRecords() {
  const dcaRule = BOT_STRATEGY_CONFIG_RULES["dca-cash-reserve"];
  const newsRule = BOT_STRATEGY_CONFIG_RULES["news-aware-watchlist"];
  const thresholdRule = BOT_STRATEGY_CONFIG_RULES["threshold-rebalance"];

  return [
    {
      strategyId: "dca-cash-reserve",
      name: dcaRule.name,
      version: dcaRule.version,
      status: dcaRule.status,
      allowedModes: ["simulation"],
      allowedMarkets: dcaRule.allowedMarkets,
      allowedInstrumentClasses: dcaRule.allowedInstrumentClasses,
      cadence: dcaRule.cadence,
      riskBudget: {
        maxPositionPct: 10,
        maxWeeklyTurnoverPct: 5,
        maxBudgetUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
        leverage: "1-only",
        shorts: "blocked",
      },
      lastValidation: {
        state: "not-run",
        detail: "Synthetic strategy record only; no provider reads or orders are connected.",
      },
    },
    {
      strategyId: "news-aware-watchlist",
      name: newsRule.name,
      version: newsRule.version,
      status: newsRule.status,
      allowedModes: ["simulation"],
      allowedMarkets: newsRule.allowedMarkets,
      allowedInstrumentClasses: newsRule.allowedInstrumentClasses,
      cadence: newsRule.cadence,
      riskBudget: {
        maxBudgetUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
        profitReuse: "ledger-only",
        newsCanTriggerOrders: "blocked",
        leverage: "1-only",
        shorts: "blocked",
      },
      lastValidation: {
        state: "not-run",
        detail: "Market-news signals are planned as context only and cannot trigger orders.",
      },
    },
    {
      strategyId: "threshold-rebalance",
      name: thresholdRule.name,
      version: thresholdRule.version,
      status: thresholdRule.status,
      allowedModes: ["simulation"],
      allowedMarkets: thresholdRule.allowedMarkets,
      allowedInstrumentClasses: thresholdRule.allowedInstrumentClasses,
      cadence: thresholdRule.cadence,
      riskBudget: {
        maxDriftPct: 5,
        maxPositionPct: 20,
        maxBudgetUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
        leverage: "1-only",
        shorts: "blocked",
      },
      lastValidation: {
        state: "not-run",
        detail: "Synthetic strategy record only; no provider reads or orders are connected.",
      },
    },
  ];
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
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
  const contentType = String(getRequestHeader(request, "content-type") ?? "").toLowerCase();
  const origin = getRequestHeader(request, "origin");
  const host = getRequestHeader(request, "host");
  const csrfToken = getRequestHeader(request, BOT_CONFIG_CSRF_HEADER);

  if (!contentType.startsWith("application/json")) {
    return {
      ok: false,
      status: 415,
      message: "Bot config updates require application/json.",
    };
  }

  if (!host || !isLocalHostname(host)) {
    return {
      ok: false,
      status: 403,
      message: "Bot config updates require a local dashboard host.",
    };
  }

  const originUrl = origin ? parseOriginHeader(origin) : null;
  if (!originUrl || !isLocalHostname(originUrl.hostname)) {
    return {
      ok: false,
      status: 403,
      message: "Bot config updates are restricted to the local dashboard origin.",
    };
  }

  if (csrfToken !== botConfigCsrfToken) {
    return {
      ok: false,
      status: 403,
      message: "Bot config update token is missing or invalid.",
    };
  }

  return { ok: true };
}

function safeErrorPayload(error) {
  return {
    code: error?.code ?? "UNEXPECTED_ERROR",
    message: error?.message ?? "Unexpected server error",
    status: error?.status ?? undefined,
    requestId: error?.requestId ?? undefined,
  };
}

function redactErrorMessage(message, config = {}) {
  let redacted = String(message ?? "");
  const replacements = [
    config.apiKey,
    config.userKey,
    "x-api-key",
    "x-user-key",
    "authorization",
    "api-key",
    "user-key",
  ].filter(Boolean);

  for (const value of replacements) {
    redacted = redacted.replaceAll(String(value), "[redacted]");
  }

  return redacted;
}

function publicProviderErrorMessage(error) {
  if (error?.code === "ETORO_TIMEOUT") {
    return "eToro provider request timed out.";
  }

  if (error?.status === 429) {
    return "eToro provider rate limit is temporarily backing off.";
  }

  if (error?.status >= 500) {
    return "eToro provider is temporarily unavailable.";
  }

  return "eToro provider request failed.";
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

function readOnlyCachePolicy(config) {
  return {
    readOnlyTtlMs: config.readCacheTtlMs ?? DEFAULT_READ_CACHE_TTL_MS,
    failureBackoffMs: DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
    requestCoalescing: true,
    storage: "server-memory",
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function syntheticFixtureWatermark(surface) {
  return {
    surface,
    kind: "synthetic-fixture",
    label: "Synthetic fixture",
    detail: "No live provider response, account identifier, or raw payload is present.",
    liveProviderConnected: false,
    containsPrivateAccountData: false,
    containsRawProviderPayloads: false,
    safeForPublicDemo: true,
  };
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

function providerFailureBackoffEligible(error) {
  return error?.code === "ETORO_TIMEOUT" || error?.status === 429 || error?.status >= 500;
}

function serializeProviderError(error, config) {
  return {
    code: error?.code ?? "ETORO_PROVIDER_UNAVAILABLE",
    message: publicProviderErrorMessage(error),
    redactedDetail: redactErrorMessage(error?.message, config),
    status: error?.status ?? undefined,
    requestId: error?.requestId ?? undefined,
  };
}

function providerErrorWithCacheMetadata(serializedError, cacheState, entry) {
  const error = new Error(serializedError.message);
  error.code = serializedError.code;
  error.status = serializedError.status;
  error.requestId = serializedError.requestId;
  error.cache = {
    state: cacheState,
    cachedAt: entry.cachedAt,
    expiresAt: entry.expiresAt,
    ttlMs: entry.ttlMs,
    reason: serializedError.code,
  };
  return error;
}

function resolveCacheTtlMs(ttlMs, config) {
  return typeof ttlMs === "function" ? ttlMs(config) : ttlMs;
}

export function createReadOnlyProviderCache({
  ttlMs = DEFAULT_READ_CACHE_TTL_MS,
  failureBackoffMs = DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
} = {}) {
  const entries = new Map();

  return {
    async fetch(endpointName, config, fetchEndpoint) {
      const key = readOnlyCacheKey(endpointName, config);
      const now = Date.now();
      const resolvedTtlMs = resolveCacheTtlMs(ttlMs, config);
      const resolvedFailureBackoffMs = resolveCacheTtlMs(failureBackoffMs, config);
      const existing = entries.get(key);

      if (existing?.value && existing.expiresAtMs > now) {
        return withCacheMetadata(existing.value, "hit", existing);
      }

      if (existing?.error && existing.expiresAtMs > now) {
        throw providerErrorWithCacheMetadata(existing.error, "backoff", existing);
      }

      if (existing?.inflight) {
        const value = await existing.inflight;
        const updated = entries.get(key);
        return withCacheMetadata(value, "coalesced", updated);
      }

      const entry = {
        cachedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + resolvedTtlMs).toISOString(),
        expiresAtMs: now + resolvedTtlMs,
        ttlMs: resolvedTtlMs,
      };

      entry.inflight = fetchEndpoint(endpointName, { credentials: config })
        .then((value) => {
          entry.value = cloneJson(value);
          entry.cachedAt = new Date().toISOString();
          entry.expiresAtMs = Date.now() + resolvedTtlMs;
          entry.expiresAt = new Date(entry.expiresAtMs).toISOString();
          delete entry.inflight;
          entries.set(key, entry);
          return entry.value;
        })
        .catch((error) => {
          if (!providerFailureBackoffEligible(error) || resolvedFailureBackoffMs <= 0) {
            entries.delete(key);
            throw error;
          }

          const backoffStartedAt = Date.now();
          entry.error = serializeProviderError(error, config);
          entry.cachedAt = new Date(backoffStartedAt).toISOString();
          entry.expiresAtMs = backoffStartedAt + resolvedFailureBackoffMs;
          entry.expiresAt = new Date(entry.expiresAtMs).toISOString();
          entry.ttlMs = resolvedFailureBackoffMs;
          delete entry.inflight;
          entries.set(key, entry);
          throw providerErrorWithCacheMetadata(entry.error, "error", entry);
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
    controlPolicy: {
      strategySelection: "predefined-server-persisted",
      configuredStrategyId: "dca-cash-reserve",
      allowedStrategyIds: botStrategyRecords().map((strategy) => strategy.strategyId),
      customStrategyUpload: "blocked",
      highFrequencyTrading: "blocked",
    },
    budgetPolicy: BOT_BUDGET_POLICY,
    schedulePolicy: BOT_SCHEDULE_POLICY,
    instrumentUniverse: {
      configurable: "planned",
      defaultAllowed: ALLOWED_BOT_MARKETS,
      defaultInstrumentClasses: ALLOWED_BOT_INSTRUMENT_CLASSES,
      disabledUntilReviewed: ["DERIVATIVES", "CFD", "CRYPTO"],
      perStrategyAllowlist: "required-before-execution",
    },
    auditExport: {
      tradeLog: "required-before-execution",
      googleSheets: "planned",
      rawProviderPayloads: "excluded",
    },
  };
}

function botStrategyRegistry(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    demoOnly: true,
    botEnabled: false,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    strategies: botStrategyRecords(),
    budgetPolicy: BOT_BUDGET_POLICY,
    schedulePolicy: BOT_SCHEDULE_POLICY,
    safeguards: {
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      customStrategies: "blocked",
      highFrequencyTrading: "blocked",
    },
  };
}

function botSimulationRuns(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    runs: [
      {
        runId: "sim-run-001",
        strategyId: "dca-cash-reserve",
        strategyVersion: "0.1.0-sim",
        environment: "synthetic",
        state: "simulated",
        evaluatedAt: "2026-05-13T00:00:00.000Z",
        decision: "skip",
        reasonCode: "provider-not-connected",
        riskResult: "blocked",
        hypotheticalOrderCount: 0,
        budgetUsedUsd: 0,
        budgetRemainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
      },
      {
        runId: "sim-run-002",
        strategyId: "threshold-rebalance",
        strategyVersion: "0.1.0-sim",
        environment: "synthetic",
        state: "simulated",
        evaluatedAt: "2026-05-13T00:05:00.000Z",
        decision: "skip",
        reasonCode: "portfolio-snapshot-unavailable",
        riskResult: "blocked",
        hypotheticalOrderCount: 0,
        budgetUsedUsd: 0,
        budgetRemainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
      },
    ],
    schedulePolicy: BOT_SCHEDULE_POLICY,
    safeguards: {
      executionRoutes: "absent",
      orderSubmission: "blocked",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}

function botAuditEvents(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    auditEvents: [
      {
        eventId: "audit-001",
        actor: "system",
        action: "simulation_monitor_loaded",
        entityRef: "bot-monitor",
        outcome: "read-only",
        createdAt: "2026-05-13T00:00:00.000Z",
      },
      {
        eventId: "audit-002",
        actor: "system",
        action: "execution_routes_checked",
        entityRef: "bot-monitor",
        outcome: "absent",
        createdAt: "2026-05-13T00:00:01.000Z",
      },
      {
        eventId: "audit-003",
        actor: "operator",
        action: "local_strategy_preview_loaded",
        entityRef: "dca-cash-reserve",
        outcome: "not-persisted",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ],
    pagination: {
      limit: 20,
      nextCursor: null,
      hasMore: false,
    },
    safeguards: {
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      orderPayloads: "not-created",
    },
  };
}

function botEventFeed(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    events: [
      {
        eventId: "event-001",
        type: "decision",
        severity: "info",
        title: "DCA simulation skipped",
        detail: "Provider portfolio data is not connected, so no candidate order was produced.",
        createdAt: "2026-05-13T00:00:00.000Z",
      },
      {
        eventId: "event-002",
        type: "risk-veto",
        severity: "warn",
        title: "Rebalance blocked",
        detail: "Portfolio snapshot is unavailable; risk engine remains fail-closed.",
        createdAt: "2026-05-13T00:05:00.000Z",
      },
      {
        eventId: "event-003",
        type: "budget-check",
        severity: "info",
        title: "Budget guardrail loaded",
        detail: "Simulation budget options are capped at USD 2,500 with daily and weekly loss stops.",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ],
    pagination: {
      limit: 20,
      nextCursor: null,
      hasMore: false,
    },
    safeguards: {
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}

function botTradeLog(config) {
  return {
    ok: true,
    mode: "bot-simulation-trade-log",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    summary: {
      source: "synthetic-ledger-preview",
      durableStore: "planned-worker-owned",
      googleSheetsExport: "planned-redacted-sink",
      realizedProfitUsd: 0,
      reusableProfitUsd: 0,
      budgetUsedUsd: 0,
      budgetRemainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
    },
    entries: [
      {
        tradeLogId: "trade-log-001",
        runId: "sim-run-001",
        strategyId: "dca-cash-reserve",
        createdAt: "2026-05-14T00:00:00.000Z",
        action: "simulated-skip",
        decision: "blocked",
        reasonCode: "provider-not-connected",
        instrument: {
          symbol: "SPY",
          assetClass: "ETF",
          identifierState: "redacted",
        },
        budget: {
          allocatedUsd: 0,
          remainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
          maxPositionPct: 10,
        },
        riskChecks: ["provider-read-required", "stale-data-block", "execution-route-absent"],
      },
      {
        tradeLogId: "trade-log-002",
        runId: "sim-run-002",
        strategyId: "threshold-rebalance",
        createdAt: "2026-05-14T00:05:00.000Z",
        action: "simulated-skip",
        decision: "blocked",
        reasonCode: "portfolio-snapshot-unavailable",
        instrument: {
          symbol: "GLD",
          assetClass: "ETF",
          identifierState: "redacted",
        },
        budget: {
          allocatedUsd: 0,
          remainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
          maxPositionPct: 20,
        },
        riskChecks: ["portfolio-snapshot-required", "no-hft-cadence", "execution-route-absent"],
      },
    ],
    safeguards: {
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      orderPayloads: "not-created",
      highFrequencyTrading: "blocked",
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
    fixtureWatermark: syntheticFixtureWatermark("risk-radar"),
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
  const intelligence = researchIntelligenceStatus();

  return {
    ok: true,
    mode: "research-desk-planning",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    fixtureWatermark: syntheticFixtureWatermark("research-desk"),
    dataSources: {
      watchlists: "synthetic-placeholder",
      instruments: "synthetic-placeholder",
      marketNews: "api-first-planned",
      financialRecords: "official-api-first-planned",
      insiderTransactions: "sec-forms-3-4-5-planned",
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
    marketNews: {
      enabled: false,
      mode: "api-first-scraping-fallback-planning",
      target: "attach-redacted-news-summaries-to-watchlist-and-position-rows",
      candidateSources: ["free-apis", "rss-feeds", "official-company-newsrooms", "allowlisted-scraping"],
      safeguards: [
        "server-side-fetch-only",
        "source-allowlist-required",
        "robots-and-terms-review-required",
        "no-trade-trigger-from-news",
        "headline-summary-redaction",
      ],
      rowPreview: [
        {
          symbol: "AAPL",
          state: "placeholder",
          headline: "No live news source connected",
          source: "synthetic",
          attachedTo: "watchlist",
        },
      ],
    },
    positionContextPreview: [
      {
        symbol: "SPY",
        assetClass: "ETF",
        positionState: "synthetic",
        contextOnly: true,
        news: [
          {
            headline: "Macro calendar context placeholder",
            source: "synthetic",
            age: "not-live",
            summary: "Use only as portfolio context; this cannot create a signal or order.",
          },
        ],
      },
      {
        symbol: "GLD",
        assetClass: "ETF",
        positionState: "synthetic",
        contextOnly: true,
        news: [
          {
            headline: "Commodity market context placeholder",
            source: "synthetic",
            age: "not-live",
            summary: "Source allowlist and terms review are required before live news ingestion.",
          },
        ],
      },
    ],
    intelligence,
    safeguards: {
      watchlistMutation: "blocked",
      feedPosting: "blocked",
      newsTradingSignals: "blocked",
      indicatorTradingSignals: "blocked",
      financialAdvice: "blocked",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}

function tradingPermissionMatrix(config) {
  return [
    {
      id: "read-key",
      label: "Read key",
      state: config.configured ? "configured" : "missing",
      detail: config.configured ? "Server-side only" : "No server credential",
    },
    {
      id: "write-key",
      label: "Write key",
      state: "absent",
      detail: "No order-submission key is used by this app slice",
    },
    {
      id: "environment",
      label: "Environment",
      state: "demo-only",
      detail: "Live trading remains unavailable",
    },
    {
      id: "preview",
      label: "Preview route",
      state: config.demoTradePreviewEnabled ? "enabled" : "disabled",
      detail: "Validation only; no provider mutation",
    },
    {
      id: "mutation-routes",
      label: "Mutation routes",
      state: "absent",
      detail: "No market-open, market-close, copy, or account routes exist",
    },
  ];
}

function tradingRateBudget() {
  return {
    source: "planning",
    window: "rolling-1-minute",
    readBudget: "60-per-minute-documented",
    writeBudget: "20-per-minute-documented",
    reservedHeadroom: "emergency-and-status-reads",
    currentPressure: "not-connected",
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

  if (side !== "BUY") {
    throw new Error("Preview only supports BUY; shorts and sell-side concepts are blocked");
  }

  if (leverage !== 1) {
    throw new Error("Preview only supports leverage 1");
  }

  if (orderType === "marketOpenByAmount") {
    if (!instrumentId || amount === null) {
      throw new Error("Market open by amount requires an instrument ID and amount");
    }

    return {
      providerEndpoint: {
        category: "market-open-by-amount",
        method: PLANNED_DEMO_TRADING_ENDPOINTS.marketOpenByAmount.method,
      },
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
      providerEndpoint: {
        category: "market-open-by-units",
        method: PLANNED_DEMO_TRADING_ENDPOINTS.marketOpenByUnits.method,
      },
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
      providerEndpoint: {
        category: "market-close-position",
        method: PLANNED_DEMO_TRADING_ENDPOINTS.marketClosePosition.method,
      },
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

async function handleBotConfigRead(response, options) {
  const loadStoredBotConfig = options.loadBotConfig ?? loadBotConfig;
  const loaded = await loadStoredBotConfig({
    configFile: options.botConfigFile,
  });

  sendJson(response, 200, {
    ...publicBotConfigPayload(loaded.config, loaded),
    mutationProtection: {
      csrfHeader: BOT_CONFIG_CSRF_HEADER,
      csrfToken: botConfigCsrfToken,
      localOriginOnly: true,
      contentType: "application/json",
    },
  });
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
        message: error?.message ?? "Unable to save bot config",
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
