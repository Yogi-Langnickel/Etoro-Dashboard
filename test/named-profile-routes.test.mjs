import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { loadEtoroConfig } from "../src/etoro-config.mjs";
import { fetchReadOnlyEndpoint } from "../src/etoro-client.mjs";
import { createReadOnlyProviderCache, createRequestHandler } from "../src/server.mjs";

// These credentials and responses are synthetic. The actual loader, HTTP
// handler, client header/path construction and response normalizers all run;
// only provider transport and credential-file I/O are replaced.
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("Unexpected network access in named-profile test"); }; });
after(() => { globalThis.fetch = originalFetch; });

const genericRoutes = [
  "/api/etoro/portfolio", "/api/etoro/watchlist/default", "/api/etoro/identity",
  "/api/etoro/market/resolve?symbol=AAA", "/api/etoro/market/rates?symbols=AAA",
  "/api/etoro/market/chart?symbol=AAA&period=24h",
];
const demoRoutes = ["/api/etoro/demo/pnl", "/api/etoro/demo/portfolio"];
const selected = (route, environment) => `${route}${route.includes("?") ? "&" : "?"}environment=${environment}`;

async function call(handler, url) {
  const response = { status: null, body: "", writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await handler({ method: "GET", url, headers: { host: "localhost:4173" } }, response);
  return { status: response.status, json: JSON.parse(response.body) };
}

function syntheticPayload(url) {
  const path = url.pathname;
  if (path === "/api/v1/me") return { gcid: 1, realCid: 2, demoCid: 3 };
  if (path.includes("/trading/info/")) return { clientPortfolio: {
    credit: 900, positions: [{ instrumentSymbol: "AAA", amount: 100, unrealizedPnL: 10, units: 1, openRate: 100, currentRate: 110 }],
    orders: [], ordersForOpen: [], ordersForClose: [], ordersForCloseMultiple: [], mirrors: [],
  } };
  if (path.includes("/watchlists/")) return [{ itemId: 1, itemType: "Instrument", itemRank: 0, market: { symbolName: "AAA", displayName: "Synthetic A" } }];
  if (path.endsWith("/search")) return { items: [{ instrumentId: 1, internalSymbolFull: "AAA", displayname: "Synthetic A" }] };
  if (path === "/api/v1/market-data/instruments") return { instrumentDisplayDatas: [{ instrumentID: 1, symbolFull: "AAA", instrumentDisplayName: "Synthetic A" }] };
  if (path.endsWith("/rates")) return { rates: [{ instrumentID: 1, bid: 109, ask: 111, lastExecution: 110, date: "2026-01-01T00:00:00Z" }] };
  if (path.includes("/candles/")) return { interval: path.split("/").at(-2), candles: [{ instrumentId: 1, candles: [
    { instrumentID: 1, fromDate: "2026-01-01T00:00:00Z", close: 100 },
    { instrumentID: 1, fromDate: "2026-01-01T01:00:00Z", close: 110 },
  ] }] };
  throw new Error("Unexpected synthetic provider endpoint");
}

function harness({ environments = ["real", "demo"], defaultEnvironment = "demo", providerCache, respond } = {}) {
  const state = { generation: 1, calls: [], status: 200 };
  const loadConfig = () => loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/synthetic/credentials.json" },
    readFile: async () => JSON.stringify({ defaultEnvironment, profiles: Object.fromEntries(environments.map((environment) => [environment, {
      publicApiKey: "synthetic-api-key-" + environment + "-" + state.generation,
      userKey: "synthetic-user-key-" + environment + "-" + state.generation,
    }])) }),
    stat: async (path) => ({ mode: path.endsWith(".json") ? 0o100600 : 0o040700, dev: 1, ino: 1, size: 1, mtimeMs: state.generation }),
  });
  const handler = createRequestHandler({ loadConfig, providerCache, fetchEndpoint: (endpoint, options) => fetchReadOnlyEndpoint(endpoint, {
    ...options,
    fetchImpl: async (url, init) => {
      assert.equal(url.origin, "https://public-api.etoro.com");
      assert.equal(init.method, "GET");
      const environment = options.credentials.environment;
      assert.equal(init.headers["x-api-key"], `synthetic-api-key-${environment}-${state.generation}`);
      assert.equal(init.headers["x-user-key"], `synthetic-user-key-${environment}-${state.generation}`);
      state.calls.push({ endpoint, pathname: url.pathname, environment, generation: state.generation });
      if (respond) return respond({ url, init, endpoint, environment, state });
      return new Response(JSON.stringify(state.status === 200 ? syntheticPayload(url) : { detail: "private provider error" }), { status: state.status });
    },
  }) });
  return { handler, state };
}

for (const environments of [["real"], ["demo"], ["real", "demo"], []]) {
  test(`loader-to-route boundary with ${environments.join("+") || "neither"} profile configured`, async () => {
    // Keep default Demo even for Real-only: outer config.configured must never
    // veto an explicitly selected, valid Real profile.
    const { handler, state } = harness({ environments });
    for (const environment of ["real", "demo"]) {
      for (const route of genericRoutes) {
        const beforeCalls = state.calls.length;
        const result = await call(handler, selected(route, environment));
        if (!environments.includes(environment)) {
          assert.equal(result.status, 503, route);
          assert.equal(result.json.error.code, "ETORO_PROFILE_NOT_CONFIGURED");
          assert.equal(state.calls.length, beforeCalls);
        } else {
          assert.equal(result.status, 200, route);
          assert.equal(result.json.environment ?? result.json.data.environment, environment);
          assert.ok(state.calls.slice(beforeCalls).every((entry) => entry.environment === environment));
          const serialized = JSON.stringify(result.json);
          assert.doesNotMatch(serialized, /synthetic-api-key-|synthetic-user-key-|instrumentId|instrumentID|requestId|gcid|realCid|demoCid|private provider error/);
        }
      }
    }
    for (const route of demoRoutes) {
      const result = await call(handler, route);
      assert.equal(result.status, environments.includes("demo") ? 200 : 503);
      if (result.status === 200) assert.equal(result.json.environment, "demo");
    }
  });
}

test("generic reads use only configured default; Demo routes reject conflicts and duplicate/invalid selection never fetches", async () => {
  const { handler, state } = harness({ defaultEnvironment: "real" });
  for (const route of genericRoutes) {
    const response = await call(handler, route);
    assert.equal(response.status, 200);
    assert.equal(response.json.environment ?? response.json.data.environment, "real");
  }
  for (const route of demoRoutes) {
    assert.equal((await call(handler, route)).json.environment, "demo");
    assert.equal((await call(handler, selected(route, "real"))).status, 400);
  }
  const beforeCalls = state.calls.length;
  for (const route of [...genericRoutes, ...demoRoutes]) {
    for (const value of ["paper", "", "REAL", "demo&environment=real"]) {
      const result = await call(handler, selected(route, value));
      assert.equal(result.status, 400);
      assert.equal(result.json.error.code, "ETORO_INVALID_ENVIRONMENT");
    }
  }
  assert.equal(state.calls.length, beforeCalls);
});

test("configured but unauthorized profiles stay 401 on every provider route, without fallback or raw errors", async () => {
  const { handler, state } = harness();
  state.status = 401;
  for (const environment of ["real", "demo"]) {
    for (const route of [...genericRoutes, ...(environment === "demo" ? demoRoutes : [])]) {
      const beforeCalls = state.calls.length;
      const result = await call(handler, selected(route, environment));
      assert.equal(result.status, 401, route);
      assert.equal(result.json.error.code, "ETORO_PROVIDER_ERROR");
      assert.ok(state.calls.slice(beforeCalls).every((entry) => entry.environment === environment));
      assert.doesNotMatch(JSON.stringify(result.json), /private provider error|synthetic-api-key-|synthetic-user-key-/);
    }
  }
  const status = await call(handler, "/api/etoro/status");
  assert.deepEqual(status.json.profileReadiness, { real: "unauthorized-or-expired", demo: "unauthorized-or-expired" });
});

test("authentication rejection during batched rates cannot be hidden as partial success", async () => {
  const { handler } = harness({ respond: ({ endpoint, url }) => new Response(JSON.stringify(
    endpoint === "marketRates" ? {} : syntheticPayload(url)), { status: endpoint === "marketRates" ? 401 : 200 }) });
  for (const route of ["/api/etoro/watchlist/default", "/api/etoro/market/rates?symbols=AAA"]) {
    assert.equal((await call(handler, selected(route, "real"))).status, 401);
  }
});

test("profile and credential generation isolate success, coalescing, failure backoff and stale rows", async () => {
  let now = 1000;
  const providerCache = createReadOnlyProviderCache({ ttlMs: 10, failureBackoffMs: 100, now: () => now });
  const { handler, state } = harness({ providerCache });
  const real = selected("/api/etoro/watchlist/default", "real");
  const demo = selected("/api/etoro/watchlist/default", "demo");
  const concurrent = await Promise.all([call(handler, real), call(handler, real), call(handler, demo)]);
  assert.deepEqual(concurrent.map(({ json }) => json.environment), ["real", "real", "demo"]);
  assert.equal(state.calls.filter(({ endpoint }) => endpoint === "defaultWatchlist").length, 2);
  assert.ok(concurrent.some(({ json }) => json.cache.state === "coalesced"));
  assert.equal((await call(handler, real)).json.cache.state, "hit");
  now += 11;
  state.status = 503;
  assert.equal((await call(handler, real)).json.cache.state, "stale");
  state.status = 200;
  assert.equal((await call(handler, demo)).json.cache.state, "miss");
  const callsBefore = state.calls.length;
  assert.equal((await call(handler, real)).json.cache.state, "stale");
  assert.equal(state.calls.length, callsBefore);
  state.generation += 1;
  state.status = 503;
  const rotatedFailure = await call(handler, real);
  assert.equal(rotatedFailure.status, 503);
  assert.equal(rotatedFailure.json.cache.state, "error");
  assert.equal(rotatedFailure.json.data, undefined);
  state.status = 200;
  state.generation += 1;
  assert.equal((await call(handler, real)).json.cache.state, "miss");
});

test("documented ID-only portfolio and watchlist rows resolve through one private display-data batch", async () => {
  const { handler, state } = harness({ respond: ({ url }) => {
    let payload = syntheticPayload(url);
    if (url.pathname === "/api/v1/market-data/instruments") {
      assert.equal(url.searchParams.get("instrumentIds"), "1");
      payload = { instrumentDisplayDatas: [{ instrumentID: 1, symbolFull: "AAA", instrumentDisplayName: "Synthetic A" }] };
    } else if (url.pathname.includes("/trading/info/") && url.pathname.endsWith("portfolio")) {
      payload.clientPortfolio.positions = [{ instrumentID: 1, amount: 100, unrealizedPnL: 10 }];
    } else if (url.pathname.includes("/watchlists/")) {
      payload = [{ itemId: 1, itemType: "Instrument", itemRank: 0 }];
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  } });
  for (const environment of ["real", "demo"]) {
    for (const route of ["/api/etoro/portfolio", "/api/etoro/watchlist/default", ...(environment === "demo" ? ["/api/etoro/demo/portfolio"] : [])]) {
      const before = state.calls.length;
      const result = await call(handler, selected(route, environment));
      assert.equal(result.status, 200);
      const rows = result.json.data.instruments ?? result.json.data.items;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].symbol, "AAA");
      assert.equal(state.calls.slice(before).filter(({ pathname }) => pathname === "/api/v1/market-data/instruments").length, 1);
      assert.doesNotMatch(JSON.stringify(result.json), /instrumentID|instrumentId|instrumentDisplayDatas|positionId|synthetic-api-key-|synthetic-user-key-/);
    }
  }
});

test("actual provider readiness preserves rate-limit, timeout and malformed categories", async () => {
  for (const [category, providerReply] of [
    ["rate-limited", () => new Response("private failure", { status: 429 })],
    ["timeout", () => { throw new DOMException("private timeout", "AbortError"); }],
    ["malformed", () => new Response("invalid provider JSON", { status: 200 })],
    ["malformed", () => new Response(JSON.stringify({ unexpected: "invalid provider shape" }), { status: 200 })],
    ["provider-unavailable", () => new Response("private failure", { status: 503 })],
  ]) {
    const { handler } = harness({ environments: ["real"], respond: providerReply });
    const status = await call(handler, "/api/etoro/status");
    assert.deepEqual(status.json.profileReadiness, { real: category, demo: "not-configured" });
    assert.doesNotMatch(JSON.stringify(status.json), /private failure|private timeout|invalid provider|synthetic-api-key-|synthetic-user-key-/);
  }
});

test("stale last-good readiness preserves failure category through backoff without new requests", async () => {
  for (const [category, failureReply] of [
    ["rate-limited", () => new Response("private failure", { status: 429 })],
    ["timeout", () => { throw new DOMException("private timeout", "AbortError"); }],
    ["provider-unavailable", () => new Response("private failure", { status: 503 })],
  ]) {
    let now = 1000; let failing = false;
    const providerCache = createReadOnlyProviderCache({ ttlMs: 10, failureBackoffMs: 100, now: () => now });
    const { handler, state } = harness({ environments: ["real"], providerCache, respond: ({ url }) =>
      failing ? failureReply() : new Response(JSON.stringify(syntheticPayload(url)), { status: 200 }) });
    const initial = await call(handler, selected("/api/etoro/portfolio", "real"));
    assert.equal(initial.status, 200);
    failing = true; now += 11;
    assert.equal((await call(handler, "/api/etoro/status")).json.profileReadiness.real, category);
    const callCount = state.calls.length;
    assert.equal((await call(handler, "/api/etoro/status")).json.profileReadiness.real, category);
    const stale = await call(handler, selected("/api/etoro/portfolio", "real"));
    assert.equal(stale.json.cache.state, "stale");
    assert.deepEqual(stale.json.data, initial.json.data);
    assert.deepEqual(Object.keys(stale.json.cache).sort(), ["cachedAt", "expiresAt", "failureAt", "retryAt", "state", "ttlMs"]);
    assert.equal(state.calls.length, callCount);
    assert.doesNotMatch(JSON.stringify(stale.json), /private failure|private timeout|provider-cache-failure/);
  }
});
