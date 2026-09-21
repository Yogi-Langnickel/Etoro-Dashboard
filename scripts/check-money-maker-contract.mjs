import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  MONEY_MAKER_CONTRACT,
  MONEY_MAKER_CONTRACT_PROVENANCE,
} from "../src/money-maker-contract.mjs";

if (MONEY_MAKER_CONTRACT.schemaVersion !== "dashboard-simulation-contract.v1") {
  throw new Error("Generated Money-maker dashboard contract schema is unsupported.");
}
if (!/^[a-f0-9]{40}$/.test(MONEY_MAKER_CONTRACT_PROVENANCE.producerCommit)) {
  throw new Error("Generated Money-maker dashboard contract is not pinned to an immutable producer commit.");
}

const execFileAsync = promisify(execFile);
export const DEFAULT_PRODUCER_CHECKOUT = fileURLToPath(new URL("../../Money-maker-3000", import.meta.url));

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

// Read immutable Git objects, never Python from an arbitrary working branch.
// Git environment selectors cannot redirect this explicitly selected checkout;
// lazy fetching is disabled so the optional check remains local and read-only.
async function git(checkout, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const { stdout } = await execFileAsync("git", ["-C", checkout, ...args], {
    env: { ...env, GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  return stdout;
}

export async function verifyProducerContract({
  checkout = process.env.MONEY_MAKER_PRODUCER_CHECKOUT || DEFAULT_PRODUCER_CHECKOUT,
  provenance = MONEY_MAKER_CONTRACT_PROVENANCE,
} = {}) {
  if (provenance.producerRepository !== "Yogi-Langnickel/Money-maker-3000" ||
    provenance.producerPath !== "contracts/dashboard-simulation-contract.json" ||
    !/^[a-f0-9]{40}$/.test(provenance.producerCommit) ||
    !/^[a-f0-9]{64}$/.test(provenance.artifactSha256)) {
    fail("PRODUCER_PROVENANCE_INVALID", "Producer verification requires valid immutable provenance.");
  }
  try {
    if (!(await stat(checkout)).isDirectory()) throw new Error("not-directory");
  } catch (error) {
    if (error.code === "ENOENT") return { status: "unavailable", reason: "producer-checkout-missing" };
    fail("PRODUCER_CHECKOUT_INVALID", "Producer checkout cannot be inspected.");
  }
  let origin;
  try {
    const topLevel = (await git(checkout, ["rev-parse", "--show-toplevel"])).trim();
    if (await realpath(topLevel) !== await realpath(checkout)) throw new Error("not-root");
    origin = (await git(checkout, ["config", "--get", "remote.origin.url"])).trim();
  } catch {
    fail("PRODUCER_CHECKOUT_INVALID", "Producer checkout must be a Git worktree with an origin.");
  }
  const repository = provenance.producerRepository;
  const allowedOrigins = [
    `https://github.com/${repository}`, `git@github.com:${repository}`, `ssh://git@github.com/${repository}`,
  ].flatMap((url) => [url, `${url}.git`]);
  if (!allowedOrigins.includes(origin)) {
    fail("PRODUCER_REPOSITORY_MISMATCH", "Producer checkout origin does not match artifact provenance.");
  }
  try {
    await git(checkout, ["cat-file", "-e", `${provenance.producerCommit}^{commit}`]);
  } catch {
    return { status: "unavailable", reason: "pinned-producer-revision-unavailable" };
  }
  let artifact;
  try {
    artifact = await git(checkout, ["cat-file", "blob", `${provenance.producerCommit}:${provenance.producerPath}`]);
  } catch {
    fail("PRODUCER_ARTIFACT_MISSING", "Pinned producer revision does not contain the expected contract artifact.");
  }
  if (createHash("sha256").update(artifact).digest("hex") !== provenance.artifactSha256) {
    fail("PRODUCER_CONTRACT_MISMATCH", "Pinned producer artifact does not match generated contract provenance.");
  }
  return { status: "verified", producerCommit: provenance.producerCommit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`Mandatory generated contract schema/provenance/hash checks passed (${MONEY_MAKER_CONTRACT_PROVENANCE.producerCommit.slice(0, 7)}).\n`);
    const result = await verifyProducerContract();
    process.stdout.write(result.status === "verified"
      ? "Optional pinned producer artifact verification passed.\n"
      : `Optional producer verification unavailable: ${result.reason}. Mandatory artifact checks still passed.\n`);
  } catch (error) {
    process.stderr.write(`${error.code ?? "PRODUCER_VERIFICATION_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
