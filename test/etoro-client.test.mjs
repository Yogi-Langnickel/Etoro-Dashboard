import assert from "node:assert/strict";
import test from "node:test";
import {
  EtoroApiError,
  READ_ONLY_ENDPOINTS,
  buildEtoroHeaders,
  fetchPortfolioSnapshot,
  fetchReadOnlyEndpoint,
  readOnlyEndpointSummary,
  redactSecrets,
} from "../src/etoro-client.mjs";

const credentials = {
  baseUrl: "https://public-api.etoro.com",
  apiKey: "test-api-secret",
  userKey: "test-user-secret",
};

test("buildEtoroHeaders sends required auth headers and a UUID request id", () => {
  const headers = buildEtoroHeaders(credentials);

  assert.match(
    headers["x-request-id"],
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(headers["x-api-key"], credentials.apiKey);
  assert.equal(headers["x-user-key"], credentials.userKey);
  assert.equal(headers.accept, "application/json");
});

test("fetchReadOnlyEndpoint uses GET and normalizes identity without account ids", async () => {
  let captured = null;
  const result = await fetchReadOnlyEndpoint("identity", {
    credentials,
    requestId: "00000000-0000-4000-8000-000000000000",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ gcid: 1, realCid: 2, demoCid: 3 }), { status: 200 });
    },
  });

  assert.equal(captured.init.method, "GET");
  assert.equal(captured.url.toString(), "https://public-api.etoro.com/api/v1/me");
  assert.equal(captured.init.headers["x-request-id"], "00000000-0000-4000-8000-000000000000");
  assert.equal(Number.isInteger(result.provider.durationMs), true);
  assert.equal(result.provider.durationMs >= 0, true);
  assert.deepEqual(result.data, {
    authenticated: true,
    accountRefs: { hasGcid: true, hasRealCid: true, hasDemoCid: true },
  });
  assert.equal(JSON.stringify(result).includes('"gcid"'), false);
  assert.equal(JSON.stringify(result).includes('"realCid"'), false);
  assert.equal(JSON.stringify(result).includes('"demoCid"'), false);
});

test("demo PnL response is summarized and raw order details are not returned", async () => {
  const result = await fetchReadOnlyEndpoint("demoPnl", {
    credentials,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          clientPortfolio: {
            credit: 1000,
            unrealizedPnL: 25,
            positions: [{ amount: 300, instrumentId: 1 }, { amount: 200, instrumentId: 2 }],
            ordersForOpen: [
              { amount: 100, mirrorID: 0, privateNote: "do not expose", totalExternalCosts: 5 },
              { amount: 200, mirrorID: 5 },
            ],
            orders: [{ amount: 50 }],
            mirrors: [],
            ordersForClose: [],
            ordersForCloseMultiple: [],
          },
        }),
        { status: 200 },
      ),
  });

  assert.equal(result.data.credit, 1000);
  assert.equal(result.data.availableCash, 850);
  assert.equal(result.data.totalInvested, 655);
  assert.equal(result.data.equity, 1530);
  assert.equal(result.data.positionCount, 2);
  assert.equal(result.data.pendingOrderCount, 3);
  assert.equal(JSON.stringify(result).includes("privateNote"), false);
  assert.equal(JSON.stringify(result).includes("instrumentId"), false);
});

test("PnL summaries never turn missing, null, NaN, or infinity inputs into zero", async () => {
  for (const amount of [undefined, null, "not-a-number", Infinity]) {
    const result = await fetchReadOnlyEndpoint("demoPnl", {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: {
        credit: 1000,
        positions: [{ amount: 100, unrealizedPnL: amount }],
        orders: [], ordersForOpen: [], ordersForClose: [], ordersForCloseMultiple: [], mirrors: [],
      } }), { status: 200 }),
    });
    assert.equal(result.data.calculatedUnrealizedPnL, null);
    assert.equal(result.data.unrealizedPnL, null);
    assert.equal(result.data.equity, null);
  }
});

test("PnL summaries treat omitted provider collections as unavailable, not empty", async () => {
  const result = await fetchReadOnlyEndpoint("demoPnl", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: {
      credit: 1000,
      positions: [{ amount: 100, unrealizedPnL: 5 }],
    } }), { status: 200 }),
  });
  assert.equal(result.data.availableCash, null);
  assert.equal(result.data.totalInvested, null);
  assert.equal(result.data.calculatedUnrealizedPnL, null);
  assert.equal(result.data.positionCount, null);
  assert.equal(result.data.pendingOrderCount, null);
});

test("demo portfolio response is aggregated by symbol without provider identifiers", async () => {
  const result = await fetchReadOnlyEndpoint("demoPortfolio", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({
      clientPortfolio: {
        positions: [
          { instrumentId: 1, positionId: 10, instrumentSymbol: "AAPL", amount: 100, unrealizedPnL: 5 },
          { instrumentId: 1, positionId: 11, instrumentSymbol: "AAPL", amount: 50, unrealizedPnL: -2 },
          { instrumentId: 2, positionId: 12, amount: 25 },
        ],
      },
    }), { status: 200 }),
  });

  assert.deepEqual(result.data.instruments, [{
      symbol: "AAPL",
      positionCount: 2,
      investedUsd: 150,
      unrealizedPnlUsd: 3,
      units: null,
      averageOpenPrice: null,
      currentPrice: null,
      displayName: "AAPL",
      valueStatus: "complete",
  }]);
  assert.equal(result.data.positionCount, 3);
  assert.equal(result.data.omittedPositionCount, 1);
  assert.equal(JSON.stringify(result).includes("instrumentId"), false);
  assert.equal(JSON.stringify(result).includes("positionId"), false);
});

test("portfolio aggregation uses a units-weighted open price or marks mixed market values unavailable", async () => {
  const result = await fetchReadOnlyEndpoint("demoPortfolio", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: { positions: [
      { symbol: "AAPL", amount: 100, unrealizedPnL: 1, units: 2, openRate: 10, currentRate: 12 },
      { symbol: "AAPL", amount: 200, unrealizedPnL: 2, units: 8, openRate: 20, currentRate: 12 },
    ] } }), { status: 200 }),
  });
  assert.equal(result.data.instruments[0].averageOpenPrice, 18);
  assert.equal(result.data.instruments[0].units, 10);
  assert.equal(result.data.instruments[0].currentPrice, 12);
});

test("portfolio aggregation preserves fractional quantities and weighted small-price precision", async () => {
  const result = await fetchReadOnlyEndpoint("demoPortfolio", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: { positions: [
      { symbol: "PENNY", amount: 0.01, unrealizedPnL: -0.001, units: 0.125, openRate: 0.00012345, currentRate: 0.00023456 },
      { symbol: "PENNY", amount: 0.02, unrealizedPnL: 0, units: 0.875, openRate: 0.00022345, currentRate: 0.00023456 },
    ] } }), { status: 200 }),
  });

  assert.equal(result.data.instruments[0].units, 1);
  assert.equal(result.data.instruments[0].averageOpenPrice, 0.00021095);
  assert.equal(result.data.instruments[0].currentPrice, 0.00023456);
  assert.equal(result.data.instruments[0].unrealizedPnlUsd, 0);
});

test("portfolio aggregation marks finite market-value overflow incomplete instead of fabricating zeroes", async () => {
  const result = await fetchReadOnlyEndpoint("demoPortfolio", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: { positions: [
      { symbol: "AAPL", amount: 1, unrealizedPnL: -1, units: 1e308, openRate: 1, currentRate: 1 },
      { symbol: "AAPL", amount: 1, unrealizedPnL: 1, units: 1e308, openRate: 1, currentRate: 1 },
    ] } }), { status: 200 }),
  });

  assert.deepEqual(result.data.instruments[0], {
    symbol: "AAPL", positionCount: 2, investedUsd: 2, unrealizedPnlUsd: 0,
    units: null, averageOpenPrice: null, currentPrice: null, displayName: "AAPL", valueStatus: "incomplete",
  });
  assert.equal(result.data.incompleteValuePositionCount, 2);
});

test("Real and Demo portfolio normalizers reject numeric strings without losing valid zero or negative PnL", async () => {
  for (const endpoint of ["demoPortfolio", "realPortfolio"]) {
    const malformed = await fetchReadOnlyEndpoint(endpoint, {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: { positions: [
        { symbol: "AAPL", amount: "100", unrealizedPnL: "-2", units: "0.25", openRate: "0.0001", currentRate: "0.0002" },
      ] } }), { status: 200 }),
    });
    assert.deepEqual(malformed.data.instruments[0], {
      symbol: "AAPL", positionCount: 1, investedUsd: null, unrealizedPnlUsd: null,
      units: null, averageOpenPrice: null, currentPrice: null, displayName: "AAPL", valueStatus: "incomplete",
    });

    const valid = await fetchReadOnlyEndpoint(endpoint, {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: { positions: [
        { symbol: "AAPL", amount: 0, unrealizedPnL: -0.25, units: 0.25, openRate: 0.0001, currentRate: 0.0002 },
      ] } }), { status: 200 }),
    });
    assert.equal(valid.data.instruments[0].investedUsd, 0);
    assert.equal(valid.data.instruments[0].unrealizedPnlUsd, -0.25);
    assert.equal(valid.data.instruments[0].units, 0.25);
    assert.equal(valid.data.instruments[0].averageOpenPrice, 0.0001);
  }
});

test("Real and Demo portfolio normalizers count malformed market numeric types as incomplete", async () => {
  for (const endpoint of ["demoPortfolio", "realPortfolio"]) {
    const result = await fetchReadOnlyEndpoint(endpoint, {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({ clientPortfolio: { positions: [
        { symbol: "AAPL", amount: 100, unrealizedPnL: -1, units: "0.25", openRate: 0.0001, currentRate: 0.0002 },
      ] } }), { status: 200 }),
    });
    assert.deepEqual(result.data.instruments[0], {
      symbol: "AAPL", positionCount: 1, investedUsd: 100, unrealizedPnlUsd: -1,
      units: null, averageOpenPrice: null, currentPrice: null, displayName: "AAPL", valueStatus: "incomplete",
    });
    assert.equal(result.data.incompleteValuePositionCount, 1);
  }
});

test("Real and Demo portfolio DTOs retain fractional quantities and prices while rounding totals and percentages", async () => {
  for (const environment of ["real", "demo"]) {
    const snapshot = await fetchPortfolioSnapshot(environment, {
      fetchEndpoint: async (endpoint) => {
        if (endpoint === "identity") return { data: { authenticated: true } };
        if (endpoint.endsWith("Pnl")) return { data: {
          equity: 1.2345, availableCash: 0, totalInvested: 0.015, unrealizedPnL: -0.0049, realizedPnL: 0,
          mirrorCount: 0, pendingOrderCount: 0, providerUpdatedAt: null,
        } };
        return { data: {
          positionCount: 1, instrumentCount: 1, omittedPositionCount: 0, incompleteValuePositionCount: 0, providerUpdatedAt: null,
          instruments: [{ symbol: "PENNY", displayName: "Penny", positionCount: 1, units: 0.125, averageOpenPrice: 0.00012345, currentPrice: 0.00023456, investedUsd: 0.015, unrealizedPnlUsd: -0.0049, valueStatus: "complete" }],
        } };
      },
    });
    const instrument = snapshot.data.instruments[0];
    assert.equal(instrument.units, 0.125);
    assert.equal(instrument.averageOpenPrice, 0.00012345);
    assert.equal(instrument.currentPrice, 0.00023456);
    assert.equal(instrument.investedValue, 0.01);
    assert.equal(instrument.unrealizedPnl, 0);
    assert.equal(instrument.allocationPercent, 66.67);
  }
});

test("demo portfolio omits unsafe symbols and marks incomplete financial values", async () => {
  const result = await fetchReadOnlyEndpoint("demoPortfolio", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({
      clientPortfolio: {
        positions: [
          { symbol: "<script>", amount: 50, unrealizedPnL: 1 },
          { symbol: " msft ", amount: "not-a-number", unrealizedPnL: 2 },
        ],
      },
    }), { status: 200 }),
  });

  assert.deepEqual(result.data.instruments, [{
      symbol: "MSFT",
      positionCount: 1,
      investedUsd: null,
      unrealizedPnlUsd: null,
      units: null,
      averageOpenPrice: null,
      currentPrice: null,
      displayName: "MSFT",
      valueStatus: "incomplete",
  }]);
  assert.equal(result.data.omittedPositionCount, 1);
  assert.equal(result.data.incompleteValuePositionCount, 1);
  assert.equal(JSON.stringify(result).includes("<script>"), false);
});

test("default watchlist normalizes instrument items while keeping provider ids internal", async () => {
  const result = await fetchReadOnlyEndpoint("defaultWatchlist", {
    credentials,
    fetchImpl: async (url) => {
      assert.equal(url.pathname, "/api/v1/watchlists/default-watchlists/items");
      assert.equal(url.searchParams.get("itemsLimit"), "100");
      return new Response(JSON.stringify([
        { itemId: 101, itemType: "Instrument", itemRank: 2, market: { symbolName: " aapl ", displayName: "Apple Inc." } },
        { itemId: 202, itemType: "Person", itemRank: 1, market: { symbolName: "PERSON" } },
        { itemId: 303, itemType: "Instrument", itemRank: 3, market: { symbolName: "<script>" } },
      ]), { status: 200 });
    },
  });

  assert.deepEqual(result.data, {
    items: [{ instrumentId: 101, symbol: "AAPL", displayName: "Apple Inc.", rank: 2 }],
    omittedItemCount: 2,
  });
});

test("instrument search uses an exact symbol filter and rejects partial-only matches", async () => {
  let requestUrl;
  const exact = await fetchReadOnlyEndpoint("instrumentSearch", {
    credentials,
    params: { symbol: "AAPL" },
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ items: [
        { instrumentId: 101, internalSymbolFull: "AAPL.L", displayname: "Partial" },
        { instrumentId: 102, internalSymbolFull: "AAPL", displayname: "Apple Inc." },
      ] }), { status: 200 });
    },
  });
  assert.equal(requestUrl.searchParams.get("internalSymbolFull"), "AAPL");
  assert.equal(requestUrl.searchParams.get("fields"), "instrumentId,internalSymbolFull,displayname,marketId");
  assert.deepEqual(exact.data, { instrumentId: 102, symbol: "AAPL", displayName: "Apple Inc." });

  await assert.rejects(() => fetchReadOnlyEndpoint("instrumentSearch", {
    credentials,
    params: { symbol: "AAPL" },
    fetchImpl: async () => new Response(JSON.stringify({ items: [
      { instrumentId: 101, internalSymbolFull: "AAPL.L" },
    ] }), { status: 200 }),
  }), (error) => error.code === "ETORO_SYMBOL_NOT_FOUND" && error.status === 404);
});

test("market rates batch ids and normalize only finite timestamped rows", async () => {
  let requestUrl;
  const result = await fetchReadOnlyEndpoint("marketRates", {
    credentials,
    params: { instrumentIds: [101, 202] },
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({ rates: [
        { instrumentID: 101, bid: 190, ask: 191, lastExecution: 190.5, date: "2026-07-12T01:00:00Z", priceRateID: 999 },
        { instrumentID: 202, bid: "bad", ask: 5, date: "2026-07-12T01:00:00Z" },
      ] }), { status: 200 });
    },
  });
  assert.equal(requestUrl.searchParams.get("instrumentIds"), "101,202");
  assert.deepEqual(result.data.rates, [{
    instrumentId: 101,
    bid: 190,
    ask: 191,
    lastExecution: 190.5,
    updatedAt: "2026-07-12T01:00:00.000Z",
  }]);
  assert.equal(JSON.stringify(result.data).includes("priceRateID"), false);
});

test("search resolves one exact symbol with omitted type fields and a repeated id property", async () => {
  const result = await fetchReadOnlyEndpoint("instrumentSearch", {
    credentials,
    params: { symbol: "AAA" },
    // Synthetic raw JSON preserves the repeated-key shape reported by support.
    fetchImpl: async () => new Response('{"items":[{"instrumentId":101,"internalSymbolFull":"AAA.RTH"},{"instrumentId":102,"internalSymbolFull":"AAA5.L"},{"instrumentId":103,"instrumentId":103,"internalSymbolFull":"AAA","displayname":"Synthetic exact symbol"}]}'),
  });
  assert.deepEqual(result.data, { instrumentId: 103, symbol: "AAA", displayName: "Synthetic exact symbol" });
});

test("search rejects provider symbol repair and ambiguous exact rows", async () => {
  for (const items of [
    [{ instrumentId: 101, internalSymbolFull: "aaa" }],
    [{ instrumentId: 101, internalSymbolFull: " AAA " }],
    [{ instrumentId: 101, internalSymbolFull: "AAA.RTH" }, { instrumentId: 102, internalSymbolFull: "AAA5.L" }],
    [{ instrumentId: 101, internalSymbolFull: "AAA" }, { instrumentId: 102, internalSymbolFull: "AAA" }],
    [{ instrumentId: 101, internalSymbolFull: "AAA" }, { instrumentId: 101, internalSymbolFull: "AAA" }],
  ]) {
    await assert.rejects(() => fetchReadOnlyEndpoint("instrumentSearch", {
      credentials,
      params: { symbol: "AAA" },
      fetchImpl: async () => new Response(JSON.stringify({ items })),
    }), (error) => error.code === (items.some((item) => item.internalSymbolFull === "AAA")
      ? "ETORO_SYMBOL_AMBIGUOUS" : "ETORO_SYMBOL_NOT_FOUND"));
  }
});

test("market rates omit timezone-free, non-ISO and invalid calendar timestamps", async () => {
  const invalidDates = ["2026-10-03", "2026-10-03T01:00:00", "10/03/2026 01:00:00", "2026-02-30T01:00:00Z", "2026-10-03T24:00:00Z"];
  const result = await fetchReadOnlyEndpoint("marketRates", {
    credentials,
    params: { instrumentIds: [101] },
    fetchImpl: async () => new Response(JSON.stringify({ rates: [
      ...invalidDates.map((date) => ({ instrumentID: 101, bid: 10, ask: 11, date })),
      { instrumentID: 101, bid: 10, ask: 11, lastExecution: 10.5, date: "2026-10-03T01:00:00+00:00" },
    ] })),
  });
  assert.deepEqual(result.data.rates, [{ instrumentId: 101, bid: 10, ask: 11, lastExecution: 10.5, updatedAt: "2026-10-03T01:00:00.000Z" }]);
});

test("market candles normalize explicit offsets and reject timezone-free or invalid dates", async () => {
  const read = (fromDate) => fetchReadOnlyEndpoint("marketCandles", {
    credentials,
    params: { instrumentId: 101, direction: "asc", interval: "OneHour", candlesCount: 1 },
    fetchImpl: async () => new Response(JSON.stringify({ interval: "OneHour", candles: [{
      instrumentId: 101, candles: [{ instrumentID: 101, fromDate, close: 10 }],
    }] })),
  });
  assert.deepEqual((await read("2026-10-03T11:00:00+10:00")).data.points, [{ at: "2026-10-03T01:00:00.000Z", close: 10 }]);
  for (const date of ["2026-10-03T11:00:00", "2026-10-03", "2026-02-29T11:00:00Z"]) {
    await assert.rejects(() => read(date), (error) => error.code === "ETORO_INVALID_MARKET_CANDLES_RESPONSE");
  }
});

test("market candles normalize ordered close-only chart points", async () => {
  const result = await fetchReadOnlyEndpoint("marketCandles", {
    credentials,
    params: { instrumentId: 101, direction: "asc", interval: "OneHour", candlesCount: 24 },
    fetchImpl: async (url) => {
      assert.equal(url.pathname, "/api/v1/market-data/instruments/101/history/candles/asc/OneHour/24");
      return new Response(JSON.stringify({ interval: "OneHour", candles: [{
        instrumentId: 101,
        candles: [
          { instrumentID: 101, fromDate: "2026-07-12T00:00:00Z", open: 9, high: 12, low: 8, close: 10, volume: 5 },
          { instrumentID: 101, fromDate: "2026-07-12T01:00:00Z", open: 10, high: 13, low: 9, close: 11, volume: 6 },
        ],
      }] }), { status: 200 });
    },
  });
  assert.deepEqual(result.data, {
    interval: "OneHour",
    points: [
      { at: "2026-07-12T00:00:00.000Z", close: 10 },
      { at: "2026-07-12T01:00:00.000Z", close: 11 },
    ],
  });
  assert.equal(JSON.stringify(result.data).includes("instrumentId"), false);
  assert.equal(JSON.stringify(result.data).includes("volume"), false);
});

test("demo portfolio marks overflowing aggregate values as incomplete", async () => {
  const result = await fetchReadOnlyEndpoint("demoPortfolio", {
    credentials,
    fetchImpl: async () => new Response(JSON.stringify({
      clientPortfolio: {
        positions: [
          { symbol: "AAPL", amount: 1e308, unrealizedPnL: 1e308 },
          { symbol: "AAPL", amount: 1e308, unrealizedPnL: 1e308 },
        ],
      },
    }), { status: 200 }),
  });

  assert.deepEqual(result.data.instruments, [{
      symbol: "AAPL",
      positionCount: 2,
      investedUsd: null,
      unrealizedPnlUsd: null,
      units: null,
      averageOpenPrice: null,
      currentPrice: null,
      displayName: "AAPL",
      valueStatus: "incomplete",
  }]);
  assert.equal(result.data.incompleteValuePositionCount, 2);
});

test("demo portfolio rejects malformed position collections", async () => {
  await assert.rejects(
    fetchReadOnlyEndpoint("demoPortfolio", {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({
        clientPortfolio: { positions: {} },
      }), { status: 200 }),
    }),
    (error) => error instanceof EtoroApiError
      && error.code === "ETORO_INVALID_DEMO_PORTFOLIO_RESPONSE",
  );
});

test("demo PnL response supports the documented clientPortfolio wrapper", async () => {
  const result = await fetchReadOnlyEndpoint("demoPnl", {
    credentials,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          clientPortfolio: {
            credit: 10000.5,
            positions: [{ amount: 500, positionId: 9001, unrealizedPnL: { pnL: 50 } }],
            mirrors: [
              {
                availableAmount: 100,
                closedPositionsNetProfit: 40,
                mirrorId: 1,
                positions: [{ amount: 250, positionId: 9002, unrealizedPnL: 25 }],
                ordersForOpen: [{ amount: 1000 }],
                ordersForClose: [{ orderId: 2002 }],
                ordersForCloseMultiple: [{ orderId: 3002 }],
              },
            ],
            orders: [{ amount: 250 }],
            ordersForOpen: [],
            ordersForClose: [{ orderId: 2001 }],
            ordersForCloseMultiple: [{ orderId: 3001 }],
          },
        }),
        { status: 200 },
      ),
  });

  assert.equal(result.data.credit, 10000.5);
  assert.equal(result.data.unrealizedPnL, 115);
  assert.equal(result.data.totalInvested, 1060);
  assert.equal(result.data.equity, 10925.5);
  assert.equal(result.data.positionCount, 2);
  assert.equal(result.data.mirrorCount, 1);
  assert.equal(result.data.pendingOrderCount, 6);
  assert.equal(JSON.stringify(result).includes("positionId"), false);
  assert.equal(JSON.stringify(result).includes("mirrorId"), false);
  assert.equal(JSON.stringify(result).includes("orderId"), false);
});

test("documented top-level real and demo PnL payloads use credits without inventing values", async () => {
  for (const endpoint of ["realPnl", "demoPnl"]) {
    const result = await fetchReadOnlyEndpoint(endpoint, {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({
        credits: 1000,
        positions: [], mirrors: [], ordersForOpen: [], orders: [],
      }), { status: 200 }),
    });
    assert.equal(result.data.credit, 1000);
    assert.equal(result.data.availableCash, 1000);
    assert.equal(result.data.totalInvested, 0);
    assert.equal(result.data.unrealizedPnL, 0);
    assert.equal(result.data.equity, 1000);
  }
});

test("demo PnL ignores nullable provider totals and uses derived fallbacks", async () => {
  const result = await fetchReadOnlyEndpoint("demoPnl", {
    credentials,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          clientPortfolio: {
            credit: 1000,
            equity: null,
            unrealizedPnL: null,
            positions: [{ amount: 500, positionID: 1, unrealizedPnL: 25 }],
            mirrors: [],
            orders: [],
            ordersForOpen: [],
            ordersForClose: [],
            ordersForCloseMultiple: [],
          },
        }),
        { status: 200 },
      ),
  });

  assert.equal(result.data.availableCash, 1000);
  assert.equal(result.data.totalInvested, 500);
  assert.equal(result.data.unrealizedPnL, 25);
  assert.equal(result.data.equity, 1525);
  assert.equal(JSON.stringify(result).includes("positionID"), false);
});

test("identity requires documented account reference fields", async () => {
  await assert.rejects(
    fetchReadOnlyEndpoint("identity", {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({ gcid: 1 }), { status: 200 }),
    }),
    (error) =>
      error instanceof EtoroApiError && error.code === "ETORO_INVALID_IDENTITY_RESPONSE",
  );
});

test("demo PnL requires the documented clientPortfolio wrapper", async () => {
  await assert.rejects(
    fetchReadOnlyEndpoint("demoPnl", {
      credentials,
      fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
    }),
    (error) =>
      error instanceof EtoroApiError && error.code === "ETORO_INVALID_DEMO_PNL_RESPONSE",
  );
});

test("redactSecrets removes configured secrets and sensitive header values", () => {
  const redacted = redactSecrets(
    "x-api-key: test-api-secret x-user-key=test-user-secret authorization: Bearer abc",
    ["test-api-secret", "test-user-secret"],
  );

  assert.equal(redacted.includes("test-api-secret"), false);
  assert.equal(redacted.includes("test-user-secret"), false);
  assert.equal(redacted.includes("Bearer abc"), false);
  assert.match(redacted, /x-api-key: \[REDACTED\]/i);
  assert.match(redacted, /x-user-key: \[REDACTED\]/i);
});

test("read-only endpoint allow-list excludes mutation routes", async () => {
  const summary = readOnlyEndpointSummary();
  const serialized = JSON.stringify(summary).toLowerCase();

  assert.deepEqual(Object.keys(READ_ONLY_ENDPOINTS).sort(), [
    "defaultWatchlist",
    "demoPnl",
    "demoPortfolio",
    "identity",
    "instrumentDisplay",
    "instrumentSearch",
    "marketCandles",
    "marketRates",
    "realPnl",
    "realPortfolio",
  ]);
  assert.equal(Object.values(READ_ONLY_ENDPOINTS).every(({ method }) => method === "GET"), true);
  assert.equal(serialized.includes("order"), false);
  assert.equal(serialized.includes("trade"), false);

  await assert.rejects(
    fetchReadOnlyEndpoint("placeOrder", { credentials, fetchImpl: async () => new Response("{}") }),
    (error) =>
      error instanceof EtoroApiError && error.code === "ETORO_ENDPOINT_NOT_ALLOWED",
  );
});

test("429 responses carry a bounded Retry-After duration without exposing the header", async () => {
  await assert.rejects(
    fetchReadOnlyEndpoint("identity", {
      credentials,
      fetchImpl: async () => new Response("{}", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    }),
    (error) => error instanceof EtoroApiError && error.retryAfterMs === 60_000,
  );
});

test("429 Retry-After is honored even when the provider error body is not JSON", async () => {
  await assert.rejects(
    fetchReadOnlyEndpoint("identity", {
      credentials,
      fetchImpl: async () => new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "7" },
      }),
    }),
    (error) => error instanceof EtoroApiError
      && error.code === "ETORO_PROVIDER_ERROR"
      && error.retryAfterMs === 7_000
      && !error.message.includes("rate limited"),
  );
});

test("HTTP-date Retry-After uses the injected request clock", async () => {
  const nowMs = Date.parse("2026-07-11T00:00:00.000Z");
  await assert.rejects(
    fetchReadOnlyEndpoint("identity", {
      credentials,
      now: () => nowMs,
      fetchImpl: async () => new Response("rate limited", {
        status: 429,
        headers: { "retry-after": new Date(nowMs + 9_000).toUTCString() },
      }),
    }),
    (error) => error instanceof EtoroApiError && error.retryAfterMs === 9_000,
  );
});

test("fetchReadOnlyEndpoint rejects non-eToro provider hosts before fetch", async () => {
  let fetchCalled = false;

  await assert.rejects(
    fetchReadOnlyEndpoint("identity", {
      credentials: {
        ...credentials,
        baseUrl: "https://example.test",
      },
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("{}");
      },
    }),
    (error) => error instanceof EtoroApiError && error.code === "ETORO_INVALID_BASE_URL",
  );

  assert.equal(fetchCalled, false);
});

test("fetchReadOnlyEndpoint rejects credentialed or path-scoped base URLs before fetch", async () => {
  const rejectedBaseUrls = [
    "https://public-api.etoro.com.evil.test",
    "https://public-api.etoro.com/api/v1",
    "https://user:pass@public-api.etoro.com",
    "https://public-api.etoro.com?token=test-api-secret",
  ];

  for (const baseUrl of rejectedBaseUrls) {
    let fetchCalled = false;

    await assert.rejects(
      fetchReadOnlyEndpoint("identity", {
        credentials: {
          ...credentials,
          baseUrl,
        },
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response("{}");
        },
      }),
      (error) => error instanceof EtoroApiError && error.code === "ETORO_INVALID_BASE_URL",
    );

    assert.equal(fetchCalled, false, baseUrl);
  }
});
