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
            positions: [{ instrumentId: 1 }, { instrumentId: 2 }],
            ordersForOpen: [
              { amount: 100, mirrorID: 0, privateNote: "do not expose" },
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
  assert.equal(result.data.positionCount, 2);
  assert.equal(result.data.pendingOrderCount, 3);
  assert.equal(JSON.stringify(result).includes("privateNote"), false);
});

test("demo PnL response supports the documented clientPortfolio wrapper", async () => {
  const result = await fetchReadOnlyEndpoint("demoPnl", {
    credentials,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          clientPortfolio: {
            credit: 10000.5,
            unrealizedPnL: 251,
            positions: [{ positionId: 9001 }],
            mirrors: [
              {
                mirrorId: 1,
                positions: [{ positionId: 9002 }],
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
  assert.equal(result.data.unrealizedPnL, 251);
  assert.equal(result.data.positionCount, 2);
  assert.equal(result.data.mirrorCount, 1);
  assert.equal(result.data.pendingOrderCount, 6);
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

  assert.deepEqual(Object.keys(READ_ONLY_ENDPOINTS).sort(), ["demoPnl", "identity"]);
  assert.equal(serialized.includes("order"), false);
  assert.equal(serialized.includes("trade"), false);

  await assert.rejects(
    fetchReadOnlyEndpoint("placeOrder", { credentials, fetchImpl: async () => new Response("{}") }),
    (error) =>
      error instanceof EtoroApiError && error.code === "ETORO_ENDPOINT_NOT_ALLOWED",
  );
});
