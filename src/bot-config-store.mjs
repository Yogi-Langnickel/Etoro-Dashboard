import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const DEFAULT_BOT_CONFIG_FILE = join(homedir(), ".config", "etoro-dashboard", "bot-config.json");
export const BOT_CONFIG_MIRROR_SOURCE = "Money-maker-3000/src/money_maker_3000/contracts.py";
export const BOT_CONFIG_CONTRACT_VERSION = "0.1.0-sim";

export const ALLOWED_BOT_STRATEGY_IDS = Object.freeze([
  "dca-cash-reserve",
  "threshold-rebalance",
  "volatility-band-accumulator",
  "slow-trend-allocation",
  "news-aware-watchlist",
]);

export const ALLOWED_BOT_BUDGETS_USD = Object.freeze([500, 1000, 1500, 2500]);
export const ALLOWED_BOT_RUN_MODES = Object.freeze(["backtest"]);
export const DISABLED_BOT_RUN_MODES = Object.freeze(["execute", "trade", "trading"]);
export const ALLOWED_BOT_MARKETS = Object.freeze(["US_EQUITIES", "AU_EQUITIES", "FOREX", "COMMODITIES"]);
export const ALLOWED_BOT_INSTRUMENT_CLASSES = Object.freeze(["EQUITY", "ETF", "FOREX", "COMMODITY"]);
export const ALLOWED_BOT_CADENCES = Object.freeze(["daily", "weekly"]);
export const MIN_BOT_EVALUATION_INTERVAL_MINUTES = 240;
export const BOT_RUN_MODE_POLICY = Object.freeze({
  backtest: Object.freeze({
    enabled: true,
    providerCalls: "blocked",
    historicalInputs: "offline-fixture-only",
    accountData: "absent",
    executionRoutes: "absent",
  }),
  execute: Object.freeze({
    enabled: false,
    providerCalls: "blocked",
    demoExecution: "blocked",
    liveExecution: "blocked",
    reason: "demo execution requires a separate review and explicit approval",
  }),
  trade: Object.freeze({
    enabled: false,
    providerCalls: "blocked",
    demoExecution: "blocked",
    liveExecution: "blocked",
    reason: "trading aliases are disabled; only offline backtest mode is allowed",
  }),
  trading: Object.freeze({
    enabled: false,
    providerCalls: "blocked",
    demoExecution: "blocked",
    liveExecution: "blocked",
    reason: "trading aliases are disabled; only offline backtest mode is allowed",
  }),
});
export const BOT_MARKET_INSTRUMENT_CLASS_RULES = Object.freeze({
  US_EQUITIES: Object.freeze(["EQUITY", "ETF"]),
  AU_EQUITIES: Object.freeze(["EQUITY", "ETF"]),
  FOREX: Object.freeze(["FOREX"]),
  COMMODITIES: Object.freeze(["COMMODITY", "ETF"]),
});
export const BOT_STRATEGY_CONFIG_RULES = Object.freeze({
  "dca-cash-reserve": Object.freeze({
    name: "Cash-reserved DCA",
    version: "0.1.0-sim",
    status: "simulation-only",
    allowedMarkets: Object.freeze(["US_EQUITIES", "AU_EQUITIES"]),
    allowedInstrumentClasses: Object.freeze(["EQUITY", "ETF"]),
    cadence: "daily",
  }),
  "threshold-rebalance": Object.freeze({
    name: "Threshold rebalance",
    version: "0.1.0-sim",
    status: "simulation-only",
    allowedMarkets: Object.freeze(["US_EQUITIES", "AU_EQUITIES", "COMMODITIES"]),
    allowedInstrumentClasses: Object.freeze(["EQUITY", "ETF", "COMMODITY"]),
    cadence: "weekly",
  }),
  "volatility-band-accumulator": Object.freeze({
    name: "Volatility band accumulator",
    version: "0.1.0-sim",
    status: "simulation-only",
    allowedMarkets: Object.freeze(["US_EQUITIES", "AU_EQUITIES"]),
    allowedInstrumentClasses: Object.freeze(["EQUITY", "ETF"]),
    cadence: "daily",
  }),
  "slow-trend-allocation": Object.freeze({
    name: "Slow trend allocation",
    version: "0.1.0-sim",
    status: "simulation-only",
    allowedMarkets: Object.freeze(["US_EQUITIES", "AU_EQUITIES"]),
    allowedInstrumentClasses: Object.freeze(["EQUITY", "ETF"]),
    cadence: "weekly",
  }),
  "news-aware-watchlist": Object.freeze({
    name: "News-aware watchlist",
    version: "0.1.0-plan",
    status: "context-only",
    allowedMarkets: Object.freeze(["US_EQUITIES", "AU_EQUITIES", "FOREX", "COMMODITIES"]),
    allowedInstrumentClasses: Object.freeze(["EQUITY", "ETF", "FOREX", "COMMODITY"]),
    cadence: "daily",
  }),
});

const DEFAULT_BOT_CONFIG = Object.freeze({
  runMode: "backtest",
  strategyId: "dca-cash-reserve",
  budgetUsd: 1000,
  allowedMarkets: Object.freeze(["US_EQUITIES", "AU_EQUITIES"]),
  allowedInstrumentClasses: Object.freeze(["EQUITY", "ETF"]),
  cadence: "daily",
  minimumEvaluationIntervalMinutes: MIN_BOT_EVALUATION_INTERVAL_MINUTES,
});

export class BotConfigValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "BotConfigValidationError";
    this.code = "BOT_CONFIG_INVALID";
    this.errors = errors;
  }
}

const botConfigWriteQueues = new Map();

function tempConfigFilePath(configFile) {
  return join(dirname(configFile), `.${basename(configFile)}.${process.pid}.${randomUUID()}.tmp`);
}

async function fsyncFile(filePath, openImpl) {
  const handle = await openImpl(filePath, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isUnsupportedDirectorySyncError(error) {
  return ["EISDIR", "EINVAL", "ENOTSUP", "ENOTDIR", "EPERM"].includes(error?.code);
}

async function fsyncDirectory(directoryPath, openImpl) {
  let handle = null;

  try {
    handle = await openImpl(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function writeFileAtomic(
  configFile,
  contents,
  {
    writeFileImpl = writeFile,
    renameImpl = rename,
    rmImpl = rm,
    openImpl = open,
  } = {},
) {
  const tempFile = tempConfigFilePath(configFile);

  try {
    await writeFileImpl(tempFile, contents, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fsyncFile(tempFile, openImpl);
    await renameImpl(tempFile, configFile);
    await fsyncDirectory(dirname(configFile), openImpl);
  } catch (error) {
    await rmImpl(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function serializeConfigWrite(configFile, operation) {
  const previous = botConfigWriteQueues.get(configFile) ?? Promise.resolve();
  const current = previous.then(operation);
  const cleanup = current
    .catch(() => {})
    .then(() => {
      if (botConfigWriteQueues.get(configFile) === cleanup) {
        botConfigWriteQueues.delete(configFile);
      }
    });

  botConfigWriteQueues.set(configFile, cleanup);
  return current;
}

function normalizeStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new BotConfigValidationError(`${fieldName} must be an array`, [fieldName]);
  }

  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function assertAllowed(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new BotConfigValidationError(`${fieldName} is not allowed`, [fieldName]);
  }
}

function assertAllowedArray(values, allowedValues, fieldName) {
  if (values.length === 0) {
    throw new BotConfigValidationError(`${fieldName} must include at least one value`, [fieldName]);
  }

  const blocked = values.filter((value) => !allowedValues.includes(value));

  if (blocked.length > 0) {
    throw new BotConfigValidationError(`${fieldName} includes unsupported values`, [fieldName]);
  }
}

function assertStrategyRuleArray(values, allowedValues, fieldName, strategyId) {
  const blocked = values.filter((value) => !allowedValues.includes(value));

  if (blocked.length > 0) {
    throw new BotConfigValidationError(`${fieldName} includes values not allowed for ${strategyId}`, [fieldName]);
  }
}

function assertMarketInstrumentCompatibility(allowedMarkets, allowedInstrumentClasses) {
  const marketAllowedClasses = new Set(
    allowedMarkets.flatMap((market) => BOT_MARKET_INSTRUMENT_CLASS_RULES[market] ?? []),
  );
  const blocked = allowedInstrumentClasses.filter((instrumentClass) => !marketAllowedClasses.has(instrumentClass));

  if (blocked.length > 0) {
    throw new BotConfigValidationError("allowedInstrumentClasses include values not supported by selected markets", [
      "allowedInstrumentClasses",
    ]);
  }
}

function normalizeBotConfig(input = {}) {
  const candidate = {
    ...DEFAULT_BOT_CONFIG,
    ...input,
  };
  const runMode = String(candidate.runMode ?? "").trim();
  const strategyId = String(candidate.strategyId ?? "").trim();
  const budgetUsd = Number(candidate.budgetUsd);
  const allowedMarkets = normalizeStringArray(candidate.allowedMarkets, "allowedMarkets");
  const allowedInstrumentClasses = normalizeStringArray(
    candidate.allowedInstrumentClasses,
    "allowedInstrumentClasses",
  );
  const cadence = String(candidate.cadence ?? "").trim();
  const minimumEvaluationIntervalMinutes = Number(candidate.minimumEvaluationIntervalMinutes);

  assertAllowed(runMode, ALLOWED_BOT_RUN_MODES, "runMode");
  if (!BOT_RUN_MODE_POLICY[runMode]?.enabled) {
    throw new BotConfigValidationError("runMode execute is disabled; only backtest is currently allowed", [
      "runMode",
    ]);
  }

  assertAllowed(strategyId, ALLOWED_BOT_STRATEGY_IDS, "strategyId");
  const strategyRule = BOT_STRATEGY_CONFIG_RULES[strategyId];

  if (!Number.isInteger(budgetUsd) || !ALLOWED_BOT_BUDGETS_USD.includes(budgetUsd)) {
    throw new BotConfigValidationError("budgetUsd is not allowed", ["budgetUsd"]);
  }

  assertAllowedArray(allowedMarkets, ALLOWED_BOT_MARKETS, "allowedMarkets");
  assertAllowedArray(allowedInstrumentClasses, ALLOWED_BOT_INSTRUMENT_CLASSES, "allowedInstrumentClasses");
  assertAllowed(cadence, ALLOWED_BOT_CADENCES, "cadence");
  assertStrategyRuleArray(allowedMarkets, strategyRule.allowedMarkets, "allowedMarkets", strategyId);
  assertStrategyRuleArray(
    allowedInstrumentClasses,
    strategyRule.allowedInstrumentClasses,
    "allowedInstrumentClasses",
    strategyId,
  );

  if (cadence !== strategyRule.cadence) {
    throw new BotConfigValidationError(`cadence is not allowed for ${strategyId}`, ["cadence"]);
  }
  assertMarketInstrumentCompatibility(allowedMarkets, allowedInstrumentClasses);

  if (
    !Number.isInteger(minimumEvaluationIntervalMinutes) ||
    minimumEvaluationIntervalMinutes < MIN_BOT_EVALUATION_INTERVAL_MINUTES
  ) {
    throw new BotConfigValidationError("minimumEvaluationIntervalMinutes is below the no-HFT floor", [
      "minimumEvaluationIntervalMinutes",
    ]);
  }

  return {
    runMode,
    strategyId,
    budgetUsd,
    allowedMarkets,
    allowedInstrumentClasses,
    cadence,
    minimumEvaluationIntervalMinutes,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
  };
}

export function publicBotConfigPayload(config, { source = "default", persisted = false } = {}) {
  return {
    ok: true,
    mode: "bot-config",
    readOnly: false,
    demoOnly: true,
    mutationRoutesEnabled: false,
    executionBlocked: true,
    config,
    mirrorSource: BOT_CONFIG_MIRROR_SOURCE,
    contractVersion: BOT_CONFIG_CONTRACT_VERSION,
    options: {
      strategies: ALLOWED_BOT_STRATEGY_IDS,
      strategyRules: BOT_STRATEGY_CONFIG_RULES,
      runModes: ALLOWED_BOT_RUN_MODES,
      runModePolicy: BOT_RUN_MODE_POLICY,
      budgetsUsd: ALLOWED_BOT_BUDGETS_USD,
      markets: ALLOWED_BOT_MARKETS,
      instrumentClasses: ALLOWED_BOT_INSTRUMENT_CLASSES,
      marketInstrumentClassRules: BOT_MARKET_INSTRUMENT_CLASS_RULES,
      cadences: ALLOWED_BOT_CADENCES,
      minimumEvaluationIntervalMinutes: MIN_BOT_EVALUATION_INTERVAL_MINUTES,
    },
    persistence: {
      source,
      persisted,
      storage: "server-local-file",
      pathRedacted: true,
    },
    safeguards: {
      executionRoutes: "absent",
      accountMutation: "blocked",
      accountIdentifiers: "redacted",
      rawProviderPayloads: "hidden",
      highFrequencyTrading: "blocked",
      customStrategies: "blocked",
      liveTrading: "unavailable",
    },
  };
}

export async function loadBotConfig({ configFile = DEFAULT_BOT_CONFIG_FILE, readFileImpl = readFile } = {}) {
  try {
    const raw = await readFileImpl(configFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      config: normalizeBotConfig(parsed),
      source: "server-local-file",
      persisted: true,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        config: normalizeBotConfig(DEFAULT_BOT_CONFIG),
        source: "default",
        persisted: false,
      };
    }

    if (error instanceof SyntaxError) {
      throw new BotConfigValidationError("stored bot config is invalid JSON", ["configFile"]);
    }

    throw error;
  }
}

export async function saveBotConfig(
  input,
  {
    configFile = DEFAULT_BOT_CONFIG_FILE,
    mkdirImpl = mkdir,
    openImpl = open,
    renameImpl = rename,
    rmImpl = rm,
    writeFileImpl = writeFile,
    now = () => new Date(),
  } = {},
) {
  const config = normalizeBotConfig({
    ...input,
    updatedAt: now().toISOString(),
  });

  await serializeConfigWrite(configFile, async () => {
    await mkdirImpl(dirname(configFile), { recursive: true, mode: 0o700 });
    await writeFileAtomic(configFile, `${JSON.stringify(config, null, 2)}\n`, {
      openImpl,
      renameImpl,
      rmImpl,
      writeFileImpl,
    });
  });

  return {
    config,
    source: "server-local-file",
    persisted: true,
  };
}
