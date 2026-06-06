import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ALLOWED_BOT_CADENCES,
  ALLOWED_BOT_INSTRUMENT_CLASSES,
  ALLOWED_BOT_MARKETS,
  ALLOWED_BOT_RUN_MODES,
  BOT_CONFIG_CONTRACT_VERSION,
  BOT_CONFIG_MIRROR_SOURCE,
  BOT_RUN_MODE_POLICY,
  BOT_MARKET_INSTRUMENT_CLASS_RULES,
  BOT_STRATEGY_CONFIG_RULES,
  MIN_BOT_EVALUATION_INTERVAL_MINUTES,
  saveBotConfig,
} from "../src/bot-config-store.mjs";
import {
  DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
  INTERNAL_API_ROUTES,
  createReadOnlyProviderCache,
  createRequestHandler,
} from "../src/server.mjs";

const BOT_CONFIG_CSRF_RESPONSE_HEADER = "x-etoro-dashboard-config-token";

async function callHandler(handler, { method = "GET", url = "/api/health", body = "", headers = {} } = {}) {
  const response = {
    body: "",
    headers: {},
    status: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body ? String(body) : "";
    },
  };

  await handler({ method, url, body, headers }, response);

  return {
    status: response.status,
    headers: response.headers,
    text: response.body,
    json: parseJsonBody(response.body),
  };
}

function parseJsonBody(body) {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const execFileAsync = promisify(execFile);

async function readMoneyMakerContractSnapshot() {
  return JSON.parse(
    await readFile(new URL("./fixtures/money-maker-simulation-contract.snapshot.json", import.meta.url), "utf8"),
  );
}

async function readBotConfigMutationProtection(handler) {
  const response = await callHandler(handler, {
    url: "/api/etoro/bot/config",
  });

  assert.equal(response.status, 200);
  return {
    ...response.json.mutationProtection,
    csrfToken: response.headers[BOT_CONFIG_CSRF_RESPONSE_HEADER],
  };
}

function localBotConfigMutationHeaders(mutationProtection, overrides = {}) {
  return {
    host: "localhost:4173",
    origin: "http://localhost:4173",
    "content-type": "application/json",
    [mutationProtection.csrfHeader]: mutationProtection.csrfToken,
    ...overrides,
  };
}

async function configuredConfig() {
  return {
    baseUrl: "https://public-api.etoro.com",
    apiKey: "server-api-secret",
    userKey: "server-user-secret",
    configured: true,
    credentialFileLoaded: true,
    credentialSource: "file",
    missing: [],
  };
}

function configuredHandler() {
  return createRequestHandler({
    loadConfig: configuredConfig,
  });
}

function providerError(message, options = {}) {
  const error = new Error(message);
  Object.assign(error, options);
  return error;
}

test("server exposes only internal API routes and no execution routes", () => {
  const serialized = JSON.stringify(INTERNAL_API_ROUTES).toLowerCase();

  assert.deepEqual(INTERNAL_API_ROUTES, [
    "/api/health",
    "/api/etoro/status",
    "/api/etoro/identity",
    "/api/etoro/demo/pnl",
    "/api/etoro/demo/trading/status",
    "/api/etoro/demo/trading/preview",
    "/api/etoro/bot/status",
    "/api/etoro/bot/strategies",
    "/api/etoro/bot/runs",
    "/api/etoro/bot/audit",
    "/api/etoro/bot/events",
    "/api/etoro/bot/trade-log",
    "/api/etoro/bot/config",
    "/api/etoro/bot/snapshot",
    "/api/etoro/risk/status",
    "/api/etoro/research/status",
  ]);
  assert.equal(serialized.includes("execution"), false);
  assert.equal(serialized.includes("market-open"), false);
  assert.equal(serialized.includes("market-close"), false);
});

test("bot monitoring status is read-only, disabled, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-monitoring-planning");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.botEnabled, false);
  assert.equal(response.json.simulatedTelemetryOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.telemetry.source, "synthetic-disabled");
  assert.equal(response.json.telemetry.pendingExecutionCount, 0);
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.accountIdentifiers, "redacted");
  assert.deepEqual(response.json.providerInputPolicy, {
    nextInput: "historical-market-data",
    owner: "Money-maker-3000",
    backtestMode: "enabled-offline-fixture-only",
    executeMode: "disabled-pending-separate-review",
    dashboardDurableAccountStorage: "blocked",
    demoExecution: "blocked",
    liveExecution: "blocked",
    portfolioState: "deferred-after-backtest-review",
    reconciliationRecords: "deferred-after-portfolio-boundary",
  });
  assert.equal(response.json.controlPolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.controlPolicy.runModeSelection, "backtest-only");
  assert.equal(response.json.controlPolicy.runModePolicy.backtest.enabled, true);
  assert.equal(response.json.controlPolicy.runModePolicy.execute.enabled, false);
  assert.equal(response.json.controlPolicy.strategySelection, "predefined-server-persisted");
  assert.equal(response.json.controlPolicy.configuredStrategyId, "dca-cash-reserve");
  assert.equal(response.json.budgetPolicy.baseBudgetUsd, 1000);
  assert.deepEqual(response.json.budgetPolicy.selectableBudgetsUsd, [500, 1000, 1500, 2500]);
  assert.equal(response.json.budgetPolicy.hardStops.dailyLossUsd, 50);
  assert.equal(response.json.budgetPolicy.profitReuse, "allowed-after-realized-profit-ledger");
  assert.equal(response.json.schedulePolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.schedulePolicy.minimumEvaluationIntervalMinutes >= 240, true);
  assert.equal(response.json.instrumentUniverse.defaultAllowed.includes("US_EQUITIES"), true);
  assert.equal(response.json.auditExport.googleSheets, "planned");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
});

test("bot strategy registry is simulation-only and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/strategies",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-simulation-monitor");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.botEnabled, false);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.strategies.length, 5);
  assert.equal(response.json.strategies[0].strategyId, "dca-cash-reserve");
  assert.equal(response.json.strategies[0].allowedModes.includes("simulation"), true);
  assert.deepEqual(response.json.strategies[0].allowedMarkets, ["US_EQUITIES", "AU_EQUITIES"]);
  assert.deepEqual(response.json.strategies[0].allowedInstrumentClasses, ["EQUITY", "ETF"]);
  assert.equal(response.json.strategies[0].cadence, "daily");
  assert.equal(
    response.json.strategies.some((strategy) => strategy.strategyId === "volatility-band-accumulator"),
    true,
  );
  assert.equal(
    response.json.strategies.some((strategy) => strategy.strategyId === "slow-trend-allocation"),
    true,
  );
  assert.equal(response.json.strategies.some((strategy) => strategy.strategyId === "news-aware-watchlist"), true);
  assert.equal(response.json.budgetPolicy.maxConfigurableBudgetUsd, 2500);
  assert.equal(response.json.schedulePolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.highFrequencyTrading, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("bot simulation runs expose why-no-trade decisions without execution data", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/runs",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-simulation-monitor");
  assert.equal(response.json.runs.length, 2);
  assert.equal(response.json.runs[0].decision, "skip");
  assert.equal(response.json.runs[0].runMode, "backtest");
  assert.equal(response.json.runs[0].reasonCode, "historical-market-data-unavailable");
  assert.equal(response.json.runs[0].historicalInput, "offline-fixture-required");
  assert.equal(response.json.runs[1].reasonCode, "deterministic-backtest-not-reviewed");
  assert.equal(response.json.runs[1].historicalInput, "offline-fixture-parsed");
  assert.equal(response.json.runs[0].hypotheticalOrderCount, 0);
  assert.equal(response.json.runs[0].budgetRemainingUsd, 1000);
  assert.equal(response.json.schedulePolicy.highFrequencyTrading, "blocked");
  assert.equal(response.json.safeguards.orderSubmission, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"positionId"'), false);
  assert.equal(response.text.includes("portfolio-snapshot"), false);
});

test("bot trade log is synthetic, budget-scoped, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/trade-log",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-simulation-trade-log");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.summary.source, "synthetic-ledger-preview");
  assert.equal(response.json.summary.budgetRemainingUsd, 1000);
  assert.equal(response.json.reportContract.source, "Money-maker-3000/src/money_maker_3000/contracts.py");
  assert.equal(response.json.reportContract.version, "0.1.0-sim");
  assert.equal(response.json.reportContract.ledgerType, "simulation-report-preview");
  assert.equal(response.json.reportContract.executionCapability, "absent");
  assert.deepEqual(response.json.reportContract.allowedSinks, ["dashboard-status", "planned-redacted-google-sheets"]);
  assert.equal(response.json.reportContract.redaction.accountIdentifiers, "excluded");
  assert.equal(response.json.reportContract.redaction.providerOrderIds, "excluded");
  assert.equal(response.json.reportContract.redaction.positionIds, "excluded");
  assert.equal(response.json.reportContract.redaction.rawProviderPayloads, "excluded");
  assert.equal(response.json.entries.length, 2);
  assert.equal(response.json.entries[0].action, "simulated-skip");
  assert.equal(response.json.entries[0].reasonCode, "historical-market-data-unavailable");
  assert.equal(response.json.entries[1].reasonCode, "deterministic-backtest-not-reviewed");
  assert.equal(response.json.entries[0].riskChecks.includes("historical-market-data-required"), true);
  assert.equal(response.json.entries[1].riskChecks.includes("deterministic-backtest-review-required"), true);
  assert.equal(response.json.entries[0].instrument.identifierState, "redacted");
  assert.equal(response.json.safeguards.highFrequencyTrading, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
  assert.equal(response.text.includes('"positionId"'), false);
  assert.equal(response.text.includes("portfolio-snapshot"), false);
});

test("bot snapshot batches monitor routes without execution data", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/snapshot",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-snapshot");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.status.mode, "bot-monitoring-planning");
  assert.equal(response.json.strategies.strategies.length, 5);
  assert.equal(response.json.config.mode, "bot-config");
  assert.equal(response.json.config.mutationProtection.csrfHeader, "x-etoro-dashboard-csrf");
  assert.equal(response.json.config.mutationProtection.csrfToken, undefined);
  assert.equal(response.json.config.mutationProtection.csrfTokenDelivery, "config-read-response-header");
  assert.equal(response.json.runs.runs.length, 2);
  assert.equal(response.json.audit.auditEvents.length, 3);
  assert.equal(response.json.events.events.length, 3);
  assert.equal(response.json.tradeLog.entries.length, 2);
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
  assert.equal(response.text.includes('"positionId"'), false);
});

test("bot config returns default server-side simulation controls without secrets", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/config",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "bot-config");
  assert.equal(response.json.config.runMode, "backtest");
  assert.equal(response.json.config.strategyId, "dca-cash-reserve");
  assert.equal(response.json.config.budgetUsd, 1000);
  assert.deepEqual(response.json.config.allowedMarkets, ["US_EQUITIES", "AU_EQUITIES"]);
  assert.deepEqual(response.json.config.allowedInstrumentClasses, ["EQUITY", "ETF"]);
  assert.equal(response.json.config.minimumEvaluationIntervalMinutes, 240);
  assert.equal(response.json.mutationProtection.csrfHeader, "x-etoro-dashboard-csrf");
  assert.equal(response.json.mutationProtection.csrfToken, undefined);
  assert.equal(response.json.mutationProtection.csrfTokenDelivery, "config-read-response-header");
  assert.equal(typeof response.headers[BOT_CONFIG_CSRF_RESPONSE_HEADER], "string");
  assert.equal(response.text.includes(response.headers[BOT_CONFIG_CSRF_RESPONSE_HEADER]), false);
  assert.equal(response.json.mutationProtection.localOriginOnly, true);
  assert.equal(response.json.mutationProtection.contentType, "application/json");
  assert.equal(response.json.options.strategyRules["dca-cash-reserve"].status, "simulation-only");
  assert.deepEqual(response.json.options.runModes, ["backtest"]);
  assert.equal(response.json.options.runModePolicy.backtest.enabled, true);
  assert.equal(response.json.options.runModePolicy.execute.enabled, false);
  assert.equal(response.json.mirrorSource, "Money-maker-3000/src/money_maker_3000/contracts.py");
  assert.equal(response.json.contractVersion, "0.1.0-sim");
  assert.deepEqual(response.json.options.strategyRules["dca-cash-reserve"].allowedInstrumentClasses, [
    "EQUITY",
    "ETF",
  ]);
  assert.deepEqual(response.json.options.marketInstrumentClassRules.FOREX, ["FOREX"]);
  assert.equal(response.json.persistence.pathRedacted, true);
  assert.equal(response.json.persistence.persisted, false);
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.highFrequencyTrading, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("bot config mirror matches the Money-maker simulation contract snapshot", async () => {
  const snapshot = await readMoneyMakerContractSnapshot();

  assert.equal(BOT_CONFIG_MIRROR_SOURCE, snapshot.source);
  assert.equal(BOT_CONFIG_CONTRACT_VERSION, snapshot.version);
  assert.deepEqual(ALLOWED_BOT_RUN_MODES, snapshot.runModes);
  assert.deepEqual(snapshot.disabledRunModes, ["execute"]);
  assert.equal(ALLOWED_BOT_RUN_MODES.includes("execute"), false);
  assert.deepEqual(BOT_RUN_MODE_POLICY, snapshot.runModePolicy);
  assert.deepEqual(ALLOWED_BOT_MARKETS, snapshot.markets);
  assert.deepEqual(ALLOWED_BOT_INSTRUMENT_CLASSES, snapshot.instrumentClasses);
  assert.deepEqual(BOT_MARKET_INSTRUMENT_CLASS_RULES, snapshot.marketInstrumentClassRules);
  assert.deepEqual(ALLOWED_BOT_CADENCES, snapshot.cadences);
  assert.equal(MIN_BOT_EVALUATION_INTERVAL_MINUTES, snapshot.minimumEvaluationIntervalMinutes);
  assert.deepEqual(BOT_STRATEGY_CONFIG_RULES, snapshot.strategyRules);
});

test("bot config snapshot matches local Money-maker Python contract when available", async (context) => {
  const moneyMakerSrc = fileURLToPath(new URL("../../Money-maker-3000/src", import.meta.url));
  const contractPath = fileURLToPath(
    new URL("../../Money-maker-3000/src/money_maker_3000/contracts.py", import.meta.url),
  );

  if (!existsSync(contractPath)) {
    context.skip("Money-maker-3000 sibling repo is not available");
    return;
  }

  const python = `
import json
from money_maker_3000.contracts import (
    BLOCKED_SIMULATION_INSTRUMENT_CLASSES,
    MINIMUM_SIMULATION_EVALUATION_INTERVAL_MINUTES,
    SIMULATION_ALLOWED_RUN_MODES,
    SIMULATION_CADENCES,
    SIMULATION_CONTRACT_SOURCE,
    SIMULATION_CONTRACT_VERSION,
    SIMULATION_DISABLED_RUN_MODES,
    SIMULATION_INSTRUMENT_CLASSES,
    SIMULATION_MARKET_INSTRUMENT_CLASS_RULES,
    SIMULATION_MARKETS,
    SIMULATION_RUN_MODE_POLICY,
    SIMULATION_STRATEGY_CONFIG_RULES,
)

print(json.dumps({
    "source": SIMULATION_CONTRACT_SOURCE,
    "version": SIMULATION_CONTRACT_VERSION,
    "markets": list(SIMULATION_MARKETS),
    "instrumentClasses": list(SIMULATION_INSTRUMENT_CLASSES),
    "blockedInstrumentClasses": list(BLOCKED_SIMULATION_INSTRUMENT_CLASSES),
    "runModes": list(SIMULATION_ALLOWED_RUN_MODES),
    "disabledRunModes": list(SIMULATION_DISABLED_RUN_MODES),
    "runModePolicy": SIMULATION_RUN_MODE_POLICY,
    "marketInstrumentClassRules": {
        key: list(value)
        for key, value in SIMULATION_MARKET_INSTRUMENT_CLASS_RULES.items()
    },
    "cadences": list(SIMULATION_CADENCES),
    "minimumEvaluationIntervalMinutes": MINIMUM_SIMULATION_EVALUATION_INTERVAL_MINUTES,
    "strategyRules": {
        key: {
            **value,
            "allowedMarkets": list(value["allowedMarkets"]),
            "allowedInstrumentClasses": list(value["allowedInstrumentClasses"]),
        }
        for key, value in SIMULATION_STRATEGY_CONFIG_RULES.items()
    },
}, sort_keys=True))
`;
  const { stdout } = await execFileAsync("python3", ["-c", python], {
    env: {
      ...process.env,
      PYTHONPATH: moneyMakerSrc,
    },
  });

  assert.deepEqual(await readMoneyMakerContractSnapshot(), JSON.parse(stdout));
});

test("bot config update persists validated server-side config and redacts storage path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "etoro-bot-config-"));
  const botConfigFile = join(tempDir, "bot-config.json");
  const handler = createRequestHandler({
    botConfigFile,
    loadConfig: configuredConfig,
  });
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const body = {
    runMode: "backtest",
    strategyId: "threshold-rebalance",
    budgetUsd: 1500,
    allowedMarkets: ["US_EQUITIES", "COMMODITIES"],
    allowedInstrumentClasses: ["ETF", "COMMODITY"],
    cadence: "weekly",
  };
  const update = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify(body),
  });
  const readBack = await callHandler(handler, {
    url: "/api/etoro/bot/config",
  });

  assert.equal(update.status, 200);
  assert.equal(update.json.config.runMode, "backtest");
  assert.equal(update.json.config.strategyId, "threshold-rebalance");
  assert.equal(update.json.config.budgetUsd, 1500);
  assert.equal(update.json.config.cadence, "weekly");
  assert.equal(update.json.config.minimumEvaluationIntervalMinutes, 240);
  assert.equal(update.json.persistence.persisted, true);
  assert.equal(update.json.persistence.pathRedacted, true);
  assert.equal(update.json.audit.action, "bot_config_updated");
  assert.equal(readBack.status, 200);
  assert.equal(readBack.json.config.strategyId, "threshold-rebalance");
  assert.equal(readBack.text.includes(botConfigFile), false);
  assert.equal(readBack.text.includes("server-api-secret"), false);
});

test("bot config update failures do not expose local storage paths", async () => {
  const handler = createRequestHandler({
    loadConfig: configuredConfig,
    saveBotConfig: async () => {
      throw new Error("/Users/yogi/.config/etoro-dashboard/.bot-config.json.tmp fsync failed");
    },
  });
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const response = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({
      strategyId: "threshold-rebalance",
      budgetUsd: 1500,
      allowedMarkets: ["US_EQUITIES"],
      allowedInstrumentClasses: ["STOCK"],
      cadence: "daily",
    }),
  });

  assert.equal(response.status, 500);
  assert.equal(response.json.error.code, "BOT_CONFIG_SAVE_FAILED");
  assert.equal(response.json.error.message, "Unable to save bot config.");
  assert.equal(response.text.includes("/Users/yogi"), false);
  assert.equal(response.text.includes(".bot-config.json"), false);
  assert.equal(response.text.includes("fsync failed"), false);
});

test("bot config saves through atomic temp file rename and fsync hooks", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "etoro-bot-config-atomic-"));
  const botConfigFile = join(tempDir, "bot-config.json");
  const operations = [];
  let tempFile = null;

  const saved = await saveBotConfig(
    {
      strategyId: "dca-cash-reserve",
      budgetUsd: 1000,
      allowedMarkets: ["US_EQUITIES"],
      allowedInstrumentClasses: ["ETF"],
      cadence: "daily",
    },
    {
      configFile: botConfigFile,
      mkdirImpl: async (path, options) => {
        operations.push(["mkdir", path, options.mode]);
      },
      writeFileImpl: async (path, contents, options) => {
        tempFile = path;
        operations.push(["write", path, options.mode, contents.includes('"strategyId"')]);
      },
      openImpl: async (path) => {
        operations.push(["open", path]);
        return {
          sync: async () => operations.push(["sync", path]),
          close: async () => operations.push(["close", path]),
        };
      },
      renameImpl: async (from, to) => {
        operations.push(["rename", from, to]);
      },
      rmImpl: async (path) => {
        operations.push(["rm", path]);
      },
      now: () => new Date("2026-05-16T00:00:00.000Z"),
    },
  );

  assert.equal(saved.persisted, true);
  assert.equal(operations[0][0], "mkdir");
  assert.equal(operations[1][0], "write");
  assert.notEqual(tempFile, botConfigFile);
  assert.equal(operations.some((operation) => operation[0] === "rename" && operation[2] === botConfigFile), true);
  assert.equal(operations.filter((operation) => operation[0] === "sync").length, 2);
  assert.equal(operations.some((operation) => operation[0] === "rm"), false);
});

test("bot config rejects temp-file fsync failures and removes the temp file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "etoro-bot-config-fsync-fail-"));
  const botConfigFile = join(tempDir, "bot-config.json");
  const operations = [];
  let tempFile = null;

  await assert.rejects(
    saveBotConfig(
      {
        strategyId: "dca-cash-reserve",
        budgetUsd: 1000,
        allowedMarkets: ["US_EQUITIES"],
        allowedInstrumentClasses: ["ETF"],
        cadence: "daily",
      },
      {
        configFile: botConfigFile,
        mkdirImpl: async () => {},
        writeFileImpl: async (path) => {
          tempFile = path;
          operations.push(["write", path]);
        },
        openImpl: async (path) => ({
          sync: async () => {
            operations.push(["sync", path]);
            throw Object.assign(new Error("fsync failed"), { code: "EIO" });
          },
          close: async () => operations.push(["close", path]),
        }),
        renameImpl: async () => operations.push(["rename"]),
        rmImpl: async (path, options) => operations.push(["rm", path, options.force]),
      },
    ),
    /fsync failed/,
  );

  assert.notEqual(tempFile, null);
  assert.equal(operations.some((operation) => operation[0] === "rename"), false);
  assert.equal(operations.some((operation) => operation[0] === "rm" && operation[1] === tempFile && operation[2] === true), true);
});

test("bot config saves are serialized per config file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "etoro-bot-config-serialized-"));
  const botConfigFile = join(tempDir, "bot-config.json");
  let activeRenames = 0;
  let maxActiveRenames = 0;
  let renameCount = 0;

  const options = {
    configFile: botConfigFile,
    mkdirImpl: async () => {},
    writeFileImpl: async () => {},
    openImpl: async () => ({
      sync: async () => {},
      close: async () => {},
    }),
    renameImpl: async () => {
      activeRenames += 1;
      maxActiveRenames = Math.max(maxActiveRenames, activeRenames);
      await new Promise((resolve) => setTimeout(resolve, 10));
      renameCount += 1;
      activeRenames -= 1;
    },
    rmImpl: async () => {},
  };

  await Promise.all([
    saveBotConfig(
      {
        strategyId: "dca-cash-reserve",
        budgetUsd: 1000,
        allowedMarkets: ["US_EQUITIES"],
        allowedInstrumentClasses: ["ETF"],
        cadence: "daily",
      },
      options,
    ),
    saveBotConfig(
      {
        strategyId: "threshold-rebalance",
        budgetUsd: 1500,
        allowedMarkets: ["COMMODITIES"],
        allowedInstrumentClasses: ["COMMODITY"],
        cadence: "weekly",
      },
      options,
    ),
  ]);

  assert.equal(renameCount, 2);
  assert.equal(maxActiveRenames, 1);
});

test("bot config update rejects missing token, cross-origin, and bad content type", async () => {
  const handler = configuredHandler();
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const body = JSON.stringify({
    strategyId: "dca-cash-reserve",
    budgetUsd: 1000,
    allowedMarkets: ["US_EQUITIES"],
    allowedInstrumentClasses: ["ETF"],
    cadence: "daily",
  });
  const missingToken = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: {
      host: "localhost:4173",
      origin: "http://localhost:4173",
      "content-type": "application/json",
    },
    body,
  });
  const crossOrigin = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection, {
      origin: "https://example.com",
    }),
    body,
  });
  const badContentType = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection, {
      "content-type": "text/plain",
    }),
    body,
  });

  assert.equal(missingToken.status, 403);
  assert.equal(missingToken.json.error.code, "BOT_CONFIG_MUTATION_FORBIDDEN");
  assert.match(missingToken.json.error.message, /token/);
  assert.equal(crossOrigin.status, 403);
  assert.match(crossOrigin.json.error.message, /local dashboard origin/);
  assert.equal(badContentType.status, 415);
  assert.match(badContentType.json.error.message, /application\/json/);
  assert.equal(missingToken.text.includes("server-api-secret"), false);
  assert.equal(crossOrigin.text.includes("server-user-secret"), false);
});

test("bot config update rejects unsupported strategy, markets, and high-frequency cadence", async () => {
  const handler = configuredHandler();
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const response = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({
      strategyId: "uploaded-ai-scalper",
      budgetUsd: 10_000,
      allowedMarkets: ["CRYPTO"],
      allowedInstrumentClasses: ["CFD"],
      cadence: "minute",
      minimumEvaluationIntervalMinutes: 5,
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, "BOT_CONFIG_INVALID");
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.text.includes("uploaded-ai-scalper"), false);
  assert.equal(response.text.includes("server-api-secret"), false);
});

test("bot config rejects execute mode while retaining disabled policy metadata", async () => {
  const handler = configuredHandler();
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const response = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({
      runMode: "execute",
      strategyId: "dca-cash-reserve",
      budgetUsd: 1000,
      allowedMarkets: ["US_EQUITIES"],
      allowedInstrumentClasses: ["ETF"],
      cadence: "daily",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, "BOT_CONFIG_INVALID");
  assert.match(response.json.error.message, /runMode/);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
});

test("bot config mirrors strategy registry rules for market, instrument, and cadence compatibility", async () => {
  const handler = configuredHandler();
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const dcaForex = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({
      strategyId: "dca-cash-reserve",
      budgetUsd: 1000,
      allowedMarkets: ["FOREX"],
      allowedInstrumentClasses: ["FOREX"],
      cadence: "daily",
    }),
  });
  const thresholdDaily = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({
      strategyId: "threshold-rebalance",
      budgetUsd: 1000,
      allowedMarkets: ["US_EQUITIES"],
      allowedInstrumentClasses: ["ETF"],
      cadence: "daily",
    }),
  });
  const mismatchedMarketClass = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({
      strategyId: "news-aware-watchlist",
      budgetUsd: 1000,
      allowedMarkets: ["US_EQUITIES"],
      allowedInstrumentClasses: ["FOREX"],
      cadence: "daily",
    }),
  });

  assert.equal(dcaForex.status, 400);
  assert.match(dcaForex.json.error.message, /allowedMarkets/);
  assert.equal(thresholdDaily.status, 400);
  assert.match(thresholdDaily.json.error.message, /cadence/);
  assert.equal(mismatchedMarketClass.status, 400);
  assert.match(mismatchedMarketClass.json.error.message, /selected markets/);
});

test("bot config rejects unsupported methods and oversized request bodies", async () => {
  const handler = configuredHandler();
  const mutationProtection = await readBotConfigMutationProtection(handler);
  const methodResponse = await callHandler(handler, {
    method: "POST",
    url: "/api/etoro/bot/config",
    body: "{}",
  });
  const oversizedResponse = await callHandler(handler, {
    method: "PUT",
    url: "/api/etoro/bot/config",
    headers: localBotConfigMutationHeaders(mutationProtection),
    body: JSON.stringify({ note: "x".repeat(17_000) }),
  });

  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.json.error.code, "METHOD_NOT_ALLOWED");
  assert.equal(oversizedResponse.status, 400);
  assert.equal(oversizedResponse.json.error.code, "BOT_CONFIG_INVALID");
  assert.match(oversizedResponse.json.error.message, /bytes or smaller/);
});

test("bot audit and events are read-only synthetic feeds", async () => {
  const audit = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/audit",
  });
  const events = await callHandler(configuredHandler(), {
    url: "/api/etoro/bot/events",
  });

  assert.equal(audit.status, 200);
  assert.equal(events.status, 200);
  assert.equal(audit.json.auditEvents[0].action, "simulation_monitor_loaded");
  assert.equal(events.json.events[1].type, "risk-veto");
  assert.match(events.json.events[0].detail, /historical market data/);
  assert.match(events.json.events[1].detail, /Deterministic backtest review/);
  assert.equal(audit.json.pagination.hasMore, false);
  assert.equal(events.json.pagination.nextCursor, null);
  assert.equal(audit.json.mutationRoutesEnabled, false);
  assert.equal(events.json.mutationRoutesEnabled, false);
  assert.equal(audit.text.includes("server-api-secret"), false);
  assert.equal(events.text.includes("server-user-secret"), false);
  assert.equal(audit.text.includes('"accountId"'), false);
  assert.equal(events.text.includes('"accountId"'), false);
  assert.equal(events.text.includes("Portfolio snapshot"), false);
});

test("risk radar status is read-only, synthetic, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/risk/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "risk-radar-planning");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.livePortfolioConnected, false);
  assert.equal(response.json.fixtureWatermark.kind, "synthetic-fixture");
  assert.equal(response.json.fixtureWatermark.surface, "risk-radar");
  assert.equal(response.json.fixtureWatermark.liveProviderConnected, false);
  assert.equal(response.json.fixtureWatermark.containsPrivateAccountData, false);
  assert.equal(response.json.fixtureWatermark.containsRawProviderPayloads, false);
  assert.equal(response.json.fixtureWatermark.safeForPublicDemo, true);
  assert.deepEqual(response.json.fixtureWatermark.sourceLineage, {
    providerResponses: "absent",
    accountLinkedData: "absent",
    persistence: "not-persisted",
    generatedFrom: "repo-local synthetic status DTO",
  });
  assert.equal(response.json.portfolioRisk.source, "synthetic-placeholder");
  assert.equal(response.json.safeguards.executionRoutes, "absent");
  assert.equal(response.json.safeguards.accountIdentifiers, "redacted");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes('"accountId"'), false);
});

test("research desk status is read-only, synthetic, and redacted", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/research/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "research-desk-planning");
  assert.equal(response.json.readOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.fixtureWatermark.kind, "synthetic-fixture");
  assert.equal(response.json.fixtureWatermark.surface, "research-desk");
  assert.equal(response.json.fixtureWatermark.liveProviderConnected, false);
  assert.equal(response.json.fixtureWatermark.containsPrivateAccountData, false);
  assert.equal(response.json.fixtureWatermark.containsRawProviderPayloads, false);
  assert.equal(response.json.fixtureWatermark.safeForPublicDemo, true);
  assert.deepEqual(response.json.fixtureWatermark.sourceLineage, {
    providerResponses: "absent",
    accountLinkedData: "absent",
    persistence: "not-persisted",
    generatedFrom: "repo-local synthetic status DTO",
  });
  assert.equal(response.json.dataSources.watchlists, "synthetic-placeholder");
  assert.equal(response.json.dataSources.marketNews, "api-first-planned");
  assert.equal(response.json.dataSources.financialRecords, "official-api-first-planned");
  assert.equal(response.json.dataSources.insiderTransactions, "sec-forms-3-4-5-planned");
  assert.equal(response.json.instrumentLookup.enabled, false);
  assert.equal(response.json.marketNews.enabled, false);
  assert.equal(response.json.marketNews.safeguards.includes("no-trade-trigger-from-news"), true);
  assert.equal(response.json.intelligence.sourcePriority[0].id, "sec-companyfacts");
  assert.equal(response.json.intelligence.freeApiOptions[0].id, "etoro-public-api");
  assert.equal(response.json.intelligence.freeApiOptions.some((source) => source.id === "alpha-vantage"), true);
  assert.equal(response.json.intelligence.freeApiOptions.some((source) => source.id === "twelve-data"), true);
  assert.equal(response.json.intelligence.providerFallbackPolicy.mode, "metadata-only");
  assert.deepEqual(response.json.intelligence.providerFallbackPolicy.enabledByDefault, [
    "etoro-public-api",
    "sec-companyfacts",
    "sec-ownership-rss",
  ]);
  assert.equal(response.json.intelligence.providerFallbackPolicy.disabledUntilConfigured.includes("alpha-vantage"), true);
  assert.equal(response.json.intelligence.providerFallbackPolicy.safety.includes("no-browser-keys"), true);
  assert.equal(response.json.intelligence.providerFallbackPolicy.safety.includes("no-trade-or-bot-signal-output"), true);
  assert.equal(response.json.intelligence.adapterContracts[0].id, "sec-companyfacts");
  assert.equal(response.json.intelligence.adapterContracts[0].liveFetchEnabled, false);
  assert.equal(response.json.intelligence.adapterContracts[0].rawPayloadPersistence, "blocked");
  assert.equal(response.json.intelligence.adapterContracts[1].id, "sec-ownership-filings");
  assert.equal(response.json.intelligence.adapterContracts[1].liveFetchEnabled, false);
  assert.equal(response.json.intelligence.adapterContracts[1].rawPayloadPersistence, "blocked");
  assert.equal(response.json.intelligence.providerReadiness[0].id, "etoro-public-api");
  assert.equal(response.json.intelligence.providerReadiness[0].credentialHandling, "server-side provider keys only");
  assert.equal(response.json.intelligence.providerReadiness[0].requestMetadata.includes("provider-auth-headers-redacted"), true);
  assert.equal(response.json.intelligence.providerReadiness.every((provider) => provider.liveNetworkConnected === false), true);
  assert.equal(
    response.json.intelligence.providerReadiness.find((provider) => provider.id === "alpha-vantage").defaultState,
    "disabled-optional-key",
  );
  assert.equal(response.json.intelligence.sourcePriority.some((source) => source.id === "sec-insider-transactions"), true);
  assert.equal(response.json.intelligence.scrapingPolicy.priority, "api-first-scraping-fallback");
  assert.equal(response.json.intelligence.scrapingPolicy.finviz.insiderTradingPage, "reference-only");
  assert.equal(response.json.intelligence.coverageStatePolicy.states.includes("sufficient-data"), true);
  assert.equal(response.json.intelligence.coverageStatePolicy.states.includes("mixed-records"), true);
  assert.equal(response.json.intelligence.coverageStatePolicy.blockedUses.includes("autonomous trading trigger"), true);
  assert.equal(response.json.intelligence.financialRecordsPreview[0].sourceState, "fixture-sec-companyfacts-normalized");
  assert.equal(response.json.intelligence.financialRecordsPreview[0].coverageState, "sufficient-data");
  assert.equal(response.json.intelligence.financialRecordsPreview[0].provider.rawPayloadIncluded, false);
  assert.equal(response.json.intelligence.financialRecordsPreview[0].safeguards.noExecutionUse, true);
  assert.equal(response.json.intelligence.insiderActivityPreview[0].sourceState, "fixture-sec-ownership-normalized");
  assert.equal(response.json.intelligence.insiderActivityPreview[0].provider.rawPayloadIncluded, false);
  assert.equal(response.json.intelligence.insiderActivityPreview[0].safeguards.noExecutionUse, true);
  assert.equal(response.json.positionContextPreview.length, 2);
  assert.equal(response.json.positionContextPreview[0].contextOnly, true);
  assert.match(response.json.positionContextPreview[0].news[0].summary, /cannot create a signal or order/);
  assert.equal(response.json.safeguards.watchlistMutation, "blocked");
  assert.equal(response.json.safeguards.feedPosting, "blocked");
  assert.equal(response.json.safeguards.newsTradingSignals, "blocked");
  assert.equal(response.json.safeguards.indicatorTradingSignals, "blocked");
  assert.equal(response.json.safeguards.financialAdvice, "blocked");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("x-api-key"), false);
  assert.equal(response.text.includes("x-user-key"), false);
  assert.equal(response.text.includes('"accountId"'), false);
  assert.equal(response.text.includes('"facts"'), false);
  assert.equal(response.text.includes('"units"'), false);
  assert.equal(response.text.includes("finviz.com"), false);
});

test("demo trading status is planning-only and does not expose secrets", async () => {
  const response = await callHandler(configuredHandler(), {
    url: "/api/etoro/demo/trading/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.permissionMatrix.some((item) => item.id === "mutation-routes"), true);
  assert.equal(response.json.rateBudget.currentPressure, "not-connected");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("market-open-orders"), false);
  assert.equal(response.text.includes("market-close-orders"), false);
});

test("demo trading status returns planning metadata without credentials", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: false,
      credentialFileLoaded: false,
      credentialSource: "none",
      missing: ["apiKey", "userKey"],
    }),
  }), {
    url: "/api/etoro/demo/trading/status",
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.demoOnly, true);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.credentialStatus.configured, false);
  assert.equal(response.json.permissionMatrix.find((item) => item.id === "read-key").state, "missing");
  assert.equal(response.json.permissionMatrix.find((item) => item.id === "write-key").state, "absent");
});

test("demo trade preview is blocked unless explicitly enabled", async () => {
  const response = await callHandler(configuredHandler(), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.json.error.code, "DEMO_TRADE_PREVIEW_DISABLED");
});

test("enabled demo trade preview returns a redacted non-executing ticket", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
      leverage: "1",
      stopLoss: "120",
      takeProfit: "180",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.mode, "demo-trade-preview");
  assert.equal(response.json.mutationRoutesEnabled, false);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.json.ticket.hasInstrumentId, true);
  assert.equal(response.json.ticket.instrumentId, undefined);
  assert.equal(response.json.ticket.amount, 150);
  assert.equal(response.text.includes("100000"), false);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("market-open-orders"), false);
  assert.equal(response.json.providerEndpoint.category, "market-open-by-amount");
});

test("demo trade preview caps amount tickets to the simulation budget ceiling", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "2500.01",
      leverage: "1",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.executionBlocked, true);
  assert.match(response.json.error.message, /2500 USD or lower/);
  assert.equal(response.text.includes("100000"), false);
});

test("demo trade preview caps unit tickets to the simulation unit ceiling", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByUnits",
      instrumentId: "100000",
      side: "BUY",
      units: "1000.01",
      leverage: "1",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.executionBlocked, true);
  assert.match(response.json.error.message, /1000 or lower/);
  assert.equal(response.text.includes("100000"), false);
});

test("demo trade preview blocks close-position tickets until audited close flow exists", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketClosePosition",
      positionId: "position-123",
      side: "BUY",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.executionBlocked, true);
  assert.match(response.json.error.message, /audited close-flow review/);
  assert.equal(response.text.includes("position-123"), false);
  assert.equal(response.text.includes('"positionId"'), false);
});

test("demo trade preview blocks sell-side and leverage concepts", async () => {
  const handler = createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  });
  const sellResponse = await callHandler(handler, {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "SELL",
      amount: "150",
      leverage: "1",
    }),
  });
  const leverageResponse = await callHandler(handler, {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
      leverage: "2",
    }),
  });

  assert.equal(sellResponse.status, 400);
  assert.match(sellResponse.json.error.message, /shorts and sell-side concepts are blocked/);
  assert.equal(leverageResponse.status, 400);
  assert.match(leverageResponse.json.error.message, /leverage 1/);
});

test("demo trade preview rejects oversized request bodies", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByAmount",
      instrumentId: "100000",
      side: "BUY",
      amount: "150",
      note: "x".repeat(17_000),
    }),
  });

  assert.equal(response.status, 400);
  assert.match(response.json.error.message, /bytes or smaller/);
});

test("demo trade preview validates required ticket fields", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      configured: true,
      credentialFileLoaded: false,
      credentialSource: "environment",
      demoTradePreviewEnabled: true,
      missing: [],
    }),
  }), {
    method: "POST",
    url: "/api/etoro/demo/trading/preview",
    body: JSON.stringify({
      orderType: "marketOpenByUnits",
      instrumentId: "100000",
      side: "BUY",
    }),
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.executionBlocked, true);
  assert.equal(response.json.error.code, "INVALID_DEMO_TRADE_PREVIEW");
  assert.match(response.json.error.message, /requires an instrument ID and units/);
});

test("status route never returns configured secret values", async () => {
  const response = await callHandler(configuredHandler(), { url: "/api/etoro/status" });

  assert.equal(response.status, 200);
  assert.equal(response.json.cachePolicy.readOnlyTtlMs, 15_000);
  assert.equal(response.json.cachePolicy.failureBackoffMs, DEFAULT_PROVIDER_FAILURE_BACKOFF_MS);
  assert.equal(response.json.cachePolicy.requestCoalescing, true);
  assert.equal(response.json.cachePolicy.storage, "server-memory");
  assert.equal(response.json.credentialStatus.providerEndpointDetails, "server-only");
  assert.equal(response.json.credentialStatus.baseUrl, undefined);
  assert.equal(response.json.provider.endpointDetails, "server-only");
  assert.equal(response.json.provider.baseUrlDetails, "server-only");
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("public-api.etoro.com"), false);
  assert.equal(response.text.includes("/api/v1/"), false);
});

test("status route reports configured read cache policy without secrets", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
      readCacheTtlMs: 30_000,
    }),
  }), { url: "/api/etoro/status" });

  assert.equal(response.status, 200);
  assert.equal(response.json.cachePolicy.readOnlyTtlMs, 30_000);
  assert.equal(response.json.credentialStatus.readCacheTtlMs, 30_000);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("public-api.etoro.com"), false);
  assert.equal(response.text.includes("/api/v1/"), false);
});

test("unexpected API errors return generic public messages without local paths or secrets", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => {
      throw new Error(
        "/Users/yogi/.config/etoro/credentials.json x-api-key=server-api-secret x-user-key=server-user-secret",
      );
    },
  }), { url: "/api/etoro/status" });

  assert.equal(response.status, 500);
  assert.equal(response.json.error.code, "UNEXPECTED_ERROR");
  assert.equal(response.json.error.message, "Unexpected server error");
  assert.equal(response.text.includes("/Users/yogi"), false);
  assert.equal(response.text.includes("credentials.json"), false);
  assert.equal(response.text.includes("server-api-secret"), false);
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("x-api-key"), false);
  assert.equal(response.text.includes("x-user-key"), false);
});

test("known config errors use fixed public messages", async () => {
  const response = await callHandler(createRequestHandler({
    loadConfig: async () => {
      const error = new Error("server-user-secret from /Users/yogi/.config/etoro/credentials.json");
      error.code = "ETORO_INVALID_CACHE_TTL";
      throw error;
    },
  }), { url: "/api/etoro/status" });

  assert.equal(response.status, 500);
  assert.equal(response.json.error.code, "ETORO_INVALID_CACHE_TTL");
  assert.equal(response.json.error.message, "Read cache TTL must be a positive integer.");
  assert.equal(response.text.includes("server-user-secret"), false);
  assert.equal(response.text.includes("/Users/yogi"), false);
});

test("read-only provider responses are cached without exposing secrets", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: configuredConfig,
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000 }),
    fetchEndpoint: async (endpointName) => {
      fetchCount += 1;
      return {
        data: {
          authenticated: true,
          accountRefs: {
            hasGcid: true,
            hasRealCid: true,
            hasDemoCid: true,
          },
        },
        provider: {
          endpoint: endpointName,
          method: "GET",
          path: "/api/v1/me",
          baseUrl: "https://public-api.etoro.com",
          status: 200,
          requestId: `request-${fetchCount}`,
          receivedAt: new Date().toISOString(),
          durationMs: 12,
        },
      };
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 1);
  assert.equal(first.json.cache.state, "miss");
  assert.equal(first.json.provider.durationMs, 12);
  assert.equal(first.json.provider.path, undefined);
  assert.equal(first.json.provider.baseUrl, undefined);
  assert.equal(first.json.provider.endpointDetails, "server-only");
  assert.equal(first.json.provider.baseUrlDetails, "server-only");
  assert.equal(second.json.cache.state, "hit");
  assert.equal(second.json.provider.durationMs, 12);
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret"), false);
  assert.equal(second.text.includes("public-api.etoro.com"), false);
  assert.equal(second.text.includes("/api/v1/"), false);
});

test("read-only provider rate-limit failures use short backoff without exposing secrets", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: configuredConfig,
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000, failureBackoffMs: 2_000 }),
    fetchEndpoint: async () => {
      fetchCount += 1;
      throw providerError("eToro request failed with HTTP 429", {
        code: "ETORO_PROVIDER_ERROR",
        status: 429,
        requestId: `request-${fetchCount}`,
      });
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 429);
  assert.equal(second.status, 429);
  assert.equal(fetchCount, 1);
  assert.equal(first.json.cache.state, "error");
  assert.equal(second.json.cache.state, "backoff");
  assert.equal(second.json.cache.ttlMs, 2_000);
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret"), false);
});

test("read-only provider backoff errors never expose provider secrets or header names", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: configuredConfig,
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000, failureBackoffMs: 2_000 }),
    fetchEndpoint: async () => {
      fetchCount += 1;
      throw providerError("upstream 503 x-api-key: server-api-secret x-user-key=server-user-secret", {
        code: "ETORO_PROVIDER_ERROR",
        status: 503,
        requestId: `secret-failure-${fetchCount}`,
      });
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 503);
  assert.equal(second.status, 503);
  assert.equal(fetchCount, 1);
  assert.equal(first.json.error.message, "eToro provider is temporarily unavailable.");
  assert.equal(second.json.error.message, "eToro provider is temporarily unavailable.");
  assert.equal(first.json.error.code, "ETORO_PROVIDER_ERROR");
  assert.equal(second.json.cache.state, "backoff");
  for (const response of [first, second]) {
    assert.equal(response.text.includes("server-api-secret"), false);
    assert.equal(response.text.includes("server-user-secret"), false);
    assert.equal(response.text.includes("x-api-key"), false);
    assert.equal(response.text.includes("x-user-key"), false);
  }
});

test("read-only provider non-backoff errors never expose provider secrets or header names", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: configuredConfig,
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000, failureBackoffMs: 2_000 }),
    fetchEndpoint: async () => {
      fetchCount += 1;
      throw providerError("upstream 400 X-API-Key: server-api-secret X-User-Key=server-user-secret", {
        code: "ETORO_PROVIDER_ERROR",
        status: 400,
        requestId: `secret-client-failure-${fetchCount}`,
      });
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 400);
  assert.equal(second.status, 400);
  assert.equal(fetchCount, 2);
  assert.equal(first.json.error.message, "eToro provider request failed.");
  assert.equal(second.json.error.message, "eToro provider request failed.");
  assert.equal(first.json.cache, undefined);
  assert.equal(second.json.cache, undefined);
  for (const response of [first, second]) {
    assert.equal(response.text.includes("server-api-secret"), false);
    assert.equal(response.text.includes("server-user-secret"), false);
    assert.equal(response.text.includes("X-API-Key"), false);
    assert.equal(response.text.includes("X-User-Key"), false);
  }
});

test("read-only provider timeout and 5xx failures are backoff cached, but 4xx failures retry", async () => {
  const config = await configuredConfig();
  const timeoutCache = createReadOnlyProviderCache({ ttlMs: 60_000, failureBackoffMs: 1_000 });
  let timeoutFetchCount = 0;

  await assert.rejects(
    timeoutCache.fetch("identity", config, async () => {
      timeoutFetchCount += 1;
      throw providerError("eToro request timed out", {
        code: "ETORO_TIMEOUT",
        requestId: `timeout-${timeoutFetchCount}`,
      });
    }),
    (error) => error.code === "ETORO_TIMEOUT" && error.cache?.state === "error",
  );
  await assert.rejects(
    timeoutCache.fetch("identity", config, async () => {
      timeoutFetchCount += 1;
      throw providerError("unexpected second timeout fetch", { code: "ETORO_TIMEOUT" });
    }),
    (error) => error.code === "ETORO_TIMEOUT" && error.cache?.state === "backoff",
  );

  const serverErrorCache = createReadOnlyProviderCache({ ttlMs: 60_000, failureBackoffMs: 1_000 });
  let serverErrorFetchCount = 0;
  await assert.rejects(
    serverErrorCache.fetch("demoPnl", config, async () => {
      serverErrorFetchCount += 1;
      throw providerError("eToro request failed with HTTP 503", {
        code: "ETORO_PROVIDER_ERROR",
        status: 503,
      });
    }),
    (error) => error.status === 503 && error.cache?.state === "error",
  );
  await assert.rejects(
    serverErrorCache.fetch("demoPnl", config, async () => {
      serverErrorFetchCount += 1;
      throw providerError("unexpected second 5xx fetch", { code: "ETORO_PROVIDER_ERROR", status: 503 });
    }),
    (error) => error.status === 503 && error.cache?.state === "backoff",
  );

  const clientErrorCache = createReadOnlyProviderCache({ ttlMs: 60_000, failureBackoffMs: 1_000 });
  let clientErrorFetchCount = 0;
  await assert.rejects(
    clientErrorCache.fetch("identity", config, async () => {
      clientErrorFetchCount += 1;
      throw providerError("eToro request failed with HTTP 400", {
        code: "ETORO_PROVIDER_ERROR",
        status: 400,
      });
    }),
    (error) => error.status === 400 && !error.cache,
  );
  await assert.rejects(
    clientErrorCache.fetch("identity", config, async () => {
      clientErrorFetchCount += 1;
      throw providerError("eToro request failed with HTTP 400", {
        code: "ETORO_PROVIDER_ERROR",
        status: 400,
      });
    }),
    (error) => error.status === 400 && !error.cache,
  );

  assert.equal(timeoutFetchCount, 1);
  assert.equal(serverErrorFetchCount, 1);
  assert.equal(clientErrorFetchCount, 2);
});

test("concurrent read-only provider requests are coalesced", async () => {
  let fetchCount = 0;
  const handler = createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey: "server-user-secret",
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
    }),
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000 }),
    fetchEndpoint: async (endpointName) => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        data: {
          currency: "USD",
          credit: 100,
          equity: 100,
          realizedPnL: 0,
          unrealizedPnL: 0,
          availableCash: 100,
          totalInvested: 0,
          calculatedUnrealizedPnL: 0,
          positionCount: 0,
          mirrorCount: 0,
          pendingOrderCount: 0,
          manualPendingOrderCount: 0,
          providerUpdatedAt: null,
        },
        provider: {
          endpoint: endpointName,
          method: "GET",
          path: "/api/v1/trading/info/demo/pnl",
          baseUrl: "https://public-api.etoro.com",
          status: 200,
          requestId: `request-${fetchCount}`,
          receivedAt: new Date().toISOString(),
        },
      };
    },
  });

  const [first, second] = await Promise.all([
    callHandler(handler, { url: "/api/etoro/demo/pnl" }),
    callHandler(handler, { url: "/api/etoro/demo/pnl" }),
  ]);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 1);
  assert.equal(first.json.cache.state, "miss");
  assert.equal(second.json.cache.state, "coalesced");
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret"), false);
});

test("read-only provider cache is separated by credential fingerprint", async () => {
  let fetchCount = 0;
  let userKey = "server-user-secret-a";
  const handler = createRequestHandler({
    loadConfig: async () => ({
      baseUrl: "https://public-api.etoro.com",
      apiKey: "server-api-secret",
      userKey,
      configured: true,
      credentialFileLoaded: true,
      credentialSource: "file",
      missing: [],
    }),
    providerCache: createReadOnlyProviderCache({ ttlMs: 60_000 }),
    fetchEndpoint: async (endpointName) => {
      fetchCount += 1;
      return {
        data: {
          authenticated: true,
          accountRefs: {
            hasGcid: true,
            hasRealCid: true,
            hasDemoCid: true,
          },
        },
        provider: {
          endpoint: endpointName,
          method: "GET",
          path: "/api/v1/me",
          baseUrl: "https://public-api.etoro.com",
          status: 200,
          requestId: `request-${fetchCount}`,
          receivedAt: new Date().toISOString(),
        },
      };
    },
  });

  const first = await callHandler(handler, { url: "/api/etoro/identity" });
  userKey = "server-user-secret-b";
  const second = await callHandler(handler, { url: "/api/etoro/identity" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(fetchCount, 2);
  assert.equal(first.json.cache.state, "miss");
  assert.equal(second.json.cache.state, "miss");
  assert.equal(second.text.includes("server-api-secret"), false);
  assert.equal(second.text.includes("server-user-secret-a"), false);
  assert.equal(second.text.includes("server-user-secret-b"), false);
});

test("non-GET API requests are rejected", async () => {
  const response = await callHandler(createRequestHandler(), {
    method: "POST",
    url: "/api/etoro/demo/pnl",
  });

  assert.equal(response.status, 405);
  assert.equal(response.json.error.code, "METHOD_NOT_ALLOWED");
});

test("json responses include financial-dashboard security headers", async () => {
  const response = await callHandler(createRequestHandler(), { url: "/api/health" });

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("static responses include restrictive browser security headers", async () => {
  const response = await callHandler(createRequestHandler(), { url: "/index.html" });

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["content-security-policy"].includes("frame-ancestors 'none'"), true);
  assert.equal(response.headers["content-security-policy"].includes("default-src 'self'"), true);
});

test("malformed URL paths return a controlled not-found response", async () => {
  const response = await callHandler(createRequestHandler(), { url: "/bad-%-path" });

  assert.equal(response.status, 404);
  assert.equal(response.json.error.code, "NOT_FOUND");
});

test("server-side modules are not served as static browser assets", async () => {
  const response = await callHandler(createRequestHandler(), { url: "/server.mjs" });

  assert.equal(response.status, 404);
  assert.equal(response.json.error.code, "NOT_FOUND");
});
