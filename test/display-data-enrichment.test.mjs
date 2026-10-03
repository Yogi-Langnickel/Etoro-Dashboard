import assert from "node:assert/strict";
import test from "node:test";
import { fetchReadOnlyEndpoint } from "../src/etoro-client.mjs";

const credentials = { baseUrl: "https://public-api.etoro.com", apiKey: "synthetic-api-key", userKey: "synthetic-user-key" };
const displayItem = (instrumentID, symbolFull = `S${instrumentID}`) => ({ instrumentID, symbolFull, instrumentDisplayName: "Synthetic instrument" });

async function readPortfolio({ rows, display, displayStatus = 200 }) {
  const calls = [];
  const result = await fetchReadOnlyEndpoint("demoPortfolio", { credentials, fetchImpl: async (url, init) => {
    assert.equal(url.origin, "https://public-api.etoro.com");
    assert.equal(init.method, "GET");
    calls.push(url);
    const metadata = url.pathname === "/api/v1/market-data/instruments";
    return new Response(JSON.stringify(metadata ? display : { clientPortfolio: { positions: rows } }), { status: metadata ? displayStatus : 200 });
  } });
  return { result, calls };
}

test("ID-only portfolio lookup is a bounded batches include instruments after the first 100", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ instrumentID: index + 1, amount: 100, unrealizedPnL: 1 }));
  const { result, calls } = await readPortfolio({ rows, display: { instrumentDisplayDatas: rows.map(({ instrumentID }) => displayItem(instrumentID)) } });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].searchParams.get("instrumentIds").split(",").length, 100);
  assert.equal(result.data.instrumentCount, 101);
  assert.equal(result.data.omittedPositionCount, 0);
  assert.equal(result.data.positionCount, 101);
  assert.doesNotMatch(JSON.stringify(result.data), /instrumentID|instrumentId|instrumentDisplayDatas/);
});

test("display lookup excludes duplicate IDs, duplicate symbols, unsafe symbols and unsolicited IDs", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ instrumentID: index + 1, amount: 100, unrealizedPnL: 1 }));
  const { result } = await readPortfolio({ rows, display: { instrumentDisplayDatas: [
    displayItem(1, "AAA"), displayItem(1, "BBB"), displayItem(2, "DUP"), displayItem(3, "DUP"),
    displayItem(4, "<script>"), displayItem(5), displayItem(999, "EXTRA"),
  ] } });
  assert.deepEqual(result.data.instruments.map(({ symbol }) => symbol), ["S5"]);
  assert.equal(result.data.omittedPositionCount, 4);
});

test("unavailable or malformed display metadata keeps missing symbols omitted without invented values", async () => {
  for (const scenario of [{ display: {}, displayStatus: 503 }, { display: {} }, { display: { instrumentDisplayDatas: [] } }]) {
    const { result } = await readPortfolio({ rows: [{ instrumentID: 1, amount: 100 }], ...scenario });
    assert.equal(result.data.instrumentCount, 0);
    assert.equal(result.data.omittedPositionCount, 1);
    assert.deepEqual(result.data.instruments, []);
  }
});

test("authentication rejection during display enrichment remains an authentication failure", async () => {
  for (const displayStatus of [401, 403]) {
    await assert.rejects(readPortfolio({ rows: [{ instrumentID: 1 }], display: {}, displayStatus }),
      (error) => error.code === "ETORO_PROVIDER_ERROR" && error.status === displayStatus);
  }
});

test("duplicate positions share one display lookup and remain aggregated without exposing IDs", async () => {
  const { result, calls } = await readPortfolio({ rows: [
    { instrumentID: 1, amount: 100, unrealizedPnL: 10 },
    { instrumentId: 1, amount: 50, unrealizedPnL: 5 },
  ], display: { instrumentDisplayDatas: [displayItem(1)] } });
  assert.equal(calls[1].searchParams.get("instrumentIds"), "1");
  assert.equal(result.data.instruments[0].positionCount, 2);
  assert.equal(result.data.instruments[0].investedUsd, 150);
  assert.equal(result.data.instruments[0].unrealizedPnlUsd, 15);
});

test("missing symbols in malformed portfolio collections do not trigger a metadata lookup", async () => {
  let calls = 0;
  await assert.rejects(fetchReadOnlyEndpoint("demoPortfolio", { credentials, fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({ clientPortfolio: { positions: {} } }), { status: 200 });
  } }), (error) => error.code === "ETORO_INVALID_DEMO_PORTFOLIO_RESPONSE");
  assert.equal(calls, 1);
});

test("display enrichment follows the normalizer's nullish position collection aliases", async () => {
  const result = await fetchReadOnlyEndpoint("realPortfolio", { credentials, fetchImpl: async (url) => new Response(JSON.stringify(
    url.pathname === "/api/v1/market-data/instruments"
      ? { instrumentDisplayDatas: [displayItem(1)] }
      : { clientPortfolio: { positions: null, openPositions: [{ instrumentID: 1, amount: 100, unrealizedPnL: 1 }] } },
  ), { status: 200 }) });
  assert.equal(result.data.instruments[0].symbol, "S1");
  assert.equal(result.data.omittedPositionCount, 0);
});
