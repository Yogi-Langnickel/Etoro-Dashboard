import { DEFAULT_READ_CACHE_TTL_MS } from "./etoro-config.mjs";

export const DEFAULT_PROVIDER_FAILURE_BACKOFF_MS = 5_000;
const MAX_PROVIDER_RETRY_AFTER_MS = 60_000;

// Server-only failure metadata survives a stale read without extending the
// browser cache DTO. JSON serialization intentionally omits symbol properties.
export const PROVIDER_CACHE_FAILURE = Symbol("provider-cache-failure");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function redactProviderErrorMessage(message, config = {}) {
  let redacted = String(message ?? "");
  const replacements = [
    config.apiKey,
    config.userKey,
    "x-api-key",
    "x-user-key",
    "authorization",
    "api-key",
    "user-key",
  ].filter(Boolean);

  for (const value of replacements) {
    redacted = redacted.replaceAll(String(value), "[redacted]");
  }

  return redacted;
}

export function publicProviderErrorMessage(error) {
  if (error?.code === "ETORO_TIMEOUT") return "eToro provider request timed out.";
  if (error?.status === 429) return "eToro provider rate limit is temporarily backing off.";
  if (error?.status >= 500) return "eToro provider is temporarily unavailable.";
  return "eToro provider request failed.";
}

function readOnlyCacheKey(endpointName, config) {
  return [
    endpointName,
    config.baseUrl,
    config.credentialSource,
    config.environment ?? "no-environment",
    config.credentialFileLoaded ? "file" : "no-file",
    config.credentialGeneration ?? "credential-generation-unavailable",
  ].join("|");
}

function withCacheMetadata(result, cacheState, entry) {
  return {
    ...cloneJson(result),
    ...(cacheState === "stale" && entry.error ? {
      [PROVIDER_CACHE_FAILURE]: { code: entry.error.code, status: entry.error.status },
    } : {}),
    cache: {
      state: cacheState,
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt,
      ttlMs: entry.ttlMs,
      ...(entry.retryAt ? { retryAt: entry.retryAt, failureAt: entry.failureAt } : {}),
    },
  };
}

function providerFailureBackoffEligible(error) {
  return error?.code === "ETORO_TIMEOUT" || error?.status === 429 || error?.status >= 500;
}

function serializeProviderError(error, config) {
  return {
    code: error?.code ?? "ETORO_PROVIDER_UNAVAILABLE",
    message: publicProviderErrorMessage(error),
    redactedDetail: redactProviderErrorMessage(error?.message, config),
    status: error?.status ?? undefined,
    retryAfterMs: Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : undefined,
  };
}

function providerErrorWithCacheMetadata(serializedError, cacheState, entry) {
  const error = new Error(serializedError.message);
  error.code = serializedError.code;
  error.status = serializedError.status;
  error.cache = {
    state: cacheState,
    cachedAt: entry.cachedAt,
    expiresAt: entry.expiresAt,
    ttlMs: entry.ttlMs,
    retryAt: entry.retryAt,
    failureAt: entry.failureAt,
    reason: serializedError.code,
  };
  return error;
}

function publicProviderError(error, config) {
  const serializedError = serializeProviderError(error, config);
  const publicError = new Error(serializedError.message);
  publicError.code = serializedError.code;
  publicError.status = serializedError.status;
  return publicError;
}

function resolveCacheTtlMs(ttlMs, config) {
  return typeof ttlMs === "function" ? ttlMs(config) : ttlMs;
}

export function createReadOnlyProviderCache({
  ttlMs = DEFAULT_READ_CACHE_TTL_MS,
  failureBackoffMs = DEFAULT_PROVIDER_FAILURE_BACKOFF_MS,
  now = Date.now,
} = {}) {
  const entries = new Map();

  return {
    async fetch(endpointName, config, fetchEndpoint) {
      const key = readOnlyCacheKey(endpointName, config);
      const nowMs = now();
      const resolvedTtlMs = resolveCacheTtlMs(ttlMs, config);
      const resolvedFailureBackoffMs = resolveCacheTtlMs(failureBackoffMs, config);
      const existing = entries.get(key);

      if (existing?.value && !existing.error && existing.expiresAtMs > nowMs) {
        return withCacheMetadata(existing.value, "hit", existing);
      }
      if (existing?.error && existing.retryAtMs > nowMs) {
        if (existing.lastGood) return withCacheMetadata(existing.lastGood, "stale", existing);
        throw providerErrorWithCacheMetadata(existing.error, "backoff", existing);
      }
      if (existing?.inflight) {
        const value = await existing.inflight;
        const updated = entries.get(key);
        if (value?.cache?.state === "stale") {
          return value;
        }
        return withCacheMetadata(value, "coalesced", updated);
      }

      const entry = {
        cachedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + resolvedTtlMs).toISOString(),
        expiresAtMs: nowMs + resolvedTtlMs,
        ttlMs: resolvedTtlMs,
        lastGood: existing?.value ?? existing?.lastGood,
        lastGoodMetadata: existing?.lastGoodMetadata ?? (existing?.value ? { cachedAt: existing.cachedAt, expiresAt: existing.expiresAt, expiresAtMs: existing.expiresAtMs, ttlMs: existing.ttlMs } : null),
      };

      entry.inflight = fetchEndpoint(endpointName, { credentials: config })
        .then((value) => {
          const cachedAtMs = now();
          entry.value = cloneJson(value);
          entry.lastGood = entry.value;
          entry.cachedAt = new Date(cachedAtMs).toISOString();
          entry.expiresAtMs = cachedAtMs + resolvedTtlMs;
          entry.expiresAt = new Date(entry.expiresAtMs).toISOString();
          entry.lastGoodMetadata = { cachedAt: entry.cachedAt, expiresAt: entry.expiresAt, expiresAtMs: entry.expiresAtMs, ttlMs: entry.ttlMs };
          delete entry.inflight;
          entries.set(key, entry);
          return entry.value;
        })
        .catch((error) => {
          if (!providerFailureBackoffEligible(error) || resolvedFailureBackoffMs <= 0) {
            entries.delete(key);
            throw publicProviderError(error, config);
          }

          const backoffStartedAt = now();
          const providerBackoffMs = Number.isFinite(error?.retryAfterMs)
            ? Math.min(MAX_PROVIDER_RETRY_AFTER_MS, Math.max(0, error.retryAfterMs))
            : 0;
          const effectiveBackoffMs = Math.max(resolvedFailureBackoffMs, providerBackoffMs);
          entry.error = serializeProviderError(error, config);
          entry.failureAt = new Date(backoffStartedAt).toISOString();
          entry.retryAtMs = backoffStartedAt + effectiveBackoffMs;
          entry.retryAt = new Date(entry.retryAtMs).toISOString();
          if (entry.lastGoodMetadata) Object.assign(entry, entry.lastGoodMetadata);
          else { entry.cachedAt = null; entry.expiresAt = null; entry.expiresAtMs = 0; entry.ttlMs = resolvedTtlMs; }
          delete entry.inflight;
          entries.set(key, entry);
          if (entry.lastGood) {
            return withCacheMetadata(entry.lastGood, "stale", entry);
          }
          throw providerErrorWithCacheMetadata(entry.error, "error", entry);
        });

      entries.set(key, entry);
      const value = await entry.inflight;
      if (value?.cache?.state === "stale") {
        return value;
      }
      return withCacheMetadata(value, "miss", entry);
    },
  };
}
