import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class Element {
  constructor(tag = 'div', document) {
    this.tagName = tag; this.document = document; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.textContent = ''; this.className = ''; this.options = []; this.disabled = false; this.hidden = false;
    this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); }, remove: (...names) => { this.className = this.className.split(' ').filter((name) => !names.includes(name)).join(' '); }, toggle: (name, active) => { if (active) this.classList.add(name); else this.classList.remove(name); } };
  }
  append(...nodes) { this.children.push(...nodes); for (const node of nodes) node.parent = this; }
  prepend(node) { this.children.unshift(node); node.parent = this; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(event, listener) { this.listeners.set(event, listener); }
  focus() { this.document.activeElement = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); }
  get lastElementChild() { return this.children.at(-1); }
  querySelectorAll(selector) {
    const all = this.children.flatMap((node) => [node, ...node.querySelectorAll('*')]);
    if (selector === '*') return all;
    const key = { '[data-instrument-row]': 'instrumentRow', '[data-watchlist-row]': 'watchlistRow', '[data-period-value]': 'periodValue', '[data-watchlist-period-value]': 'watchlistPeriodValue' }[selector];
    return all.filter((node) => key ? Object.hasOwn(node.dataset, key) : node.tagName === selector);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
class Document {
  constructor() { this.nodes = new Map(); this.activeElement = null; }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) {
    if (!this.nodes.has(id)) {
      const node = this.createElement('div');
      if (['last-sync', 'provider-status'].includes(id)) node.append(this.createElement('strong'), this.createElement('small'));
      this.nodes.set(id, node);
    }
    return this.nodes.get(id);
  }
  querySelectorAll(selector) {
    if (selector === '[data-instrument-row]') return this.getElementById('portfolio-table-body').querySelectorAll(selector);
    if (selector === '[data-watchlist-row]') return this.getElementById('watchlist-table-body').querySelectorAll(selector);
    if (selector.startsWith('#bot-config-form')) return this.getElementById('bot-config-form').children;
    return [];
  }
  querySelector() { return null; }
}
const instant = '2026-10-03T00:00:00.000Z';
const cache = () => ({ state: 'miss', cachedAt: instant, expiresAt: '2026-10-03T00:00:15.000Z', ttlMs: 15000 });
function portfolio() {
  const row = (symbol, pnl, completeness = 'complete') => ({ symbol, displayName: `${symbol} test name`, positionCount: 1, units: 0.125, averageOpenPrice: .00012, currentPrice: .00013, investedValue: 100, netValue: 100 + pnl, unrealizedPnl: pnl, unrealizedPnlPercent: pnl, allocationPercent: 25, completeness });
  return { ok: true, mode: 'read-only', cache: cache(), data: { environment: 'real', currency: 'USD', equity: 400, availableCash: 0, totalInvested: 400, unrealizedPnl: 0, realizedPnl: -2, openPositionCount: 4, instrumentCount: 4, mirrorCount: 0, pendingOrderCount: 0, providerUpdatedAt: instant, omittedRowCount: 0, incompleteRowCount: 1, instruments: [row('ZZZ', 2), row('BBB', -2), row('AAA', -2), row('PART', 0, 'partial')] } };
}
function watchlist() {
  return { ok: true, environment: 'real', mode: 'read-only', cache: cache(), data: { source: 'provider-default-watchlist', itemCount: 2, omittedItemCount: 0, unavailableRateCount: 1, providerState: 'partial', partialFailure: null, items: [
    { symbol: 'ZZZ', displayName: 'Zeta', rank: 0, bid: 1e308, ask: 1.1e308, lastExecution: null, rateUpdatedAt: instant, rateStatus: 'available' },
    { symbol: 'AAA', displayName: 'Alpha', rank: 1, bid: null, ask: null, lastExecution: null, rateUpdatedAt: null, rateStatus: 'unavailable' },
  ] } };
}
function operations({ state = 'ready', operation = null, action, blocked = false } = {}) {
  return { ok: true, dtoVersion: 'dashboard-offline-operations.v1', adapterId: 'money-maker-3000', state, observedAt: instant, expiresAt: '2026-10-03T00:00:30.000Z', source: 'isolated-synthetic-engine', capabilities: { runOnce: !blocked, block: true, reenable: blocked }, runtime: { verified: true, producerCommit: 'c17248ce097c3ed03e1e262be972023f48e63636', manifestId: 'approved-slow-trend-fixture-diagnostics', fixture: 'SPY synthetic daily', strategyId: 'slow-trend-allocation', budgetUsd: 1000, botAllocationUsd: 1000, reservedUsd: 100, maxOrderUsd: 250 }, lease: { integrity: 'clean', workerState: blocked ? 'kill-switch-blocked' : 'available', completionCount: 0, killSwitchReason: blocked ? 'operator-stop' : null }, ledger: { integrity: 'missing', recordCount: 0, latestRecordedAt: null }, lastResult: null, operation, safety: { providerCalls: 'blocked', credentials: 'absent', accountData: 'absent', executionRoutes: 'absent', performanceClaims: 'synthetic-diagnostics-no-investment-profit-evidence', blockBehavior: 'fences-completion-does-not-terminate-process' }, ...(action ? { action } : {}) };
}
function response(payload, ok = true) { return { ok, status: ok ? 200 : 503, headers: { get: () => 'synthetic-local-csrf' }, json: async () => payload }; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; }
async function workspace(fetch = async () => response({ ok: false }, false)) {
  const document = new Document(); const clock = { now: Date.parse(instant) + 1000 };
  const contracts = await readFile(new URL('../src/browser-contracts.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const source = app.slice(0, app.indexOf('document.getElementById("refresh-etoro")?.addEventListener'));
  const api = Function('document', 'fetch', 'Date', `${contracts}\n${source}; selectedPortfolioEnvironment = 'real'; return {
    renderProviderPortfolio, renderProviderWatchlist, renderPortfolioReadFailure, renderWatchlistReadFailure, renderSelectedPortfolioInstrument,
    applyInvestmentFreshness, applyTableReview, marketChartSvgPoints, renderMarketChart, renderOfflineOperations,
    refreshOfflineOperations, operateOfflineDiagnostic, normalizeOfflineOperationsPayload, normalizeDraftBotConfig,
    freshnessState, refreshEtoro, clearPortfolioBoundState, clearWatchlistBoundState,
    review: tableReview, freshness: investmentFreshness,
    selection: () => ({ portfolio: selectedPortfolioSymbol, watchlist: selectedWatchlistSymbol }),
    token: () => { operationsMutationProtection = { csrfHeader: 'x-etoro-dashboard-csrf', csrfToken: 'synthetic-local-csrf' }; },
  };`)(document, fetch, class extends Date { static now() { return clock.now; } });
  return { document, api, clock };
}

test('snapshot clock ageing preserves original fetch time and marks KPI, statistics, rows and last-sync expired without polling', async () => {
  let calls = 0; const { api, document, clock } = await workspace(async () => { calls++; return response({ ok: false }, false); });
  const data = portfolio(); data.data.incompleteRowCount = 0;
  api.renderProviderPortfolio(data);
  assert.equal(document.getElementById('mock-equity').dataset.freshness, 'current');
  clock.now += 15000;
  const before = calls; api.applyInvestmentFreshness();
  assert.equal(calls, before);
  for (const id of ['mock-equity', 'portfolio-stat-cash', 'portfolio-table-body']) assert.equal(document.getElementById(id).dataset.freshness, 'expired');
  assert.match(document.getElementById('last-sync').querySelector('strong').textContent, /expired/);
  assert.match(document.getElementById('portfolio-freshness').textContent, /fetched 2026-10-03T00:00:00.000Z.*age 16s/);
  assert.equal(document.querySelectorAll('[data-instrument-row]')[0].dataset.freshness, 'expired');
});

test('pending and repeated failed retries keep retained snapshot age while Last sync loses current posture; recovery restores current', async () => {
  const { api, document, clock } = await workspace(); api.renderProviderPortfolio(portfolio());
  api.freshness.portfolio.pending = true; api.applyInvestmentFreshness();
  assert.equal(document.getElementById('mock-equity').dataset.freshness, 'pending');
  const failure = { payload: { error: { code: 'ETORO_TIMEOUT' }, cache: { state: 'backoff', cachedAt: instant, expiresAt: '2026-10-03T00:00:15.000Z', ttlMs: 15000, failureAt: '2026-10-03T00:00:20.000Z', retryAt: '2026-10-03T00:00:30.000Z', reason: 'ETORO_TIMEOUT' } } };
  for (const advance of [20000, 5000]) { clock.now += advance; api.renderPortfolioReadFailure(failure, { retainLastGood: true }); }
  assert.match(document.getElementById('portfolio-freshness').textContent, /stale.*fetched 2026-10-03T00:00:00.000Z.*age 26s/);
  assert.match(document.getElementById('last-sync').querySelector('strong').textContent, /stale/);
  assert.match(document.getElementById('portfolio-partial').textContent, /retry after 2026-10-03T00:00:30.000Z/);
  const recovered = portfolio(); recovered.cache.cachedAt = new Date(clock.now).toISOString(); recovered.cache.expiresAt = new Date(clock.now + 15000).toISOString();
  api.renderProviderPortfolio(recovered);
  assert.equal(document.getElementById('mock-equity').dataset.freshness, 'partial');
  assert.match(document.getElementById('portfolio-freshness').textContent, /age 0s/);
});

test('stable local sorting, search and coverage keep selection, visible coverage and keyboard focus consistent', async () => {
  const { api, document } = await workspace(); api.renderProviderPortfolio(portfolio());
  api.review.portfolio.sort = 'unrealizedPnl'; api.applyTableReview('portfolio', { refreshSelection: false });
  assert.deepEqual(document.querySelectorAll('[data-instrument-row]').map((row) => row.dataset.symbol), ['BBB', 'AAA', 'PART', 'ZZZ']);
  const focused = document.querySelectorAll('[data-instrument-row]')[1]; focused.focus();
  api.review.portfolio.search = 'AAA'; api.applyTableReview('portfolio');
  assert.deepEqual(api.selection(), { portfolio: 'AAA', watchlist: null });
  assert.equal(document.activeElement, focused);
  assert.match(document.getElementById('portfolio-review-count').textContent, /1 of 4 instruments shown · 1 with complete values/);
  api.review.portfolio.coverage = 'partial'; api.applyTableReview('portfolio');
  assert.equal(api.selection().portfolio, null);
  assert.equal(document.getElementById('performance-line').attributes.points, '');
  assert.match(document.getElementById('portfolio-review-count').textContent, /No instruments match/);
  assert.equal(focused.tabIndex, -1);
});

test('watchlist review filters rates, avoids midpoint overflow, and updates retained badges/sources on expiry and failure', async () => {
  const { api, document, clock } = await workspace(); api.renderProviderWatchlist(watchlist(), { refreshChart: false });
  assert.doesNotMatch(document.querySelectorAll('[data-watchlist-row]')[0].children[2].textContent, /Infinity|Unavailable/);
  api.review.watchlist.coverage = 'partial'; api.applyTableReview('watchlist', { refreshSelection: false });
  assert.equal(api.selection().watchlist, 'AAA');
  clock.now += 20000; api.applyInvestmentFreshness();
  const row = document.querySelectorAll('[data-watchlist-row]')[0];
  assert.match(row.children[4].children[0].textContent, /Expired/); assert.equal(row.children[5].textContent, 'Provider expired');
  api.renderWatchlistReadFailure({ status: 503 });
  assert.match(row.children[4].children[0].textContent, /Stale/); assert.equal(row.children[5].textContent, 'Provider stale');
});

test('irregular history uses timestamp spacing and accessible evidence identifies starts, range and unverified completion', async () => {
  const { api, document } = await workspace(); api.renderProviderWatchlist(watchlist(), { refreshChart: false });
  const points = [{ at: '2026-10-01T00:00:00.000Z', close: 100 }, { at: '2026-10-01T01:00:00.000Z', close: 100 }, { at: '2026-10-03T00:00:00.000Z', close: 105 }];
  assert.match(api.marketChartSvgPoints(points), /^0.00,240.00 13.33,240.00 640.00,20.00$/);
  api.renderMarketChart({ ok: true, environment: 'real', cache: cache(), data: { symbol: 'ZZZ', displayName: 'Zeta', resolution: 'exact', period: '1w', interval: 'FourHours', pointCount: 3, changePercent: 5, providerUpdatedAt: instant, points } }, 'ZZZ', '1w');
  assert.equal(document.getElementById('watchlist-chart-details-body').children.length, 3);
  assert.match(document.getElementById('watchlist-chart-coverage').textContent, /3 returned samples.*calendar coverage is not guaranteed.*completion/);
  assert.match(document.getElementById('watchlist-chart-time-axis').textContent, /UTC candle start/);
  assert.match(document.getElementById('watchlist-chart-shell').attributes['aria-label'], /completion unverified/);
});

test('typed exact bot DTO and draft contracts reject coerced budgets, extra keys, fabricated provenance and null diagnostic faults', async () => {
  const { api, document } = await workspace(); const valid = operations();
  api.normalizeOfflineOperationsPayload(valid);
  for (const mutate of [(v) => { v.runtime.budgetUsd = '1000'; }, (v) => { v.lease.completionCount = false; }, (v) => { v.capabilities.runOnce = 1; }, (v) => { v.runtime.producerCommit = 'wrong'; }, (v) => { v.rawPayload = {}; }, (v) => { v.ledger.recordCount = -1; }]) {
    const invalid = structuredClone(valid); mutate(invalid); assert.throws(() => api.normalizeOfflineOperationsPayload(invalid), /unavailable/);
  }
  valid.lastResult = { status: 'lease-blocked', startedAt: instant, diagnostics: null, vetoReasons: [] }; api.renderOfflineOperations(valid);
  assert.match(document.getElementById('operations-result').textContent, /diagnostics not run/);
  const draft = { runMode: 'backtest', strategyId: 'slow-trend-allocation', budgetUsd: 1000, allowedMarkets: ['US_EQUITIES'], allowedInstrumentClasses: ['ETF'], cadence: 'weekly', minimumEvaluationIntervalMinutes: 240, updatedAt: null };
  api.normalizeDraftBotConfig(draft);
  for (const value of ['1000', true, null]) assert.throws(() => api.normalizeDraftBotConfig({ ...draft, budgetUsd: value }), /unavailable/);
  assert.throws(() => api.normalizeDraftBotConfig({ ...draft, arbitrary: true }), /unavailable/);
});

test('initial verified runtime can run; stale and failed telemetry disable run/re-enable but retain block safety', async () => {
  const { api, document, clock } = await workspace(); api.token(); api.renderOfflineOperations(operations({ state: 'unavailable' }));
  assert.equal(document.getElementById('operations-run').disabled, false);
  clock.now += 30000; await api.refreshOfflineOperations();
  assert.match(document.getElementById('operations-state').textContent, /Stale/);
  assert.equal(document.getElementById('operations-run').disabled, true);
  assert.equal(document.getElementById('operations-reenable').disabled, true);
  assert.equal(document.getElementById('operations-block').disabled, false);
  assert.equal(document.getElementById('operations-result').dataset.freshness, 'stale');
});

test('block remains available during a run and obsolete run completion cannot undo fenced readback', async () => {
  const runResponse = deferred(); let runId;
  const { api, document } = await workspace(async (_url, options) => {
    const input = JSON.parse(options.body);
    if (input.action === 'run-once') { runId = input.operationId; return runResponse.promise; }
    return response(operations({ state: 'blocked', blocked: true, operation: { id: input.operationId, action: 'block', startedAt: instant, status: 'completed' }, action: { type: 'block', status: 'completed' } }));
  });
  api.token(); api.renderOfflineOperations(operations());
  const running = api.operateOfflineDiagnostic('run-once');
  assert.equal(document.getElementById('operations-run').disabled, true);
  assert.equal(document.getElementById('operations-block').disabled, false);
  await api.operateOfflineDiagnostic('block');
  runResponse.resolve(response(operations({ operation: { id: runId, action: 'run-once', startedAt: instant, status: 'completed' }, action: { type: 'run-once', status: 'completed' } })));
  await running;
  assert.match(document.getElementById('operations-lease').textContent, /Kill Switch Blocked/);
  assert.match(document.getElementById('operations-state').textContent, /Blocked/);
});

test('ambiguous run retries keep one identity while GET authoritative reconciliation controls success reporting', async () => {
  const requests = []; let lost = true;
  const { api, document } = await workspace(async (_url, options = {}) => {
    if (!options.body) return response(operations());
    const input = JSON.parse(options.body); requests.push(input);
    if (lost) { lost = false; throw new Error('lost synthetic transport'); }
    return response(operations({ operation: { id: input.operationId, action: 'run-once', startedAt: instant, status: 'already-completed' }, action: { type: 'run-once', status: 'already-completed' } }));
  });
  api.token(); api.renderOfflineOperations(operations());
  await api.operateOfflineDiagnostic('run-once');
  assert.match(document.getElementById('operations-action-status').textContent, /outcome requires reconciliation/);
  assert.equal(document.getElementById('operations-run').textContent, 'Retry the same diagnostic request');
  await api.operateOfflineDiagnostic('run-once');
  assert.equal(requests.length, 2); assert.equal(requests[0].operationId, requests[1].operationId);
  assert.match(document.getElementById('operations-identity').textContent, /original start 2026-10-03T00:00:00.000Z/);
  assert.match(document.getElementById('operations-action-status').textContent, /Already Completed/);
});


test('reload recovers pending diagnostic identity only for run-once, gates busy lease and never automatically executes', async () => {
  const identity = 'cf5a5205-2680-4bf9-a25a-b21fd44b9b5a'; let calls = 0; const requests = [];
  const { api, document } = await workspace(async (_url, options) => {
    calls++; const input = JSON.parse(options.body); requests.push(input);
    return response(operations({ operation: { id: input.operationId, action: 'run-once', startedAt: instant, status: 'already-completed' }, action: { type: 'run-once', status: 'already-completed' } }));
  });
  api.token(); const pending = operations({ operation: { id: identity, action: 'run-once', startedAt: instant, status: 'pending' } });
  pending.capabilities.runOnce = false; pending.lease.workerState = 'busy';
  api.renderOfflineOperations(pending); assert.equal(calls, 0); assert.equal(document.getElementById('operations-run').disabled, true);
  pending.capabilities.runOnce = true; pending.lease.workerState = 'available'; api.renderOfflineOperations(pending);
  assert.equal(document.getElementById('operations-run').disabled, false); assert.equal(document.getElementById('operations-run').textContent, 'Retry the same diagnostic request');
  await api.operateOfflineDiagnostic('run-once'); assert.equal(requests[0].operationId, identity);
  assert.match(document.getElementById('operations-identity').textContent, /original start 2026-10-03T00:00:00.000Z/);
  const other = await workspace(); other.api.token(); other.api.renderOfflineOperations(operations({ operation: { id: identity, action: 'block', startedAt: instant, status: 'pending' } }));
  assert.equal(other.document.getElementById('operations-run').disabled, true);
});


test('filtering away the selected instrument clears every history receipt and context for both tables', async () => {
  const chart = (symbol) => ({ ok: true, environment: 'real', cache: cache(), data: { symbol, displayName: `${symbol} selected test instrument`, resolution: 'exact', period: '24h', interval: 'OneHour', pointCount: 2, changePercent: 5, providerUpdatedAt: instant, points: [{ at: '2026-10-02T00:00:00.000Z', close: 100 }, { at: instant, close: 105 }] } });
  const { api, document } = await workspace(async (url) => response(chart(new URL(url, 'http://localhost').searchParams.get('symbol'))));
  api.renderProviderPortfolio(portfolio());
  await api.renderSelectedPortfolioInstrument();
  api.renderProviderWatchlist(watchlist(), { refreshChart: false });
  api.renderMarketChart(chart('ZZZ'), 'ZZZ', '24h');
  assert.match(document.getElementById('chart-provider').textContent, /Last candle start: 2026/);
  assert.equal(document.getElementById('portfolio-financial-title').textContent, 'Provider holding selected');
  assert.match(document.getElementById('watchlist-chart-source').textContent, /provider current.*5.00%/);
  for (const kind of ['portfolio', 'watchlist']) {
    const row = document.querySelectorAll(kind === 'portfolio' ? '[data-instrument-row]' : '[data-watchlist-row]')[0];
    row.focus();
    api.review[kind].search = 'NO-MATCH';
    api.applyTableReview(kind);
    assert.equal(api.selection()[kind], null);
    assert.equal(document.activeElement, document.getElementById(`${kind}-review-search`));
    assert.match(document.getElementById(`${kind}-review-count`).textContent, /No instruments match/);
    assert.equal(document.getElementById(`${kind}-chart-details-body`).children.length, 0);
    for (const suffix of ['price-axis', 'time-axis', 'coverage']) assert.equal(document.getElementById(`${kind}-chart-${suffix}`).textContent, 'Unavailable');
    const shell = document.getElementById(`${kind}-chart-shell`);
    assert.equal(shell.dataset.freshness, 'unavailable');
    assert.match(shell.attributes['aria-label'], /unavailable/);
  }
  api.applyInvestmentFreshness();
  assert.equal(document.getElementById('chart-provider').textContent, 'Candle start: unavailable');
  assert.equal(document.getElementById('chart-cache').textContent, 'Cache: unavailable');
  assert.equal(document.getElementById('performance-line').attributes.points, '');
  for (const prefix of ['portfolio-financial', 'portfolio-news', 'portfolio-insider']) {
    assert.equal(document.getElementById(`${prefix}-title`).textContent, 'Unavailable');
    assert.equal(document.getElementById(`${prefix}-detail`).textContent, 'No selected instrument context available');
  }
  assert.equal(document.getElementById('watchlist-chart-source').textContent, 'Source: unavailable');
  assert.equal(document.getElementById('watchlist-chart-freshness').textContent, 'Freshness: unavailable');
  assert.equal(document.getElementById('watchlist-context-title').textContent, 'Unavailable');
  assert.equal(document.getElementById('watchlist-context-source').textContent, 'No selected instrument');
  assert.equal(document.getElementById('watchlist-context-freshness').textContent, 'Unavailable');
  assert.equal(document.getElementById('watchlist-context-detail').textContent, 'No market context available');
  assert.equal(document.getElementById('watchlist-performance-line').attributes.points, '');
});
