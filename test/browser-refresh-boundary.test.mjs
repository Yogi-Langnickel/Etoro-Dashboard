import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before, after } from "node:test";
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

async function refreshBoundary() {
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
      return new Response(JSON.stringify(url.pathname === "/api/v1/me" ? { gcid: 1, realCid: 2, demoCid: 3 } : {
        clientPortfolio: { credit: 100, positions: [], mirrors: [], orders: [], ordersForOpen: [], ordersForClose: [], ordersForCloseMultiple: [] },
      }), { status: 200 });
    } }),
  });
  const localFetch = async (url) => {
    state.routes.push(url);
    const output = { status: 0, body: "", writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await handler({ method: "GET", url, headers: { host: "localhost:4173", origin: "http://localhost:4173" } }, output);
    return new Response(output.body, { status: output.status });
  };
  const contracts = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = app.slice(0, app.indexOf('document.getElementById("refresh-etoro")?.addEventListener'));
  const document = new Document();
  const refresh = Function("document", "fetch", "Date", `${contracts}\n${source}; return refreshEtoro;`)(document, localFetch, class extends Date { static now() { return state.now; } });
  return { state, document, refresh };
}

test("actual loader-handler-client readiness reaches refreshEtoro with distinct initial failure states", async () => {
  for (const [failure, description] of [[429, "provider rate-limited"], ["timeout", "provider timeout"], ["malformed", "provider response malformed"], [503, "provider unavailable"], [401, "authentication rejected"]]) {
    const { state, document, refresh } = await refreshBoundary();
    state.failure = failure;
    await refresh();
    assert.equal(document.getElementById("portfolio-read-state").textContent, `Portfolio: ${description}`);
    assert.equal(document.getElementById("mock-equity").textContent, "Unavailable");
    assert.equal(state.routes.some((route) => route.startsWith("/api/etoro/portfolio?")), false);
    assert.doesNotMatch([...document.nodes.values()].map((node) => node.textContent).join(" "), /synthetic private|invalid synthetic/);
  }
});

test("actual refresh keeps same-profile last-good statistics stale with their failure category", async () => {
  for (const [failure, description] of [[429, "provider rate-limited"], ["timeout", "provider timeout"], ["malformed", "provider response malformed"], [503, "provider unavailable"]]) {
    const { state, document, refresh } = await refreshBoundary();
    await refresh();
    assert.equal(document.getElementById("mock-equity").textContent, "$100.00");
    assert.match(document.getElementById("portfolio-stat-source").textContent, /Real snapshot.*provider normalized/);
    state.failure = failure; state.now += 11;
    await refresh();
    assert.equal(document.getElementById("portfolio-read-state").textContent, `Portfolio: ${description}`);
    assert.equal(document.getElementById("mock-equity").textContent, "$100.00");
    assert.match(document.getElementById("portfolio-stat-source").textContent, /Real snapshot.*stale/);
    assert.match(document.getElementById("portfolio-freshness").textContent, /stale; last-good/);
    assert.equal(document.getElementById("performance-line").attributes.points, "");
    if (failure !== "malformed") {
      const calls = state.calls;
      await refresh();
      assert.equal(state.calls, calls, "status backoff must not cause additional provider calls");
      assert.equal(document.getElementById("portfolio-read-state").textContent, `Portfolio: ${description}`);
    }
  }
});
