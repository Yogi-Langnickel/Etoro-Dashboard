# Source Layout

The application is a dependency-light Node.js dashboard with a server-side eToro API boundary.

Provider credentials remain server-only. Browser-facing routes expose normalized read-only DTOs, redact provider metadata, and cache provider reads with bounded rate-limit-aware backoff. Demo trading execution remains disabled; the preview route validates proposed inputs without placing orders.

Run `npm run safety:public` before public handoff, then `npm run check` for syntax, type-shape, and test validation. See the repository README and central project memory for configuration and security requirements.
