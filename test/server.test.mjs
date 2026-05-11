import assert from "node:assert/strict";
import test from "node:test";
import { INTERNAL_API_ROUTES, createRequestHandler } from "../src/server.mjs";

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

function configuredHandler() {
  return createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
    }),
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
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.match(response.text, /public-api\.etoro\.com/);
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
