import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { verifyProducerContract } from "../scripts/check-money-maker-contract.mjs";
import { MONEY_MAKER_CONTRACT_PROVENANCE } from "../src/money-maker-contract.mjs";

const execFileAsync = promisify(execFile);
const artifactUrl = new URL("../contracts/generated/money-maker-dashboard-contract.json", import.meta.url);

async function fixture(context, { artifact = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "etoro-producer-portability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, "producer");
  await mkdir(checkout);
  const git = async (...args) => (await execFileAsync("git", ["-C", checkout, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: "Synthetic Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Synthetic Test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
  })).stdout.trim();
  await git("init", "--quiet");
  await git("remote", "add", "origin", "https://github.com/Yogi-Langnickel/Money-maker-3000.git");
  if (artifact) {
    await mkdir(join(checkout, "contracts"));
    await writeFile(join(checkout, MONEY_MAKER_CONTRACT_PROVENANCE.producerPath), await readFile(artifactUrl));
    await git("add", "contracts");
  }
  await git("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--allow-empty", "-m", "synthetic producer");
  return { root, checkout, git, provenance: { ...MONEY_MAKER_CONTRACT_PROVENANCE, producerCommit: await git("rev-parse", "HEAD") } };
}

test("missing producer checkout reports an explicit unavailable optional check", async (context) => {
  const { root, provenance } = await fixture(context);
  assert.deepEqual(await verifyProducerContract({ checkout: join(root, "missing"), provenance }), {
    status: "unavailable", reason: "producer-checkout-missing",
  });
});

test("relocated linked producer worktree verifies pinned provenance despite dirty working files", async (context) => {
  const { root, checkout, git, provenance } = await fixture(context);
  const linked = join(root, "linked");
  await git("-c", "core.hooksPath=/dev/null", "worktree", "add", "--quiet", "--detach", linked);
  await writeFile(join(linked, provenance.producerPath), "unrelated dirty producer state\n");
  assert.equal((await verifyProducerContract({ checkout: linked, provenance })).status, "verified");
  assert.equal(await readFile(join(linked, provenance.producerPath), "utf8"), "unrelated dirty producer state\n");
  const relocated = join(root, "relocated");
  // Remove the temporary linked worktree before relocating its primary checkout.
  await git("worktree", "remove", "--force", linked);
  await rename(checkout, relocated);
  assert.equal((await verifyProducerContract({ checkout: relocated, provenance })).status, "verified");
});

test("incompatible producer repository fails closed instead of skipping", async (context) => {
  const { checkout, git, provenance } = await fixture(context);
  await git("remote", "set-url", "origin", "https://github.com/example/incompatible.git");
  await assert.rejects(verifyProducerContract({ checkout, provenance }), { code: "PRODUCER_REPOSITORY_MISMATCH" });
});

test("a checkout without the pinned revision explicitly reports unavailable without substituting HEAD", async (context) => {
  const { checkout, provenance } = await fixture(context);
  const unknown = { ...provenance, producerCommit: "0".repeat(40) };
  assert.deepEqual(await verifyProducerContract({ checkout, provenance: unknown }), {
    status: "unavailable", reason: "pinned-producer-revision-unavailable",
  });
});

test("a genuine pinned producer contract mismatch fails closed", async (context) => {
  const { checkout, provenance } = await fixture(context);
  await assert.rejects(verifyProducerContract({ checkout, provenance: { ...provenance, artifactSha256: "0".repeat(64) } }), {
    code: "PRODUCER_CONTRACT_MISMATCH",
  });
});

test("a pinned revision missing the promised contract artifact fails closed", async (context) => {
  const { checkout, provenance } = await fixture(context, { artifact: false });
  await assert.rejects(verifyProducerContract({ checkout, provenance }), { code: "PRODUCER_ARTIFACT_MISSING" });
});

test("mandatory generated hash validation fails even when the optional producer is absent", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "etoro-artifact-portability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "contracts", "generated"), { recursive: true });
  for (const name of ["src/money-maker-contract.mjs", "scripts/check-money-maker-contract.mjs", "contracts/generated/money-maker-dashboard-contract.provenance.json"]) {
    await writeFile(join(root, name), await readFile(new URL(`../${name}`, import.meta.url)));
  }
  await writeFile(join(root, "contracts/generated/money-maker-dashboard-contract.json"), `${await readFile(artifactUrl, "utf8")}\n`);
  await assert.rejects(execFileAsync(process.execPath, [join(root, "scripts/check-money-maker-contract.mjs")], {
    env: { ...process.env, MONEY_MAKER_PRODUCER_CHECKOUT: join(root, "missing") },
  }), (error) => error.code === 1 && error.stderr.includes("artifact hash does not match provenance"));
});
