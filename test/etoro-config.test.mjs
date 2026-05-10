import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ETORO_BASE_URL,
  EtoroConfigError,
  loadEtoroConfig,
  publicCredentialStatus,
} from "../src/etoro-config.mjs";

test("loads credentials from the configured JSON file", async () => {
  const config = await loadEtoroConfig({
    env: { ETORO_CREDENTIALS_FILE: "/tmp/credentials.json" },
    readFile: async () =>
      JSON.stringify({
        baseUrl: "https://public-api.etoro.com/",
        publicApiKey: "file-api-key",
        userKey: "file-user-key",
      }),
  });

  assert.equal(config.configured, true);
  assert.equal(config.baseUrl, DEFAULT_ETORO_BASE_URL);
  assert.equal(config.apiKey, "file-api-key");
  assert.equal(config.userKey, "file-user-key");
  assert.equal(config.credentialSource, "file");
});

test("environment credentials override file credentials when present", async () => {
  const config = await loadEtoroConfig({
    env: {
      ETORO_CREDENTIALS_FILE: "/tmp/credentials.json",
      ETORO_API_BASE_URL: "https://public-api.etoro.com",
      ETORO_API_KEY: "env-api-key",
      ETORO_USER_KEY: "env-user-key",
    },
    readFile: async () =>
      JSON.stringify({
        apiKey: "file-api-key",
        userKey: "file-user-key",
      }),
  });

  assert.equal(config.apiKey, "env-api-key");
  assert.equal(config.userKey, "env-user-key");
  assert.equal(config.credentialSource, "mixed");
});

test("public credential status excludes secret values", async () => {
  const config = await loadEtoroConfig({
    env: { ETORO_API_KEY: "secret-api-key", ETORO_USER_KEY: "secret-user-key" },
    readFile: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  });
  const status = publicCredentialStatus(config);
  const serialized = JSON.stringify(status);

  assert.equal(status.configured, true);
  assert.equal(serialized.includes("secret-api-key"), false);
  assert.equal(serialized.includes("secret-user-key"), false);
});

test("demo trade preview flag is explicit and public", async () => {
  const config = await loadEtoroConfig({
    env: {
      ETORO_API_KEY: "api-key",
      ETORO_USER_KEY: "user-key",
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

test("rejects non-HTTPS provider base URLs", async () => {
  await assert.rejects(
    loadEtoroConfig({
      env: {
        ETORO_API_BASE_URL: "http://public-api.etoro.com",
        ETORO_API_KEY: "api-key",
        ETORO_USER_KEY: "user-key",
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
        ETORO_API_KEY: "api-key",
        ETORO_USER_KEY: "user-key",
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
