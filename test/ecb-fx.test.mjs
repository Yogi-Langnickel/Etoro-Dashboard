import test from "node:test";
import assert from "node:assert/strict";
import { createEcbReferenceAdapter, expectedRateDate, parseEcbReferenceXml, validateReferenceRates, fxCrossRate } from "../src/ecb-fx.mjs";
import { createRequestHandler } from "../src/server.mjs";
const now = Date.parse("2026-10-04T03:00:00Z");
const xml = (date = "2026-10-02", body = "<Cube currency='USD' rate='1.2'/><Cube currency='AUD' rate='1.8'/><Cube currency='JPY' rate='180'/>") => `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time='${date}'>${body}</Cube></Cube></gesmes:Envelope>`;

test("ECB EUR-direction cross rates convert consistently, preserve minor units at formatting, and leave identity conversion available", () => {
  const snapshot = parseEcbReferenceXml(xml(), now);
  assert.equal(snapshot.freshness, "current"); assert.equal(snapshot.rates.EUR, 1);
  assert.equal(fxCrossRate(snapshot, "USD", "AUD"), 1.5); assert.equal(fxCrossRate(snapshot, "USD", "JPY"), 150);
  assert.equal(fxCrossRate(snapshot, "AUD", "EUR"), 1 / 1.8); assert.equal(fxCrossRate(snapshot, "GBP", "AUD"), null);
  assert.equal(fxCrossRate(null, "USD", "USD"), 1); assert.equal(fxCrossRate(null, "USD", "AUD"), null);
});

test("publication schedule accounts for weekends, Berlin daylight saving, TARGET holidays and grace period", () => {
  assert.equal(expectedRateDate(now), "2026-10-02");
  assert.equal(expectedRateDate(Date.parse("2026-10-05T13:00:00Z")), "2026-10-02");
  assert.equal(expectedRateDate(Date.parse("2026-10-05T14:31:00Z")), "2026-10-05");
  assert.equal(expectedRateDate(Date.parse("2026-04-06T17:00:00Z")), "2026-04-02");
  assert.equal(expectedRateDate(Date.parse("2026-12-28T12:00:00Z")), "2026-12-24");
  const stale = parseEcbReferenceXml(xml("2026-10-01"), now); assert.equal(stale.freshness, "stale"); assert.equal(fxCrossRate(stale, "USD", "AUD"), null);
});

test("strict XML and numerical contracts reject invalid, duplicate, inconsistent/future dates and unsafe rates", () => {
  for (const bad of ["", xml("2026-02-30"), xml("2026-10-05"), xml("2026-10-03"), xml().replace("</Cube></Cube>", "</Cube><Cube time='2026-10-01'></Cube></Cube>"), xml("2026-10-02", "<Cube currency='USD' rate='0'/>") , xml("2026-10-02", "<Cube currency='USD' rate='1.2'/><Cube currency='USD' rate='1.3'/>") , "<!DOCTYPE foo>" + xml(), xml("2026-10-02", "<Cube currency='USD' rate='NaN'/>")]) assert.throws(() => parseEcbReferenceXml(bad, now));
  for (const bad of ["1.2", 0, -1, NaN, Infinity, true, 1e10]) assert.throws(() => validateReferenceRates({ rateDate: "2026-10-02", rates: { USD: bad } }, now));
});

test("public FX transport coalesces, caches original fetch clock, recomputes freshness and fails closed without raw errors", async () => {
  let at = Date.parse("2026-10-05T14:20:00Z"); let calls = 0;
  const adapter = createEcbReferenceAdapter({ now: () => at, fetchImpl: async (url, init) => { calls++; assert.equal(url, "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"); assert.deepEqual(init.headers, { accept: "application/xml,text/xml" }); return new Response(xml()); } });
  const [first, second] = await Promise.all([adapter(), adapter()]); assert.equal(calls, 1); assert.deepEqual(first, second);
  at += 12 * 60000; const cached = await adapter(); assert.equal(calls, 1); assert.equal(cached.receivedAt, first.receivedAt); assert.equal(cached.freshness, "stale");
  const failing = createEcbReferenceAdapter({ now: () => now, fetchImpl: async () => { throw new Error("private body"); } });
  await assert.rejects(failing(), (error) => error.code === "FX_UNAVAILABLE" && !error.message.includes("private"));
});

test("FX API is independent of profile configuration and sanitizes failure metadata", async () => {
  const call = async (options) => {
    const handler = createRequestHandler({ loadConfig: async () => { throw new Error("Must not read profile configuration for public FX"); }, ...options });
    const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: "GET", url: "/api/fx/reference", headers: { host: "localhost:4173" } }, response); return response;
  };
  const result = await call({ fetchFxReference: async () => parseEcbReferenceXml(xml(), now) }); assert.equal(result.status, 200); assert.equal(result.body.data.basis, "units-per-EUR");
  const unavailable = await call({ fetchFxReference: async () => { throw new Error("private payload"); } }); assert.equal(unavailable.status, 503); assert.doesNotMatch(JSON.stringify(unavailable.body), /private payload/);
});

test("incremental decoded-byte ceiling cancels oversized streams with absent or dishonest content length", async () => {
  for (const headers of [{}, { "content-length": "1" }, { "content-encoding": "gzip", "content-length": "32" }]) {
    let cancelled = false; let chunks = 0;
    const stream = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(32768)); }, cancel() { cancelled = true; } });
    const adapter = createEcbReferenceAdapter({ now: () => now, fetchImpl: async () => new Response(stream, { headers }) });
    await assert.rejects(adapter(), (error) => error.code === "FX_UNAVAILABLE");
    assert.equal(cancelled, true); assert.ok(chunks <= 4);
  }
});
