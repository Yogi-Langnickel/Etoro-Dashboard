import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ETORO_BASE_URL,
  DEFAULT_READ_CACHE_TTL_MS,
  MAX_READ_CACHE_TTL_MS,
  EtoroConfigError,
  credentialsForEnvironment,
  loadEtoroConfig,
  migrateLegacyRealProfile,
  publicCredentialStatus,
} from "../src/etoro-config.mjs";

test("loads credentials from the configured JSON file", async () => {
  const config = await loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/tmp/credentials.json" },
    readFile: async () =>
      JSON.stringify({
        baseUrl: "https://public-api.etoro.com/",
        defaultEnvironment: "demo",
        profiles: { demo: { publicApiKey: "file-api-key", userKey: "file-user-key" } },
      }),
  });

  assert.equal(config.configured, true);
  assert.equal(config.baseUrl, DEFAULT_ETORO_BASE_URL);
  assert.equal(config.readCacheTtlMs, DEFAULT_READ_CACHE_TTL_MS);
  assert.equal(config.credentialSource, "file");
});

test("named profiles remain independent and no legacy root profile is guessed as Demo", async () => {
  const config = await loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/tmp/credentials.json" },
    readFile: async () => JSON.stringify({
      apiKey: "test-api-key",
      userKey: "test-user-key",
      defaultEnvironment: "real",
      profiles: { real: { publicApiKey: "test-api-key-two", userKey: "test-user-key-two" } },
    }),
  });
  assert.equal(config.configured, true);
  assert.equal(config.legacyProfilePresent, true);
  assert.equal(config.profiles.demo, null);
  assert.equal(credentialsForEnvironment(config, "real").environment, "real");
  assert.throws(() => credentialsForEnvironment(config, "demo"), (error) => error.code === "ETORO_PROFILE_NOT_CONFIGURED");
});

test("flat legacy credential files are preserved but not selected as an environment", async () => {
  const config = await loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/tmp/credentials.json" },
    readFile: async () => JSON.stringify({ apiKey: "test-api-key", userKey: "test-user-key" }),
  });
  assert.equal(config.legacyProfilePresent, true);
  assert.equal(config.configured, false);
  assert.equal(config.profiles.real, null);
  assert.equal(config.profiles.demo, null);
});

test("rejects credential files or parent directories that are not owner-only", async () => {
  const namedFile = JSON.stringify({ profiles: { real: { publicApiKey: "test-api-key", userKey: "test-user-key" } } });
  await assert.rejects(loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/tmp/credentials.json" }, readFile: async () => namedFile,
    stat: async (path) => ({ mode: path.endsWith("credentials.json") ? 0o100644 : 0o040700 }),
  }), (error) => error.code === "ETORO_CREDENTIAL_PERMISSIONS");
  await assert.rejects(loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/tmp/credentials.json" }, readFile: async () => namedFile,
    stat: async (path) => ({ mode: path.endsWith("credentials.json") ? 0o100600 : 0o040755 }),
  }), (error) => error.code === "ETORO_CREDENTIAL_PERMISSIONS");
});

test("value-blind migration preserves a differing Real profile and does not write", async () => {
  let wrote = false;
  await assert.rejects(migrateLegacyRealProfile({
    sourceFile: "/legacy/.env.real",
    credentialsFile: "/target/credentials.json",
    statImpl: async (path) => ({ mode: path === "/target" ? 0o040700 : 0o100600 }),
    mkdirImpl: async () => {}, chmodImpl: async () => {}, renameImpl: async () => {}, unlinkImpl: async () => {}, writeFileImpl: async () => { wrote = true; },
    readFileImpl: async (path) => path.includes("legacy")
      ? "ETORO_DASHBOARD_PUBLIC_KEY=test-public\nETORO_DASHBOARD_PRIVAT_KEY=test-user\n"
      : JSON.stringify({ profiles: { real: { publicApiKey: "test-api-key-two", userKey: "test-user-key-two" } } }),
  }), (error) => error.code === "ETORO_MIGRATION_PROFILE_CONFLICT");
  assert.equal(wrote, false);
});

test("value-blind migration copies only after owner-only checks and retains source until explicitly removed", async () => {
  let destination = null; let removed = false;
  const source = "ETORO_DASHBOARD_PUBLIC_KEY=test-public\nETORO_DASHBOARD_PRIVAT_KEY=test-user\n";
  const result = await migrateLegacyRealProfile({
    sourceFile: "/legacy/.env.real", credentialsFile: "/target/credentials.json",
    statImpl: async (path) => ({ mode: path === "/target" ? 0o040700 : 0o100600 }), mkdirImpl: async () => {}, chmodImpl: async () => {}, renameImpl: async () => {},
    writeFileImpl: async (_path, contents) => { destination = contents; },
    readFileImpl: async (path) => path.includes("legacy") ? source : destination ?? (() => { const error = new Error("missing"); error.code = "ENOENT"; throw error; })(),
    unlinkImpl: async () => { removed = true; },
  });
  assert.equal(result.sourceRetained, true);
  assert.equal(result.permissionsVerified, true);
  assert.equal(result.valuesComparedInsideProcess, true);
  assert.equal(removed, false);
  await result.removeSource();
  assert.equal(removed, true);
});

test("ambient generic credentials are ignored so they cannot cross environments", async () => {
  const config = await loadEtoroConfig({
    env: {
      ETORO_CREDENTIALS_FILE: "/tmp/credentials.json",
      ETORO_API_BASE_URL: "https://public-api.etoro.com",
      ETORO_API_KEY: "env-api-key",
      ETORO_USER_KEY: "env-user-key",
    },
    readFile: async () =>
      JSON.stringify({
        defaultEnvironment: "demo",
        profiles: { demo: { apiKey: "file-api-key", userKey: "file-user-key" } },
      }),
  });

  assert.equal(config.configured, true);
  const selected = credentialsForEnvironment(config, "demo");
  assert.equal(selected.apiKey, "file-api-key");
  assert.equal(selected.userKey, "file-user-key");
  assert.equal(selected.apiKey === "env-api-key", false);
});

test("public credential status excludes secret values", async () => {
  const config = await loadEtoroConfig({
    env: { ETORO_API_KEY: "test-api-key", ETORO_USER_KEY: "test-user-key" },
    readFile: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  });
  const status = publicCredentialStatus(config);
  const serialized = JSON.stringify(status);

  assert.equal(status.configured, false);
  assert.equal(status.providerHostPolicy, "official-host-allow-list");
  assert.equal(status.providerEndpointDetails, "server-only");
  assert.equal(status.baseUrl, undefined);
  assert.equal(serialized.includes("test-api-key"), false);
  assert.equal(serialized.includes("test-user-key"), false);
  assert.equal(serialized.includes("public-api.etoro.com"), false);
});

test("demo trade preview flag is explicit and public", async () => {
  const config = await loadEtoroConfig({
    env: {
      ETORO_API_KEY: "test-api-key",
      ETORO_USER_KEY: "test-user-key",
      ENABLE_DEMO_TRADE_PREVIEW: "true",
    },
    readFile: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(config.demoTradePreviewEnabled, true);
  assert.equal(publicCredentialStatus(config).demoTradePreviewEnabled, true);
});

test("read cache TTL is configurable without exposing secrets", async () => {
  const config = await loadEtoroConfig({
    env: {
      ETORO_API_KEY: "test-api-key",
      ETORO_USER_KEY: "test-user-key",
      ETORO_READ_CACHE_TTL_MS: "30000",
    },
    readFile: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  });

  assert.equal(config.readCacheTtlMs, 30_000);
  assert.equal(publicCredentialStatus(config).readCacheTtlMs, 30_000);
});

test("read cache TTL must be a positive integer", async () => {
  await assert.rejects(
    loadEtoroConfig({
      env: {
        ETORO_API_KEY: "test-api-key",
        ETORO_USER_KEY: "test-user-key",
        ETORO_READ_CACHE_TTL_MS: "0",
      },
      readFile: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error instanceof EtoroConfigError && error.code === "ETORO_INVALID_CACHE_TTL",
  );
});

test("read cache TTL cannot exceed the browser contract maximum", async () => {
  await assert.rejects(
    loadEtoroConfig({
      env: {
        ETORO_READ_CACHE_TTL_MS: String(MAX_READ_CACHE_TTL_MS + 1),
      },
      readFile: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error.code === "ETORO_INVALID_CACHE_TTL",
  );
});

test("rejects non-HTTPS provider base URLs", async () => {
  await assert.rejects(
    loadEtoroConfig({
      env: {
        ETORO_API_BASE_URL: "http://public-api.etoro.com",
        ETORO_API_KEY: "test-api-key",
        ETORO_USER_KEY: "test-user-key",
      },
      readFile: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error instanceof EtoroConfigError && error.code === "ETORO_INVALID_BASE_URL",
  );
});

test("rejects HTTPS provider base URLs outside the official host allow-list", async () => {
  await assert.rejects(
    loadEtoroConfig({
      env: {
        ETORO_API_BASE_URL: "https://example.com",
        ETORO_API_KEY: "test-api-key",
        ETORO_USER_KEY: "test-user-key",
      },
      readFile: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error instanceof EtoroConfigError && error.code === "ETORO_INVALID_BASE_URL",
  );
});
