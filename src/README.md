# Source Layout

The application is a dependency-light Node.js dashboard with a server-side eToro API boundary.

Provider credentials remain server-only. Browser-facing routes expose normalized read-only DTOs, redact provider metadata, and cache provider reads with bounded rate-limit-aware backoff. Demo trading execution remains disabled; the preview route validates proposed inputs without placing orders.

Run `npm run safety:public` before public handoff, then `npm run check` for syntax, generated-contract integrity, and test validation. The current `typecheck` command checks syntax only; it does not perform static type checking. See the repository README and central project memory for named Real/Demo configuration and security requirements.

For future, separately authorized provider work, use the official portal and
`etoro-public-api-operations` Agent Skill through the references in the root
README to dynamically discover the current contract. Existing `/api/v1` paths
are dated local implementation evidence, not route authority; do not install
MCP tooling, paste credentials into chat, or make provider/trading calls merely
because a reference describes them.

The root README records the eToro support clarification received 2026-10-03.
Search results are accepted only for an exact `internalSymbolFull`; projected
type fields can be missing, and equal repeated `instrumentId` JSON properties
do not represent extra results. Classification, if introduced, must resolve the
instruments endpoint's `instrumentTypeID` through the instrument-types endpoint.
Market timestamp normalization requires an explicit ISO 8601 timezone and a
valid calendar date, and does not infer session, listing currency, price basis,
corporate-action adjustments, retention, or model-use rights.
