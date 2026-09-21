import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class FakeClassList {
  constructor(element) { this.element = element; }
  add(...names) {
    const values = new Set(this.element.className.split(/\s+/).filter(Boolean));
    names.forEach((name) => values.add(name));
    this.element.className = [...values].join(" ");
  }
  remove(...names) {
    const removed = new Set(names);
    this.element.className = this.element.className.split(/\s+/).filter((name) => name && !removed.has(name)).join(" ");
  }
  toggle(name, force) {
    const active = force ?? !this.element.className.split(/\s+/).includes(name);
    if (active) this.add(name); else this.remove(name);
    return active;
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.tabIndex = -1;
  }
  append(...children) { this.children.push(...children); }
  prepend(child) { child.parentNode = this; this.children.unshift(child); }
  replaceChildren(...children) { this.children = [...children]; }
  remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) {
    const values = this.listeners.get(name) ?? [];
    values.push(listener);
    this.listeners.set(name, values);
  }
  dispatch(name, event = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return descendants;
    if (selector === "[data-watchlist-row]") return descendants.filter((child) => Object.hasOwn(child.dataset, "watchlistRow"));
    if (selector === "[data-watchlist-period-value]") return descendants.filter((child) => Object.hasOwn(child.dataset, "watchlistPeriodValue"));
    if (selector === "strong" || selector === "small") return descendants.filter((child) => child.tagName === selector.toUpperCase());
    return [];
  }
}

class FakeDocument {
  constructor() { this.elements = new Map(); }
  createElement(tagName) { return new FakeElement(tagName); }
  getElementById(id) {
    if (!this.elements.has(id)) {
      const node = new FakeElement();
      if (["provider-status", "last-sync"].includes(id)) node.append(new FakeElement("strong"), new FakeElement("small"));
      if (id === "portfolio-environment") node.options = [];
      this.elements.set(id, node);
    }
    return this.elements.get(id);
  }
  querySelector() { return null; }
  querySelectorAll(selector) {
    if (selector === "[data-watchlist-row]") return this.getElementById("watchlist-table-body").querySelectorAll(selector);
    if (selector === "[data-watchlist-period]") return [];
    return [];
  }
}

async function watchlistRenderer(document) {
  const fixtureSource = await readFile(new URL("../src/browser-fixtures.js", import.meta.url), "utf8");
  const contractSource = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = appSource.slice(0, appSource.indexOf("function renderFixtureWatermark"));
  return Function("document", `${fixtureSource}\n${contractSource}\n${source}; return {
    normalizeWatchlistViewPayload,
    normalizeMarketChartPayload,
    renderProviderWatchlist,
    renderMarketChart,
    renderWatchlistReadFailure
  };`)(document);
}

function cache() {
  return {
    state: "hit",
    cachedAt: "2026-07-12T01:00:00.000Z",
    expiresAt: "2026-07-12T01:00:15.000Z",
    ttlMs: 15_000,
  };
}

function watchlistPayload() {
  return {
    ok: true,
    mode: "read-only",
    data: {
      source: "provider-default-watchlist",
      itemCount: 2,
      omittedItemCount: 1,
      unavailableRateCount: 1,
      providerState: "partial",
      partialFailure: { component: "rates", state: "unavailable" },
      items: [
        {
          symbol: "AAPL",
          displayName: "Apple Inc.",
          rank: 1,
          bid: 190,
          ask: 191,
          lastExecution: 190.5,
          rateUpdatedAt: "2026-07-12T01:00:00.000Z",
          rateStatus: "available",
        },
        {
          symbol: "GLD",
          displayName: "SPDR Gold Shares",
          rank: 2,
          bid: null,
          ask: null,
          lastExecution: null,
          rateUpdatedAt: null,
          rateStatus: "unavailable",
        },
      ],
    },
    cache: cache(),
    provider: { requestId: "must-not-render", privateId: "must-not-render" },
  };
}

function renderedText(element) {
  return [element.textContent, ...element.children.flatMap(renderedText)].join(" ");
}

test("provider watchlist renders dynamic read-only rows and explicit partial state", async () => {
  const document = new FakeDocument();
  const { renderProviderWatchlist } = await watchlistRenderer(document);
  const view = renderProviderWatchlist(watchlistPayload(), { refreshChart: false });
  const rows = document.querySelectorAll("[data-watchlist-row]");

  assert.equal(view.items.length, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector("strong").textContent, "AAPL");
  assert.equal(rows[0].children[2].textContent, "$190.50");
  assert.equal(rows[1].children[2].textContent, "Unavailable");
  assert.equal(document.getElementById("watchlist-provider-state").textContent, "Provider partial");
  assert.match(renderedText(document.getElementById("research-audit-list")), /1 omitted; 1 rates unavailable/);
  assert.equal([...document.elements.values()].map(renderedText).join(" ").includes("must-not-render"), false);

  rows[1].dispatch("click");
  assert.match(rows[1].className, /active/);
});

test("selected-period market chart renders normalized close points without identifiers", async () => {
  const document = new FakeDocument();
  const { renderProviderWatchlist, renderMarketChart } = await watchlistRenderer(document);
  renderProviderWatchlist(watchlistPayload(), { refreshChart: false });
  const chart = renderMarketChart({
    ok: true,
    mode: "read-only",
    data: {
      symbol: "AAPL",
      displayName: "Apple Inc.",
      resolution: "exact",
      period: "1w",
      interval: "FourHours",
      pointCount: 3,
      changePercent: 5,
      providerUpdatedAt: "2026-07-12T01:00:00.000Z",
      points: [
        { at: "2026-07-11T00:00:00.000Z", close: 100 },
        { at: "2026-07-11T12:00:00.000Z", close: 102 },
        { at: "2026-07-12T01:00:00.000Z", close: 105 },
      ],
    },
    cache: cache(),
    provider: { requestId: "hidden-request" },
  }, "AAPL", "1w");

  assert.equal(chart.resolution, "exact");
  assert.match(document.getElementById("watchlist-performance-line").attributes.points, /^0\.00,240\.00/);
  assert.match(document.getElementById("watchlist-chart-period-label").textContent, /FourHours · 3 points/);
  assert.equal(document.getElementById("watchlist-selected-period-pill").textContent, "1w");
  assert.equal(document.querySelectorAll("[data-watchlist-row]")[0].children[3].textContent, "+5.00%");
  assert.equal([...document.elements.values()].map(renderedText).join(" ").includes("hidden-request"), false);
});

test("watchlist and market DTOs reject identifier-shaped or mismatched data", async () => {
  const document = new FakeDocument();
  const { normalizeWatchlistViewPayload, normalizeMarketChartPayload } = await watchlistRenderer(document);
  const poisoned = watchlistPayload();
  poisoned.data.items[0].instrumentId = 101;
  assert.throws(() => normalizeWatchlistViewPayload(poisoned), /unavailable/);

  const crossedRate = watchlistPayload();
  crossedRate.data.items[0].bid = 192;
  crossedRate.data.items[0].ask = 191;
  assert.throws(() => normalizeWatchlistViewPayload(crossedRate), /unavailable/);

  assert.throws(() => normalizeMarketChartPayload({
    data: {
      symbol: "GLD",
      displayName: "Gold",
      resolution: "exact",
      period: "1w",
      interval: "FourHours",
      pointCount: 1,
      changePercent: 0,
      providerUpdatedAt: "2026-07-12T01:00:00.000Z",
      points: [{ at: "2026-07-12T01:00:00.000Z", close: 1 }],
    },
    cache: cache(),
  }, "AAPL", "1w"), /unavailable/);

  assert.throws(() => normalizeMarketChartPayload({
    data: {
      symbol: "AAPL",
      displayName: "Apple",
      resolution: "exact",
      period: "1w",
      interval: "OneMinute",
      pointCount: 1,
      changePercent: 99,
      providerUpdatedAt: "2026-07-12T01:00:00.000Z",
      points: [{ at: "2026-07-12T01:00:00.000Z", close: 1 }],
    },
    cache: cache(),
  }, "AAPL", "1w"), /unavailable/);
});

async function workspace(document, fetch) {
  const contracts = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = app.slice(0, app.indexOf('document.getElementById("refresh-etoro")?.addEventListener'));
  return Function("document", "fetch", `${contracts}\n${source}; return {
    selectEnvironment, refreshResearchStatus, renderProviderWatchlist, renderPortfolioStatistics,
    renderSelectedPortfolioInstrument, renderWatchlistReadFailure,
    setEnvironment: value => { selectedPortfolioEnvironment = value; },
    selectWatchlist: value => { selectedWatchlistSymbol = value; },
    selectPortfolio: value => { selectedPortfolioSymbol = value; portfolioDataSource = "provider-normalized"; },
    refreshSelectedWatchlistMarket,
  };`)(document, fetch);
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function response(payload) { return { ok: true, json: async () => payload }; }
function chartPayload(environment, symbol = "AAPL") {
  return { ok: true, mode: "read-only", environment, cache: cache(), data: {
    symbol, displayName: "Synthetic test instrument", resolution: "exact", period: "24h", interval: "OneHour", pointCount: 2,
    changePercent: 5, providerUpdatedAt: "2026-07-12T01:00:00.000Z",
    points: [{ at: "2026-07-12T00:00:00.000Z", close: 100 }, { at: "2026-07-12T01:00:00.000Z", close: 105 }],
  } };
}

test("stale watchlist chart labels the retained history and its selected-period percentage", async () => {
  const document = new FakeDocument();
  const { renderProviderWatchlist, renderMarketChart, renderWatchlistReadFailure } = await watchlistRenderer(document);
  renderProviderWatchlist(watchlistPayload(), { refreshChart: false });
  const staleChart = chartPayload(null); delete staleChart.environment;
  staleChart.cache.state = "stale";
  renderMarketChart(staleChart, "AAPL", "24h");
  assert.match(document.getElementById("watchlist-chart-source").textContent, /provider stale/);
  assert.match(document.getElementById("watchlist-chart-freshness").textContent, /Stale history/);
  assert.match(document.getElementById("watchlist-chart-shell").attributes["aria-label"], /stale provider/);
  assert.equal(document.querySelectorAll("[data-watchlist-row]")[0].children[3].textContent, "+5.00% (stale)");
  renderWatchlistReadFailure({ status: 503 });
  assert.equal(document.querySelectorAll("[data-watchlist-row]")[0].children[3].textContent, "Unavailable");
  assert.equal(document.getElementById("watchlist-performance-line").attributes.points, "");
});

test("same-symbol chart refetch clears its old percentage while pending and exposes failed source state", async () => {
  for (const status of [401, 503]) {
    const document = new FakeDocument(); const pending = deferred(); let calls = 0;
    const api = await workspace(document, async () => ++calls === 1 ? response(chartPayload("real")) : pending.promise);
    api.setEnvironment("real");
    api.renderProviderWatchlist({ ...watchlistPayload(), environment: "real" }, { refreshChart: false });
    await api.refreshSelectedWatchlistMarket();
    const periodCell = document.querySelectorAll("[data-watchlist-row]")[0].children[3];
    assert.equal(periodCell.textContent, "+5.00%");
    assert.notEqual(document.getElementById("watchlist-performance-line").attributes.points, "");
    const refetch = api.refreshSelectedWatchlistMarket();
    assert.equal(periodCell.textContent, "Unavailable", "old percentage clears before the next response");
    pending.resolve({ ok: false, status, json: async () => ({ ok: false, error: { code: "ETORO_PROVIDER_ERROR", status } }) });
    await refetch;
    assert.equal(periodCell.textContent, "Unavailable");
    assert.equal(document.getElementById("watchlist-performance-line").attributes.points, "");
    assert.equal(document.getElementById("watchlist-chart-source").textContent, "Source: unavailable");
    assert.equal(document.getElementById("watchlist-chart-shell").attributes["aria-label"], "Market-price history unavailable");
    assert.match(document.getElementById("watchlist-chart-period-label").textContent, status === 401 ? /authentication rejected/ : /provider unavailable/);
    assert.equal(document.getElementById("watchlist-context-freshness").textContent, "Unavailable");
    assert.match(document.getElementById("watchlist-context-detail").textContent, /unavailable until a successful read/);
  }
});

test("obsolete same-symbol chart failure cannot replace a newer successful chart or percentage", async () => {
  const document = new FakeDocument(); const obsolete = deferred(); let calls = 0;
  const api = await workspace(document, async () => ++calls === 1 ? obsolete.promise : response(chartPayload("real")));
  api.setEnvironment("real");
  api.renderProviderWatchlist({ ...watchlistPayload(), environment: "real" }, { refreshChart: false });
  const previous = api.refreshSelectedWatchlistMarket();
  await api.refreshSelectedWatchlistMarket();
  obsolete.resolve({ ok: false, status: 503, json: async () => ({ ok: false, error: { code: "ETORO_PROVIDER_ERROR", status: 503 } }) });
  await previous;
  assert.equal(document.querySelectorAll("[data-watchlist-row]")[0].children[3].textContent, "+5.00%");
  assert.match(document.getElementById("watchlist-chart-source").textContent, /provider normalized/);
  assert.match(document.getElementById("watchlist-chart-shell").attributes["aria-label"], /normalized provider/);
  assert.notEqual(document.getElementById("watchlist-performance-line").attributes.points, "");
});

test("profile switch synchronously clears rows, chart metadata, audit and statistics and rejects delayed watchlist success", async () => {
  const document = new FakeDocument(); const pending = deferred(); const requests = [];
  const api = await workspace(document, async (url, options) => {
    requests.push({ url, signal: options?.signal });
    if (url.includes("watchlist/default")) return pending.promise;
    // Hold new-profile status reads, proving the reset does not wait for them.
    return new Promise(() => {});
  });
  api.setEnvironment("real");
  api.renderProviderWatchlist({ ...watchlistPayload(), environment: "real" }, { refreshChart: false });
  document.getElementById("portfolio-stat-realized").textContent = "$123.00";
  const read = api.refreshResearchStatus();
  api.selectEnvironment("demo");
  assert.equal(document.querySelectorAll("[data-watchlist-row]").length, 0);
  assert.match(document.getElementById("portfolio-stat-realized").textContent, /Unavailable/);
  assert.equal(document.getElementById("research-audit-list").children.length, 0);
  assert.equal(document.getElementById("watchlist-context-title").textContent, "Unavailable");
  assert.equal(document.getElementById("provider-status").querySelector("strong").textContent, "Checking Demo profile");
  assert.equal(requests[0].url, "/api/etoro/watchlist/default?environment=real");
  assert.equal(requests[0].signal.aborted, true);
  pending.resolve(response({ ...watchlistPayload(), environment: "real" }));
  await read;
  assert.equal(document.querySelectorAll("[data-watchlist-row]").length, 0);
});

test("delayed market responses cannot restore either chart after profile switch", async () => {
  for (const surface of ["watchlist", "portfolio"]) {
    const document = new FakeDocument(); const pending = deferred(); const requests = [];
    const api = await workspace(document, async (url, options) => {
      requests.push({ url, signal: options?.signal });
      return url.includes("market/chart") ? pending.promise : new Promise(() => {});
    });
    api.setEnvironment("real");
    if (surface === "watchlist") api.selectWatchlist("AAPL"); else api.selectPortfolio("AAPL");
    const read = surface === "watchlist" ? api.refreshSelectedWatchlistMarket() : api.renderSelectedPortfolioInstrument();
    api.selectEnvironment("demo");
    pending.resolve(response(chartPayload("real")));
    await read;
    assert.match(requests[0].url, /environment=real/);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(document.getElementById(surface === "watchlist" ? "watchlist-performance-line" : "performance-line").attributes.points, "");
  }
});

test("watchlist rejects wrong-profile payloads and retains only same-profile rows marked stale", async () => {
  const document = new FakeDocument();
  const api = await workspace(document, async () => { throw new Error("Network access denied in test"); });
  api.setEnvironment("real");
  assert.throws(() => api.renderProviderWatchlist({ ...watchlistPayload(), environment: "demo" }, { refreshChart: false }), /unavailable/);
  api.renderProviderWatchlist({ ...watchlistPayload(), environment: "real" }, { refreshChart: false });
  api.renderWatchlistReadFailure({ status: 401 });
  assert.match(document.getElementById("watchlist-provider-state").textContent, /stale.*authentication rejected/);
  assert.equal(document.querySelectorAll("[data-watchlist-row]").length, 2);
  api.setEnvironment("demo");
  api.renderWatchlistReadFailure({ status: 401 });
  assert.equal(document.querySelectorAll("[data-watchlist-row]").length, 0);
  assert.match(document.getElementById("watchlist-provider-state").textContent, /authentication rejected/);
});

test("initial live watchlist markup contains placeholders and no synthetic prices or chart", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const watchlist = html.slice(html.indexOf('id="watchlist-view"'));
  assert.doesNotMatch(watchlist, /data-watchlist-symbol|synthetic fixture|Nasdaq quote fixture|Fresh synthetic/);
  assert.match(watchlist, /id="watchlist-performance-line" points=""/);
  assert.match(watchlist, /id="watchlist-performance-area" d=""/);
});


test("watchlist failures distinguish authentication, configuration, rate limiting, malformed and unavailable states", async () => {
  const document = new FakeDocument();
  const api = await workspace(document, async () => { throw new Error("Network access denied in test"); });
  api.setEnvironment("demo");
  for (const [error, category] of [
    [{ status: 401 }, "authentication rejected"],
    [{ code: "ETORO_PROFILE_NOT_CONFIGURED" }, "not configured"],
    [{ status: 429 }, "provider rate-limited"],
    [new Error("Watchlist data is unavailable."), "provider response malformed"],
    [new SyntaxError("Invalid JSON"), "provider response malformed"],
    [{ status: 503 }, "provider unavailable"],
  ]) {
    api.renderWatchlistReadFailure(error);
    assert.equal(document.getElementById("watchlist-provider-state").textContent, `Watchlist: ${category}`);
    assert.equal(document.getElementById("watchlist-performance-line").attributes.points, "");
  }
});


test("omitted-only watchlist remains partial rather than claiming a truly empty watchlist", async () => {
  const document = new FakeDocument();
  const { renderProviderWatchlist } = await watchlistRenderer(document);
  const view = watchlistPayload();
  Object.assign(view.data, { items: [], itemCount: 0, omittedItemCount: 2, unavailableRateCount: 0, providerState: "partial", partialFailure: null });
  renderProviderWatchlist(view, { refreshChart: false });
  assert.equal(document.getElementById("watchlist-provider-state").textContent, "Provider partial");
  assert.match(renderedText(document.getElementById("watchlist-table-body")), /No displayable watchlist instruments/);
});
