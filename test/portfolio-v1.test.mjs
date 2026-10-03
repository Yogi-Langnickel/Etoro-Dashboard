import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { credentialsForEnvironment } from "../src/etoro-config.mjs";
import { fetchPortfolioSnapshot } from "../src/etoro-client.mjs";
import { normalizeAggregatePortfolio, normalizeInstrumentBreakdown, composePortfolioSnapshot } from "../src/portfolio-contract.mjs";
const at = "2026-10-02T12:00:00Z";
export const aggregateItem = (id = 1, patch = {}) => ({ instrumentId: id, assetCurrency: "USD", totalMarginAccountCurrency: 100, accountCurrencyReturn: -5, liquidationValueAccountCurrency: 95, netUnits: 0.125, netContracts: 0.125, netCurrentExposureAccountCurrency: 95, netAvgOpenRate: 0.00012345, ...patch });
export const aggregatePayload = (patch = {}) => ({ cid: 2, timestamp: at, accountCurrency: "USD", accountTotals: { accountAvailableCash: 20, accountFrozenCash: 10, accountCurrentPnl: -5, accountTotalValue: 115, accountTotalUsedMargin: 100, accountBalance: 30 }, instrumentAggregates: [aggregateItem()], mirrors: [], ...patch });
export const breakdownPayload = (patch = {}) => ({ accountCurrency: "USD", timestamp: "2026-10-02T12:00:02Z", instruments: [{ instrumentId: 1, symbol: "AAA", positions: [{ positionId: 1, instrumentId: 1, direction: "long", settlementType: "real", leverage: 1, assetCurrency: "USD", units: 0.125, contracts: 0.125, openRate: 0.00012345, currentRate: 0.00023456, rateTimestamp: at }], orders: [] }], mirrors: [], ...patch });
const metadata = [{ instrumentId: 1, symbol: "AAA", displayName: "Synthetic A" }];
const compose = (aggregate = aggregatePayload(), breakdown = breakdownPayload(), display = metadata) => composePortfolioSnapshot("real", normalizeAggregatePortfolio(aggregate), breakdown && normalizeInstrumentBreakdown(breakdown), display);
const browserContract = Function("globalThis", `${await readFile(new URL("../src/browser-contracts.js", import.meta.url), "utf8")}; return globalThis.EtoroBrowserContracts.normalizeLivePortfolioPayload;`)({});
function browserAccepts(data) {
  return browserContract({ ok: true, mode: "read-only", data, cache: { state: "hit", cachedAt: "2026-10-02T12:00:00.000Z", expiresAt: "2026-10-02T12:00:15.000Z", ttlMs: 15000 } });
}
const batchAggregate = () => normalizeAggregatePortfolio(aggregatePayload({ instrumentAggregates: Array.from({ length: 201 }, (_, i) => aggregateItem(i + 1)), mirrors: [{ mirrorId: 10, mirrorAvailableCash: 7 }] }));
function batchReader(onMetadata) {
  return async (endpoint, { params }) => {
    if (endpoint === "privateIdentity") return { data: { realCid: 2, demoCid: 2, scopes: ["etoro-public:trade.real:read", "etoro-public:trade.demo:read"] } };
    if (endpoint.endsWith("AggregatePortfolio")) return { data: batchAggregate() };
    if (endpoint.endsWith("InstrumentBreakdown")) return { data: normalizeInstrumentBreakdown(breakdownPayload()) };
    return onMetadata(params.instrumentIds);
  };
}
function generatedCredentials(environment, generation) {
  return credentialsForEnvironment({ baseUrl: "https://public-api.etoro.com", credentialGeneration: generation, credentialFileLoaded: true, profiles: { real: { configured: true }, demo: { configured: true } } }, environment);
}

test("metadata failures stay with requested IDs across auth, unavailable and successful empty batches", async () => {
  let batch = 0;
  const { data } = await fetchPortfolioSnapshot("real", { fetchEndpoint: batchReader(async () => {
    batch++;
    if (batch < 3) throw Object.assign(new Error("private synthetic provider error"), { status: batch === 1 ? 403 : 503 });
    return { data: { instruments: [] } };
  }) });
  assert.equal(batch, 3); assert.equal(data.coverage.metadataStatus, "authorization-degraded");
  assert.match(data.instruments[0].fieldReasons.symbol, /authorization/);
  assert.match(data.instruments[100].fieldReasons.symbol, /provider is unavailable/);
  assert.match(data.instruments[200].fieldReasons.symbol, /missing or globally ambiguous/);
  assert.equal(data.equity, 115); assert.equal(data.instruments[200].investedValue, 100);
  assert.doesNotMatch(JSON.stringify(data), /private synthetic|instrumentId|positionId|cid/);
  assert.equal(browserAccepts(data).equity, 115, "combined copy and metadata reasons must fit the browser contract");
});

test("successful resolved and ambiguous metadata retain their own meaning after another batch authorization failure", async () => {
  const { data } = await fetchPortfolioSnapshot("real", { fetchEndpoint: batchReader(async (ids) => {
    if (ids[0] === 1) throw Object.assign(new Error("private"), { status: 403 });
    return { data: { instruments: ids[0] === 101 ? [{ instrumentId: 101, symbol: "RESOLVED" }] : [{ instrumentId: 201, symbol: "ONE" }, { instrumentId: 201, symbol: "TWO" }] } };
  }) });
  assert.equal(data.coverage.metadataStatus, "authorization-degraded");
  assert.equal(data.instruments[100].symbol, "RESOLVED"); assert.equal(data.instruments[100].fieldReasons.symbol, undefined);
  assert.match(data.instruments[200].fieldReasons.symbol, /missing or globally ambiguous/);
  assert.equal(browserAccepts(data).instruments[100].investedValue, 100);
});

test("metadata 429 stops remaining batches and deadlines survive fresh credentials while separating environment and generation", async () => {
  let nowMs = 1000, metadataCalls = 0, rejectMetadata = true;
  const fetchEndpoint = batchReader(async (ids) => {
    metadataCalls++;
    if (rejectMetadata) throw Object.assign(new Error("private quota"), { status: 429, retryAfterMs: 2000 });
    return { data: { instruments: ids.map((id) => ({ instrumentId: id, symbol: `S${id}` })) } };
  });
  const snapshot = (environment = "real", generation = "synthetic-quota-generation-A") => fetchPortfolioSnapshot(environment, { credentials: generatedCredentials(environment, generation), now: () => nowMs, fetchEndpoint });
  const first = (await snapshot()).data;
  assert.equal(metadataCalls, 1); assert.match(first.instruments[0].fieldReasons.symbol, /quota is rate-limited/);
  assert.match(first.instruments[100].fieldReasons.symbol, /not attempted after/);
  assert.equal(first.equity, 115); assert.equal(browserAccepts(first).instruments[200].investedValue, 100);
  nowMs = 2999; const repeated = (await snapshot()).data;
  assert.equal(metadataCalls, 1); assert.match(repeated.instruments[0].fieldReasons.symbol, /not attempted during.*backoff/);
  rejectMetadata = false;
  assert.equal((await snapshot("demo")).data.coverage.metadataStatus, "available"); assert.equal(metadataCalls, 4);
  assert.equal((await snapshot("real", "synthetic-quota-generation-B")).data.coverage.metadataStatus, "available"); assert.equal(metadataCalls, 7);
  nowMs = 3000; const recovered = (await snapshot()).data;
  assert.equal(metadataCalls, 10); assert.equal(recovered.coverage.metadataStatus, "available"); assert.equal(browserAccepts(recovered).equity, 115);
});

test("metadata quota deadlines use the existing five-second fallback and sixty-second maximum", async () => {
  for (const [retryAfterMs, delay] of [[null, 5000], [1e9, 60000]]) {
    let nowMs = 1000, calls = 0;
    const generation = `synthetic-quota-bound-${delay}`;
    const fetchEndpoint = batchReader(async () => { calls++; throw Object.assign(new Error("private quota"), { status: 429, retryAfterMs }); });
    const snapshot = () => fetchPortfolioSnapshot("real", { credentials: generatedCredentials("real", generation), now: () => nowMs, fetchEndpoint });
    await snapshot(); nowMs += delay - 1; await snapshot(); assert.equal(calls, 1);
    nowMs++; await snapshot(); assert.equal(calls, 2);
  }
});

test("documented aggregate and breakdown contracts retain independent field precision, signed P/L, separate times, and safe details", () => {
  const dto = compose();
  assert.equal(dto.currency, "USD"); assert.equal(dto.usedMargin, 100); assert.equal(dto.frozenCash, 10);
  assert.deepEqual(dto.arithmetic, { equity: "verified", cash: "verified" });
  const row = dto.instruments[0]; assert.equal(row.unrealizedPnl, -5); assert.equal(row.unrealizedPnlPercent, -5);
  assert.equal(row.averageOpenPrice, 0.00012345); assert.equal(row.currentPrice, 0.00023456); assert.equal(row.units, 0.125);
  assert.notEqual(dto.providerUpdatedAt, dto.breakdownUpdatedAt);
  assert.doesNotMatch(JSON.stringify(dto), /cid|instrumentId|positionId|orderId|stopLoss|takeProfit|request/);
});

test("malformed and missing values only remove their own fields; zero and negatives are valid", () => {
  const dto = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { accountCurrencyReturn: null, netUnits: 0, netContracts: -0.25, liquidationValueAccountCurrency: "95" })] }));
  const row = dto.instruments[0]; assert.equal(row.investedValue, 100); assert.equal(row.unrealizedPnl, null); assert.equal(row.netValue, null);
  assert.equal(row.units, 0); assert.equal(row.netContracts, -0.25); assert.equal(row.averageOpenPrice, null);
  assert.match(row.fieldReasons.netValue, /validation/); assert.match(row.fieldReasons.averageOpenPrice, /zero-net/);
  for (const value of ["0", NaN, Infinity, 1e13, true]) assert.equal(compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { totalMarginAccountCurrency: value })] })).instruments[0].investedValue, null);
  const zero = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { totalMarginAccountCurrency: 0, accountCurrencyReturn: 0 })] })).instruments[0];
  assert.equal(zero.unrealizedPnl, 0); assert.equal(zero.unrealizedPnlPercent, null); assert.match(zero.fieldReasons.unrealizedPnlPercent, /zero margin/);
});

test("direct, copy, mirror cash and pending order reserves remain distinct; copy opening averages are unavailable", () => {
  const dto = compose(aggregatePayload({ mirrors: [
    { mirrorId: 10, mirrorAvailableCash: 12, instrumentAggregates: [aggregateItem(1, { netUnits: 2 })] },
    { mirrorId: 11, mirrorAvailableCash: 8, instrumentAggregates: [aggregateItem(1, { netUnits: -1 })] },
  ] }));
  assert.deepEqual(dto.instruments.map((row) => row.scope), ["direct", "copy"]);
  assert.equal(dto.instruments[1].investedValue, 200); assert.equal(dto.instruments[1].units, 1); assert.equal(dto.instruments[1].averageOpenPrice, null);
  assert.equal(dto.mirrorCash, 20); assert.equal(dto.frozenCash, 10); assert.equal(dto.usedMargin, 100);
});

test("global duplicate/ambiguous metadata does not silently assign a symbol or remove known account values", () => {
  const dto = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1), aggregateItem(2), aggregateItem(3)] }), null, [
    { instrumentId: 1, symbol: "DUP" }, { instrumentId: 2, symbol: "DUP" }, { instrumentId: 3, symbol: "AAA" }, { instrumentId: 3, symbol: "BBB" },
  ]);
  assert.equal(dto.instruments.length, 3); assert.equal(dto.coverage.metadataUnresolvedCount, 3);
  for (const row of dto.instruments) { assert.match(row.symbol, /^UNKNOWN\./); assert.match(row.fieldReasons.symbol, /ambiguous/); assert.equal(row.investedValue, 100); }
});

test("500 unique instrument boundary keeps later rows and discloses larger unsupported snapshots", () => {
  const items = Array.from({ length: 501 }, (_, i) => aggregateItem(i + 1));
  const dto = compose(aggregatePayload({ instrumentAggregates: items }), null, items.map((item) => ({ instrumentId: item.instrumentId, symbol: `S${item.instrumentId}` })));
  assert.equal(dto.instruments.length, 500); assert.equal(dto.instruments.at(-1).symbol, "S500"); assert.equal(dto.coverage.unsupportedInstrumentCount, 1); assert.equal(dto.omittedRowCount, 1);
});

test("native prices require consistent evidenced native rates; mixed directions use provider net average and never naive averaging", () => {
  const raw = breakdownPayload(); raw.instruments[0].positions.push({ ...raw.instruments[0].positions[0], positionId: 2, direction: "short", currentRate: 0.0003 });
  const dto = compose(aggregatePayload(), raw); assert.equal(dto.instruments[0].currentPrice, null); assert.equal(dto.instruments[0].averageOpenPrice, 0.00012345);
  assert.equal(dto.instruments[0].positionCount, 2); assert.equal(dto.instruments[0].positions[1].direction, "short");
  assert.throws(() => normalizeInstrumentBreakdown({ ...raw, instruments: [...raw.instruments, raw.instruments[0]] }));
});

test("matching profile scope/context, private CID, batches, optional breakdown failure and unavailable metadata", async () => {
  const calls = [];
  const snapshot = await fetchPortfolioSnapshot("demo", { fetchEndpoint: async (endpoint, options) => {
    calls.push(endpoint);
    if (endpoint === "privateIdentity") return { data: { realCid: 1, demoCid: 2, scopes: ["etoro-public:trade.demo:read"] } };
    if (endpoint === "demoAggregatePortfolio") return { data: normalizeAggregatePortfolio(aggregatePayload({ instrumentAggregates: Array.from({ length: 201 }, (_, i) => aggregateItem(i + 1)) })) };
    if (endpoint === "demoInstrumentBreakdown") { assert.equal(options.params.cid, 2); throw Object.assign(new Error("private rejection"), { status: 403 }); }
    assert.equal(endpoint, "portfolioMetadata"); assert.ok(options.params.instrumentIds.length <= 100);
    return { data: { instruments: options.params.instrumentIds.map((id) => ({ instrumentId: id, symbol: `S${id}` })) } };
  } });
  assert.equal(calls.filter((name) => name === "portfolioMetadata").length, 3); assert.equal(snapshot.data.instruments.length, 201); assert.equal(snapshot.data.coverage.breakdownStatus, "unavailable");
  await assert.rejects(fetchPortfolioSnapshot("real", { fetchEndpoint: async () => ({ data: { scopes: ["etoro-public:trade.demo:read"] } }) }), (error) => error.code === "ETORO_SCOPE_MISSING");
});

test("same-snapshot liquidation derivation and independent breakdown quantity/currency fallbacks preserve source metadata", () => {
  const dto = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { liquidationValueAccountCurrency: null, assetCurrency: null, netUnits: null, netContracts: null, netAvgOpenRate: -0.00012345 })] }));
  const row = dto.instruments[0];
  assert.equal(row.netValue, 95); assert.equal(row.fieldSources.netValue, "derived.totalMarginAccountCurrency+accountCurrencyReturn");
  assert.equal(row.units, 0.125); assert.equal(row.netContracts, 0.125); assert.equal(row.assetCurrency, "USD");
  assert.equal(row.averageOpenPrice, -0.00012345); assert.match(row.fieldSources.units, /breakdown/); assert.match(row.fieldSources.assetCurrency, /breakdown/);
});

test("only the selected identity reference is required and optional detail reasons distinguish rejected scopes", async () => {
  const snapshot = await fetchPortfolioSnapshot("real", { fetchEndpoint: async (endpoint) => {
    if (endpoint === "privateIdentity") return { data: { realCid: 2, demoCid: null, scopes: ["etoro-public:trade.real:read"] } };
    if (endpoint === "realAggregatePortfolio") return { data: normalizeAggregatePortfolio(aggregatePayload()) };
    if (endpoint === "realInstrumentBreakdown") throw Object.assign(new Error("private rejection"), { status: 403 });
    return { data: { instruments: metadata } };
  } });
  assert.equal(snapshot.data.instruments[0].investedValue, 100);
  assert.match(snapshot.data.instruments[0].fieldReasons.currentPrice, /authorization was rejected/);
  assert.match(snapshot.data.fieldReasons.openPositionCount, /authorization was rejected/);
});

test("unknown source timezone only removes its clock, and omitted copy instruments remain unknown while mirror cash survives", () => {
  const dto = compose(aggregatePayload({ timestamp: "2026-10-02T12:00:00", mirrors: [{ mirrorId: 10, mirrorAvailableCash: 7 }] }), breakdownPayload({ timestamp: "2026-10-02T12:00:02" }));
  assert.equal(dto.equity, 115); assert.equal(dto.instruments[0].investedValue, 100);
  assert.equal(dto.providerUpdatedAt, null); assert.equal(dto.breakdownUpdatedAt, null);
  assert.match(dto.fieldReasons.providerUpdatedAt, /timezone/); assert.match(dto.fieldReasons.breakdownUpdatedAt, /timezone/);
  assert.equal(dto.mirrorCash, 7); assert.equal(dto.coverage.copyHoldingsStatus, "incomplete");
  const zero = compose(aggregatePayload({ mirrors: [{ mirrorId: 0, mirrorAvailableCash: 9, instrumentAggregates: [aggregateItem()] }] }));
  assert.equal(zero.instruments.length, 1); assert.equal(zero.coverage.copyInstrumentCount, 0); assert.equal(zero.coverage.manualHoldingsStatus, "incomplete");
});

test("Demo aggregate requires read scope, Real explicitly supports the alternative write scope, optional metadata auth failures retain values", async () => {
  let calls = 0;
  await assert.rejects(fetchPortfolioSnapshot("demo", { fetchEndpoint: async () => { calls++; return { data: { demoCid: 2, scopes: ["etoro-public:trade.demo:write"] } }; } }), (error) => error.code === "ETORO_SCOPE_MISSING");
  assert.equal(calls, 1);
  for (const status of [401, 403]) {
    const dto = await fetchPortfolioSnapshot("real", { fetchEndpoint: async (endpoint) => {
      if (endpoint === "privateIdentity") return { data: { realCid: 2, scopes: ["etoro-public:trade.real:write"] } };
      if (endpoint === "realAggregatePortfolio") return { data: normalizeAggregatePortfolio(aggregatePayload()) };
      if (endpoint === "portfolioMetadata") throw Object.assign(new Error("private auth"), { status });
      throw new Error("Write-only token must not attempt the read-only breakdown");
    } });
    assert.equal(dto.data.equity, 115); assert.equal(dto.data.instruments[0].investedValue, 100);
    assert.equal(dto.data.coverage.metadataStatus, "authorization-degraded"); assert.match(dto.data.instruments[0].fieldReasons.symbol, /authorization/);
  }
});

test("position detail limit preserves full counts, quantity fallback and consistency beyond the exported prefix", () => {
  const raw = breakdownPayload();
  raw.instruments[0].positions = Array.from({ length: 1001 }, (_, index) => ({ ...raw.instruments[0].positions[0], positionId: index + 1, units: 1, contracts: 1, currentRate: index === 1000 ? 2 : 1 }));
  const row = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { netUnits: null, netContracts: null })] }), raw).instruments[0];
  assert.equal(row.positions.length, 1000); assert.equal(row.positionsOmittedCount, 1); assert.equal(row.positionCount, 1001); assert.equal(row.units, 1001);
  assert.equal(row.currentPrice, null); assert.match(row.fieldReasons.positions, /all validated positions/);
});

test("futures use evidenced contract net basis; missing quantities do not erase independent provider opening rates", () => {
  const raw = breakdownPayload(); raw.instruments[0].positions[0].settlementType = "realFutures";
  const row = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { netUnits: 0, netContracts: 2 })] }), raw).instruments[0];
  assert.equal(row.averageOpenPrice, 0.00012345);
  const absent = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { netUnits: null, netContracts: null })] }), null).instruments[0];
  assert.equal(absent.averageOpenPrice, 0.00012345);
});

test("missing matching details have their own reason; native rates without denomination survive but conflicting supplied currencies do not", () => {
  const missing = compose(aggregatePayload(), breakdownPayload({ instruments: [] })).instruments[0];
  assert.match(missing.fieldReasons.positionCount, /No matching instrument/); assert.match(missing.fieldReasons.currentPrice, /No matching instrument/);
  const raw = breakdownPayload(); raw.instruments[0].positions[0].assetCurrency = null;
  const unknown = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1, { assetCurrency: null })] }), raw).instruments[0];
  assert.equal(unknown.currentPrice, 0.00023456); assert.equal(unknown.assetCurrency, null); assert.match(unknown.fieldReasons.currentPrice, /denomination is unverified/);
  raw.instruments[0].positions[0].assetCurrency = "EUR";
  const conflicting = compose(aggregatePayload(), raw).instruments[0]; assert.equal(conflicting.currentPrice, null); assert.equal(conflicting.assetCurrency, null);
});

test("unresolved placeholders cannot collide with legitimate resolved symbols", () => {
  const dto = compose(aggregatePayload({ instrumentAggregates: [aggregateItem(1), aggregateItem(2)] }), null, [{ instrumentId: 1, symbol: "UNKNOWN.1" }]);
  assert.deepEqual(dto.instruments.map((row) => row.symbol), ["UNKNOWN.1", "UNKNOWN.2"]);
  assert.equal(dto.instruments[0].fieldReasons.symbol, undefined); assert.match(dto.instruments[1].fieldReasons.symbol, /metadata/);
});
