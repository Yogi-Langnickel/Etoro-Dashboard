// Public, indicative reference rates: units of each currency per one EUR.
// No account data or credentials are supplied to this adapter.
export const ECB_REFERENCE_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const dayMs = 86400000;
export class FxReferenceError extends Error { constructor() { super("ECB reference rates are unavailable or invalid."); this.code = "FX_UNAVAILABLE"; } }
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}
function publicationDay(date) {
  const weekday = date.getUTCDay(); const md = date.toISOString().slice(5, 10);
  if (weekday === 0 || weekday === 6 || ["01-01", "05-01", "12-25", "12-26"].includes(md)) return false;
  const sunday = easter(date.getUTCFullYear());
  return date.getTime() !== sunday - 2 * dayMs && date.getTime() !== sunday + dayMs;
}
export function expectedRateDate(nowMs = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(nowMs).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  let time = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  // Allow a 30-minute publication window after the usual 16:00 update.
  if (Number(parts.hour) * 60 + Number(parts.minute) < 16 * 60 + 30) time -= dayMs;
  while (!publicationDay(new Date(time))) time -= dayMs;
  return new Date(time).toISOString().slice(0, 10);
}
export function validateReferenceRates({ rateDate, rates }, nowMs = Date.now()) {
  if (typeof rateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) throw new FxReferenceError();
  const date = new Date(`${rateDate}T00:00:00Z`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== rateDate || rateDate > today || !publicationDay(date) || !rates || Array.isArray(rates) || typeof rates !== "object") throw new FxReferenceError();
  const normalized = { EUR: 1 };
  for (const [currency, rate] of Object.entries(rates)) {
    if (!/^[A-Z]{3}$/.test(currency) || currency === "EUR" && rate !== 1 || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 1e9) throw new FxReferenceError();
    normalized[currency] = rate;
  }
  if (Object.keys(normalized).length < 2) throw new FxReferenceError();
  return { source: "ECB", basis: "units-per-EUR", rateDate, receivedAt: new Date(nowMs).toISOString(), freshness: rateDate >= expectedRateDate(nowMs) ? "current" : "stale", rates: normalized };
}
export function parseEcbReferenceXml(xml, nowMs = Date.now()) {
  if (typeof xml !== "string" || xml.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !xml.includes('http://www.ecb.int/vocabulary/2002-08-01/eurofxref')) throw new FxReferenceError();
  const dateCubes = [...xml.matchAll(/<Cube\s+time=['"]([^'"]+)['"]\s*>/g)];
  if (dateCubes.length !== 1) throw new FxReferenceError();
  const rates = {};
  const cubeStart = dateCubes[0].index + dateCubes[0][0].length;
  const cubeEnd = xml.indexOf("</Cube>", cubeStart);
  if (cubeEnd < 0) throw new FxReferenceError();
  const content = xml.slice(cubeStart, cubeEnd);
  const rateTag = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]((?:0|[1-9]\d*)(?:\.\d+)?)['"]\s*\/>/g;
  let match;
  while ((match = rateTag.exec(content))) {
    if (Object.hasOwn(rates, match[1]) || match[1] === "EUR") throw new FxReferenceError();
    // XML decimals are lexical strings by definition. No JSON numeric coercion.
    rates[match[1]] = Number(match[2]);
  }
  if (content.replace(rateTag, "").trim()) throw new FxReferenceError();
  return validateReferenceRates({ rateDate: dateCubes[0][1], rates }, nowMs);
}
export function fxCrossRate(snapshot, accountCurrency, displayCurrency) {
  if (accountCurrency === displayCurrency && /^[A-Z]{3}$/.test(accountCurrency)) return 1;
  if (!snapshot || snapshot.freshness !== "current" || snapshot.basis !== "units-per-EUR") return null;
  const source = snapshot.rates?.[accountCurrency], target = snapshot.rates?.[displayCurrency];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.rateDate ?? "")) return null;
  const rate = target / source;
  return typeof source === "number" && Number.isFinite(source) && source > 0 && typeof target === "number" && Number.isFinite(target) && target > 0 && Number.isFinite(rate) && rate > 0 ? rate : null;
}
async function readBoundedXml(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new FxReferenceError();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  const aborted = new Promise((_, reject) => {
    const stop = () => reject(new FxReferenceError());
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new FxReferenceError();
      bytes += chunk.value.byteLength;
      if (bytes > 65536) throw new FxReferenceError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    // Cancellation must not extend the request deadline if a custom stream's
    // cancellation callback stalls. No body or transport error is retained.
    Promise.resolve(reader.cancel()).catch(() => {});
    throw new FxReferenceError();
  } finally { reader.releaseLock(); }
}
export function createEcbReferenceAdapter(options = {}) {
  const now = options.now ?? Date.now; const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let cached = null, cachedAt = 0, pending = null, failureUntil = 0;
  return async () => {
    const at = now();
    if (cached && at - cachedAt < 1800000) return { ...validateReferenceRates(cached, at), receivedAt: cached.receivedAt };
    if (at < failureUntil) throw new FxReferenceError();
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetchImpl(ECB_REFERENCE_URL, { method: "GET", headers: { accept: "application/xml,text/xml" }, redirect: "error", signal: controller.signal });
        if (!response.ok) throw new FxReferenceError();
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > 65536) { Promise.resolve(response.body?.cancel()).catch(() => {}); throw new FxReferenceError(); }
        const snapshot = parseEcbReferenceXml(await readBoundedXml(response, controller.signal), now());
        cached = snapshot; cachedAt = now(); return snapshot;
      } catch { failureUntil = now() + 60000; throw new FxReferenceError(); }
      finally { clearTimeout(timeout); pending = null; }
    })();
    return pending;
  };
}
