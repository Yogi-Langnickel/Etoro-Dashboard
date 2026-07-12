import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const contractUrl = new URL("../contracts/generated/money-maker-dashboard-contract.json", import.meta.url);
const provenanceUrl = new URL("../contracts/generated/money-maker-dashboard-contract.provenance.json", import.meta.url);

function fail(message) {
  const error = new Error(`Generated Money-maker contract is invalid: ${message}`);
  error.code = "MONEY_MAKER_CONTRACT_INVALID";
  throw error;
}

function readText(url, label) {
  try {
    return readFileSync(url, "utf8");
  } catch {
    return fail(`${label} cannot be read`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    return fail(`${label} cannot be parsed`);
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function stringArray(value, { nonEmpty = true } = {}) {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertNoIdentifierKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoIdentifierKeys(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:apiKey|userKey|accountId|positionId|orderId|oauthToken)$/i.test(key)) {
      fail("identifier or credential fields are forbidden");
    }
    assertNoIdentifierKeys(child);
  }
}

const contractText = readText(contractUrl, "contract");
const contract = parseJson(contractText, "contract");
const provenance = parseJson(readText(provenanceUrl, "provenance"), "provenance");

const contractKeys = [
  "schemaVersion", "source", "version", "markets", "instrumentClasses", "blockedInstrumentClasses",
  "runModes", "disabledRunModes", "runModePolicy", "marketInstrumentClassRules", "cadences",
  "minimumEvaluationIntervalMinutes", "maxDecisionsPerDay", "selectableBudgetsUsd",
  "maxConfigurableBudgetUsd", "strategyIds", "strategyRules", "safety",
];
if (!exactKeys(contract, contractKeys)) fail("top-level shape has drifted");
if (contract.schemaVersion !== "dashboard-simulation-contract.v1") fail("schema version is unsupported");
if (contract.source !== "Money-maker-3000/src/money_maker_3000/contracts.py") fail("source is unexpected");
if (!stringArray(contract.markets) || !stringArray(contract.instrumentClasses) ||
  !stringArray(contract.blockedInstrumentClasses) || !stringArray(contract.cadences) ||
  !stringArray(contract.strategyIds)) fail("allow-list arrays are invalid");
if (JSON.stringify(contract.runModes) !== JSON.stringify(["backtest"])) fail("only backtest run mode is allowed");
if (JSON.stringify(contract.disabledRunModes) !== JSON.stringify(["execute", "trade", "trading"])) {
  fail("disabled execution modes have drifted");
}
if (!Number.isInteger(contract.minimumEvaluationIntervalMinutes) || contract.minimumEvaluationIntervalMinutes < 240 ||
  !Number.isInteger(contract.maxDecisionsPerDay) || contract.maxDecisionsPerDay < 1 ||
  contract.maxDecisionsPerDay > 3) fail("cadence limits are invalid");
if (!Array.isArray(contract.selectableBudgetsUsd) || contract.selectableBudgetsUsd.length === 0 ||
  contract.selectableBudgetsUsd.some((value) => !Number.isFinite(value) || value <= 0) ||
  !Number.isFinite(contract.maxConfigurableBudgetUsd) || contract.maxConfigurableBudgetUsd <= 0 ||
  contract.selectableBudgetsUsd.some((value) => value > contract.maxConfigurableBudgetUsd)) {
  fail("budget options are invalid");
}
if (!contract.strategyRules || typeof contract.strategyRules !== "object" || Array.isArray(contract.strategyRules) ||
  contract.strategyIds.length !== Object.keys(contract.strategyRules).length ||
  contract.strategyIds.some((strategyId) => !contract.strategyRules[strategyId])) {
  fail("strategy ordering or rules are invalid");
}
for (const strategyId of contract.strategyIds) {
  const rule = contract.strategyRules[strategyId];
  if (!exactKeys(rule, [
    "name", "version", "status", "cadence", "allowedMarkets", "allowedInstrumentClasses", "parameterSchema",
  ]) || !stringArray(rule.allowedMarkets) || !stringArray(rule.allowedInstrumentClasses) ||
    !contract.cadences.includes(rule.cadence) || !["simulation-only", "context-only"].includes(rule.status) ||
    !rule.parameterSchema || typeof rule.parameterSchema !== "object" || Array.isArray(rule.parameterSchema)) {
    fail(`strategy rule is invalid: ${strategyId}`);
  }
}
if (!exactKeys(contract.safety, [
  "providerCalls", "credentials", "accountData", "orderPreview", "demoExecution", "liveExecution",
  "arbitraryStrategyCode",
]) || contract.safety.providerCalls !== "blocked" || contract.safety.credentials !== "absent" ||
  contract.safety.accountData !== "absent" || contract.safety.orderPreview !== "blocked" ||
  contract.safety.demoExecution !== "blocked" || contract.safety.liveExecution !== "blocked" ||
  contract.safety.arbitraryStrategyCode !== "blocked") fail("safety boundary is invalid");
assertNoIdentifierKeys(contract);

if (!exactKeys(provenance, [
  "schemaVersion", "producerRepository", "producerCommit", "producerPath", "artifactSha256",
]) || provenance.schemaVersion !== "generated-contract-provenance.v1" ||
  provenance.producerRepository !== "Yogi-Langnickel/Money-maker-3000" ||
  provenance.producerPath !== "contracts/dashboard-simulation-contract.json" ||
  !/^[a-f0-9]{40}$/.test(provenance.producerCommit) || !/^[a-f0-9]{64}$/.test(provenance.artifactSha256)) {
  fail("provenance is invalid");
}
const actualSha256 = createHash("sha256").update(contractText).digest("hex");
if (actualSha256 !== provenance.artifactSha256) fail("artifact hash does not match provenance");

deepFreeze(contract);
deepFreeze(provenance);

export const MONEY_MAKER_CONTRACT = contract;
export const MONEY_MAKER_CONTRACT_PROVENANCE = provenance;
export const BOT_CONFIG_MIRROR_SOURCE = contract.source;
export const BOT_CONFIG_CONTRACT_VERSION = contract.version;
export const ALLOWED_BOT_STRATEGY_IDS = contract.strategyIds;
export const ALLOWED_BOT_BUDGETS_USD = contract.selectableBudgetsUsd;
export const ALLOWED_BOT_RUN_MODES = contract.runModes;
export const DISABLED_BOT_RUN_MODES = contract.disabledRunModes;
export const ALLOWED_BOT_MARKETS = contract.markets;
export const ALLOWED_BOT_INSTRUMENT_CLASSES = contract.instrumentClasses;
export const ALLOWED_BOT_CADENCES = contract.cadences;
export const MIN_BOT_EVALUATION_INTERVAL_MINUTES = contract.minimumEvaluationIntervalMinutes;
export const MAX_BOT_DECISIONS_PER_DAY = contract.maxDecisionsPerDay;
export const BOT_RUN_MODE_POLICY = contract.runModePolicy;
export const BOT_MARKET_INSTRUMENT_CLASS_RULES = contract.marketInstrumentClassRules;
export const BOT_STRATEGY_CONFIG_RULES = contract.strategyRules;
