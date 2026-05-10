import assert from "node:assert/strict";
import test from "node:test";
import { INTERNAL_API_ROUTES, createRequestHandler } from "../src/server.mjs";

async function callHandler(handler, { method = "GET", url = "/api/health" } = {}) {
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

  await handler({ method, url }, response);

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

test("server exposes only read-only internal API routes", () => {
  const serialized = JSON.stringify(INTERNAL_API_ROUTES).toLowerCase();

  assert.deepEqual(INTERNAL_API_ROUTES, [
    "/api/health",
    "/api/etoro/status",
    "/api/etoro/identity",
    "/api/etoro/demo/pnl",
    "/api/etoro/demo/trading/status",
  ]);
  assert.equal(serialized.includes("execution"), false);
  assert.equal(serialized.includes("market-open"), false);
  assert.equal(serialized.includes("market-close"), false);
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
