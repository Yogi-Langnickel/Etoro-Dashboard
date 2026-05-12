import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_ETORO_BASE_URL = "https://public-api.etoro.com";
export const ALLOWED_ETORO_HOSTS = new Set(["public-api.etoro.com"]);
export const DEFAULT_CREDENTIALS_FILE = join(homedir(), ".config", "etoro", "credentials.json");
export const DEFAULT_READ_CACHE_TTL_MS = 15_000;

export class EtoroConfigError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "EtoroConfigError";
    this.code = options.code ?? "ETORO_CONFIG_ERROR";
  }
}

function optionalTrim(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseBaseUrl(value) {
  const candidate = optionalTrim(value) ?? DEFAULT_ETORO_BASE_URL;

  try {
    const url = new URL(candidate);

    if (url.protocol !== "https:" || !ALLOWED_ETORO_HOSTS.has(url.hostname)) {
      throw new Error("Unsupported URL protocol");
    }

    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new EtoroConfigError("Invalid eToro API base URL", {
      code: "ETORO_INVALID_BASE_URL",
    });
  }
}

async function readCredentialFile(credentialsFile, readFileImpl) {
  try {
    const fileContents = await readFileImpl(credentialsFile, "utf8");
    const parsed = JSON.parse(fileContents);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new EtoroConfigError("Credential file must contain a JSON object", {
        code: "ETORO_INVALID_CREDENTIAL_FILE",
      });
    }

    return { parsed, loaded: true };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { parsed: {}, loaded: false };
    }

    if (error instanceof EtoroConfigError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new EtoroConfigError("Credential file contains invalid JSON", {
        code: "ETORO_INVALID_CREDENTIAL_JSON",
      });
    }

    throw new EtoroConfigError("Unable to read eToro credential file", {
      code: "ETORO_CREDENTIAL_FILE_READ_FAILED",
    });
  }
}

function credentialSource({ envApiKey, envUserKey, fileApiKey, fileUserKey }) {
  const hasEnv = Boolean(envApiKey || envUserKey);
  const hasFile = Boolean(fileApiKey || fileUserKey);

  if (hasEnv && hasFile) {
    return "mixed";
  }

  if (hasEnv) {
    return "environment";
  }

  if (hasFile) {
    return "file";
  }

  return "none";
}

function parseBooleanFlag(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function parsePositiveInteger(value, fallback, fieldName) {
  const trimmed = optionalTrim(value);

  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EtoroConfigError(`${fieldName} must be a positive integer`, {
      code: "ETORO_INVALID_CACHE_TTL",
    });
  }

  return parsed;
}

export async function loadEtoroConfig(options = {}) {
  const env = options.env ?? process.env;
  const readFileImpl = options.readFile ?? readFile;
  const credentialsFile = optionalTrim(env.ETORO_CREDENTIALS_FILE) ?? DEFAULT_CREDENTIALS_FILE;
  const { parsed: fileConfig, loaded: credentialFileLoaded } = await readCredentialFile(
    credentialsFile,
    readFileImpl,
  );

  const envApiKey = optionalTrim(env.ETORO_API_KEY);
  const envUserKey = optionalTrim(env.ETORO_USER_KEY);
  const fileApiKey = optionalTrim(fileConfig.apiKey ?? fileConfig.publicApiKey);
  const fileUserKey = optionalTrim(fileConfig.userKey);
  const apiKey = envApiKey ?? fileApiKey;
  const userKey = envUserKey ?? fileUserKey;
  const baseUrl = parseBaseUrl(env.ETORO_API_BASE_URL ?? fileConfig.baseUrl);
  const missing = [];

  if (!apiKey) {
    missing.push("apiKey");
  }

  if (!userKey) {
    missing.push("userKey");
  }

  return {
    baseUrl,
    apiKey,
    userKey,
    configured: missing.length === 0,
    readCacheTtlMs: parsePositiveInteger(
      env.ETORO_READ_CACHE_TTL_MS ?? fileConfig.readCacheTtlMs,
      DEFAULT_READ_CACHE_TTL_MS,
      "Read cache TTL",
    ),
    demoTradePreviewEnabled: parseBooleanFlag(
      env.ENABLE_DEMO_TRADE_PREVIEW ?? fileConfig.enableDemoTradePreview,
    ),
    credentialsFile,
    credentialFileLoaded,
    credentialSource: credentialSource({ envApiKey, envUserKey, fileApiKey, fileUserKey }),
    missing,
  };
}

export function publicCredentialStatus(config) {
  return {
    baseUrl: config.baseUrl,
    configured: config.configured,
    demoTradePreviewEnabled: Boolean(config.demoTradePreviewEnabled),
    readCacheTtlMs: config.readCacheTtlMs,
    credentialFileLoaded: config.credentialFileLoaded,
    credentialSource: config.credentialSource,
    missing: [...config.missing],
  };
}
