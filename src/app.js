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

function renderAudit(message, detail) {
  const list = document.getElementById("audit-list");

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

async function refreshEtoro() {
  const button = document.getElementById("refresh-etoro");

  if (button) {
    button.disabled = true;
  }

  try {
    await getJson("/api/health");
    const status = await getJson("/api/etoro/status");
    renderStatus(status);

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
    renderAudit("Provider read failed", error.message);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

document.getElementById("refresh-etoro")?.addEventListener("click", refreshEtoro);
refreshEtoro();
