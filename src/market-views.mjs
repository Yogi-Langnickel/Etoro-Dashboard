const SAFE_MARKET_SYMBOL = /^[A-Z0-9][A-Z0-9._:/-]{0,31}$/;
const MAX_MARKET_RATE_SYMBOLS = 10;

export const MARKET_PERIODS = Object.freeze({
  "24h": Object.freeze({ interval: "OneHour", candlesCount: 24 }),
  "1w": Object.freeze({ interval: "FourHours", candlesCount: 42 }),
  "1m": Object.freeze({ interval: "OneDay", candlesCount: 31 }),
  "1y": Object.freeze({ interval: "OneDay", candlesCount: 366 }),
  "5y": Object.freeze({ interval: "OneWeek", candlesCount: 261 }),
  max: Object.freeze({ interval: "OneWeek", candlesCount: 1000 }),
});

export function marketInputError(message = "Market data query is invalid.") {
  const error = new Error(message);
  error.code = "ETORO_INVALID_MARKET_QUERY";
  error.status = 400;
  return error;
}
export function normalizeRequestedSymbol(value) {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!SAFE_MARKET_SYMBOL.test(symbol)) throw marketInputError();
  return symbol;
}

export function requestedSymbols(searchParams) {
  const raw = searchParams?.get("symbols") ?? "";
  const symbols = raw.split(",").filter(Boolean).map(normalizeRequestedSymbol);
  if (symbols.length === 0 || symbols.length > MAX_MARKET_RATE_SYMBOLS || new Set(symbols).size !== symbols.length) {
    throw marketInputError();
  }
  return symbols;
}

async function resolveExactSymbol(fetchEndpoint, config, symbol) {
  const result = await fetchEndpoint("instrumentSearch", {
    credentials: config,
    params: { symbol },
  });
  return { data: result.data, provider: result.provider };
}

function combinedProviderMetadata(endpoint, results) {
  const providers = results.map((result) => result?.provider).filter(Boolean);
  return {
    endpoint,
    method: "GET",
    status: 200,
    requestId: providers[0]?.requestId ?? null,
    receivedAt: providers.at(-1)?.receivedAt ?? new Date().toISOString(),
    durationMs: providers.reduce((total, provider) => total + (Number(provider.durationMs) || 0), 0),
  };
}

export async function defaultWatchlistView(config, fetchEndpoint) {
  const watchlist = await fetchEndpoint("defaultWatchlist", { credentials: config });
  const internalItems = watchlist.data.items;
  let rates = null;
  let rateFailure = false;

  if (internalItems.length > 0) {
    try {
      rates = await fetchEndpoint("marketRates", {
        credentials: config,
        params: { instrumentIds: internalItems.map(({ instrumentId }) => instrumentId) },
      });
    } catch {
      rateFailure = true;
    }
  }

  const ratesById = new Map((rates?.data.rates ?? []).map((rate) => [rate.instrumentId, rate]));
  const items = internalItems.map(({ instrumentId, symbol, displayName, rank }) => {
    const rate = ratesById.get(instrumentId);
    return {
      symbol,
      displayName,
      rank,
      bid: rate?.bid ?? null,
      ask: rate?.ask ?? null,
      lastExecution: rate?.lastExecution ?? null,
      rateUpdatedAt: rate?.updatedAt ?? null,
      rateStatus: rate ? "available" : "unavailable",
    };
  });
  const unavailableRateCount = items.filter(({ rateStatus }) => rateStatus === "unavailable").length;

  return {
    data: {
      source: "provider-default-watchlist",
      itemCount: items.length,
      omittedItemCount: watchlist.data.omittedItemCount,
      unavailableRateCount,
      providerState: rateFailure || unavailableRateCount > 0 ? "partial" : "complete",
      partialFailure: rateFailure ? { component: "rates", state: "unavailable" } : null,
      items,
    },
    provider: combinedProviderMetadata("defaultWatchlistView", [watchlist, rates]),
  };
}

export async function marketRatesView(config, fetchEndpoint, symbols) {
  const resolutions = await Promise.all(symbols.map(async (symbol) => {
    try {
      return { symbol, ...(await resolveExactSymbol(fetchEndpoint, config, symbol)), resolution: "exact" };
    } catch {
      return { symbol, data: null, provider: null, resolution: "unresolved" };
    }
  }));
  const exact = resolutions.filter(({ resolution }) => resolution === "exact");
  let rates = null;
  let rateFailure = false;
  if (exact.length > 0) {
    try {
      rates = await fetchEndpoint("marketRates", {
        credentials: config,
        params: { instrumentIds: exact.map(({ data }) => data.instrumentId) },
      });
    } catch {
      rateFailure = true;
    }
  }
  const ratesById = new Map((rates?.data.rates ?? []).map((rate) => [rate.instrumentId, rate]));
  const items = resolutions.map(({ symbol, data, resolution }) => {
    const rate = data ? ratesById.get(data.instrumentId) : null;
    return {
      symbol,
      displayName: data?.displayName ?? symbol,
      resolution,
      bid: rate?.bid ?? null,
      ask: rate?.ask ?? null,
      lastExecution: rate?.lastExecution ?? null,
      rateUpdatedAt: rate?.updatedAt ?? null,
      rateStatus: rate ? "available" : "unavailable",
    };
  });
  return {
    data: {
      requestedCount: symbols.length,
      exactMatchCount: exact.length,
      unavailableRateCount: items.filter(({ rateStatus }) => rateStatus === "unavailable").length,
      providerState: rateFailure || exact.length !== symbols.length || items.some(({ rateStatus }) => rateStatus === "unavailable")
        ? "partial"
        : "complete",
      items,
    },
    provider: combinedProviderMetadata("marketRatesView", [...resolutions, rates]),
  };
}

export async function marketChartView(config, fetchEndpoint, symbol, period) {
  const periodConfig = MARKET_PERIODS[period];
  if (!periodConfig) throw marketInputError();
  const resolution = await resolveExactSymbol(fetchEndpoint, config, symbol);
  const candles = await fetchEndpoint("marketCandles", {
    credentials: config,
    params: {
      instrumentId: resolution.data.instrumentId,
      direction: "asc",
      interval: periodConfig.interval,
      candlesCount: periodConfig.candlesCount,
    },
  });
  const points = candles.data.points;
  const first = points[0].close;
  const last = points.at(-1).close;
  return {
    data: {
      symbol,
      displayName: resolution.data.displayName,
      resolution: "exact",
      period,
      interval: candles.data.interval,
      pointCount: points.length,
      changePercent: first > 0 ? Number((((last - first) / first) * 100).toFixed(4)) : null,
      providerUpdatedAt: points.at(-1).at,
      points,
    },
    provider: combinedProviderMetadata("marketChartView", [resolution, candles]),
  };
}
