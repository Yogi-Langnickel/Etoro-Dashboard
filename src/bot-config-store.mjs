import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_BOT_CONFIG_FILE = join(homedir(), ".config", "etoro-dashboard", "bot-config.json");

export const ALLOWED_BOT_STRATEGY_IDS = Object.freeze([
  "dca-cash-reserve",
  "news-aware-watchlist",
  "threshold-rebalance",
]);

export const ALLOWED_BOT_BUDGETS_USD = Object.freeze([500, 1000, 1500, 2500]);
export const ALLOWED_BOT_MARKETS = Object.freeze(["US_EQUITIES", "AU_EQUITIES", "FOREX", "COMMODITIES"]);
export const ALLOWED_BOT_INSTRUMENT_CLASSES = Object.freeze(["EQUITY", "ETF", "FOREX", "COMMODITY"]);
export const ALLOWED_BOT_CADENCES = Object.freeze(["daily", "weekly"]);
export const MIN_BOT_EVALUATION_INTERVAL_MINUTES = 240;

export const DEFAULT_BOT_CONFIG = Object.freeze({
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

export function normalizeBotConfig(input = {}) {
  const candidate = {
    ...DEFAULT_BOT_CONFIG,
    ...input,
  };
  const strategyId = String(candidate.strategyId ?? "").trim();
  const budgetUsd = Number(candidate.budgetUsd);
  const allowedMarkets = normalizeStringArray(candidate.allowedMarkets, "allowedMarkets");
  const allowedInstrumentClasses = normalizeStringArray(
    candidate.allowedInstrumentClasses,
    "allowedInstrumentClasses",
  );
  const cadence = String(candidate.cadence ?? "").trim();
  const minimumEvaluationIntervalMinutes = Number(candidate.minimumEvaluationIntervalMinutes);

  assertAllowed(strategyId, ALLOWED_BOT_STRATEGY_IDS, "strategyId");

  if (!Number.isInteger(budgetUsd) || !ALLOWED_BOT_BUDGETS_USD.includes(budgetUsd)) {
    throw new BotConfigValidationError("budgetUsd is not allowed", ["budgetUsd"]);
  }

  assertAllowedArray(allowedMarkets, ALLOWED_BOT_MARKETS, "allowedMarkets");
  assertAllowedArray(allowedInstrumentClasses, ALLOWED_BOT_INSTRUMENT_CLASSES, "allowedInstrumentClasses");
  assertAllowed(cadence, ALLOWED_BOT_CADENCES, "cadence");

  if (
    !Number.isInteger(minimumEvaluationIntervalMinutes) ||
    minimumEvaluationIntervalMinutes < MIN_BOT_EVALUATION_INTERVAL_MINUTES
  ) {
    throw new BotConfigValidationError("minimumEvaluationIntervalMinutes is below the no-HFT floor", [
      "minimumEvaluationIntervalMinutes",
    ]);
  }

  return {
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
    options: {
      strategies: ALLOWED_BOT_STRATEGY_IDS,
      budgetsUsd: ALLOWED_BOT_BUDGETS_USD,
      markets: ALLOWED_BOT_MARKETS,
      instrumentClasses: ALLOWED_BOT_INSTRUMENT_CLASSES,
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
    writeFileImpl = writeFile,
    now = () => new Date(),
  } = {},
) {
  const config = normalizeBotConfig({
    ...input,
    updatedAt: now().toISOString(),
  });

  await mkdirImpl(dirname(configFile), { recursive: true, mode: 0o700 });
  await writeFileImpl(configFile, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    config,
    source: "server-local-file",
    persisted: true,
  };
}
