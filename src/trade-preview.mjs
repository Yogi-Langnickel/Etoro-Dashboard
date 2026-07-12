export const MAX_DEMO_TRADE_PREVIEW_AMOUNT_USD = 2500;
const MAX_DEMO_TRADE_PREVIEW_UNITS = 1000;

const PLANNED_DEMO_TRADING_ENDPOINTS = Object.freeze({
  marketOpenByAmount: Object.freeze({ method: "POST" }),
  marketOpenByUnits: Object.freeze({ method: "POST" }),
});

export function tradingPermissionMatrix(config) {
  return [
    {
      id: "read-key",
      label: "Read key",
      state: config.configured ? "configured" : "missing",
      detail: config.configured ? "Server-side only" : "No server credential",
    },
    {
      id: "write-key",
      label: "Write key",
      state: "absent",
      detail: "No order-submission key is used by this app slice",
    },
    {
      id: "environment",
      label: "Environment",
      state: "demo-only",
      detail: "Live trading remains unavailable",
    },
    {
      id: "preview",
      label: "Preview route",
      state: config.demoTradePreviewEnabled ? "enabled" : "disabled",
      detail: "Validation only; no provider mutation",
    },
    {
      id: "mutation-routes",
      label: "Mutation routes",
      state: "absent",
      detail: "No market-open, market-close, copy, or account routes exist",
    },
  ];
}
export function tradingRateBudget() {
  return {
    source: "planning",
    window: "rolling-1-minute",
    readBudget: "60-per-minute-documented",
    writeBudget: "20-per-minute-documented",
    reservedHeadroom: "emergency-and-status-reads",
    currentPressure: "not-connected",
  };
}

function parsePositiveNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }

  return parsed;
}

function assertPreviewAmountLimit(amount) {
  if (amount !== null && amount > MAX_DEMO_TRADE_PREVIEW_AMOUNT_USD) {
    throw new Error(`Amount must be ${MAX_DEMO_TRADE_PREVIEW_AMOUNT_USD} USD or lower for preview`);
  }
}

function assertPreviewUnitLimit(units) {
  if (units !== null && units > MAX_DEMO_TRADE_PREVIEW_UNITS) {
    throw new Error(`Units must be ${MAX_DEMO_TRADE_PREVIEW_UNITS} or lower for preview`);
  }
}

export function buildTradePreview(payload) {
  const orderType = String(payload?.orderType ?? "");
  const side = String(payload?.side ?? "").toUpperCase();
  const instrumentId = String(payload?.instrumentId ?? "").trim();
  const amount = parsePositiveNumber(payload?.amount, "Amount");
  const units = parsePositiveNumber(payload?.units, "Units");
  const leverage = parsePositiveNumber(payload?.leverage, "Leverage") ?? 1;
  const stopLoss = parsePositiveNumber(payload?.stopLoss, "Stop loss");
  const takeProfit = parsePositiveNumber(payload?.takeProfit, "Take profit");

  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("Side must be BUY or SELL");
  }

  if (side !== "BUY") {
    throw new Error("Preview only supports BUY; shorts and sell-side concepts are blocked");
  }

  if (leverage !== 1) {
    throw new Error("Preview only supports leverage 1");
  }

  if (orderType === "marketOpenByAmount") {
    if (!instrumentId || amount === null) {
      throw new Error("Market open by amount requires an instrument ID and amount");
    }

    assertPreviewAmountLimit(amount);

    return {
      providerEndpoint: {
        category: "market-open-by-amount",
        method: PLANNED_DEMO_TRADING_ENDPOINTS.marketOpenByAmount.method,
      },
      ticket: {
        orderType,
        side,
        sizingMode: "amount",
        hasInstrumentId: true,
        amount,
        leverage,
        stopLossSet: stopLoss !== null,
        takeProfitSet: takeProfit !== null,
      },
    };
  }

  if (orderType === "marketOpenByUnits") {
    if (!instrumentId || units === null) {
      throw new Error("Market open by units requires an instrument ID and units");
    }

    assertPreviewUnitLimit(units);

    return {
      providerEndpoint: {
        category: "market-open-by-units",
        method: PLANNED_DEMO_TRADING_ENDPOINTS.marketOpenByUnits.method,
      },
      ticket: {
        orderType,
        side,
        sizingMode: "units",
        hasInstrumentId: true,
        units,
        leverage,
        stopLossSet: stopLoss !== null,
        takeProfitSet: takeProfit !== null,
      },
    };
  }

  if (orderType === "marketClosePosition") {
    throw new Error("Close-position preview requires a separate audited close-flow review");
  }

  throw new Error("Unsupported demo order type");
}
