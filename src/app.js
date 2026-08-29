const formatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const portfolioTabId = "portfolio-view";
const botConfigCsrfResponseHeader = "x-etoro-dashboard-config-token";
const loadedTabIds = new Set();
let botConfigMutationProtection = null;
let botConfigOptionsPayload = null;
let selectedPortfolioSymbol = null;
let selectedPortfolioPeriod = "24h";
let portfolioDataSource = "none";
let selectedPortfolioEnvironment = null;
let portfolioChartRequestSequence = 0;
let etoroRefreshRequestSequence = 0;
let selectedWatchlistSymbol = "AAPL";
let selectedWatchlistPeriod = "24h";
let watchlistDataSource = "fixture";
let watchlistChartRequestSequence = 0;
const watchlistItemsBySymbol = new Map();

// Portfolio View never imports browser fixtures. Synthetic tabs keep their own visible watermarks.
const watchlistChartPoints = {};
const watchlistContextReceipts = {};
const watchlistPeriodChanges = {};

function chartPointsFor(pointsBySymbol, symbol, period, fallbackSymbol) {
  return pointsBySymbol[symbol]?.[period] ?? pointsBySymbol[fallbackSymbol]?.[period] ?? "";
}

const {
  hasExactKeys,
  isIsoInstant,
  normalizeMarketChartPayload,
  normalizeLivePortfolioPayload,
  normalizeWatchlistViewPayload,
} = globalThis.EtoroBrowserContracts;

function watchlistChartFor(symbol, period) {
  return chartPointsFor(watchlistChartPoints, symbol, period, "AAPL");
}

function text(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function setTile(id, state, title, detail) {
  const tile = document.getElementById(id);

  if (!tile) {
    return;
  }

  tile.classList.remove("ok", "warn", "neutral", "danger");
  tile.classList.add(state);
  tile.querySelector("strong").textContent = title;
  tile.querySelector("small").textContent = detail;
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? formatter.format(value) : "Unavailable";
}

function signedMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value >= 0 ? "+" : "-"}${formatter.format(Math.abs(value))}`;
}

function signedPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCacheDuration(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "read cache unavailable";
  }

  if (milliseconds >= 1000 && milliseconds % 1000 === 0) {
    return `${milliseconds / 1000}s read cache`;
  }

  return `${milliseconds} ms read cache`;
}

async function getJson(path) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message ?? `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }

  if (payload?.mutationProtection?.csrfHeader) {
    const csrfToken = response.headers.get(botConfigCsrfResponseHeader);
    payload.mutationProtection = {
      ...payload.mutationProtection,
      ...(csrfToken ? { csrfToken } : {}),
    };
  }
  if (payload?.config?.mutationProtection?.csrfHeader) {
    const csrfToken = response.headers.get(botConfigCsrfResponseHeader);
    payload.config.mutationProtection = {
      ...payload.config.mutationProtection,
      ...(csrfToken ? { csrfToken } : {}),
    };
  }

  return payload;
}

async function postJson(path, body) {
  return sendJsonWithMethod("POST", path, body);
}

async function putJson(path, body) {
  const headers = {};

  if (path === "/api/etoro/bot/config" && botConfigMutationProtection?.csrfHeader) {
    headers[botConfigMutationProtection.csrfHeader] = botConfigMutationProtection.csrfToken;
  }

  return sendJsonWithMethod("PUT", path, body, headers);
}

async function sendJsonWithMethod(method, path, body, extraHeaders = {}) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...extraHeaders,
    },
    method,
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message ?? `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function renderStatus(payload) {
  const status = payload.credentialStatus;
  const defaultEnvironment = selectedPortfolioEnvironment ?? (status?.defaultEnvironment === "demo" ? "demo" : "real");
  const readiness = payload.profileReadiness ?? {};
  const activeState = readiness[defaultEnvironment] ?? status?.profiles?.[defaultEnvironment]?.state ?? "not-configured";
  const configured = activeState === "ready";
  const cacheTtlMs = payload.cachePolicy?.readOnlyTtlMs ?? status?.readCacheTtlMs;

  setTile(
    "provider-status",
    configured ? "ok" : "warn",
    configured ? `${labelize(defaultEnvironment)} ready` : labelize(activeState),
    configured ? "Server-side read-only provider boundary" : "No synthetic portfolio fallback",
  );
  text(
    "source-detail",
    configured
      ? `${labelize(defaultEnvironment)} profile ready; ${formatCacheDuration(cacheTtlMs)}`
      : `${labelize(defaultEnvironment)} profile ${labelize(activeState)}; ${formatCacheDuration(cacheTtlMs)}`,
  );
  text("chart-provider", configured ? "Provider boundary: server-side only" : "Provider timestamp: unavailable");
  const select = document.getElementById("portfolio-environment");
  if (select) { select.value = defaultEnvironment; for (const option of select.options) option.disabled = readiness[option.value] === "not-configured"; }
  text("portfolio-environment-label", "Profile readiness");
  text(
    "portfolio-environment-detail",
    `Real ${labelize(readiness.real ?? "not-configured")} · Demo ${labelize(readiness.demo ?? "not-configured")}`,
  );
}

function renderAudit(message, detail, listId = "audit-list") {
  const list = document.getElementById(listId);

  if (!list) {
    return;
  }

  const item = document.createElement("li");
  const time = document.createElement("span");
  const body = document.createElement("span");
  const title = document.createElement("strong");
  const small = document.createElement("small");

  time.className = "event-time";
  time.textContent = new Date().toLocaleTimeString();
  title.textContent = message;
  small.textContent = detail;
  body.append(title, small);
  item.append(time, body);
  list.prepend(item);

  while (list.children.length > 5) {
    list.lastElementChild.remove();
  }
}

function renderTradingStatus(payload) {
  const configured = Boolean(payload.credentialStatus?.configured);
  const mutationsEnabled = Boolean(payload.mutationRoutesEnabled);
  const matrix = payload.permissionMatrix ?? [];
  const rateBudget = payload.rateBudget ?? {};
  const endpointTarget = document.getElementById("trading-endpoints");

  text("trading-credential-state", configured ? "Configured" : "Missing");
  text("trading-mutation-state", mutationsEnabled ? "Enabled" : "Disabled");
  text("trading-provider-scope", payload.demoOnly ? "Demo only" : "Unknown");
  text("trade-route-status", payload.demoTradePreviewEnabled ? "Preview enabled" : "Planning only");

  if (endpointTarget) {
    endpointTarget.textContent = "";

    for (const item of matrix) {
      const card = document.createElement("article");
      const label = document.createElement("span");
      const state = document.createElement("strong");
      const detail = document.createElement("small");

      card.className = "endpoint-card";
      label.textContent = item.label;
      state.textContent = labelize(item.state);
      detail.textContent = item.detail;
      card.append(label, state, detail);
      endpointTarget.append(card);
    }

    const rateCard = document.createElement("article");
    const rateLabel = document.createElement("span");
    const rateState = document.createElement("strong");
    const rateDetail = document.createElement("small");

    rateCard.className = "endpoint-card";
    rateLabel.textContent = "Rate budget";
    rateState.textContent = labelize(rateBudget.currentPressure);
    rateDetail.textContent = `${rateBudget.window ?? "unknown window"}; reserve: ${
      rateBudget.reservedHeadroom ?? "not set"
    }`;
    rateCard.append(rateLabel, rateState, rateDetail);
    endpointTarget.append(rateCard);
  }

  renderAudit(
    payload.demoTradePreviewEnabled ? "Demo preview route enabled" : "Demo execution route disabled",
    "Trade ticket preview never places orders; execution remains absent",
    "trading-audit-list",
  );
}

function labelize(value) {
  return String(value ?? "unknown")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function periodLabel(value) {
  return value === "max" ? "Max API window" : value;
}

function signedClass(value) {
  if (String(value).startsWith("+")) {
    return "good-text";
  }

  if (String(value).startsWith("-")) {
    return "bad-text";
  }

  return "neutral-text";
}

function setPerformanceChart(points) {
  const line = document.getElementById("performance-line");
  const area = document.getElementById("performance-area");

  if (!points) {
    return;
  }

  line?.setAttribute("points", points);
  area?.setAttribute("d", `M${points.replaceAll(" ", " L")} L640 260 L0 260 Z`);
}

function setChartPath(lineId, areaId, points) {
  const line = document.getElementById(lineId);
  const area = document.getElementById(areaId);

  if (!points) {
    return;
  }

  line?.setAttribute("points", points);
  area?.setAttribute("d", `M${points.replaceAll(" ", " L")} L640 260 L0 260 Z`);
}

function appendPortfolioCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function renderProviderPortfolio(payload) {
  const view = normalizeLivePortfolioPayload(payload);
  const body = document.getElementById("portfolio-table-body");

  if (!body) return view;

  portfolioDataSource = "provider-normalized";
  body.replaceChildren();
  for (const instrument of view.instruments) {
    const row = document.createElement("tr");
    row.className = "instrument-row";
    row.tabIndex = 0;
    row.dataset.instrumentRow = "";
    row.dataset.symbol = instrument.symbol;
    row.dataset.source = "provider-normalized";

    const assetCell = document.createElement("td");
    const symbol = document.createElement("strong");
    const detail = document.createElement("span");
    symbol.textContent = instrument.symbol;
    detail.textContent = `${instrument.displayName} · ${instrument.positionCount} aggregated position${instrument.positionCount === 1 ? "" : "s"}`;
    assetCell.append(symbol, detail);
    row.append(assetCell);

    appendPortfolioCell(row, money(instrument.currentPrice));
    const periodCell = appendPortfolioCell(row, "Unavailable", "neutral-text");
    periodCell.dataset.periodValue = "";
    appendPortfolioCell(row, instrument.units === null ? "Unavailable" : String(instrument.units));
    appendPortfolioCell(row, money(instrument.averageOpenPrice));
    appendPortfolioCell(row, signedMoney(instrument.unrealizedPnl), signedClass(signedMoney(instrument.unrealizedPnl)));
    appendPortfolioCell(row, signedPercent(instrument.unrealizedPnlPercent), signedClass(signedPercent(instrument.unrealizedPnlPercent)));
    appendPortfolioCell(row, money(instrument.investedValue));
    appendPortfolioCell(row, money(instrument.netValue));
    appendPortfolioCell(row, instrument.completeness === "complete" ? "Complete" : "Partial", instrument.completeness === "complete" ? "good-text" : "warn-text");
    bindPortfolioRow(row);
    body.append(row);
  }
  if (view.instruments.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = "No open positions";
    row.append(cell);
    body.append(row);
  }

  const rows = [...body.querySelectorAll("[data-instrument-row]")];
  const selected = rows.find((row) => row.dataset.symbol === selectedPortfolioSymbol) ?? rows[0];
  if (selected) {
    selectedPortfolioSymbol = selected.dataset.symbol;
    selected.classList.add("active");
  }

  text("mock-equity-label", "Equity");
  text("mock-equity", money(view.equity));
  text("equity-detail", "Provider-normalized equity");
  text("cash-buffer", money(view.availableCash));
  text("cash-buffer-detail", "Provider-normalized available cash");
  text("unrealized-pnl", signedMoney(view.unrealizedPnl));
  text("unrealized-pnl-detail", "Provider-normalized unrealized P/L");
  text("exposure", money(view.totalInvested));
  text("exposure-detail", "Provider-normalized total invested");
  text("stale-data-label", "Open positions");
  text("stale-data", String(view.openPositionCount));
  text("stale-data-detail", `${view.instrumentCount} instrument aggregate${view.instrumentCount === 1 ? "" : "s"}`);
  text("portfolio-source-watermark", `${labelize(view.environment)} provider`);
  text("portfolio-source-detail", "Read-only aggregate; no account, position, or order identifiers");

  const cacheState = view.cache?.state ?? "unknown";
  const cacheAge = view.cache?.cachedAt ? ` · cached ${view.cache.cachedAt}` : "";
  text("portfolio-read-state", `Portfolio: provider ${labelize(cacheState)}${cacheAge}`);
  text("portfolio-freshness", `Provider updated: ${view.providerUpdatedAt ?? "unavailable"}`);
  text("portfolio-omitted", `Omitted rows: ${view.omittedRowCount}`);
  text(
    "portfolio-partial",
    view.incompleteRowCount > 0
      ? `Partial values: ${view.incompleteRowCount} position${view.incompleteRowCount === 1 ? "" : "s"}`
      : "Value coverage: complete",
  );
  text("chart-provider", `Provider timestamp: ${view.providerUpdatedAt ?? "unavailable"}`);
  text("chart-request", "Provider request ID: hidden");
  text("chart-cache", `Cache: ${labelize(cacheState)} (${view.cache?.ttlMs ?? 0} ms)`);
  text("source-detail", view.incompleteRowCount > 0 ? "Partial normalized provider values" : "Normalized provider portfolio");
  const cashPercent = view.equity !== null && view.equity > 0 && view.availableCash !== null ? (view.availableCash / view.equity) * 100 : null;
  const largest = [...view.instruments].filter((instrument) => instrument.allocationPercent !== null).sort((left, right) => right.allocationPercent - left.allocationPercent)[0];
  text("portfolio-stat-cash", cashPercent === null ? "Cash percentage unavailable" : `Cash: ${cashPercent.toFixed(2)}%`);
  text("portfolio-stat-largest", largest ? `Largest holding: ${largest.symbol} (${largest.allocationPercent.toFixed(2)}%)` : "Largest holding unavailable");
  updatePortfolioPeriod(selectedPortfolioPeriod);
  return view;
}

function renderPortfolioReadFailure(error) {
  const payload = error?.payload ?? {};
  const cache = payload.cache;
  const code = payload.error?.code ?? error?.code ?? "";
  const status = payload.error?.status ?? error?.status ?? null;
  const validCache = cache &&
    hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs", "reason"]) &&
    new Set(["error", "backoff"]).has(cache.state) &&
    isIsoInstant(cache.cachedAt) &&
    isIsoInstant(cache.expiresAt) &&
    Number.isInteger(cache.ttlMs) &&
    cache.ttlMs > 0 &&
    cache.ttlMs <= 300_000 &&
    Date.parse(cache.expiresAt) - Date.parse(cache.cachedAt) === cache.ttlMs &&
    typeof cache.reason === "string" &&
    /^[A-Z0-9_]{1,80}$/.test(cache.reason);
  const state = validCache && cache.state === "backoff"
    ? "Portfolio: provider backoff"
    : code === "ETORO_TIMEOUT"
      ? "Portfolio: provider timeout"
      : code.startsWith("ETORO_INVALID_")
        ? "Portfolio: provider response malformed"
        : status === 429
          ? "Portfolio: provider rate-limited"
          : typeof status === "number" && status >= 500
            ? "Portfolio: provider unavailable"
            : "Portfolio: unavailable";
  text("portfolio-read-state", state);
  text("portfolio-freshness", "Freshness: unavailable; existing in-memory rows retained");
  text("portfolio-omitted", "Omitted rows: unavailable");
  text("portfolio-partial", validCache ? `Provider read failed; retry window ${cache.ttlMs} ms` : "Provider read failed; retry window unavailable");
}

function renderFulfilledProviderPortfolio(payload) {
  try {
    const view = renderProviderPortfolio(payload);
    renderAudit(
      "Provider portfolio loaded",
      `${view.instruments.length} instrument aggregates; ${view.omittedRowCount} unsafe rows omitted; no account or position IDs returned`,
    );
    return true;
  } catch (error) {
    renderPortfolioReadFailure(error);
    renderAudit(
      "Partial provider read",
      "Provider status loaded, but the portfolio response was invalid; existing rows are retained in memory only",
    );
    return false;
  }
}

async function renderSelectedPortfolioInstrument() {
  const sequence = ++portfolioChartRequestSequence;
  const line = document.getElementById("performance-line");
  const area = document.getElementById("performance-area");
  line?.setAttribute("points", ""); area?.setAttribute("d", "");
  text("selected-period-pill", periodLabel(selectedPortfolioPeriod));
  if (!selectedPortfolioSymbol || portfolioDataSource !== "provider-normalized") {
    text("chart-title", "Select a live holding"); text("chart-period-label", "Market-price history unavailable"); return;
  }
  text("chart-title", `${selectedPortfolioSymbol} market-price history`);
  text("chart-period-label", `Loading ${periodLabel(selectedPortfolioPeriod)} close points`);
  text("portfolio-financial-title", "Provider holding selected");
  text("portfolio-financial-detail", "Market history is independent from portfolio performance.");
  text("portfolio-news-title", "Unavailable"); text("portfolio-news-detail", "No synthetic market context is shown.");
  text("portfolio-insider-title", "Unavailable"); text("portfolio-insider-detail", "No synthetic ownership context is shown.");
  try {
    const chart = normalizeMarketChartPayload(await getJson(`/api/etoro/market/chart?symbol=${encodeURIComponent(selectedPortfolioSymbol)}&period=${encodeURIComponent(selectedPortfolioPeriod)}`), selectedPortfolioSymbol, selectedPortfolioPeriod);
    if (sequence !== portfolioChartRequestSequence) return;
    setPerformanceChart(marketChartSvgPoints(chart.points));
    text("chart-period-label", `Instrument market-price history · ${chart.pointCount} close points`);
    text("chart-provider", `Provider updated: ${chart.providerUpdatedAt}`);
    text("chart-cache", `Cache: ${labelize(chart.cache.state)} (${chart.cache.ttlMs} ms)`);
  } catch {
    if (sequence !== portfolioChartRequestSequence) return;
    text("chart-period-label", "Instrument market-price history unavailable");
    text("chart-cache", "Cache: unavailable");
  }
}

function updatePortfolioPeriod(period) {
  selectedPortfolioPeriod = period;

  document.querySelectorAll("[data-period]").forEach((button) => {
    const active = button.dataset.period === period;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-instrument-row]").forEach((row) => {
    const target = row.querySelector("[data-period-value]");
    if (target) { target.textContent = "Market history"; target.className = "neutral-text"; }
  });
  void renderSelectedPortfolioInstrument();
}

function selectPortfolioInstrument(row) {
  if (!row) {
    return;
  }

  selectedPortfolioSymbol = row.dataset.symbol ?? selectedPortfolioSymbol;

  document.querySelectorAll("[data-instrument-row]").forEach((candidate) => {
    candidate.classList.toggle("active", candidate === row);
  });

  renderSelectedPortfolioInstrument();
  renderAudit(
    `${selectedPortfolioSymbol} selected`,
    "Instrument summary row selected locally; enrichment receipts remain context-only",
  );
}

function bindPortfolioRow(row) {
  row.addEventListener("click", () => selectPortfolioInstrument(row));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPortfolioInstrument(row);
    }
  });
}

function bindWatchlistRow(row) {
  row.addEventListener("click", () => selectWatchlistInstrument(row));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectWatchlistInstrument(row);
    }
  });
}

function watchlistPrice(item) {
  if (item.rateStatus !== "available") return "Unavailable";
  const value = item.lastExecution ?? ((item.bid + item.ask) / 2);
  return money(value);
}

function appendWatchlistCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function marketChartSvgPoints(points) {
  const values = points.map(({ close }) => close);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low;
  return points.map(({ close }, index) => {
    const x = points.length === 1 ? 320 : (index / (points.length - 1)) * 640;
    const y = range === 0 ? 130 : 20 + ((high - close) / range) * 220;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function renderProviderWatchlist(payload, { refreshChart = true } = {}) {
  const view = normalizeWatchlistViewPayload(payload);
  const body = document.getElementById("watchlist-table-body");
  if (!body) return view;

  watchlistDataSource = "provider-normalized";
  watchlistItemsBySymbol.clear();
  body.replaceChildren();
  for (const item of view.items) {
    watchlistItemsBySymbol.set(item.symbol, item);
    const row = document.createElement("tr");
    row.className = "watchlist-row";
    row.tabIndex = 0;
    row.dataset.watchlistRow = "";
    row.dataset.watchlistSymbol = item.symbol;

    const symbolCell = document.createElement("td");
    const symbol = document.createElement("strong");
    symbol.textContent = item.symbol;
    symbolCell.append(symbol);
    row.append(symbolCell);
    appendWatchlistCell(row, item.displayName);
    appendWatchlistCell(row, watchlistPrice(item));
    const periodCell = appendWatchlistCell(row, "Unavailable", "neutral-text");
    periodCell.dataset.watchlistPeriodValue = "";
    const freshnessCell = document.createElement("td");
    const freshness = document.createElement("span");
    freshness.className = item.rateStatus === "available" ? "pill ok" : "pill warn";
    freshness.textContent = item.rateUpdatedAt ?? "Rate unavailable";
    freshnessCell.append(freshness);
    row.append(freshnessCell);
    appendWatchlistCell(row, item.rateStatus === "available" ? "Provider normalized" : "Partial provider read");
    bindWatchlistRow(row);
    body.append(row);
  }

  if (view.items.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.setAttribute("colspan", "6");
    cell.textContent = "No instrument items were returned by the default watchlist.";
    row.append(cell);
    body.append(row);
  }

  const rows = [...body.querySelectorAll("[data-watchlist-row]")];
  const selected = rows.find((row) => row.dataset.watchlistSymbol === selectedWatchlistSymbol) ?? rows[0];
  if (selected) {
    selectedWatchlistSymbol = selected.dataset.watchlistSymbol;
    selected.classList.add("active");
  }
  const state = document.getElementById("watchlist-provider-state");
  if (state) {
    state.textContent = view.providerState === "complete" ? "Provider complete" : "Provider partial";
    state.classList.toggle("lock", false);
    state.classList.toggle("warn", view.providerState === "partial");
    state.classList.toggle("ok", view.providerState === "complete");
  }
  text("watchlist-chart-source", `Source: provider ${labelize(view.cache.state)}`);
  text("watchlist-chart-freshness", `Cached: ${view.cache.cachedAt}`);
  text("research-watchlists-state", "Provider default watchlist");
  text("research-instruments-state", "Exact-symbol provider lookup");
  text("watchlist-source-policy", "Read-only provider fetch");
  renderAudit(
    "Default watchlist loaded",
    `${view.items.length} normalized instruments; ${view.omittedItemCount} omitted; ${view.unavailableRateCount} rates unavailable`,
    "research-audit-list",
  );
  if (refreshChart) updateWatchlistPeriod(selectedWatchlistPeriod);
  return view;
}

function renderWatchlistReadFailure() {
  const retained = watchlistDataSource === "provider-normalized";
  const state = document.getElementById("watchlist-provider-state");
  if (state) {
    state.textContent = retained ? "Provider rows stale" : "Watchlist unavailable";
    state.classList.add("warn");
    state.classList.remove("ok");
  }
  text("watchlist-chart-freshness", retained ? "Freshness: stale; in-memory rows retained" : "Freshness: unavailable");
  text("watchlist-source-policy", retained ? "Provider read stale" : "Provider unavailable");
  renderAudit(
    "Watchlist read unavailable",
    retained ? "Existing normalized rows remain in memory only" : "No account-linked watchlist data was retained",
    "research-audit-list",
  );
}

function renderMarketChart(payload, expectedSymbol, expectedPeriod) {
  const chart = normalizeMarketChartPayload(payload, expectedSymbol, expectedPeriod);
  const svgPoints = marketChartSvgPoints(chart.points);
  setChartPath("watchlist-performance-line", "watchlist-performance-area", svgPoints);
  text("watchlist-chart-title", `${chart.symbol} selected-period market chart`);
  text("watchlist-selected-period-pill", periodLabel(chart.period));
  text("watchlist-chart-period-label", `${periodLabel(chart.period)} · ${chart.interval} · ${chart.pointCount} points`);
  text("watchlist-chart-source", `Source: provider normalized · ${signedPercent(chart.changePercent)}`);
  text("watchlist-chart-freshness", `Provider updated: ${chart.providerUpdatedAt}`);
  text("watchlist-context-title", chart.displayName);
  text("watchlist-context-source", "Exact-symbol eToro market data");
  text("watchlist-context-freshness", chart.providerUpdatedAt);
  text("watchlist-context-detail", "Selected-period close prices are informational only and cannot trigger orders.");
  document.getElementById("watchlist-chart-shell")?.setAttribute(
    "aria-label",
    `${chart.symbol} ${periodLabel(chart.period)} normalized provider close-price chart`,
  );
  const selectedRow = [...document.querySelectorAll("[data-watchlist-row]")]
    .find((row) => row.dataset.watchlistSymbol === chart.symbol);
  const periodCell = selectedRow?.querySelector("[data-watchlist-period-value]");
  if (periodCell) {
    const value = signedPercent(chart.changePercent);
    periodCell.textContent = value;
    periodCell.classList.remove("good-text", "bad-text", "neutral-text");
    periodCell.classList.add(signedClass(value));
  }
  return chart;
}

async function refreshSelectedWatchlistMarket() {
  const requestSequence = ++watchlistChartRequestSequence;
  const symbol = selectedWatchlistSymbol;
  const period = selectedWatchlistPeriod;
  text("watchlist-selected-period-pill", periodLabel(period));
  text("watchlist-chart-title", `${symbol} market chart loading`);
  text("watchlist-chart-period-label", `Selected period: ${periodLabel(period)} · loading`);
  document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
  document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
  try {
    const payload = await getJson(`/api/etoro/market/chart?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`);
    if (requestSequence !== watchlistChartRequestSequence || symbol !== selectedWatchlistSymbol || period !== selectedWatchlistPeriod) return;
    renderMarketChart(payload, symbol, period);
  } catch {
    if (requestSequence !== watchlistChartRequestSequence) return;
    text("watchlist-chart-title", `${symbol} market chart unavailable`);
    text("watchlist-chart-period-label", `Selected period: ${periodLabel(period)} · unavailable`);
    text("watchlist-chart-freshness", "Freshness: unavailable; no fixture substitution");
    text("watchlist-context-source", "Provider market read unavailable");
  }
}

function renderSelectedWatchlistInstrument() {
  if (watchlistDataSource === "provider-normalized") {
    if (!watchlistItemsBySymbol.has(selectedWatchlistSymbol)) {
      watchlistChartRequestSequence += 1;
      text("watchlist-chart-title", "No watchlist instrument selected");
      text("watchlist-chart-period-label", "Selected-period market data unavailable");
      document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
      document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
      return;
    }
    void refreshSelectedWatchlistMarket();
    return;
  }
  const context = watchlistContextReceipts[selectedWatchlistSymbol] ?? watchlistContextReceipts.AAPL;

  if (!context) {
    text("watchlist-chart-title", "Watchlist market chart unavailable");
    text("watchlist-selected-period-pill", periodLabel(selectedWatchlistPeriod));
    text("watchlist-chart-period-label", "Selected-period market data unavailable");
    text("watchlist-context-title", "Unavailable");
    text("watchlist-context-source", "No synthetic fixture was loaded");
    text("watchlist-context-freshness", "Freshness: unavailable");
    text("watchlist-context-detail", "Provider watchlist reads are loaded only when this tab is opened.");
    return;
  }

  text("watchlist-chart-title", `${selectedWatchlistSymbol} watchlist chart`);
  text("watchlist-selected-period-pill", periodLabel(selectedWatchlistPeriod));
  text("watchlist-chart-period-label", `Selected period: ${periodLabel(selectedWatchlistPeriod)}`);
  text("watchlist-context-title", context[0]);
  text("watchlist-context-source", context[1]);
  text("watchlist-context-freshness", context[2]);
  text("watchlist-context-detail", context[3]);
  setChartPath(
    "watchlist-performance-line",
    "watchlist-performance-area",
    watchlistChartFor(selectedWatchlistSymbol, selectedWatchlistPeriod),
  );
}

function updateWatchlistPeriod(period) {
  selectedWatchlistPeriod = period;

  document.querySelectorAll("[data-watchlist-period]").forEach((button) => {
    const active = button.dataset.watchlistPeriod === period;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-watchlist-row]").forEach((row) => {
    const symbol = row.dataset.watchlistSymbol;
    const value = watchlistDataSource === "provider-normalized"
      ? "Unavailable"
      : watchlistPeriodChanges[symbol]?.[period] ?? "Unavailable";
    const target = row.querySelector("[data-watchlist-period-value]");

    if (target) {
      target.textContent = value;
      target.classList.remove("good-text", "bad-text", "neutral-text");
      target.classList.add(signedClass(value));
    }
  });

  renderSelectedWatchlistInstrument();
}

function selectWatchlistInstrument(row) {
  if (!row) {
    return;
  }

  selectedWatchlistSymbol = row.dataset.watchlistSymbol ?? selectedWatchlistSymbol;

  document.querySelectorAll("[data-watchlist-row]").forEach((candidate) => {
    candidate.classList.toggle("active", candidate === row);
  });

  renderSelectedWatchlistInstrument();
  renderAudit(
    `${selectedWatchlistSymbol} watchlist item selected`,
    "Watchlist row selected locally; context remains read-only and non-advisory",
    "research-audit-list",
  );
}

function renderFixtureWatermark(id, watermark) {
  const element = document.getElementById(id);

  if (!element || !watermark) {
    return;
  }

  element.textContent = watermark.safeForPublicDemo ? watermark.label : "Source review needed";
  element.title = watermark.detail ?? "";
  element.classList.toggle("warn", !watermark.safeForPublicDemo);
  element.classList.toggle("lock", Boolean(watermark.safeForPublicDemo));
}

function renderBotStatus(payload) {
  const telemetry = payload.telemetry ?? {};
  const safeguards = payload.safeguards ?? {};

  renderFixtureWatermark("bot-watermark-state", payload.fixtureWatermark);
  text("bot-enabled-state", payload.botEnabled ? "Enabled" : "Disabled");
  text("bot-freshness-state", labelize(telemetry.freshness));
  text("bot-telemetry-source", labelize(telemetry.source));
  text("bot-pending-count", String(telemetry.pendingExecutionCount ?? 0));
  text("bot-kill-switch", labelize(safeguards.killSwitch));
  text("bot-execution-state", labelize(safeguards.executionRoutes));
  text("bot-account-id-state", labelize(safeguards.accountIdentifiers));
  text("bot-payload-state", labelize(safeguards.rawProviderPayloads));
  text("bot-strategy-control-state", labelize(payload.controlPolicy?.strategySelection));
  text("bot-budget-state", money(payload.budgetPolicy?.baseBudgetUsd));
  text("bot-profit-state", labelize(payload.budgetPolicy?.profitReuse));
  text("bot-universe-state", (payload.instrumentUniverse?.defaultAllowed ?? []).map(labelize).join(", "));
  text("bot-sheets-state", labelize(payload.auditExport?.googleSheets));
  text("bot-daily-loss-state", money(payload.budgetPolicy?.hardStops?.dailyLossUsd));
  text("bot-weekly-loss-state", money(payload.budgetPolicy?.hardStops?.weeklyLossUsd));
  text("bot-open-position-state", String(payload.budgetPolicy?.hardStops?.maxOpenPositions ?? "Unavailable"));
  text("bot-cadence-state", labelize(payload.schedulePolicy?.minimumCadence));
  text("bot-hft-state", labelize(payload.schedulePolicy?.highFrequencyTrading));

  const modePill = document.getElementById("bot-mode-pill");

  if (modePill) {
    modePill.textContent = payload.simulatedTelemetryOnly ? "Synthetic only" : "Live telemetry";
    modePill.classList.toggle("warn", !payload.simulatedTelemetryOnly);
    modePill.classList.toggle("lock", payload.simulatedTelemetryOnly);
  }

  renderAudit(
    payload.botEnabled ? "Bot telemetry enabled" : "Bot monitor disabled",
    "Read-only DTO loaded; execution, account mutation, and raw payloads remain blocked",
    "bot-audit-list",
  );
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function renderBotStrategies(payload) {
  const target = document.getElementById("bot-strategies");

  if (!target) {
    return;
  }

  target.textContent = "";

  for (const strategy of payload.strategies ?? []) {
    const card = document.createElement("article");
    const header = document.createElement("header");
    const titleWrap = document.createElement("span");
    const title = document.createElement("strong");
    const version = document.createElement("small");
    const status = document.createElement("span");
    const detail = document.createElement("p");
    const meta = document.createElement("div");

    card.className = "strategy-card";
    status.className = "pill lock";
    meta.className = "strategy-meta";
    title.textContent = strategy.name;
    version.textContent = strategy.version;
    status.textContent = labelize(strategy.status);
    detail.textContent = strategy.lastValidation?.detail ?? "Synthetic strategy only.";

    for (const [label, value] of Object.entries(strategy.riskBudget ?? {})) {
      const chip = document.createElement("span");
      chip.className = "pill";
      chip.textContent = `${labelize(label)}: ${value}`;
      meta.append(chip);
    }

    titleWrap.append(title, version);
    header.append(titleWrap, status);
    card.append(header, detail, meta);
    target.append(card);
  }
}

function setCheckboxGroup(name, values) {
  const selected = new Set(values ?? []);

  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function renderBotConfig(configPayload) {
  const config = configPayload.config ?? {};
  const source = configPayload.persistence?.persisted ? "Persisted server-side" : "Default server config";
  botConfigMutationProtection = configPayload.mutationProtection ?? botConfigMutationProtection;

  text("bot-config-source-state", source);
  text("bot-budget-state", money(config.budgetUsd));
  text("bot-cadence-state", labelize(config.cadence));
  text("bot-universe-state", (config.allowedMarkets ?? []).map(labelize).join(", "));
  text("bot-instrument-class-state", (config.allowedInstrumentClasses ?? []).map(labelize).join(", "));

  const runModeSelect = document.getElementById("bot-run-mode-select");
  const strategySelect = document.getElementById("bot-strategy-select");
  const budgetSelect = document.getElementById("bot-budget-select");
  const cadenceSelect = document.getElementById("bot-cadence-select");

  if (runModeSelect) {
    runModeSelect.value = config.runMode ?? "backtest";
  }

  if (strategySelect) {
    strategySelect.value = config.strategyId ?? "";
  }

  if (budgetSelect) {
    budgetSelect.value = String(config.budgetUsd ?? "");
  }

  if (cadenceSelect) {
    cadenceSelect.value = config.cadence ?? "";
  }

  setCheckboxGroup("bot-allowed-markets", config.allowedMarkets);
  setCheckboxGroup("bot-instrument-classes", config.allowedInstrumentClasses);
  applyBotStrategyRuleControls(configPayload);
}

function applyBotStrategyRuleControls(configPayload = botConfigOptionsPayload) {
  const strategyId = ticketValue("bot-strategy-select");
  const rule = configPayload?.options?.strategyRules?.[strategyId];

  if (!rule) {
    return;
  }

  document.querySelectorAll('input[name="bot-allowed-markets"]').forEach((input) => {
    input.disabled = !(rule.allowedMarkets ?? []).includes(input.value);

    if (input.disabled) {
      input.checked = false;
    }
  });

  document.querySelectorAll('input[name="bot-instrument-classes"]').forEach((input) => {
    input.disabled = !(rule.allowedInstrumentClasses ?? []).includes(input.value);

    if (input.disabled) {
      input.checked = false;
    }
  });

  const cadenceSelect = document.getElementById("bot-cadence-select");

  if (cadenceSelect) {
    for (const option of cadenceSelect.options) {
      option.disabled = option.value !== rule.cadence;
    }

    cadenceSelect.value = rule.cadence;
  }
}

function renderBotControlSelects(statusPayload, strategiesPayload, configPayload) {
  const runModeSelect = document.getElementById("bot-run-mode-select");
  const select = document.getElementById("bot-strategy-select");
  const budgetSelect = document.getElementById("bot-budget-select");
  const cadenceSelect = document.getElementById("bot-cadence-select");
  const marketTarget = document.getElementById("bot-market-options");
  const classTarget = document.getElementById("bot-instrument-class-options");
  const strategyById = new Map((strategiesPayload.strategies ?? []).map((strategy) => [strategy.strategyId, strategy]));
  botConfigOptionsPayload = configPayload;

  if (runModeSelect) {
    runModeSelect.textContent = "";

    for (const runMode of configPayload.options?.runModes ?? []) {
      const option = document.createElement("option");
      const policy = configPayload.options?.runModePolicy?.[runMode];
      option.value = runMode;
      option.textContent = policy?.enabled ? labelize(runMode) : `${labelize(runMode)} (disabled)`;
      option.disabled = !policy?.enabled;
      option.title = policy?.reason ?? "";
      runModeSelect.append(option);
    }

    runModeSelect.disabled = false;
  }

  if (select) {
    select.textContent = "";

    for (const strategyId of statusPayload.controlPolicy?.allowedStrategyIds ?? []) {
      const strategy = strategyById.get(strategyId);
      const option = document.createElement("option");
      option.value = strategyId;
      option.textContent = strategy?.name ?? labelize(strategyId);
      select.append(option);
    }

    select.disabled = false;
  }

  if (budgetSelect) {
    budgetSelect.textContent = "";

    for (const budget of statusPayload.budgetPolicy?.selectableBudgetsUsd ?? []) {
      const option = document.createElement("option");
      option.value = String(budget);
      option.textContent = money(budget);
      budgetSelect.append(option);
    }

    budgetSelect.disabled = false;
  }

  if (cadenceSelect) {
    cadenceSelect.textContent = "";

    for (const cadence of configPayload.options?.cadences ?? []) {
      const option = document.createElement("option");
      option.value = cadence;
      option.textContent = labelize(cadence);
      cadenceSelect.append(option);
    }

    cadenceSelect.disabled = false;
  }

  if (marketTarget) {
    marketTarget.textContent = "";

    for (const market of configPayload.options?.markets ?? []) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const span = document.createElement("span");

      input.type = "checkbox";
      input.name = "bot-allowed-markets";
      input.value = market;
      span.textContent = labelize(market);
      label.append(input, span);
      marketTarget.append(label);
    }
  }

  if (classTarget) {
    classTarget.textContent = "";

    for (const instrumentClass of configPayload.options?.instrumentClasses ?? []) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const span = document.createElement("span");

      input.type = "checkbox";
      input.name = "bot-instrument-classes";
      input.value = instrumentClass;
      span.textContent = labelize(instrumentClass);
      label.append(input, span);
      classTarget.append(label);
    }
  }

  renderBotConfig(configPayload);
}

function renderBotRuns(payload) {
  const target = document.getElementById("bot-runs");

  if (!target) {
    return;
  }

  target.textContent = "";

  for (const run of payload.runs ?? []) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    state.className = run.riskResult === "blocked" ? "pill warn" : "pill ok";
    title.textContent = `${run.strategyId} / ${labelize(run.decision)}`;
    state.textContent = labelize(run.riskResult);
    detail.textContent = `${labelize(run.reasonCode)} at ${new Date(run.evaluatedAt).toLocaleTimeString()}; orders: ${
      run.hypotheticalOrderCount ?? 0
    }`;
    top.append(title, state);
    row.append(top, detail);
    target.append(row);
  }
}

function renderBotEvents(payload) {
  const target = document.getElementById("bot-events");

  if (!target) {
    return;
  }

  target.textContent = "";

  for (const event of payload.events ?? []) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const severity = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    severity.className = event.severity === "warn" ? "pill warn" : "pill ok";
    title.textContent = event.title;
    severity.textContent = labelize(event.type);
    detail.textContent = event.detail;
    top.append(title, severity);
    row.append(top, detail);
    target.append(row);
  }
}

function renderBotTradeLog(payload) {
  const target = document.getElementById("bot-trade-log");

  if (!target) {
    return;
  }

  target.textContent = "";

  if (payload.reportContract) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    state.className = "pill lock";
    title.textContent = "Report contract";
    state.textContent = labelize(payload.reportContract.version);
    detail.textContent = `${labelize(payload.reportContract.ledgerType)}; ${
      labelize(payload.reportContract.executionCapability)
    } execution; ${labelize(payload.reportContract.exportState)}`;
    top.append(title, state);
    row.append(top, detail);
    target.append(row);
  }

  for (const entry of payload.entries ?? []) {
    const row = document.createElement("li");
    const top = document.createElement("span");
    const title = document.createElement("strong");
    const state = document.createElement("span");
    const detail = document.createElement("small");

    top.className = "decision-row";
    state.className = entry.decision === "blocked" ? "pill warn" : "pill ok";
    title.textContent = `${entry.instrument?.symbol ?? "Synthetic"} / ${labelize(entry.action)}`;
    state.textContent = labelize(entry.reasonCode);
    detail.textContent = `${entry.strategyId}; allocated ${money(entry.budget?.allocatedUsd)}; remaining ${
      money(entry.budget?.remainingUsd)
    }`;
    top.append(title, state);
    row.append(top, detail);
    target.append(row);
  }

  text("bot-trade-log-state", labelize(payload.summary?.source));
}

function renderBotAuditFeed(payload) {
  const list = document.getElementById("bot-audit-list");

  if (!list) {
    return;
  }

  list.textContent = "";

  for (const event of payload.auditEvents ?? []) {
    const item = document.createElement("li");
    const time = document.createElement("span");
    const body = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("small");

    time.className = "event-time";
    time.textContent = new Date(event.createdAt).toLocaleTimeString();
    title.textContent = labelize(event.action);
    detail.textContent = `${labelize(event.outcome)} / ${event.entityRef}`;
    body.append(title, detail);
    item.append(time, body);
    list.append(item);
  }
}

function renderRiskStatus(payload) {
  const risk = payload.portfolioRisk ?? {};
  const safeguards = payload.safeguards ?? {};
  const checks = payload.checks ?? [];
  const checkTarget = document.getElementById("risk-checks");

  renderFixtureWatermark("risk-watermark-state", payload.fixtureWatermark);
  text("risk-source-state", labelize(risk.source));
  text("risk-freshness-state", labelize(risk.freshness));
  text("risk-exposure-state", risk.grossExposurePct === null ? "Unavailable" : `${risk.grossExposurePct}%`);
  text("risk-cash-state", risk.cashBufferPct === null ? "Unavailable" : `${risk.cashBufferPct}%`);
  text("risk-position-state", risk.largestPositionPct === null ? "Unavailable" : `${risk.largestPositionPct}%`);
  text("risk-stale-state", String(risk.stalePositionCount ?? 0));
  text("risk-execution-state", labelize(safeguards.executionRoutes));
  text("risk-payload-state", labelize(safeguards.rawProviderPayloads));
  text("risk-account-state", labelize(safeguards.accountIdentifiers));

  const modePill = document.getElementById("risk-mode-pill");

  if (modePill) {
    modePill.textContent = payload.livePortfolioConnected ? "Live reads" : "Synthetic only";
    modePill.classList.toggle("warn", !payload.livePortfolioConnected);
    modePill.classList.toggle("lock", !payload.livePortfolioConnected);
  }

  if (checkTarget) {
    checkTarget.textContent = "";

    for (const check of checks) {
      const item = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      pill.className = `pill ${check.state === "ok" ? "ok" : check.state === "warn" ? "warn" : "lock"}`;
      pill.textContent = labelize(check.state);
      title.textContent = check.label;
      detail.textContent = check.detail;
      body.append(title, detail);
      item.append(body, pill);
      checkTarget.append(item);
    }
  }

  renderAudit(
    "Risk radar loaded",
    "Read-only DTO loaded; portfolio IDs, raw provider payloads, and execution routes remain absent",
    "risk-audit-list",
  );
}

function renderResearchStatus(payload) {
  const sources = payload.dataSources ?? {};
  const lookup = payload.instrumentLookup ?? {};
  const safeguards = payload.safeguards ?? {};
  const marketNews = payload.marketNews ?? {};
  const intelligence = payload.intelligence ?? {};
  const preview = payload.watchlistPreview ?? [];
  const previewTarget = document.getElementById("research-watchlist");
  const newsTarget = document.getElementById("research-news");
  const positionNewsTarget = document.getElementById("research-position-news");
  const sourceTarget = document.getElementById("research-sources");
  const financialTarget = document.getElementById("research-financial-records");
  const insiderTarget = document.getElementById("research-insider-activity");
  const fieldsTarget = document.getElementById("research-fields");
  const providerTarget = document.getElementById("research-provider-readiness");

  text("research-watchlists-state", labelize(sources.watchlists));
  text("research-instruments-state", labelize(sources.instruments));
  text("research-news-state", labelize(sources.marketNews));
  text("research-records-state", labelize(sources.financialRecords));
  text("research-insider-state", labelize(sources.insiderTransactions));
  text("research-feed-state", labelize(sources.socialFeed));
  text("research-recommendations-state", labelize(sources.recommendations));
  text("research-lookup-state", lookup.enabled ? "Enabled" : "Disabled");
  text("research-symbol-state", labelize(lookup.exactSymbolLookup));
  text("research-watchlist-write-state", labelize(safeguards.watchlistMutation));
  text("research-feed-write-state", labelize(safeguards.feedPosting));
  text("research-account-state", labelize(safeguards.accountIdentifiers));

  if (previewTarget) {
    previewTarget.textContent = "";

    for (const item of preview) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const symbol = document.createElement("strong");
      const note = document.createElement("small");
      const pill = document.createElement("span");

      symbol.textContent = item.symbol;
      note.textContent = `${item.assetClass} - ${item.note}`;
      pill.className = "pill lock";
      pill.textContent = labelize(item.state);
      body.append(symbol, note);
      row.append(body, pill);
      previewTarget.append(row);
    }
  }

  if (fieldsTarget) {
    fieldsTarget.textContent = "";
    fieldsTarget.textContent = (lookup.requiredFields ?? []).join(", ");
  }

  if (newsTarget) {
    newsTarget.textContent = "";

    for (const item of marketNews.rowPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = `${item.symbol} - ${item.headline}`;
      detail.textContent = `Source: ${item.source}; attached to ${item.attachedTo}`;
      pill.className = "pill lock";
      pill.textContent = labelize(item.state);
      body.append(title, detail);
      row.append(body, pill);
      newsTarget.append(row);
    }
  }

  if (sourceTarget) {
    sourceTarget.textContent = "";

    for (const item of intelligence.sourcePriority ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = item.label;
      detail.textContent = `${item.coverage}; ${item.use}`;
      pill.className = item.access?.includes("official") ? "pill ok" : "pill warn";
      pill.textContent = labelize(item.access);
      body.append(title, detail);
      row.append(body, pill);
      sourceTarget.append(row);
    }
  }

  if (providerTarget) {
    providerTarget.textContent = "";

    for (const item of intelligence.providerReadiness ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = item.label;
      detail.textContent = `${labelize(item.defaultState)}; ${item.credentialHandling}`;
      pill.className = item.defaultState?.includes("disabled") ? "pill warn" : "pill lock";
      pill.textContent = item.liveNetworkConnected ? "Live" : "Metadata only";
      body.append(title, detail);
      row.append(body, pill);
      providerTarget.append(row);
    }
  }

  if (financialTarget) {
    financialTarget.textContent = "";

    for (const item of intelligence.financialRecordsPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");
      const figures = (item.keyFigures ?? [])
        .map((figure) => `${figure.label}: ${figure.value}`)
        .join("; ");

      title.textContent = `${item.symbol} - ${labelize(item.coverageState)}`;
      detail.textContent = `${item.assetClass}; ${figures}`;
      pill.className = `pill ${item.coverageState === "sufficient-data" ? "ok" : item.coverageState === "needs-review" ? "warn" : "lock"}`;
      pill.textContent = "Coverage";
      body.append(title, detail);
      row.append(body, pill);
      financialTarget.append(row);
    }
  }

  if (insiderTarget) {
    insiderTarget.textContent = "";

    for (const item of intelligence.insiderActivityPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");

      title.textContent = `${item.symbol} - ${labelize(item.netDirection)}`;
      detail.textContent = `${item.latestWindow}; ${item.notableActivity}`;
      pill.className = "pill lock";
      pill.textContent = labelize(item.sourceState);
      body.append(title, detail);
      row.append(body, pill);
      insiderTarget.append(row);
    }
  }

  if (positionNewsTarget) {
    positionNewsTarget.textContent = "";

    for (const item of payload.positionContextPreview ?? []) {
      const row = document.createElement("li");
      const body = document.createElement("span");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      const pill = document.createElement("span");
      const firstNews = item.news?.[0];

      title.textContent = `${item.symbol} - ${firstNews?.headline ?? "No context"}`;
      detail.textContent = `${item.assetClass}; ${firstNews?.summary ?? "Context unavailable"}`;
      pill.className = "pill lock";
      pill.textContent = item.contextOnly ? "Context only" : labelize(item.positionState);
      body.append(title, detail);
      row.append(body, pill);
      positionNewsTarget.append(row);
    }
  }

  renderAudit(
    "Research desk loaded",
    marketNews.enabled
      ? "Server-side market news summaries loaded for portfolio context"
      : "Official/free APIs are preferred; scraping is fallback only and cannot trigger trades",
    "research-audit-list",
  );
}

async function refreshResearchStatus() {
  const [researchResult, watchlistResult] = await Promise.allSettled([
    getJson("/api/etoro/research/status"),
    getJson("/api/etoro/watchlist/default"),
  ]);
  if (researchResult.status === "fulfilled") {
    renderResearchStatus(researchResult.value);
  } else {
    text("research-watchlists-state", "Unavailable");
    text("research-instruments-state", "Unavailable");
    renderAudit("Research desk failed", "Research status is unavailable", "research-audit-list");
  }
  if (watchlistResult.status === "fulfilled") {
    try {
      renderProviderWatchlist(watchlistResult.value);
    } catch {
      renderWatchlistReadFailure();
    }
  } else {
    renderWatchlistReadFailure();
  }
}

async function refreshRiskStatus() {
  try {
    const status = await getJson("/api/etoro/risk/status");
    renderRiskStatus(status);
  } catch (error) {
    text("risk-source-state", "Unavailable");
    text("risk-freshness-state", "Unavailable");
    renderAudit("Risk radar failed", error.message, "risk-audit-list");
  }
}

async function refreshBotStatus() {
  try {
    const { status, strategies, config, runs, audit, events, tradeLog } = await getJson("/api/etoro/bot/snapshot");
    renderBotStatus(status);
    renderBotControlSelects(status, strategies, config);
    renderBotStrategies(strategies);
    renderBotRuns(runs);
    renderBotAuditFeed(audit);
    renderBotEvents(events);
    renderBotTradeLog(tradeLog);
  } catch (error) {
    text("bot-enabled-state", "Unavailable");
    text("bot-freshness-state", "Unavailable");
    renderAudit("Bot status failed", error.message, "bot-audit-list");
  }
}

async function refreshTradingStatus() {
  try {
    const status = await getJson("/api/etoro/demo/trading/status");
    renderTradingStatus(status);
  } catch (error) {
    text("trading-credential-state", "Unavailable");
    renderAudit("Trading status failed", error.message, "trading-audit-list");
  }
}

async function refreshTabStatus(targetId, { force = false } = {}) {
  if (!targetId) {
    return;
  }

  if (!force && loadedTabIds.has(targetId)) {
    return;
  }

  const refreshers = {
    "bot-view": async () => {
      await refreshBotStatus();
      await refreshTradingStatus();
    },
    "portfolio-view": refreshRiskStatus,
    "watchlist-view": refreshResearchStatus,
  };
  const refresher = refreshers[targetId];

  if (!refresher) {
    return;
  }

  await refresher();
  loadedTabIds.add(targetId);
}

function activeTabId() {
  return document.querySelector("[data-tab-target].active")?.dataset.tabTarget ?? portfolioTabId;
}

function activateTab(targetId) {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === targetId;

    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== targetId;
  });

  void refreshTabStatus(targetId);
}

async function refreshEtoro() {
  const sequence = ++etoroRefreshRequestSequence;
  const button = document.getElementById("refresh-etoro");

  if (button) {
    button.disabled = true;
  }

  try {
    await getJson("/api/health");
    const status = await getJson("/api/etoro/status");
    if (sequence !== etoroRefreshRequestSequence) return;
    selectedPortfolioEnvironment ??= status.credentialStatus?.defaultEnvironment === "demo" ? "demo" : "real";
    const environment = selectedPortfolioEnvironment;
    renderStatus(status);
    const selectedState = status.profileReadiness?.[environment] ?? "not-configured";
    const portfolioRead = selectedState === "ready"
      ? getJson(`/api/etoro/portfolio?environment=${encodeURIComponent(environment)}`)
      : Promise.resolve(null);
    const [portfolioResult] = await Promise.allSettled([
      portfolioRead,
      refreshTabStatus(activeTabId(), { force: true }),
    ]);
    if (sequence !== etoroRefreshRequestSequence || environment !== selectedPortfolioEnvironment) return;

    if (selectedState !== "ready") {
      const retainedProviderRows = portfolioDataSource === "provider-normalized";
      text(
        "portfolio-read-state",
        retainedProviderRows ? "Portfolio: prior provider rows retained in memory" : `Portfolio: ${labelize(selectedState)}`,
      );
      text(
        "portfolio-freshness",
        retainedProviderRows ? "Freshness: stale; provider is no longer configured" : "Freshness: provider not configured",
      );
      if (!retainedProviderRows) {
        text("portfolio-omitted", "Omitted rows: unavailable until provider read");
        text("portfolio-partial", "No provider portfolio values loaded");
      }
      renderAudit(
        retainedProviderRows ? "Provider rows retained in memory" : "Portfolio provider unavailable",
        retainedProviderRows
          ? "Provider access is no longer configured; no refresh was attempted and prior rows are marked stale"
          : "No credentials or synthetic portfolio values are present in the browser",
      );
    } else if (portfolioResult.status === "fulfilled") {
      if (renderFulfilledProviderPortfolio(portfolioResult.value)) {
        const cache = portfolioResult.value?.cache;
        const detail = cache?.state === "stale"
          ? `Stale provider data cached ${cache.cachedAt}`
          : `Provider data cached ${cache?.cachedAt ?? "just now"}`;
        setTile("last-sync", cache?.state === "stale" ? "warn" : "ok", "Last sync", detail);
      }
    } else {
      renderPortfolioReadFailure(portfolioResult.reason);
      renderAudit(
        "Partial provider read",
        "Provider status loaded, but portfolio data is unavailable; existing rows are retained in memory only",
      );
    }
  } catch (error) {
    if (sequence !== etoroRefreshRequestSequence) return;
    setTile("provider-status", "warn", "Provider unavailable", "No synthetic portfolio fallback");
    await refreshTabStatus(activeTabId(), { force: true });
    renderPortfolioReadFailure(error);
    renderAudit("Provider read failed", "Provider status is unavailable; no account-linked data was stored");
  } finally {
    if (button && sequence === etoroRefreshRequestSequence) {
      button.disabled = false;
    }
  }
}

function ticketValue(id) {
  return document.getElementById(id)?.value?.trim() ?? "";
}

function collectTradeTicket() {
  return {
    orderType: ticketValue("trade-order-type"),
    instrumentId: ticketValue("trade-instrument-id"),
    side: ticketValue("trade-side"),
    amount: ticketValue("trade-amount"),
    units: ticketValue("trade-units"),
    leverage: ticketValue("trade-leverage"),
    stopLoss: ticketValue("trade-stop-loss"),
    takeProfit: ticketValue("trade-take-profit"),
    positionId: ticketValue("trade-position-id"),
  };
}

function collectBotConfig() {
  return {
    runMode: ticketValue("bot-run-mode-select"),
    strategyId: ticketValue("bot-strategy-select"),
    budgetUsd: Number(ticketValue("bot-budget-select")),
    allowedMarkets: checkedValues("bot-allowed-markets"),
    allowedInstrumentClasses: checkedValues("bot-instrument-classes"),
    cadence: ticketValue("bot-cadence-select"),
  };
}

document.getElementById("refresh-etoro")?.addEventListener("click", refreshEtoro);
document.getElementById("portfolio-environment")?.addEventListener("change", (event) => {
  etoroRefreshRequestSequence += 1;
  selectedPortfolioEnvironment = event.target.value === "demo" ? "demo" : "real";
  portfolioDataSource = "none";
  selectedPortfolioSymbol = null;
  document.getElementById("portfolio-table-body")?.replaceChildren();
  void refreshEtoro();
});
document.getElementById("trade-ticket")?.addEventListener("submit", (event) => {
  event.preventDefault();
  renderAudit("Trade submit blocked", "No local execution route exists in this slice", "trading-audit-list");
});
document.getElementById("trade-preview-blocked")?.addEventListener("click", async () => {
  try {
    const preview = await postJson("/api/etoro/demo/trading/preview", collectTradeTicket());
    renderAudit(
      "Trade preview generated",
      `${preview.ticket.orderType} validation passed; execution blocked`,
      "trading-audit-list",
    );
  } catch (error) {
    renderAudit("Trade preview blocked", error.message, "trading-audit-list");
  }
});
document.getElementById("bot-strategy-select")?.addEventListener("change", (event) => {
  applyBotStrategyRuleControls();
  renderAudit(
    "Strategy preview changed",
    `${labelize(event.target.value)} selected locally; save to persist on the server`,
    "bot-audit-list",
  );
});
document.getElementById("bot-budget-select")?.addEventListener("change", (event) => {
  renderAudit(
    "Budget preview changed",
    `${money(Number(event.target.value))} selected locally; save to persist on the server`,
    "bot-audit-list",
  );
});
document.getElementById("bot-config-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const saved = await putJson("/api/etoro/bot/config", collectBotConfig());
    renderBotConfig(saved);
    renderAudit(
      "Bot config persisted",
      "Server-side simulation config saved; execution remains absent",
      "bot-audit-list",
    );
  } catch (error) {
    renderAudit("Bot config rejected", error.message, "bot-audit-list");
  }
});
document.querySelectorAll("[data-tab-target]").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
});
document.querySelectorAll("[data-period]").forEach((button) => {
  button.addEventListener("click", () => updatePortfolioPeriod(button.dataset.period));
});
document.querySelectorAll("[data-watchlist-period]").forEach((button) => {
  button.addEventListener("click", () => updateWatchlistPeriod(button.dataset.watchlistPeriod));
});
document.querySelectorAll("[data-instrument-row]").forEach((row) => {
  bindPortfolioRow(row);
});
document.querySelectorAll("[data-watchlist-row]").forEach((row) => {
  bindWatchlistRow(row);
});
updatePortfolioPeriod("24h");
updateWatchlistPeriod("24h");
refreshEtoro();
