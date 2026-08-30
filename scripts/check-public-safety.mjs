import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const SYNTHETIC_FIXTURE_PREFIX = "test/fixtures/synthetic/";
const MAX_SCANNED_FILE_BYTES = 2 * 1024 * 1024;
const REVIEW_REQUIRED_BINARY_EXTENSION = /\.(?:png|jpe?g|pdf|xlsx?)$/i;
const ALLOWED_BINARY_PUBLIC_ASSETS = new Map([
  ["docs/designs/2026-06-02-portfolio-bot-tabs/desktop-preview.png", "ea2dbedf1b16b071713aa5c3eba9f03ffbc4b0cb55e571ffddb4ef8ca311943b"],
  ["docs/designs/2026-06-02-portfolio-bot-tabs/full-page-desktop.png", "4a413b576ab6aa77177b44f05330f7aaa540ab1e550fa1207e6eebfe7ff22317"],
  ["docs/designs/2026-06-02-portfolio-bot-tabs/full-page-mobile.png", "07e5b6596d2d0f2e3a96aa2262cb0420fdc043084c602d2efd13723a5671733e"],
  ["docs/designs/2026-06-02-portfolio-bot-tabs/mobile-preview.png", "5f247c8ea1c8a1239b3f7fc6aa3f885a0048a0e3a63f9b6f451a262cd361577b"],
]);

const forbiddenTrackedPathPatterns = [
  { pattern: /(^|\/)\.env(?:\..+)?$/i, except: new Set([".env.example"]), reason: "environment file" },
  { pattern: /(^|\/)(?:secrets?|private)(\/|$)/i, reason: "secret/private directory" },
  { pattern: /(^|\/)(?:exports?|reports\/private|fixtures\/private|screenshots\/private)(\/|$)/i, reason: "private artifact directory" },
  { pattern: /(?:^|\/)(?:credentials?(?:\.[^/]+)?|[^/]+\.credentials)\.json$/i, reason: "credential file" },
  { pattern: /\.(?:pem|key|p12|pfx)$/i, reason: "private key material" },
  {
    pattern: /(?:^|\/)[^/]*(?:portfolio|holdings?|balances?|positions?|orders?|transactions?|brokerage[-_ ]?statement|account[-_ ]?(?:export|data))[^/]*\.(?:csv|json|xlsx?|pdf|png|jpe?g)$/i,
    reason: "private account/portfolio artifact",
  },
];

const highConfidenceSecretPatterns = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, reason: "private key content" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: "AWS access key" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, reason: "GitHub token" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, reason: "Slack token" },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, reason: "API token" },
];

const credentialLiteralPattern = /["']?((?:x[-_]?)?(?:public[-_]?)?api[-_]?key|(?:x[-_]?)?user[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)["']?\s*[:=]\s*["'`]([^"'`\r\n]+)["'`]/gi;
const credentialEnvironmentPattern = /^[ \t]*(ETORO_(?:API|USER)_KEY|(?:API|USER)_KEY|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN)[ \t]*=[ \t]*["']?([^"' \t\r\n#]*)["']?/gim;
const safeLiteralValues = new Set([
  "server-api-secret",
  "server-user-secret",
  "file-api-key",
  "file-user-key",
  "env-api-key",
  "env-user-key",
  "access-token",
]);
const safeLiteralPattern = /^(?:test|mock|fake|synthetic|example|placeholder|redacted)(?:[-_][a-z0-9_-]+)?$/i;
const placeholderLiteralPattern = /^your[-_][a-z0-9_-]+$/i;
const knownFixtureLiteralPattern = /^(?:server|file|env)-(?:api|user)-(?:secret|key)(?:-[a-z0-9_-]+)?$/i;
const productionPortfolioFixturePattern = /(?:portfolioChartPoints|portfolioEnrichmentReceipts|portfolioPeriodChanges|mock-read-|\b(?:SPY|NVDA|BTC|EURUSD)\b|Portfolio:\s*synthetic fixture|data-instrument-row[^>]+data-symbol=|performance-line"\s+points="[0-9]|\$[0-9][0-9,]*\.\d{2}|\brequest(?:-|_)?id\b\s*[:=])/i;

function normalizedPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSyntheticFixture(path) {
  return normalizedPath(path).startsWith(SYNTHETIC_FIXTURE_PREFIX);
}

function riskyPathReason(path) {
  const normalized = normalizedPath(path);

  if (isSyntheticFixture(normalized)) {
    return null;
  }

  for (const rule of forbiddenTrackedPathPatterns) {
    if (rule.pattern.test(normalized) && !rule.except?.has(normalized)) {
      return rule.reason;
    }
  }

  return null;
}

function isObviouslySyntheticLiteral(value) {
  const normalized = value.trim().toLowerCase();
  return safeLiteralValues.has(normalized)
    || safeLiteralPattern.test(normalized)
    || placeholderLiteralPattern.test(normalized)
    || knownFixtureLiteralPattern.test(normalized);
}

export function inspectPublicSafetyEntries(entries) {
  const findings = [];

  for (const entry of entries) {
    const path = normalizedPath(entry.path);
    const pathReason = riskyPathReason(path);

    if (pathReason) {
      findings.push({ path, reason: pathReason });
    }

    const contentBuffer = typeof entry.content === "string"
      ? Buffer.from(entry.content)
      : Buffer.from(entry.content ?? "");

    if (contentBuffer.byteLength > MAX_SCANNED_FILE_BYTES) {
      findings.push({ path, reason: "file exceeds public-safety scan limit" });
      continue;
    }

    if (contentBuffer.includes(0) || REVIEW_REQUIRED_BINARY_EXTENSION.test(path)) {
      const reviewedDigest = ALLOWED_BINARY_PUBLIC_ASSETS.get(path);
      const contentDigest = createHash("sha256").update(contentBuffer).digest("hex");
      if (reviewedDigest !== contentDigest) {
        findings.push({ path, reason: "binary file requires explicit public-safety review" });
      }
      continue;
    }

    const content = contentBuffer.toString("utf8");

    const productionPortfolioSource = path === "src/index.html" ? content.split('id="bot-view"')[0] : content;
    if (["src/app.js", "src/index.html", "src/browser-fixtures.js"].includes(path) && productionPortfolioFixturePattern.test(productionPortfolioSource)) {
      findings.push({ path, reason: "production Portfolio View fixture or plausible hard-coded portfolio value" });
    }

    for (const rule of highConfidenceSecretPatterns) {
      if (rule.pattern.test(content)) {
        findings.push({ path, reason: rule.reason });
      }
    }

    credentialLiteralPattern.lastIndex = 0;
    for (const match of content.matchAll(credentialLiteralPattern)) {
      if (!isObviouslySyntheticLiteral(match[2])) {
        findings.push({ path, reason: `literal ${match[1]} credential` });
      }
    }

    credentialEnvironmentPattern.lastIndex = 0;
    for (const match of content.matchAll(credentialEnvironmentPattern)) {
      if (match[2] && !isObviouslySyntheticLiteral(match[2])) {
        findings.push({ path, reason: `literal ${match[1]} credential` });
      }
    }
  }

  return findings;
}

export async function readRegularFileWithoutFollowingSymlink(fileUrl) {
  const handle = await open(fileUrl, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function resolveWorktreePath(root, path) {
  const filePath = resolve(root, path);
  const relativePath = relative(root, filePath);

  if (isAbsolute(path) || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Git path escapes repository root: ${path}`);
  }

  return filePath;
}

async function assertNoSymbolicLinkAncestor(root, filePath) {
  let ancestor = dirname(filePath);

  while (ancestor !== root) {
    const metadata = await lstat(ancestor);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Git path has symbolic-link ancestor: ${filePath}`);
    }

    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new Error(`Git path ancestor escaped repository root: ${filePath}`);
    }
    ancestor = parent;
  }
}

export async function loadTrackedEntries({ cwd = process.cwd() } = {}) {
  const output = execFileSync("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ], {
    cwd,
    encoding: "utf8",
  });
  const paths = output.split("\0").filter(Boolean);
  const root = resolve(cwd);
  const worktreeEntries = await Promise.all(paths.map(async (path) => {
    const filePath = resolveWorktreePath(root, path);
    await assertNoSymbolicLinkAncestor(root, filePath);
    const metadata = await lstat(filePath);
    const content = metadata.isSymbolicLink()
      ? Buffer.from(await readlink(filePath), "utf8")
      : await readRegularFileWithoutFollowingSymlink(filePath);

    return { path, content };
  }));
  const worktreeContentByPath = new Map(
    worktreeEntries.map((entry) => [entry.path, entry.content]),
  );
  const stagedOutput = execFileSync("git", [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ], {
    cwd,
    encoding: "utf8",
  });
  const stagedPaths = stagedOutput.split("\0").filter(Boolean);
  const stagedEntries = stagedPaths.flatMap((path) => {
    const content = execFileSync("git", ["show", `:${path}`], { cwd });
    const worktreeContent = worktreeContentByPath.get(path);
    return worktreeContent?.equals(content) ? [] : [{ path, content }];
  });

  return [...worktreeEntries, ...stagedEntries];
}

export async function runPublicSafetyCheck(options = {}) {
  const entries = await loadTrackedEntries(options);
  return inspectPublicSafetyEntries(entries);
}

async function main() {
  const findings = await runPublicSafetyCheck();

  if (findings.length > 0) {
    console.error("Public repository safety check failed:");
    for (const finding of findings) {
      console.error(`- ${finding.path}: ${finding.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Public repository safety check passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
