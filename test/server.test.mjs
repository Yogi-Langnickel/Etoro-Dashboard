import assert from "node:assert/strict";
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
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
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
  assert.equal(response.json.instrumentLookup.enabled, false);
  assert.equal(response.json.safeguards.watchlistMutation, "blocked");
  assert.equal(response.json.safeguards.feedPosting, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("demo trading status is planning-only and does not expose secrets", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/demo/trading/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.match(response.text, /market-open-orders/);
  assert.match(response.text, /market-close-orders/);
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
  assert.equal(Object.keys(response.json.plannedProviderEndpoints).length, 4);
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
  assert.match(response.json.providerEndpoint.path, /market-open-orders\/by-amount/);
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
