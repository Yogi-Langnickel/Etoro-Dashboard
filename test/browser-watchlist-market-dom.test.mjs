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
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.children = [...children]; }
  remove() { this.removed = true; }
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
    if (selector === "strong") return descendants.filter((child) => child.tagName === "STRONG");
    return [];
  }
}

class FakeDocument {
  constructor() { this.elements = new Map(); }
  createElement(tagName) { return new FakeElement(tagName); }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement());
    return this.elements.get(id);
  }
  querySelectorAll(selector) {
    if (selector === "[data-watchlist-row]") return this.getElementById("watchlist-table-body").querySelectorAll(selector);
    if (selector === "[data-watchlist-period]") return [];
    return [];
  }
}

async function watchlistRenderer(document) {
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = appSource.slice(0, appSource.indexOf("function renderFixtureWatermark"));
  return Function("document", `${source}; return {
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
