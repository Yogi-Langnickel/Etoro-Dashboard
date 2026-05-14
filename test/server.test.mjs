import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  INTERNAL_API_ROUTES,
  createReadOnlyProviderCache,
  createRequestHandler,
} from "../src/server.mjs";

async function callHandler(handler, { method = "GET", url = "/api/health", body = "" } = {}) {
  const response = {
    body: "",
    headers: {},
    status: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body ? String(body) : "";
    },
  };

  await handler({ method, url, body }, response);

  return {
    status: response.status,
    headers: response.headers,
    text: response.body,
    json: response.body ? JSON.parse(response.body) : null,
  };
}

async function configuredConfig() {
  return {
    baseUrl: "https://public-api.etoro.com",
    apiKey: "server-api-secret",
    userKey: "server-user-secret",
    configured: true,
    credentialFileLoaded: true,
    credentialSource: "file",
    missing: [],
  };
}

function configuredHandler() {
  return createRequestHandler({
    loadConfig: configuredConfig,
  });
}

test("server exposes only internal API routes and no execution routes", () => {
  const serialized = JSON.stringify(INTERNAL_API_ROUTES).toLowerCase();

  assert.deepEqual(INTERNAL_API_ROUTES, [
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
  assert.equal(serialized.includes("execution"), false);
  assert.equal(serialized.includes("market-open"), false);
  assert.equal(serialized.includes("market-close"), false);
});

test("bot monitoring status is read-only, disabled, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-monitoring-planning");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.botEnabled, false);
  assert.equal(response.json.simulatedTelemetryOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.telemetry.source, "synthetic-disabled");
  assert.equal(response.json.telemetry.pendingExecutionCount, 0);
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.accountIdentifiers, "redacted");
  assert.equal(response.json.controlPolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.controlPolicy.strategySelection, "predefined-server-persisted");
  assert.equal(response.json.controlPolicy.configuredStrategyId, "dca-cash-reserve");
  assert.equal(response.json.budgetPolicy.baseBudgetUsd, 1000);
  assert.deepEqual(response.json.budgetPolicy.selectableBudgetsUsd, [500, 1000, 1500, 2500]);
  assert.equal(response.json.budgetPolicy.hardStops.dailyLossUsd, 50);
  assert.equal(response.json.budgetPolicy.profitReuse, "allowed-after-realized-profit-ledger");
  assert.equal(response.json.schedulePolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.schedulePolicy.minimumEvaluationIntervalMinutes >= 240, true);
  assert.equal(response.json.instrumentUniverse.defaultAllowed.includes("US_EQUITIES"), true);
  assert.equal(response.json.auditExport.googleSheets, "planned");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
});

test("bot strategy registry is simulation-only and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/strategies",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-simulation-monitor");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.botEnabled, false);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.strategies.length, 3);
  assert.equal(response.json.strategies[0].strategyId, "dca-cash-reserve");
  assert.equal(response.json.strategies[0].allowedModes.includes("simulation"), true);
  assert.equal(response.json.strategies.some((strategy) => strategy.strategyId === "news-aware-watchlist"), true);
  assert.equal(response.json.budgetPolicy.maxConfigurableBudgetUsd, 2500);
  assert.equal(response.json.schedulePolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.highFrequencyTrading, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("bot simulation runs expose why-no-trade decisions without execution data", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/runs",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-simulation-monitor");
  assert.equal(response.json.runs.length, 2);
  assert.equal(response.json.runs[0].decision, "skip");
  assert.equal(response.json.runs[0].hypotheticalOrderCount, 0);
  assert.equal(response.json.runs[0].budgetRemainingUsd, 1000);
  assert.equal(response.json.schedulePolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.safeguards.orderSubmission, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"positionId"'), false);
});

test("bot trade log is synthetic, budget-scoped, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/trade-log",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-simulation-trade-log");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.summary.source, "synthetic-ledger-preview");
  assert.equal(response.json.summary.budgetRemainingUsd, 1000);
  assert.equal(response.json.entries.length, 2);
  assert.equal(response.json.entries[0].action, "simulated-skip");
  assert.equal(response.json.entries[0].instrument.identifierState, "redacted");
  assert.equal(response.json.safeguards.highFrequencyTrading, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
  assert.equal(response.text.includes('"positionId"'), false);
});

test("bot config returns default server-side simulation controls without secrets", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/config",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-config");
  assert.equal(response.json.config.strategyId, "dca-cash-reserve");
  assert.equal(response.json.config.budgetUsd, 1000);
  assert.deepEqual(response.json.config.allowedMarkets, ["US_EQUITIES", "AU_EQUITIES"]);
  assert.deepEqual(response.json.config.allowedInstrumentClasses, ["EQUITY", "ETF"]);
  assert.equal(response.json.config.minimumEvaluationIntervalMinutes, 240);
  assert.equal(response.json.persistence.pathRedacted, true);
  assert.equal(response.json.persistence.persisted, false);
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.highFrequencyTrading, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("bot config update persists validated server-side config and redacts storage path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "etoro-bot-config-"));
  const botConfigFile = join(tempDir, "bot-config.json");
  const handler = createRequestHandler({
    botConfigFile,
    loadConfig: configuredConfig,
  });
  const body = {
    strategyId: "threshold-rebalance",
    budgetUsd: 1500,
    allowedMarkets: ["US_EQUITIES", "COMMODITIES"],
    allowedInstrumentClasses: ["ETF", "COMMODITY"],
    cadence: "weekly",
  };
  const update = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    body: JSON.stringify(body),
  });
  const readBack = await callHandler(handler, {
    url: "/api/etoro/bot/config",
  });

  assert.equal(update.status, 200);
  assert.equal(update.json.config.strategyId, "threshold-rebalance");
  assert.equal(update.json.config.budgetUsd, 1500);
  assert.equal(update.json.config.cadence, "weekly");
  assert.equal(update.json.config.minimumEvaluationIntervalMinutes, 240);
  assert.equal(update.json.persistence.persisted, true);
  assert.equal(update.json.persistence.pathRedacted, true);
  assert.equal(update.json.audit.action, "bot_config_updated");
  assert.equal(readBack.status, 200);
  assert.equal(readBack.json.config.strategyId, "threshold-rebalance");
  assert.equal(readBack.text.includes(botConfigFile), false);
  assert.equal(readBack.text.includes("server-api-secret"), false);
});

test("bot config update rejects unsupported strategy, markets, and high-frequency cadence", async () => {
  const response = await callHandler(configuredHandler(), {
    method: "PUT",
    url: "/api/etoro/bot/config",
    body: JSON.stringify({
      strategyId: "uploaded-ai-scalper",
      budgetUsd: 10_000,
      allowedMarkets: ["CRYPTO"],
      allowedInstrumentClasses: ["CFD"],
      cadence: "minute",
      minimumEvaluationIntervalMinutes: 5,
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, "BOT_CONFIG_INVALID");
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.text.includes("uploaded-ai-scalper"), false);
  assert.equal(response.text.includes("server-api-secret"), false);
});

test("bot config rejects unsupported methods and oversized request bodies", async () => {
  const methodResponse = await callHandler(configuredHandler(), {
    method: "POST",
    url: "/api/etoro/bot/config",
    body: "{}",
  });
  const oversizedResponse = await callHandler(configuredHandler(), {
    method: "PUT",
    url: "/api/etoro/bot/config",
    body: JSON.stringify({ note: "x".repeat(17_000) }),
  });

  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.json.error.code, "METHOD_NOT_ALLOWED");
  assert.equal(oversizedResponse.status, 400);
  assert.equal(oversizedResponse.json.error.code, "BOT_CONFIG_INVALID");
  assert.match(oversizedResponse.json.error.message, /bytes or smaller/);
});

test("bot audit and events are read-only synthetic feeds", async () => {
  const audit = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/audit",
  });
  const events = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/events",
  });

  assert.equal(audit.status, 200);
  assert.equal(events.status, 200);
  assert.equal(audit.json.auditEvents[0].action, "simulation_monitor_loaded");
  assert.equal(events.json.events[1].type, "risk-veto");
  assert.equal(audit.json.pagination.hasMore, false);
  assert.equal(events.json.pagination.nextCursor, null);
  assert.equal(audit.json.mutationRoutesEnabled, false);
  assert.equal(events.json.mutationRoutesEnabled, false);
  assert.equal(audit.text.includes("server-api-secret"), false);
  assert.equal(events.text.includes("server-user-secret"), false);
  assert.equal(audit.text.includes('"accountId"'), false);
  assert.equal(events.text.includes('"accountId"'), false);
});

test("risk radar status is read-only, synthetic, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/risk/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "risk-radar-planning");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.livePortfolioConnected, false);
  assert.equal(response.json.portfolioRisk.source, "synthetic-placeholder");
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.accountIdentifiers, "redacted");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("research desk status is read-only, synthetic, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/research/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "research-desk-planning");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.dataSources.watchlists, "synthetic-placeholder");
  assert.equal(response.json.dataSources.marketNews, "api-first-planned");
  assert.equal(response.json.dataSources.financialRecords, "official-api-first-planned");
  assert.equal(response.json.dataSources.insiderTransactions, "sec-forms-3-4-5-planned");
  assert.equal(response.json.instrumentLookup.enabled, false);
  assert.equal(response.json.marketNews.enabled, false);
  assert.equal(response.json.marketNews.safeguards.includes("no-trade-trigger-from-news"), true);
  assert.equal(response.json.intelligence.sourcePriority[0].id, "sec-companyfacts");
  assert.equal(response.json.intelligence.freeApiOptions[0].id, "etoro-public-api");
  assert.equal(response.json.intelligence.freeApiOptions.some((source) => source.id === "alpha-vantage"), true);
  assert.equal(response.json.intelligence.freeApiOptions.some((source) => source.id === "twelve-data"), true);
  assert.equal(response.json.intelligence.sourcePriority.some((source) => source.id === "sec-insider-transactions"), true);
  assert.equal(response.json.intelligence.scrapingPolicy.priority, "api-first-scraping-fallback");
  assert.equal(response.json.intelligence.scrapingPolicy.finviz.insiderTradingPage, "reference-only");
  assert.equal(response.json.intelligence.indicatorPolicy.states.includes("buy"), true);
  assert.equal(response.json.intelligence.indicatorPolicy.blockedUses.includes("autonomous trading signal"), true);
  assert.equal(response.json.intelligence.financialRecordsPreview[0].indicator, "hold");
  assert.equal(response.json.intelligence.insiderActivityPreview[0].sourceState, "planned-sec-forms-3-4-5");
  assert.equal(response.json.positionContextPreview.length, 2);
  assert.equal(response.json.positionContextPreview[0].contextOnly, true);
  assert.match(response.json.positionContextPreview[0].news[0].summary, /cannot create a signal or order/);
  assert.equal(response.json.safeguards.watchlistMutation, "blocked");
  assert.equal(response.json.safeguards.feedPosting, "blocked");
  assert.equal(response.json.safeguards.newsTradingSignals, "blocked");
  assert.equal(response.json.safeguards.indicatorTradingSignals, "blocked");
  assert.equal(response.json.safeguards.financialAdvice, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
  assert.equal(response.text.includes("finviz.com"), false);
});

test("demo trading status is planning-only and does not expose secrets", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/demo/trading/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.permissionMatrix.some((item) => item.id === "mutation-routes"), true);
  assert.equal(response.json.rateBudget.currentPressure, "not-connected");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("market-open-orders"), false);
  assert.equal(response.text.includes("market-close-orders"), false);
});

test("demo trading status returns planning metadata without credentials", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: false,
      credentialFileLoaded: false,
      credentialSource: "none",
      missing: ["apiKey", "userKey"],
    }),
  }), {
    url: "/api/etoro/demo/trading/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.credentialStatus.configured, false);
  assert.equal(response.json.permissionMatrix.find((item) => item.id === "read-key").state, "missing");
  assert.equal(response.json.permissionMatrix.find((item) => item.id === "write-key").state, "absent");
});

test("demo trade preview is blocked unless explicitly enabled", async () => {
  const response = await callHandler(configuredHandler(), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.json.error.code, "DEMO_TRADE_PREVIEW_DISABLED");
});

test("enabled demo trade preview returns a redacted non-executing ticket", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
      leverage: "1",
      stopLoss: "120",
      takeProfit: "180",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "demo-trade-preview");
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.json.ticket.hasInstrumentId, true);
  assert.equal(response.json.ticket.instrumentId, undefined);
  assert.equal(response.json.ticket.amount, 150);
  assert.equal(response.text.includes("100000"), false);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("market-open-orders"), false);
  assert.equal(response.json.providerEndpoint.category, "market-open-by-amount");
});

test("demo trade preview blocks sell-side and leverage concepts", async () => {
  const handler = createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  });
  const sellResponse = await callHandler(handler, {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "SELL",
      amount: "150",
      leverage: "1",
    }),
  });
  const leverageResponse = await callHandler(handler, {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
      leverage: "2",
    }),
  });

  assert.equal(sellResponse.status, 400);
  assert.match(sellResponse.json.error.message, /shorts and sell-side concepts are blocked/);
  assert.equal(leverageResponse.status, 400);
  assert.match(leverageResponse.json.error.message, /leverage 1/);
});

test("demo trade preview rejects oversized request bodies", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
      note: "x".repeat(17_000),
    }),
  });

  assert.equal(response.status, 400);
  assert.match(response.json.error.message, /bytes or smaller/);
});

test("demo trade preview validates required ticket fields", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByUnits",
      instrumentId: "100000",
      side: "BUY",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.json.error.code, "INVALID_DEMO_TRADE_PREVIEW");
  assert.match(response.json.error.message, /requires an instrument ID and units/);
});

test("status route never returns configured secret values", async () => {
  const response = await callHandler(configuredHandler(), { url: "/api/etoro/status" });

  assert.equal(response.status, 200);
  assert.equal(response.json.cachePolicy.readOnlyTtlMs, 15_000);
  assert.equal(response.json.cachePolicy.requestCoalescing, true);
  assert.equal(response.json.cachePolicy.storage, "server-memory");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.match(response.text, /public-api\.etoro\.com/);
});

test("status route reports configured read cache policy without secrets", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
      readCacheTtlMs: 30_000,
    }),
  }), { url: "/api/etoro/status" });

  assert.equal(response.status, 200);
  assert.equal(response.json.cachePolicy.readOnlyTtlMs, 30_000);
  assert.equal(response.json.credentialStatus.readCacheTtlMs, 30_000);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
});

test("read-only provider responses are cached without exposing secrets", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: configuredConfig,
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000 }),
    fetchEndpoint: async (endpointName) => {
      fetchCount += 1;
      return {
        data: {
          authenticated: true,
          accountRefs: {
            hasGcid: true,
            hasRealCid: true,
            hasDemoCid: true,
          },
        },
        provider: {
          endpoint: endpointName,
          method: "GET",
          path: "/api/v1/me",
          baseUrl: "https://public-api.etoro.com",
          status: 200,
          requestId: `request-${fetchCount}`,
          receivedAt: new Date().toISOString(),
        },
      };
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 1);
  assert.equal(first.json.cache.state, "miss");
  assert.equal(second.json.cache.state, "hit");
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret"), false);
});

test("concurrent read-only provider requests are coalesced", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
    }),
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000 }),
    fetchEndpoint: async (endpointName) => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        data: {
          currency: "USD",
          credit: 100,
          equity: 100,
          realizedPnL: 0,
          unrealizedPnL: 0,
          availableCash: 100,
          totalInvested: 0,
          calculatedUnrealizedPnL: 0,
          positionCount: 0,
          mirrorCount: 0,
          pendingOrderCount: 0,
          manualPendingOrderCount: 0,
          providerUpdatedAt: null,
        },
        provider: {
          endpoint: endpointName,
          method: "GET",
          path: "/api/v1/trading/info/demo/pnl",
          baseUrl: "https://public-api.etoro.com",
          status: 200,
          requestId: `request-${fetchCount}`,
          receivedAt: new Date().toISOString(),
        },
      };
    },
  });

  const [first, second] = await Promise.all([
    callHandler(handler, { url: "/api/etoro/demo/pnl" }),
    callHandler(handler, { url: "/api/etoro/demo/pnl" }),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 1);
  assert.equal(first.json.cache.state, "miss");
  assert.equal(second.json.cache.state, "coalesced");
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret"), false);
});

test("read-only provider cache is separated by credential fingerprint", async () => {
  let fetchCount = 0;
  let userKey = "server-user-secret-a";
  const handler = createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey,
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
    }),
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000 }),
    fetchEndpoint: async (endpointName) => {
      fetchCount += 1;
      return {
        data: {
          authenticated: true,
          accountRefs: {
            hasGcid: true,
            hasRealCid: true,
            hasDemoCid: true,
          },
        },
        provider: {
          endpoint: endpointName,
          method: "GET",
          path: "/api/v1/me",
          baseUrl: "https://public-api.etoro.com",
          status: 200,
          requestId: `request-${fetchCount}`,
          receivedAt: new Date().toISOString(),
        },
      };
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  userKey = "server-user-secret-b";
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 2);
  assert.equal(first.json.cache.state, "miss");
  assert.equal(second.json.cache.state, "miss");
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret-a"), false);
  assert.equal(second.text.includes("server-user-secret-b"), false);
});

test("non-GET API requests are rejected", async () => {
  const response = await callHandler(createRequestHandler(), {
    method: "POST",
    url: "/api/etoro/demo/pnl",
  });

  assert.equal(response.status, 405);
  assert.equal(response.json.error.code, "METHOD_NOT_ALLOWED");
});

test("malformed URL paths return a controlled not-found response", async () => {
  const response = await callHandler(createRequestHandler(), { url: "/bad-%-path" });

  assert.equal(response.status, 404);
  assert.equal(response.json.error.code, "NOT_FOUND");
});

test("server-side modules are not served as static browser assets", async () => {
  const response = await callHandler(createRequestHandler(), { url: "/server.mjs" });

  assert.equal(response.status, 404);
  assert.equal(response.json.error.code, "NOT_FOUND");
});
