const formatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

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

function renderStatus(payload) {
  const status = payload.credentialStatus;
  const configured = Boolean(status?.configured);

  setTile(
    "provider-status",
    configured ? "ok" : "warn",
    configured ? "Provider configured" : "Provider offline",
    configured ? `${status.baseUrl}` : "Using synthetic fixtures",
  );
  text("source-detail", configured ? status.credentialSource : "No server credentials");
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
  const endpoints = payload.plannedProviderEndpoints ?? {};
  const endpointTarget = document.getElementById("trading-endpoints");

  text("trading-credential-state", configured ? "Configured" : "Missing");
  text("trading-mutation-state", mutationsEnabled ? "Enabled" : "Disabled");
  text("trading-provider-scope", payload.demoOnly ? "Demo only" : "Unknown");
  text("trade-route-status", mutationsEnabled ? "Enabled" : "Planning only");

  if (endpointTarget) {
    endpointTarget.textContent = "";

    for (const [name, endpoint] of Object.entries(endpoints)) {
      const card = document.createElement("article");
      const label = document.createElement("span");
      const path = document.createElement("code");

      card.className = "endpoint-card";
      label.textContent = `${endpoint.method} ${name}`;
      path.textContent = endpoint.path;
      card.append(label, path);
      endpointTarget.append(card);
    }
  }

  renderAudit(
    mutationsEnabled ? "Demo execution route enabled" : "Demo execution route disabled",
    "Trade ticket remains UI-only until the write route is explicitly implemented",
    "trading-audit-list",
  );
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

function activateTab(targetId) {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    const active = button.dataset.tabTarget === targetId;

    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== targetId;
  });
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
    await refreshTradingStatus();

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
    await refreshTradingStatus();
    renderAudit("Provider read failed", error.message);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

document.getElementById("refresh-etoro")?.addEventListener("click", refreshEtoro);
document.getElementById("trade-ticket")?.addEventListener("submit", (event) => {
  event.preventDefault();
  renderAudit("Trade submit blocked", "No local execution route exists in this slice", "trading-audit-list");
});
document.getElementById("trade-preview-blocked")?.addEventListener("click", () => {
  renderAudit("Trade preview blocked", "Execution preview requires the next feature-gated write slice", "trading-audit-list");
});
document.querySelectorAll("[data-tab-target]").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
});
refreshEtoro();
