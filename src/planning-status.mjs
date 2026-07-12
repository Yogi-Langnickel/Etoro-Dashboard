import {
  ALLOWED_BOT_BUDGETS_USD,
  ALLOWED_BOT_INSTRUMENT_CLASSES,
  ALLOWED_BOT_MARKETS,
  ALLOWED_BOT_STRATEGY_IDS,
  BOT_CONFIG_CONTRACT_VERSION,
  BOT_CONFIG_MIRROR_SOURCE,
  BOT_RUN_MODE_POLICY,
  BOT_STRATEGY_CONFIG_RULES,
  loadBotConfig,
  publicBotConfigPayload,
} from "./bot-config-store.mjs";
import { publicCredentialStatus } from "./etoro-config.mjs";
import { researchIntelligenceStatus } from "./research-intelligence.mjs";
import { syntheticFixtureWatermark } from "./synthetic-fixture.mjs";
import { MAX_DEMO_TRADE_PREVIEW_AMOUNT_USD } from "./trade-preview.mjs";

export const BOT_CONFIG_CSRF_HEADER = "x-etoro-dashboard-csrf";

const BOT_BUDGET_POLICY = Object.freeze({
  mode: "simulation-hard-limits",
  baseBudgetUsd: 1000,
  selectableBudgetsUsd: ALLOWED_BOT_BUDGETS_USD,
  profitReuse: "allowed-after-realized-profit-ledger",
  maxConfigurableBudgetUsd: 2500,
  hardStops: Object.freeze({
    dailyLossUsd: 50,
    weeklyLossUsd: 150,
    maxOpenPositions: 3,
  }),
});
if (BOT_BUDGET_POLICY.maxConfigurableBudgetUsd !== MAX_DEMO_TRADE_PREVIEW_AMOUNT_USD) {
  throw new Error("Bot and preview budget limits must match.");
}

const BOT_SCHEDULE_POLICY = Object.freeze({
  mode: "low-frequency-only",
  minimumCadence: "daily",
  minimumEvaluationIntervalMinutes: 240,
  highFrequencyTrading: "blocked",
  maxSimulatedTradeDecisionsPerDay: 3,
});

function botStrategyRecords() {
  return ALLOWED_BOT_STRATEGY_IDS.map((strategyId) => {
    const rule = BOT_STRATEGY_CONFIG_RULES[strategyId];
    const contextOnly = rule.status === "context-only";

    return {
      strategyId,
      name: rule.name,
      version: rule.version,
      status: rule.status,
      allowedModes: ["simulation"],
      allowedMarkets: rule.allowedMarkets,
      allowedInstrumentClasses: rule.allowedInstrumentClasses,
      cadence: rule.cadence,
      riskBudget: {
        maxBudgetUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
        leverage: "1-only",
        shorts: "blocked",
        ...(strategyId === "threshold-rebalance" ? { maxDriftPct: 5, maxPositionPct: 20 } : {}),
        ...(strategyId === "dca-cash-reserve" ? { maxPositionPct: 10, maxWeeklyTurnoverPct: 5 } : {}),
        ...(strategyId === "volatility-band-accumulator" ? { maxPositionPct: 10, cooldown: "required" } : {}),
        ...(strategyId === "slow-trend-allocation" ? { maxPositionPct: 15, trendConfirmation: "required" } : {}),
        ...(contextOnly ? { profitReuse: "ledger-only", newsCanTriggerOrders: "blocked" } : {}),
      },
      lastValidation: {
        state: "not-run",
        detail: contextOnly
          ? "Market-news context is display-only and cannot trigger orders."
          : "Synthetic strategy record only; no provider reads or orders are connected.",
      },
    };
  });
}

export function botMonitoringStatus(config) {
  return {
    ok: true,
    mode: "bot-monitoring-planning",
    readOnly: true,
    demoOnly: true,
    botEnabled: false,
    simulatedTelemetryOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    fixtureWatermark: syntheticFixtureWatermark("bot-monitor"),
    telemetry: {
      source: "synthetic-disabled",
      freshness: "not-connected",
      lastDecisionAt: null,
      lastProviderReadAt: null,
      openActionCount: 0,
      pendingExecutionCount: 0,
    },
    safeguards: {
      killSwitch: "locked-disabled",
      executionRoutes: "absent",
      accountMutation: "blocked",
      rawProviderPayloads: "hidden",
      accountIdentifiers: "redacted",
    },
    providerInputPolicy: {
      nextInput: "historical-market-data",
      owner: "Money-maker-3000",
      backtestMode: "enabled-offline-fixture-only",
      executeMode: "disabled-pending-separate-review",
      dashboardDurableAccountStorage: "blocked",
      demoExecution: "blocked",
      liveExecution: "blocked",
      portfolioState: "deferred-after-backtest-review",
      reconciliationRecords: "deferred-after-portfolio-boundary",
    },
    controlPolicy: {
      runModeSelection: "backtest-only",
      runModePolicy: BOT_RUN_MODE_POLICY,
      strategySelection: "predefined-server-persisted",
      configuredStrategyId: "dca-cash-reserve",
      allowedStrategyIds: botStrategyRecords().map((strategy) => strategy.strategyId),
      customStrategyUpload: "blocked",
      highFrequencyTrading: "blocked",
    },
    budgetPolicy: BOT_BUDGET_POLICY,
    schedulePolicy: BOT_SCHEDULE_POLICY,
    instrumentUniverse: {
      configurable: "planned",
      defaultAllowed: ALLOWED_BOT_MARKETS,
      defaultInstrumentClasses: ALLOWED_BOT_INSTRUMENT_CLASSES,
      disabledUntilReviewed: ["DERIVATIVES", "CFD", "CRYPTO"],
      perStrategyAllowlist: "required-before-execution",
    },
    auditExport: {
      tradeLog: "required-before-execution",
      googleSheets: "planned",
      rawProviderPayloads: "excluded",
    },
  };
}

export function botStrategyRegistry(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    demoOnly: true,
    botEnabled: false,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    strategies: botStrategyRecords(),
    budgetPolicy: BOT_BUDGET_POLICY,
    schedulePolicy: BOT_SCHEDULE_POLICY,
    safeguards: {
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      customStrategies: "blocked",
      highFrequencyTrading: "blocked",
    },
  };
}

export function botSimulationRuns(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    runs: [
      {
        runId: "sim-run-001",
        strategyId: "dca-cash-reserve",
        strategyVersion: "0.1.0-sim",
        runMode: "backtest",
        environment: "synthetic",
        state: "simulated",
        evaluatedAt: "2026-05-13T00:00:00.000Z",
        decision: "skip",
        reasonCode: "historical-market-data-unavailable",
        historicalInput: "offline-fixture-required",
        riskResult: "blocked",
        hypotheticalOrderCount: 0,
        budgetUsedUsd: 0,
        budgetRemainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
      },
      {
        runId: "sim-run-002",
        strategyId: "threshold-rebalance",
        strategyVersion: "0.1.0-sim",
        runMode: "backtest",
        environment: "synthetic",
        state: "simulated",
        evaluatedAt: "2026-05-13T00:05:00.000Z",
        decision: "skip",
        reasonCode: "deterministic-backtest-not-reviewed",
        historicalInput: "offline-fixture-parsed",
        riskResult: "blocked",
        hypotheticalOrderCount: 0,
        budgetUsedUsd: 0,
        budgetRemainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
      },
    ],
    schedulePolicy: BOT_SCHEDULE_POLICY,
    safeguards: {
      executionRoutes: "absent",
      orderSubmission: "blocked",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}

export function botAuditEvents(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    auditEvents: [
      {
        eventId: "audit-001",
        actor: "system",
        action: "simulation_monitor_loaded",
        entityRef: "bot-monitor",
        outcome: "read-only",
        createdAt: "2026-05-13T00:00:00.000Z",
      },
      {
        eventId: "audit-002",
        actor: "system",
        action: "execution_routes_checked",
        entityRef: "bot-monitor",
        outcome: "absent",
        createdAt: "2026-05-13T00:00:01.000Z",
      },
      {
        eventId: "audit-003",
        actor: "operator",
        action: "local_strategy_preview_loaded",
        entityRef: "dca-cash-reserve",
        outcome: "not-persisted",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ],
    pagination: {
      limit: 20,
      nextCursor: null,
      hasMore: false,
    },
    safeguards: {
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      orderPayloads: "not-created",
    },
  };
}

export function botEventFeed(config) {
  return {
    ok: true,
    mode: "bot-simulation-monitor",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    events: [
      {
        eventId: "event-001",
        type: "decision",
        severity: "info",
        title: "DCA simulation skipped",
        detail: "Money-maker historical market data inputs are not connected, so no candidate order was produced.",
        createdAt: "2026-05-13T00:00:00.000Z",
      },
      {
        eventId: "event-002",
        type: "risk-veto",
        severity: "warn",
        title: "Rebalance blocked",
        detail: "Deterministic backtest review is incomplete; risk engine remains fail-closed.",
        createdAt: "2026-05-13T00:05:00.000Z",
      },
      {
        eventId: "event-003",
        type: "budget-check",
        severity: "info",
        title: "Budget guardrail loaded",
        detail: "Simulation budget options are capped at USD 2,500 with daily and weekly loss stops.",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ],
    pagination: {
      limit: 20,
      nextCursor: null,
      hasMore: false,
    },
    safeguards: {
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}

export function botTradeLog(config) {
  return {
    ok: true,
    mode: "bot-simulation-trade-log",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    summary: {
      source: "synthetic-ledger-preview",
      durableStore: "planned-worker-owned",
      googleSheetsExport: "planned-redacted-sink",
      realizedProfitUsd: 0,
      reusableProfitUsd: 0,
      budgetUsedUsd: 0,
      budgetRemainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
    },
    reportContract: {
      source: BOT_CONFIG_MIRROR_SOURCE,
      version: BOT_CONFIG_CONTRACT_VERSION,
      ledgerType: "simulation-report-preview",
      owner: "worker-owned-report-contract",
      exportState: "planned-redacted-sink",
      executionCapability: "absent",
      allowedSinks: ["dashboard-status", "planned-redacted-google-sheets"],
      redaction: {
        accountIdentifiers: "excluded",
        providerOrderIds: "excluded",
        positionIds: "excluded",
        rawProviderPayloads: "excluded",
        replayableOrderDetails: "excluded",
      },
    },
    entries: [
      {
        tradeLogId: "trade-log-001",
        runId: "sim-run-001",
        strategyId: "dca-cash-reserve",
        createdAt: "2026-05-14T00:00:00.000Z",
        action: "simulated-skip",
        decision: "blocked",
        reasonCode: "historical-market-data-unavailable",
        instrument: {
          symbol: "SPY",
          assetClass: "ETF",
          identifierState: "redacted",
        },
        budget: {
          allocatedUsd: 0,
          remainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
          maxPositionPct: 10,
        },
        riskChecks: ["historical-market-data-required", "stale-data-block", "execution-route-absent"],
      },
      {
        tradeLogId: "trade-log-002",
        runId: "sim-run-002",
        strategyId: "threshold-rebalance",
        createdAt: "2026-05-14T00:05:00.000Z",
        action: "simulated-skip",
        decision: "blocked",
        reasonCode: "deterministic-backtest-not-reviewed",
        instrument: {
          symbol: "GLD",
          assetClass: "ETF",
          identifierState: "redacted",
        },
        budget: {
          allocatedUsd: 0,
          remainingUsd: BOT_BUDGET_POLICY.baseBudgetUsd,
          maxPositionPct: 20,
        },
        riskChecks: ["deterministic-backtest-review-required", "no-hft-cadence", "execution-route-absent"],
      },
    ],
    safeguards: {
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      orderPayloads: "not-created",
      highFrequencyTrading: "blocked",
    },
  };
}

export async function botSnapshot(config, options) {
  const loadStoredBotConfig = options.loadBotConfig ?? loadBotConfig;
  const loaded = await loadStoredBotConfig({
    configFile: options.botConfigFile,
  });

  return {
    ok: true,
    mode: "bot-snapshot",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    status: botMonitoringStatus(config),
    strategies: botStrategyRegistry(config),
    config: {
      ...publicBotConfigPayload(loaded.config, loaded),
      mutationProtection: {
        csrfHeader: BOT_CONFIG_CSRF_HEADER,
        csrfTokenDelivery: "config-read-response-header",
        localOriginOnly: true,
        contentType: "application/json",
      },
    },
    runs: botSimulationRuns(config),
    audit: botAuditEvents(config),
    events: botEventFeed(config),
    tradeLog: botTradeLog(config),
    safeguards: {
      providerCalls: "blocked",
      executionRoutes: "absent",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      payloadShape: "batched-read-only-status",
    },
  };
}

export function riskRadarStatus(config) {
  return {
    ok: true,
    mode: "risk-radar-planning",
    readOnly: true,
    demoOnly: true,
    mutationRoutesEnabled: false,
    livePortfolioConnected: false,
    credentialStatus: publicCredentialStatus(config),
    fixtureWatermark: syntheticFixtureWatermark("risk-radar"),
    portfolioRisk: {
      source: "synthetic-placeholder",
      freshness: "not-connected",
      grossExposurePct: null,
      cashBufferPct: null,
      largestPositionPct: null,
      leveragedPositionCount: 0,
      stalePositionCount: 0,
    },
    thresholds: {
      grossExposurePct: 125,
      largestPositionPct: 25,
      cashBufferPct: 10,
      staleDataMinutes: 15,
    },
    checks: [
      {
        id: "exposure",
        label: "Gross exposure",
        state: "unknown",
        detail: "Connect a read-only demo portfolio before evaluating exposure.",
      },
      {
        id: "concentration",
        label: "Concentration",
        state: "unknown",
        detail: "Largest position is unavailable without portfolio reads.",
      },
      {
        id: "stale-data",
        label: "Data freshness",
        state: "warn",
        detail: "No provider timestamp is connected to this radar yet.",
      },
      {
        id: "execution",
        label: "Execution lock",
        state: "ok",
        detail: "Risk radar has no trade, close, copy, or watchlist mutation routes.",
      },
    ],
    safeguards: {
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      executionRoutes: "absent",
      alerting: "local-only",
    },
  };
}

export function researchDeskStatus(config) {
  const intelligence = researchIntelligenceStatus();

  return {
    ok: true,
    mode: "research-desk-planning",
    readOnly: true,
    mutationRoutesEnabled: false,
    credentialStatus: publicCredentialStatus(config),
    fixtureWatermark: syntheticFixtureWatermark("research-desk"),
    dataSources: {
      watchlists: "synthetic-placeholder",
      instruments: "synthetic-placeholder",
      marketNews: "api-first-planned",
      financialRecords: "official-api-first-planned",
      insiderTransactions: "sec-forms-3-4-5-planned",
      socialFeed: "disabled",
      recommendations: "disabled",
    },
    watchlistPreview: [
      { symbol: "SPY", assetClass: "ETF", state: "fixture", note: "Synthetic ETF row placeholder" },
      { symbol: "AAPL", assetClass: "Equity", state: "fixture", note: "Synthetic equity row placeholder" },
      { symbol: "GLD", assetClass: "ETF", state: "fixture", note: "Synthetic ETF row placeholder" },
    ],
    instrumentLookup: {
      enabled: false,
      requiredFields: ["instrumentId", "internalSymbolFull", "displayname", "marketId"],
      exactSymbolLookup: "planned-server-only",
    },
    marketNews: {
      enabled: false,
      mode: "api-first-scraping-fallback-planning",
      target: "attach-redacted-news-summaries-to-watchlist-and-position-rows",
      candidateSources: ["free-apis", "rss-feeds", "official-company-newsrooms", "allowlisted-scraping"],
      safeguards: [
        "server-side-fetch-only",
        "source-allowlist-required",
        "robots-and-terms-review-required",
        "no-trade-trigger-from-news",
        "headline-summary-redaction",
      ],
      rowPreview: [
        {
          symbol: "AAPL",
          state: "placeholder",
          headline: "No live news source connected",
          source: "synthetic",
          attachedTo: "watchlist",
        },
      ],
    },
    positionContextPreview: [
      {
        symbol: "SPY",
        assetClass: "ETF",
        positionState: "synthetic",
        contextOnly: true,
        news: [
          {
            headline: "Macro calendar context placeholder",
            source: "synthetic",
            age: "not-live",
            summary: "Use only as portfolio context; this cannot create a signal or order.",
          },
        ],
      },
      {
        symbol: "GLD",
        assetClass: "ETF",
        positionState: "synthetic",
        contextOnly: true,
        news: [
          {
            headline: "Commodity market context placeholder",
            source: "synthetic",
            age: "not-live",
            summary: "Source allowlist and terms review are required before live news ingestion.",
          },
        ],
      },
    ],
    intelligence,
    safeguards: {
      watchlistMutation: "blocked",
      feedPosting: "blocked",
      newsTradingSignals: "blocked",
      indicatorTradingSignals: "blocked",
      financialAdvice: "blocked",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
    },
  };
}
