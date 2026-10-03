// Synthetic data only: exercise browser formatting, scope selection and FX races.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { composePortfolioSnapshot, normalizeAggregatePortfolio, normalizeInstrumentBreakdown } from "../src/portfolio-contract.mjs";
import { syntheticAggregate, syntheticBreakdown } from "./portfolio-fixture.mjs";
import { expectedRateDate } from "../src/ecb-fx.mjs";

class Element {
  constructor(tag, document) { this.tagName = tag; this.document = document; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.textContent = ""; this.classList = { add() {}, toggle() {}, remove() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(node) { this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  focus() { this.document.activeElement = this; }
  querySelectorAll(selector) { const nodes = this.children.flatMap((node) => [node, ...node.querySelectorAll("*")]); return selector === "*" ? nodes : selector === "[data-instrument-row]" ? nodes.filter((node) => "instrumentRow" in node.dataset) : nodes.filter((node) => node.tagName === selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get lastElementChild() { return this.children.at(-1); }
}
class Document {
  constructor() { this.nodes = new Map(); this.activeElement = null; }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { if (!this.nodes.has(id)) { const node = this.createElement("div"); if (["last-sync", "provider-status"].includes(id)) node.append(this.createElement("strong"), this.createElement("small")); this.nodes.set(id, node); } return this.nodes.get(id); }
  querySelectorAll(selector) { return selector === "[data-instrument-row]" ? this.getElementById("portfolio-table-body").querySelectorAll(selector) : []; }
}
function dto({ aggregate = syntheticAggregate(), breakdown = syntheticBreakdown(), metadata = [{ instrumentId: 1, symbol: "AAA", displayName: "Synthetic A" }], environment = "real" } = {}) {
  const data = composePortfolioSnapshot(environment, normalizeAggregatePortfolio(aggregate), breakdown ? normalizeInstrumentBreakdown(breakdown) : null, metadata);
  data.fieldSources ??= {};
  for (const item of data.instruments) item.fieldSources ??= {};
  return { ok: true, mode: "read-only", data, cache: { state: "hit", cachedAt: "2026-10-02T16:00:00.000Z", expiresAt: "2026-10-02T16:00:15.000Z", ttlMs: 15000 } };
}
const snapshot = (freshness = "current") => ({ ok: true, data: { source: "ECB", basis: "units-per-EUR", rateDate: "2026-10-02", receivedAt: "2026-10-02T16:00:00.000Z", freshness, rates: { EUR: 1, USD: 1.25, AUD: 2, JPY: 200, GBP: 0.8, CHF: 0.9, CAD: 1.5, NZD: 2.2 } } });
const response = (body) => ({ ok: true, status: 200, json: async () => body });
async function workspace(fetch = async () => { throw new Error("Synthetic network unavailable"); }) {
  const document = new Document(), clock = { now: Date.parse("2026-10-03T12:00:00.000Z") };
  const contracts = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = app.slice(0, app.indexOf("function renderSelectedWatchlistInstrument"));
  const api = Function("document", "fetch", "Date", `${contracts}\n${source}; return { renderProviderPortfolio, renderPortfolioMoney, selectDisplayCurrency, refreshFx, applyFxFreshness, applyTableReview, clearPortfolioBoundState, normalizeLivePortfolioPayload, normalizeFxPayload, fxPublicationDate, renderPortfolioReadFailure, selectPortfolioInstrument, review:tableReview, selected:()=>selectedPortfolioKey };`)(document, fetch, class extends Date { static now() { return clock.now; } });
  return { document, clock, api };
}

test("one FX snapshot converts all account money with cross-rate direction, leaves native fields intact and follows minor units", async () => {
  let calls = 0;
  const { api, document } = await workspace(async (url) => { if (url === "/api/fx/reference") { calls++; return response(snapshot()); } throw new Error("No provider calls"); });
  api.renderProviderPortfolio(dto()); await api.refreshFx(); api.selectDisplayCurrency("AUD");
  assert.equal(calls, 1);
  assert.equal(document.getElementById("mock-equity").textContent, "AUD 1,616.00");
  assert.equal(document.getElementById("cash-buffer").textContent, "AUD 1,440.00");
  assert.equal(document.getElementById("exposure").textContent, "AUD 160.00");
  assert.equal(document.getElementById("unrealized-pnl").textContent, "+AUD 16.00");
  const row = document.getElementById("portfolio-table-body").children[0];
  assert.equal(row.children[1].textContent, "AUD 160.00");
  assert.equal(row.children[2].textContent, "AUD 176.00");
  assert.equal(row.children[4].textContent, "+10.00%");
  assert.equal(document.getElementById("portfolio-selected-price").textContent, "110 USD");
  assert.equal(document.getElementById("portfolio-selected-units").textContent, "1");
  assert.match(document.getElementById("portfolio-stat-largest").textContent, /AUD 160\.00/);
  api.selectDisplayCurrency("JPY"); assert.equal(document.getElementById("exposure").textContent, "JPY 16,000");
  api.selectDisplayCurrency("EUR"); assert.equal(document.getElementById("exposure").textContent, "EUR 80.00");
  assert.equal(calls, 1, "currency selections are entirely local");
});

test("missing or stale FX hides converted money explicitly while account currency, native prices and percentages remain readable", async () => {
  const { api, document } = await workspace(async () => response(snapshot("stale")));
  api.renderProviderPortfolio(dto()); api.selectDisplayCurrency("AUD");
  assert.equal(document.getElementById("mock-equity").textContent, "Unavailable (FX)");
  await api.refreshFx();
  assert.equal(document.getElementById("exposure").textContent, "Unavailable (FX)");
  assert.match(document.getElementById("portfolio-fx-basis").textContent, /FX unavailable.*FX stale/);
  assert.equal(document.getElementById("portfolio-selected-price").textContent, "110 USD");
  api.selectDisplayCurrency("USD"); assert.equal(document.getElementById("mock-equity").textContent, "$1,010.00");
  api.selectDisplayCurrency("XXX"); assert.equal(document.getElementById("mock-equity").textContent, "Unavailable (FX)");
});

test("valid reference rates with out-of-range conversion use compact range reasons and recover in the original account currency", async () => {
  const rates = snapshot(); rates.data.rates.USD = 1; rates.data.rates.AUD = 2000;
  const { api, document } = await workspace(async () => response(rates));
  const raw = syntheticAggregate(); raw.accountTotals.accountTotalUsedMargin = 1e12;
  raw.instrumentAggregates[0].totalMarginAccountCurrency = 1e12;
  raw.instrumentAggregates[0].netCurrentExposureAccountCurrency = 1e12;
  const source = dto({ aggregate: raw }); api.renderProviderPortfolio(source); await api.refreshFx(); api.selectDisplayCurrency("AUD");
  const cell = document.getElementById("portfolio-table-body").children[0].children[1];
  const exposure = document.getElementById("portfolio-selected-exposure");
  for (const node of [cell, exposure]) {
    assert.equal(node.textContent, "—");
    assert.match(node.attributes["aria-label"], /unavailable.*outside the supported display range.*account currency/);
    assert.doesNotMatch(node.attributes["aria-label"], /reference rates.*unavailable|could not be validated/);
    assert.match(node.attributes.title, /supported display range/);
  }
  assert.match(document.getElementById("portfolio-fx-basis").textContent, /FX current/);
  assert.doesNotMatch(document.getElementById("workspace-banner-detail").textContent, /FX is unavailable/);
  api.selectDisplayCurrency("USD");
  assert.equal(cell.textContent, "$1,000,000,000,000.00");
  assert.equal(exposure.textContent, "$1,000,000,000,000.00");
  assert.equal(source.data.instruments[0].investedValue, 1e12);
  assert.equal(source.data.instruments[0].currentExposure, 1e12);
});

test("publication ageing invalidates conversions without polling and preserves Friday rates over the weekend and TARGET holidays", async () => {
  let calls = 0; const { api, document, clock } = await workspace(async () => { calls++; return response(snapshot()); });
  api.renderProviderPortfolio(dto()); await api.refreshFx(); api.selectDisplayCurrency("AUD");
  api.applyFxFreshness(); assert.equal(document.getElementById("exposure").textContent, "AUD 160.00");
  clock.now = Date.parse("2026-10-05T15:00:00.000Z"); api.applyFxFreshness();
  assert.equal(document.getElementById("exposure").textContent, "Unavailable (FX)"); assert.equal(calls, 1);
  for (const instant of ["2026-10-04T14:00:00Z", "2026-10-05T14:29:00Z", "2026-10-05T14:30:00Z", "2026-04-03T17:00:00Z", "2026-04-06T17:00:00Z", "2027-01-01T17:00:00Z"]) assert.equal(api.fxPublicationDate(Date.parse(instant)), expectedRateDate(Date.parse(instant)));
});

test("FX pending calls coalesce and late completion uses the latest currency and selected profile without restoring old account rows", async () => {
  let complete, calls = 0; const pending = new Promise((resolve) => { complete = resolve; });
  const { api, document } = await workspace(async (url) => { if (url === "/api/fx/reference") { calls++; return pending; } throw new Error("Synthetic unavailable"); });
  api.renderProviderPortfolio(dto()); const first = api.refreshFx(), second = api.refreshFx();
  api.selectDisplayCurrency("AUD"); api.clearPortfolioBoundState(); api.renderProviderPortfolio(dto({ environment: "demo", aggregate: syntheticAggregate({ accountTotals: { accountAvailableCash: 50, accountTotalUsedMargin: 0, accountCurrentPnl: 0, accountTotalValue: 50, accountBalance: 50, accountFrozenCash: 0 } }) }));
  api.selectDisplayCurrency("EUR"); complete(response(snapshot())); await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(document.getElementById("mock-equity").textContent, "EUR 40.00");
  assert.match(document.getElementById("portfolio-stat-source").textContent, /Demo snapshot/);
});

test("independent fields and account missing reasons stay visible when breakdown, P/L or current rate are absent", async () => {
  const { api, document } = await workspace(); const raw = syntheticAggregate(); delete raw.instrumentAggregates[0].accountCurrencyReturn;
  api.renderProviderPortfolio(dto({ aggregate: raw, breakdown: null }));
  assert.equal(document.getElementById("portfolio-table-body").children[0].children[1].textContent, "$100.00");
  assert.equal(document.getElementById("portfolio-selected-units").textContent, "1");
  assert.equal(document.getElementById("portfolio-selected-opening").textContent, "100 USD");
  assert.equal(document.getElementById("portfolio-selected-positions").textContent, "—");
  assert.match(document.getElementById("portfolio-selected-positions").attributes["aria-label"], /unavailable.*Matching position details/);
  assert.match(document.getElementById("portfolio-field-reasons").children.map((node) => node.textContent).join(" "), /P\/L:.*Native current price:/);
  assert.match(document.getElementById("portfolio-account-reasons").children.map((node) => node.textContent).join(" "), /Realized P\/L:/);
});

test("scope identity and local 25-row pagination preserve focus and selection on currency changes", async () => {
  const { api, document } = await workspace(); const base = syntheticAggregate(), template = base.instrumentAggregates[0];
  base.instrumentAggregates = Array.from({ length: 128 }, (_, n) => ({ ...template, instrumentId: n + 1 }));
  base.mirrors = [{ mirrorId: 1, mirrorAvailableCash: 0, instrumentAggregates: [{ ...template, instrumentId: 1 }] }];
  const metadata = Array.from({ length: 128 }, (_, n) => ({ instrumentId: n + 1, symbol: `S${String(n + 1).padStart(3, "0")}`, displayName: `Synthetic ${n + 1}` }));
  api.renderProviderPortfolio(dto({ aggregate: base, breakdown: null, metadata }));
  assert.equal(document.getElementById("portfolio-table-body").children.filter((row) => !row.hidden).length, 25);
  assert.equal(api.selected(), "direct:S001"); api.review.portfolio.page = 5; api.applyTableReview("portfolio", { refreshSelection: false });
  const selected = api.selected(); const row = document.getElementById("portfolio-table-body").children.find((row) => row.dataset.rowKey === selected); row.focus();
  api.selectDisplayCurrency("USD"); assert.equal(api.selected(), selected); assert.equal(api.review.portfolio.page, 5); assert.equal(document.activeElement, row);
  api.review.portfolio.page = 6; api.applyTableReview("portfolio", { refreshSelection: false }); assert.equal(document.getElementById("portfolio-table-body").children.filter((row) => !row.hidden).length, 4);
  assert.match(document.getElementById("portfolio-page-status").textContent, /Page 6 of 6/);
});

test("strict browser DTO rejects extra position identifiers, malformed rates and string financial values", async () => {
  const { api } = await workspace(); const valid = dto(); api.normalizeLivePortfolioPayload(valid);
  for (const mutate of [(v) => { v.data.instruments[0].positions[0].positionId = 1; }, (v) => { v.data.usedMargin = "100"; }, (v) => { v.data.instruments[0].netContracts = Infinity; }, (v) => { v.data.instruments[0].fieldSources.currentPrice = 123; }]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => api.normalizeLivePortfolioPayload(bad), /unavailable/); }
  for (const mutate of [(v) => { v.data.rates.USD = "1.2"; }, (v) => { v.data.rates.EUR = 2; }, (v) => { v.data.rateDate = "2026-02-30"; }, (v) => { v.data.rates.AUD = 0; }, (v) => { v.data.basis = "EUR-per-unit"; }]) { const bad = snapshot(); mutate(bad); assert.throws(() => api.normalizeFxPayload(bad), /unavailable/); }
});

test("all independent account cash fields are rendered and converted with the shared FX snapshot", async () => {
  const { api, document } = await workspace(async () => response(snapshot()));
  const aggregate = syntheticAggregate({ accountTotals: { accountAvailableCash: 900, accountFrozenCash: 10, accountCurrentPnl: 10, accountTotalValue: 1010, accountTotalUsedMargin: 100, accountBalance: 910 }, mirrors: [{ mirrorId: 1, mirrorAvailableCash: 7 }] });
  api.renderProviderPortfolio(dto({ aggregate })); await api.refreshFx(); api.selectDisplayCurrency("AUD");
  assert.equal(document.getElementById("portfolio-stat-balance").textContent, "AUD 1,456.00");
  assert.equal(document.getElementById("portfolio-stat-frozen").textContent, "AUD 16.00");
  assert.equal(document.getElementById("portfolio-stat-mirror").textContent, "AUD 11.20");
  assert.match(document.getElementById("portfolio-source-detail").textContent, /copy coverage incomplete/);
  api.clearPortfolioBoundState(); assert.equal(document.getElementById("portfolio-stat-balance").textContent, "Unavailable");
});

test("default currency follows the documented account for either FX/account arrival order and explicit preferences survive profile changes", async () => {
  for (const fxFirst of [true, false]) {
    const { api, document } = await workspace(async () => response(snapshot()));
    if (fxFirst) { await api.refreshFx(); assert.equal(document.getElementById("portfolio-display-currency").value, ""); }
    const aggregate = syntheticAggregate({ accountCurrency: "AUD" });
    api.renderProviderPortfolio(dto({ aggregate, breakdown: null }));
    if (!fxFirst) await api.refreshFx();
    assert.equal(document.getElementById("portfolio-display-currency").value, "AUD"); assert.equal(document.getElementById("mock-equity").textContent, "AUD 1,010.00");
    api.selectDisplayCurrency("USD"); assert.equal(document.getElementById("mock-equity").textContent, "$631.25");
    api.clearPortfolioBoundState(); api.renderProviderPortfolio(dto({ aggregate: syntheticAggregate({ accountCurrency: "NZD" }), breakdown: null, environment: "demo" }));
    assert.equal(document.getElementById("portfolio-display-currency").value, "USD");
    assert.match(document.getElementById("portfolio-fx-basis").textContent, /Account NZD · Display USD/);
  }
});

test("currency and FX rerenders preserve synchronous expired and failed-refresh freshness", async () => {
  const { api, document, clock } = await workspace(async () => response(snapshot()));
  api.renderProviderPortfolio(dto()); await api.refreshFx(); api.selectDisplayCurrency("AUD");
  assert.match(document.getElementById("portfolio-stat-source").textContent, /expired/);
  api.renderPortfolioReadFailure({ status: 503 }, { retainLastGood: true });
  api.selectDisplayCurrency("EUR"); assert.match(document.getElementById("portfolio-stat-source").textContent, /stale/);
  await api.refreshFx(); assert.match(document.getElementById("portfolio-stat-source").textContent, /stale/);
  clock.now = Date.parse("2026-10-05T14:10:00Z");
});

test("a fresh current-day publication remains accepted during the ECB publication grace window", async () => {
  const body = snapshot(); body.data.rateDate = "2026-10-05"; body.data.receivedAt = "2026-10-05T14:05:00.000Z";
  const { api, document, clock } = await workspace(async () => response(body)); clock.now = Date.parse("2026-10-05T14:10:00Z");
  api.renderProviderPortfolio(dto()); await api.refreshFx(); api.selectDisplayCurrency("AUD");
  assert.equal(document.getElementById("exposure").textContent, "AUD 160.00");
});

test("refresh restores scoped copy selection and keyboard focus when direct and copy share a symbol", async () => {
  const { api, document } = await workspace();
  const aggregate = syntheticAggregate({ mirrors: [{ mirrorId: 1, mirrorAvailableCash: 0, instrumentAggregates: syntheticAggregate().instrumentAggregates }] });
  const payload = dto({ aggregate, breakdown: null }); api.renderProviderPortfolio(payload);
  const copy = document.getElementById("portfolio-table-body").children.find((row) => row.dataset.rowKey === "copy:AAA");
  api.selectPortfolioInstrument(copy); copy.focus();
  api.renderProviderPortfolio(payload);
  assert.equal(api.selected(), "copy:AAA"); assert.equal(document.activeElement.dataset.rowKey, "copy:AAA"); assert.notEqual(document.activeElement, copy);
});

test("source clock, metadata and position-count gaps have precise disclosures; unknown denomination stays explicit", async () => {
  const { api, document } = await workspace();
  const raw = syntheticAggregate({ timestamp: "2026-10-02T12:00:00" }); raw.instrumentAggregates[0].assetCurrency = null;
  const breakdown = syntheticBreakdown(); breakdown.instruments[0].positions[0].assetCurrency = null;
  api.renderProviderPortfolio(dto({ aggregate: raw, breakdown }));
  assert.equal(document.getElementById("portfolio-selected-price").textContent, "110 · denomination unverified");
  assert.match(document.getElementById("portfolio-field-reasons").children.map((node) => node.textContent).join(" "), /Native current price: The currency for this value could not be verified/);
  assert.match(document.getElementById("portfolio-account-reasons").children.map((node) => node.textContent).join(" "), /Aggregate source time: The source time could not be verified/);
  assert.match(document.getElementById("portfolio-technical-reasons").children.map((node) => node.textContent).join(" "), /timezone.*Native price denomination is unverified/);
  api.renderProviderPortfolio(dto({ breakdown: null }));
  assert.match(document.getElementById("portfolio-field-reasons").children.map((node) => node.textContent).join(" "), /Position count: Matching position details were not available/);
  assert.match(document.getElementById("portfolio-technical-reasons").children.map((node) => node.textContent).join(" "), /PositionCount: Instrument breakdown unavailable/);
});

test("legitimate UNKNOWN-prefixed symbols remain usable while reason-marked placeholders disable market lookup", async () => {
  const { api, document } = await workspace(); const aggregate = syntheticAggregate(); aggregate.instrumentAggregates.push({ ...aggregate.instrumentAggregates[0], instrumentId: 2 });
  api.renderProviderPortfolio(dto({ aggregate, breakdown: null, metadata: [{ instrumentId: 1, symbol: "UNKNOWN.1", displayName: "Synthetic legitimate symbol" }] }));
  assert.match(document.getElementById("portfolio-selected-title").textContent, /^UNKNOWN\.1/);
  const unresolved = document.getElementById("portfolio-table-body").children.find((row) => row.dataset.symbol === "UNKNOWN.2");
  api.selectPortfolioInstrument(unresolved); assert.equal(document.getElementById("chart-title").textContent, "Unresolved instrument");
});

test("copy aggregate incompleteness is labelled as rows and retained source captions include partial coverage", async () => {
  const { api, document, clock } = await workspace(); clock.now = Date.parse("2026-10-02T16:00:05Z");
  const aggregate = syntheticAggregate({ mirrors: [{ mirrorId: 1, mirrorAvailableCash: 0, instrumentAggregates: [{ ...syntheticAggregate().instrumentAggregates[0], accountCurrencyReturn: null, liquidationValueAccountCurrency: null }] }] });
  api.renderProviderPortfolio(dto({ aggregate, breakdown: null }));
  assert.match(document.getElementById("portfolio-partial").textContent, /1 incomplete aggregate rows/);
  assert.doesNotMatch(document.getElementById("portfolio-partial").textContent, /incomplete direct positions/);
  assert.match(document.getElementById("portfolio-stat-source").textContent, /provider normalized · partial/);
});
