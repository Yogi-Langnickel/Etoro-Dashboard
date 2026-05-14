const formatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const overviewTabId = "overview-view";
const loadedTabIds = new Set([overviewTabId]);

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

  return payload;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
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
  const configured = Boolean(status?.configured);
  const cacheTtlMs = payload.cachePolicy?.readOnlyTtlMs ?? status?.readCacheTtlMs;

  setTile(
    "provider-status",
    configured ? "ok" : "warn",
    configured ? "Provider configured" : "Provider offline",
    configured ? `${status.baseUrl}` : "Using synthetic fixtures",
  );
  text(
    "source-detail",
    configured
      ? `${status.credentialSource}; ${formatCacheDuration(cacheTtlMs)}`
      : `No server credentials; ${formatCacheDuration(cacheTtlMs)}`,
  );
  text("chart-provider", configured ? `Provider: ${status.baseUrl}` : "Provider timestamp: unavailable");
}

function renderIdentity(payload) {
  const refs = payload.data?.accountRefs;
  const demoAvailable = Boolean(refs?.hasDemoCid);

  setTile(
    "demo-status",
    demoAvailable ? "ok" : "warn",
    demoAvailable ? "Demo account" : "Demo not verified",
    refs?.hasRealCid ? "Real account also present" : "Read-only demo route",
  );
}

function renderPnl(payload) {
  const data = payload.data;

  text("mock-equity-label", "Demo equity");
  text("mock-equity", money(data.equity ?? data.credit));
  text("cash-buffer", money(data.availableCash));
  text("unrealized-pnl", signedMoney(data.unrealizedPnL));
  text("exposure", money(data.totalInvested));
  text("stale-data", `${data.positionCount} positions`);
  text("chart-provider", data.providerUpdatedAt ? `Provider timestamp: ${data.providerUpdatedAt}` : "Provider timestamp: unavailable");
  text("chart-request", `Request ID: ${payload.provider.requestId}`);
  text("chart-cache", `Cache: ${labelize(payload.cache?.state)} (${payload.cache?.ttlMs ?? 0} ms)`);
  setTile("last-sync", "ok", "Last sync", new Date(payload.provider.receivedAt).toLocaleTimeString());
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

function renderBotStatus(payload) {
  const telemetry = payload.telemetry ?? {};
  const safeguards = payload.safeguards ?? {};

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

function renderBotControlSelects(statusPayload, strategiesPayload) {
  const select = document.getElementById("bot-strategy-select");
  const budgetSelect = document.getElementById("bot-budget-select");
  const strategyById = new Map((strategiesPayload.strategies ?? []).map((strategy) => [strategy.strategyId, strategy]));

  if (select) {
    select.textContent = "";

    for (const strategyId of statusPayload.controlPolicy?.allowedStrategyIds ?? []) {
      const strategy = strategyById.get(strategyId);
      const option = document.createElement("option");
      option.value = strategyId;
      option.textContent = strategy?.name ?? labelize(strategyId);
      option.selected = strategyId === statusPayload.controlPolicy?.configuredStrategyId;
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
      option.selected = budget === statusPayload.budgetPolicy?.baseBudgetUsd;
      budgetSelect.append(option);
    }

    budgetSelect.disabled = false;
  }
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
  const preview = payload.watchlistPreview ?? [];
  const previewTarget = document.getElementById("research-watchlist");
  const newsTarget = document.getElementById("research-news");
  const positionNewsTarget = document.getElementById("research-position-news");
  const fieldsTarget = document.getElementById("research-fields");

  text("research-watchlists-state", labelize(sources.watchlists));
  text("research-instruments-state", labelize(sources.instruments));
  text("research-news-state", labelize(sources.marketNews));
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
      : "Market news scraping is planned only; news cannot trigger trades",
    "research-audit-list",
  );
}

async function refreshResearchStatus() {
  try {
    const status = await getJson("/api/etoro/research/status");
    renderResearchStatus(status);
  } catch (error) {
    text("research-watchlists-state", "Unavailable");
    text("research-instruments-state", "Unavailable");
    renderAudit("Research desk failed", error.message, "research-audit-list");
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
    const [status, strategies, runs, audit, events, tradeLog] = await Promise.all([
      getJson("/api/etoro/bot/status"),
      getJson("/api/etoro/bot/strategies"),
      getJson("/api/etoro/bot/runs"),
      getJson("/api/etoro/bot/audit"),
      getJson("/api/etoro/bot/events"),
      getJson("/api/etoro/bot/trade-log"),
    ]);
    renderBotStatus(status);
    renderBotControlSelects(status, strategies);
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
  if (!targetId || targetId === overviewTabId) {
    return;
  }

  if (!force && loadedTabIds.has(targetId)) {
    return;
  }

  const refreshers = {
    "bot-view": refreshBotStatus,
    "research-view": refreshResearchStatus,
    "risk-view": refreshRiskStatus,
    "trading-view": refreshTradingStatus,
  };
  const refresher = refreshers[targetId];

  if (!refresher) {
    return;
  }

  await refresher();
  loadedTabIds.add(targetId);
}

function activeTabId() {
  return document.querySelector("[data-tab-target].active")?.dataset.tabTarget ?? overviewTabId;
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
  const button = document.getElementById("refresh-etoro");

  if (button) {
    button.disabled = true;
  }

  try {
    await getJson("/api/health");
    const status = await getJson("/api/etoro/status");
    renderStatus(status);
    await refreshTabStatus(activeTabId(), { force: true });

    if (!status.credentialStatus.configured) {
      renderAudit("Credential check incomplete", "No credential values present in browser context");
      return;
    }

    const identity = await getJson("/api/etoro/identity");
    renderIdentity(identity);

    const pnl = await getJson("/api/etoro/demo/pnl");
    renderPnl(pnl);
    renderAudit("Demo PnL summary loaded", "Provider response normalized and raw payload hidden");
  } catch (error) {
    setTile("provider-status", "warn", "Provider offline", "Using synthetic fixtures");
    await refreshTabStatus(activeTabId(), { force: true });
    renderAudit("Provider read failed", error.message);
  } finally {
    if (button) {
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

document.getElementById("refresh-etoro")?.addEventListener("click", refreshEtoro);
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
  renderAudit(
    "Strategy preview changed",
    `${labelize(event.target.value)} selected locally; worker config is not persisted`,
    "bot-audit-list",
  );
});
document.getElementById("bot-budget-select")?.addEventListener("change", (event) => {
  renderAudit(
    "Budget preview changed",
    `${money(Number(event.target.value))} selected locally; hard limits remain unchanged`,
    "bot-audit-list",
  );
});
document.querySelectorAll("[data-tab-target]").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
});
refreshEtoro();
