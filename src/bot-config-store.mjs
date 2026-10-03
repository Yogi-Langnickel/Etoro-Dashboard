import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  ALLOWED_BOT_BUDGETS_USD,
  ALLOWED_BOT_CADENCES,
  ALLOWED_BOT_INSTRUMENT_CLASSES,
  ALLOWED_BOT_MARKETS,
  ALLOWED_BOT_RUN_MODES,
  ALLOWED_BOT_STRATEGY_IDS,
  BOT_CONFIG_CONTRACT_VERSION,
  BOT_CONFIG_MIRROR_SOURCE,
  BOT_MARKET_INSTRUMENT_CLASS_RULES,
  BOT_RUN_MODE_POLICY,
  BOT_STRATEGY_CONFIG_RULES,
  DISABLED_BOT_RUN_MODES,
  MIN_BOT_EVALUATION_INTERVAL_MINUTES,
} from "./money-maker-contract.mjs";
export {
  ALLOWED_BOT_BUDGETS_USD,
  ALLOWED_BOT_CADENCES,
  ALLOWED_BOT_INSTRUMENT_CLASSES,
  ALLOWED_BOT_MARKETS,
  ALLOWED_BOT_RUN_MODES,
  ALLOWED_BOT_STRATEGY_IDS,
  BOT_CONFIG_CONTRACT_VERSION,
  BOT_CONFIG_MIRROR_SOURCE,
  BOT_MARKET_INSTRUMENT_CLASS_RULES,
  BOT_RUN_MODE_POLICY,
  BOT_STRATEGY_CONFIG_RULES,
  DISABLED_BOT_RUN_MODES,
  MIN_BOT_EVALUATION_INTERVAL_MINUTES,
} from "./money-maker-contract.mjs";

const DEFAULT_BOT_CONFIG_FILE = join(homedir(), ".config", "etoro-dashboard", "bot-config.json");

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

  if (value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    throw new BotConfigValidationError(`${fieldName} must contain unique typed values`, [fieldName]);
  }
  return [...value];
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
  const fields = [...Object.keys(DEFAULT_BOT_CONFIG), "updatedAt"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !fields.includes(key)) || Object.keys(DEFAULT_BOT_CONFIG).some((key) => !Object.hasOwn(input, key))) {
    throw new BotConfigValidationError("Bot config fields are invalid", ["config"]);
  }
  const candidate = {
    ...DEFAULT_BOT_CONFIG,
    ...input,
  };
  const runMode = candidate.runMode;
  const strategyId = candidate.strategyId;
  const budgetUsd = candidate.budgetUsd;
  const allowedMarkets = normalizeStringArray(candidate.allowedMarkets, "allowedMarkets");
  const allowedInstrumentClasses = normalizeStringArray(
    candidate.allowedInstrumentClasses,
    "allowedInstrumentClasses",
  );
  const cadence = candidate.cadence;
  const minimumEvaluationIntervalMinutes = candidate.minimumEvaluationIntervalMinutes;

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
    minimumEvaluationIntervalMinutes !== MIN_BOT_EVALUATION_INTERVAL_MINUTES
  ) {
    throw new BotConfigValidationError("minimumEvaluationIntervalMinutes must equal the approved contract value", [
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
    purpose: "saved-draft-preferences",
    runtimeApplied: false,
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
    if (!Object.hasOwn(parsed ?? {}, "updatedAt") || typeof parsed.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed.updatedAt) || !Number.isFinite(Date.parse(parsed.updatedAt))) throw new BotConfigValidationError("stored bot config timestamp is invalid", ["updatedAt"]);
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
  if (input && Object.hasOwn(input, "updatedAt")) throw new BotConfigValidationError("updatedAt is server-owned", ["updatedAt"]);
  normalizeBotConfig(input);
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
