import assert from "node:assert/strict";
import test from "node:test";
import {
  EtoroApiError,
  READ_ONLY_ENDPOINTS,
  buildEtoroHeaders,
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
    valueStatus: "complete",
  }]);
  assert.equal(result.data.positionCount, 3);
  assert.equal(result.data.omittedPositionCount, 1);
  assert.equal(JSON.stringify(result).includes("instrumentId"), false);
  assert.equal(JSON.stringify(result).includes("positionId"), false);
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
    valueStatus: "incomplete",
  }]);
  assert.equal(result.data.omittedPositionCount, 1);
  assert.equal(result.data.incompleteValuePositionCount, 1);
  assert.equal(JSON.stringify(result).includes("<script>"), false);
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
    valueStatus: "incomplete",
  }]);
  assert.equal(result.data.incompleteValuePositionCount, 1);
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

  assert.deepEqual(Object.keys(READ_ONLY_ENDPOINTS).sort(), ["demoPnl", "demoPortfolio", "identity"]);
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
