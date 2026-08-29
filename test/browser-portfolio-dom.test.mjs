import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.className = ""; this.textContent = ""; this.listeners = new Map(); this.classList = { add: (name) => { this.className += ` ${name}`; }, remove: () => {}, toggle: () => {} }; }
  append(...items) { this.children.push(...items); } replaceChildren(...items) { this.children = items; } prepend(item) { this.children.unshift(item); } setAttribute(key, value) { this.attributes[key] = String(value); } addEventListener(key, value) { this.listeners.set(key, value); }
  querySelectorAll(selector) { const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]); return selector === "*" ? all : selector === "[data-instrument-row]" ? all.filter((item) => Object.hasOwn(item.dataset, "instrumentRow")) : selector === "[data-period-value]" ? all.filter((item) => Object.hasOwn(item.dataset, "periodValue")) : []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get lastElementChild() { return this.children.at(-1); }
}
class Document {
  constructor() { this.nodes = new Map(); this.periods = ["24h", "1w"].map((period) => { const node = new Element("button"); node.dataset.period = period; return node; }); }
  createElement(tag) { return new Element(tag); } getElementById(id) { if (!this.nodes.has(id)) this.nodes.set(id, new Element()); return this.nodes.get(id); }
  querySelectorAll(selector) { if (selector === "[data-period]") return this.periods; if (selector === "[data-instrument-row]") return this.getElementById("portfolio-table-body").querySelectorAll(selector); return []; }
}
async function renderer(document) {
  const contracts = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = app.slice(0, app.indexOf("function renderSelectedWatchlistInstrument"));
  return Function("document", `${contracts}\n${source}; return { clearPortfolioBoundState, renderProviderPortfolio, renderFulfilledProviderPortfolio, renderPortfolioReadFailure };`)(document);
}
function payload(instruments = [{ symbol: "AAPL", displayName: "Apple", positionCount: 1, units: 2, averageOpenPrice: 100, currentPrice: 120, investedValue: 200, netValue: 220, unrealizedPnl: 20, unrealizedPnlPercent: 10, allocationPercent: 100, completeness: "complete" }]) {
  return { ok: true, mode: "read-only", data: { environment: "real", currency: "USD", equity: 220, availableCash: 0, totalInvested: 200, unrealizedPnl: 20, realizedPnl: null, openPositionCount: instruments.reduce((sum, item) => sum + item.positionCount, 0), instrumentCount: instruments.length, mirrorCount: null, pendingOrderCount: null, providerUpdatedAt: "2026-08-30T00:00:00.000Z", omittedRowCount: 0, incompleteRowCount: 0, instruments }, cache: { state: "hit", cachedAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-30T00:00:15.000Z", ttlMs: 15000 } };
}
test("live portfolio DOM renders only exact provider DTO rows and never provider metadata", async () => {
  const document = new Document(); const { renderProviderPortfolio } = await renderer(document); renderProviderPortfolio(payload());
  const row = document.querySelectorAll("[data-instrument-row]")[0];
  assert.equal(row.children[0].children[0].textContent, "AAPL");
  assert.equal(document.getElementById("mock-equity").textContent, "$220.00");
  assert.match(document.getElementById("portfolio-read-state").textContent, /provider Hit/);
  assert.equal(document.getElementById("chart-request").textContent, "Provider request ID: hidden");
});
test("empty live portfolio provides an explicit no-open-positions state", async () => {
  const document = new Document(); const { renderProviderPortfolio } = await renderer(document); renderProviderPortfolio(payload([]));
  assert.equal(document.getElementById("portfolio-table-body").children[0].children[0].textContent, "No open positions");
});

test("loaded Real to unavailable Demo transition clears every portfolio-bound browser value", async () => {
  const document = new Document(); const { clearPortfolioBoundState, renderPortfolioReadFailure, renderProviderPortfolio } = await renderer(document);
  renderProviderPortfolio(payload());
  assert.equal(document.getElementById("mock-equity").textContent, "$220.00");
  clearPortfolioBoundState();
  renderPortfolioReadFailure({ payload: { error: { code: "ETORO_PROFILE_NOT_CONFIGURED", status: 503 } } });
  assert.equal(document.getElementById("portfolio-table-body").children.length, 0);
  assert.equal(document.getElementById("mock-equity").textContent, "Unavailable");
  assert.equal(document.getElementById("cash-buffer").textContent, "Unavailable");
  assert.equal(document.getElementById("portfolio-source-watermark").textContent, "Provider only");
  assert.equal(document.getElementById("chart-title").textContent, "Select a live holding");
  assert.equal(document.getElementById("performance-line").attributes.points, "");
  assert.match(document.getElementById("portfolio-freshness").textContent, /no provider rows loaded/);
});
test("identifier-shaped or extra browser fields fail closed", async () => {
  const document = new Document(); const { renderFulfilledProviderPortfolio } = await renderer(document); const invalid = payload(); invalid.provider = { requestId: "private" };
  assert.equal(renderFulfilledProviderPortfolio(invalid), false);
});

test("portfolio failure states distinguish malformed, timeout, rate-limit/backoff, and 5xx provider failures", async () => {
  const document = new Document(); const { renderPortfolioReadFailure } = await renderer(document);
  renderPortfolioReadFailure({ payload: { error: { code: "ETORO_INVALID_DEMO_PNL_RESPONSE", status: 502 } } });
  assert.equal(document.getElementById("portfolio-read-state").textContent, "Portfolio: provider response malformed");
  renderPortfolioReadFailure({ payload: { error: { code: "ETORO_TIMEOUT", status: 504 } } });
  assert.equal(document.getElementById("portfolio-read-state").textContent, "Portfolio: provider timeout");
  renderPortfolioReadFailure({ payload: { error: { code: "ETORO_PROVIDER_ERROR", status: 429 }, cache: { state: "backoff", cachedAt: "2026-08-30T00:00:00.000Z", expiresAt: "2026-08-30T00:00:15.000Z", ttlMs: 15000, reason: "ETORO_PROVIDER_ERROR" } } });
  assert.equal(document.getElementById("portfolio-read-state").textContent, "Portfolio: provider backoff");
  renderPortfolioReadFailure({ payload: { error: { code: "ETORO_PROVIDER_ERROR", status: 503 } } });
  assert.equal(document.getElementById("portfolio-read-state").textContent, "Portfolio: provider unavailable");
});

test("Portfolio refresh has a request sequence guard against stale environment rendering", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /let etoroRefreshRequestSequence = 0/);
  assert.match(source, /sequence !== etoroRefreshRequestSequence \|\| environment !== selectedPortfolioEnvironment/);
  assert.match(source, /etoroRefreshRequestSequence \+= 1;/);
});
