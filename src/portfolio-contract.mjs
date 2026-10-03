// Current v1 aggregate + v2 breakdown contracts. Account identifiers never
// leave this module's server-side composition inputs.
export const PORTFOLIO_INSTRUMENT_LIMIT = 500;
const MAX_AMOUNT = 1e12;
export const currencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
export const financialNumber = (value, signed = true) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_AMOUNT && (signed || value >= 0) ? value : null;
const identifier = (value) => Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const safeText = (value, fallback) => typeof value === "string" && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value) ? value : fallback;
export function snapshotTimestamp(value) {
  if (typeof value !== "string" || value.endsWith("-00:00")) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
  if (!days || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour ?? 0) > 23 || Number(offsetMinute ?? 0) > 59) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function timestampReason(value) {
  return typeof value === "string" && (/T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) || value.endsWith("-00:00"))
    ? "Provider timestamp has no known explicit timezone; source time is unverified."
    : "Provider timestamp is missing or failed calendar and explicit-zone validation.";
}
function invalid(kind) { const error = new Error(`eToro ${kind} response did not match its documented contract`); error.code = `ETORO_INVALID_${kind.toUpperCase()}_RESPONSE`; throw error; }
export function normalizeAggregatePortfolio(payload) {
  if (!object(payload) || !object(payload.accountTotals) || !Array.isArray(payload.instrumentAggregates) || !Array.isArray(payload.mirrors) ||
      !currencyCode(payload.accountCurrency) || !identifier(payload.cid)) invalid("aggregate_portfolio");
  if (payload.instrumentAggregates.length > 10000 || payload.mirrors.length > 1000) invalid("aggregate_portfolio");
  const rows = payload.instrumentAggregates.map((aggregate) => ({ aggregate, scope: "direct" }));
  const mirrorIds = new Set(); let copyHoldingsUnknown = false; let manualHoldingsUnknown = false;
  for (const mirror of payload.mirrors) {
    if (!object(mirror) || !(identifier(mirror.mirrorId) || mirror.mirrorId === 0) || mirrorIds.has(mirror.mirrorId)) invalid("aggregate_portfolio");
    mirrorIds.add(mirror.mirrorId);
    if (mirror.instrumentAggregates !== undefined && (!Array.isArray(mirror.instrumentAggregates) || mirror.instrumentAggregates.length > 10000)) invalid("aggregate_portfolio");
    // mirrorId=0 is documented as manual. Quarantine this alternative manual
    // representation rather than double-counting the root direct aggregates.
    if (mirror.mirrorId === 0) { manualHoldingsUnknown = true; continue; }
    if (mirror.instrumentAggregates === undefined) { copyHoldingsUnknown = true; continue; }
    rows.push(...mirror.instrumentAggregates.map((aggregate) => ({ aggregate, scope: "copy" })));
  }
  if (rows.length > 10000) invalid("aggregate_portfolio");
  const timestamp = snapshotTimestamp(payload.timestamp);
  return { cid: payload.cid, accountCurrency: payload.accountCurrency, timestamp, timestampReason: timestamp ? null : timestampReason(payload.timestamp), accountTotals: payload.accountTotals, rows, mirrors: payload.mirrors.filter((mirror) => mirror.mirrorId !== 0), copyHoldingsUnknown, manualHoldingsUnknown };
}
export function normalizeInstrumentBreakdown(payload) {
  if (!object(payload) || !currencyCode(payload.accountCurrency) || !Array.isArray(payload.instruments) || !Array.isArray(payload.mirrors)) invalid("instrument_breakdown");
  const rows = payload.instruments.map((instrument) => ({ instrument, scope: "direct" }));
  const mirrorIds = new Set(); let manualHoldingsUnknown = false;
  for (const mirror of payload.mirrors) {
    if (!object(mirror) || !(identifier(mirror.mirrorId) || mirror.mirrorId === 0) || mirrorIds.has(mirror.mirrorId)) invalid("instrument_breakdown");
    mirrorIds.add(mirror.mirrorId);
    if (!Array.isArray(mirror.instruments)) invalid("instrument_breakdown");
    if (mirror.mirrorId === 0) { manualHoldingsUnknown = true; continue; }
    rows.push(...mirror.instruments.map((instrument) => ({ instrument, scope: "copy" })));
  }
  if (rows.length > 10000 || rows.some(({ instrument }) => !object(instrument) || !identifier(instrument.instrumentId) || !Array.isArray(instrument.positions) || !Array.isArray(instrument.orders) || instrument.positions.length > 10000)) invalid("instrument_breakdown");
  const positionIds = new Set();
  for (const { instrument } of rows) for (const position of instrument.positions) {
    if (!object(position) || position.instrumentId !== instrument.instrumentId || !Number.isSafeInteger(position.positionId) || position.positionId <= 0 || positionIds.has(position.positionId)) invalid("instrument_breakdown");
    positionIds.add(position.positionId);
  }
  const timestamp = snapshotTimestamp(payload.timestamp);
  return { accountCurrency: payload.accountCurrency, timestamp, timestampReason: timestamp ? null : timestampReason(payload.timestamp), rows, manualHoldingsUnknown };
}
const sum = (values) => values.every((value) => value !== null) ? financialNumber(values.reduce((total, value) => total + value, 0)) : null;
const sourceReason = (raw, signed = true) => raw === null || raw === undefined ? "Not supplied by this provider snapshot." : financialNumber(raw, signed) === null ? "Provider value failed finite-number or range validation." : null;
const fieldSpec = {
  investedValue: ["totalMarginAccountCurrency", false], netValue: ["liquidationValueAccountCurrency", true], unrealizedPnl: ["accountCurrencyReturn", true],
  units: ["netUnits", true], netContracts: ["netContracts", true], currentExposure: ["netCurrentExposureAccountCurrency", true], averageOpenPrice: ["netAvgOpenRate", true],
};
function arithmetic(actual, values) {
  const expected = sum(values);
  return actual === null || expected === null ? "unavailable" : Math.abs(actual - expected) <= 0.02 ? "verified" : "mismatch";
}
function sanitizePosition(position) {
  return {
    direction: ["long", "short"].includes(position.direction) ? position.direction : null,
    settlementType: ["cfd", "real", "trs", "cmt", "realFutures", "marginTrade"].includes(position.settlementType) ? position.settlementType : null,
    leverage: Number.isSafeInteger(position.leverage) && position.leverage > 0 ? financialNumber(position.leverage, false) : null,
    units: financialNumber(position.units, false), contracts: financialNumber(position.contracts, false),
    openPrice: financialNumber(position.openRate, false), currentPrice: financialNumber(position.currentRate, false),
    assetCurrency: currencyCode(position.assetCurrency), rateUpdatedAt: snapshotTimestamp(position.rateTimestamp),
  };
}
/** No provider IDs, order parameters, or account references cross this boundary. */
export function composePortfolioSnapshot(environment, aggregate, breakdown, metadata, unavailableReason = "Instrument breakdown unavailable.", metadataFailures = new Map()) {
  const ids = [...new Set(aggregate.rows.map(({ aggregate: item }) => identifier(item?.instrumentId)).filter(Boolean))];
  const boundedIds = new Set(ids.slice(0, PORTFOLIO_INSTRUMENT_LIMIT));
  const byId = new Map(); const ambiguousIds = new Set(); const symbolIds = new Map(); const ambiguousSymbols = new Set();
  for (const item of metadata) {
    if (!boundedIds.has(item.instrumentId)) continue;
    if (byId.has(item.instrumentId)) ambiguousIds.add(item.instrumentId);
    if (symbolIds.has(item.symbol) && symbolIds.get(item.symbol) !== item.instrumentId) ambiguousSymbols.add(item.symbol);
    symbolIds.set(item.symbol, item.instrumentId); byId.set(item.instrumentId, item);
  }
  for (const [id, item] of byId) if (ambiguousIds.has(id) || ambiguousSymbols.has(item.symbol)) byId.delete(id);
  const groups = new Map(); let omittedRowCount = 0;
  for (const row of aggregate.rows) {
    const id = identifier(row.aggregate?.instrumentId);
    if (!id || !boundedIds.has(id)) { omittedRowCount++; continue; }
    const key = `${row.scope}:${id}`;
    if (!groups.has(key)) groups.set(key, { id, scope: row.scope, aggregates: [] });
    groups.get(key).aggregates.push(row.aggregate);
  }
  const compatible = breakdown && breakdown.accountCurrency === aggregate.accountCurrency;
  const detailReason = breakdown && !compatible ? "Instrument-breakdown account currency does not match aggregate snapshot." : unavailableReason;
  let pendingOrderCount = compatible ? 0 : null;
  let openPositionCount = compatible ? 0 : null;
  const detailsByKey = new Map();
  if (compatible) for (const { instrument, scope } of breakdown.rows) {
    const key = `${scope}:${instrument.instrumentId}`;
    if (!detailsByKey.has(key)) detailsByKey.set(key, []);
    detailsByKey.get(key).push(...instrument.positions);
    pendingOrderCount += instrument.orders.length;
    openPositionCount += instrument.positions.length;
  }
  let unresolvedIndex = 0;
  const reservedSymbols = new Set([...byId.values()].map((item) => item.symbol));
  const unknownSymbol = () => { let symbol; do { symbol = `UNKNOWN.${++unresolvedIndex}`; } while (reservedSymbols.has(symbol)); reservedSymbols.add(symbol); return symbol; };
  const instruments = [...groups.values()].map(({ id, scope, aggregates }) => {
    const info = byId.get(id);
    const symbol = info?.symbol ?? unknownSymbol();
    const reasons = {}; const sources = {};
    const row = { symbol, displayName: safeText(info?.displayName, info?.symbol ?? "Unresolved instrument"), scope };
    const duplicateDirect = scope === "direct" && aggregates.length !== 1;
    for (const [key, [field, signed]] of Object.entries(fieldSpec)) {
      const values = aggregates.map((item) => {
        if (key === "netValue" && (item[field] === undefined || item[field] === null)) return sum([financialNumber(item.totalMarginAccountCurrency, false), financialNumber(item.accountCurrencyReturn)]);
        return financialNumber(item[field], signed);
      });
      row[key] = duplicateDirect ? null : sum(values);
      sources[key] = key === "netValue" && aggregates.some((item) => item[field] === undefined || item[field] === null) ? "derived.totalMarginAccountCurrency+accountCurrencyReturn" : `aggregate.${field}`;
      if (row[key] === null) reasons[key] = duplicateDirect ? "Ambiguous duplicate direct instrument aggregate." : aggregates.map((item) => sourceReason(item[field], signed)).find(Boolean) ?? "Aggregate exceeds the safe numeric range.";
    }
    const currencies = new Set(aggregates.map((item) => currencyCode(item.assetCurrency)));
    row.assetCurrency = currencies.size === 1 ? [...currencies][0] : null;
    const details = detailsByKey.get(`${scope}:${id}`);
    sources.positionCount = "breakdown.positions"; sources.currentPrice = "breakdown.positions.currentRate";
    sources.assetCurrency = "aggregate.assetCurrency"; sources.symbol = "market-data.symbolFull";
    sources.unrealizedPnlPercent = "derived.accountCurrencyReturn/totalMarginAccountCurrency*100";
    sources.allocationPercent = "derived.totalMarginAccountCurrency/accountTotalUsedMargin*100";
    const allPositions = (details ?? []).map(sanitizePosition);
    row.positions = allPositions.slice(0, 1000);
    row.positionsOmittedCount = Math.max(0, allPositions.length - 1000);
    if (row.positionsOmittedCount) reasons.positions = "Position detail display is limited to 1000; totals and consistency checks use all validated positions.";
    if (!duplicateDirect && details?.length) {
      for (const [key, field] of [["units", "units"], ["netContracts", "contracts"]]) {
        if (row[key] === null) {
          const net = sum(allPositions.map((position) => position.direction && position[field] !== null ? position[field] * (position.direction === "long" ? 1 : -1) : null));
          if (net !== null) { row[key] = net; sources[key] = `derived.breakdown.direction*${field}`; delete reasons[key]; }
        }
      }
      if (row.assetCurrency === null) {
        const nativeCurrencies = new Set(allPositions.map((position) => position.assetCurrency));
        if (nativeCurrencies.size === 1 && !nativeCurrencies.has(null)) { row.assetCurrency = [...nativeCurrencies][0]; sources.assetCurrency = "breakdown.positions.assetCurrency"; }
      }
    }
    row.positionCount = details ? details.length : null;
    const rowDetailReason = compatible ? "No matching instrument in the breakdown snapshot." : detailReason;
    if (!details) reasons.positionCount = rowDetailReason;
    // Preserve consistent raw native rates even when denomination is unknown.
    // Any conflicting supplied currency makes the aggregate price unavailable.
    const suppliedCurrencies = new Set([...aggregates.map((item) => currencyCode(item.assetCurrency)), ...allPositions.map((position) => position.assetCurrency)].filter(Boolean));
    const current = allPositions.map((position) => position.currentPrice);
    row.currentPrice = current.length && current.every((value) => value !== null && value === current[0]) && suppliedCurrencies.size <= 1 ? current[0] : null;
    if (row.currentPrice === null) reasons.currentPrice = details ? "Native current rates missing, differ, or have conflicting supplied currencies." : rowDetailReason;
    else if (row.assetCurrency === null) reasons.currentPrice = "Native price denomination is unverified.";
    const settlementTypes = new Set(allPositions.map((position) => position.settlementType));
    const contractsBasis = settlementTypes.size === 1 && settlementTypes.has("realFutures");
    const relevantNet = contractsBasis ? row.netContracts : row.units;
    // Missing quantity does not erase an independently supplied net rate.
    // With no evidenced settlement, a nonzero alternate net prevents calling
    // a zero-unit aggregate economically flat (e.g. futures contracts).
    const knownZeroNet = relevantNet === 0 && (contractsBasis || settlementTypes.size === 1 && !settlementTypes.has(null) || row.netContracts === 0);
    if (aggregates.length > 1 || knownZeroNet || duplicateDirect) { row.averageOpenPrice = null; reasons.averageOpenPrice = "No single direction-aware opening rate for combined or known zero-net positions."; }
    if (suppliedCurrencies.size > 1) { row.assetCurrency = null; reasons.assetCurrency = "Conflicting supplied native asset currencies."; }
    else if (row.assetCurrency === null) reasons.assetCurrency = "Native asset currency missing; denomination is unverified.";
    if (!info) reasons.symbol = metadataFailures.get(id) ?? "Instrument metadata missing or globally ambiguous.";
    row.unrealizedPnlPercent = row.investedValue !== null && row.investedValue > 0 && row.unrealizedPnl !== null ? financialNumber(row.unrealizedPnl / row.investedValue * 100) : null;
    if (row.unrealizedPnlPercent === null) reasons.unrealizedPnlPercent = row.investedValue === 0 ? "Return percentage undefined for zero margin." : "Validated margin and P/L required.";
    // ROE schema says ratio but the example shows percentage points: expose a
    // documented money-derived percentage and never guess the provider scale.
    row.allocationPercent = financialNumber(aggregate.accountTotals.accountTotalUsedMargin, false) > 0 && row.investedValue !== null ? financialNumber(row.investedValue / aggregate.accountTotals.accountTotalUsedMargin * 100, false) : null;
    if (row.allocationPercent === null) reasons.allocationPercent = "Validated positive account used margin and instrument margin required.";
    row.completeness = [row.investedValue, row.netValue, row.unrealizedPnl].every((value) => value !== null) && info ? "complete" : "partial";
    row.fieldReasons = reasons; row.fieldSources = sources;
    return row;
  });
  const data = { environment, currency: aggregate.accountCurrency, accountCurrency: aggregate.accountCurrency, conversionMode: "eToroApp", fieldReasons: {}, fieldSources: {}, instruments };
  const totals = { equity: "accountTotalValue", availableCash: "accountAvailableCash", totalInvested: "accountTotalUsedMargin", unrealizedPnl: "accountCurrentPnl", frozenCash: "accountFrozenCash", accountBalance: "accountBalance" };
  for (const [field, source] of Object.entries(totals)) {
    data.fieldSources[field] = `aggregate.accountTotals.${source}`;
    data[field] = financialNumber(aggregate.accountTotals[source], field === "unrealizedPnl" || field === "equity");
    if (data[field] === null) data.fieldReasons[field] = sourceReason(aggregate.accountTotals[source], field === "unrealizedPnl" || field === "equity");
  }
  data.fieldSources.usedMargin = "aggregate.accountTotals.accountTotalUsedMargin";
  data.fieldSources.mirrorCash = "aggregate.mirrors.mirrorAvailableCash";
  data.fieldSources.realizedPnl = "unavailable";
  data.fieldSources.openPositionCount = "breakdown.positions";
  data.fieldSources.pendingOrderCount = "breakdown.orders";
  data.usedMargin = data.totalInvested;
  if (data.usedMargin === null) data.fieldReasons.usedMargin = data.fieldReasons.totalInvested;
  data.mirrorCash = sum(aggregate.mirrors.map((mirror) => financialNumber(mirror.mirrorAvailableCash, false)));
  if (data.mirrorCash === null) data.fieldReasons.mirrorCash = "Mirror cash missing, invalid, or exceeds safe range.";
  data.realizedPnl = null; data.fieldReasons.realizedPnl = "Aggregate portfolio has no account realized P/L field.";
  data.openPositionCount = openPositionCount; data.pendingOrderCount = pendingOrderCount; data.mirrorCount = aggregate.mirrors.length;
  if (!compatible) { data.fieldReasons.openPositionCount = detailReason; data.fieldReasons.pendingOrderCount = data.fieldReasons.openPositionCount; }
  data.instrumentCount = instruments.length; data.providerUpdatedAt = aggregate.timestamp; data.breakdownUpdatedAt = compatible ? breakdown.timestamp : null;
  data.omittedRowCount = omittedRowCount; data.incompleteRowCount = instruments.filter((row) => row.completeness !== "complete").length;
  data.arithmetic = { equity: arithmetic(data.equity, [data.availableCash, data.totalInvested, data.unrealizedPnl]), cash: arithmetic(data.accountBalance, [data.availableCash, data.frozenCash]) };
  data.fieldSources.providerUpdatedAt = "aggregate.timestamp"; data.fieldSources.breakdownUpdatedAt = "breakdown.timestamp";
  if (!aggregate.timestamp) data.fieldReasons.providerUpdatedAt = aggregate.timestampReason;
  if (compatible && !breakdown.timestamp) data.fieldReasons.breakdownUpdatedAt = breakdown.timestampReason;
  if (aggregate.copyHoldingsUnknown || aggregate.manualHoldingsUnknown || compatible && breakdown.manualHoldingsUnknown) data.fieldReasons.coverage = "Copy collections are omitted or manual mirrorId=0 data is quarantined; holdings coverage is incomplete.";
  const applicableFailures = [...metadataFailures].filter(([id]) => boundedIds.has(id) && !byId.has(id)).map(([, reason]) => reason);
  const authorizationDegraded = applicableFailures.some((reason) => reason.includes("authorization"));
  if (applicableFailures.length) data.fieldReasons.coverage = [data.fieldReasons.coverage, authorizationDegraded ? "Instrument metadata authorization was rejected; see each unresolved identity reason." : "Instrument metadata requests are incomplete; see each unresolved identity reason."].filter(Boolean).join(" ");
  data.coverage = { copyHoldingsStatus: aggregate.copyHoldingsUnknown ? "incomplete" : "complete", manualHoldingsStatus: aggregate.manualHoldingsUnknown || compatible && breakdown.manualHoldingsUnknown ? "incomplete" : "complete", metadataStatus: authorizationDegraded ? "authorization-degraded" : byId.size === boundedIds.size ? "available" : byId.size ? "partial" : "unavailable", instrumentLimit: PORTFOLIO_INSTRUMENT_LIMIT, metadataResolvedCount: byId.size, metadataUnresolvedCount: boundedIds.size - byId.size, unsupportedInstrumentCount: Math.max(0, ids.length - PORTFOLIO_INSTRUMENT_LIMIT), breakdownStatus: compatible ? "available" : "unavailable", directInstrumentCount: instruments.filter((row) => row.scope === "direct").length, copyInstrumentCount: instruments.filter((row) => row.scope === "copy").length };
  return data;
}
