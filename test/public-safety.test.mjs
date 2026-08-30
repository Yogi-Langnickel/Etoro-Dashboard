import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectPublicSafetyEntries,
  loadTrackedEntries,
  readRegularFileWithoutFollowingSymlink,
} from "../scripts/check-public-safety.mjs";

test("public safety check detects tracked secret and private-account risks", () => {
  const findings = inspectPublicSafetyEntries([
    { path: ".env.production", content: "ETORO_API_KEY=YOUR_DEMO_READ_API_KEY" },
    { path: ".env.example", content: "ETORO_USER_KEY=livecredentialvalue123456" },
    { path: "exports/demo-portfolio.csv", content: "symbol,value\nAAPL,100" },
    { path: "demo-portfolio.json", content: JSON.stringify({ source: "synthetic" }) },
    {
      path: "src/unsafe-example.mjs",
      content: ['const api', 'Key = "livecredentialvalue123456";'].join(""),
    },
    {
      path: "src/unsafe-snake-case.mjs",
      content: ['const api_', 'key = "anotherlivecredential123456";'].join(""),
    },
    {
      path: "docs/private.pem",
      content: ["-----BEGIN PRI", "VATE KEY-----"].join(""),
    },
  ]);

  assert.deepEqual(
    findings.map((finding) => finding.reason),
    [
      "environment file",
      "literal ETORO_USER_KEY credential",
      "private artifact directory",
      "private account/portfolio artifact",
      "literal apiKey credential",
      "literal api_key credential",
      "private key material",
      "private key content",
    ],
  );
});

test("public safety check permits documented placeholders and synthetic fixtures", () => {
  const findings = inspectPublicSafetyEntries([
    { path: ".env.example", content: "ETORO_API_KEY=YOUR_DEMO_READ_API_KEY" },
    { path: "test/client.test.mjs", content: 'const credentials = { apiKey: "test-api-secret", userKey: "server-user-secret" };' },
    {
      path: "test/fixtures/synthetic/demo-portfolio.json",
      content: JSON.stringify({ accountId: "synthetic-account-1", positions: [{ positionId: 1 }] }),
    },
  ]);

  assert.deepEqual(findings, []);
});

test("synthetic content outside the explicit fixture area remains blocked by path policy", () => {
  const findings = inspectPublicSafetyEntries([
    {
      path: "reports/private/synthetic-portfolio.json",
      content: JSON.stringify({ source: "synthetic" }),
    },
  ]);

  assert.deepEqual(findings.map((finding) => finding.reason), ["secret/private directory"]);
});

test("synthetic marker substrings do not excuse otherwise literal credentials", () => {
  const findings = inspectPublicSafetyEntries([
    {
      path: "src/config.mjs",
      content: ['const access', 'Token = "contest-live-credential-123456";'].join(""),
    },
  ]);

  assert.deepEqual(findings.map((finding) => finding.reason), [
    "literal accessToken credential",
  ]);
});

test("production Portfolio View scan rejects fixture markers, rows, charts, request ids, and plausible values", () => {
  const markers = [
    'const portfolioChartPoints = {};',
    'const mock = "mock-read-1";',
    'const symbol = "SPY";',
    '<tr data-instrument-row data-symbol="AAPL">',
    '<polyline id="performance-line" points="1,2 3,4">',
    '<span>$124,580.00</span>',
    'const requestId = "provider-request-123";',
  ];
  for (const content of markers) {
    const findings = inspectPublicSafetyEntries([{ path: "src/index.html", content }]);
    assert.deepEqual(findings.map((finding) => finding.reason), [
      "production Portfolio View fixture or plausible hard-coded portfolio value",
    ]);
  }
});

test("unreviewed oversized and binary files fail closed", () => {
  const findings = inspectPublicSafetyEntries([
    { path: "docs/large.txt", content: "x".repeat(2 * 1024 * 1024 + 1) },
    { path: "docs/screenshot.png", content: Buffer.from([0, 1, 2, 3]) },
    { path: "docs/screenshot-without-nul.jpg", content: Buffer.from("compressed-image") },
    {
      path: "docs/designs/2026-06-02-portfolio-bot-tabs/desktop-preview.png",
      content: Buffer.from([0, 1, 2, 3]),
    },
  ]);

  assert.deepEqual(findings.map((finding) => finding.reason), [
    "file exceeds public-safety scan limit",
    "binary file requires explicit public-safety review",
    "binary file requires explicit public-safety review",
    "binary file requires explicit public-safety review",
  ]);
});

test("repository loading includes untracked non-ignored files before commit", async () => {
  const repository = await mkdtemp(join(tmpdir(), "etoro-public-safety-"));

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(
      join(repository, "new-config.mjs"),
      ['const client', 'Secret = "untracked-live-credential-123456";'].join(""),
    );

    const entries = await loadTrackedEntries({ cwd: repository });
    assert.deepEqual(entries.map((entry) => entry.path), ["new-config.mjs"]);
    assert.deepEqual(
      inspectPublicSafetyEntries(entries).map((finding) => finding.reason),
      ["literal clientSecret credential"],
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("repository loading inspects staged content when the worktree version differs", async () => {
  const repository = await mkdtemp(join(tmpdir(), "etoro-public-safety-index-"));

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    const configPath = join(repository, "config.mjs");
    await writeFile(
      configPath,
      ['const refresh', 'Token = "staged-live-credential-123456";'].join(""),
    );
    execFileSync("git", ["add", "config.mjs"], { cwd: repository });
    await writeFile(configPath, 'const refreshToken = "test-refresh-token";');

    const entries = await loadTrackedEntries({ cwd: repository });
    assert.equal(entries.filter((entry) => entry.path === "config.mjs").length, 2);
    assert.deepEqual(
      inspectPublicSafetyEntries(entries).map((finding) => finding.reason),
      ["literal refreshToken credential"],
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("repository loading inspects tracked symlink text without dereferencing a missing target", async () => {
  const repository = await mkdtemp(join(tmpdir(), "etoro-public-safety-symlink-"));

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    await symlink(
      "ETORO_API_KEY=tracked-live-credential-123456",
      join(repository, "compatibility-link.md"),
    );
    execFileSync("git", ["add", "compatibility-link.md"], { cwd: repository });

    const entries = await loadTrackedEntries({ cwd: repository });
    assert.deepEqual(entries.map((entry) => entry.path), ["compatibility-link.md"]);
    assert.equal(
      entries[0].content.toString("utf8"),
      "ETORO_API_KEY=tracked-live-credential-123456",
    );
    assert.deepEqual(
      inspectPublicSafetyEntries(entries).map((finding) => finding.reason),
      ["literal ETORO_API_KEY credential"],
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("regular file loader refuses to follow a symbolic link", async () => {
  const repository = await mkdtemp(join(tmpdir(), "etoro-public-safety-no-follow-"));

  try {
    const linkPath = join(repository, "swapped-link.md");
    await symlink("missing-external-target", linkPath);

    await assert.rejects(
      () => readRegularFileWithoutFollowingSymlink(linkPath),
      (error) => error?.code === "ELOOP",
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("repository loading reads Git filenames containing URL delimiters literally", async () => {
  const repository = await mkdtemp(join(tmpdir(), "etoro-public-safety-delimiters-"));

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    await writeFile(
      join(repository, "cover#credential.mjs"),
      ['const access', 'Token = "credential-from-hash-filename-123456";'].join(""),
    );
    await writeFile(
      join(repository, "cover?credential.mjs"),
      ['const refresh', 'Token = "credential-from-query-filename-123456";'].join(""),
    );
    execFileSync("git", ["add", "cover#credential.mjs", "cover?credential.mjs"], { cwd: repository });

    const entries = await loadTrackedEntries({ cwd: repository });
    assert.deepEqual(entries.map((entry) => entry.path), [
      "cover#credential.mjs",
      "cover?credential.mjs",
    ]);
    assert.deepEqual(
      inspectPublicSafetyEntries(entries).map((finding) => finding.reason),
      ["literal accessToken credential", "literal refreshToken credential"],
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("repository loading rejects a symbolic-link ancestor before reading external content", async () => {
  const repository = await mkdtemp(join(tmpdir(), "etoro-public-safety-parent-"));
  const externalDirectory = await mkdtemp(join(tmpdir(), "etoro-public-safety-external-"));

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    await mkdir(join(repository, "nested"));
    await writeFile(join(repository, "nested", "config.mjs"), "export const safe = true;");
    execFileSync("git", ["add", "nested/config.mjs"], { cwd: repository });
    await writeFile(
      join(externalDirectory, "config.mjs"),
      ['const client', 'Secret = "external-credential-value-123456";'].join(""),
    );
    await rm(join(repository, "nested"), { recursive: true, force: true });
    await symlink(externalDirectory, join(repository, "nested"), "dir");

    await assert.rejects(
      () => loadTrackedEntries({ cwd: repository }),
      /symbolic-link ancestor/,
    );
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(externalDirectory, { recursive: true, force: true });
  }
});
