import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  add(...names) {
    const classes = new Set(this.element.className.split(/\s+/).filter(Boolean));
    names.forEach((name) => classes.add(name));
    this.element.className = [...classes].join(" ");
  }

  remove(...names) {
    const removed = new Set(names);
    this.element.className = this.element.className
      .split(/\s+/)
      .filter((name) => name && !removed.has(name))
      .join(" ");
  }

  toggle(name, force) {
    const active = force ?? !this.element.className.split(/\s+/).includes(name);
    if (active) this.add(name);
    else this.remove(name);
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

  append(...children) {
    this.children.push(...children);
  }

  prepend(child) {
    this.children.unshift(child);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  remove() {
    this.removed = true;
  }

  get lastChild() {
    return this.children.at(-1) ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatch(name, event = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return descendants;
    if (selector === "[data-period-value]") {
      return descendants.filter((child) => Object.hasOwn(child.dataset, "periodValue"));
    }
    if (selector === "[data-instrument-row]") {
      return descendants.filter((child) => Object.hasOwn(child.dataset, "instrumentRow"));
    }
    if (selector === "strong" || selector === "small") {
      return descendants.filter((child) => child.tagName === selector.toUpperCase());
    }
    return [];
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.periodButtons = ["24h", "1w", "1m", "1y", "5y", "max"].map((period) => {
      const button = new FakeElement("button");
      button.dataset.period = period;
      return button;
    });
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement());
    return this.elements.get(id);
  }

  querySelectorAll(selector) {
    if (selector === "[data-period]") return this.periodButtons;
    if (selector === "[data-instrument-row]") {
      return this.getElementById("portfolio-table-body").querySelectorAll(selector);
    }
    return [];
  }
}

async function portfolioRenderer(document) {
  const fixtureSource = await readFile(new URL("../src/browser-fixtures.js", import.meta.url), "utf8");
  const contractSource = await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const source = appSource.slice(0, appSource.indexOf("function renderSelectedWatchlistInstrument"));
  return Function("document", `${fixtureSource}\n${contractSource}\n${source}; return { renderProviderPortfolio, renderPortfolioReadFailure, renderFulfilledProviderPortfolio };`)(document);
}

function renderedText(element) {
  return [element.textContent, ...element.children.flatMap((child) => renderedText(child))].join(" ");
}

function providerPayload(overrides = {}) {
  return {
    ok: true,
    mode: "read-only",
    data: {
      currency: "USD",
      positionCount: 3,
      instrumentCount: 2,
      omittedPositionCount: 1,
      incompleteValuePositionCount: 1,
      providerUpdatedAt: "2026-07-12T02:00:00.000Z",
      instruments: [
        { symbol: "AAPL", positionCount: 1, investedUsd: 1000, unrealizedPnlUsd: 125, valueStatus: "complete" },
        { symbol: "BTC", positionCount: 1, investedUsd: null, unrealizedPnlUsd: null, valueStatus: "incomplete" },
      ],
    },
    cache: {
      state: "hit",
      cachedAt: "2026-07-12T02:00:01.000Z",
      expiresAt: "2026-07-12T02:00:16.000Z",
      ttlMs: 15_000,
    },
    provider: { requestId: "must-not-render" },
    ...overrides,
  };
}

test("portfolio DOM renders strict provider states, interactions, and partial failure without metadata leakage", async () => {
  const document = new FakeDocument();
  const { renderProviderPortfolio, renderPortfolioReadFailure } = await portfolioRenderer(document);
  const payload = providerPayload();
  renderProviderPortfolio(payload);
  const rows = document.querySelectorAll("[data-instrument-row]");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].children[0].textContent, "AAPL");
  assert.equal(rows[0].children[2].textContent, "Unavailable");
  assert.equal(rows[1].children[8].textContent, "Unavailable");
  assert.equal(document.getElementById("portfolio-omitted").textContent, "Omitted rows: 1");
  assert.equal(document.getElementById("portfolio-partial").textContent, "Partial values: 1 position");
  assert.equal(document.getElementById("chart-request").textContent, "Provider request ID: hidden");
  assert.equal(document.getElementById("performance-line").attributes.points, "");

  rows[1].dispatch("click");
  assert.match(rows[1].className, /active/);
  let prevented = false;
  rows[0].dispatch("keydown", { key: "Enter", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(rows[0].className, /active/);

  renderPortfolioReadFailure({ payload: { cache: {
    state: "backoff",
    cachedAt: "2026-07-12T02:00:20.000Z",
    expiresAt: "2026-07-12T02:00:22.000Z",
    ttlMs: 2000,
    reason: "ETORO_PROVIDER_ERROR",
  } } });
  assert.equal(document.querySelectorAll("[data-instrument-row]").length, 2);
  assert.equal(document.getElementById("portfolio-read-state").textContent, "Portfolio: Backoff");
  assert.match(document.getElementById("portfolio-freshness").textContent, /retained/);
  const allRenderedText = [...document.elements.values()].map(renderedText).join(" ");
  assert.equal(allRenderedText.includes("must-not-render"), false);
});

test("malformed fulfilled portfolio retains rows without overwriting configured provider status", async () => {
  const document = new FakeDocument();
  const { renderProviderPortfolio, renderFulfilledProviderPortfolio } = await portfolioRenderer(document);
  renderProviderPortfolio(providerPayload());
  document.getElementById("provider-status").textContent = "Provider configured";

  const rendered = renderFulfilledProviderPortfolio(providerPayload({
    cache: {
      state: "hit",
      cachedAt: "2026-07-12T02:00:01.000Z",
      expiresAt: "2026-07-12T02:00:01.000Z",
      ttlMs: 0,
    },
  }));

  assert.equal(rendered, false);
  assert.equal(document.querySelectorAll("[data-instrument-row]").length, 2);
  assert.equal(document.getElementById("provider-status").textContent, "Provider configured");
  assert.match(document.getElementById("portfolio-freshness").textContent, /retained/);
  assert.match(renderedText(document.getElementById("audit-list")), /Partial provider read/);
});

test("portfolio failure cache metadata fails closed when malformed", async () => {
  const document = new FakeDocument();
  const { renderPortfolioReadFailure } = await portfolioRenderer(document);
  const adversarial = "<img src=x onerror=alert(1)>";
  renderPortfolioReadFailure({ payload: { cache: {
    state: adversarial,
    cachedAt: "not-a-time",
    expiresAt: "also-not-a-time",
    ttlMs: 0,
    reason: adversarial,
  } } });

  assert.equal(document.getElementById("portfolio-read-state").textContent, "Portfolio: unavailable");
  assert.equal(document.getElementById("portfolio-partial").textContent, "Provider read failed; retry window unavailable");
  assert.equal([...document.elements.values()].map(renderedText).join(" ").includes(adversarial), false);
});

test("all-incomplete portfolio DOM renders totals as unavailable", async () => {
  const document = new FakeDocument();
  const { renderProviderPortfolio } = await portfolioRenderer(document);
  renderProviderPortfolio(providerPayload({
    data: {
      currency: "USD",
      positionCount: 1,
      instrumentCount: 1,
      omittedPositionCount: 0,
      incompleteValuePositionCount: 1,
      providerUpdatedAt: null,
      instruments: [
        { symbol: "BTC", positionCount: 1, investedUsd: null, unrealizedPnlUsd: null, valueStatus: "incomplete" },
      ],
    },
  }));

  assert.equal(document.getElementById("mock-equity").textContent, "Unavailable");
  assert.equal(document.getElementById("unrealized-pnl").textContent, "Unavailable");
  assert.equal(document.getElementById("stale-data").textContent, "Unavailable");
});
