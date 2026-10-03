const formatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const portfolioTabId = "portfolio-view";
const botConfigCsrfResponseHeader = "x-etoro-dashboard-config-token";
const loadedTabIds = new Set();
let botConfigMutationProtection = null;
let botConfigOptionsPayload = null;
let selectedPortfolioSymbol = null;
let selectedPortfolioKey = null;
let displayCurrency = null;
let preferredDisplayCurrency = null;
let fxSnapshot = null;
let fxFailed = false;
let fxRequestSequence = 0;
let fxPending = null;
let fxDisplayState = null;
const pageSize = 25;
let selectedPortfolioPeriod = "24h";
let portfolioDataSource = "none";
let selectedPortfolioEnvironment = null;
let portfolioChartRequestSequence = 0;
let etoroRefreshRequestSequence = 0;
let portfolioLastGoodEnvironment = null;
let selectedWatchlistSymbol = null;
let selectedWatchlistPeriod = "24h";
let watchlistDataSource = "none";
let watchlistLastGoodEnvironment = null;
let watchlistRequestSequence = 0;
let profileGeneration = 0;
const profileRequests = new Set();
let watchlistChartRequestSequence = 0;
const watchlistItemsBySymbol = new Map();
const investmentFreshness = {
  portfolio: { view: null, pending: false, failed: false },
  watchlist: { view: null, pending: false, failed: false },
};
const chartFreshness = { portfolio: null, watchlist: null };
const tableRows = { portfolio: [], watchlist: [] };
const tableReview = {
  portfolio: { search: "", coverage: "all", sort: "symbol", direction: "asc", page: 1 },
  watchlist: { search: "", coverage: "all", sort: "rank", direction: "asc" },
};
let presentationReadFailure = null;
let presentationConnection = "checking";
let activePresentationDialog = null;
const presentationDialogReturns = new Map();
let operationsPayload = null;
let operationsPending = false;
const pendingOperations = new Set();
let operationsFailed = false;
let operationsRequestSequence = 0;
let operationsMutationProtection = null;
let retryOperation = null;
let retryOriginalStartedAt = null;

const {
  hasExactKeys,
  isIsoInstant,
  normalizeMarketChartPayload,
  normalizeLivePortfolioPayload,
  normalizeFxPayload,
  normalizeWatchlistViewPayload,
  normalizeOfflineOperationsPayload,
  normalizeDraftBotConfig,
} = globalThis.EtoroBrowserContracts;

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
  const strong = tile.querySelector("strong");
  const small = tile.querySelector("small");
  if (strong) strong.textContent = title;
  if (small) small.textContent = detail;
}

function freshnessState(record, now = Date.now()) {
  if (record.pending) return "pending";
  if (record.failed) return record.view ? "stale" : "failed";
  if (!record.view) return "unavailable";
  if (record.view.cache.state === "stale") return "stale";
  if (now >= Date.parse(record.view.cache.expiresAt)) return "expired";
  const view = record.view;
  return view.providerState === "partial" || view.omittedRowCount > 0 || view.incompleteRowCount > 0 || view.fieldReasons?.providerUpdatedAt || view.coverage?.copyHoldingsStatus === "incomplete" || view.coverage?.manualHoldingsStatus === "incomplete" || view.coverage && view.coverage.metadataStatus !== "available" ? "partial" : "current";
}

function freshnessDetail(record, now = Date.now()) {
  const state = freshnessState(record, now);
  if (!record.view) return `Freshness: ${state}; no provider rows loaded`;
  const cache = record.view.cache;
  const age = Math.max(0, Math.floor((now - Date.parse(cache.cachedAt)) / 1000));
  return `Freshness: ${state}${state === "stale" ? "; last-good provider rows retained" : ""} · fetched ${cache.cachedAt} · age ${age}s · expires ${cache.expiresAt}`;
}

function plainPortfolioReason(reason) {
  const value = String(reason ?? "").toLowerCase();
  if (/authorization|permission|missing read scope|read.scope.*(rejected|unavailable)/.test(value)) return "Read permission is unavailable for this field.";
  if (/conversion.*overflow|display.*range/.test(value)) return "The converted amount is outside the supported display range. Use the account currency.";
  if (/\bfx\b|reference rates|conversion/.test(value)) return "Current reference rates are unavailable for this conversion. Use the account currency or refresh data.";
  if (/rate.limit|quota|backoff/.test(value)) return "The data service is temporarily limiting reads. Try again later.";
  if (/timed out|timeout|unavailable.*provider|provider is unavailable/.test(value)) return "The data service could not provide this field. Try refreshing.";
  if (/timezone|timestamp|calendar|source time/.test(value)) return "The source time could not be verified.";
  if (/currency|currencies|denomination/.test(value)) return /conflict|inconsistent|differing/.test(value) ? "The positions do not share a verified currency." : "The currency for this value could not be verified.";
  if (/zero.*margin|positive.*equity|denominator/.test(value)) return "A percentage cannot be calculated from the available amounts.";
  if (/combined|zero.net|no single|direction/.test(value)) return "These positions do not have one reliable combined value.";
  if (/ambiguous|identity|globally/.test(value)) return "The asset identity could not be verified.";
  if (/validation|invalid|finite|range|overflow/.test(value)) return "The supplied value could not be validated.";
  if (/no matching|breakdown|details/.test(value)) return "Matching position details were not available.";
  if (/not supplied|missing|omitted|absent|no.*field/.test(value)) return "This field was not supplied by the data source.";
  return "This field could not be verified. System health contains the source details.";
}

function setPortfolioField(node, rawValue, formatted, label, reason) {
  if (!node) return;
  const conversionMissing = formatted === "Unavailable (FX)";
  const conversionOverflow = formatted === "Unavailable (FX overflow)";
  const missing = rawValue === null || rawValue === undefined || conversionMissing || conversionOverflow;
  if (conversionOverflow) reason = "FX conversion overflow";
  else if (conversionMissing) reason = "FX conversion unavailable";
  node.textContent = missing ? "—" : formatted;
  const explanation = missing || reason ? `${label}: ${plainPortfolioReason(reason)}` : label;
  node.setAttribute("aria-label", missing ? `${label} unavailable. ${plainPortfolioReason(reason)}` : `${label}: ${formatted}${reason ? `. ${plainPortfolioReason(reason)}` : ""}`);
  node.setAttribute("title", explanation);
}

function renderPresentationStatus(now = Date.now()) {
  const record = investmentFreshness.portfolio, view = record.view;
  const state = freshnessState(record, now);
  const environment = selectedPortfolioEnvironment ?? view?.environment;
  text("workspace-profile", `${environment ? labelize(environment) : "Account"} · Read only`);
  const summaries = [];
  if (view) {
    const seconds = Math.max(0, Math.floor((now - Date.parse(view.cache.cachedAt)) / 1000));
    summaries.push(seconds < 60 ? "Fetched less than a minute ago." : seconds < 3600 ? `Fetched ${Math.floor(seconds / 60)} minute${seconds < 120 ? "" : "s"} ago.` : `Fetched ${Math.floor(seconds / 3600)} hour${seconds < 7200 ? "" : "s"} ago.`);
  }
  if (view && (view.omittedRowCount || view.incompleteRowCount)) summaries.push(`${view.incompleteRowCount} incomplete holding rows; ${view.omittedRowCount} omitted.`);
  if (view?.coverage?.copyHoldingsStatus === "incomplete" || view?.coverage?.manualHoldingsStatus === "incomplete") summaries.push("Some holdings coverage is unknown.");
  if (view?.coverage?.metadataStatus !== undefined && view.coverage.metadataStatus !== "available") summaries.push("Some asset identities are unverified.");
  if (view?.fieldReasons?.providerUpdatedAt) summaries.push("The source clock is unverified.");
  const fxUnavailable = view && displayCurrency && displayCurrency !== (view.accountCurrency ?? view.currency) && (!fxCurrent(now) || !fxSnapshot?.rates[displayCurrency] || !fxSnapshot?.rates[view.accountCurrency ?? view.currency]);
  if (fxUnavailable) summaries.push("FX is unavailable or out of date; converted amounts are hidden.");
  let title, detail, action = "Refresh data", tone = "warn";
  const failure = presentationReadFailure ?? (!view && presentationConnection !== "ready" ? presentationConnection : null);
  if (state === "pending") {
    title = "Refreshing data";
    detail = view ? `Previous values remain visible${record.failed ? " and stale" : ""} while this read completes.` : "Waiting for the selected account. No account values are loaded.";
    const history = { "provider timeout": "Previous read timed out.", "provider rate-limited": "Previous read was rate-limited.", "provider response malformed": "Previous data could not be validated.", "authentication rejected": "Previous read was not authorized.", "not configured": "Previous connection was not configured." };
    if (failure && failure !== "checking") detail += ` ${history[failure] ?? "Previous read failed."}`;
    tone = "neutral";
  } else if (failure && failure !== "checking") {
    const messages = {
      "authentication rejected": ["Connection not authorized", "Check account permissions and server-side credentials in connection details."],
      "unauthorized-or-expired": ["Connection not authorized", "Check account permissions and server-side credentials in connection details."],
      "wrong-environment": ["Connection does not match this account", "Check the selected Real/Demo connection details."],
      "not configured": ["Connection not configured", "Set up the selected account connection outside this dashboard."],
      "not-configured": ["Connection not configured", "Set up the selected account connection outside this dashboard."],
      "provider rate-limited": ["Reads temporarily limited", "Wait for the retry window before refreshing."],
      "rate-limited": ["Reads temporarily limited", "Wait for the retry window before refreshing."],
      "provider timeout": ["The latest read timed out", "Refresh data to try again."], timeout: ["The latest read timed out", "Refresh data to try again."],
      "provider response malformed": ["The latest data could not be validated", "Refresh data; the previous snapshot has not been replaced."], malformed: ["The latest data could not be validated", "Refresh data; the previous snapshot has not been replaced."],
    };
    [title, detail] = messages[failure] ?? ["The latest read failed", "Refresh data to try again."];
    if (/auth|environment|configured/.test(failure)) { action = "Connection details"; tone = "danger"; }
    if (view) detail += " Last available values are retained and stale.";
    else detail += " No account values are loaded.";
  } else if (state === "stale") { title = "Showing a retained snapshot"; detail = "Values are stale. Refresh data for a new read."; }
  else if (state === "expired") { title = "This snapshot is out of date"; detail = "Values keep their original timestamp. Refresh data to update them."; }
  else if (fxUnavailable) { title = "Currency conversion unavailable"; detail = "Refresh data for reference rates, or use the account currency."; }
  else if (state === "partial") { title = "Some data is incomplete"; detail = "Available fields remain usable. Open a holding for plain missing-field reasons."; }
  else if (state === "current") { title = "Snapshot available"; detail = "Read-only account values. Reference conversions are indicative."; tone = "ok"; action = "System health"; }
  else { title = "Checking your connection"; detail = "Waiting for read-only account data."; tone = "neutral"; action = "Connection details"; }
  const announcement = (id, value) => { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; };
  announcement("workspace-banner-title", `Portfolio data · ${title}`);
  announcement("workspace-banner-detail", [detail, ...summaries].join(" "));
  announcement("portfolio-visible-coverage", view ? `${view.instrumentCount} holding rows · ${view.incompleteRowCount} incomplete · ${view.omittedRowCount} omitted${state === "stale" || state === "expired" ? ` · ${state}` : ""}${summaries.filter((part) => /unknown|unverified/.test(part)).length ? " · Some coverage is unverified" : ""}` : "Holding coverage unavailable");
  const banner = document.getElementById("workspace-banner");
  if (banner) { banner.dataset.state = state; banner.dataset.failure = state === "pending" ? "none" : failure ?? "none"; banner.dataset.previousFailure = state === "pending" ? failure ?? "none" : "none"; banner.dataset.tone = tone; }
  const button = document.getElementById("workspace-banner-action");
  if (button) { button.textContent = action; button.dataset.action = action === "Refresh data" ? "refresh" : "health"; button.disabled = state === "pending" && action === "Refresh data"; }
  renderHealthDiagnostics();
}

function renderHealthDiagnostics() {
  const view = investmentFreshness.portfolio.view;
  const item = tableRows.portfolio.find(({ item }) => portfolioRowKey(item) === selectedPortfolioKey)?.item;
  const details = [];
  for (const [prefix, source] of [["Account", view], ["Selected holding", item]]) {
    for (const [field, reason] of Object.entries(source?.fieldReasons ?? {})) details.push(`${prefix} · ${labelize(field)}: ${reason}`);
    for (const [field, origin] of Object.entries(source?.fieldSources ?? {})) details.push(`${prefix} · ${labelize(field)} source: ${origin}`);
  }
  if (view?.coverage) details.push(`Holdings coverage: copy ${view.coverage.copyHoldingsStatus}; manual ${view.coverage.manualHoldingsStatus}; metadata ${view.coverage.metadataStatus}; ${view.incompleteRowCount} incomplete rows; ${view.omittedRowCount} omitted rows.`);
  if (fxSnapshot) details.push(`FX: ECB reference ${fxSnapshot.rateDate}; fetched ${fxSnapshot.receivedAt}; ${fxCurrent() ? "current" : "stale or failed refresh"}; indicative.`);
  const node = document.getElementById("portfolio-technical-reasons");
  const evidence = details.length ? details : ["No validated field evidence is loaded."];
  const fingerprint = JSON.stringify(evidence);
  if (node && node.dataset.evidence !== fingerprint) {
    node.replaceChildren(...evidence.map((detail) => { const li = document.createElement("li"); li.textContent = detail; return li; }));
    node.dataset.evidence = fingerprint;
  }
}

function presentationFocusTarget(record) {
  if (record?.rowKey) return tableRows.portfolio.find(({ row, item }) => portfolioRowKey(item) === record.rowKey && !row.hidden)?.row
    ?? tableRows.portfolio.find(({ row, item }) => portfolioRowKey(item) === selectedPortfolioKey && !row.hidden)?.row
    ?? document.getElementById("portfolio-review-search");
  const invoker = record?.invoker;
  if (invoker && invoker.isConnected !== false && !invoker.hidden && !invoker.closest?.("dialog")) return invoker;
  return document.querySelector("[data-tab-target].active") ?? document.getElementById("portfolio-environment");
}

function closePresentationDialog(id, { restoreFocus = true } = {}) {
  const dialog = document.getElementById(id);
  const record = presentationDialogReturns.get(id);
  presentationDialogReturns.delete(id);
  if (activePresentationDialog === id) activePresentationDialog = null;
  if (dialog?.open) dialog.close?.();
  if (id === "portfolio-inspector") portfolioChartRequestSequence += 1;
  if (restoreFocus && record) presentationFocusTarget(record)?.focus?.();
}

function closePresentationDialogs(options) {
  for (const id of ["portfolio-inspector", "system-health"]) closePresentationDialog(id, options);
}

function openPresentationDialog(id, invoker = document.activeElement, { loadChart = true } = {}) {
  if (id === "portfolio-inspector" && !selectedPortfolioKey) return;
  const dialog = document.getElementById(id);
  if (!dialog || typeof dialog.showModal !== "function") return;
  if (activePresentationDialog && activePresentationDialog !== id) closePresentationDialog(activePresentationDialog, { restoreFocus: false });
  if (dialog.open) return;
  presentationDialogReturns.set(id, { invoker, rowKey: invoker?.dataset?.rowKey ?? null });
  activePresentationDialog = id;
  if (id === "portfolio-inspector") { renderPortfolioInspector(); if (loadChart) void renderSelectedPortfolioInstrument(); }
  else renderHealthDiagnostics();
  dialog.showModal();
  document.getElementById(id === "portfolio-inspector" ? "portfolio-inspector-close" : "system-health-close")?.focus?.();
}

function applyInvestmentFreshness(now = Date.now()) {
  for (const kind of ["portfolio", "watchlist"]) {
    const record = investmentFreshness[kind];
    const state = freshnessState(record, now);
    const retained = record.view !== null;
    const degraded = !["current", "partial"].includes(state);
    const detail = freshnessDetail(record, now);
    const ids = kind === "portfolio"
      ? ["portfolio-view", "portfolio-table-body", "mock-equity", "cash-buffer", "unrealized-pnl", "exposure", "stale-data", "portfolio-stat-cash", "portfolio-stat-largest", "portfolio-stat-realized", "portfolio-stat-coverage", "portfolio-stat-balance", "portfolio-stat-frozen", "portfolio-stat-mirror"]
      : ["watchlist-table-body", "watchlist-provider-state"];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) { node.dataset.freshness = state; node.setAttribute("aria-busy", String(state === "pending")); node.setAttribute("title", detail); }
    }
    for (const { row, item } of tableRows[kind]) {
      row.dataset.freshness = state;
      row.dataset.source = degraded ? `provider-${state}` : "provider-normalized";
      row.setAttribute("title", detail);
      if (kind === "portfolio") {
        const cell = row.children[5];
        if (cell) { cell.textContent = `${labelize(item.completeness)}${degraded ? ` · ${state}` : ""}`; cell.className = degraded ? "warn-text" : item.completeness === "complete" ? "good-text" : "warn-text"; }
      } else {
        const badge = row.children[4]?.children[0];
        if (badge) { badge.textContent = `${degraded ? `${labelize(state)} · ` : ""}${item.rateUpdatedAt ?? "Rate unavailable"}`; badge.className = degraded || item.rateStatus !== "available" ? "pill warn" : "pill ok"; }
        if (row.children[5]) row.children[5].textContent = degraded ? `Provider ${state}` : item.rateStatus === "available" ? "Provider normalized" : "Partial provider read";
      }
    }
    if (kind === "portfolio") {
      text("portfolio-freshness", detail);
      const descriptions = {
        "equity-detail": "Account value", "cash-buffer-detail": "Available cash",
        "unrealized-pnl-detail": "Open holdings", "exposure-detail": "Account used margin",
        "stale-data-detail": record.view ? `${record.view.instrumentCount} instrument aggregates` : "Provider positions unavailable",
      };
      for (const [id, label] of Object.entries(descriptions)) text(id, `${retained ? label : "Awaiting data"}${degraded ? ` · ${state}` : ""}`);
      setTile("last-sync", degraded ? "warn" : "ok", `Last sync · ${state}`, retained ? detail.replace("Freshness: ", "") : `No provider snapshot · ${state}`);
      if (retained) text("portfolio-stat-source", `${labelize(record.view.environment)} snapshot · ${state === "current" ? "provider normalized" : state === "partial" ? "provider normalized · partial" : state} · fetched ${record.view.cache.cachedAt} · provider observation ${record.view.providerUpdatedAt ?? "unavailable"}`);
    } else {
      if (retained && !record.failed) text("watchlist-provider-state", `Provider ${state}${record.view.items.length === 0 && record.view.omittedItemCount === 0 ? " · watchlist empty" : ""}`);
      text("watchlist-source-policy", retained ? `Read-only provider · ${state} · fetched ${record.view.cache.cachedAt}` : `Provider ${state}`);
      const node = document.getElementById("watchlist-provider-state");
      node?.classList.toggle("ok", !degraded && state === "current");
      node?.classList.toggle("warn", degraded || state === "partial");
    }
    const chart = chartFreshness[kind];
    if (!chart) continue;
    const ownChartState = freshnessState({ view: chart, pending: false, failed: false }, now);
    const chartState = ownChartState === "stale" ? "stale" : ["stale", "pending", "failed"].includes(state) ? state : ownChartState;
    const chartDetail = `${labelize(chartState)} history · fetched ${chart.cache.cachedAt} · age ${Math.max(0, Math.floor((now - Date.parse(chart.cache.cachedAt)) / 1000))}s · last candle start ${chart.points.at(-1).at}; completion unverified`;
    const chartNode = document.getElementById(kind === "portfolio" ? "portfolio-chart-shell" : "watchlist-chart-shell");
    chartNode?.setAttribute("aria-label", `${chart.symbol} ${chartState} history, ${chart.pointCount} candle starts; ${chartDetail}`);
    if (chartNode) { chartNode.dataset.freshness = chartState; chartNode.setAttribute("aria-busy", String(chartState === "pending")); }
    text(kind === "portfolio" ? "chart-cache" : "watchlist-chart-freshness", chartDetail);
    if (kind === "watchlist") {
      text("watchlist-chart-source", `Source: provider ${chartState} · ${signedPercent(chart.changePercent)}${!["current", "partial"].includes(chartState) ? ` (${chartState})` : ""}`);
      text("watchlist-context-freshness", chartDetail);
      for (const { row, item } of tableRows.watchlist) if (item.symbol === chart.symbol) {
        const cell = row.querySelector("[data-watchlist-period-value]");
        if (cell) cell.textContent = `${signedPercent(chart.changePercent)}${!["current", "partial"].includes(chartState) ? ` (${chartState})` : ""}`;
      }
    }
  }
  renderPresentationStatus(now);
}

function tableItemValue(kind, item, key) {
  if (key === "price") return kind === "portfolio" ? item.currentPrice : item.rateStatus === "available" ? item.lastExecution ?? item.bid / 2 + item.ask / 2 : null;
  return item[key] ?? null;
}

function portfolioRowKey(item) { return `${item.scope ?? "direct"}:${item.symbol}`; }

function applyTableReview(kind, { refreshSelection = true } = {}) {
  const review = tableReview[kind], rows = tableRows[kind];
  const body = document.getElementById(kind === "portfolio" ? "portfolio-table-body" : "watchlist-table-body");
  const selectedBefore = kind === "portfolio" ? selectedPortfolioKey : selectedWatchlistSymbol;
  const keyFor = (item) => kind === "portfolio" ? portfolioRowKey(item) : item.symbol;
  const entries = rows.map((entry, index) => ({ ...entry, index }));
  entries.sort((a, b) => {
    const x = tableItemValue(kind, a.item, review.sort), y = tableItemValue(kind, b.item, review.sort);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    const compared = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
    return (review.direction === "desc" ? -compared : compared) || a.index - b.index;
  });
  const matched = entries.filter(({ item }) => {
    const covered = kind === "portfolio" ? item.completeness === "complete" : item.rateStatus === "available";
    return `${item.symbol} ${item.displayName}`.toLowerCase().includes(review.search.toLowerCase()) &&
      (review.coverage === "all" || (review.coverage === "complete" ? covered : !covered));
  });
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  if (kind === "portfolio") review.page = Math.max(1, Math.min(review.page ?? 1, pages));
  const visible = kind === "portfolio" ? matched.slice((review.page - 1) * pageSize, review.page * pageSize) : matched;
  const focusedRow = rows.find(({ row }) => row === document.activeElement)?.row;
  const visibleRows = new Set(visible.map(({ row }) => row));
  for (const { row } of entries) { row.hidden = !visibleRows.has(row); row.tabIndex = row.hidden ? -1 : 0; }
  if (rows.length && body) body.replaceChildren(...entries.map(({ row }) => row));
  const selected = visible.find(({ item }) => keyFor(item) === selectedBefore) ?? visible[0];
  const key = selected ? keyFor(selected.item) : null;
  if (focusedRow) (focusedRow.hidden ? selected?.row ?? document.getElementById(`${kind}-review-search`) : focusedRow)?.focus?.();
  if (kind === "portfolio") { selectedPortfolioKey = key; selectedPortfolioSymbol = selected?.item.symbol ?? null; }
  else selectedWatchlistSymbol = key;
  for (const { row } of rows) { const active = row === selected?.row; row.classList.toggle("active", active); row.setAttribute("aria-selected", String(active)); }
  const complete = matched.filter(({ item }) => kind === "portfolio" ? item.completeness === "complete" : item.rateStatus === "available").length;
  text(`${kind}-review-count`, `${matched.length} of ${rows.length} instruments shown · ${complete} with ${kind === "portfolio" ? "complete values" : "rates"} · ${matched.length - complete} incomplete${matched.length === 0 && rows.length ? " · No instruments match" : ""}; snapshot omitted ${investmentFreshness[kind].view?.[kind === "portfolio" ? "omittedRowCount" : "omittedItemCount"] ?? "unavailable"}${kind === "portfolio" ? ` · ${visible.length} on this page` : ""}`);
  if (kind === "portfolio") {
    text("portfolio-page-status", `Page ${review.page} of ${pages} · ${pageSize} per page`);
    const previous = document.getElementById("portfolio-page-previous"), next = document.getElementById("portfolio-page-next");
    if (previous) previous.disabled = review.page <= 1;
    if (next) next.disabled = review.page >= pages;
    renderPortfolioInspector();
  }
  if (key !== selectedBefore && refreshSelection) {
    if (kind === "portfolio") {
      clearChartEvidence("portfolio");
      portfolioChartRequestSequence += 1;
      document.getElementById("performance-line")?.setAttribute("points", "");
      document.getElementById("performance-area")?.setAttribute("d", "");
      text("chart-title", selected ? `${selected.item.symbol} · open holding details for market history` : "Select a live holding");
      text("chart-period-label", "Market-price history unavailable until holding details open");
      if (document.getElementById("portfolio-inspector")?.open) void renderSelectedPortfolioInstrument();
    } else renderSelectedWatchlistInstrument();
  }
}

function renderChartEvidence(kind, chart) {
  const low = Math.min(...chart.points.map(({ close }) => close));
  const high = Math.max(...chart.points.map(({ close }) => close));
  const prefix = kind === "portfolio" ? "portfolio" : "watchlist";
  text(`${prefix}-chart-price-axis`, `Close price: ${price(low)} — ${price(high)} · listing currency unverified`);
  text(`${prefix}-chart-time-axis`, `${chart.points[0].at} — ${chart.points.at(-1).at} · UTC candle start`);
  const body = document.getElementById(`${prefix}-chart-details-body`);
  body?.replaceChildren();
  for (const point of chart.points) {
    const row = document.createElement("tr");
    appendPortfolioCell(row, point.at);
    appendPortfolioCell(row, price(point.close));
    body?.append(row);
  }
  text(`${prefix}-chart-coverage`, `${chart.pointCount} returned samples · timestamp spacing preserves gaps · requested window ${periodLabel(chart.period)} uses a fixed candle count; calendar coverage is not guaranteed. Candle starts do not establish completion or session. Fetch time: ${chart.cache.cachedAt}.`);
}

function clearChartEvidence(kind) {
  chartFreshness[kind] = null;
  const shell = document.getElementById(`${kind}-chart-shell`);
  if (shell) { shell.dataset.freshness = "unavailable"; shell.setAttribute("aria-busy", "false"); shell.setAttribute("aria-label", "Market-price history unavailable; no selected history"); }
  for (const suffix of ["price-axis", "time-axis", "coverage"]) text(`${kind}-chart-${suffix}`, "Unavailable");
  document.getElementById(`${kind}-chart-details-body`)?.replaceChildren();
  if (kind === "portfolio") {
    text("chart-provider", "Candle start: unavailable");
    text("chart-cache", "Cache: unavailable");
    text("chart-request", "Provider request ID: hidden");
    for (const prefix of ["portfolio-financial", "portfolio-news", "portfolio-insider"]) {
      text(`${prefix}-title`, "Unavailable");
      text(`${prefix}-detail`, "No selected instrument context available");
    }
  } else {
    text("watchlist-chart-source", "Source: unavailable");
    text("watchlist-chart-freshness", "Freshness: unavailable");
    text("watchlist-context-title", "Unavailable");
    text("watchlist-context-source", "No selected instrument");
    text("watchlist-context-freshness", "Unavailable");
    text("watchlist-context-detail", "No market context available");
  }
}

function fxPublicationDate(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(({ type, value }) => [type, value]));
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
  if (Number(parts.hour) * 60 + Number(parts.minute) < 16 * 60 + 30) day.setUTCDate(day.getUTCDate() - 1);
  const year = day.getUTCFullYear();
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, (h + l - 7 * m + 114) % 31 + 1));
  const easterDate = (offset) => { const date = new Date(easter); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
  const holidays = new Set([`${year}-01-01`, `${year}-05-01`, `${year}-12-25`, `${year}-12-26`, easterDate(-2), easterDate(1)]);
  for (let n = 0; n < 10; n++) {
    const iso = day.toISOString().slice(0, 10);
    if (![0, 6].includes(day.getUTCDay()) && !holidays.has(iso)) return iso;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return null;
}

function fxCurrent(now = Date.now()) {
  return Boolean(fxSnapshot && !fxFailed && fxSnapshot.freshness === "current" && fxSnapshot.rateDate >= fxPublicationDate(now));
}

function applyFxFreshness() {
  const state = fxCurrent();
  if (state === fxDisplayState) return;
  fxDisplayState = state;
  renderPortfolioMoney();
}

function accountMoney(value, signed = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  const account = investmentFreshness.portfolio.view?.accountCurrency ?? investmentFreshness.portfolio.view?.currency ?? "USD";
  const currency = displayCurrency ?? account;
  let converted = value;
  if (currency !== account) {
    if (!fxCurrent() || !fxSnapshot.rates[currency] || !fxSnapshot.rates[account]) return "Unavailable (FX)";
    converted = value * (fxSnapshot.rates[currency] / fxSnapshot.rates[account]);
  }
  if (!Number.isFinite(converted) || Math.abs(converted) > 1_000_000_000_000_000) return "Unavailable (FX overflow)";
  const result = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: currency === "USD" ? "symbol" : "code" }).format(signed ? Math.abs(converted) : converted);
  return signed ? `${converted >= 0 ? "+" : "-"}${result}` : result;
}

function renderCurrencyControls() {
  const account = investmentFreshness.portfolio.view?.accountCurrency ?? investmentFreshness.portfolio.view?.currency ?? null;
  const control = document.getElementById("portfolio-display-currency");
  const currencies = [...new Set([...(account ? [account] : ["USD"]), ...(fxSnapshot ? Object.keys(fxSnapshot.rates).sort() : []), ...(preferredDisplayCurrency ? [preferredDisplayCurrency] : [])])];
  displayCurrency = preferredDisplayCurrency ?? account;
  if (control) {
    control.replaceChildren(...(!displayCurrency ? [(() => { const option = document.createElement("option"); option.value = ""; option.textContent = "Awaiting account currency"; return option; })()] : []), ...currencies.map((currency) => { const option = document.createElement("option"); option.value = currency; option.textContent = `${currency}${currency === account ? " (account)" : ""}`; return option; }));
    control.value = displayCurrency ?? "";
  }
  const converted = account && displayCurrency !== account;
  const unavailable = converted && (!fxCurrent() || !fxSnapshot.rates[account] || !fxSnapshot.rates[displayCurrency]);
  text("portfolio-fx-basis", `Account ${account ?? "unavailable"} · Display ${displayCurrency ?? "unavailable"}${!converted ? " · no conversion" : unavailable ? " · FX unavailable; converted amounts hidden" : " · indicative ECB reference, no fees"}${fxSnapshot ? ` · rate date ${fxSnapshot.rateDate} · FX ${fxFailed ? "failed refresh" : fxCurrent() ? "current" : "stale"}` : " · FX unavailable"}`);
}

function renderPortfolioMoney() {
  const view = investmentFreshness.portfolio.view;
  renderCurrencyControls();
  renderAccountReasons();
  if (!view) return;
  for (const [id, key, signed] of [["mock-equity", "equity", false], ["cash-buffer", "availableCash", false], ["exposure", "usedMargin", false], ["unrealized-pnl", "unrealizedPnl", true]]) text(id, accountMoney(view[key] ?? null, signed));
  for (const { row, item } of tableRows.portfolio) {
    for (const [index, key, signed] of [[1, "investedValue", false], [2, "netValue", false], [3, "unrealizedPnl", true]]) setPortfolioField(row.children[index], item[key], accountMoney(item[key], signed), portfolioFieldLabels[key], item.fieldReasons?.[key]);
  }
  renderPortfolioStatistics(view);
  renderPortfolioInspector();
  applyInvestmentFreshness();
}

async function refreshFx() {
  if (fxPending) return fxPending;
  const sequence = ++fxRequestSequence;
  fxPending = (async () => {
    try {
      const snapshot = normalizeFxPayload(await getJson("/api/fx/reference"));
      if (sequence !== fxRequestSequence) return;
      fxSnapshot = snapshot; fxFailed = false;
    } catch { if (sequence !== fxRequestSequence) return; fxFailed = true; }
    finally { fxPending = null; }
    fxDisplayState = fxCurrent();
    renderPortfolioMoney();
  })();
  return fxPending;
}

function selectDisplayCurrency(currency) {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return;
  displayCurrency = currency; preferredDisplayCurrency = currency;
  // Persist only a currency code; never persist holdings, balances or profile data.
  try { globalThis.localStorage?.setItem("etoro-display-currency", currency); } catch { /* Local preference is optional. */ }
  renderPortfolioMoney();
}

function renderAccountReasons() {
  const view = investmentFreshness.portfolio.view;
  const node = document.getElementById("portfolio-account-reasons");
  if (!node) return;
  const labels = { openPositionCount: "Position count", pendingOrderCount: "Pending-order count", equity: "Equity", availableCash: "Available cash", usedMargin: "Used margin", unrealizedPnl: "Unrealized P/L", totalInvested: "Total invested", accountBalance: "Account balance", frozenCash: "Frozen pending-order cash", mirrorCash: "Copy mirror cash", realizedPnl: "Realized P/L", providerUpdatedAt: "Aggregate source time", breakdownUpdatedAt: "Breakdown source time", coverage: "Holdings coverage" };
  const reasons = view ? Object.entries(labels).filter(([key]) => view[key] === null || view[key] === undefined || view.fieldReasons?.[key]).map(([key, label]) => `${label}: ${plainPortfolioReason(view.fieldReasons?.[key])}`) : ["Account fields unavailable until the selected profile loads."];
  node.replaceChildren(...(reasons.length ? reasons : ["All listed account monetary fields are available."]).map((reason) => { const li = document.createElement("li"); li.textContent = reason; return li; }));
  if (view?.coverage) text("portfolio-source-detail", `${view.coverage.directInstrumentCount} direct · ${view.coverage.copyInstrumentCount} copy · ${view.coverage.metadataUnresolvedCount} metadata unresolved · ${view.coverage.unsupportedInstrumentCount} above ${view.coverage.instrumentLimit}-instrument boundary · breakdown ${view.coverage.breakdownStatus} · copy coverage ${view.coverage.copyHoldingsStatus} · manual coverage ${view.coverage.manualHoldingsStatus} · metadata ${view.coverage.metadataStatus}; independently timed provider reads`);
}

const portfolioFieldLabels = { investedValue: "Margin / invested", netValue: "Liquidation value", unrealizedPnl: "P/L", unrealizedPnlPercent: "P/L %", units: "Net quantity", netContracts: "Net contracts", averageOpenPrice: "Direction-aware net opening rate", currentPrice: "Native current price", assetCurrency: "Portfolio asset currency", currentExposure: "Current exposure", positionCount: "Position count", positions: "Optional position details", symbol: "Instrument identity" };
function renderPortfolioInspector() {
  const item = tableRows.portfolio.find(({ item }) => portfolioRowKey(item) === selectedPortfolioKey)?.item;
  const native = (value) => `${price(value)}${value !== null ? item?.assetCurrency ? ` ${item.assetCurrency}` : " · denomination unverified" : ""}`;
  text("portfolio-selected-title", item ? `${item.fieldReasons?.symbol ? "Unresolved instrument" : item.symbol} · ${item.displayName}` : "Select a live holding");
  text("portfolio-selected-scope", item ? labelize(item.scope ?? "direct") : "Read only");
  for (const [id, key, formatted] of [["portfolio-selected-price", "currentPrice", item ? native(item.currentPrice) : "Unavailable"], ["portfolio-selected-opening", "averageOpenPrice", item ? native(item.averageOpenPrice) : "Unavailable"], ["portfolio-selected-units", "units", quantity(item?.units)], ["portfolio-selected-contracts", "netContracts", quantity(item?.netContracts)], ["portfolio-selected-positions", "positionCount", String(item?.positionCount)], ["portfolio-selected-currency", "assetCurrency", item?.assetCurrency], ["portfolio-selected-exposure", "currentExposure", accountMoney(item?.currentExposure)]]) setPortfolioField(document.getElementById(id), item?.[key], formatted, portfolioFieldLabels[key], item?.fieldReasons?.[key]);
  text("portfolio-selected-opening-source", item?.fieldSources?.averageOpenPrice ? "Opening rate follows the provider’s direction-aware long-minus-short calculation." : "Opening-rate source could not be verified.");
  const open = document.getElementById("portfolio-inspector-open");
  if (open) open.disabled = !item;
  const reasons = document.getElementById("portfolio-field-reasons");
  if (reasons) {
    const missing = item ? Object.entries(portfolioFieldLabels).filter(([key]) => item[key] === null || item[key] === undefined || item.fieldReasons?.[key]).map(([key, label]) => `${label}: ${plainPortfolioReason(item.fieldReasons?.[key])}`) : ["Select an instrument to inspect each field."];
    if (item && displayCurrency !== (investmentFreshness.portfolio.view?.accountCurrency ?? investmentFreshness.portfolio.view?.currency) && accountMoney(1).startsWith("Unavailable")) missing.push("Display amounts: validated current FX for both currencies is unavailable.");
    reasons.replaceChildren(...(missing.length ? missing : ["All listed instrument fields are available. Chart listing currency and completion remain independently unverified."]).map((reason) => { const li = document.createElement("li"); li.textContent = reason; return li; }));
  }
  const positions = document.getElementById("portfolio-position-details");
  if (positions) positions.replaceChildren(...(item?.positions?.length ? item.positions : [null]).map((position) => { const li = document.createElement("li"); li.textContent = position ? Object.entries(position).map(([key, value]) => `${labelize(key)}: ${typeof value === "number" ? quantity(value) : value ?? "Unavailable"}`).join(" · ") : "Optional position details unavailable"; return li; }));
  renderHealthDiagnostics();
}

function money(value) {
  return typeof value === "number" && Number.isFinite(value) ? formatter.format(value) : "Unavailable";
}

function price(value) {
  return typeof value === "number" && Number.isFinite(value) ? formatExactDecimal(value) : "Unavailable";
}

function quantity(value) {
  return typeof value === "number" && Number.isFinite(value) ? formatExactDecimal(value) : "Unavailable";
}

function formatExactDecimal(value) {
  const sign = value < 0 ? "-" : "";
  const serialized = String(Math.abs(value));
  const [coefficient, rawExponent] = serialized.toLowerCase().split("e");
  const exponent = rawExponent === undefined ? 0 : Number(rawExponent);
  const digits = coefficient.replace(".", "");
  const decimalIndex = (coefficient.indexOf(".") === -1 ? coefficient.length : coefficient.indexOf(".")) + exponent;
  const decimal = decimalIndex <= 0
    ? `0.${"0".repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  const [integer, fraction] = decimal.split(".");
  return `${sign}${integerFormatter.format(Number(integer))}${fraction === undefined ? "" : `.${fraction}`}`;
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

async function getJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { accept: "application/json" },
    ...options,
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message ?? `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }

  if (path === "/api/etoro/bot/operations") {
    const token = response.headers.get(botConfigCsrfResponseHeader);
    if (token) operationsMutationProtection = { csrfHeader: "x-etoro-dashboard-csrf", csrfToken: token };
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

async function getProfileJson(path, environment = selectedPortfolioEnvironment) {
  if (!["real", "demo"].includes(environment)) throw new Error("Select a profile first.");
  const controller = new AbortController();
  profileRequests.add(controller);
  try {
    return await getJson(`${path}${path.includes("?") ? "&" : "?"}environment=${environment}`, { signal: controller.signal });
  } finally {
    profileRequests.delete(controller);
  }
}

function readFailureState(error) {
  const code = error?.payload?.error?.code ?? error?.code ?? "";
  const status = error?.payload?.error?.status ?? error?.status;
  if (code === "ETORO_PROFILE_NOT_CONFIGURED" || code === "ETORO_CREDENTIALS_MISSING") return "not configured";
  if (status === 401 || status === 403) return "authentication rejected";
  if (status === 429) return "provider rate-limited";
  if (code === "ETORO_TIMEOUT") return "provider timeout";
  if (error instanceof SyntaxError || code.startsWith("ETORO_INVALID_") || /data is unavailable/.test(error?.message ?? "")) return "provider response malformed";
  return "provider unavailable";
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
  presentationConnection = activeState;
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
  if (select) { select.value = defaultEnvironment; for (const option of select.options) option.disabled = false; }
  text("portfolio-environment-label", "Profile readiness");
  text(
    "portfolio-environment-detail",
    `Real ${labelize(readiness.real ?? "not-configured")} · Demo ${labelize(readiness.demo ?? "not-configured")}`,
  );
  renderPresentationStatus();
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

function clearPortfolioBoundState() {
  closePresentationDialogs({ restoreFocus: false });
  presentationReadFailure = null;
  investmentFreshness.portfolio = { view: null, pending: false, failed: false };
  tableRows.portfolio = [];
  selectedPortfolioKey = null; displayCurrency = null; tableReview.portfolio.page = 1;
  renderPortfolioInspector(); renderCurrencyControls();
  text("portfolio-review-count", "No provider rows loaded");
  clearChartEvidence("portfolio");
  portfolioDataSource = "none";
  portfolioLastGoodEnvironment = null;
  selectedPortfolioSymbol = null;
  portfolioChartRequestSequence += 1;
  document.getElementById("portfolio-table-body")?.replaceChildren();
  text("mock-equity-label", "Equity");
  for (const id of ["portfolio-stat-balance", "portfolio-stat-frozen", "portfolio-stat-mirror"]) text(id, "Unavailable");
  text("mock-equity", "Unavailable");
  text("equity-detail", "Awaiting provider data");
  text("cash-buffer", "Unavailable");
  text("cash-buffer-detail", "Awaiting provider data");
  text("unrealized-pnl", "Unavailable");
  text("unrealized-pnl-detail", "Awaiting provider data");
  text("exposure", "Unavailable");
  text("exposure-detail", "Awaiting provider data");
  text("stale-data-label", "Direct positions");
  text("stale-data", "Unavailable");
  text("stale-data-detail", "Awaiting provider data");
  text("portfolio-source-watermark", "Provider only");
  text("portfolio-source-detail", "No provider portfolio values loaded");
  text("portfolio-freshness", "Freshness: unavailable");
  text("portfolio-omitted", "Omitted rows: unavailable");
  text("portfolio-partial", "No provider portfolio values loaded");
  text("chart-title", "Select a live holding");
  text("chart-period-label", "Market-price history unavailable");
  text("chart-provider", "Provider timestamp: unavailable");
  text("chart-request", "Provider request ID: hidden");
  text("chart-cache", "Cache: unavailable");
  text("source-detail", "No provider portfolio data loaded");
  text("portfolio-stat-cash", "Cash percentage unavailable");
  text("portfolio-stat-largest", "Largest holding unavailable");
  for (const id of ["portfolio-stat-realized", "portfolio-stat-coverage", "portfolio-stat-source", "portfolio-stat-basis"]) text(id, "Unavailable until provider data loads");
  for (const id of ["portfolio-financial-title", "portfolio-news-title", "portfolio-insider-title"]) text(id, "Unavailable");
  document.getElementById("performance-line")?.setAttribute("points", "");
  document.getElementById("performance-area")?.setAttribute("d", "");
}

function clearWatchlistBoundState() {
  investmentFreshness.watchlist = { view: null, pending: false, failed: false };
  tableRows.watchlist = [];
  text("watchlist-review-count", "No provider rows loaded");
  clearChartEvidence("watchlist");
  watchlistDataSource = "none";
  watchlistLastGoodEnvironment = null;
  selectedWatchlistSymbol = null;
  watchlistItemsBySymbol.clear();
  watchlistRequestSequence += 1;
  watchlistChartRequestSequence += 1;
  document.getElementById("watchlist-table-body")?.replaceChildren();
  text("watchlist-provider-state", "Awaiting provider read");
  text("watchlist-chart-title", "Select a watchlist instrument");
  text("watchlist-chart-period-label", "Market-price history unavailable");
  text("watchlist-chart-source", "Source: provider only");
  text("watchlist-chart-freshness", "Freshness: unavailable");
  text("watchlist-context-title", "Unavailable");
  text("watchlist-context-source", "Provider only");
  text("watchlist-context-freshness", "Unavailable");
  text("watchlist-context-detail", "Awaiting selected-profile data");
  text("watchlist-source-policy", "Awaiting provider read");
  document.getElementById("watchlist-chart-shell")?.setAttribute("aria-label", "Market-price history unavailable");
  document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
  document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
}

function selectEnvironment(environment) {
  if (!["real", "demo"].includes(environment)) return;
  profileGeneration += 1;
  etoroRefreshRequestSequence += 1;
  for (const controller of profileRequests) controller.abort();
  profileRequests.clear();
  selectedPortfolioEnvironment = environment;
  clearPortfolioBoundState();
  clearWatchlistBoundState();
  loadedTabIds.delete("watchlist-view");
  document.getElementById("audit-list")?.replaceChildren();
  document.getElementById("research-audit-list")?.replaceChildren();
  text("portfolio-read-state", "Portfolio: loading");
  text("workspace-profile", `${labelize(environment)} · Read only`);
  setTile("provider-status", "neutral", `Checking ${labelize(environment)} profile`, "Awaiting selected-profile readiness");
  setTile("last-sync", "neutral", "Last sync", "Awaiting selected-profile data");
  void refreshEtoro();
}

function renderPortfolioStatistics(view) {
  const ratio = view.equity !== null && view.equity > 0 && view.availableCash !== null ? view.availableCash / view.equity * 100 : null;
  text("portfolio-stat-cash", Number.isFinite(ratio) ? `${ratio.toFixed(2)}% of equity` : "Unavailable (positive equity required)");
  const valued = view.instruments.filter((item) => item.investedValue !== null);
  const largest = valued.sort((a, b) => b.investedValue - a.investedValue)[0];
  const percent = largest && view.totalInvested > 0 ? largest.investedValue / view.totalInvested * 100 : null;
  text("portfolio-stat-largest", largest ? `${largest.symbol}: ${accountMoney(largest.investedValue)}${Number.isFinite(percent) ? ` (${percent.toFixed(2)}% of ${view.coverage ? "account used margin" : "total invested"})` : " (percentage unavailable)"}` : "Unavailable");
  text("portfolio-stat-basis", `Largest among ${valued.length} displayed direct/copy aggregate rows with margin values; denominator: provider account used margin (including direct margin, frozen pending orders and mirror active margin). Omitted or incomplete holdings may change the ranking. Invested capital is not complete leveraged exposure.`);
  text("portfolio-stat-realized", accountMoney(view.realizedPnl, true));
  text("portfolio-stat-balance", accountMoney(view.accountBalance));
  text("portfolio-stat-frozen", accountMoney(view.frozenCash));
  text("portfolio-stat-mirror", accountMoney(view.mirrorCash));
  text("portfolio-stat-coverage", `${view.openPositionCount ?? "Unavailable"} ${view.coverage ? "direct and copy" : "direct"} positions; ${view.instrumentCount} displayed ${view.coverage ? "aggregate rows" : "instruments"}; ${view.omittedRowCount} omitted ${view.coverage ? "aggregate rows" : "direct positions"}; ${view.incompleteRowCount} incomplete included ${view.coverage ? "aggregate rows" : "positions"}. Copy allocations: ${view.mirrorCount ?? "unavailable"}; pending orders: ${view.pendingOrderCount ?? "unavailable"}. ${view.coverage ? `Copy rows are included only where aggregates are supplied; copy coverage ${view.coverage.copyHoldingsStatus}, manual coverage ${view.coverage.manualHoldingsStatus}. Mirror cash and frozen pending-order amounts remain separate account fields.` : "Copy holdings and pending orders are outside the displayed instrument coverage."}`);
  text("portfolio-stat-source", `${labelize(view.environment)} snapshot · ${view.cache.state === "stale" ? "stale" : "provider normalized"} · ${view.providerUpdatedAt ?? "timestamp unavailable"}`);
}

function renderProviderPortfolio(payload) {
  const view = normalizeLivePortfolioPayload(payload);
  if (selectedPortfolioEnvironment && view.environment !== selectedPortfolioEnvironment) throw new Error("Portfolio data is unavailable.");
  const body = document.getElementById("portfolio-table-body");

  if (!body) return view;

  investmentFreshness.portfolio = { view, pending: false, failed: false };
  presentationReadFailure = null;
  presentationConnection = "ready";
  tableRows.portfolio = [];
  portfolioDataSource = "provider-normalized";
  portfolioLastGoodEnvironment = view.environment;
  const focusedKey = document.activeElement?.dataset.instrumentRow !== undefined ? document.activeElement.dataset.rowKey : null;
  body.replaceChildren();
  for (const instrument of view.instruments) {
    const row = document.createElement("tr");
    row.className = "instrument-row";
    row.tabIndex = 0;
    row.dataset.instrumentRow = "";
    row.dataset.symbol = instrument.symbol;
    row.dataset.rowKey = portfolioRowKey(instrument);
    row.dataset.source = "provider-normalized";
    row.setAttribute("aria-haspopup", "dialog");
    row.setAttribute("aria-controls", "portfolio-inspector");

    const assetCell = document.createElement("td");
    const symbol = document.createElement("strong");
    const detail = document.createElement("span");
    symbol.textContent = instrument.fieldReasons?.symbol ? "Unresolved instrument" : instrument.symbol;
    detail.textContent = `${instrument.displayName} · ${labelize(instrument.scope ?? "direct")} · ${instrument.assetCurrency ?? "Native denomination unverified"}`;
    const command = document.createElement("span"); command.className = "holding-open-label"; command.textContent = "Open details";
    row.setAttribute("aria-label", `${symbol.textContent}, ${instrument.displayName}, ${labelize(instrument.scope ?? "direct")}. Open holding details with Enter or Space.`);
    assetCell.append(symbol, detail);
    assetCell.append(command);
    row.append(assetCell);

    for (const [key, signed] of [["investedValue", false], ["netValue", false], ["unrealizedPnl", true]]) setPortfolioField(appendPortfolioCell(row, "", signed ? signedClass(signedMoney(instrument[key])) : undefined), instrument[key], accountMoney(instrument[key], signed), portfolioFieldLabels[key], instrument.fieldReasons?.[key]);
    setPortfolioField(appendPortfolioCell(row, "", signedClass(signedPercent(instrument.unrealizedPnlPercent))), instrument.unrealizedPnlPercent, signedPercent(instrument.unrealizedPnlPercent), portfolioFieldLabels.unrealizedPnlPercent, instrument.fieldReasons?.unrealizedPnlPercent);
    appendPortfolioCell(row, instrument.completeness === "complete" ? "Complete" : "Partial · inspect", instrument.completeness === "complete" ? "good-text" : "warn-text");
    bindPortfolioRow(row);
    tableRows.portfolio.push({ row, item: instrument });
    body.append(row);
  }
  if (view.instruments.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = view.coverage?.copyHoldingsStatus === "incomplete" || view.coverage?.manualHoldingsStatus === "incomplete" ? "No holdings to display; some holdings coverage is unknown" : view.openPositionCount === 0 ? view.coverage ? "No holdings to display" : "No direct positions" : "No holdings to display; coverage is incomplete";
    row.append(cell);
    body.append(row);
  }

  const rows = [...body.querySelectorAll("[data-instrument-row]")];
  const selected = rows.find((row) => row.dataset.rowKey === selectedPortfolioKey) ?? rows[0];
  selectedPortfolioSymbol = selected?.dataset.symbol ?? null;
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
  text("exposure", accountMoney(view.usedMargin ?? null));
  text("exposure-detail", "Provider-normalized used margin");
  text("stale-data-label", view.coverage ? "direct and copy positions" : "Direct positions");
  text("stale-data", view.openPositionCount === null ? "Unavailable" : String(view.openPositionCount));
  text("stale-data-detail", `${view.instrumentCount} direct/copy aggregate row${view.instrumentCount === 1 ? "" : "s"}`);
  text("portfolio-source-watermark", `${labelize(view.environment)} provider`);
  text("portfolio-source-detail", "Read-only aggregate; no account, position, or order identifiers");

  const cacheState = view.cache?.state ?? "unknown";
  const cacheAge = view.cache?.cachedAt ? ` · cached ${view.cache.cachedAt}` : "";
  text("portfolio-read-state", `Portfolio: provider ${labelize(cacheState)}${cacheAge}`);
  text("portfolio-freshness", `Provider updated: ${view.providerUpdatedAt ?? "unavailable"}`);
  text("portfolio-omitted", `Omitted rows: ${view.omittedRowCount}`);
  text(
    "portfolio-partial",
    view.incompleteRowCount > 0 || view.omittedRowCount > 0
      ? `Partial coverage: ${view.incompleteRowCount} incomplete ${view.coverage ? "aggregate rows" : "direct positions"}; ${view.omittedRowCount} omitted`
      : "Displayed direct/copy aggregate value coverage: complete",
  );
  text("chart-provider", `Provider timestamp: ${view.providerUpdatedAt ?? "unavailable"}`);
  text("chart-request", "Provider request ID: hidden");
  text("chart-cache", `Cache: ${labelize(cacheState)} (${view.cache?.ttlMs ?? 0} ms)`);
  text("source-detail", view.incompleteRowCount > 0 ? "Partial normalized provider values" : "Normalized provider portfolio");
  renderPortfolioMoney();
  applyTableReview("portfolio", { refreshSelection: false });
  if (focusedKey) (tableRows.portfolio.find(({ item, row }) => portfolioRowKey(item) === focusedKey && !row.hidden)?.row ?? tableRows.portfolio.find(({ item, row }) => portfolioRowKey(item) === selectedPortfolioKey && !row.hidden)?.row ?? document.getElementById("portfolio-review-search"))?.focus?.();
  applyInvestmentFreshness();
  updatePortfolioPeriod(selectedPortfolioPeriod);
  return view;
}

function renderPortfolioReadFailure(error, { retainLastGood = false } = {}) {
  const retainedView = retainLastGood && investmentFreshness.portfolio.view?.environment === (selectedPortfolioEnvironment ?? portfolioLastGoodEnvironment)
    ? investmentFreshness.portfolio.view : null;
  clearChartEvidence("portfolio");
  portfolioChartRequestSequence += 1;
  document.getElementById("performance-line")?.setAttribute("points", "");
  document.getElementById("performance-area")?.setAttribute("d", "");
  text("chart-period-label", "Market history unavailable; portfolio refresh failed");
  text("chart-provider", "Provider timestamp: unavailable");
  text("chart-cache", "Cache: unavailable");
  if (!retainedView) {
    clearPortfolioBoundState();
  }
  const payload = error?.payload ?? {};
  const cache = payload.cache;
  const validCache = cache &&
    (hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs", "reason", "retryAt", "failureAt"]) ||
      hasExactKeys(cache, ["state", "cachedAt", "expiresAt", "ttlMs", "reason"])) &&
    ["error", "backoff"].includes(cache.state) &&
    ((cache.cachedAt === null && cache.expiresAt === null) || (isIsoInstant(cache.cachedAt) && isIsoInstant(cache.expiresAt) && Date.parse(cache.expiresAt) - Date.parse(cache.cachedAt) === cache.ttlMs)) &&
    Number.isInteger(cache.ttlMs) && cache.ttlMs > 0 && cache.ttlMs <= 300_000 &&
    (cache.retryAt === undefined || (isIsoInstant(cache.retryAt) && isIsoInstant(cache.failureAt) && Date.parse(cache.retryAt) >= Date.parse(cache.failureAt))) &&
    typeof cache.reason === "string" && /^[A-Z0-9_]{1,80}$/.test(cache.reason);
  const failure = readFailureState(error);
  presentationReadFailure = failure;
  const state = validCache && cache.state === "backoff"
    ? `Portfolio: ${failure} (backoff)`
    : `Portfolio: ${failure}`;
  text("portfolio-read-state", state);
  if (retainedView) text("portfolio-stat-source", `${labelize(selectedPortfolioEnvironment)} snapshot · stale; refresh failed`);
  text("portfolio-freshness", retainedView ? "Freshness: stale; last-good provider rows retained" : "Freshness: unavailable; no provider rows loaded");
  text("portfolio-omitted", retainedView ? `Omitted rows: ${retainedView.omittedRowCount} (retained stale snapshot)` : "Omitted rows: unavailable");
  const retry = validCache ? `; ${cache.retryAt ? `retry after ${cache.retryAt}` : `retry window ${cache.ttlMs} ms`}` : "";
  text("portfolio-partial", retainedView
    ? `Retained stale coverage: ${retainedView.incompleteRowCount} incomplete ${retainedView.coverage ? "aggregate rows" : "direct positions"}; ${retainedView.omittedRowCount} omitted · Current provider read failed${retry}`
    : `Provider read failed; no last-good provider response${retry}`);
  investmentFreshness.portfolio.pending = false;
  investmentFreshness.portfolio.failed = true;
  applyInvestmentFreshness();
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
    renderPortfolioReadFailure(error, { retainLastGood: portfolioDataSource === "provider-normalized" && portfolioLastGoodEnvironment === selectedPortfolioEnvironment });
    renderAudit(
      "Partial provider read",
      "Provider response invalid; only same-profile last-good rows may remain, marked stale",
    );
    return false;
  }
}

async function renderSelectedPortfolioInstrument() {
  const sequence = ++portfolioChartRequestSequence;
  renderPortfolioInspector();
  clearChartEvidence("portfolio");
  const line = document.getElementById("performance-line");
  const area = document.getElementById("performance-area");
  line?.setAttribute("points", ""); area?.setAttribute("d", "");
  text("selected-period-pill", periodLabel(selectedPortfolioPeriod));
  const selectedItem = tableRows.portfolio.find(({ item }) => portfolioRowKey(item) === selectedPortfolioKey)?.item;
  if (!selectedPortfolioSymbol || selectedItem?.fieldReasons?.symbol || portfolioDataSource !== "provider-normalized") {
    text("chart-title", selectedItem?.fieldReasons?.symbol ? "Unresolved instrument" : "Select a live holding"); text("chart-period-label", selectedItem?.fieldReasons?.symbol ?? "Market-price history unavailable"); return;
  }
  const shell = document.getElementById("portfolio-chart-shell");
  if (shell) { shell.dataset.freshness = "pending"; shell.setAttribute("aria-busy", "true"); shell.setAttribute("aria-label", `${selectedPortfolioSymbol} market history pending`); }
  text("chart-title", `${selectedPortfolioSymbol} market-price history`);
  text("chart-period-label", `Loading ${periodLabel(selectedPortfolioPeriod)} close points`);
  text("chart-provider", "Provider timestamp: unavailable");
  text("chart-cache", "Cache: awaiting provider response");
  text("portfolio-financial-title", "Provider holding selected");
  text("portfolio-financial-detail", "Market history is independent from portfolio performance.");
  text("portfolio-news-title", "Unavailable"); text("portfolio-news-detail", "No synthetic market context is shown.");
  text("portfolio-insider-title", "Unavailable"); text("portfolio-insider-detail", "No synthetic ownership context is shown.");
  try {
    const symbol = selectedPortfolioSymbol;
    const period = selectedPortfolioPeriod;
    const environment = selectedPortfolioEnvironment;
    const chart = normalizeMarketChartPayload(await getProfileJson(`/api/etoro/market/chart?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`, environment), symbol, period, environment);
    if (sequence !== portfolioChartRequestSequence) return;
    chartFreshness.portfolio = chart;
    renderChartEvidence("portfolio", chart);
    setPerformanceChart(marketChartSvgPoints(chart.points));
    text("chart-period-label", `Instrument market-price history · ${chart.pointCount} close points · ${chart.points[0].at} to ${chart.points.at(-1).at}; available history only`);
    text("chart-provider", `Last candle start: ${chart.providerUpdatedAt} · completion unverified`);
    text("chart-cache", `Cache: ${labelize(chart.cache.state)} (${chart.cache.ttlMs} ms)`);
    applyInvestmentFreshness();
  } catch (error) {
    if (sequence !== portfolioChartRequestSequence) return;
    if (shell) { shell.dataset.freshness = "failed"; shell.setAttribute("aria-busy", "false"); shell.setAttribute("aria-label", "Market-price history failed; no provider history available"); }
    text("chart-period-label", `Instrument market-price history unavailable · ${readFailureState(error)}`);
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
  if (document.getElementById("portfolio-inspector")?.open) void renderSelectedPortfolioInstrument();
}

function selectPortfolioInstrument(row) {
  if (!row) {
    return;
  }

  selectedPortfolioSymbol = row.dataset.symbol ?? selectedPortfolioSymbol;
  selectedPortfolioKey = row.dataset.rowKey ?? `direct:${selectedPortfolioSymbol}`;
  renderPortfolioInspector();

  document.querySelectorAll("[data-instrument-row]").forEach((candidate) => {
    candidate.classList.toggle("active", candidate === row);
    candidate.setAttribute("aria-selected", String(candidate === row));
  });

  renderSelectedPortfolioInstrument();
  renderAudit(
    `${selectedPortfolioSymbol} selected`,
    "Instrument summary row selected locally; enrichment receipts remain context-only",
  );
}

function bindPortfolioRow(row) {
  const open = () => { selectPortfolioInstrument(row); openPresentationDialog("portfolio-inspector", row, { loadChart: false }); };
  row.addEventListener("click", open);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
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
  const value = item.lastExecution ?? (item.bid / 2 + item.ask / 2);
  return price(value);
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
    const elapsed = Date.parse(points.at(-1).at) - Date.parse(points[0].at);
    const x = elapsed === 0 ? 320 : ((Date.parse(points[index].at) - Date.parse(points[0].at)) / elapsed) * 640;
    const y = range === 0 ? 130 : 20 + ((high - close) / range) * 220;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function renderProviderWatchlist(payload, { refreshChart = true } = {}) {
  const view = normalizeWatchlistViewPayload(payload, selectedPortfolioEnvironment);
  const body = document.getElementById("watchlist-table-body");
  if (!body) return view;

  investmentFreshness.watchlist = { view, pending: false, failed: false };
  tableRows.watchlist = [];
  watchlistDataSource = "provider-normalized";
  watchlistLastGoodEnvironment = selectedPortfolioEnvironment;
  watchlistItemsBySymbol.clear();
  const focusedSymbol = document.activeElement?.dataset.watchlistRow !== undefined ? document.activeElement.dataset.watchlistSymbol : null;
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
    appendWatchlistCell(row, `${item.displayName} · Listing currency unavailable`);
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
    tableRows.watchlist.push({ row, item });
    body.append(row);
  }

  if (view.items.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.setAttribute("colspan", "6");
    cell.textContent = view.omittedItemCount > 0 ? "No displayable watchlist instruments; provider items were omitted" : "No instrument items were returned by the default watchlist.";
    row.append(cell);
    body.append(row);
  }

  const rows = [...body.querySelectorAll("[data-watchlist-row]")];
  const selected = rows.find((row) => row.dataset.watchlistSymbol === selectedWatchlistSymbol) ?? rows[0];
  selectedWatchlistSymbol = selected?.dataset.watchlistSymbol ?? null;
  if (selected) {
    selectedWatchlistSymbol = selected.dataset.watchlistSymbol;
    selected.classList.add("active");
  }
  const state = document.getElementById("watchlist-provider-state");
  if (state) {
    state.textContent = view.cache.state === "stale" ? "Provider rows stale" : view.items.length === 0 && view.omittedItemCount === 0 ? "Watchlist empty" : view.providerState === "complete" && view.omittedItemCount === 0 ? "Provider complete" : "Provider partial";
    state.classList.toggle("lock", false);
    state.classList.toggle("warn", view.providerState === "partial" || view.cache.state === "stale" || view.omittedItemCount > 0);
    state.classList.toggle("ok", view.providerState === "complete" && view.cache.state !== "stale" && view.omittedItemCount === 0);
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
  applyTableReview("watchlist", { refreshSelection: false });
  if (focusedSymbol) tableRows.watchlist.find(({ item, row }) => item.symbol === focusedSymbol && !row.hidden)?.row.focus?.();
  applyInvestmentFreshness();
  if (refreshChart) updateWatchlistPeriod(selectedWatchlistPeriod);
  return view;
}

function renderWatchlistReadFailure(error) {
  const retained = watchlistDataSource === "provider-normalized" && watchlistLastGoodEnvironment === selectedPortfolioEnvironment;
  if (!retained) clearWatchlistBoundState();
  clearChartEvidence("watchlist");
  watchlistChartRequestSequence += 1;
  document.querySelectorAll("[data-watchlist-row]").forEach((row) => {
    const value = row.querySelector("[data-watchlist-period-value]");
    if (value) { value.textContent = "Unavailable"; value.className = "neutral-text"; }
  });
  document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
  document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
  text("watchlist-chart-source", "Source: unavailable");
  text("watchlist-context-source", "Provider read unavailable");
  text("watchlist-context-freshness", "Unavailable");
  text("watchlist-context-detail", "Market history unavailable until a successful read");
  document.getElementById("watchlist-chart-shell")?.setAttribute("aria-label", "Market-price history unavailable");
  text("watchlist-chart-period-label", "Market history unavailable; watchlist refresh failed");
  const state = document.getElementById("watchlist-provider-state");
  if (state) {
    state.textContent = retained ? `Provider rows stale · ${readFailureState(error)}` : `Watchlist: ${readFailureState(error)}`;
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
  investmentFreshness.watchlist.pending = false;
  investmentFreshness.watchlist.failed = true;
  applyInvestmentFreshness();
}

function renderMarketChart(payload, expectedSymbol, expectedPeriod) {
  const chart = normalizeMarketChartPayload(payload, expectedSymbol, expectedPeriod, selectedPortfolioEnvironment);
  chartFreshness.watchlist = chart;
  renderChartEvidence("watchlist", chart);
  const svgPoints = marketChartSvgPoints(chart.points);
  setChartPath("watchlist-performance-line", "watchlist-performance-area", svgPoints);
  text("watchlist-chart-title", `${chart.symbol} selected-period market chart`);
  text("watchlist-selected-period-pill", periodLabel(chart.period));
  text("watchlist-chart-period-label", `${periodLabel(chart.period)} · ${chart.interval} · ${chart.pointCount} points · available history: ${chart.points[0].at} to ${chart.points.at(-1).at}`);
  const stale = chart.cache.state === "stale";
  text("watchlist-chart-source", `Source: provider ${stale ? "stale" : "normalized"} · ${signedPercent(chart.changePercent)}`);
  text("watchlist-chart-freshness", `${stale ? "Stale history; last provider update" : "Provider updated"}: ${chart.providerUpdatedAt}`);
  text("watchlist-context-title", chart.displayName);
  text("watchlist-context-source", "Exact-symbol eToro market data");
  text("watchlist-context-freshness", `${stale ? "Stale: " : ""}${chart.providerUpdatedAt}`);
  text("watchlist-context-detail", "Selected-period close prices are informational only and cannot trigger orders.");
  document.getElementById("watchlist-chart-shell")?.setAttribute(
    "aria-label",
    `${chart.symbol} ${periodLabel(chart.period)} ${stale ? "stale" : "normalized"} provider close-price chart`,
  );
  const selectedRow = [...document.querySelectorAll("[data-watchlist-row]")]
    .find((row) => row.dataset.watchlistSymbol === chart.symbol);
  const periodCell = selectedRow?.querySelector("[data-watchlist-period-value]");
  if (periodCell) {
    const value = `${signedPercent(chart.changePercent)}${stale ? " (stale)" : ""}`;
    periodCell.textContent = value;
    periodCell.classList.remove("good-text", "bad-text", "neutral-text");
    periodCell.classList.add(signedClass(value));
  }
  applyInvestmentFreshness();
  return chart;
}

async function refreshSelectedWatchlistMarket() {
  const requestSequence = ++watchlistChartRequestSequence;
  clearChartEvidence("watchlist");
  const symbol = selectedWatchlistSymbol;
  const period = selectedWatchlistPeriod;
  const environment = selectedPortfolioEnvironment;
  const selectedRow = [...document.querySelectorAll("[data-watchlist-row]")]
    .find((row) => row.dataset.watchlistSymbol === symbol);
  const periodCell = selectedRow?.querySelector("[data-watchlist-period-value]");
  if (periodCell) {
    periodCell.textContent = "Unavailable";
    periodCell.className = "neutral-text";
  }
  text("watchlist-selected-period-pill", periodLabel(period));
  text("watchlist-chart-title", `${symbol} market chart loading`);
  text("watchlist-chart-source", "Source: awaiting provider response");
  text("watchlist-chart-freshness", "Freshness: unavailable");
  text("watchlist-context-title", symbol);
  text("watchlist-context-source", "Awaiting provider response");
  text("watchlist-context-freshness", "Unavailable");
  text("watchlist-context-detail", "Loading exact-symbol market history");
  const shell = document.getElementById("watchlist-chart-shell");
  if (shell) { shell.dataset.freshness = "pending"; shell.setAttribute("aria-busy", "true"); shell.setAttribute("aria-label", "Market-price history pending"); }
  text("watchlist-chart-period-label", `Selected period: ${periodLabel(period)} · loading`);
  document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
  document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
  try {
    const payload = await getProfileJson(`/api/etoro/market/chart?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`, environment);
    if (requestSequence !== watchlistChartRequestSequence || environment !== selectedPortfolioEnvironment || symbol !== selectedWatchlistSymbol || period !== selectedWatchlistPeriod) return;
    renderMarketChart(payload, symbol, period);
  } catch (error) {
    if (requestSequence !== watchlistChartRequestSequence || environment !== selectedPortfolioEnvironment || symbol !== selectedWatchlistSymbol || period !== selectedWatchlistPeriod) return;
    if (shell) { shell.dataset.freshness = "failed"; shell.setAttribute("aria-busy", "false"); }
    text("watchlist-chart-title", `${symbol} market chart unavailable`);
    text("watchlist-chart-source", "Source: unavailable");
    text("watchlist-chart-period-label", `Selected period: ${periodLabel(period)} · ${readFailureState(error)}`);
    text("watchlist-chart-freshness", "Freshness: unavailable; no fixture substitution");
    text("watchlist-context-source", "Provider market read unavailable");
    text("watchlist-context-freshness", "Unavailable");
    text("watchlist-context-detail", "Market history unavailable until a successful read");
    document.getElementById("watchlist-chart-shell")?.setAttribute("aria-label", "Market-price history unavailable");
  }
}

function renderSelectedWatchlistInstrument() {
  if (watchlistDataSource === "provider-normalized") {
    if (!watchlistItemsBySymbol.has(selectedWatchlistSymbol)) {
      clearChartEvidence("watchlist");
      watchlistChartRequestSequence += 1;
      text("watchlist-chart-title", "No watchlist instrument selected");
      text("watchlist-context-title", "Unavailable");
      text("watchlist-context-source", "No selected instrument");
      text("watchlist-context-freshness", "Unavailable");
      text("watchlist-context-detail", "No market context available");
      document.getElementById("watchlist-chart-shell")?.setAttribute("aria-label", "Market-price history unavailable");
      text("watchlist-chart-period-label", "Selected-period market data unavailable");
      document.getElementById("watchlist-performance-line")?.setAttribute("points", "");
      document.getElementById("watchlist-performance-area")?.setAttribute("d", "");
      return;
    }
    void refreshSelectedWatchlistMarket();
    return;
  }
  text("watchlist-chart-title", "Select a watchlist instrument");
  text("watchlist-chart-period-label", "Market-price history unavailable");
}

function updateWatchlistPeriod(period) {
  selectedWatchlistPeriod = period;

  document.querySelectorAll("[data-watchlist-period]").forEach((button) => {
    const active = button.dataset.watchlistPeriod === period;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  document.querySelectorAll("[data-watchlist-row]").forEach((row) => {
    const value = "Unavailable";
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
    candidate.setAttribute("aria-selected", String(candidate === row));
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
  normalizeDraftBotConfig(configPayload.config);
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
  const sequence = ++watchlistRequestSequence;
  const environment = selectedPortfolioEnvironment;
  if (!environment) return;
  investmentFreshness.watchlist.pending = true;
  applyInvestmentFreshness();
  text("watchlist-provider-state", watchlistDataSource === "provider-normalized" ? "Refreshing; previous rows stale" : "Loading watchlist");
  try {
    const payload = await getProfileJson("/api/etoro/watchlist/default", environment);
    if (sequence !== watchlistRequestSequence || environment !== selectedPortfolioEnvironment) return;
    renderProviderWatchlist(payload);
  } catch (error) {
    if (sequence !== watchlistRequestSequence || environment !== selectedPortfolioEnvironment) return;
    renderWatchlistReadFailure(error);
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

function setDraftControlsDisabled(disabled) {
  document.querySelectorAll("#bot-config-form input, #bot-config-form select, #bot-config-form button").forEach((control) => { control.disabled = disabled; });
}

function applyOperationsFreshness(now = Date.now()) {
  const payload = operationsPayload;
  const expired = payload && now >= Date.parse(payload.expiresAt);
  const state = operationsFailed ? payload ? "stale" : "failed" : expired ? "stale" : payload?.state ?? "unavailable";
  const usable = payload && !operationsFailed && !expired && !["stale", "failed"].includes(payload.state);
  text("operations-state", `${labelize(state)}${operationsPending ? " · refreshing" : ""}${pendingOperations.size ? " · action pending" : ""}`);
  const panel = document.getElementById("operations-state");
  if (panel) panel.dataset.freshness = state;
  text("operations-observation", payload ? `${labelize(state)} · observed ${payload.observedAt} · expires ${payload.expiresAt}; ledger timestamps are not refresh evidence` : `${labelize(state)}; no authoritative telemetry observed`);
  for (const id of ["operations-runtime", "operations-provenance", "operations-lease", "operations-ledger", "operations-identity", "operations-result", "operations-veto"]) {
    const node = document.getElementById(id);
    if (node) { node.dataset.freshness = state; node.setAttribute("title", `Observed telemetry: ${state}`); }
  }
  const hasToken = Boolean(operationsMutationProtection?.csrfToken);
  const run = document.getElementById("operations-run");
  if (run) { run.disabled = !usable || !hasToken || !payload.capabilities.runOnce || (payload.operation?.status === "pending" && !(retryOperation?.operationId === payload.operation.id && payload.operation.action === "run-once" && payload.lease.workerState === "available")) || operationsPending || pendingOperations.size > 0; run.textContent = retryOperation ? "Retry the same diagnostic request" : "Run approved synthetic diagnostic once"; }
  const block = document.getElementById("operations-block");
  // A running diagnostic can be fenced while its request is still pending.
  if (block) block.disabled = !payload || !hasToken || !payload.runtime.verified || !payload.capabilities.block || pendingOperations.has("block") || pendingOperations.has("reenable");
  const reenable = document.getElementById("operations-reenable");
  if (reenable) reenable.disabled = !usable || !hasToken || !payload.capabilities.reenable || operationsPending || pendingOperations.size > 0;
}

function renderOfflineOperations(raw) {
  const payload = normalizeOfflineOperationsPayload(raw);
  if (retryOperation?.operationId === payload.operation?.id && retryOriginalStartedAt && payload.operation.startedAt !== retryOriginalStartedAt) throw new Error("Offline operation original start changed.");
  operationsPayload = payload;
  operationsFailed = false;
  if (payload.operation?.action === "run-once" && payload.operation.status === "pending") {
    retryOperation = { action: "run-once", operationId: payload.operation.id };
    retryOriginalStartedAt = payload.operation.startedAt;
  }
  text("operations-runtime", payload.runtime.verified ? `${payload.runtime.fixture} · ${payload.runtime.strategyId} · budget ${money(payload.runtime.budgetUsd)} · allocation ${money(payload.runtime.botAllocationUsd)} · reserve ${money(payload.runtime.reservedUsd)} · order cap ${money(payload.runtime.maxOrderUsd)} · fixed approved runner` : "Unavailable; runtime verification failed");
  text("operations-provenance", `${payload.runtime.verified ? "Verified immutable runtime" : "Unverified runtime"} · ${payload.runtime.producerCommit} · ${payload.runtime.manifestId}`);
  text("operations-lease", `${labelize(payload.lease.workerState)} · integrity ${payload.lease.integrity} · completions ${payload.lease.completionCount ?? "unavailable"} · block reason ${payload.lease.killSwitchReason ?? "none"}`);
  text("operations-ledger", `Integrity ${payload.ledger.integrity} · ${payload.ledger.recordCount} records · latest recorded ${payload.ledger.latestRecordedAt ?? "none"}`);
  text("operations-identity", payload.operation ? `${payload.operation.id} · ${payload.operation.action} · ${payload.operation.status} · original start ${payload.operation.startedAt}` : "None observed");
  const result = payload.lastResult;
  text("operations-result", result ? result.diagnostics ? `${result.status} · started ${result.startedAt} · ${result.diagnostics.fixtureRows} fixture rows · ${result.diagnostics.eventCount} events · ${result.diagnostics.blockedEventCount} blocked; history ${result.diagnostics.strategyHistoryState}, walk-forward ${result.diagnostics.walkForwardState}, sampling ${result.diagnostics.samplingState}` : `${result.status} · started ${result.startedAt}; diagnostics not run` : "No result observed");
  text("operations-veto", result ? result.vetoReasons.join(", ") || "None returned" : "No result observed");
  if (retryOperation && payload.operation?.id === retryOperation.operationId && ["completed", "already-completed"].includes(payload.operation.status)) { retryOperation = null; retryOriginalStartedAt = null; }
  applyOperationsFreshness();
  return payload;
}

async function refreshOfflineOperations() {
  const sequence = ++operationsRequestSequence;
  operationsPending = true;
  applyOperationsFreshness();
  try {
    const payload = await getJson("/api/etoro/bot/operations");
    if (sequence !== operationsRequestSequence) return;
    renderOfflineOperations(payload);
  } catch {
    if (sequence !== operationsRequestSequence) return;
    operationsFailed = true;
    renderAudit("Diagnostic telemetry refresh failed", "Previous observation remains stale; refresh before running or re-enabling", "bot-audit-list");
  } finally {
    if (sequence === operationsRequestSequence) operationsPending = false;
    applyOperationsFreshness();
  }
}

async function operateOfflineDiagnostic(action) {
  const controlId = { "run-once": "operations-run", block: "operations-block", reenable: "operations-reenable" }[action];
  if (!controlId || document.getElementById(controlId)?.disabled || !operationsMutationProtection?.csrfToken) return;
  const operation = action === "run-once" && retryOperation ? retryOperation : { action, operationId: crypto.randomUUID() };
  if (action === "run-once") retryOperation = operation;
  const sequence = ++operationsRequestSequence;
  operationsPending = false;
  pendingOperations.add(action);
  applyOperationsFreshness();
  text("operations-action-status", `${labelize(action)} requested; awaiting authoritative readback.`);
  renderAudit("Diagnostic action requested", `${labelize(action)}; approved isolated synthetic runtime only`, "bot-audit-list");
  try {
    const protection = operationsMutationProtection;
    const raw = await sendJsonWithMethod("POST", "/api/etoro/bot/operations", operation, { [protection.csrfHeader]: protection.csrfToken });
    if (sequence !== operationsRequestSequence) return;
    normalizeOfflineOperationsPayload(raw);
    if (raw.action?.type !== action || raw.operation?.id !== operation.operationId) throw new Error("Offline action readback is unavailable.");
    const payload = renderOfflineOperations(raw);
    text("operations-action-status", `Authoritative readback: ${labelize(payload.action?.status ?? payload.operation?.status ?? payload.state)}. Observed ${payload.observedAt}.`);
    renderAudit("Diagnostic action read back", `${labelize(action)}; ${payload.state}; no provider or account effects`, "bot-audit-list");
  } catch {
    if (sequence !== operationsRequestSequence) return;
    operationsFailed = true;
    text("operations-action-status", "Action outcome requires reconciliation; refreshing authoritative state. A diagnostic retry keeps the same operation identity and original server start.");
    await refreshOfflineOperations();
  } finally {
    pendingOperations.delete(action);
    applyOperationsFreshness();
  }
}

async function refreshBotStatus() {
  setDraftControlsDisabled(true);
  await Promise.allSettled([
    refreshOfflineOperations(),
    (async () => {
      try {
        const { status, strategies, config } = await getJson("/api/etoro/bot/snapshot");
        normalizeDraftBotConfig(config.config);
        renderBotControlSelects(status, strategies, config);
        renderBotStrategies(strategies);
        text("bot-strategy-control-state", "Saved draft only; runner fixed");
        setDraftControlsDisabled(false);
        applyBotStrategyRuleControls(config);
      } catch {
        botConfigMutationProtection = null;
        text("bot-config-source-state", "Unavailable or stale saved draft; refresh required");
        setDraftControlsDisabled(true);
        renderAudit("Draft preferences unavailable", "Saved draft cannot be edited until refreshed; observed runtime remains separate", "bot-audit-list");
      }
    })(),
  ]);
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
    "portfolio-view": async () => {},
    "watchlist-view": refreshResearchStatus,
  };
  const generation = profileGeneration;
  const refresher = refreshers[targetId];

  if (!refresher) {
    return;
  }

  await refresher();
  if (generation === profileGeneration) loadedTabIds.add(targetId);
}

function activeTabId() {
  return document.querySelector("[data-tab-target].active")?.dataset.tabTarget ?? portfolioTabId;
}

function activateTab(targetId) {
  closePresentationDialogs({ restoreFocus: false });
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === targetId;

    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });

  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== targetId;
  });

  void refreshTabStatus(targetId);
}

async function refreshEtoro() {
  const sequence = ++etoroRefreshRequestSequence;
  void refreshFx();
  investmentFreshness.portfolio.pending = true;
  applyInvestmentFreshness();
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
    text("workspace-profile", `${labelize(environment)} · Read only`);
    const selectedState = status.profileReadiness?.[environment] ?? "not-configured";
    const portfolioRead = selectedState === "ready"
      ? getProfileJson("/api/etoro/portfolio", environment)
      : Promise.resolve(null);
    const [portfolioResult] = await Promise.allSettled([
      portfolioRead,
      refreshTabStatus(activeTabId(), { force: true }),
    ]);
    if (sequence !== etoroRefreshRequestSequence || environment !== selectedPortfolioEnvironment) return;

    if (selectedState !== "ready") {
      const retainedProviderRows = portfolioDataSource === "provider-normalized" && portfolioLastGoodEnvironment === environment;
      const readinessFailures = {
        "not-configured": { code: "ETORO_PROFILE_NOT_CONFIGURED", status: 503 },
        "unauthorized-or-expired": { status: 401 },
        "wrong-environment": { status: 403 },
        "rate-limited": { status: 429 },
        timeout: { code: "ETORO_TIMEOUT" },
        malformed: { code: "ETORO_INVALID_RESPONSE" },
      };
      renderPortfolioReadFailure(readinessFailures[selectedState] ?? { status: 503 }, { retainLastGood: retainedProviderRows });
      if (retainedProviderRows) text("portfolio-stat-source", `${labelize(environment)} snapshot · stale; ${labelize(selectedState)}`);
      text(
        "portfolio-freshness",
        retainedProviderRows ? freshnessDetail(investmentFreshness.portfolio) : `Freshness: failed; ${labelize(selectedState)}; no provider rows loaded`,
      );
      if (!retainedProviderRows) {
        text("portfolio-omitted", "Omitted rows: unavailable until provider read");
        text("portfolio-partial", "No provider portfolio values loaded");
      }
      renderAudit(
        retainedProviderRows ? "Provider rows retained in memory" : "Portfolio provider unavailable",
        retainedProviderRows
          ? "Selected profile is not ready; prior rows are marked stale"
          : "No credentials or synthetic portfolio values are present in the browser",
      );
    } else if (portfolioResult.status === "fulfilled") {
      if (renderFulfilledProviderPortfolio(portfolioResult.value)) {
        applyInvestmentFreshness();
      }
    } else {
      renderPortfolioReadFailure(portfolioResult.reason, { retainLastGood: portfolioLastGoodEnvironment === environment });
      renderAudit(
        "Partial provider read",
        "Provider status loaded, but portfolio data is unavailable; existing rows are retained in memory only",
      );
    }
  } catch (error) {
    if (sequence !== etoroRefreshRequestSequence) return;
    setTile("provider-status", "warn", "Provider unavailable", "No synthetic portfolio fallback");
    await refreshTabStatus(activeTabId(), { force: true });
    if (sequence !== etoroRefreshRequestSequence) return;
    renderPortfolioReadFailure(error, { retainLastGood: portfolioLastGoodEnvironment === selectedPortfolioEnvironment && portfolioDataSource === "provider-normalized" });
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
    minimumEvaluationIntervalMinutes: 240,
  };
}

document.getElementById("portfolio-display-currency")?.addEventListener("change", (event) => selectDisplayCurrency(event.target.value));
for (const [id, delta] of [["portfolio-page-previous", -1], ["portfolio-page-next", 1]]) document.getElementById(id)?.addEventListener("click", () => { tableReview.portfolio.page += delta; applyTableReview("portfolio"); });
document.querySelector(".inspector-jump")?.addEventListener("click", (event) => openPresentationDialog("portfolio-inspector", event.currentTarget));
document.getElementById("system-health-open")?.addEventListener("click", (event) => openPresentationDialog("system-health", event.currentTarget));
document.getElementById("workspace-banner-action")?.addEventListener("click", (event) => { if (event.currentTarget.dataset.action === "refresh") void refreshEtoro(); else openPresentationDialog("system-health", event.currentTarget); });
for (const [id, closeId] of [["portfolio-inspector", "portfolio-inspector-close"], ["system-health", "system-health-close"]]) {
  document.getElementById(closeId)?.addEventListener("click", () => closePresentationDialog(id));
  document.getElementById(id)?.addEventListener("cancel", (event) => { event.preventDefault(); closePresentationDialog(id); });
  document.getElementById(id)?.addEventListener("close", () => { if (presentationDialogReturns.has(id)) closePresentationDialog(id); });
}
document.getElementById("refresh-etoro")?.addEventListener("click", refreshEtoro);
document.getElementById("portfolio-environment")?.addEventListener("change", (event) => {
  selectEnvironment(event.target.value);
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

  setDraftControlsDisabled(true);
  try {
    const candidate = collectBotConfig();
    normalizeDraftBotConfig({ ...candidate, updatedAt: null });
    const saved = await putJson("/api/etoro/bot/config", candidate);
    renderBotConfig(saved);
    setDraftControlsDisabled(false);
    applyBotStrategyRuleControls();
    renderAudit(
      "Draft preferences saved",
      "Draft preferences saved; approved runtime parameters remain fixed",
      "bot-audit-list",
    );
  } catch (error) {
    botConfigMutationProtection = null;
    text("bot-config-source-state", "Saved draft stale or unavailable; refresh before editing");
    setDraftControlsDisabled(true);
    renderAudit("Draft save requires refresh", "Saved draft outcome must be read back; approved runtime is unchanged", "bot-audit-list");
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
for (const kind of ["portfolio", "watchlist"]) {
  for (const key of ["search", "coverage", "sort", "direction"]) {
    document.getElementById(`${kind}-review-${key}`)?.addEventListener(key === "search" ? "input" : "change", (event) => {
      tableReview[kind][key] = event.target.value;
      if (kind === "portfolio") tableReview[kind].page = 1;
      applyTableReview(kind);
    });
  }
}
for (const [id, action] of [["operations-run", "run-once"], ["operations-block", "block"], ["operations-reenable", "reenable"]]) {
  document.getElementById(id)?.addEventListener("click", () => { void operateOfflineDiagnostic(action); });
}
document.getElementById("operations-refresh")?.addEventListener("click", () => { void refreshOfflineOperations(); });
document.querySelectorAll("[data-tab-target]").forEach((button, index, buttons) => {
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? buttons[0] : event.key === "End" ? buttons[buttons.length - 1] : buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length];
    activateTab(target.dataset.tabTarget);
    target.focus();
  });
});
renderAudit("Dashboard session started", "Read-only investments; account execution disabled");
setInterval(() => { applyInvestmentFreshness(); applyOperationsFreshness(); applyFxFreshness(); }, 1000);
try { const saved = globalThis.localStorage?.getItem("etoro-display-currency"); if (/^[A-Z]{3}$/.test(saved)) preferredDisplayCurrency = saved; } catch { /* Optional preference unavailable. */ }

updatePortfolioPeriod("24h");
updateWatchlistPeriod("24h");
refreshEtoro();
