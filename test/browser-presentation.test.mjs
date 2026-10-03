// Synthetic browser adapter only; native focus containment is also browser-proved.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { composePortfolioSnapshot, normalizeAggregatePortfolio, normalizeInstrumentBreakdown } from "../src/portfolio-contract.mjs";
import { syntheticAggregate, syntheticBreakdown } from "./portfolio-fixture.mjs";

class Element {
  constructor(tag, document) {
    this.tagName = tag; this.document = document; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.classes = new Set(); this.textContent = ""; this.hidden = false; this.open = false; this.options = [];
    this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name), toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  prepend(node) { this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(key, handler) { this.listeners.set(key, handler); }
  emit(key, event = {}) { return this.listeners.get(key)?.({ currentTarget: this, target: this, preventDefault() {}, ...event }); }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
  querySelectorAll(selector) { const nodes = this.children.flatMap((node) => [node, ...node.querySelectorAll("*")]); return selector === "*" ? nodes : selector === "[data-instrument-row]" ? nodes.filter((node) => "instrumentRow" in node.dataset) : nodes.filter((node) => node.tagName === selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get lastElementChild() { return this.children.at(-1); }
  get textContent() { return this._text ?? ""; }
  set textContent(value) { this._text = value; this.textWrites = (this.textWrites ?? 0) + 1; }
}
class Document {
  constructor() {
    this.nodes = new Map(); this.activeElement = null;
    this.tabs = ["portfolio-view", "watchlist-view", "bot-view"].map((id) => { const node = this.createElement("button"); node.dataset.tabTarget = id; if (id === "portfolio-view") node.classes.add("active"); return node; });
    this.panels = this.tabs.map((tab) => { const node = this.createElement("section"); node.dataset.tabPanel = tab.dataset.tabTarget; return node; });
  }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { if (!this.nodes.has(id)) { const node = this.createElement("div"); node.id = id; if (["provider-status", "last-sync"].includes(id)) node.append(this.createElement("strong"), this.createElement("small")); this.nodes.set(id, node); } return this.nodes.get(id); }
  querySelectorAll(selector) { if (selector === "[data-tab-target]") return this.tabs; if (selector === "[data-tab-panel]") return this.panels; if (selector === "[data-instrument-row]") return this.getElementById("portfolio-table-body").querySelectorAll(selector); return []; }
  querySelector(selector) { if (selector === ".inspector-jump") return this.getElementById("portfolio-inspector-open"); if (selector === "[data-tab-target].active") return this.tabs.find((node) => node.classes.has("active")); return this.querySelectorAll(selector)[0] ?? null; }
}
function payload({ count = 1, partial = false } = {}) {
  const raw = syntheticAggregate(), template = raw.instrumentAggregates[0];
  raw.instrumentAggregates = Array.from({ length: count }, (_, n) => ({ ...template, instrumentId: n + 1, ...(partial && n === 0 ? { accountCurrencyReturn: null, liquidationValueAccountCurrency: null } : {}) }));
  const data = composePortfolioSnapshot("real", normalizeAggregatePortfolio(raw), normalizeInstrumentBreakdown(syntheticBreakdown()), raw.instrumentAggregates.map((row, n) => ({ instrumentId: row.instrumentId, symbol: `S${String(n + 1).padStart(3, "0")}`, displayName: `Synthetic ${n + 1}` })));
  return { ok: true, mode: "read-only", data, cache: { state: "hit", cachedAt: "2026-10-02T16:00:00.000Z", expiresAt: "2026-10-02T16:05:00.000Z", ttlMs: 300000 } };
}
async function workspace(fetchImpl) {
  const document = new Document(), clock = { now: Date.parse("2026-10-02T16:01:00Z") }, reads = [];
  const contracts = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = app.slice(0, app.indexOf('renderAudit("Dashboard session started"'));
  const api = Function("document", "fetch", "Date", `${contracts}\n${source}; selectedPortfolioEnvironment="real"; for (const id of ["portfolio-view","watchlist-view","bot-view"]) loadedTabIds.add(id); return { renderProviderPortfolio, renderPortfolioReadFailure, renderPresentationStatus, renderHealthDiagnostics, plainPortfolioReason, setPortfolioField, selectDisplayCurrency, applyTableReview, activateTab, selectEnvironment, refreshEtoro, review: tableReview, selected:()=>selectedPortfolioKey };`)(document, async (url) => { reads.push(url); if (fetchImpl) return fetchImpl(url); throw new Error("Synthetic unavailable"); }, class extends Date { static now() { return clock.now; } });
  return { document, clock, reads, api };
}

test("presentation keeps portfolio freshness, latest-read category, retained coverage and source clocks separate", async () => {
  const { api, document, clock } = await workspace(); const dto = payload({ partial: true }); api.renderProviderPortfolio(dto);
  assert.match(document.getElementById("workspace-banner-title").textContent, /Portfolio data.*incomplete/);
  const before = document.getElementById("portfolio-freshness").textContent;
  api.renderPortfolioReadFailure({ payload: { error: { status: 403 } } });
  assert.match(document.getElementById("workspace-banner-title").textContent, /Connection not authorized/);
  assert.equal(document.getElementById("workspace-banner-action").textContent, "Connection details");
  assert.match(document.getElementById("workspace-banner-detail").textContent, /No account values are loaded/);
  assert.equal(document.getElementById("mock-equity").textContent, "Unavailable", "authorization failure preserves the existing clear-on-auth guard");
  assert.notEqual(document.getElementById("portfolio-freshness").textContent, before);
  api.renderProviderPortfolio(dto);
  api.renderPortfolioReadFailure({ payload: { error: { code: "ETORO_TIMEOUT", status: 504 } } }, { retainLastGood: true });
  assert.match(document.getElementById("workspace-banner-title").textContent, /timed out/);
  assert.match(document.getElementById("workspace-banner-detail").textContent, /retained and stale.*1 incomplete/);
  assert.match(document.getElementById("portfolio-freshness").textContent, /2026-10-02T16:00:00.000Z/);
  assert.equal(document.getElementById("workspace-banner-action").textContent, "Refresh data");
  api.renderProviderPortfolio(dto); clock.now += 301000; api.renderPresentationStatus();
  assert.match(document.getElementById("workspace-banner-title").textContent, /out of date/);
  assert.match(document.getElementById("workspace-banner-detail").textContent, /original timestamp/);
  assert.equal(document.getElementById("workspace-banner-action").textContent, "Refresh data");
});

test("missing cells have readable accessible reasons without replacing known zero, negative values or underlying FX amounts", async () => {
  const { api, document } = await workspace(); const node = document.createElement("td");
  api.setPortfolioField(node, null, "Unavailable", "P/L", "Not supplied"); assert.equal(node.textContent, "—"); assert.match(node.attributes["aria-label"], /P\/L unavailable.*not supplied/);
  api.setPortfolioField(node, 0, "$0.00", "P/L"); assert.equal(node.textContent, "$0.00");
  api.setPortfolioField(node, -1, "-$1.00", "P/L"); assert.equal(node.textContent, "-$1.00");
  const dto = payload(); api.renderProviderPortfolio(dto); api.selectDisplayCurrency("AUD");
  const cell = document.querySelectorAll("[data-instrument-row]")[0].children[1];
  assert.equal(cell.textContent, "—"); assert.match(cell.attributes["aria-label"], /reference rates.*account currency/);
  api.selectDisplayCurrency("USD"); assert.equal(cell.textContent, "$100.00"); assert.equal(dto.data.instruments[0].investedValue, 100);
  assert.doesNotMatch(api.plainPortfolioReason("Combined holding scope is ambiguous"), /permission/);
  assert.equal(api.plainPortfolioReason("Differing position currencies."), "The positions do not share a verified currency.");
  assert.equal(api.plainPortfolioReason("Inconsistent supplied currencies."), "The positions do not share a verified currency.");
});

test("delayed retries present the active request first and previous timeout as history without restoring auth-cleared values", async () => {
  for (const retained of [true, false]) {
    let finish; const pending = new Promise((resolve) => { finish = resolve; }); const dto = payload({ partial: true });
    const { api, document } = await workspace(async (url) => {
      if (url === "/api/health") return pending;
      if (url === "/api/etoro/status") return { ok: true, json: async () => ({ ok: true, credentialStatus: { defaultEnvironment: "real", profiles: { real: { state: "ready" } } }, profileReadiness: { real: "ready" } }) };
      if (url.startsWith("/api/etoro/portfolio")) return { ok: true, json: async () => dto };
      throw new Error("Synthetic optional FX unavailable");
    });
    api.renderProviderPortfolio(dto);
    if (!retained) api.renderPortfolioReadFailure({ payload: { error: { status: 403 } } });
    api.renderPortfolioReadFailure({ payload: { error: { code: "ETORO_TIMEOUT", status: 504 } } }, { retainLastGood: retained });
    const refresh = api.refreshEtoro();
    assert.match(document.getElementById("workspace-banner-title").textContent, /Refreshing data/);
    assert.doesNotMatch(document.getElementById("workspace-banner-title").textContent, /timed out|failed/);
    assert.match(document.getElementById("workspace-banner-detail").textContent, /Previous read timed out/);
    assert.equal(document.getElementById("workspace-banner-action").disabled, true);
    assert.equal(document.getElementById("workspace-banner").dataset.failure, "none");
    if (retained) {
      assert.match(document.getElementById("workspace-banner-detail").textContent, /stale.*Fetched 1 minute ago.*1 incomplete/);
      assert.match(document.getElementById("portfolio-freshness").textContent, /fetched 2026-10-02T16:00:00.000Z/);
    } else {
      assert.match(document.getElementById("workspace-banner-detail").textContent, /No account values are loaded/);
      assert.equal(document.getElementById("portfolio-visible-coverage").textContent, "Holding coverage unavailable");
      assert.equal(document.getElementById("mock-equity").textContent, "Unavailable");
    }
    finish({ ok: true, json: async () => ({ ok: true }) }); await refresh;
    assert.doesNotMatch(document.getElementById("workspace-banner-detail").textContent, /Previous read timed out/);
    assert.equal(document.getElementById("workspace-banner-action").disabled, false);
    assert.equal(document.getElementById("mock-equity").textContent, "$1,010.00");
  }
});

test("initial selection is closed and request-free; Enter and Space open one native dialog and Escape returns scoped row focus", async () => {
  const { api, document, reads } = await workspace(); api.renderProviderPortfolio(payload());
  const dialog = document.getElementById("portfolio-inspector"), row = document.querySelectorAll("[data-instrument-row]")[0];
  assert.equal(dialog.open, false); assert.equal(reads.length, 0);
  for (const key of ["Enter", " "]) {
    row.focus(); row.emit("keydown", { key }); assert.equal(dialog.open, true); assert.equal(document.activeElement.id, "portfolio-inspector-close");
    dialog.emit("cancel"); assert.equal(dialog.open, false); assert.equal(document.activeElement, row);
  }
  document.getElementById("portfolio-inspector-open").emit("click"); assert.equal(dialog.open, true);
  document.getElementById("system-health-open").emit("click"); assert.equal(dialog.open, false); assert.equal(document.getElementById("system-health").open, true); assert.equal(document.activeElement.id, "system-health-close");
  document.getElementById("system-health-close").emit("click"); assert.equal(document.getElementById("system-health").open, false); assert.equal(document.activeElement.id, "system-health-open");
});

test("dialog return focus resolves refreshed scoped rows and falls back to a visible row after filtering", async () => {
  const { api, document } = await workspace(); const dto = payload({ count: 2 }); api.renderProviderPortfolio(dto);
  const first = document.querySelectorAll("[data-instrument-row]")[0]; first.emit("click"); api.renderProviderPortfolio(dto);
  document.getElementById("portfolio-inspector-close").emit("click"); const replacement = document.activeElement;
  assert.notEqual(replacement, first); assert.equal(replacement.dataset.rowKey, first.dataset.rowKey);
  replacement.emit("click"); api.review.portfolio.search = "S002"; api.applyTableReview("portfolio");
  document.getElementById("portfolio-inspector").emit("cancel"); assert.equal(document.activeElement.dataset.rowKey, "direct:S002"); assert.equal(document.activeElement.hidden, false);
});

test("profile and tab transitions close both dialogs while preserving all three tabs and tab-local status scope", async () => {
  const { api, document } = await workspace(); api.renderProviderPortfolio(payload()); document.getElementById("portfolio-inspector-open").emit("click");
  api.activateTab("watchlist-view"); assert.equal(document.getElementById("portfolio-inspector").open, false); assert.equal(document.tabs[1].attributes["aria-selected"], "true"); assert.equal(document.panels[0].hidden, true);
  document.getElementById("system-health-open").emit("click"); api.activateTab("bot-view"); assert.equal(document.getElementById("system-health").open, false); assert.equal(document.tabs[2].attributes["aria-selected"], "true");
  api.activateTab("portfolio-view"); document.getElementById("portfolio-inspector-open").emit("click"); api.selectEnvironment("demo");
  assert.equal(document.getElementById("portfolio-inspector").open, false); assert.equal(api.selected(), null); assert.equal(document.querySelectorAll("[data-instrument-row]").length, 0); assert.match(document.getElementById("workspace-profile").textContent, /Demo.*Read only/);
});

test("health technical reasons remain precise and node-stable during unchanged freshness ticks", async () => {
  const { api, document, clock } = await workspace(); api.renderProviderPortfolio(payload({ partial: true })); const list = document.getElementById("portfolio-technical-reasons"), first = list.children[0];
  const technical = list.children.map((node) => node.textContent).join(" "); assert.match(technical, /accountCurrencyReturn|accountTotals/);
  const announced = ["workspace-banner-title", "workspace-banner-detail", "portfolio-visible-coverage"].map((id) => document.getElementById(id));
  const writes = announced.map((node) => node.textWrites);
  clock.now += 1000; api.renderPresentationStatus(); assert.equal(list.children[0], first);
  assert.deepEqual(announced.map((node) => node.textWrites), writes, "unchanged rounded age and state do not rewrite aria-live messages");
  clock.now += 60000; api.renderPresentationStatus(); assert.match(announced[1].textContent, /Fetched 2 minutes ago/); assert.ok(announced[1].textWrites > writes[1]);
  assert.match(document.getElementById("portfolio-field-reasons").children.map((node) => node.textContent).join(" "), /not supplied|could not be verified/);
});

test("search, sort and 25-row pagination remain local with an initially closed inspector", async () => {
  const { api, document, reads } = await workspace(); api.renderProviderPortfolio(payload({ count: 30 }));
  assert.equal(document.querySelectorAll("[data-instrument-row]").filter((row) => !row.hidden).length, 25);
  document.getElementById("portfolio-page-next").emit("click"); assert.equal(document.querySelectorAll("[data-instrument-row]").filter((row) => !row.hidden).length, 5);
  document.getElementById("portfolio-review-search").emit("input", { target: { value: "S00" } }); assert.equal(document.querySelectorAll("[data-instrument-row]").filter((row) => !row.hidden).length, 9);
  document.getElementById("portfolio-review-direction").emit("change", { target: { value: "desc" } }); assert.equal(document.getElementById("portfolio-table-body").children.filter((row) => !row.hidden)[0].dataset.symbol, "S009");
  assert.equal(document.getElementById("portfolio-inspector").open, false); assert.equal(reads.length, 0);
});
