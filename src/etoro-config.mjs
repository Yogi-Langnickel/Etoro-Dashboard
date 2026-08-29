import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_ETORO_BASE_URL = "https://public-api.etoro.com";
const ALLOWED_ETORO_HOSTS = new Set(["public-api.etoro.com"]);
export const DEFAULT_CREDENTIALS_FILE = join(homedir(), ".config", "etoro", "credentials.json");
export const DEFAULT_READ_CACHE_TTL_MS = 15_000;
export const MAX_READ_CACHE_TTL_MS = 300_000;
export const ETORO_ENVIRONMENTS = Object.freeze(["real", "demo"]);

export class EtoroConfigError extends Error {
  constructor(message, options = {}) { super(message); this.name = "EtoroConfigError"; this.code = options.code ?? "ETORO_CONFIG_ERROR"; }
}

function optionalTrim(value) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function profileEnvironment(value) { return ETORO_ENVIRONMENTS.includes(value) ? value : null; }
function parseBaseUrl(value) {
  const candidate = optionalTrim(value) ?? DEFAULT_ETORO_BASE_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !ALLOWED_ETORO_HOSTS.has(url.hostname) || url.username || url.password || url.pathname.replace(/\/+$/, "") || url.search || url.hash) throw new Error("unsupported");
    return url.origin;
  } catch { throw new EtoroConfigError("Invalid eToro API base URL", { code: "ETORO_INVALID_BASE_URL" }); }
}
function parsePositiveInteger(value, fallback, fieldName, maximum = Number.MAX_SAFE_INTEGER) {
  const trimmed = optionalTrim(value); if (!trimmed) return fallback; const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) throw new EtoroConfigError(`${fieldName} must be a positive integer no greater than ${maximum}`, { code: "ETORO_INVALID_CACHE_TTL" });
  return parsed;
}
async function readCredentialFile(credentialsFile, readFileImpl) {
  try {
    const parsed = JSON.parse(await readFileImpl(credentialsFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new EtoroConfigError("Credential file must contain a JSON object", { code: "ETORO_INVALID_CREDENTIAL_FILE" });
    return { parsed, loaded: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { parsed: {}, loaded: false };
    if (error instanceof EtoroConfigError) throw error;
    if (error instanceof SyntaxError) throw new EtoroConfigError("Credential file contains invalid JSON", { code: "ETORO_INVALID_CREDENTIAL_JSON" });
    throw new EtoroConfigError("Unable to read eToro credential file", { code: "ETORO_CREDENTIAL_FILE_READ_FAILED" });
  }
}
async function verifyCredentialPermissions(credentialsFile, statImpl) {
  const [file, directory] = await Promise.all([statImpl(credentialsFile), statImpl(dirname(credentialsFile))]);
  if (((file.mode & 0o777) !== 0o600) || ((directory.mode & 0o777) !== 0o700)) {
    throw new EtoroConfigError("Credential file and directory must be owner-only", { code: "ETORO_CREDENTIAL_PERMISSIONS" });
  }
}
function normalizeProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const apiKey = optionalTrim(value.publicApiKey ?? value.apiKey); const userKey = optionalTrim(value.userKey);
  if (!apiKey && !userKey) return null;
  return { apiKey, userKey, configured: Boolean(apiKey && userKey), missing: [apiKey ? null : "publicApiKey", userKey ? null : "userKey"].filter(Boolean) };
}
function publicProfileStatus(profile) { return { state: !profile || !profile.configured ? "not-configured" : "configured-unverified", configured: Boolean(profile?.configured), missing: profile ? [...profile.missing] : ["publicApiKey", "userKey"] }; }

export async function loadEtoroConfig(options = {}) {
  const env = options.env ?? process.env; const readFileImpl = options.readFile ?? readFile;
  const credentialsFile = optionalTrim(env.ETORO_CREDENTIALS_FILE) ?? DEFAULT_CREDENTIALS_FILE;
  const { parsed: fileConfig, loaded: credentialFileLoaded } = await readCredentialFile(credentialsFile, readFileImpl);
  if (credentialFileLoaded) {
    const statImpl = options.stat ?? (options.readFile
      ? async (path) => ({ mode: path === credentialsFile ? 0o100600 : 0o040700 })
      : stat);
    await verifyCredentialPermissions(credentialsFile, statImpl);
  }
  const hasNamedProfiles = fileConfig.profiles && typeof fileConfig.profiles === "object" && !Array.isArray(fileConfig.profiles);
  const fileProfiles = hasNamedProfiles ? fileConfig.profiles : {};
  const legacyProfile = normalizeProfile(fileConfig);
  const profiles = Object.fromEntries(ETORO_ENVIRONMENTS.map((environment) => [environment, normalizeProfile(fileProfiles[environment])]));
  const defaultEnvironment = profileEnvironment(optionalTrim(env.ETORO_DEFAULT_ENVIRONMENT) ?? fileConfig.defaultEnvironment ?? "real");
  if (!defaultEnvironment) throw new EtoroConfigError("Default environment must be real or demo", { code: "ETORO_INVALID_DEFAULT_ENVIRONMENT" });
  const selected = profiles[defaultEnvironment];
  return { baseUrl: parseBaseUrl(env.ETORO_API_BASE_URL ?? fileConfig.baseUrl), defaultEnvironment, profiles, legacyProfilePresent: Boolean(legacyProfile), configured: Boolean(selected?.configured), readCacheTtlMs: parsePositiveInteger(env.ETORO_READ_CACHE_TTL_MS ?? fileConfig.readCacheTtlMs, DEFAULT_READ_CACHE_TTL_MS, "Read cache TTL", MAX_READ_CACHE_TTL_MS), demoTradePreviewEnabled: String(env.ENABLE_DEMO_TRADE_PREVIEW ?? fileConfig.enableDemoTradePreview ?? "").toLowerCase() === "true", credentialsFile, credentialFileLoaded, credentialSource: credentialFileLoaded ? "file" : "none", missing: selected?.missing ?? ["publicApiKey", "userKey"] };
}

export function credentialsForEnvironment(config, environment) {
  if (!ETORO_ENVIRONMENTS.includes(environment)) throw new EtoroConfigError("Requested eToro environment is invalid", { code: "ETORO_INVALID_ENVIRONMENT" });
  const profile = config?.profiles?.[environment];
  if (!profile?.configured) throw new EtoroConfigError(`${environment === "demo" ? "Demo" : "Real"} is not configured`, { code: "ETORO_PROFILE_NOT_CONFIGURED" });
  return { baseUrl: config.baseUrl, apiKey: profile.apiKey, userKey: profile.userKey, environment, readCacheTtlMs: config.readCacheTtlMs, credentialSource: `profile:${environment}`, credentialFileLoaded: Boolean(config.credentialFileLoaded) };
}
export function publicCredentialStatus(config) {
  return { configured: Boolean(config.configured), defaultEnvironment: config.defaultEnvironment, profiles: Object.fromEntries(ETORO_ENVIRONMENTS.map((environment) => [environment, publicProfileStatus(config.profiles?.[environment])])), readCacheTtlMs: config.readCacheTtlMs, demoTradePreviewEnabled: Boolean(config.demoTradePreviewEnabled), credentialPosture: "server-only-named-profiles", providerHostPolicy: "official-host-allow-list", providerEndpointDetails: "server-only" };
}
function parseLegacyEnv(contents) { const values = new Map(); for (const line of contents.split(/\r?\n/)) { const match = line.match(/^(ETORO_DASHBOARD_PUBLIC_KEY|ETORO_DASHBOARD_PRIVAT_KEY)=(.*)$/); if (match) values.set(match[1], match[2]); } return { publicApiKey: values.get("ETORO_DASHBOARD_PUBLIC_KEY"), userKey: values.get("ETORO_DASHBOARD_PRIVAT_KEY") }; }
/** Value-blind migration. Call removeSource only after live normal-server validation succeeds. */
export async function migrateLegacyRealProfile({ sourceFile, credentialsFile = DEFAULT_CREDENTIALS_FILE, readFileImpl = readFile, statImpl = stat, mkdirImpl = mkdir, writeFileImpl = writeFile, renameImpl = rename, chmodImpl = chmod, unlinkImpl = unlink } = {}) {
  if (!sourceFile) throw new EtoroConfigError("A legacy credential source is required", { code: "ETORO_MIGRATION_SOURCE_REQUIRED" });
  if (((await statImpl(sourceFile)).mode & 0o077) !== 0) throw new EtoroConfigError("Legacy credential source must be owner-only", { code: "ETORO_MIGRATION_SOURCE_PERMISSIONS" });
  const legacy = parseLegacyEnv(await readFileImpl(sourceFile, "utf8"));
  if (!legacy.publicApiKey || !legacy.userKey) throw new EtoroConfigError("Legacy credential source is incomplete", { code: "ETORO_MIGRATION_SOURCE_INVALID" });
  await mkdirImpl(dirname(credentialsFile), { recursive: true, mode: 0o700 }); await chmodImpl(dirname(credentialsFile), 0o700);
  let existing = {}; try { existing = JSON.parse(await readFileImpl(credentialsFile, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw new EtoroConfigError("Credential destination is unreadable", { code: "ETORO_MIGRATION_DESTINATION_INVALID" }); }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new EtoroConfigError("Credential destination is invalid", { code: "ETORO_MIGRATION_DESTINATION_INVALID" });
  const existingReal = normalizeProfile(existing.profiles?.real);
  if (existingReal?.configured && (existingReal.apiKey !== legacy.publicApiKey || existingReal.userKey !== legacy.userKey)) throw new EtoroConfigError("Existing Real profile differs and was preserved", { code: "ETORO_MIGRATION_PROFILE_CONFLICT" });
  const next = { ...existing, baseUrl: existing.baseUrl ?? DEFAULT_ETORO_BASE_URL, defaultEnvironment: existing.defaultEnvironment ?? "real", profiles: { ...(existing.profiles ?? {}), real: { publicApiKey: legacy.publicApiKey, userKey: legacy.userKey } } };
  const tempFile = `${credentialsFile}.tmp-${process.pid}`; await writeFileImpl(tempFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 }); await chmodImpl(tempFile, 0o600); await renameImpl(tempFile, credentialsFile); await chmodImpl(credentialsFile, 0o600);
  const copied = normalizeProfile(JSON.parse(await readFileImpl(credentialsFile, "utf8")).profiles?.real);
  const [destinationFile, destinationDirectory] = await Promise.all([
    statImpl(credentialsFile),
    statImpl(dirname(credentialsFile)),
  ]);
  if (!copied?.configured || copied.apiKey !== legacy.publicApiKey || copied.userKey !== legacy.userKey ||
    ((destinationFile.mode & 0o777) !== 0o600) || ((destinationDirectory.mode & 0o777) !== 0o700)) {
    throw new EtoroConfigError("Secure Real profile verification failed", { code: "ETORO_MIGRATION_VERIFY_FAILED" });
  }
  return { migrated: !existingReal, sourceRetained: true, credentialsFile, permissionsVerified: true, valuesComparedInsideProcess: true, removeSource: async () => { await unlinkImpl(sourceFile); return { removed: true }; } };
}
