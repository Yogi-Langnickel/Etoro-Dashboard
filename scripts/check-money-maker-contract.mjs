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

process.stdout.write(
  `Money-maker contract drift check passed (${MONEY_MAKER_CONTRACT_PROVENANCE.producerCommit.slice(0, 7)}).\n`,
);
