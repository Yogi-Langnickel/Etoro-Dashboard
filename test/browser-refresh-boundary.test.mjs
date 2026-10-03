import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
import { syntheticAggregate, syntheticBreakdown } from "./portfolio-fixture.mjs";
import { loadEtoroConfig } from "../src/etoro-config.mjs";
import { fetchReadOnlyEndpoint } from "../src/etoro-client.mjs";
import { createReadOnlyProviderCache, createRequestHandler } from "../src/server.mjs";

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("Network denied in refresh boundary regression"); }; });
after(() => { globalThis.fetch = originalFetch; });

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = "";
    this.options = []; this.classList = { add() {}, remove() {}, toggle() {} };
  }
  append(...items) { this.children.push(...items); }
  prepend(item) { this.children.unshift(item); }
  replaceChildren(...items) { this.children = items; }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelectorAll(selector) {
    const children = this.children.flatMap((item) => [item, ...item.querySelectorAll("*")]);
    if (selector === "*") return children;
    if (selector === "[data-instrument-row]") return children.filter((item) => "instrumentRow" in item.dataset);
    return children.filter((item) => item.tagName === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get lastElementChild() { return this.children.at(-1); }
}
class Document {
  constructor() { this.nodes = new Map(); }
  getElementById(id) {
    if (!this.nodes.has(id)) {
      const node = new Element();
      if (["provider-status", "last-sync"].includes(id)) node.append(new Element("strong"), new Element("small"));
      this.nodes.set(id, node);
    }
    return this.nodes.get(id);
  }
  createElement(tag) { return new Element(tag); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

async function refreshBoundary({ leverage, oversizedCoverage = false } = {}) {
  const state = { failure: null, now: 1000, calls: 0, routes: [] };
  const handler = createRequestHandler({
    loadConfig: () => loadEtoroConfig({ env: {}, readFile: async () => JSON.stringify({
      defaultEnvironment: "real", profiles: { real: { publicApiKey: "synthetic-api-key", userKey: "synthetic-user-key" } },
    }) }),
    providerCache: createReadOnlyProviderCache({ ttlMs: 10, failureBackoffMs: 100, now: () => state.now }),
    fetchEndpoint: (name, options) => fetchReadOnlyEndpoint(name, { ...options, fetchImpl: async (url) => {
      state.calls += 1;
      if (state.failure === "timeout") throw new DOMException("synthetic private timeout", "AbortError");
      if (state.failure === "malformed") return new Response("invalid synthetic JSON", { status: 200 });
      if (state.failure) return new Response("synthetic private failure", { status: state.failure });
      const raw = url.pathname === "/api/v1/me" ? { gcid: 1, realCid: 2, demoCid: 3, scopes: ["etoro-public:trade.real:read", "etoro-public:trade.demo:read"] }
        : url.pathname.includes("aggregate-portfolio") ? syntheticAggregate()
        : url.pathname.includes("instrument-breakdown") ? syntheticBreakdown()
        : url.pathname.includes("instruments") ? { instrumentDisplayDatas: [{ instrumentID: 1, symbolFull: "AAA", instrumentDisplayName: "Synthetic A" }] }
        : {};
      if (leverage !== undefined && url.pathname.includes("instrument-breakdown")) raw.instruments[0].positions[0].leverage = leverage;
      if (oversizedCoverage && url.pathname.includes("aggregate-portfolio")) raw.instrumentAggregates = Array.from({ length: 501 }, (_, index) => ({ ...raw.instrumentAggregates[0], instrumentId: index + 1 }));
      return new Response(JSON.stringify(raw), { status: 200 });
    } }),
  });
  const localFetch = async (url) => {
    state.routes.push(url);
    const output = { status: 0, body: "", writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await handler({ method: "GET", url, headers: { host: "localhost:4173", origin: "http://localhost:4173" } }, output);
    if (url.startsWith("/api/etoro/portfolio?")) state.portfolioData = JSON.parse(output.body).data;
    return new Response(output.body, { status: output.status });
  };
  const contracts = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = app.slice(0, app.indexOf('document.getElementById("refresh-etoro")?.addEventListener'));
  const document = new Document();
  const api = Function("document", "fetch", "Date", `${contracts}\n${source}; return { refresh:refreshEtoro, fail:renderPortfolioReadFailure };`)(document, localFetch, class extends Date { static now() { return state.now; } });
  return { state, document, ...api };
}

test("oversized optional provider leverage becomes null through server and browser without losing known money", async () => {
  const { state, document, refresh } = await refreshBoundary({ leverage: 1e13 });
  await refresh();
  assert.equal(state.portfolioData.instruments[0].positions[0].leverage, null);
  assert.equal(state.portfolioData.equity, 1010);
  assert.equal(state.portfolioData.instruments[0].investedValue, 100);
  assert.equal(document.getElementById("mock-equity").textContent, "$1,010.00");
  assert.match(document.getElementById("portfolio-stat-source").textContent, /provider normalized/);
});

test("actual loader-handler-client readiness reaches refreshEtoro with distinct initial failure states", async () => {
  for (const [failure, description] of [[429, "provider rate-limited"], ["timeout", "provider timeout"], ["malformed", "provider response malformed"], [503, "provider unavailable"], [401, "authentication rejected"]]) {
    const { state, document, refresh } = await refreshBoundary();
    state.failure = failure;
    await refresh();
    assert.equal(document.getElementById("portfolio-read-state").textContent, `Portfolio: ${description}`);
    assert.equal(document.getElementById("mock-equity").textContent, "Unavailable");
    assert.match(document.getElementById("portfolio-omitted").textContent, /unavailable/);
    assert.equal(state.routes.some((route) => route.startsWith("/api/etoro/portfolio?")), false);
    assert.doesNotMatch([...document.nodes.values()].map((node) => node.textContent).join(" "), /synthetic private|invalid synthetic/);
  }
});

test("actual refresh keeps same-profile last-good statistics stale with their failure category", async () => {
  for (const [failure, description] of [[429, "provider rate-limited"], ["timeout", "provider timeout"], ["malformed", "provider response malformed"], [503, "provider unavailable"]]) {
    const { state, document, refresh } = await refreshBoundary();
    await refresh();
    assert.equal(document.getElementById("mock-equity").textContent, "$1,010.00");
    assert.match(document.getElementById("portfolio-stat-source").textContent, /Real snapshot.*provider normalized/);
    state.failure = failure; state.now += 11;
    await refresh();
    assert.equal(document.getElementById("portfolio-read-state").textContent, `Portfolio: ${description}`);
    assert.equal(document.getElementById("mock-equity").textContent, "$1,010.00");
    assert.match(document.getElementById("portfolio-stat-source").textContent, /Real snapshot.*stale/);
    assert.match(document.getElementById("portfolio-freshness").textContent, /stale; last-good/);
    assert.equal(document.getElementById("portfolio-omitted").textContent, "Omitted rows: 0 (retained stale snapshot)");
    assert.match(document.getElementById("portfolio-partial").textContent, /Retained stale coverage: 0 incomplete aggregate rows; 0 omitted.*Current provider read failed/);
    assert.doesNotMatch(document.getElementById("portfolio-partial").textContent, /no last-good/);
    assert.equal(document.getElementById("performance-line").attributes.points, "");
    if (failure !== "malformed") {
      const calls = state.calls;
      await refresh();
      assert.equal(state.calls, calls, "status backoff must not cause additional provider calls");
      assert.equal(document.getElementById("portfolio-read-state").textContent, `Portfolio: ${description}`);
    }
  }
});

test("retained partial snapshot keeps known omitted/incomplete counts independently from failed-read retry metadata", async () => {
  const { state, document, refresh, fail } = await refreshBoundary({ oversizedCoverage: true });
  await refresh();
  const { omittedRowCount, incompleteRowCount } = state.portfolioData;
  assert.equal(omittedRowCount, 1); assert.ok(incompleteRowCount > 0);
  state.failure = 503; state.now += 11; await refresh();
  assert.equal(document.getElementById("portfolio-omitted").textContent, "Omitted rows: 1 (retained stale snapshot)");
  assert.match(document.getElementById("portfolio-partial").textContent, new RegExp(`Retained stale coverage: ${incompleteRowCount} incomplete aggregate rows; 1 omitted`));
  const cache = { state: "backoff", cachedAt: null, expiresAt: null, ttlMs: 5000, reason: "ETORO_PROVIDER_ERROR", failureAt: "2026-10-04T12:00:00.000Z", retryAt: "2026-10-04T12:00:05.000Z" };
  fail({ status: 503, payload: { cache } }, { retainLastGood: true });
  assert.match(document.getElementById("portfolio-partial").textContent, /1 omitted.*Current provider read failed; retry after 2026-10-04T12:00:05/);
  assert.equal(document.getElementById("mock-equity").textContent, "$1,010.00");
});

test("failure without a validated retained snapshot keeps coverage unavailable even with retry metadata", async () => {
  const { document, fail } = await refreshBoundary();
  fail({ status: 503, payload: { cache: { state: "backoff", cachedAt: null, expiresAt: null, ttlMs: 5000, reason: "ETORO_PROVIDER_ERROR" } } }, { retainLastGood: true });
  assert.equal(document.getElementById("portfolio-omitted").textContent, "Omitted rows: unavailable");
  assert.equal(document.getElementById("portfolio-partial").textContent, "Provider read failed; no last-good provider response; retry window 5000 ms");
  assert.equal(document.getElementById("mock-equity").textContent, "Unavailable");
});
